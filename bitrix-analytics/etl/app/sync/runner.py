"""Запуск шагов синхронизации с записью в sync_log. Ошибка одного шага не останавливает остальные."""
from __future__ import annotations

import logging
import threading
import traceback
from typing import Callable

import psycopg

from .. import db
from ..bitrix.client import BitrixClient
from ..config import Settings
from . import deals, stage_history
from .dictionaries import sync_dictionaries

log = logging.getLogger(__name__)

# Одновременно может идти только одна синхронизация (плановая, ручная или сверка удалённых)
_lock = threading.Lock()


def _run_step(conn: psycopg.Connection, entity: str, mode: str, fn: Callable[[], tuple[str, int] | int]) -> bool:
    log_id = db.start_log(conn, entity, mode)
    try:
        result = fn()
        real_mode, rows = result if isinstance(result, tuple) else (mode, result)
        conn.execute("UPDATE sync_log SET mode = %s WHERE id = %s", (real_mode, log_id))
        db.finish_log(conn, log_id, "ok", rows)
        log.info("%s: готово (%s, %d строк)", entity, real_mode, rows)
        return True
    except Exception as e:  # noqa: BLE001 — любая ошибка шага должна попасть в журнал
        log.error("%s: ошибка: %s\n%s", entity, e, traceback.format_exc())
        db.finish_log(conn, log_id, "error", 0, f"{type(e).__name__}: {e}")
        return False


def run_sync(settings: Settings, client: BitrixClient, full: bool = False) -> bool:
    """Справочники → сделки → история стадий. Возвращает True, если все шаги прошли."""
    if not _lock.acquire(blocking=False):
        log.warning("Синхронизация уже выполняется, пропуск")
        return False
    try:
        conn = db.connect(settings.database_url)
        try:
            db.apply_migrations(conn)
            mode = "full" if full else "auto"
            ok = _run_step(conn, "dictionaries", mode, lambda: ("full", sync_dictionaries(conn, client)))
            ok &= _run_step(
                conn, "deals", mode,
                lambda: deals.sync_deals(conn, client, settings.modify_overlap_minutes, full=full),
            )
            ok &= _run_step(
                conn, "stage_history", mode,
                lambda: stage_history.sync_stage_history(conn, client, full=full),
            )
            return ok
        finally:
            conn.close()
    finally:
        _lock.release()


def run_reconcile(settings: Settings, client: BitrixClient) -> bool:
    """Сверка списка сделок для поиска удалённых в Битриксе."""
    if not _lock.acquire(blocking=False):
        log.warning("Синхронизация уже выполняется, сверка пропущена")
        return False
    try:
        conn = db.connect(settings.database_url)
        try:
            db.apply_migrations(conn)
            return _run_step(
                conn, "deals_reconcile", "full",
                lambda: ("full", deals.reconcile_deleted(conn, client)),
            )
        finally:
            conn.close()
    finally:
        _lock.release()
