"""Чтение CSV-выгрузки Битрикс24 в компактные записи для дашборда.

Из файла берутся только колонки из settings.COLUMNS. Личные данные не читаются.
"""
from __future__ import annotations

import csv
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import settings

# Порядок значений в записи (он же порядок в JSON). Все флаги: 1 или 0.
FIELDS = ["created", "source", "isNew", "webinar", "reached", "qual", "mc"]

_DATE_RE = re.compile(r"^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})")


class LoadError(Exception):
    """Понятная пользователю ошибка (файл не найден, нет нужной колонки)."""


@dataclass
class LoadResult:
    rows: list[list] = field(default_factory=list)
    meta: dict = field(default_factory=dict)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip().casefold()


def parse_date(value: str) -> str | None:
    """'05.10.2026 17:09' → '2026-10-05'. Пустое или нечитаемое → None."""
    m = _DATE_RE.match(value or "")
    if not m:
        return None
    day, month, year = (int(g) for g in m.groups())
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def detect_encoding(path: Path) -> str:
    raw = path.read_bytes()[:2_000_000]
    for enc in ("utf-8-sig", "cp1251"):
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError as e:
            # обрыв на границе среза — не ошибка кодировки
            if e.start >= len(raw) - 4:
                return enc
    raise LoadError("Не удалось определить кодировку файла (ожидается UTF-8 или Windows-1251).")


def detect_delimiter(path: Path, encoding: str) -> str:
    with path.open(encoding=encoding, newline="") as f:
        first = f.readline()
    return max(";,\t", key=first.count)


def resolve_columns(header: list[str], wanted: dict[str, str]) -> tuple[dict[str, int], list[str]]:
    """Находит номера нужных колонок. Если названий несколько, берётся первая колонка."""
    positions: dict[str, list[int]] = {}
    for i, h in enumerate(header):
        positions.setdefault(_norm(h), []).append(i)

    resolved, warnings, missing = {}, [], []
    for key, title in wanted.items():
        found = positions.get(_norm(title))
        if not found:
            missing.append(title)
            continue
        resolved[key] = found[0]
        if len(found) > 1:
            warnings.append(f"Колонка «{title}» встречается {len(found)} раза, использована первая (№{found[0] + 1}).")
    if missing:
        raise LoadError(
            "В выгрузке нет колонок: " + ", ".join(f"«{m}»" for m in missing)
            + ". Проверьте названия в файле settings.py."
        )
    return resolved, warnings


def latest_csv(directory: Path) -> Path:
    files = sorted(directory.glob("*.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise LoadError(f"В папке {directory} нет файлов .csv. Положите туда выгрузку сделок из Битрикс24.")
    return files[0]


def load_deals(path: Path) -> LoadResult:
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    encoding = detect_encoding(path)
    delimiter = detect_delimiter(path, encoding)
    cols = settings.COLUMNS
    yes = _norm(settings.YES_VALUE)
    new_value = _norm(settings.NEW_DEAL_VALUE)

    result = LoadResult()
    total = skipped = 0
    with path.open(encoding=encoding, newline="") as f:
        reader = csv.reader(f, delimiter=delimiter)
        try:
            header = next(reader)
        except StopIteration:
            raise LoadError("Файл пустой.") from None
        idx, warnings = resolve_columns(header, cols)

        def cell(row: list[str], key: str) -> str:
            i = idx[key]
            return row[i] if i < len(row) else ""

        for row in reader:
            if not any(row):
                continue
            total += 1
            created = parse_date(cell(row, "created"))
            if created is None:
                skipped += 1
                continue
            source = cell(row, "source").strip() or settings.NO_SOURCE_LABEL
            reached = bool(cell(row, "dialog").strip()) or any(
                _norm(cell(row, k)) == yes for k in ("call1", "call2", "call3")
            )
            result.rows.append([
                created,
                source,
                int(_norm(cell(row, "deal_type")) == new_value),
                int(bool(cell(row, "webinar").strip())),
                int(reached),
                int(bool(cell(row, "qual").strip())),
                int(bool(cell(row, "mc").strip())),
            ])

    dates = [r[0] for r in result.rows]
    result.meta = {
        "file": path.name,
        "rowsTotal": total,
        "rowsUsed": len(result.rows),
        "rowsSkipped": skipped,
        "dateMin": min(dates) if dates else None,
        "dateMax": max(dates) if dates else None,
        "warnings": warnings,
        "columns": {k: cols[k] for k in cols},
    }
    return result
