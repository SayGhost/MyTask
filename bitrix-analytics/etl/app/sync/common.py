"""Преобразование значений из Битрикс24 к типам БД."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any


def g(item: dict, *keys: str) -> Any:
    """Первое найденное значение по ключам (Битрикс отдаёт то ID, то id в разных методах)."""
    for key in keys:
        if key in item:
            return item[key]
    return None


def nz(value: Any) -> Any:
    """Пустые строки и None → None."""
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    return value


def to_int(value: Any) -> int | None:
    value = nz(value)
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def to_id(value: Any) -> int | None:
    """Ссылки на сущности: 0 означает «не задано»."""
    v = to_int(value)
    return v or None


def to_decimal(value: Any) -> Decimal | None:
    value = nz(value)
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def parse_dt(value: Any) -> datetime | None:
    value = nz(value)
    if value is None:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def to_bool(value: Any) -> bool:
    return value in (True, "Y", "y", "true", "True", 1, "1")
