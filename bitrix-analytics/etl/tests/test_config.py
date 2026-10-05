import pytest

from app.config import ConfigError, Settings


def test_builds_database_url_and_quotes_password():
    s = Settings.from_env({
        "BITRIX_WEBHOOK_URL": "https://p.bitrix24.ru/rest/1/abc",
        "POSTGRES_USER": "u", "POSTGRES_PASSWORD": "p@ss/word", "POSTGRES_DB": "d", "POSTGRES_HOST": "db",
    })
    assert s.webhook_url == "https://p.bitrix24.ru/rest/1/abc/"
    assert s.database_url == "postgresql://u:p%40ss%2Fword@db:5432/d"


def test_explicit_database_url_wins():
    s = Settings.from_env({"BITRIX_WEBHOOK_URL": "https://p.bitrix24.ru/rest/1/abc/", "DATABASE_URL": "postgresql://x/y"})
    assert s.database_url == "postgresql://x/y"


@pytest.mark.parametrize("env", [
    {},
    {"BITRIX_WEBHOOK_URL": "https://p.bitrix24.ru/"},
    {"BITRIX_WEBHOOK_URL": "https://p.bitrix24.ru/rest/1/abc/"},  # нет данных для БД
])
def test_invalid_config(env):
    with pytest.raises(ConfigError):
        Settings.from_env(env)
