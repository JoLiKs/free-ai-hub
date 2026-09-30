# Free AI Hub — бэкенд журнала чатов и админ-панель

Небольшой Python-сервис (FastAPI + SQLite), который **по согласию пользователя** принимает тексты сообщений с сайта Free AI Hub и показывает их владельцу в админ-панели `/admin`. Развёртывается на вашем собственном сервере. Сайт продолжает работать и без него (если `BACKEND_URL` в `js/config.js` пуст, ничего не отправляется).

> ⚖️ **Прозрачность и закон.** Сайт показывает посетителю уведомление и просит согласие («Принимаю» / «Не сохранять»); без согласия ничего не отправляется. Вы отвечаете за законность обработки данных (в т. ч. GDPR / закон РБ «О защите персональных данных»): храните только необходимое, ограничьте срок (`RETENTION_DAYS`), не публикуйте выгрузки, закройте доступ к серверу. Если на сайте вы решите убрать или ослабить уведомление — не делайте этого: это скрытая слежка.

## Что внутри

| Путь | Назначение |
|---|---|
| `app/main.py` | приложение: `POST /api/log`, `DELETE /api/session/{id}`, `GET /api/health`, админ-API `/api/admin/*`, статика `/admin` |
| `app/config.py` | настройки из переменных окружения (+ мини-загрузчик `.env`) |
| `app/db.py` | SQLite (stdlib `sqlite3`), параметризованные запросы, очистка по сроку |
| `app/security.py` | scrypt-пароль, подписанная сессионная кука, CSRF-токен, хеш IP |
| `app/ratelimit.py` | лимит запросов на IP, дневная квота, блокировка перебора пароля |
| `app/static/` | админ-панель: `index.html`, `admin.css`, `app.js` (без зависимостей и CDN) |
| `tests/` | pytest (85+ тестов) |
| `Dockerfile`, `docker-compose.yml` | контейнер |
| `deploy/` | `free-ai-hub.service` (systemd), `Caddyfile`, `nginx.conf` |
| `deploy.sh` | идемпотентный деплой по SSH |
| `scripts/seed_demo.py` | демо-данные для локальной проверки админки |

Зависимости рантайма — только `fastapi` и `uvicorn` (`requirements.txt`). Python 3.10+.

## Быстрый старт (локально)

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt          # для запуска без тестов достаточно requirements.txt
cp .env.example .env                         # и отредактируйте (см. ниже)
python -c "import secrets;print(secrets.token_urlsafe(48))"   # → SECRET_KEY
python -m app                                # http://127.0.0.1:8080/admin
pytest -q                                    # тесты
```

Для локальной проверки по http в `.env` поставьте `COOKIE_SECURE=0` (по http кука с `Secure` не сохранится) и `TRUST_PROXY=0`.

Проверка вместе с сайтом: в корне проекта `python3 -m http.server 8138`, затем `./set-backend-url.sh http://127.0.0.1:8080` — и откройте `http://127.0.0.1:8138`. Вернуть выключенное состояние: `./set-backend-url.sh ""`.

Демо-данные: `DB_PATH=/tmp/demo.db python scripts/seed_demo.py`, затем запустите сервис с тем же `DB_PATH`.

## Переменные окружения

Секреты **только** через окружение / `.env` (файл в `.gitignore`; в репозитории лежит лишь `.env.example` без реальных значений).

| Переменная | По умолчанию | Описание |
|---|---|---|
| `ADMIN_PASSWORD` | — | пароль входа в `/admin` (≥ 12 символов). Значения-заглушки (`change-me`, пусто) **отключают** админку |
| `ADMIN_PASSWORD_HASH` | — | вместо пароля в открытом виде: `python -m app.hashpw` (scrypt). Имеет приоритет |
| `SECRET_KEY` | случайный на процесс | подпись сессий и соль хеша IP, ≥ 16 символов. Если не задан — после перезапуска придётся входить заново |
| `ALLOWED_ORIGINS` | `https://joliks.github.io,http://127.0.0.1:*,http://localhost:*` | список сайтов через запятую (CORS + проверка Origin). `*` — метка(и) хоста: `https://*.pages.dev`; `:*` — любой порт. Добавьте свой `https://…pages.dev` / домен |
| `DB_PATH` | `data/fah.db` | файл SQLite (каталог создаётся с правами 0700, файл 0600) |
| `RETENTION_DAYS` | `90` | сообщения старше удаляются (раз в час и при старте); `0` — не удалять |
| `MAX_TEXT_CHARS` | `20000` | предел длины текста (длиннее — обрезается) |
| `MAX_BODY_BYTES` | `400000` | предел тела запроса (`413`) |
| `RATE_LIMIT_PER_MIN` | `30` | `/api/log` в минуту на адрес (`429` + `Retry-After`) |
| `RATE_LIMIT_DELETE_PER_MIN` | `10` | то же для `DELETE /api/session/…` |
| `MAX_BYTES_PER_IP_DAY` | `20000000` | суточная квота объёма на адрес |
| `MAX_DB_MB` | `2048` | при превышении новые записи отклоняются (`507`) |
| `TRUST_PROXY` | `0` | `1` — брать адрес клиента из `CF-Connecting-IP` / последней записи `X-Forwarded-For`. **Включайте только за прокси и когда порт приложения недоступен снаружи** |
| `COOKIE_SECURE` | `1` | флаг `Secure` и префикс `__Host-` у куки (для http-разработки — `0`) |
| `ADMIN_SESSION_HOURS` | `8` | срок жизни входа |
| `LOGIN_MAX_FAILS` / `LOGIN_LOCK_MINUTES` | `5` / `15` | блокировка адреса после N неверных паролей |
| `LOGIN_GLOBAL_MAX_FAILS` / `LOGIN_GLOBAL_LOCK_MINUTES` | `50` / `5` | общий предохранитель от распределённого перебора |
| `IP_HASH_ROTATE_DAILY` | `1` | соль хеша IP меняется каждые сутки (нельзя связать посетителя между днями) |
| `ALLOW_NO_ORIGIN` | `0` | разрешить `/api/log` без заголовка Origin (по умолчанию запрещено) |
| `HOST`, `PORT` | `127.0.0.1`, `8080` | адрес запуска (`python -m app`) |

