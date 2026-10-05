#!/usr/bin/env bash
# Запуск дашборда на Mac/Linux: ./start.sh  (или двойной клик, если разрешён запуск)
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 не найден. Установите его с https://www.python.org/downloads/ и запустите снова."
  exit 1
fi
python3 server.py
