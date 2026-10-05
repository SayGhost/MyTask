"""Синтетическая выгрузка в формате Битрикс24 (выдуманные данные) для тестов и проверки внешнего вида."""
from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

HEADER = [
    "ID", "Воронка", "Название сделки", "Дата создания", "Источник", "Тип сделки",
    "Посетил вебинар", "1 дозвон", "2 дозвон", "3 дозвон", "Дата диалога", "Дата квала",
    "Дата и время МС (квал)",
    # колонки с «личными» данными: в дашборд попасть не должны
    "Контакт: Домашний телефон", "Рабочий e-mail", "Имя", "Дата создания",  # последняя: дубль названия
]
SOURCES = ["Автовеб A", "Автовеб B", "Практикум", "Звонок", "Мини-продукты", "Заявка с сайта", ""]
PII_MARKERS = ["+7 900 000-00-00", "fake@example.test", "ИмяТест"]


def write_csv(path: Path, n: int = 1500, seed: int = 1, encoding: str = "utf-8-sig", start: date = date(2026, 1, 1), days: int = 240) -> None:
    rnd = random.Random(seed)
    with path.open("w", encoding=encoding, newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(HEADER)
        for i in range(n):
            created = start + timedelta(days=rnd.randrange(days))
            new = rnd.random() < 0.75
            src = rnd.choices(SOURCES, weights=[30, 15, 20, 8, 12, 10, 5])[0]
            web = rnd.random() < (0.35 if src.startswith("Автовеб") else 0.15)
            dialog = rnd.random() < (0.4 if web else 0.2)
            qual = dialog and rnd.random() < 0.35
            mc = qual and rnd.random() < 0.8
            d = lambda cond: created.strftime("%d.%m.%Y") if cond else ""
            call = lambda: "Да" if (not new and rnd.random() < 0.2) else "Нет"
            w.writerow([
                i + 1, "Воронка", f"Сделка {i + 1}", created.strftime("%d.%m.%Y %H:%M"), src,
                "Новая" if new else "Повторная", d(web), call(), call(), call(), d(dialog), d(qual),
                created.strftime("%d.%m.%Y 16:00") if mc else "",
                PII_MARKERS[0], PII_MARKERS[1], PII_MARKERS[2], "01.01.2000",
            ])


if __name__ == "__main__":
    import sys
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("synthetic.csv")
    write_csv(out)
    print("Записано:", out)