## API

Публичное (CORS только для `ALLOWED_ORIGINS`):

* `POST /api/log` — тело JSON (принимается и с `Content-Type: text/plain`, для `sendBeacon` без preflight):
  `session_id` (UUID), `chat_id` (`[A-Za-z0-9_-]{1,64}`), `provider`, `model`, `slot` (`A`/`B`), `user_text` и/или `assistant_text`, `ts` (мс, клиентское время), `lang`, необязательный `event_id` (повторная отправка того же события игнорируется). Страна берётся из заголовка `CF-IPCountry`, сайт — из `Origin`. Ответы: `200`, `400` (не JSON), `403` (чужой Origin), `413`, `422` (валидация), `429`, `507`. Если запись приостановлена в админке — `200` с `"paused": true`, ничего не сохраняется.
* `DELETE /api/session/{session_id}` — удаляет все данные сеанса; «пароль» — сам случайный UUID. Ответ одинаков, есть данные или нет.
* `GET /api/health` — `{"status":"ok"}`.

Админ-API (`/api/admin/*`) без входа отвечает `401`. Изменяющие запросы требуют заголовок `X-CSRF-Token` (выдаётся при входе) и совпадающий Origin.

## Что хранится и как защищено

* Тексты сообщений, провайдер/модель, время, язык, домен сайта, страна (если CDN передаёт `CF-IPCountry`).
* **IP не хранится.** Только `HMAC-SHA256(SECRET_KEY, день + IP)`, обрезанный до 80 бит; с `IP_HASH_ROTATE_DAILY=1` соль меняется ежедневно.
* Вход: пароль сравнивается через scrypt + `hmac.compare_digest`; сессия — подписанная (HMAC) кука `__Host-fah_admin` с `HttpOnly; Secure; SameSite=Strict; Path=/`, сброс при смене пароля/`SECRET_KEY`, «выход» отзывает сессию; задержка при неверном пароле, блокировка по адресу и общий предохранитель.
* CSRF: токен в заголовке + `SameSite=Strict` + проверка Origin.
* Заголовки: строгий CSP (`default-src 'none'; script-src 'self'; style-src 'self'; frame-ancestors 'none'`, без inline/eval), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS (за HTTPS), `Cache-Control: no-store`, `X-Robots-Tag`. `/docs` и `/openapi.json` выключены.
* XSS: админ-панель выводит любой пользовательский текст **только** через `textContent`/текстовые узлы (в `app.js` нет `innerHTML`; тест это проверяет). CSV-экспорт нейтрализует формулы (`=`, `+`, `-`, `@`).
* SQL: только параметризованные запросы; `LIKE` не используется (поиск через `instr`), поэтому `%` и `_` — обычные символы. Поиск по кириллице без учёта регистра.
* `PRAGMA secure_delete=ON` — удалённый текст затирается в файле.

## Админ-панель `/admin`

Вход по паролю → вкладки «Сессии» (список: последняя активность, число сообщений, провайдер/модель, страна; поиск по тексту; фильтры по провайдеру, модели, датам; переписка с подсветкой найденного; экспорт JSON/CSV всего результата или одной сессии; удаление сессии), «Статистика» (сообщения по дням, топ провайдеров/моделей/стран, размер базы), «Настройки» (пауза записи, ручная очистка по сроку, экспорт всего, «Удалить всё» с подтверждением словом). Тема — кибер-панк или тёмная (переключатель в шапке).

Рекомендация: ограничьте `/admin` и `/api/admin` по IP на прокси (пример в `deploy/Caddyfile`) или закройте VPN.

## Запуск на сервере

### Вариант A — Docker

```bash
cd backend
cp .env.example .env && nano .env            # ADMIN_PASSWORD, SECRET_KEY, ALLOWED_ORIGINS, TRUST_PROXY=1, COOKIE_SECURE=1
docker compose up -d --build
docker compose logs -f backend
```
Порт публикуется только на `127.0.0.1:8080`; HTTPS даёт прокси (ниже). База — в томе `fah-data`.

