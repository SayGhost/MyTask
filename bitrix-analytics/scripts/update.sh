#!/usr/bin/env bash
# Обновление на сервере: забрать свежий код с GitHub и пересобрать сборщик.
# Запуск: ./scripts/update.sh   (из папки bitrix-analytics или откуда угодно)
# .env и база данных не затрагиваются.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Забираю изменения с GitHub"
git pull --ff-only

echo "→ Пересобираю и перезапускаю"
docker compose up -d --build

echo "→ Состояние:"
docker compose ps
echo
echo "→ Последние строки журнала сборщика (Ctrl+C не нужен, это не слежение):"
docker compose logs --tail 15 etl
