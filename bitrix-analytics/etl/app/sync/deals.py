"""Сделки: полная и инкрементальная выгрузка, поиск удалённых."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

import psycopg
from psycopg.types.json import Jsonb

from .. import db
from ..bitrix.client import BitrixClient
from .common import nz, parse_dt, to_bool, to_decimal, to_id, to_int

log = logging.getLogger(__name__)

STATE_WATERMARK = "deals.date_modify"

UPSERT_SQL = """
INSERT INTO fact_deal (
    id, title, category_id, stage_id, stage_semantic_id, is_closed, opportunity, currency_id,
    assigned_by_id, created_by_id, source_id, type_id, company_id, contact_id, lead_id,
    begin_date, date_create, date_modify, close_date,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    user_fields, raw, is_deleted, deleted_at, synced_at
) VALUES (
    %(id)s, %(title)s, %(category_id)s, %(stage_id)s, %(stage_semantic_id)s, %(is_closed)s,
    %(opportunity)s, %(currency_id)s, %(assigned_by_id)s, %(created_by_id)s, %(source_id)s,
    %(type_id)s, %(company_id)s, %(contact_id)s, %(lead_id)s,
    %(begin_date)s, %(date_create)s, %(date_modify)s, %(close_date)s,
    %(utm_source)s, %(utm_medium)s, %(utm_campaign)s, %(utm_content)s, %(utm_term)s,
    %(user_fields)s, %(raw)s, false, NULL, now()
)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, category_id = EXCLUDED.category_id, stage_id = EXCLUDED.stage_id,
    stage_semantic_id = EXCLUDED.stage_semantic_id, is_closed = EXCLUDED.is_closed,
    opportunity = EXCLUDED.opportunity, currency_id = EXCLUDED.currency_id,
    assigned_by_id = EXCLUDED.assigned_by_id, created_by_id = EXCLUDED.created_by_id,
    source_id = EXCLUDED.source_id, type_id = EXCLUDED.type_id, company_id = EXCLUDED.company_id,
    contact_id = EXCLUDED.contact_id, lead_id = EXCLUDED.lead_id, begin_date = EXCLUDED.begin_date,
    date_create = EXCLUDED.date_create, date_modify = EXCLUDED.date_modify,
    close_date = EXCLUDED.close_date, utm_source = EXCLUDED.utm_source,
    utm_medium = EXCLUDED.utm_medium, utm_campaign = EXCLUDED.utm_campaign,
    utm_content = EXCLUDED.utm_content, utm_term = EXCLUDED.utm_term,
    user_fields = EXCLUDED.user_fields, raw = EXCLUDED.raw,
    is_deleted = false, deleted_at = NULL, synced_at = now()
"""


def map_deal(item: dict) -> dict:
    """Ответ crm.deal.list → строка fact_deal."""
    return {
        "id": int(item["ID"]),
        "title": nz(item.get("TITLE")),
        "category_id": to_int(item.get("CATEGORY_ID")) or 0,
        "stage_id": nz(item.get("STAGE_ID")),
        "stage_semantic_id": nz(item.get("STAGE_SEMANTIC_ID")),
        "is_closed": to_bool(item.get("CLOSED")),
        "opportunity": to_decimal(item.get("OPPORTUNITY")),
        "currency_id": nz(item.get("CURRENCY_ID")),
        "assigned_by_id": to_id(item.get("ASSIGNED_BY_ID")),
        "created_by_id": to_id(item.get("CREATED_BY_ID")),
        "source_id": nz(item.get("SOURCE_ID")),
        "type_id": nz(item.get("TYPE_ID")),
        "company_id": to_id(item.get("COMPANY_ID")),
        "contact_id": to_id(item.get("CONTACT_ID")),
        "lead_id": to_id(item.get("LEAD_ID")),
        "begin_date": parse_dt(item.get("BEGINDATE")),
        "date_create": parse_dt(item.get("DATE_CREATE")),
        "date_modify": parse_dt(item.get("DATE_MODIFY")),
        "close_date": parse_dt(item.get("CLOSEDATE")),
        "utm_source": nz(item.get("UTM_SOURCE")),
        "utm_medium": nz(item.get("UTM_MEDIUM")),
        "utm_campaign": nz(item.get("UTM_CAMPAIGN")),
        "utm_content": nz(item.get("UTM_CONTENT")),
        "utm_term": nz(item.get("UTM_TERM")),
        "user_fields": Jsonb({k: v for k, v in item.items() if k.startswith("UF_")}),
        "raw": Jsonb(item),
    }


def sync_deals(
    conn: psycopg.Connection, client: BitrixClient, overlap_minutes: int = 10, full: bool = False
) -> tuple[str, int]:
    """Загружает сделки. Возвращает (режим, число строк).

    Режим `full` — все сделки; `incremental` — изменённые после сохранённой отметки
    DATE_MODIFY (с запасом `overlap_minutes`, upsert делает повторную загрузку безопасной).
    """
    watermark_raw = None if full else db.get_state(conn, STATE_WATERMARK)
    params: dict = {"select": ["*", "UF_*"]}
    mode = "full"
    if watermark_raw:
        since = datetime.fromisoformat(watermark_raw) - timedelta(minutes=overlap_minutes)
        params["filter"] = {">=DATE_MODIFY": since.isoformat()}
        mode = "incremental"

    rows = 0
    newest: datetime | None = None
    for page in client.iter_keyset("crm.deal.list", params):
        mapped = [map_deal(item) for item in page]
        with conn.transaction():
            with conn.cursor() as cur:
                cur.executemany(UPSERT_SQL, mapped)
        rows += len(mapped)
        for m in mapped:
            if m["date_modify"] and (newest is None or m["date_modify"] > newest):
                newest = m["date_modify"]
        log.info("Сделки (%s): загружено %d", mode, rows)

    if newest is not None and (not watermark_raw or newest > datetime.fromisoformat(watermark_raw)):
        db.set_state(conn, STATE_WATERMARK, newest.isoformat())
    return mode, rows


def reconcile_deleted(conn: psycopg.Connection, client: BitrixClient) -> int:
    """Помечает удалённые в Битриксе сделки (is_deleted). Возвращает число помеченных."""
    ids: set[int] = set()
    for page in client.iter_keyset("crm.deal.list", {"select": ["ID"]}):
        ids.update(int(item["ID"]) for item in page)

    known = conn.execute("SELECT count(*) FROM fact_deal WHERE NOT is_deleted").fetchone()[0]
    if not ids and known:
        # пустой ответ при непустой базе — скорее сбой доступа, чем удаление всех сделок
        raise RuntimeError("crm.deal.list вернул 0 сделок при непустой базе, пометка удалённых пропущена")

    cur = conn.execute(
        "UPDATE fact_deal SET is_deleted = true, deleted_at = now() "
        "WHERE NOT is_deleted AND id <> ALL(%s::bigint[])",
        (sorted(ids),),
    )
    return cur.rowcount
