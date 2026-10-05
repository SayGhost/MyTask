"""Настройки ETL из переменных окружения (см. .env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import quote


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Settings:
    webhook_url: str
    database_url: str
    sync_interval_minutes: int = 10
    reconcile_hour: int = 3
    min_request_interval: float = 0.5
    modify_overlap_minutes: int = 10

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env

        webhook = env.get("BITRIX_WEBHOOK_URL", "").strip()
        if not webhook:
            raise ConfigError("Не задан BITRIX_WEBHOOK_URL (см. docs/BITRIX_WEBHOOK.md)")
        if "/rest/" not in webhook:
            raise ConfigError("BITRIX_WEBHOOK_URL должен иметь вид https://<портал>/rest/<id>/<код>/")
        if not webhook.endswith("/"):
            webhook += "/"

        database_url = env.get("DATABASE_URL", "").strip()
        if not database_url:
            try:
                user = quote(env["POSTGRES_USER"], safe="")
                password = quote(env["POSTGRES_PASSWORD"], safe="")
                name = env["POSTGRES_DB"]
            except KeyError as e:
                raise ConfigError(f"Не задана переменная {e.args[0]}") from None
            host = env.get("POSTGRES_HOST", "localhost")
            port = env.get("POSTGRES_PORT", "5432")
            database_url = f"postgresql://{user}:{password}@{host}:{port}/{name}"

        return cls(
            webhook_url=webhook,
            database_url=database_url,
            sync_interval_minutes=int(env.get("SYNC_INTERVAL_MINUTES", "10")),
            reconcile_hour=int(env.get("RECONCILE_HOUR", "3")),
            min_request_interval=float(env.get("BITRIX_MIN_INTERVAL_SEC", "0.5")),
            modify_overlap_minutes=int(env.get("MODIFY_OVERLAP_MINUTES", "10")),
        )
