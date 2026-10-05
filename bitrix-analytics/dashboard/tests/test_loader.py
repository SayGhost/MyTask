import json

import pytest

import loader
from loader import FIELDS, LoadError, load_deals, parse_date, resolve_columns
from tests.synth import HEADER, PII_MARKERS, write_csv

import settings


def rec(row):
    return dict(zip(FIELDS, row))


@pytest.mark.parametrize("value,expected", [
    ("05.10.2026 17:09", "2026-10-05"), ("05.10.2026", "2026-10-05"), (" 1.2.2026", "2026-02-01"),
    ("", None), ("31.02.2026", None), ("вчера", None), (None, None),
])
def test_parse_date(value, expected):
    assert parse_date(value) == expected


def write_rows(path, rows, header=None, encoding="utf-8-sig"):
    header = header or ["Дата создания", "Источник", "Тип сделки", "Посетил вебинар", "1 дозвон", "2 дозвон",
                        "3 дозвон", "Дата диалога", "Дата квала", "Дата и время МС (квал)"]
    lines = [";".join(header)] + [";".join(r) for r in rows]
    path.write_text("\n".join(lines) + "\n", encoding=encoding)


def test_flags_and_reached_rule(tmp_path):
    f = tmp_path / "d.csv"
    write_rows(f, [
        ["01.03.2026 10:00", "A", "Новая", "02.03.2026", "Нет", "Нет", "Нет", "03.03.2026", "04.03.2026", "05.03.2026 16:00"],
        ["02.03.2026", "", "Повторная", "", "Да", "Нет", "Нет", "", "", ""],      # дозвонился по флагу, источника нет
        ["03.03.2026", "B", "Новая", "", "Нет", "Нет", "Нет", "", "", ""],         # ничего не достиг
        ["без даты", "B", "Новая", "", "", "", "", "", "", ""],                      # пропускается
    ])
    res = load_deals(f)
    r = [rec(x) for x in res.rows]
    assert r[0] == dict(created="2026-03-01", source="A", isNew=1, webinar=1, reached=1, qual=1, mc=1)
    assert r[1] == dict(created="2026-03-02", source=settings.NO_SOURCE_LABEL, isNew=0, webinar=0, reached=1, qual=0, mc=0)
    assert r[2]["reached"] == 0
    assert (res.meta["rowsTotal"], res.meta["rowsUsed"], res.meta["rowsSkipped"]) == (4, 3, 1)
    assert (res.meta["dateMin"], res.meta["dateMax"]) == ("2026-03-01", "2026-03-03")


def test_personal_columns_never_leave_the_loader(tmp_path):
    f = tmp_path / "d.csv"
    write_csv(f, n=200)
    res = load_deals(f)
    blob = json.dumps({"rows": res.rows, "meta": res.meta}, ensure_ascii=False)
    for marker in PII_MARKERS:
        assert marker not in blob
    assert all(len(row) == len(FIELDS) for row in res.rows)


def test_duplicate_header_uses_first_column_and_warns(tmp_path):
    f = tmp_path / "d.csv"
    write_csv(f, n=50)
    res = load_deals(f)
    assert any("Дата создания" in w for w in res.meta["warnings"])
    assert all(row[0] >= "2026-01-01" for row in res.rows)  # взята первая колонка, не «01.01.2000»


def test_missing_column_gives_clear_error(tmp_path):
    f = tmp_path / "d.csv"
    write_rows(f, [["01.03.2026", "A", "Новая"]], header=["Дата создания", "Источник", "Тип сделки"])
    with pytest.raises(LoadError) as e:
        load_deals(f)
    assert "Посетил вебинар" in str(e.value) and "settings.py" in str(e.value)


def test_cp1251_and_comma_delimiter(tmp_path):
    f = tmp_path / "d.csv"
    header = ["Дата создания", "Источник", "Тип сделки", "Посетил вебинар", "1 дозвон", "2 дозвон", "3 дозвон",
              "Дата диалога", "Дата квала", "Дата и время МС (квал)"]
    f.write_text(",".join(header) + "\n01.03.2026,Звонок,Новая,,Нет,Нет,Нет,,,\n", encoding="cp1251")
    res = load_deals(f)
    assert [rec(x)["source"] for x in res.rows] == ["Звонок"]


def test_header_matching_ignores_case_and_nbsp():
    idx, _ = resolve_columns(["Дата\xa0создания  ", "ИСТОЧНИК"], {"created": "дата создания", "source": "Источник"})
    assert idx == {"created": 0, "source": 1}


def test_latest_csv_and_empty_dir(tmp_path):
    with pytest.raises(LoadError):
        loader.latest_csv(tmp_path)
    a, b = tmp_path / "a.csv", tmp_path / "b.csv"
    a.write_text("x"); b.write_text("y")
    import os
    os.utime(a, (1, 1))
    assert loader.latest_csv(tmp_path) == b
