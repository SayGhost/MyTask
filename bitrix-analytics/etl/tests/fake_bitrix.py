"""Поддельный сервер Битрикс24 для тестов: понимает постраничную выгрузку и фильтры, которые использует ETL."""
from __future__ import annotations

import json
from datetime import datetime

import httpx


class FakeBitrix:
    def __init__(self, page_size: int = 2):
        self.page_size = page_size
        self.deals: list[dict] = []
        self.history: list[dict] = []
        self.statuses: list[dict] = []
        self.users: list[dict] = []
        self.userfields: list[dict] = []
        self.contacts: list[dict] = []
        self.contact_userfields: list[dict] = []
        self.categories: list[dict] = [{"id": 1, "name": "Продажи", "sort": 100, "isDefault": False}]
        self.calls: list[tuple[str, dict]] = []
        self.fail_next = 0  # столько ближайших вызовов вернут 503 QUERY_LIMIT_EXCEEDED
        self.transport = httpx.MockTransport(self._handle)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=self.transport)

    # --- обработчик ------------------------------------------------------

    def _handle(self, request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1].removesuffix(".json")
        params = json.loads(request.content or b"{}")
        self.calls.append((method, params))

        if self.fail_next:
            self.fail_next -= 1
            return httpx.Response(503, json={"error": "QUERY_LIMIT_EXCEEDED", "error_description": "Too many requests"})

        handler = getattr(self, "m_" + method.replace(".", "_"), None)
        if handler is None:
            return httpx.Response(400, json={"error": "ERROR_METHOD_NOT_FOUND", "error_description": method})
        return httpx.Response(200, json=handler(params))

    # --- помощники ---------------------------------------------------------

    def _keyset(self, rows: list[dict], params: dict, result_key: str | None):
        flt = params.get("filter", {})
        after = int(flt.get(">ID", 0))
        since = flt.get(">=DATE_MODIFY")
        out = [r for r in sorted(rows, key=lambda r: int(r["ID"])) if int(r["ID"]) > after]
        if since:
            threshold = datetime.fromisoformat(since)
            out = [r for r in out if datetime.fromisoformat(r["DATE_MODIFY"]) >= threshold]
        page = out[: self.page_size]
        select = params.get("select")
        if select and "*" not in select:
            page = [{k: v for k, v in r.items() if k in select} for r in page]
        result = {result_key: page} if result_key else page
        return {"result": result}

    def _offset(self, rows: list[dict], params: dict):
        start = int(params.get("start", 0))
        page = rows[start : start + self.page_size]
        data = {"result": page, "total": len(rows)}
        if start + self.page_size < len(rows):
            data["next"] = start + self.page_size
        return data

    # --- методы REST -------------------------------------------------------

    def m_crm_deal_list(self, params):
        return self._keyset(self.deals, params, None)

    def m_crm_contact_list(self, params):
        return self._keyset(self.contacts, params, None)

    def m_crm_contact_userfield_list(self, params):
        return self._offset(self.contact_userfields, params)

    def m_crm_stagehistory_list(self, params):
        return self._keyset(self.history, params, "items")

    def m_crm_category_list(self, params):
        return {"result": {"categories": self.categories, "total": len(self.categories)}}

    def m_crm_status_list(self, params):
        return self._offset(self.statuses, params)

    def m_user_get(self, params):
        active = params.get("filter", {}).get("ACTIVE")
        return self._offset([u for u in self.users if u["ACTIVE"] == active], params)

    def m_crm_deal_userfield_list(self, params):
        return self._offset(self.userfields, params)


def contact(id: int, modified: str = "2025-03-01T10:00:00+03:00", **extra) -> dict:
    base = {
        "ID": str(id), "NAME": "Иван", "LAST_NAME": "Иванов", "PHONE": [{"VALUE": "+70000000000"}],
        "EMAIL": [{"VALUE": "x@example.com"}], "TYPE_ID": "CLIENT", "SOURCE_ID": "WEB",
        "ASSIGNED_BY_ID": "5", "COMPANY_ID": "0", "LEAD_ID": None,
        "DATE_CREATE": "2025-02-01T09:00:00+03:00", "DATE_MODIFY": modified,
        "UF_CRM_CITY": "Казань",
    }
    base.update(extra)
    return base


def deal(id: int, modified: str = "2025-03-01T10:00:00+03:00", **extra) -> dict:
    base = {
        "ID": str(id), "TITLE": f"Сделка {id}", "CATEGORY_ID": "1", "STAGE_ID": "C1:NEW",
        "STAGE_SEMANTIC_ID": "P", "CLOSED": "N", "OPPORTUNITY": "1000.00", "CURRENCY_ID": "RUB",
        "ASSIGNED_BY_ID": "5", "CREATED_BY_ID": "5", "SOURCE_ID": "WEB", "TYPE_ID": "SALE",
        "COMPANY_ID": "0", "CONTACT_ID": "7", "LEAD_ID": None,
        "BEGINDATE": "2025-03-01T03:00:00+03:00", "DATE_CREATE": "2025-03-01T09:00:00+03:00",
        "DATE_MODIFY": modified, "CLOSEDATE": "2025-03-31T03:00:00+03:00",
        "UTM_SOURCE": "google", "UTM_MEDIUM": "cpc", "UTM_CAMPAIGN": "", "UTM_CONTENT": None, "UTM_TERM": None,
        "UF_CRM_REGION": "Москва",
    }
    base.update(extra)
    return base
