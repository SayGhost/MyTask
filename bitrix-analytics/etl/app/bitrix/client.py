"""Клиент REST API Битрикс24 (входящий вебхук): троттлинг, ретраи, постраничная выгрузка."""
from __future__ import annotations

import logging
import time
from typing import Any, Callable, Iterator

import httpx

log = logging.getLogger(__name__)

# Ошибки, после которых запрос имеет смысл повторить
RETRYABLE_ERRORS = {"QUERY_LIMIT_EXCEEDED", "OPERATION_TIME_LIMIT", "INTERNAL_SERVER_ERROR"}


class BitrixError(Exception):
    def __init__(self, code: str, description: str = "", method: str = ""):
        self.code = code
        self.description = description
        self.method = method
        super().__init__(f"{method}: {code} {description}".strip())


def _extract(result: Any, result_key: str | None) -> list[dict]:
    if result_key and isinstance(result, dict):
        return result.get(result_key) or []
    if isinstance(result, list):
        return result
    return []


class BitrixClient:
    def __init__(
        self,
        webhook_url: str,
        min_interval: float = 0.5,
        max_retries: int = 5,
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.base_url = webhook_url if webhook_url.endswith("/") else webhook_url + "/"
        self.min_interval = min_interval
        self.max_retries = max_retries
        self._http = http or httpx.Client(timeout=60)
        self._sleep = sleep
        self._clock = clock
        self._last_call: float | None = None

    # --- низкий уровень ---------------------------------------------------

    def _throttle(self) -> None:
        if self._last_call is not None:
            wait = self.min_interval - (self._clock() - self._last_call)
            if wait > 0:
                self._sleep(wait)
        self._last_call = self._clock()

    def call(self, method: str, params: dict | None = None) -> dict:
        """Вызывает метод REST, возвращает весь JSON-ответ (result, next, total...)."""
        url = f"{self.base_url}{method}.json"
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            if attempt:
                backoff = min(2 ** attempt, 60)
                log.warning("%s: повтор %d/%d через %ds (%s)", method, attempt, self.max_retries, backoff, last_error)
                self._sleep(backoff)
            self._throttle()
            try:
                resp = self._http.post(url, json=params or {})
            except httpx.TransportError as e:
                last_error = e
                continue

            try:
                data = resp.json()
            except ValueError:
                data = None

            if isinstance(data, dict) and "error" in data:
                code = str(data["error"])
                if code in RETRYABLE_ERRORS or resp.status_code in (429, 502, 503, 504):
                    last_error = BitrixError(code, data.get("error_description", ""), method)
                    continue
                raise BitrixError(code, data.get("error_description", ""), method)
            if resp.status_code >= 500 or resp.status_code == 429:
                last_error = RuntimeError(f"HTTP {resp.status_code}")
                continue
            if resp.status_code >= 400 or not isinstance(data, dict):
                raise BitrixError(f"HTTP_{resp.status_code}", resp.text[:200], method)
            return data
        raise BitrixError("RETRIES_EXHAUSTED", str(last_error), method)

    # --- постраничная выгрузка ---------------------------------------------

    def iter_offset(
        self, method: str, params: dict | None = None, result_key: str | None = None
    ) -> Iterator[list[dict]]:
        """Классическая пагинация start/next (для небольших списков: справочники, пользователи)."""
        start = 0
        while True:
            data = self.call(method, {**(params or {}), "start": start})
            items = _extract(data.get("result"), result_key)
            if items:
                yield items
            if "next" not in data:
                return
            start = data["next"]

    def iter_keyset(
        self,
        method: str,
        params: dict | None = None,
        result_key: str | None = None,
        after: int = 0,
        no_count: bool = True,
        id_field: str = "ID",
    ) -> Iterator[list[dict]]:
        """Выгрузка по возрастанию ID: каждая страница запрашивается с фильтром `>ID`.

        Не замедляется на больших объёмах (в отличие от start=N). `no_count` отключает подсчёт
        общего числа записей (start=-1), для методов, которые это поддерживают.
        """
        params = params or {}
        last = after
        while True:
            page_params = {
                **params,
                "filter": {**params.get("filter", {}), f">{id_field}": last},
                "order": {id_field: "ASC"},
            }
            if no_count:
                page_params["start"] = -1
            data = self.call(method, page_params)
            items = _extract(data.get("result"), result_key)
            if not items:
                return
            yield items
            last = max(int(item[id_field]) for item in items)
