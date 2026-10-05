"""Синтетическая выгрузка в формате Битрикс24 (выдуманные данные) для тестов и проверки внешнего вида."""
from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

HEADER = [
    "ID", "Воронка", "Название сделки", "Дата создания", "Предполагаемая дата закрытия", "Дата изменения стадии", "Материал, после которого закрыли на МС", "Источник", "Тип сделки",
    "Статус сделки fix", "Причина отказа", "Посетил вебинар", "Дата квала", "Дата и время МС (квал)",
    "Оставил заявку на МС", "utm_source_fix", "utm_medium_fix", "utm_campaign_fix", "utm_content_fix",
    "utm_term_fix", "Оценка ★ (квал)", "Оценка (после МС)", "Оценка", "Сегмент", "Портрет",
    # колонки с «личными» данными: в дашборд попасть не должны
    "Контакт: Домашний телефон", "Рабочий e-mail", "Имя", "Дата создания",  # последняя: дубль названия
]
SOURCES = ["Автовеб - Курс (от 04.25)", "Автовеб - Курс (от 08.25)", "Практикум", "Мини-продукты", "Звонок",
           "Заявка на консультацию", "ЛиД с выставки", ""]
UTM = [("youtube_a", "video", "launch_apr"), ("yandex_b", "cpc", "brand"), ("tg_c", "post", "launch_apr"),
       ("email", "mail", "digest"), ("", "", "")]
REASONS = ["МЛ Не вышел на связь", "Не вышел на связь после взаимодействия", "Не актуально", "МЛ Неверный номер",
           "Нецелевой", "Не посмотрел вебинар", "Дубль"]
PORTRAITS = ["Эксперт - ПРО", "Эксперт - МИНИ", "Новичок - СТАРТЕР", "Новичок - ХОЧУНЧИК", "Для себя - ИЩУЩИЙ"]
PII_MARKERS = ["+7 900 000-00-00", "fake@example.test", "ИмяТест"]


