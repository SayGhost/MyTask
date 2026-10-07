"""Контакты: полная и инкрементальная выгрузка, поиск удалённых."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

import psycopg
from psycopg.types.json import Jsonb

from .. import db
from ..bitrix.client import BitrixClient
from .common import nz, parse_dt, to_id

log = logging.getLogger(__name__)

STATE_WATERMARK = "contacts.date_modify"

# Личные данные: по умолчанию не попадают ни в колонки, ни в raw (SYNC_CONTACT_PERSONAL_DATA=true сохраняет всё)
PERSONAL_KEYS = {
    "NAME", "SECOND_NAME", "LAST_NAME", "HONORIFIC", "POST", "BIRTHDATE", "PHOTO",
    "PHONE", "EMAIL", "WEB", "IM", "HAS_PHONE", "HAS_EMAIL", "HAS_IMOL",
    "ADDRESS", "ADDRESS_2", "ADDRESS_CITY", "ADDRESS_POSTAL_CODE", "ADDRESS_REGION",
    "ADDRESS_PROVINCE", "ADDRESS_COUNTRY", "ADDRESS_COUNTRY_CODE", "ADDRESS_LOC_ADDR_ID",
}

UPSERT_SQL = """
INSERT INTO fact_contact (
    id, type_id, source_id, assigned_by_id, company_id, lead_id,
    date_create, date_modify, user_fields, raw, is_deleted, deleted_at, synced_at
) VALUES (
    %(id)s, %(type_id)s, %(source_id)s, %(assigned_by_id)s, %(company_id)s, %(lead_id)s,
    %(date_create)s, %(date_modify)s, %(user_fields)s, %(raw)s, false, NULL, now()
)
ON CONFLICT (id) DO UPDATE SET
    type_id = EXCLUDED.type_id, source_id = EXCLUDED.source_id,
    assigned_by_id = EXCLUDED.assigned_by_id, company_id = EXCLUDED.company_id,
    lead_id = EXCLUDED.lead_id, date_create = EXCLUDED.date_create,
    date_modify = EXCLUDED.date_modify, user_fields = EXCLUDED.user_fields,
    raw = EXCLUDED.raw, is_deleted = false, deleted_at = NULL, synced_at = now()
"""


def map_contact(item: dict, keep_personal: bool = False) -> dict:
    """Ответ crm.contact.list → строка fact_contact."""
    raw = item if keep_personal else {k: v for k, v in item.items() if k not in PERSONAL_KEYS}
    return {
        "id": int(item["ID"]),
        "type_id": nz(item.get("TYPE_ID")),
        "source_id": nz(item.get("SOURCE_ID")),
        "assigned_by_id": to_id(item.get("ASSIGNED_BY_ID")),
        "company_id": to_id(item.get("COMPANY_ID")),
        "lead_id": to_id(item.get("LEAD_ID")),
        "date_create": parse_dt(item.get("DATE_CREATE")),
        "date_modify": parse_dt(item.get("DATE_MODIFY")),
        "user_fields": Jsonb({k: v for k, v in item.items() if k.startswith("UF_")}),
        "raw": Jsonb(raw),
    }


def sync_contacts(
    conn: psycopg.Connection, client: BitrixClient, overlap_minutes: int = 10, full: bool = False,
    keep_personal: bool = False,
) -> tuple[str, int]:
    """Загружает контакты. Возвращает (режим, число строк); логика такая же, как у сделок."""
    watermark_raw = None if full else db.get_state(conn, STATE_WATERMARK)
    params: dict = {"select": ["*", "UF_*"]}
    mode = "full"
    if watermark_raw:
        since = datetime.fromisoformat(watermark_raw) - timedelta(minutes=overlap_minutes)
        params["filter"] = {">=DATE_MODIFY": since.isoformat()}
        mode = "incremental"

    rows = 0
    newest: datetime | None = None
    for page in client.iter_keyset("crm.contact.list", params):
        mapped = [map_contact(item, keep_personal) for item in page]
        with conn.transaction():
            with conn.cursor() as cur:
                cur.executemany(UPSERT_SQL, mapped)
        rows += len(mapped)
        for m in mapped:
            if m["date_modify"] and (newest is None or m["date_modify"] > newest):
                newest = m["date_modify"]
        log.info("Контакты (%s): загружено %d", mode, rows)

    if newest is not None and (not watermark_raw or newest > datetime.fromisoformat(watermark_raw)):
        db.set_state(conn, STATE_WATERMARK, newest.isoformat())
    return mode, rows


def reconcile_deleted(conn: psycopg.Connection, client: BitrixClient) -> int:
    """Помечает удалённые в Битриксе контакты (is_deleted). Возвращает число помеченных."""
    ids: set[int] = set()
    for page in client.iter_keyset("crm.contact.list", {"select": ["ID"]}):
        ids.update(int(item["ID"]) for item in page)

    known = conn.execute("SELECT count(*) FROM fact_contact WHERE NOT is_deleted").fetchone()[0]
    if not ids and known:
        raise RuntimeError("crm.contact.list вернул 0 контактов при непустой базе, пометка удалённых пропущена")

    cur = conn.execute(
        "UPDATE fact_contact SET is_deleted = true, deleted_at = now() "
        "WHERE NOT is_deleted AND id <> ALL(%s::bigint[])",
        (sorted(ids),),
    )
    return cur.rowcount
