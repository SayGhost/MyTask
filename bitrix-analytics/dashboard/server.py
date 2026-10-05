"""Локальный сервер дашборда.

Запуск: python server.py   (или start.bat / start.sh)
Страница открывается на http://127.0.0.1:8765 и работает только на вашем компьютере.
"""
from __future__ import annotations

import argparse
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import settings
from loader import EVENT_FIELDS, FIELDS, LoadError, choose_files, detect_funnel, load_files

STATIC_DIR = Path(__file__).parent / "static"
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8"}

# Страница не должна обращаться никуда, кроме этого сервера: внешние запросы блокирует браузер.
CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"


class DataStore:
    """Хранит разобранные выгрузки и перечитывает файлы, если они изменились."""

    def __init__(self, files: list[Path] | None = None):
        self._files = files
        self._lock = threading.Lock()
        self._key = None
        self._payload: dict = {}

    def _choose(self):
        if not self._files:
            return choose_files(settings.DATA_DIR)
        chosen = {}
        for p in self._files:
            chosen[detect_funnel(p) or settings.CONSULT_FUNNEL] = p
        return chosen, []

    def get(self) -> dict:
        with self._lock:
            try:
                chosen, warnings = self._choose()
                key = tuple(sorted((k, str(p), p.stat().st_mtime_ns, p.stat().st_size) for k, p in chosen.items()))
                if key != self._key:
                    result = load_files(chosen, warnings)
                    self._payload = {
                        "fields": FIELDS, "dicts": result.dicts, "rows": result.rows, "meta": result.meta,
                        "events": {"fields": EVENT_FIELDS, "dicts": result.event_dicts, "rows": result.event_rows},
                    }
                    self._key = key
            except (LoadError, OSError) as e:
                self._key = None
                self._payload = {"error": str(e)}
            return self._payload


def make_handler(store: DataStore):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Dashboard"

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/api/deals":
                body = json.dumps(store.get(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                return self._send(200, body, "application/json; charset=utf-8")
            name = "index.html" if path == "/" else path.lstrip("/")
            file = (STATIC_DIR / name).resolve()
            if file.parent != STATIC_DIR.resolve() or not file.is_file() or file.suffix not in CONTENT_TYPES:
                return self._send(404, "Не найдено".encode("utf-8"), "text/plain; charset=utf-8")
            self._send(200, file.read_bytes(), CONTENT_TYPES[file.suffix])

        def log_message(self, format, *args):  # noqa: A002 — тишина в консоли
            pass

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Локальный дашборд по выгрузке Битрикс24")
    parser.add_argument("--port", type=int, default=settings.PORT)
    parser.add_argument("--file", type=Path, action="append", help="CSV-файл выгрузки (можно указать несколько раз; по умолчанию берутся свежие файлы из папки data)")
    parser.add_argument("--no-browser", action="store_true", help="не открывать браузер")
    args = parser.parse_args()

    store = DataStore(args.file)
    server = ThreadingHTTPServer((settings.HOST, args.port), make_handler(store))
    url = f"http://{settings.HOST}:{args.port}"
    print(f"Дашборд: {url}\nОстановить: Ctrl+C")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановлено.")


if __name__ == "__main__":
    main()
