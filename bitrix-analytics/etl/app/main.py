"""Точка входа ETL.

  python -m app.main               — работать постоянно: синхронизация по расписанию
  python -m app.main --once        — один проход и выход
  python -m app.main --once --full — один полный проход с нуля (сбросить отметки инкремента)
  python -m app.main --reconcile   — сверка удалённых сделок и выход
"""
from __future__ import annotations

import argparse
import logging
import sys

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from .bitrix.client import BitrixClient
from .config import ConfigError, Settings
from .sync.runner import run_reconcile, run_sync

log = logging.getLogger("etl")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Синхронизация Битрикс24 → PostgreSQL")
    parser.add_argument("--once", action="store_true", help="один проход и выход")
    parser.add_argument("--full", action="store_true", help="полная перезагрузка (с --once)")
    parser.add_argument("--reconcile", action="store_true", help="сверка удалённых сделок и выход")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # иначе в логи попадает URL вебхука с секретом
    try:
        settings = Settings.from_env()
    except ConfigError as e:
        log.error("Ошибка настройки: %s", e)
        return 2

    client = BitrixClient(settings.webhook_url, min_interval=settings.min_request_interval)

    if args.reconcile:
        return 0 if run_reconcile(settings, client) else 1
    if args.once:
        return 0 if run_sync(settings, client, full=args.full) else 1

    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(
        run_sync, IntervalTrigger(minutes=settings.sync_interval_minutes), args=[settings, client],
        id="sync", max_instances=1, coalesce=True,
    )
    scheduler.add_job(
        run_reconcile, CronTrigger(hour=settings.reconcile_hour, minute=30), args=[settings, client],
        id="reconcile", max_instances=1, coalesce=True,
    )
    log.info("Старт: синхронизация каждые %d мин, сверка удалённых в %02d:30 UTC",
             settings.sync_interval_minutes, settings.reconcile_hour)
    try:
        run_sync(settings, client)  # первый проход сразу при старте
    except Exception:  # noqa: BLE001 — недоступная БД не должна ронять планировщик
        log.exception("Первый проход не удался, продолжаю по расписанию")
    scheduler.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
