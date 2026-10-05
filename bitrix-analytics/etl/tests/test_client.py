import httpx
import pytest

from app.bitrix.client import BitrixClient, BitrixError
from tests.fake_bitrix import FakeBitrix, deal

URL = "https://example.bitrix24.ru/rest/1/secret/"


def make_client(fake: FakeBitrix, **kw):
    sleeps: list[float] = []
    client = BitrixClient(URL, http=fake.client(), sleep=sleeps.append, **kw)
    return client, sleeps


def test_keyset_pagination_walks_all_pages_in_id_order():
    fake = FakeBitrix(page_size=2)
    fake.deals = [deal(i) for i in (5, 1, 3, 2, 4)]
    client, _ = make_client(fake, min_interval=0)

    pages = list(client.iter_keyset("crm.deal.list", {"select": ["*"]}))

    assert [[d["ID"] for d in p] for p in pages] == [["1", "2"], ["3", "4"], ["5"]]
    # последний запрос — пустая страница, остальные идут с фильтром >ID
    assert fake.calls[1][1]["filter"] == {">ID": 2}
    assert fake.calls[0][1]["start"] == -1


def test_keyset_keeps_base_filter_and_result_key():
    fake = FakeBitrix(page_size=10)
    fake.history = [{"ID": str(i)} for i in range(1, 4)]
    client, _ = make_client(fake, min_interval=0)

    pages = list(client.iter_keyset("crm.stagehistory.list", {"entityTypeId": 2}, result_key="items", after=1, no_count=False))

    assert [i["ID"] for p in pages for i in p] == ["2", "3"]
    assert fake.calls[0][1]["entityTypeId"] == 2
    assert "start" not in fake.calls[0][1]


def test_offset_pagination_follows_next():
    fake = FakeBitrix(page_size=2)
    fake.statuses = [{"STATUS_ID": str(i)} for i in range(5)]
    client, _ = make_client(fake, min_interval=0)

    pages = list(client.iter_offset("crm.status.list"))

    assert [len(p) for p in pages] == [2, 2, 1]


def test_retries_on_rate_limit_then_succeeds():
    fake = FakeBitrix()
    fake.fail_next = 2
    client, sleeps = make_client(fake, min_interval=0)

    data = client.call("crm.category.list", {"entityTypeId": 2})

    assert "result" in data
    assert sleeps == [2, 4]  # экспоненциальная пауза


def test_gives_up_after_max_retries():
    fake = FakeBitrix()
    fake.fail_next = 99
    client, _ = make_client(fake, min_interval=0, max_retries=2)

    with pytest.raises(BitrixError) as e:
        client.call("crm.category.list")
    assert e.value.code == "RETRIES_EXHAUSTED"
    assert len(fake.calls) == 3


def test_non_retryable_error_raises_immediately():
    fake = FakeBitrix()
    client, _ = make_client(fake, min_interval=0)

    with pytest.raises(BitrixError) as e:
        client.call("no.such.method")
    assert e.value.code == "ERROR_METHOD_NOT_FOUND"
    assert len(fake.calls) == 1


def test_network_error_is_retried():
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("boom")
        return httpx.Response(200, json={"result": []})

    client = BitrixClient(URL, http=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda s: None, min_interval=0)
    assert client.call("user.get") == {"result": []}
    assert len(calls) == 2


def test_throttle_enforces_min_interval():
    fake = FakeBitrix()
    now = [100.0]
    sleeps: list[float] = []

    def sleep(s):
        sleeps.append(s)
        now[0] += s

    client = BitrixClient(URL, min_interval=0.5, http=fake.client(), sleep=sleep, clock=lambda: now[0])
    client.call("crm.category.list")
    now[0] += 0.1  # между вызовами прошло только 0.1 с
    client.call("crm.category.list")

    assert sleeps == [pytest.approx(0.4)]
