# Развёртывание на VPS (пошагово)

Рассчитано на человека без опыта администрирования. Все команды копируются как есть. Получится: сервер, на нём база данных и сборщик, который каждые 10 минут подтягивает сделки из Битрикс24.

## 1. Закажите сервер

- Провайдер: любой с оплатой из вашей страны (Timeweb Cloud, Selectel, Yandex Cloud, Hetzner и т. п.).
- Система: **Ubuntu 24.04** (подойдёт и 22.04).
- Ресурсы: **2 vCPU, 2–4 ГБ RAM, диск 30+ ГБ**. Для дашборда следующего этапа этого хватит.
- После заказа провайдер пришлёт **IP-адрес** и **пароль root** (или предложит загрузить SSH-ключ).

## 2. Подключитесь к серверу

На Windows откройте PowerShell, на Mac/Linux откройте Терминал:

```bash
ssh root@IP_ВАШЕГО_СЕРВЕРА
```

Подтвердите отпечаток (`yes`) и введите пароль. Дальше все команды выполняются на сервере.

## 3. Установите Docker и git

```bash
apt update && apt install -y git ufw
curl -fsSL https://get.docker.com | sh
```

Проверка: `docker compose version` должен показать версию.

## 4. Закройте лишние порты

```bash
ufw allow OpenSSH
ufw --force enable
```

Дальше будет открыт только вход по SSH. База данных доступна только изнутри сервера.

## 5. Скачайте проект

```bash
git clone https://github.com/sayghost/mytask.git
cd mytask
git checkout claude/bitrix24-analytics-dashboard-99r1vc
cd bitrix-analytics
```

Если репозиторий приватный, git попросит логин и пароль. В качестве пароля используйте [Personal Access Token](https://github.com/settings/tokens) с правом `repo` (read).

## 6. Заполните настройки

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Впишите:
- `BITRIX_WEBHOOK_URL`: ссылка вебхука (см. [BITRIX_WEBHOOK.md](BITRIX_WEBHOOK.md));
- `POSTGRES_PASSWORD`: ваш длинный пароль (латиница и цифры).

Сохранить в nano: `Ctrl+O`, `Enter`, выйти: `Ctrl+X`.

## 7. Запустите

```bash
docker compose up -d --build
```

Первая сборка займёт пару минут. Дальше сервер сам запускает систему после перезагрузки.

## 8. Проверьте, что данные идут

Смотрим журнал сборщика (выход: `Ctrl+C`):

```bash
docker compose logs -f etl
```

Ожидаемо: строки `dictionaries: готово`, `deals: готово (full, N строк)`, `contacts: готово (full, N строк)`. История стадий по умолчанию выключена (`SYNC_STAGE_HISTORY=false`), в логе будет «stage_history: пропущено».

Сколько загружено и нет ли ошибок:

```bash
docker compose exec db psql -U analytics -d analytics -c \
  "SELECT entity, mode, status, rows_processed, finished_at, error FROM sync_log ORDER BY id DESC LIMIT 10;"

docker compose exec db psql -U analytics -d analytics -c \
  "SELECT count(*) AS сделок, min(date_create) AS самая_старая, max(date_modify) AS последнее_изменение FROM fact_deal;"
```

Если вы поменяли `POSTGRES_USER` или `POSTGRES_DB`, подставьте свои значения вместо `analytics`.

## 9. Резервные копии

Проверьте ручной запуск:

```bash
./scripts/backup.sh
```

Автозапуск каждую ночь: выполните `crontab -e`, выберите nano и добавьте строку (путь поправьте, если клонировали не в `/root`):

```
15 2 * * * /root/mytask/bitrix-analytics/scripts/backup.sh >> /root/backup.log 2>&1
```

Копии лежат в `backups/` (хранятся последние 14). Периодически скачивайте их к себе, например через `scp`, потому что на том же сервере они не защитят от его потери.

## Повседневное

| Задача | Команда (из папки `bitrix-analytics`) |
|---|---|
| Состояние | `docker compose ps` |
| Журнал | `docker compose logs --tail 100 etl` |
| Обновить код | `git pull && docker compose up -d --build` |
| Перезапустить | `docker compose restart etl` |
| Полная перезагрузка всех сделок с нуля | `docker compose stop etl && docker compose run --rm etl python -m app.main --once --full && docker compose start etl` |
| Остановить всё | `docker compose down` (данные сохранятся) |

> **Не используйте `docker compose down -v`**: флаг `-v` удаляет базу данных.

## Если что-то не работает

- `ETL: Ошибка настройки`: не заполнен `.env` или в ссылке вебхука нет `/rest/`.
- В `sync_log` статус `error` и `ACCESS_DENIED` или `insufficient_scope`: у вебхука нет прав на CRM или пользователей, пересоздайте его (см. BITRIX_WEBHOOK.md).
- `INVALID_CREDENTIALS` или `NO_AUTH_FOUND`: неверная ссылка или вебхук удалён.
- `QUERY_LIMIT_EXCEEDED` в журнале: Битрикс притормаживает запросы. ETL повторит сам. Если часто, увеличьте `BITRIX_MIN_INTERVAL_SEC` до 1.
