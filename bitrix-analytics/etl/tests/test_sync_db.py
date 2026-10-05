"""Тесты синхронизации на реальной PostgreSQL с поддельным Битриксом."""
from decimal import Decimal

import pytest

from app import db
from app.bitrix.client import BitrixError
from app.config import Settings
from app.sync import deals, stage_history
from app.sync.dictionaries import sync_dictionaries
from app.sync.runner import run_reconcile, run_sync
from tests.conftest import TEST_DB
from tests.fake_bitrix import deal


def scalar(conn, sql, *args):
    return conn.execute(sql, args).fetchone()[0]


def test_migrations_are_idempotent(conn):
    assert db.apply_migrations(conn) == []
    assert scalar(conn, "SELECT count(*) FROM schema_migrations") == 1


def test_dictionaries(conn, fake, client):
    fake.statuses = [
        {"ENTITY_ID": "DEAL_STAGE", "STATUS_ID": "NEW", "NAME": "Новая", "SORT": "10", "SEMANTICS": ""},
        {"ENTITY_ID": "DEAL_STAGE_1", "STATUS_ID": "C1:NEW", "NAME": "Заявка", "SORT": "10", "SEMANTICS": "", "COLOR": "#fff"},
        {"ENTITY_ID": "DEAL_STAGE_1", "STATUS_ID": "C1:WON", "NAME": "Успех", "SORT": "20", "SEMANTICS": "S"},
        {"ENTITY_ID": "SOURCE", "STATUS_ID": "WEB", "NAME": "Сайт", "SORT": "10"},
        {"ENTITY_ID": "DEAL_TYPE", "STATUS_ID": "SALE", "NAME": "Продажа", "SORT": "10"},
        {"ENTITY_ID": "LEAD_STATUS", "STATUS_ID": "NEW", "NAME": "Не наша сущность", "SORT": "10"},
    ]
    fake.users = [
        {"ID": "5", "NAME": "Иван", "LAST_NAME": "Петров", "EMAIL": "i@x.ru", "ACTIVE": True, "UF_DEPARTMENT": [1]},
        {"ID": "6", "NAME": "Анна", "LAST_NAME": "", "ACTIVE": False},
    ]
    fake.userfields = [
        {"FIELD_NAME": "UF_CRM_REGION", "USER_TYPE_ID": "enumeration", "EDIT_FORM_LABEL": {"ru": "Регион", "en": "Region"},
         "LIST": [{"ID": "1", "VALUE": "Москва"}]},
    ]

    assert sync_dictionaries(conn, client) == 2 + 5 + 2 + 1  # воронки (1 + «Общая»), статусы (3 стадии, источник, тип), юзеры, поля

    assert scalar(conn, "SELECT count(*) FROM dim_category") == 2
    assert scalar(conn, "SELECT name FROM dim_category WHERE id = 0") == "Общая"
    assert scalar(conn, "SELECT category_id FROM dim_stage WHERE stage_id = 'C1:WON'") == 1
    assert scalar(conn, "SELECT category_id FROM dim_stage WHERE stage_id = 'NEW'") == 0
    assert scalar(conn, "SELECT semantics FROM dim_stage WHERE stage_id = 'C1:WON'") == "S"
    assert scalar(conn, "SELECT semantics FROM dim_stage WHERE stage_id = 'NEW'") is None
    assert scalar(conn, "SELECT count(*) FROM dim_stage") == 3
    assert scalar(conn, "SELECT name FROM dim_source WHERE source_id = 'WEB'") == "Сайт"
    assert scalar(conn, "SELECT full_name FROM dim_user WHERE id = 5") == "Петров Иван"
    assert scalar(conn, "SELECT is_active FROM dim_user WHERE id = 6") is False
    assert scalar(conn, "SELECT label FROM dim_userfield WHERE field_name = 'UF_CRM_REGION'") == "Регион"

    # повторный запуск не плодит дубли, а удалённая в Битриксе стадия исчезает
    fake.statuses = fake.statuses[:2]
    sync_dictionaries(conn, client)
    assert scalar(conn, "SELECT count(*) FROM dim_stage") == 2
    # пустой ответ по справочнику считаем сбоем и ничего не удаляем
    assert scalar(conn, "SELECT count(*) FROM dim_source") == 1


def test_deals_full_then_incremental(conn, fake, client):
    fake.deals = [deal(1), deal(2), deal(3, modified="2025-03-02T12:00:00+03:00")]

    mode, rows = deals.sync_deals(conn, client)
    assert (mode, rows) == ("full", 3)
    assert scalar(conn, "SELECT count(*) FROM fact_deal") == 3

    d = conn.execute("SELECT category_id, is_closed, opportunity, company_id, contact_id, lead_id, "
                     "utm_campaign, user_fields->>'UF_CRM_REGION', date_create FROM fact_deal WHERE id = 1").fetchone()
    assert d[:8] == (1, False, Decimal("1000.00"), None, 7, None, None, "Москва")
    assert d[8].isoformat() == "2025-03-01T06:00:00+00:00"
    assert db.get_state(conn, deals.STATE_WATERMARK) == "2025-03-02T12:00:00+03:00"

    # новая сделка и правка старой; сделка 1 изменена давно и под фильтр не попадёт
    fake.deals.append(deal(4, modified="2025-03-03T10:00:00+03:00"))
    fake.deals[2] = deal(3, modified="2025-03-03T11:00:00+03:00", STAGE_ID="C1:WON", STAGE_SEMANTIC_ID="S", CLOSED="Y")
    fake.calls.clear()

    mode, rows = deals.sync_deals(conn, client, overlap_minutes=10)
    assert (mode, rows) == ("incremental", 2)
    assert fake.calls[0][1]["filter"][">=DATE_MODIFY"] == "2025-03-02T11:50:00+03:00"
    assert scalar(conn, "SELECT count(*) FROM fact_deal") == 4
    assert scalar(conn, "SELECT stage_id FROM fact_deal WHERE id = 3") == "C1:WON"
    assert scalar(conn, "SELECT is_closed FROM fact_deal WHERE id = 3") is True


