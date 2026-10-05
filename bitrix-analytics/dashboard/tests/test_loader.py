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


# ---------- «Общий» дашборд: события и две воронки ----------
from collections import Counter

from loader import EVENT_FIELDS, choose_files, load_dir, load_files, load_sales, mc_not_held
from tests.synth import write_sales_csv

SALES_HDR = ["Воронка", "Дата создания", "Дата создания сделки", "Тип сделки", "Источник", "Стадия сделки",
             "Предполагаемая дата закрытия", "Сумма", "Дата и время МС (квал)", "Причина отказа Продажи", "Итог МС",
             "SL лид", "Дата изменения SL лида", "Материал, который довел клиента до SL"]


def sales_row(**kw):
    base = {"Воронка": "Продажи", "Дата создания": "10.03.2026", "Дата создания сделки": "01.03.2026", "Тип сделки": "Новая",
            "Источник": "Автовеб А", "Стадия сделки": "", "Предполагаемая дата закрытия": "", "Сумма": "", "Дата и время МС (квал)": "",
            "Причина отказа Продажи": "", "Итог МС": "", "SL лид": "Нет", "Дата изменения SL лида": "", "Материал, который довел клиента до SL": ""}
    base.update(kw)
    return [base[h] for h in SALES_HDR]


def events_of(path, as_of="2026-06-01"):
    res = load_sales(path, as_of)
    return [dict(zip(EVENT_FIELDS, e)) for e in res.events], res


def test_mc_not_held_rule():
    assert mc_not_held("Не пришел на БК", "")
    assert mc_not_held("не вышел на связь", "")
    assert mc_not_held("Нецелевой", "не пришла/ потом написала не актуально")
    assert mc_not_held("", "без МС")
    assert not mc_not_held("Нецелевой", "ЦП")
    assert not mc_not_held("Отказался от покупки", "изучает материалы")


def test_sales_events(tmp_path):
    f = tmp_path / "s.csv"
    D = "Дата и время МС (квал)"
    write_rows(f, [
        sales_row(**{"Стадия сделки": "3 Сопровождение на доп", D: "05.03.2026 16:00"}),                                 # проведена по стадии
        sales_row(**{"Стадия сделки": "Отказ", D: "06.03.2026 16:00", "Причина отказа Продажи": "Нецелевой"}),           # отказ, МС была
        sales_row(**{"Стадия сделки": "Отказ", D: "07.03.2026 16:00", "Причина отказа Продажи": "Не пришел на БК"}),     # МС не состоялась
        sales_row(**{"Стадия сделки": "Отказ", D: "08.03.2026 16:00", "Причина отказа Продажи": "Нет денег", "Итог МС": "не пришел"}),
        sales_row(**{"Стадия сделки": "0 МС назначена", D: "20.06.2026 16:00"}),                                         # впереди
        sales_row(**{"Стадия сделки": "1 Ждет перезнаначения", D: "09.03.2026 16:00"}),                                  # дата прошла
        sales_row(**{"Стадия сделки": "5 0,1 Греем", "SL лид": "Да", "Дата изменения SL лида": "12.03.2026", "Материал, который довел клиента до SL": "Вебинар 1"}),
        sales_row(**{"Стадия сделки": "5 0,1 Греем", "SL лид": "Да"}),                                                   # SL без даты
        sales_row(**{"Стадия сделки": "Отказ", "SL лид": "Нет", "Дата изменения SL лида": "14.03.2026"}),                # вышел из SL
        sales_row(**{"Стадия сделки": "Передан на обучение", "Предполагаемая дата закрытия": "15.03.2026", "Сумма": "150 000,50"}),
        sales_row(**{"Стадия сделки": "8 Купил Доп.Продукт", "Предполагаемая дата закрытия": "16.03.2026", "Сумма": "990"}),
        sales_row(**{"Стадия сделки": "Передан на обучение", "Предполагаемая дата закрытия": "17.03.2026", "Сумма": "1000", "Дата создания сделки": "", "Тип сделки": "Повторная"}),
    ], header=SALES_HDR)
    ev, res = events_of(f)
    by = Counter(e["type"] for e in ev)
    assert by == Counter(mc_held=2, mc_skip=2, mc_wait=2, sl_now=2, sl_in=1, sl_out=1, purchase=2, addon=1)
    assert sorted(e["date"] for e in ev if e["type"] == "mc_held") == ["2026-03-05", "2026-03-06"]
    waits = sorted(e["date"] for e in ev if e["type"] == "mc_wait")
    assert waits == ["2026-03-09", "2026-06-20"]
    sl_in = next(e for e in ev if e["type"] == "sl_in")
    assert (sl_in["date"], sl_in["lead"], sl_in["matSl"]) == ("2026-03-12", "2026-03-01", "Вебинар 1")
    assert next(e for e in ev if e["type"] == "sl_now" and e["date"] == "2026-03-10")  # без даты SL берётся дата создания
    p = [e for e in ev if e["type"] == "purchase"]
    assert sorted((e["date"], e["amount"], e["isNew"]) for e in p) == [("2026-03-15", 150000.5, 1), ("2026-03-17", 1000.0, 0)]
    assert [e["lead"] for e in p if e["date"] == "2026-03-17"] == ["2026-03-10"]  # нет даты исходного лида → дата создания копии
    assert next(e for e in ev if e["type"] == "addon")["amount"] == 990.0
    assert all(e["group"] == "Вебинарные" for e in ev)


