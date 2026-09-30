#!/usr/bin/env bash
# Подставляет адрес бэкенда в js/config.js (или очищает его: ./set-backend-url.sh "").
# Использование: ./set-backend-url.sh https://chat-log.example.com
set -euo pipefail
url="${1-}"
url="${url%/}"
if [ -n "$url" ] && ! [[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ || "$url" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]]; then
  echo "Ошибка: нужен адрес вида https://host[:port] (без пути и «/» в конце)." >&2; exit 1
fi
cd "$(dirname "$0")"
python3 - "$url" <<'PY'
import re, sys
url = sys.argv[1]
p = "js/config.js"
t = open(p, encoding="utf-8").read()
t2 = re.sub(r"export const BACKEND_URL = '[^']*';", "export const BACKEND_URL = '%s';" % url, t)
if t2 == t and ("'%s'" % url) not in t:
    sys.exit("BACKEND_URL не найден в js/config.js")
open(p, "w", encoding="utf-8").write(t2)
print("BACKEND_URL ->", repr(url))
PY
