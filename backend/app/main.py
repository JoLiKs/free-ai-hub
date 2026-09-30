"""Free AI Hub — бэкенд: приём событий чата (/api/log) и админ-панель (/admin)."""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import re
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

from . import __version__
from .config import Settings, load_dotenv
from .db import Database
from .ratelimit import DailyQuota, LoginGuard, RateLimiter
from .security import AdminAuth, client_ip, country_from, hash_ip

log = logging.getLogger("fah")
STATIC = Path(__file__).parent / "static"

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
META_RE = re.compile(r"^[\w.\-:/@+()\[\] ]{1,100}$", re.UNICODE)
LANG_RE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$")
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MAX_SESSION_MESSAGES = 5000

CSP_ADMIN = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
             "font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'")
CSP_API = "default-src 'none'; frame-ancestors 'none'"


class Invalid(Exception):
    def __init__(self, msg: str, status: int = 422):
        super().__init__(msg)
        self.msg, self.status = msg, status


# ------------------------------------------------------------------ валидация ------------------------------------------------------------------
def _clean_text(v: Any, field: str, limit: int) -> tuple[str | None, bool]:
    if v is None:
        return None, False
    if not isinstance(v, str):
        raise Invalid(f"{field}: ожидается строка")
    v = CTRL_RE.sub("", v).replace("\r\n", "\n")
    if not v.strip():
        return None, False
    if len(v) > limit:
        return v[:limit], True
    return v, False


def _meta(v: Any, field: str) -> str | None:
    if v is None or v == "":
        return None
    if not isinstance(v, str) or not META_RE.match(v):
        raise Invalid(f"{field}: недопустимое значение")
    return v.strip()


def validate_event(data: Any, s: Settings) -> dict[str, Any]:
    """Проверяет тело /api/log и возвращает нормализованные поля. Бросает Invalid."""
    if not isinstance(data, dict):
        raise Invalid("Ожидается JSON-объект")
    sid = data.get("session_id")
    if not isinstance(sid, str) or not UUID_RE.match(sid.lower()):
        raise Invalid("session_id: ожидается UUID")
    chat = data.get("chat_id")
    if not isinstance(chat, str) or not ID_RE.match(chat):
        raise Invalid("chat_id: недопустимое значение")
    user_text, t1 = _clean_text(data.get("user_text"), "user_text", s.max_text_chars)
    asst_text, t2 = _clean_text(data.get("assistant_text"), "assistant_text", s.max_text_chars)
    if not user_text and not asst_text:
        raise Invalid("Нет текста для сохранения")
    slot = data.get("slot")
    if slot not in (None, "A", "B"):
        raise Invalid("slot: A или B")
    lang = data.get("lang")
    if lang is not None and (not isinstance(lang, str) or not LANG_RE.match(lang)):
        lang = None
    cts = data.get("ts")
    now = int(time.time() * 1000)
    if isinstance(cts, bool) or not isinstance(cts, (int, float)) or not (0 < cts < now + 86_400_000 * 2):
        cts = None
    eid = data.get("event_id")
    if eid is not None and (not isinstance(eid, str) or not ID_RE.match(eid)):
        raise Invalid("event_id: недопустимое значение")
    return {
        "session_id": sid.lower(), "chat_id": chat, "provider": _meta(data.get("provider"), "provider"),
        "model": _meta(data.get("model"), "model"), "slot": slot, "user_text": user_text, "assistant_text": asst_text,
        "event_id": eid, "client_ts": int(cts) if cts is not None else None, "lang": lang, "truncated": t1 or t2,
    }


