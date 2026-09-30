#!/usr/bin/env bash
# Включает / выключает рекламу Google AdSense: пишет js/config.js и создаёт (или удаляет) ads.txt.
# Использование:
#   ./set-ads.sh ca-pub-1234567890123456            # авто-реклама (без блока на странице)
#   ./set-ads.sh ca-pub-1234567890123456 9876543210 # + плашка «Реклама» внизу боковой панели (ID рекламного блока)
#   ./set-ads.sh ""                                 # выключить рекламу и удалить ads.txt
set -euo pipefail
client="${1-}"
slot="${2-}"
if [ -n "$client" ] && ! [[ "$client" =~ ^ca-pub-[0-9]{10,20}$ ]]; then
  echo "Ошибка: ID издателя должен иметь вид ca-pub-XXXXXXXXXXXXXXXX (10–20 цифр)." >&2; exit 1
fi
if [ -n "$slot" ] && ! [[ "$slot" =~ ^[0-9]{5,20}$ ]]; then
  echo "Ошибка: ID рекламного блока (slot) — только цифры (5–20)." >&2; exit 1
fi
if [ -z "$client" ] && [ -n "$slot" ]; then echo "Ошибка: slot без ID издателя не имеет смысла." >&2; exit 1; fi
cd "$(dirname "$0")"
python3 - "$client" "$slot" <<'PY'
import re, sys
client, slot = sys.argv[1], sys.argv[2]
p = "js/config.js"
t = open(p, encoding="utf-8").read()
for name, val in (("ADSENSE_CLIENT", client), ("ADSENSE_SLOT", slot)):
    pat = r"export const %s = '[^']*';" % name
    if not re.search(pat, t):
        sys.exit("%s не найден в js/config.js" % name)
    t = re.sub(pat, lambda m: "export const %s = '%s';" % (name, val), t)
open(p, "w", encoding="utf-8").write(t)
print("ADSENSE_CLIENT ->", repr(client), "| ADSENSE_SLOT ->", repr(slot))
PY
if [ -n "$client" ]; then
  printf 'google.com, pub-%s, DIRECT, f08c47fec0942fa0\n' "${client#ca-pub-}" > ads.txt
  echo "ads.txt создан: $(cat ads.txt)"
else
  rm -f ads.txt; echo "ads.txt удалён (реклама выключена)"
fi
