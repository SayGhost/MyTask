"""Чтение CSV-выгрузки Битрикс24 в компактные записи для дашборда.

Из файла берутся только колонки из settings.COLUMNS и settings.OPTIONAL_COLUMNS.
Личные данные не читаются.
"""
from __future__ import annotations

import csv
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import settings

# Порядок значений в записи (он же порядок в JSON).
FIELDS = [
    "created", "group", "source", "isNew", "webinar", "reached", "qual", "mc", "mcRequest", "failed",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "reason", "stars", "grade", "band", "segment", "portrait",
]
# Строковые поля хранятся в словаре, а в строках лежат только номера (меньше размер и быстрее).
STRING_FIELDS = [f for f in FIELDS if f not in ("isNew", "webinar", "reached", "qual", "mc", "mcRequest", "failed")]

_DATE_RE = re.compile(r"^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})")


class LoadError(Exception):
    """Понятная пользователю ошибка (файл не найден, нет нужной колонки)."""


@dataclass
class LoadResult:
    rows: list[list] = field(default_factory=list)
    dicts: dict[str, list[str]] = field(default_factory=dict)
    meta: dict = field(default_factory=dict)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ")).strip().casefold()


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


def classify_source(name: str) -> str:
    low = _norm(name)
    for group, fragments in settings.SOURCE_GROUPS:
        if any(_norm(f) in low for f in fragments):
            return group
    return settings.OTHER_GROUP


def _strip_ml(reason: str) -> str:
    r = _norm(reason)
    return r[3:].strip() if r.startswith("мл ") else r


def is_reached(status: str, reason: str) -> bool:
    """Правило «Дозвонились» (см. settings.py)."""
    st = (status or "").replace("\xa0", " ").strip()
    if any(st.startswith(p) for p in settings.REACHED_STATUS_PREFIXES):
        return True
    if _norm(st) in {_norm(x) for x in settings.REACHED_STATUS_EXACT}:
        return True
    if _norm(st) == _norm(settings.FAILED_STATUS):
        if not (reason or "").strip():
            return False  # как в исходном SQL: пустая причина не считается «дозвонился»
        r = _strip_ml(reason)
        for item in settings.NOT_REACHED_REASONS:
            i = _norm(item)
            if r == i or r.startswith(i + "/"):
                return False
        return True
    return False


def score_band(value: str) -> str:
    try:
        n = int(float((value or "").replace(",", ".")))
    except ValueError:
        return ""
    for lo, hi, label in settings.SCORE_BANDS:
        if lo <= n <= hi:
            return label
    return ""


def detect_encoding(path: Path) -> str:
    raw = path.read_bytes()[:2_000_000]
    for enc in ("utf-8-sig", "cp1251"):
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError as e:
            if e.start >= len(raw) - 4:  # обрыв на границе среза — не ошибка кодировки
                return enc
    raise LoadError("Не удалось определить кодировку файла (ожидается UTF-8 или Windows-1251).")


def detect_delimiter(path: Path, encoding: str) -> str:
    with path.open(encoding=encoding, newline="") as f:
        first = f.readline()
    return max(";,\t", key=first.count)


def resolve_columns(header: list[str], wanted: dict[str, str]) -> tuple[dict[str, int], list[str], list[str]]:
    """Находит номера колонок. Возвращает (найденные, предупреждения, не найденные названия)."""
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
    return resolved, warnings, missing


def latest_csv(directory: Path) -> Path:
    files = sorted(directory.glob("*.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise LoadError(f"В папке {directory} нет файлов .csv. Положите туда выгрузку сделок из Битрикс24.")
    return files[0]


def load_deals(path: Path) -> LoadResult:
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    encoding = detect_encoding(path)
    delimiter = detect_delimiter(path, encoding)

    result = LoadResult()
    total = skipped = 0
    with path.open(encoding=encoding, newline="") as f:
        reader = csv.reader(f, delimiter=delimiter)
        try:
            header = next(reader)
        except StopIteration:
            raise LoadError("Файл пустой.") from None
        idx, warnings, missing = resolve_columns(header, settings.COLUMNS)
        if missing:
            raise LoadError(
                "В выгрузке нет колонок: " + ", ".join(f"«{m}»" for m in missing)
                + ". Проверьте названия в файле settings.py."
            )
        opt_idx, opt_warnings, opt_missing = resolve_columns(header, settings.OPTIONAL_COLUMNS)
        idx.update(opt_idx)
        warnings += opt_warnings
        if opt_missing:
            warnings.append("Нет необязательных колонок (блоки по ним будут пустыми): " + ", ".join(f"«{m}»" for m in opt_missing) + ".")

        def cell(row: list[str], key: str) -> str:
            i = idx.get(key)
            return row[i].strip() if i is not None and i < len(row) else ""

        new_value = _norm(settings.NEW_DEAL_VALUE)
        failed_value = _norm(settings.FAILED_STATUS)
        for row in reader:
            if not any(row):
                continue
            total += 1
            created = parse_date(cell(row, "created"))
            if created is None:
                skipped += 1
                continue
            source = cell(row, "source") or settings.NO_SOURCE_LABEL
            status, reason = cell(row, "status"), cell(row, "reason")
            portrait = cell(row, "portrait")
            result.rows.append([
                created,
                classify_source(source),
                source,
                int(_norm(cell(row, "deal_type")) == new_value),
                int(bool(cell(row, "webinar"))),
                int(is_reached(status, reason)),
                int(bool(cell(row, "qual"))),
                int(bool(cell(row, "mc"))),
                int(bool(cell(row, "mc_request"))),
                int(_norm(status) == failed_value),
                cell(row, "utm_source"), cell(row, "utm_medium"), cell(row, "utm_campaign"),
                cell(row, "utm_content"), cell(row, "utm_term"),
                reason, cell(row, "stars"), cell(row, "grade"), score_band(cell(row, "score")),
                cell(row, "segment"), portrait,
            ])

    # Словарное кодирование строковых полей
    for name in STRING_FIELDS:
        i = FIELDS.index(name)
        table: dict[str, int] = {}
        for r in result.rows:
            r[i] = table.setdefault(r[i], len(table))
        result.dicts[name] = list(table)

    dates = [result.dicts["created"][r[0]] for r in result.rows]
    result.meta = {
        "file": path.name,
        "rowsTotal": total,
        "rowsUsed": len(result.rows),
        "rowsSkipped": skipped,
        "dateMin": min(dates) if dates else None,
        "dateMax": max(dates) if dates else None,
        "warnings": warnings,
        "groups": [g for g, _ in settings.SOURCE_GROUPS] + [settings.OTHER_GROUP],
    }
    return result
