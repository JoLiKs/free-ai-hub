#!/usr/bin/env bash
# Идемпотентный деплой бэкенда на СВОЙ сервер по SSH (systemd + venv). Можно запускать повторно: обновит код и перезапустит сервис.
#
# Параметры — ТОЛЬКО через переменные окружения (в репозиторий не записываются):
#   SERVER_HOST   обязательно  адрес сервера (например 203.0.113.10 или chat-log.example.com)
#   SERVER_USER   обязательно  пользователь SSH (нужен root или sudo без пароля)
#   SERVER_PORT   по умолчанию 22
#   SSH_KEY       путь к приватному ключу (по умолчанию — из ssh-agent/по умолчанию ~/.ssh)
#   SERVER_PASSWORD  (не рекомендуется) пароль SSH — используется, только если установлен sshpass; лучше ключ
#   REMOTE_DIR    по умолчанию /opt/free-ai-hub
#   DOMAIN        необязательно  домен для HTTPS (если задан и стоит Caddy — будет записан /etc/caddy/Caddyfile)
#   ENV_FILE      необязательно  локальный .env с секретами → копируется в /etc/free-ai-hub.env (chmod 600), только если там его ещё нет
#                 или FORCE_ENV=1
#   DRY_RUN=1     показать шаги, ничего не выполняя
#
# Пример:
#   SERVER_HOST=203.0.113.10 SERVER_USER=root SSH_KEY=~/.ssh/id_ed25519 ENV_FILE=./.env DOMAIN=chat-log.example.com ./deploy.sh
set -euo pipefail

: "${SERVER_HOST:?Задайте SERVER_HOST}"
: "${SERVER_USER:?Задайте SERVER_USER}"
SERVER_PORT="${SERVER_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/free-ai-hub}"
DOMAIN="${DOMAIN:-}"
ENV_FILE="${ENV_FILE:-}"
FORCE_ENV="${FORCE_ENV:-0}"
DRY_RUN="${DRY_RUN:-0}"
HERE="$(cd "$(dirname "$0")" && pwd)"

SSH_OPTS=(-p "$SERVER_PORT" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
PREFIX=()
if [ -n "${SERVER_PASSWORD:-}" ]; then
  command -v sshpass >/dev/null || { echo "SERVER_PASSWORD задан, но sshpass не установлен. Используйте SSH_KEY." >&2; exit 1; }
  export SSHPASS="$SERVER_PASSWORD"; PREFIX=(sshpass -e)
fi
TARGET="$SERVER_USER@$SERVER_HOST"
SUDO=""; [ "$SERVER_USER" != "root" ] && SUDO="sudo"

run()  { if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] ssh $TARGET: $*"; else "${PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; fi; }
say()  { echo "==> $*"; }

say "Проверка соединения с $TARGET:$SERVER_PORT"
run "echo ok && uname -sr"

say "Подготовка каталогов и пользователя (идемпотентно)"
run "$SUDO bash -s" <<REMOTE
set -euo pipefail
id fah >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin fah
mkdir -p "$REMOTE_DIR/backend" /var/lib/free-ai-hub
chown -R fah:fah /var/lib/free-ai-hub && chmod 700 /var/lib/free-ai-hub
command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }
python3 -c 'import venv, ensurepip' 2>/dev/null || { apt-get update -qq && apt-get install -y -qq python3-venv; }
REMOTE

say "Загрузка кода (только backend/app, requirements.txt, deploy/)"
if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] tar backend | ssh → $REMOTE_DIR/backend"; else
  tar -C "$HERE" --exclude='__pycache__' --exclude='*.pyc' -czf - app requirements.txt deploy \
    | "${PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$TARGET" "$SUDO tar -xzf - -C '$REMOTE_DIR/backend' && $SUDO chown -R root:root '$REMOTE_DIR/backend'"
fi

say "venv и зависимости"
run "$SUDO bash -s" <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
REMOTE

if [ -n "$ENV_FILE" ]; then
  say "Секреты → /etc/free-ai-hub.env"
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] scp $ENV_FILE"; else
    if [ "$FORCE_ENV" = 1 ] || ! "${PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$TARGET" "test -f /etc/free-ai-hub.env"; then
      "${PREFIX[@]}" ssh "${SSH_OPTS[@]}" "$TARGET" "$SUDO sh -c 'umask 077; cat > /etc/free-ai-hub.env'" < "$ENV_FILE"
      run "$SUDO chown root:fah /etc/free-ai-hub.env && $SUDO chmod 640 /etc/free-ai-hub.env"
    else echo "   /etc/free-ai-hub.env уже существует — не трогаю (FORCE_ENV=1 чтобы заменить)"; fi
  fi
else
  run "test -f /etc/free-ai-hub.env" || { echo "!! На сервере нет /etc/free-ai-hub.env. Передайте ENV_FILE=./.env (см. .env.example)." >&2; exit 1; }
fi

say "systemd unit"
run "$SUDO install -m 644 '$REMOTE_DIR/backend/deploy/free-ai-hub.service' /etc/systemd/system/free-ai-hub.service && $SUDO systemctl daemon-reload && $SUDO systemctl enable free-ai-hub >/dev/null 2>&1 && $SUDO systemctl restart free-ai-hub"

if [ -n "$DOMAIN" ]; then
  say "HTTPS-прокси для $DOMAIN"
  run "$SUDO bash -s" <<REMOTE
set -euo pipefail
if command -v caddy >/dev/null; then
  sed 's/chat-log.example.com/$DOMAIN/g' "$REMOTE_DIR/backend/deploy/Caddyfile" > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
  echo "Caddy настроен."
else
  echo "Caddy не установлен. Установите Caddy (https://caddyserver.com/docs/install) или используйте deploy/nginx.conf вручную." >&2
fi
REMOTE
fi

say "Проверка здоровья"
run "for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS http://127.0.0.1:8080/api/health && exit 0; sleep 1; done; echo 'НЕ отвечает'; $SUDO journalctl -u free-ai-hub -n 30 --no-pager; exit 1"
say "Готово. Админка: https://${DOMAIN:-<домен>}/admin"
