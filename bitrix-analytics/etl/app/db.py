"""Подключение к PostgreSQL, миграции, служебные таблицы (состояние и журнал синхронизации)."""
from __future__ import annotations

import logging
import time
from pathlib import Path

import psycopg

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def connect(database_url: str, attempts: int = 30, delay: float = 2.0) -> psycopg.Connection:
    """Подключается к БД (autocommit; транзакции — явно через conn.transaction()), ожидая её старта."""
    for attempt in range(1, attempts + 1):
        try:
            return psycopg.connect(database_url, autocommit=True)
        except psycopg.OperationalError as e:
            if attempt == attempts:
                raise
            log.warning("БД недоступна (%s), попытка %d/%d", str(e).strip(), attempt, attempts)
            time.sleep(delay)
    raise AssertionError("unreachable")


def apply_migrations(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Применяет по порядку ещё не применённые *.sql. Возвращает список применённых версий."""
    with conn.cursor() as cur:
        cur.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        cur.execute("SELECT version FROM schema_migrations")
        done = {row[0] for row in cur.fetchall()}
    conn.commit()

    applied = []
    for path in sorted(directory.glob("*.sql")):
        if path.stem in done:
            continue
        with conn.transaction():
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (path.stem,))
        log.info("Применена миграция %s", path.name)
        applied.append(path.stem)
    return applied


def get_state(conn: psycopg.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM sync_state WHERE key = %s", (key,)).fetchone()
    return row[0] if row else None


def set_state(conn: psycopg.Connection, key: str, value: str) -> None:
    """Записывает состояние. Коммит делает вызывающий (вместе с данными)."""
    conn.execute(
        "INSERT INTO sync_state (key, value) VALUES (%s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
        (key, value),
    )


def clear_state(conn: psycopg.Connection, key: str) -> None:
    conn.execute("DELETE FROM sync_state WHERE key = %s", (key,))


def start_log(conn: psycopg.Connection, entity: str, mode: str) -> int:
    row = conn.execute(
        "INSERT INTO sync_log (entity, mode) VALUES (%s, %s) RETURNING id", (entity, mode)
    ).fetchone()
    conn.commit()
    return row[0]


def finish_log(
    conn: psycopg.Connection, log_id: int, status: str, rows: int = 0, error: str | None = None
) -> None:
    conn.execute(
        "UPDATE sync_log SET status = %s, finished_at = now(), rows_processed = %s, error = %s "
        "WHERE id = %s",
        (status, rows, error, log_id),
    )
    conn.commit()