### Вариант B — systemd + venv (это делает `deploy.sh`)

Код в `/opt/free-ai-hub/backend`, секреты в `/etc/free-ai-hub.env` (`chmod 640 root:fah`), данные в `/var/lib/free-ai-hub`, юнит `deploy/free-ai-hub.service` (пользователь `fah` без shell, `ProtectSystem=strict`, `NoNewPrivileges` и т. п.).

### HTTPS-прокси

* **Caddy** (проще всего, сертификат автоматически): `deploy/Caddyfile` → `/etc/caddy/Caddyfile`, заменить домен.
* **nginx**: `deploy/nginx.conf` + `certbot --nginx`. Обязательно `proxy_set_header X-Forwarded-For $remote_addr;` (перезапись, а не дописывание).
* За Cloudflare: включите `TRUST_PROXY=1` (используется `CF-Connecting-IP`), страна приходит в `CF-IPCountry`; порт приложения закройте фаерволом от всех, кроме прокси.

## deploy.sh — деплой по SSH

Данные сервера **не хранятся в репозитории**; задаются переменными окружения при запуске (их передаст владелец позже):

```bash
cd backend
cp .env.example .env && nano .env            # локально заполнить секреты (файл не коммитится)
SERVER_HOST=203.0.113.10 SERVER_USER=root SSH_KEY=~/.ssh/id_ed25519 \
ENV_FILE=./.env DOMAIN=chat-log.example.com ./deploy.sh
```

| Переменная | Смысл |
|---|---|
| `SERVER_HOST`, `SERVER_USER` | обязательно; пользователь — root либо с `sudo` без пароля |
| `SERVER_PORT` | порт SSH (22) |
| `SSH_KEY` | путь к приватному ключу (рекомендуется); либо `SERVER_PASSWORD` + установленный `sshpass` (не рекомендуется) |
| `ENV_FILE` | локальный `.env` → `/etc/free-ai-hub.env`; **существующий файл на сервере не перезаписывается**, пока не задан `FORCE_ENV=1` |
| `DOMAIN` | если на сервере есть Caddy — пропишет `/etc/caddy/Caddyfile` |
| `REMOTE_DIR` | каталог установки (`/opt/free-ai-hub`) |
| `DRY_RUN=1` | только показать шаги |

Что делает (повторный запуск безопасен): проверяет SSH → создаёт пользователя `fah` и каталоги → заливает `app/`, `requirements.txt`, `deploy/` → создаёт/обновляет venv → кладёт секреты → ставит systemd-юнит и перезапускает → (по `DOMAIN`) настраивает Caddy → проверяет `/api/health`. База не затрагивается.

После деплоя: в проекте сайта выполните `./set-backend-url.sh https://chat-log.example.com`, добавьте адрес сайта (GitHub Pages / `*.pages.dev` / домен) в `ALLOWED_ORIGINS` на сервере, пересоберите/задеплойте сайт.

## Резервное копирование SQLite

База — один файл (`DB_PATH`) + `-wal`/`-shm` рядом. **Не копируйте файл «на лету» через `cp`** — используйте онлайн-бэкап:

```bash
sqlite3 /var/lib/free-ai-hub/fah.db ".backup '/var/backups/fah-$(date +%F).db'"
# или без утилиты sqlite3:
python3 -c "import sqlite3,sys;s=sqlite3.connect('/var/lib/free-ai-hub/fah.db');d=sqlite3.connect(sys.argv[1]);s.backup(d)" /var/backups/fah-$(date +%F).db
chmod 600 /var/backups/fah-*.db
```
Cron (ежедневно 03:10, хранить 14 копий): `10 3 * * * root sqlite3 … && find /var/backups -name 'fah-*.db' -mtime +14 -delete`. Бэкапы содержат те же переписки — храните так же бережно (права 600, шифрование при выгрузке за пределы сервера) и помните про `RETENTION_DAYS`: старые бэкапы тоже нужно удалять. Восстановление: остановить сервис, подставить файл, запустить. Для Docker: `docker compose exec backend python -c "…backup…"` или `docker run --rm -v fah-data:/d -v $PWD:/b alpine cp /d/fah.db /b/` при остановленном контейнере.

## Тесты

`pytest -q` — авторизация (вход, кука, CSRF, блокировка, отзыв, подделка), валидация и лимиты размера, CORS/Origin, rate limit, срок хранения и фоновая очистка, экспорт, экранирование (XSS/CSV/SQL), заголовки безопасности, отсутствие сырого IP в базе.

## Не проверено

Docker-образ, `docker-compose.yml`, systemd-юнит, `Caddyfile`, `nginx.conf` и `deploy.sh` (кроме `DRY_RUN` и `bash -n`) **не запускались** — в среде разработки нет Docker/systemd/Caddy/nginx и сервера. Проверьте на тестовой машине перед боевым использованием.
