"""Синтетическая выгрузка в формате Битрикс24 (выдуманные данные) для тестов и проверки внешнего вида."""
from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

HEADER = [
    "ID", "Воронка", "Название сделки", "Дата создания", "Источник", "Тип сделки",
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
            w.writerow([
                i + 1, "Воронка", f"Сделка {i + 1}", created.strftime("%d.%m.%Y %H:%M"), src,
                "Новая" if new else "Повторная", status, reason, d(web), d(qual),
                created.strftime("%d.%m.%Y 16:00") if mc else "", d(qual and rnd.random() < 0.6),
                utm[0], utm[1], utm[2], f"{utm[2]}_{rnd.randrange(4)}" if utm[2] else "", "",
                rnd.choice(["1★", "2★", "3★", "4★", "5★"]) if qual and rnd.random() < 0.5 else "",
                rnd.choice("ABCDF") if mc and rnd.random() < 0.3 else "",
                str(rnd.randrange(-3, 10)) if seg else "", seg, portrait,
                PII_MARKERS[0], PII_MARKERS[1], PII_MARKERS[2], "01.01.2000",
            ])


if __name__ == "__main__":
    import sys
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("synthetic.csv")
    write_csv(out)
    print("Записано:", out)
