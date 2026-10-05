"""Справочники: воронки, стадии, источники, типы сделок, пользователи, пользовательские поля."""
from __future__ import annotations

import logging

import psycopg
from psycopg.types.json import Jsonb

from ..bitrix.client import BitrixClient
from .common import g, nz, to_bool, to_int

log = logging.getLogger(__name__)


def _replace_missing(conn: psycopg.Connection, table: str, key_col: str, keys: list, cast: str) -> None:
    """Удаляет строки справочника, которых больше нет в Битриксе (справочники грузятся целиком)."""
    if keys:
        conn.execute(f"DELETE FROM {table} WHERE {key_col} <> ALL(%s::{cast}[])", (keys,))


def sync_categories(conn: psycopg.Connection, client: BitrixClient) -> int:
    data = client.call("crm.category.list", {"entityTypeId": 2})
    result = data.get("result") or {}
    categories = result.get("categories", []) if isinstance(result, dict) else result

    rows = {}
    for c in categories:
        cid = to_int(g(c, "id", "ID"))
        if cid is None:
            continue
        rows[cid] = (cid, g(c, "name", "NAME") or f"Воронка {cid}", to_int(g(c, "sort", "SORT")),
                     to_bool(g(c, "isDefault", "IS_DEFAULT")))
    rows.setdefault(0, (0, "Общая", 0, True))  # основная воронка может не приходить в списке

    with conn.transaction():
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO dim_category (id, name, sort, is_default) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort = EXCLUDED.sort, "
                "is_default = EXCLUDED.is_default, updated_at = now()",
                list(rows.values()),
            )
        _replace_missing(conn, "dim_category", "id", list(rows), "int")
    return len(rows)


def _stage_category(status: dict) -> int:
    entity_id = status.get("ENTITY_ID", "")
    cat = to_int(status.get("CATEGORY_ID"))
    if cat is not None:
        return cat
    if entity_id.startswith("DEAL_STAGE_"):
        return to_int(entity_id.removeprefix("DEAL_STAGE_")) or 0
    return 0


def sync_statuses(conn: psycopg.Connection, client: BitrixClient) -> int:
    """Стадии сделок, источники и типы сделок — всё из crm.status.list."""
    stages, sources, types = {}, {}, {}
    for page in client.iter_offset("crm.status.list", {"order": {"SORT": "ASC"}}):
        for s in page:
            entity_id, status_id = s.get("ENTITY_ID", ""), nz(s.get("STATUS_ID"))
            if status_id is None:
                continue
            name = s.get("NAME") or status_id
            sort = to_int(s.get("SORT"))
            if entity_id == "DEAL_STAGE" or entity_id.startswith("DEAL_STAGE_"):
                stages[status_id] = (status_id, _stage_category(s), name, sort,
                                     nz(s.get("SEMANTICS")), nz(s.get("COLOR")))
            elif entity_id == "SOURCE":
                sources[status_id] = (status_id, name, sort)
            elif entity_id == "DEAL_TYPE":
                types[status_id] = (status_id, name, sort)

    with conn.transaction():
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO dim_stage (stage_id, category_id, name, sort, semantics, color) "
                "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (stage_id) DO UPDATE SET "
                "category_id = EXCLUDED.category_id, name = EXCLUDED.name, sort = EXCLUDED.sort, "
                "semantics = EXCLUDED.semantics, color = EXCLUDED.color, updated_at = now()",
                list(stages.values()),
            )
            cur.executemany(
                "INSERT INTO dim_source (source_id, name, sort) VALUES (%s, %s, %s) "
                "ON CONFLICT (source_id) DO UPDATE SET name = EXCLUDED.name, sort = EXCLUDED.sort, "
                "updated_at = now()",
                list(sources.values()),
            )
            cur.executemany(
                "INSERT INTO dim_deal_type (type_id, name, sort) VALUES (%s, %s, %s) "
                "ON CONFLICT (type_id) DO UPDATE SET name = EXCLUDED.name, sort = EXCLUDED.sort, "
                "updated_at = now()",
                list(types.values()),
            )
        _replace_missing(conn, "dim_stage", "stage_id", list(stages), "text")
        _replace_missing(conn, "dim_source", "source_id", list(sources), "text")
        _replace_missing(conn, "dim_deal_type", "type_id", list(types), "text")
    return len(stages) + len(sources) + len(types)


def sync_users(conn: psycopg.Connection, client: BitrixClient) -> int:
    users = {}
    for active in (True, False):  # user.get без фильтра может отдавать только активных
        for page in client.iter_offset("user.get", {"filter": {"ACTIVE": active}}):
            for u in page:
                uid = to_int(u.get("ID"))
                if uid is None:
                    continue
                name, last = nz(u.get("NAME")), nz(u.get("LAST_NAME"))
                full = " ".join(p for p in (last, name) if p) or f"Пользователь {uid}"
                dept = u.get("UF_DEPARTMENT")
                users[uid] = (uid, full, name, last, nz(u.get("EMAIL")), to_bool(u.get("ACTIVE", active)),
                              nz(u.get("WORK_POSITION")),
                              Jsonb(dept) if isinstance(dept, list) else None)

    with conn.transaction():
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO dim_user (id, full_name, name, last_name, email, is_active, work_position, "
                "department_ids) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO UPDATE SET "
                "full_name = EXCLUDED.full_name, name = EXCLUDED.name, last_name = EXCLUDED.last_name, "
                "email = EXCLUDED.email, is_active = EXCLUDED.is_active, "
                "work_position = EXCLUDED.work_position, department_ids = EXCLUDED.department_ids, "
                "updated_at = now()",
                list(users.values()),
            )
    return len(users)


def _label(value) -> str | None:
    if isinstance(value, dict):
        return nz(value.get("ru")) or next((v for v in value.values() if nz(v)), None)
    return nz(value)


def sync_userfields(conn: psycopg.Connection, client: BitrixClient) -> int:
    fields = {}
    for page in client.iter_offset("crm.deal.userfield.list", {"order": {"SORT": "ASC"}}):
        for f in page:
            name = nz(f.get("FIELD_NAME"))
            if name is None:
                continue
            label = _label(f.get("EDIT_FORM_LABEL")) or _label(f.get("LIST_COLUMN_LABEL")) or name
            enum = f.get("LIST")
            fields[name] = (name, label, nz(f.get("USER_TYPE_ID")),
                            Jsonb(enum) if isinstance(enum, list) else None)

    with conn.transaction():
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO dim_userfield (field_name, label, user_type, enum_values) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT (field_name) DO UPDATE SET "
                "label = EXCLUDED.label, user_type = EXCLUDED.user_type, "
                "enum_values = EXCLUDED.enum_values, updated_at = now()",
                list(fields.values()),
            )
        _replace_missing(conn, "dim_userfield", "field_name", list(fields), "text")
    return len(fields)


def sync_dictionaries(conn: psycopg.Connection, client: BitrixClient) -> int:
    total = 0
    for step in (sync_categories, sync_statuses, sync_users, sync_userfields):
        n = step(conn, client)
        log.info("%s: %d строк", step.__name__, n)
        total += n
    return total
