import json

import pytest

import loader
import settings
from loader import FIELDS, LoadError, classify_source, is_reached, load_deals, parse_date, resolve_columns, score_band
from tests.synth import PII_MARKERS, write_csv

REQUIRED = ["Дата создания", "Источник", "Тип сделки", "Статус сделки fix", "Причина отказа",
            "Посетил вебинар", "Дата квала", "Дата и время МС (квал)"]


def decode(res):
    out = []
    for row in res.rows:
        rec = {}
        for name, value in zip(FIELDS, row):
            rec[name] = res.dicts[name][value] if name in res.dicts else value
        out.append(rec)
    return out


def write_rows(path, rows, header=REQUIRED, encoding="utf-8-sig", delimiter=";"):
    lines = [delimiter.join(header)] + [delimiter.join(r) for r in rows]
    path.write_text("\n".join(lines) + "\n", encoding=encoding)


@pytest.mark.parametrize("value,expected", [
    ("05.10.2026 17:09", "2026-10-05"), ("05.10.2026", "2026-10-05"), (" 1.2.2026", "2026-02-01"),
    ("", None), ("31.02.2026", None), ("вчера", None), (None, None),
])
def test_parse_date(value, expected):
    assert parse_date(value) == expected


@pytest.mark.parametrize("name,group", [
    ("Автовеб - Гипнокоучинг (от 04.25)", "Вебинарные"), ("Вебинар лета", "Вебинарные"),
    ("Практикум", "Практикум"), ("Мини-продукты", "Мини-продукты"),
    ("Звонок", "Другое"), ("", "Другое"), ("ЛиД с выставки МСК", "Другое"),
])
def test_classify_source(name, group):
    assert classify_source(name) == group


@pytest.mark.parametrize("status,reason,expected", [
    ("91 Перезвонить (клиент не мог говорить)", "", True),
    ("92 Конвертер отправлен", "", True),
    ("92 Вебинар отправлен", "", True),            # старое название этапа
    ("93 Догрев до МС", "", True),
    ("МС назначена", "", True),
    ("БК назначена", "", True),
    ("91.1 Диалог состоялся", "", False),           # этапа нет в вашем списке
    ("1 Не обработан", "", False),
    ("7 Взят в работу", "", False),
    ("Сделка провалена", "МЛ Не вышел на связь", False),
    ("Сделка провалена", "Не вышел на связь", False),
    ("Сделка провалена", "МЛ Неверный номер", False),
    ("Сделка провалена", "МЛ Отказ от диалога (сброс после приветствия)", False),
    ("Сделка провалена", "МЛ Номер принадлежит другому человеку/слив базы", False),
    ("Сделка провалена", "Слив базы", False),
    ("Сделка провалена", "Не вышел на связь после взаимодействия", True),  # с ним был контакт
    ("Сделка провалена", "Не актуально", True),
    ("Сделка провалена", "Дубль", True),
    ("Сделка провалена", "", False),               # как в SQL: пустая причина не считается
])
def test_is_reached(status, reason, expected):
    assert is_reached(status, reason) is expected


@pytest.mark.parametrize("value,band", [("-4", "до 0"), ("0", "до 0"), ("2", "1–3"), ("6", "4–6"), ("9", "7 и выше"), ("", ""), ("abc", "")])
def test_score_band(value, band):
    assert score_band(value) == band


def test_flags_and_dictionary_encoding(tmp_path):
    f = tmp_path / "d.csv"
    write_rows(f, [
        ["01.03.2026 10:00", "Автовеб А", "Новая", "МС назначена", "", "02.03.2026", "04.03.2026", "05.03.2026 16:00"],
        ["02.03.2026", "", "Повторная", "Сделка провалена", "Нецелевой", "", "", ""],
        ["без даты", "B", "Новая", "", "", "", "", ""],
    ])
    res = load_deals(f)
    r = decode(res)
    assert r[0]["created"] == "2026-03-01" and r[0]["group"] == "Вебинарные"
    assert (r[0]["isNew"], r[0]["webinar"], r[0]["reached"], r[0]["qual"], r[0]["mc"], r[0]["failed"]) == (1, 1, 1, 1, 1, 0)
    assert r[1]["source"] == settings.NO_SOURCE_LABEL and r[1]["group"] == "Другое"
    assert (r[1]["isNew"], r[1]["reached"], r[1]["failed"], r[1]["reason"]) == (0, 1, 1, "Нецелевой")
    assert (res.meta["rowsTotal"], res.meta["rowsUsed"], res.meta["rowsSkipped"]) == (3, 2, 1)
    assert res.meta["groups"] == ["Вебинарные", "Практикум", "Мини-продукты", "Другое"]
    assert any("необязательных" in w for w in res.meta["warnings"])  # нет utm и скоринга: не ошибка


def test_personal_columns_never_leave_the_loader(tmp_path):
    f = tmp_path / "d.csv"
    write_csv(f, n=200)
    res = load_deals(f)
    blob = json.dumps({"rows": res.rows, "dicts": res.dicts, "meta": res.meta}, ensure_ascii=False)
    for marker in PII_MARKERS:
        assert marker not in blob
    assert all(len(row) == len(FIELDS) for row in res.rows)
    assert set(res.dicts) == set(loader.STRING_FIELDS)


def test_duplicate_header_uses_first_column_and_warns(tmp_path):
    f = tmp_path / "d.csv"
    write_csv(f, n=50)
    res = load_deals(f)
    assert any("Дата создания" in w for w in res.meta["warnings"])
    assert all(c >= "2026-01-01" for c in res.dicts["created"])  # взята первая колонка, не «01.01.2000»


def test_missing_required_column_gives_clear_error(tmp_path):
    f = tmp_path / "d.csv"
    write_rows(f, [["01.03.2026", "A", "Новая"]], header=["Дата создания", "Источник", "Тип сделки"])
    with pytest.raises(LoadError) as e:
        load_deals(f)
    assert "Посетил вебинар" in str(e.value) and "settings.py" in str(e.value)


def test_cp1251_and_comma_delimiter(tmp_path):
    f = tmp_path / "d.csv"
    write_rows(f, [["01.03.2026", "Звонок", "Новая", "", "", "", "", ""]], encoding="cp1251", delimiter=",")
    assert [r["source"] for r in decode(load_deals(f))] == ["Звонок"]


def test_header_matching_ignores_case_and_nbsp():
    idx, _, missing = resolve_columns(["Дата\xa0создания  ", "ИСТОЧНИК"], {"created": "дата создания", "source": "Источник", "x": "Нет такой"})
    assert idx == {"created": 0, "source": 1} and missing == ["Нет такой"]


def test_latest_csv_and_empty_dir(tmp_path):
    import os
    with pytest.raises(LoadError):
        loader.latest_csv(tmp_path)
    a, b = tmp_path / "a.csv", tmp_path / "b.csv"
    a.write_text("x"); b.write_text("y")
    os.utime(a, (1, 1))
    assert loader.latest_csv(tmp_path) == b
