import os

import pytest

from app import db
from app.bitrix.client import BitrixClient
from tests.fake_bitrix import FakeBitrix

TEST_DB = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture
def conn():
    """Чистая БД с применёнными миграциями (нужен TEST_DATABASE_URL, иначе тесты БД пропускаются)."""
    if not TEST_DB:
        pytest.skip("TEST_DATABASE_URL не задан")
    c = db.connect(TEST_DB, attempts=1)
    c.execute("DROP SCHEMA public CASCADE")
    c.execute("CREATE SCHEMA public")
    db.apply_migrations(c)
    yield c
    c.close()


@pytest.fixture
def fake():
    return FakeBitrix(page_size=2)


@pytest.fixture
def client(fake):
    return BitrixClient(
        "https://example.bitrix24.ru/rest/1/secret/", min_interval=0, http=fake.client(), sleep=lambda s: None
    )
