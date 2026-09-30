"""Настройки только из переменных окружения. Секретов в коде нет."""
from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass, field
from typing import Mapping

PLACEHOLDERS = {"", "change-me", "changeme", "change-me-please", "password", "admin"}

DEFAULT_ORIGINS = "https://joliks.github.io,http://127.0.0.1:*,http://localhost:*"


def _bool(v: str | None, default: bool) -> bool:
    if v is None or v.strip() == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _int(v: str | None, default: int, lo: int | None = None, hi: int | None = None) -> int:
    try:
        n = int(v) if v not in (None, "") else default
    except ValueError:
        n = default
    if lo is not None:
        n = max(lo, n)
    if hi is not None:
        n = min(hi, n)
    return n


def origin_pattern_to_regex(p: str) -> re.Pattern[str]:
    """`https://*.pages.dev` и `http://127.0.0.1:*` -> регулярное выражение (без «дырявых» * ).

    `*` в хосте = одна или несколько DNS-меток без «/», «@», «:»; `:*` в конце = любой порт.
    """
    p = p.strip().rstrip("/").lower()
    port = ""
    if p.endswith(":*"):
        p = p[:-2]
        port = r"(?::[0-9]{1,5})?"
    out = []
    for ch in p:
        if ch == "*":
            out.append(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*")  # только метки хоста
        else:
            out.append(re.escape(ch))
    return re.compile("^" + "".join(out) + port + "$")


@dataclass(frozen=True)
class Settings:
    db_path: str = "data/fah.db"
    secret_key: str = ""
    admin_password: str = ""
    admin_password_hash: str = ""
    allowed_origins: tuple[str, ...] = ()
    retention_days: int = 90
    max_text_chars: int = 20000
    max_body_bytes: int = 400_000
    rate_limit_per_min: int = 30
    rate_limit_delete_per_min: int = 10
    max_bytes_per_ip_day: int = 20_000_000
    max_db_mb: int = 2048
    trust_proxy: bool = False
    cookie_secure: bool = True
    admin_session_hours: int = 8
    login_max_fails: int = 5
    login_lock_minutes: int = 15
    login_global_max_fails: int = 50
    login_global_lock_minutes: int = 5
    login_fail_delay: float = 0.4
    ip_hash_rotate_daily: bool = True
    allow_no_origin: bool = False
    cleanup_interval_s: int = 3600
    secret_is_ephemeral: bool = False
    origin_regexes: tuple[re.Pattern[str], ...] = field(default=(), compare=False, repr=False)

    @property
    def admin_enabled(self) -> bool:
        return bool(self.admin_password_hash) or self.admin_password.lower() not in PLACEHOLDERS

    def origin_allowed(self, origin: str | None) -> bool:
        if not origin:
            return False
        o = origin.strip().lower()
        return any(r.match(o) for r in self.origin_regexes)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        e = os.environ if env is None else env
        secret = e.get("SECRET_KEY", "").strip()
        ephemeral = False
        if len(secret) < 16:
            secret = secrets.token_urlsafe(32)  # на время жизни процесса; админ-сессии не переживут рестарт
            ephemeral = True
        origins = tuple(x.strip() for x in e.get("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if x.strip())
        return cls(
            db_path=e.get("DB_PATH", "data/fah.db"),
            secret_key=secret,
            admin_password=e.get("ADMIN_PASSWORD", ""),
            admin_password_hash=e.get("ADMIN_PASSWORD_HASH", "").strip(),
            allowed_origins=origins,
            retention_days=_int(e.get("RETENTION_DAYS"), 90, 0, 36500),
            max_text_chars=_int(e.get("MAX_TEXT_CHARS"), 20000, 100, 200000),
            max_body_bytes=_int(e.get("MAX_BODY_BYTES"), 400_000, 1000, 5_000_000),
            rate_limit_per_min=_int(e.get("RATE_LIMIT_PER_MIN"), 30, 1, 100000),
            rate_limit_delete_per_min=_int(e.get("RATE_LIMIT_DELETE_PER_MIN"), 10, 1, 100000),
            max_bytes_per_ip_day=_int(e.get("MAX_BYTES_PER_IP_DAY"), 20_000_000, 1000),
            max_db_mb=_int(e.get("MAX_DB_MB"), 2048, 1),
            trust_proxy=_bool(e.get("TRUST_PROXY"), False),
            cookie_secure=_bool(e.get("COOKIE_SECURE"), True),
            admin_session_hours=_int(e.get("ADMIN_SESSION_HOURS"), 8, 1, 720),
            login_max_fails=_int(e.get("LOGIN_MAX_FAILS"), 5, 1, 1000),
            login_lock_minutes=_int(e.get("LOGIN_LOCK_MINUTES"), 15, 1, 10080),
            login_global_max_fails=_int(e.get("LOGIN_GLOBAL_MAX_FAILS"), 50, 1, 100000),
            login_global_lock_minutes=_int(e.get("LOGIN_GLOBAL_LOCK_MINUTES"), 5, 1, 10080),
            login_fail_delay=float(e.get("LOGIN_FAIL_DELAY", "0.4") or 0.4),
            ip_hash_rotate_daily=_bool(e.get("IP_HASH_ROTATE_DAILY"), True),
            allow_no_origin=_bool(e.get("ALLOW_NO_ORIGIN"), False),
            cleanup_interval_s=_int(e.get("CLEANUP_INTERVAL_S"), 3600, 1),
            secret_is_ephemeral=ephemeral,
            origin_regexes=tuple(origin_pattern_to_regex(o) for o in origins),
        )


def load_dotenv(path: str) -> int:
    """Мини-загрузчик .env (KEY=VALUE, # комментарии). Уже заданные переменные не перезаписывает."""
    n = 0
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                if k and k not in os.environ:
                    os.environ[k] = v
                    n += 1
    except FileNotFoundError:
        pass
    return n
