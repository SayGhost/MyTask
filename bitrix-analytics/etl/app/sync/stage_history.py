"""История переходов сделок по стадиям (crm.stagehistory.list). Таблица только дописывается."""
from __future__ import annotations

import logging

import psycopg

from .. import db
from ..bitrix.client import BitrixClient
from .common import g, nz, parse_dt, to_int

log = logging.getLogger(__name__)

STATE_LAST_ID = "stage_history.last_id"

UPSERT_SQL = """
INSERT INTO fact_stage_history (id, deal_id, category_id, stage_id, stage_semantic_id, type_id, created_time)
VALUES (%s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET
    deal_id = EXCLUDED.deal_id, category_id = EXCLUDED.category_id, stage_id = EXCLUDED.stage_id,
    stage_semantic_id = EXCLUDED.stage_semantic_id, type_id = EXCLUDED.type_id,
    created_time = EXCLUDED.created_time, synced_at = now()
"""


def map_history(item: dict) -> tuple:
    return (
        int(item["ID"]),
        int(g(item, "OWNER_ID", "ENTITY_ID")),
        to_int(item.get("CATEGORY_ID")),
        nz(item.get("STAGE_ID")),
        nz(item.get("STAGE_SEMANTIC_ID")),
        to_int(item.get("TYPE_ID")),
        parse_dt(item.get("CREATED_TIME")),
    )


def sync_stage_history(conn: psycopg.Connection, client: BitrixClient, full: bool = False) -> tuple[str, int]:
    last_id = 0 if full else int(db.get_state(conn, STATE_LAST_ID) or 0)
    mode = "incremental" if last_id else "full"

    rows = 0
    for page in client.iter_keyset(
        "crm.stagehistory.list", {"entityTypeId": 2}, result_key="items", after=last_id, no_count=False
    ):
        mapped = [map_history(item) for item in page]
        with conn.transaction():
            with conn.cursor() as cur:
                cur.executemany(UPSERT_SQL, mapped)
            # отметка двигается в той же транзакции, что и данные
            db.set_state(conn, STATE_LAST_ID, str(max(m[0] for m in mapped)))
        rows += len(mapped)
        log.info("История стадий (%s): загружено %d", mode, rows)
    return mode, rows