def test_deals_full_flag_ignores_watermark(conn, fake, client):
    fake.deals = [deal(1), deal(2)]
    deals.sync_deals(conn, client)
    assert deals.sync_deals(conn, client, full=True) == ("full", 2)


def test_reconcile_marks_deleted_and_restores(conn, fake, client):
    fake.deals = [deal(1), deal(2), deal(3)]
    deals.sync_deals(conn, client)

    del fake.deals[1]
    assert deals.reconcile_deleted(conn, client) == 1
    assert scalar(conn, "SELECT is_deleted FROM fact_deal WHERE id = 2") is True
    assert scalar(conn, "SELECT count(*) FROM fact_deal WHERE NOT is_deleted") == 2

    # сделка вернулась (восстановлена из корзины) → снова активна
    fake.deals.append(deal(2, modified="2025-03-05T10:00:00+03:00"))
    deals.sync_deals(conn, client)
    assert scalar(conn, "SELECT is_deleted FROM fact_deal WHERE id = 2") is False


def test_reconcile_refuses_to_wipe_everything(conn, fake, client):
    fake.deals = [deal(1)]
    deals.sync_deals(conn, client)
    fake.deals = []
    with pytest.raises(RuntimeError):
        deals.reconcile_deleted(conn, client)
    assert scalar(conn, "SELECT count(*) FROM fact_deal WHERE NOT is_deleted") == 1


def test_stage_history_is_incremental(conn, fake, client):
    def h(id, deal_id, stage):
        return {"ID": str(id), "TYPE_ID": "2", "OWNER_ID": str(deal_id), "CATEGORY_ID": "1", "STAGE_SEMANTIC_ID": "P",
                "STAGE_ID": stage, "CREATED_TIME": "2025-03-01T10:00:00+03:00"}

    fake.history = [h(1, 10, "C1:NEW"), h(2, 10, "C1:PREP"), h(3, 11, "C1:NEW")]
    assert stage_history.sync_stage_history(conn, client) == ("full", 3)
    assert db.get_state(conn, stage_history.STATE_LAST_ID) == "3"

    fake.history += [h(4, 11, "C1:WON")]
    fake.calls.clear()
    assert stage_history.sync_stage_history(conn, client) == ("incremental", 1)
    assert fake.calls[0][1]["filter"] == {">ID": 3}
    assert scalar(conn, "SELECT count(*) FROM fact_stage_history WHERE deal_id = 11") == 2


def test_run_sync_logs_steps_and_survives_step_failure(conn, fake, client, monkeypatch):
    settings = Settings(webhook_url="https://x/rest/1/a/", database_url=TEST_DB, min_request_interval=0)
    fake.deals = [deal(1)]

    assert run_sync(settings, client) is True
    rows = conn.execute("SELECT entity, status, rows_processed FROM sync_log ORDER BY id").fetchall()
    assert [(r[0], r[1]) for r in rows] == [("dictionaries", "ok"), ("deals", "ok"), ("stage_history", "ok")]
    assert rows[1][2] == 1

    # справочники падают (нет прав), но сделки и история всё равно загружаются
    original = client.call

    def call(method, params=None):
        if method == "crm.category.list":
            raise BitrixError("ACCESS_DENIED", "нет прав", method)
        return original(method, params)

    monkeypatch.setattr(client, "call", call)
    fake.deals.append(deal(2, modified="2025-03-04T10:00:00+03:00"))

    assert run_sync(settings, client) is False
    last = conn.execute("SELECT entity, status, error FROM sync_log ORDER BY id DESC LIMIT 3").fetchall()
    assert {r[0]: r[1] for r in last} == {"dictionaries": "error", "deals": "ok", "stage_history": "ok"}
    assert "ACCESS_DENIED" in next(r[2] for r in last if r[0] == "dictionaries")
    assert scalar(conn, "SELECT count(*) FROM fact_deal") == 2


def test_run_reconcile_wrapper(conn, fake, client):
    settings = Settings(webhook_url="https://x/rest/1/a/", database_url=TEST_DB, min_request_interval=0)
    fake.deals = [deal(1), deal(2)]
    deals.sync_deals(conn, client)
    fake.deals = [deal(1)]
    assert run_reconcile(settings, client) is True
    assert scalar(conn, "SELECT count(*) FROM fact_deal WHERE is_deleted") == 1
