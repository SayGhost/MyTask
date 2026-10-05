"""Чтение CSV-выгрузки Битрикс24 в компактные записи для дашборда.

Из файла берутся только колонки из settings.COLUMNS и settings.OPTIONAL_COLUMNS.
Личные данные не читаются.
"""
from __future__ import annotations

import csv
import re
import sys
from collections import Counter
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

# События для «Общего» дашборда: одна строка = одно событие в жизни сделки.
# type: lead, qual, mc_booked, mc_held, mc_wait, sl_in, sl_out, sl_now, purchase, addon.
# date: дата события; lead: дата создания лида (когорта); amount: сумма покупки.
EVENT_FIELDS = ["type", "date", "lead", "group", "source", "isNew", "amount", "matMc", "matSl", "utm"]
EVENT_STRING_FIELDS = ["type", "date", "lead", "group", "source", "matMc", "matSl", "utm"]

_DATE_RE = re.compile(r"^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})")


class LoadError(Exception):
    """Понятная пользователю ошибка (файл не найден, нет нужной колонки)."""


@dataclass
class LoadResult:
    rows: list[list] = field(default_factory=list)
    dicts: dict[str, list[str]] = field(default_factory=dict)
    meta: dict = field(default_factory=dict)
    events: list[list] = field(default_factory=list)       # необработанные события (строки)
    event_dicts: dict[str, list[str]] = field(default_factory=dict)
    event_rows: list[list] = field(default_factory=list)   # события со словарным кодированием


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
        booked = {_norm(x) for x in settings.MC_BOOKED_STATUSES}
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
            group, is_new, utm = classify_source(source), int(_norm(cell(row, "deal_type")) == new_value), cell(row, "utm_source")
            result.events.append(["lead", created, created, group, source, is_new, 0, "", "", utm])
            qual_date = parse_date(cell(row, "qual"))
            if qual_date:
                result.events.append(["qual", qual_date, created, group, source, is_new, 0, "", "", utm])
            if _norm(status) in booked:
                booked_date = parse_date(cell(row, "close_date")) or parse_date(cell(row, "stage_changed"))
                if booked_date:
                    result.events.append(["mc_booked", booked_date, created, group, source, is_new, 0, cell(row, "mat_mc"), "", utm])
            result.rows.append([
                created,
                group,
                source,
                is_new,
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


# ---------- воронка «Продажи» ----------
def _norm_set(items) -> set[str]:
    return {_norm(x) for x in items}


def mc_not_held(reason: str, result: str) -> bool:
    """По причине отказа и «Итогу МС»: МС провести не удалось."""
    if _norm(reason) in _norm_set(settings.MC_NOT_HELD_REASONS):
        return True
    r = _norm(result)
    return any(r.startswith(_norm(p)) for p in settings.MC_NOT_HELD_RESULT_PREFIXES)


def parse_amount(value: str) -> float:
    v = (value or "").replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return round(float(v), 2)
    except ValueError:
        return 0.0


def load_sales(path: Path, as_of_min: str) -> LoadResult:
    """Выгрузка воронки «Продажи» → события (МС проведена/ожидает, SL, покупки).

    «Сегодня» (as_of) = самая поздняя дата создания в данных, но не раньше as_of_min.
    """
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    encoding = detect_encoding(path)
    delimiter = detect_delimiter(path, encoding)
    result = LoadResult()
    total = skipped = 0
    parsed: list[dict] = []
    with path.open(encoding=encoding, newline="") as f:
        reader = csv.reader(f, delimiter=delimiter)
        try:
            header = next(reader)
        except StopIteration:
            raise LoadError("Файл пустой.") from None
        idx, warnings, missing = resolve_columns(header, settings.SALES_COLUMNS)
        if missing:
            raise LoadError("В выгрузке «Продаж» нет колонок: " + ", ".join(f"«{m}»" for m in missing) + ". Проверьте названия в файле settings.py.")
        shared = {"source": settings.COLUMNS["source"], "deal_type": settings.COLUMNS["deal_type"], "utm_source": settings.OPTIONAL_COLUMNS["utm_source"]}
        for part in (shared, settings.SALES_OPTIONAL_COLUMNS):
            found, warn, miss = resolve_columns(header, part)
            idx.update(found); warnings += warn
            if miss and part is settings.SALES_OPTIONAL_COLUMNS:
                warnings.append("В выгрузке «Продаж» нет необязательных колонок (часть блоков будет пустой): " + ", ".join(f"«{m}»" for m in miss) + ".")

        def cell(row, key):
            i = idx.get(key)
            return row[i].strip() if i is not None and i < len(row) else ""

        for row in reader:
            if not any(row):
                continue
            total += 1
            created = parse_date(cell(row, "created"))
            if created is None:
                skipped += 1
                continue
            parsed.append({
                "created": created, "lead": parse_date(cell(row, "lead_created")) or created,
                "source": cell(row, "source") or settings.NO_SOURCE_LABEL, "type": cell(row, "deal_type"), "utm": cell(row, "utm_source"),
                "stage": cell(row, "stage"), "mc_date": parse_date(cell(row, "mc_date")), "mat_mc": cell(row, "mat_mc"), "mat_sl": cell(row, "mat_sl"),
                "sl": cell(row, "sl"), "sl_date": parse_date(cell(row, "sl_date")), "close": parse_date(cell(row, "close_date")),
                "amount": cell(row, "amount"), "reason": cell(row, "reason"), "result": cell(row, "mc_result"),
            })

    as_of = max([as_of_min] + [p["created"] for p in parsed])
    new_value, sl_yes, sl_no = _norm(settings.NEW_DEAL_VALUE), _norm(settings.SL_YES), _norm(settings.SL_NO)
    held_stages, wait_stages = _norm_set(settings.MC_HELD_STAGES), _norm_set(settings.MC_WAITING_STAGES)
    purchase, addon, refused = _norm(settings.PURCHASE_STAGE), _norm(settings.ADDON_STAGE), _norm(settings.REFUSED_STAGE)
    for p in parsed:
        group, is_new, stage = classify_source(p["source"]), int(_norm(p["type"]) == new_value), _norm(p["stage"])

        def ev(kind, date, amount=0.0):
            result.events.append([kind, date, p["lead"], group, p["source"], is_new, amount, p["mat_mc"], p["mat_sl"], p["utm"]])

        mc = p["mc_date"]
        if mc:
            if mc <= as_of:
                held = stage in held_stages or (stage == refused and not mc_not_held(p["reason"], p["result"]))
                if held:
                    ev("mc_held", mc)
                elif stage in wait_stages:
                    ev("mc_wait", mc)  # дата прошла, а МС не состоялась и сделка не движется
            elif stage in wait_stages or stage in held_stages:
                ev("mc_wait", mc)      # МС ещё впереди
        sl = _norm(p["sl"])
        if sl == sl_yes:
            ev("sl_now", p["sl_date"] or p["created"])
            if p["sl_date"]:
                ev("sl_in", p["sl_date"])
        elif sl == sl_no and p["sl_date"]:
            ev("sl_out", p["sl_date"])
        if stage in (purchase, addon):
            ev("purchase" if stage == purchase else "addon", p["close"] or p["created"], parse_amount(p["amount"]))
    result.meta = {"rowsTotal": total, "rowsUsed": total - skipped, "rowsSkipped": skipped, "warnings": warnings, "asOf": as_of}
    return result


# ---------- выбор файлов и сборка ----------
def detect_funnel(path: Path) -> str | None:
    """Название воронки по колонке «Воронка» (None, если колонки нет)."""
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    encoding = detect_encoding(path)
    with path.open(encoding=encoding, newline="") as f:
        reader = csv.reader(f, delimiter=detect_delimiter(path, encoding))
        header = next(reader, None)
        if not header:
            return None
        idx = next((i for i, x in enumerate(header) if _norm(x) == _norm(settings.FUNNEL_COLUMN)), None)
        if idx is None:
            return None
        for row in reader:
            if idx < len(row) and row[idx].strip():
                return row[idx].strip()
    return None


def choose_files(directory: Path) -> tuple[dict[str, Path], list[str]]:
    """Самый свежий файл для каждой воронки. Возвращает ({воронка: файл}, предупреждения)."""
    files = sorted(directory.glob("*.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise LoadError(f"В папке {directory} нет файлов .csv. Положите туда выгрузки сделок из Битрикс24 (воронки «Консультанты» и «Продажи»).")
    chosen: dict[str, Path] = {}
    warnings: list[str] = []
    known = {_norm(settings.CONSULT_FUNNEL): settings.CONSULT_FUNNEL, _norm(settings.SALES_FUNNEL): settings.SALES_FUNNEL}
    for p in files:
        name = detect_funnel(p)
        funnel = known.get(_norm(name)) if name else settings.CONSULT_FUNNEL  # без колонки «Воронка» считаем Консультантами
        if funnel is None:
            warnings.append(f"Файл {p.name}: воронка «{name}» не распознана, файл пропущен.")
        elif funnel in chosen:
            warnings.append(f"Для воронки «{funnel}» несколько файлов, взят самый свежий ({chosen[funnel].name}); {p.name} пропущен.")
        else:
            chosen[funnel] = p
    return chosen, warnings


def load_files(chosen: dict[str, Path], warnings: list[str] | None = None) -> LoadResult:
    """Собирает всё из выбранных файлов: записи для маркетинга и события для «Общего»."""
    cons_path = chosen.get(settings.CONSULT_FUNNEL)
    if cons_path is None:
        raise LoadError(f"Нужна выгрузка воронки «{settings.CONSULT_FUNNEL}» (в колонке «{settings.FUNNEL_COLUMN}» должно быть это значение).")
    result = load_deals(cons_path)
    as_of = result.meta["dateMax"]
    files = [{"name": cons_path.name, "funnel": settings.CONSULT_FUNNEL, "rows": result.meta["rowsUsed"]}]
    warnings = list(warnings or [])
    sales_path = chosen.get(settings.SALES_FUNNEL)
    if sales_path is not None:
        sales = load_sales(sales_path, as_of)
        as_of = sales.meta["asOf"]
        result.events += sales.events
        warnings += sales.meta["warnings"]
        files.append({"name": sales_path.name, "funnel": settings.SALES_FUNNEL, "rows": sales.meta["rowsUsed"]})
    else:
        warnings.append(f"Нет выгрузки воронки «{settings.SALES_FUNNEL}»: блоки «МС проведена», SL и покупки будут пустыми.")

    # Событие раньше создания лида — ошибка данных (чаще всего дата унаследована от прежней сделки):
    # в периоды и когорты оно попасть не должно.
    clean = [e for e in result.events if e[0] in ("lead", "sl_now") or e[1] >= e[2]]
    dropped = Counter(e[0] for e in result.events if not (e[0] in ("lead", "sl_now") or e[1] >= e[2]))
    if dropped:
        names = {"qual": "квал", "mc_booked": "запись на МС", "mc_held": "МС проведена", "mc_wait": "МС ожидает", "sl_in": "вход в SL", "sl_out": "выход из SL", "purchase": "покупка", "addon": "доп. продукт"}
        warnings.append("Пропущены события с датой раньше создания лида (ошибка данных): " + ", ".join(f"{names.get(k, k)} — {n}" for k, n in dropped.items()) + ".")
    result.events = clean
    for name in EVENT_STRING_FIELDS:
        i = EVENT_FIELDS.index(name)
        table: dict[str, int] = {}
        for e in result.events:
            e[i] = table.setdefault(e[i], len(table))
        result.event_dicts[name] = list(table)
    result.event_rows = result.events
    result.events = []
    result.meta["files"] = files
    result.meta["hasSales"] = sales_path is not None
    result.meta["asOf"] = as_of
    result.meta["warnings"] = result.meta["warnings"] + warnings
    return result


def load_dir(directory: Path) -> LoadResult:
    chosen, warnings = choose_files(directory)
    return load_files(chosen, warnings)