def test_mc_held_only_with_date_not_in_future(tmp_path):
    f = tmp_path / "s.csv"
    write_rows(f, [
        sales_row(**{"Стадия сделки": "3 Сопровождение на доп"}),                                                  # даты МС нет
        sales_row(**{"Стадия сделки": "3 Сопровождение на доп", "Дата и время МС (квал)": "30.12.2026 10:00"}),    # дата в будущем
    ], header=SALES_HDR)
    ev, _ = events_of(f, as_of="2026-06-01")
    assert [e["type"] for e in ev] == ["mc_wait"]  # будущая МС — «ожидает», проведённой не считается


def test_consultant_events_and_files_selection(tmp_path):
    import os
    a, b, c, d = tmp_path / "a.csv", tmp_path / "b.csv", tmp_path / "c.csv", tmp_path / "d.csv"
    write_csv(a, n=300)
    write_sales_csv(b, n=60)
    write_sales_csv(c, n=10, seed=9)        # второй файл «Продаж»: старый, должен быть пропущен
    d.write_text("Воронка;Дата создания\nСтоп;01.03.2026\n", encoding="utf-8-sig")  # чужая воронка
    os.utime(c, (1, 1))
    chosen, warns = choose_files(tmp_path)
    assert set(chosen) == {"Консультанты", "Продажи"} and chosen["Продажи"] == b
    assert any("несколько файлов" in w for w in warns) and any("не распознана" in w for w in warns)

    res = load_dir(tmp_path)
    types = Counter(res.event_dicts["type"][e[0]] for e in res.event_rows)
    assert types["lead"] == 300 and types["qual"] > 0 and types["mc_booked"] > 0 and types["purchase"] > 0
    assert res.meta["hasSales"] and [f["funnel"] for f in res.meta["files"]] == ["Консультанты", "Продажи"]
    # каждая запись события: все строковые поля — номера из словаря
    i_date = EVENT_FIELDS.index("date")
    assert all(0 <= e[i_date] < len(res.event_dicts["date"]) for e in res.event_rows)


def test_events_never_contain_personal_data(tmp_path):
    write_csv(tmp_path / "a.csv", n=100)
    write_sales_csv(tmp_path / "b.csv", n=100)
    res = load_dir(tmp_path)
    blob = json.dumps({"r": res.event_rows, "d": res.event_dicts, "m": res.meta}, ensure_ascii=False)
    for marker in PII_MARKERS:
        assert marker not in blob


def test_sales_optional_and_missing_cases(tmp_path):
    # без выгрузки «Продаж»: событий МС проведена/SL/покупок нет, предупреждение есть
    write_csv(tmp_path / "a.csv", n=50)
    res = load_dir(tmp_path)
    assert not res.meta["hasSales"] and any("Нет выгрузки воронки" in w for w in res.meta["warnings"])
    assert not {"mc_held", "purchase", "sl_in"} & set(res.event_dicts["type"])
    # без выгрузки «Консультантов»: понятная ошибка
    only_sales = tmp_path / "x"; only_sales.mkdir()
    write_sales_csv(only_sales / "s.csv", n=20)
    with pytest.raises(LoadError) as e:
        load_dir(only_sales)
    assert "Консультанты" in str(e.value)


def test_events_before_lead_creation_are_dropped_and_reported(tmp_path):
    # колонки: создана, источник, тип, статус, причина, вебинар, квал, МС
    write_rows(tmp_path / "a.csv", [
        ["10.03.2026", "Автовеб А", "Новая", "1 Не обработан", "", "", "01.03.2026", ""],  # квал раньше создания лида
        ["11.03.2026", "Автовеб А", "Новая", "1 Не обработан", "", "", "12.03.2026", ""],  # нормальный квал
    ])
    res = load_dir(tmp_path)
    kinds = Counter(res.event_dicts["type"][e[0]] for e in res.event_rows)
    assert kinds["lead"] == 2 and kinds["qual"] == 1
    assert any("раньше создания лида" in w and "квал — 1" in w for w in res.meta["warnings"])


def test_mc_notes_explain_every_decision(tmp_path):
    f = tmp_path / "s.csv"
    D = "Дата и время МС (квал)"
    write_rows(f, [
        sales_row(**{"Стадия сделки": "5 0,1 Греем", D: "05.03.2026 16:00"}),
        sales_row(**{"Стадия сделки": "Отказ", D: "06.03.2026 16:00", "Причина отказа Продажи": "Нецелевой"}),
        sales_row(**{"Стадия сделки": "Отказ", D: "07.03.2026 16:00", "Причина отказа Продажи": "Не пришел на БК"}),
        sales_row(**{"Стадия сделки": "Просроченая сделка", D: "08.03.2026 16:00"}),
    ], header=SALES_HDR)
    ev, _ = events_of(f)
    notes = {(e["type"], e["note"]) for e in ev}
    assert ("mc_held", "5 0,1 Греем") in notes
    assert ("mc_held", "Отказ: МС была (Нецелевой)") in notes
    assert ("mc_skip", "Отказ: МС не состоялась (Не пришел на БК)") in notes
    assert ("mc_skip", "Просроченая сделка: стадия не из списка «проведена»") in notes
