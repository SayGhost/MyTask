#!/usr/bin/env bash
# Ежедневная копия БД: ./scripts/backup.sh  (хранит последние 14 копий в папке backups/)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

mkdir -p backups
file="backups/analytics_$(date +%F_%H%M).sql.gz"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$file"
echo "Готово: $file"
ls -1t backups/analytics_*.sql.gz | tail -n +15 | xargs -r rm --