def write_csv(path: Path, n: int = 1500, seed: int = 1, encoding: str = "utf-8-sig", start: date = date(2026, 1, 1), days: int = 240) -> None:
    rnd = random.Random(seed)
    with path.open("w", encoding=encoding, newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(HEADER)
        for i in range(n):
            created = start + timedelta(days=rnd.randrange(days))
            new = rnd.random() < 0.75
            src = rnd.choices(SOURCES, weights=[30, 15, 20, 12, 8, 6, 5, 4])[0]
            web = rnd.random() < (0.35 if src.startswith("Автовеб") else 0.15)
            reached = rnd.random() < (0.55 if web else 0.35)
            qual = reached and rnd.random() < 0.3
            mc = qual and rnd.random() < 0.8
            if mc:
                status, reason = "МС назначена", ""
            elif reached and not qual:
                status, reason = rnd.choice([("92 Конвертер отправлен", ""), ("Сделка провалена", "Не актуально")])
            elif not reached:
                status, reason = "Сделка провалена", rnd.choice(REASONS[:5])
            else:
                status, reason = "Сделка провалена", rnd.choice(REASONS)
            utm = rnd.choice(UTM)
            seg = rnd.choice(["Новичок", "Для себя", "Эксперт"]) if qual or rnd.random() < 0.1 else ""
            portrait = rnd.choice([p for p in PORTRAITS if p.startswith(seg)]) if seg else ""
            d = lambda cond: created.strftime("%d.%m.%Y") if cond else ""
            closed = created + timedelta(days=rnd.randrange(1, 9)) if mc or status == "Сделка провалена" else None
            fmt = lambda x: x.strftime("%d.%m.%Y") if x else (created + timedelta(days=30)).strftime("%d.%m.%Y")
            w.writerow([
                i + 1, "Консультанты", f"Сделка {i + 1}", created.strftime("%d.%m.%Y %H:%M"), fmt(closed), fmt(closed),
                rnd.choice(["Вебинар 1", "Разбор", "Книга"]) if mc and rnd.random() < 0.4 else "", src,
                "Новая" if new else "Повторная", status, reason, d(web), d(qual),
                created.strftime("%d.%m.%Y 16:00") if mc else "", d(qual and rnd.random() < 0.6),
                utm[0], utm[1], utm[2], f"{utm[2]}_{rnd.randrange(4)}" if utm[2] else "", "",
                # до 15.06 оценивали буквами A–F (старая шкала), потом звёздами (новая)
                rnd.choice(["1★", "2★", "3★", "4★", "5★"]) if qual and created >= date(2026, 6, 15) and rnd.random() < 0.8 else "",
                rnd.choice("ABCDEF") if qual and created < date(2026, 6, 15) and rnd.random() < 0.8 else "",
                str(rnd.randrange(-3, 10)) if seg else "", seg, portrait,
                PII_MARKERS[0], PII_MARKERS[1], PII_MARKERS[2], "01.01.2000",
            ])


SALES_HEADER = [
    "ID", "Воронка", "Дата создания", "Дата создания сделки", "Тип сделки", "Источник", "utm_source_fix", "Статус сделки fix",
    "Предполагаемая дата закрытия", "Сумма", "Дата и время МС (квал)", "Причина отказа Продажи", "Итог МС",
    "SL лид", "Дата изменения SL лида", "Материал, который довел клиента до SL", "Материал, после которого закрыли на МС",
    "Контакт: Домашний телефон", "Рабочий e-mail", "Имя", "SL лид", "Дата создания сделки",  # последние две: дубли названий
]
STAGES = ["0 МС назначена", "1 Ждет перезнаначения", "3 Сопровождение на доп", "5 0,1 Греем", "7 0,9 Дожимаем",
          "Передан на обучение", "8 Купил Доп.Продукт", "Отказ", "Просроченая сделка"]


def write_sales_csv(path: Path, n: int = 300, seed: int = 2, encoding: str = "utf-8-sig", end: date = date(2026, 8, 28)) -> None:
    """Выдуманная выгрузка воронки «Продажи» в том же формате."""
    rnd = random.Random(seed)
    with path.open("w", encoding=encoding, newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(SALES_HEADER)
        for i in range(n):
            lead = end - timedelta(days=rnd.randrange(3, 230))
            copy = lead + timedelta(days=rnd.randrange(0, 12))
            mc = copy + timedelta(days=rnd.randrange(1, 10))
            stage = rnd.choices(STAGES, weights=[6, 3, 5, 8, 4, 12, 4, 40, 5])[0]
            future = stage.startswith(("0 ", "1 ")) and rnd.random() < 0.5
            if future:
                mc = end + timedelta(days=rnd.randrange(1, 8))
            final = stage in ("Передан на обучение", "8 Купил Доп.Продукт", "Отказ")
            close = mc + timedelta(days=rnd.randrange(3, 40)) if final else mc + timedelta(days=30)
            reason = rnd.choice(["Нецелевой", "Отказался от покупки", "На склад", "Не пришел на БК", "Отказ от БК", "Нет денег", "Не вышел на связь"]) if stage == "Отказ" else ""
            amount = rnd.choice([45000, 90000, 150000, 250000]) if stage == "Передан на обучение" else (990 if stage == "8 Купил Доп.Продукт" else 0)
            sl_yes = stage in ("5 0,1 Греем", "7 0,9 Дожимаем", "Передан на обучение") and rnd.random() < 0.6
            sl_out = not sl_yes and stage == "Отказ" and rnd.random() < 0.1
            sl_date = (mc + timedelta(days=rnd.randrange(1, 20))) if (sl_yes and rnd.random() < 0.5) or sl_out else None
            src = rnd.choices(SOURCES, weights=[30, 15, 20, 12, 8, 6, 5, 4])[0]
            fmt = lambda x: x.strftime("%d.%m.%Y") if x else ""
            w.writerow([
                i + 1, "Продажи", copy.strftime("%d.%m.%Y %H:%M"), fmt(lead), "Новая" if rnd.random() < 0.8 else "Повторная", src,
                rnd.choice(["youtube_a", "yandex_b", "tg_c", ""]), stage, fmt(close), amount, mc.strftime("%d.%m.%Y 16:00"), reason,
                "не пришел" if stage == "Отказ" and rnd.random() < 0.1 else "", "Да" if sl_yes else "Нет", fmt(sl_date),
                rnd.choice(["Вебинар 1", "Разбор", "Книга"]) if sl_date and sl_yes and rnd.random() < 0.6 else "",
                rnd.choice(["Вебинар 1", "Разбор"]) if rnd.random() < 0.1 else "",
                PII_MARKERS[0], PII_MARKERS[1], PII_MARKERS[2], "Завершен" if sl_yes else "", "01.01.2000",
            ])


if __name__ == "__main__":
    import sys
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("synthetic.csv")
    write_csv(out)
    sales = out.with_name(out.stem + "_sales.csv")
    write_sales_csv(sales)
    print("Записано:", out, "и", sales)