# ------------------------------------------------------------------ приложение ------------------------------------------------------------------
def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        load_dotenv(".env")
        settings = Settings.from_env()
    s = settings
    db = Database(s.db_path)
    auth = AdminAuth(s)
    log_rl = RateLimiter(s.rate_limit_per_min, 60)
    del_rl = RateLimiter(s.rate_limit_delete_per_min, 60)
    admin_rl = RateLimiter(240, 60)
    quota = DailyQuota(s.max_bytes_per_ip_day)
    guard = LoginGuard(s.login_max_fails, s.login_lock_minutes * 60, s.login_global_max_fails, s.login_global_lock_minutes * 60)

    async def cleanup_loop() -> None:
        while True:
            try:
                r = await asyncio.to_thread(db.cleanup, s.retention_days)
                if r["messages"] or r["sessions"]:
                    log.info("retention cleanup: %s", r)
                for rl in (log_rl, del_rl, admin_rl):
                    rl.gc()
            except Exception:  # не даём задаче умереть
                log.exception("cleanup failed")
            await asyncio.sleep(s.cleanup_interval_s)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if s.secret_is_ephemeral:
            log.warning("SECRET_KEY не задан (или короче 16 символов): админ-сессии сбросятся при перезапуске")
        if not auth.enabled:
            log.warning("ADMIN_PASSWORD не задан: админ-панель отключена")
        task = asyncio.create_task(cleanup_loop())
        try:
            yield
        finally:
            task.cancel()

    app = FastAPI(title="Free AI Hub backend", version=__version__, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings, app.state.db, app.state.auth = s, db, auth
    app.state.guard, app.state.log_rl = guard, log_rl

    # -------------------------------------------------- middleware: CORS + заголовки безопасности --------------------------------------------------
    def is_public_cors_path(path: str) -> bool:
        return path == "/api/log" or path.startswith("/api/session/") or path == "/api/health"

    @app.middleware("http")
    async def security_and_cors(request: Request, call_next):
        path = request.url.path
        origin = request.headers.get("origin")
        cors_ok = bool(origin) and s.origin_allowed(origin) and is_public_cors_path(path)
        if request.method == "OPTIONS" and is_public_cors_path(path):
            if not cors_ok:
                resp: Response = PlainTextResponse("origin not allowed", status_code=403)
            else:
                resp = Response(status_code=204)
                resp.headers["Access-Control-Allow-Methods"] = "POST, DELETE, GET, OPTIONS"
                resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
                resp.headers["Access-Control-Max-Age"] = "600"
        else:
            try:
                resp = await call_next(request)
            except Exception:
                log.exception("unhandled error")
                resp = JSONResponse({"error": "internal"}, status_code=500)
        if cors_ok:
            resp.headers["Access-Control-Allow-Origin"] = origin  # type: ignore[assignment]
        if is_public_cors_path(path):
            resp.headers["Vary"] = "Origin"
            resp.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        else:
            resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        h = resp.headers
        h["X-Content-Type-Options"] = "nosniff"
        h["X-Frame-Options"] = "DENY"
        h["Referrer-Policy"] = "no-referrer"
        h["Permissions-Policy"] = "geolocation=(), camera=(), microphone=(), payment=(), usb=()"
        h["Cross-Origin-Opener-Policy"] = "same-origin"
        h["X-Robots-Tag"] = "noindex, nofollow"
        h["Content-Security-Policy"] = CSP_ADMIN if (path.startswith("/admin") or path == "/") else CSP_API
        h.setdefault("Cache-Control", "no-store")
        proto = request.headers.get("x-forwarded-proto", "") if s.trust_proxy else request.url.scheme
        if s.cookie_secure and proto == "https":
            h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return resp

    # -------------------------------------------------- вспомогательное --------------------------------------------------
    def ip_of(request: Request) -> str:
        peer = request.client.host if request.client else None
        return client_ip(request.headers, peer, s.trust_proxy)

    def ip_key(request: Request) -> str:
        return hash_ip(ip_of(request), s.secret_key, s.ip_hash_rotate_daily)

    def err(status: int, msg: str, headers: dict[str, str] | None = None) -> JSONResponse:
        return JSONResponse({"ok": False, "error": msg}, status_code=status, headers=headers)

    def check_public_origin(request: Request) -> JSONResponse | None:
        origin = request.headers.get("origin")
        if origin is None:
            if s.allow_no_origin:
                return None
            return err(403, "Origin required")
        if not s.origin_allowed(origin):
            return err(403, "Origin not allowed")
        return None

    async def read_body(request: Request, limit: int) -> bytes:
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > limit:
            raise Invalid("Слишком большое тело запроса", 413)
        buf = bytearray()
        async for chunk in request.stream():
            buf += chunk
            if len(buf) > limit:
                raise Invalid("Слишком большое тело запроса", 413)
        return bytes(buf)

    # -------------------------------------------------- публичный API --------------------------------------------------
    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "version": __version__, "time": int(time.time())}

    @app.post("/api/log")
    async def api_log(request: Request):
        bad = check_public_origin(request)
        if bad:
            return bad
        key = ip_key(request)
        ok, retry = log_rl.check(key)
        if not ok:
            return err(429, "Слишком много запросов", {"Retry-After": str(int(retry) + 1)})
        try:
            raw = await read_body(request, s.max_body_bytes)
            try:
                data = json.loads(raw.decode("utf-8"))   # принимаем и text/plain (sendBeacon без preflight)
            except (UnicodeDecodeError, ValueError):
                raise Invalid("Некорректный JSON", 400)
            ev = validate_event(data, s)
        except Invalid as e:
            return err(e.status, e.msg)
        if db.get_setting("logging_paused") == "1":
            return JSONResponse({"ok": True, "stored": 0, "paused": True})
        if db.size_bytes() > s.max_db_mb * 1024 * 1024:
            return err(507, "Хранилище заполнено")
        if not quota.add(key, len(raw)):
            return err(429, "Дневной лимит объёма исчерпан", {"Retry-After": "3600"})
        with db.connect() as c:
            n = c.execute("SELECT COUNT(*) FROM messages WHERE session_id=?", (ev["session_id"],)).fetchone()[0]
        if n >= MAX_SESSION_MESSAGES:
            return err(429, "Лимит сообщений в сессии")
        stored = db.log_event(
            session_id=ev["session_id"], chat_id=ev["chat_id"], provider=ev["provider"], model=ev["model"], slot=ev["slot"],
            user_text=ev["user_text"], assistant_text=ev["assistant_text"], event_id=ev["event_id"], client_ts=ev["client_ts"],
            lang=ev["lang"], origin=(request.headers.get("origin") or "")[:100] or None, country=country_from(request.headers), ip_hash=key,
        )
        return {"ok": True, "stored": stored, "truncated": ev["truncated"]}

    @app.delete("/api/session/{session_id}")
    def api_delete_session(session_id: str, request: Request):
        bad = check_public_origin(request)
        if bad:
            return bad
        ok, retry = del_rl.check(ip_key(request))
        if not ok:
            return err(429, "Слишком много запросов", {"Retry-After": str(int(retry) + 1)})
        sid = session_id.lower()
        if not UUID_RE.match(sid):
            return err(422, "session_id: ожидается UUID")
        # session_id — секрет-«ключ» владельца сеанса (случайный UUID v4); ответ одинаков, есть данные или нет
        n = db.delete_session(sid)
        return {"ok": True, "deleted": n}

    # -------------------------------------------------- админ: авторизация --------------------------------------------------
    def same_origin_ok(request: Request) -> bool:
        o = request.headers.get("origin")
        if not o:
            return True
        host = request.headers.get("host", "")
        try:
            return urlsplit(o).netloc.lower() == host.lower()
        except ValueError:
            return False

    def current(request: Request) -> dict[str, Any] | None:
        return auth.parse(request.cookies.get(auth.cookie_name)) if auth.enabled else None

    def require_admin(request: Request) -> dict[str, Any]:
        sess = current(request)
        if not sess:
            raise HTTPException(401, "Требуется вход")
        ok, _ = admin_rl.check(sess["sid"])
        if not ok:
            raise HTTPException(429, "Слишком много запросов")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            tok = request.headers.get("x-csrf-token", "")
            if not tok or not secrets.compare_digest(tok, sess["csrf"]):
                raise HTTPException(403, "CSRF-токен неверен")
            if not same_origin_ok(request):
                raise HTTPException(403, "Чужой Origin")
        return sess

    @app.exception_handler(HTTPException)
    async def http_exc(request: Request, exc: HTTPException):
        return JSONResponse({"ok": False, "error": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.post("/api/admin/login")
    async def admin_login(request: Request):
        if not same_origin_ok(request):
            return err(403, "Чужой Origin")
        if not auth.enabled:
            return err(503, "Админ-панель отключена: не задан ADMIN_PASSWORD")
        key = ip_key(request)
        wait = guard.locked_for(key)
        if wait > 0:
            return err(429, "Слишком много неудачных попыток. Подождите.", {"Retry-After": str(int(wait) + 1)})
        try:
            raw = await read_body(request, 4096)
            data = json.loads(raw.decode("utf-8"))
            pw = data.get("password") if isinstance(data, dict) else None
        except (Invalid, ValueError, UnicodeDecodeError):
            pw = None
        good = await asyncio.to_thread(auth.check_password, pw if isinstance(pw, str) else "")
        if not good:
            guard.fail(key)
            await asyncio.sleep(s.login_fail_delay)
            return err(401, "Неверный пароль")
        guard.success(key)
        token, payload = auth.issue()
        resp = JSONResponse({"ok": True, "csrf": payload["csrf"], "expires": payload["exp"]})
        resp.set_cookie(auth.cookie_name, token, max_age=s.admin_session_hours * 3600, httponly=True, secure=s.cookie_secure,
                        samesite="strict", path="/")
        return resp

    @app.post("/api/admin/logout")
    def admin_logout(request: Request):
        sess = require_admin(request)
        auth.revoke(sess)
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(auth.cookie_name, path="/", secure=s.cookie_secure, httponly=True, samesite="strict")
        return resp

    @app.get("/api/admin/me")
    def admin_me(request: Request):
        sess = current(request)
        if not sess:
            return {"authenticated": False, "admin_enabled": auth.enabled}
        return {"authenticated": True, "admin_enabled": True, "csrf": sess["csrf"], "expires": sess["exp"],
                "logging_paused": db.get_setting("logging_paused") == "1", "retention_days": s.retention_days,
                "version": __version__}

    # -------------------------------------------------- админ: данные --------------------------------------------------
    def qint(v: str | None, name: str) -> int | None:
        if v in (None, ""):
            return None
        try:
            return int(v)  # type: ignore[arg-type]
        except ValueError:
            raise HTTPException(422, f"{name}: ожидается целое число")

    def filters(request: Request) -> dict[str, Any]:
        p = request.query_params
        q = (p.get("q") or "").strip()[:200] or None
        return {"q": q, "provider": (p.get("provider") or None), "model": (p.get("model") or None),
                "since": qint(p.get("since"), "since"), "until": qint(p.get("until"), "until")}

    @app.get("/api/admin/sessions")
    def admin_sessions(request: Request):
        require_admin(request)
        p = request.query_params
        limit = min(max(qint(p.get("limit"), "limit") or 50, 1), 200)
        offset = max(qint(p.get("offset"), "offset") or 0, 0)
        return db.list_sessions(**filters(request), limit=limit, offset=offset)

    @app.get("/api/admin/sessions/{session_id}")
    def admin_session(session_id: str, request: Request):
        require_admin(request)
        r = db.get_session(session_id.lower()) if UUID_RE.match(session_id.lower()) else None
        if not r:
            raise HTTPException(404, "Сессия не найдена")
        return r

    @app.delete("/api/admin/sessions/{session_id}")
    def admin_delete_session(session_id: str, request: Request):
        require_admin(request)
        if not UUID_RE.match(session_id.lower()):
            raise HTTPException(422, "Некорректный id")
        return {"ok": True, "deleted": db.delete_session(session_id.lower())}

    @app.post("/api/admin/purge")
    async def admin_purge(request: Request):
        require_admin(request)
        try:
            data = json.loads((await read_body(request, 1024)).decode("utf-8"))
        except (Invalid, ValueError, UnicodeDecodeError):
            data = {}
        if not isinstance(data, dict) or data.get("confirm") != "DELETE ALL":
            raise HTTPException(422, 'Нужно подтверждение: {"confirm": "DELETE ALL"}')
        return {"ok": True, "deleted": await asyncio.to_thread(db.purge_all)}

    @app.get("/api/admin/facets")
    def admin_facets(request: Request):
        require_admin(request)
        return db.facets()

    @app.get("/api/admin/stats")
    def admin_stats(request: Request):
        require_admin(request)
        p = request.query_params
        days = min(max(qint(p.get("days"), "days") or 30, 1), 365)
        tz = min(max(qint(p.get("tz"), "tz") or 0, -840), 840)
        return db.stats(days, tz)

    def csv_cell(v: Any) -> Any:
        if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
            return "'" + v      # защита от CSV-инъекции формул при открытии в Excel
        return v

    @app.get("/api/admin/export")
    def admin_export(request: Request):
        require_admin(request)
        fmt = (request.query_params.get("format") or "json").lower()
        sid = (request.query_params.get("session_id") or "").lower() or None
        if sid and not UUID_RE.match(sid):
            raise HTTPException(422, "Некорректный session_id")
        rows = db.export_rows(session_id=sid, **filters(request))
        stamp = time.strftime("%Y%m%d-%H%M%S")
        if fmt == "csv":
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["session_id", "chat_id", "time_utc", "role", "provider", "model", "country", "lang", "text"])
            for r in rows:
                w.writerow([r["session_id"], r["chat_id"], time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(r["ts"] / 1000)),
                            r["role"], csv_cell(r["provider"] or ""), csv_cell(r["model"] or ""), r["country"] or "", r["lang"] or "",
                            csv_cell(r["text"])])
            body = "\ufeff" + buf.getvalue()   # BOM — чтобы Excel открыл кириллицу
            return Response(body.encode("utf-8"), media_type="text/csv; charset=utf-8",
                            headers={"Content-Disposition": f'attachment; filename="fah-export-{stamp}.csv"'})
        if fmt != "json":
            raise HTTPException(422, "format: json или csv")
        body = json.dumps({"exported_at": stamp, "count": len(rows), "messages": rows}, ensure_ascii=False, indent=1)
        return Response(body.encode("utf-8"), media_type="application/json; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="fah-export-{stamp}.json"'})

    @app.get("/api/admin/settings")
    def admin_get_settings(request: Request):
        require_admin(request)
        return {"logging_paused": db.get_setting("logging_paused") == "1", "retention_days": s.retention_days,
                "max_text_chars": s.max_text_chars, "rate_limit_per_min": s.rate_limit_per_min, "db_bytes": db.size_bytes()}

    @app.put("/api/admin/settings")
    async def admin_put_settings(request: Request):
        require_admin(request)
        try:
            data = json.loads((await read_body(request, 2048)).decode("utf-8"))
        except (Invalid, ValueError, UnicodeDecodeError):
            raise HTTPException(400, "Некорректный JSON")
        if not isinstance(data, dict) or not isinstance(data.get("logging_paused"), bool):
            raise HTTPException(422, "logging_paused: ожидается true/false")
        db.set_setting("logging_paused", "1" if data["logging_paused"] else "0")
        return {"ok": True, "logging_paused": data["logging_paused"]}

    @app.post("/api/admin/cleanup")
    async def admin_cleanup(request: Request):
        require_admin(request)
        return {"ok": True, **await asyncio.to_thread(db.cleanup, s.retention_days)}

    @app.api_route("/api/admin/{rest:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"], include_in_schema=False)
    def admin_unknown(rest: str, request: Request):
        require_admin(request)
        raise HTTPException(404, "Не найдено")

    # -------------------------------------------------- статика админки --------------------------------------------------
    ASSETS = {"app.js": "text/javascript; charset=utf-8", "admin.css": "text/css; charset=utf-8"}

    @app.get("/admin")
    @app.get("/admin/")
    def admin_index():
        return FileResponse(STATIC / "index.html", media_type="text/html; charset=utf-8")

    @app.get("/admin/{name}")
    def admin_asset(name: str):
        if name not in ASSETS:
            raise HTTPException(404, "Не найдено")
        return FileResponse(STATIC / name, media_type=ASSETS[name], headers={"Cache-Control": "no-cache"})

    @app.get("/robots.txt")
    def robots():
        return PlainTextResponse("User-agent: *\nDisallow: /\n")

    @app.get("/")
    def root():
        return PlainTextResponse("Free AI Hub backend. Health: /api/health\n")

    return app
