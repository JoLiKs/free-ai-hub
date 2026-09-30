import json
import time

import pytest

from app.security import AdminAuth, make_password_hash, verify_password_hash
from conftest import ORIGIN, PASSWORD, event, login, make_settings, post_log

ADMIN_GETS = ["/api/admin/me-not", "/api/admin/sessions", "/api/admin/facets", "/api/admin/stats", "/api/admin/export",
              "/api/admin/settings", "/api/admin/sessions/00000000-0000-4000-8000-000000000001", "/api/admin/whatever"]


@pytest.mark.parametrize("path", ADMIN_GETS)
def test_admin_get_requires_auth(client, path):
    assert client.get(path).status_code == 401


def test_admin_writes_require_auth(client):
    for m, p in [("post", "/api/admin/purge"), ("put", "/api/admin/settings"), ("post", "/api/admin/cleanup"),
                 ("delete", "/api/admin/sessions/00000000-0000-4000-8000-000000000001"), ("post", "/api/admin/logout")]:
        assert getattr(client, m)(p).status_code == 401, p


def test_me_unauthenticated(client):
    assert client.get("/api/admin/me").json() == {"authenticated": False, "admin_enabled": True}


def test_wrong_password(client):
    assert login(client, "wrong").status_code == 401
    assert login(client, "").status_code == 401
    assert client.post("/api/admin/login", content="junk").status_code == 401
    assert client.post("/api/admin/login", json={"password": ["x"]}).status_code == 401


def test_login_cookie_flags(make_client):
    c = make_client(COOKIE_SECURE="1")
    r = login(c)
    assert r.status_code == 200
    sc = r.headers["set-cookie"]
    assert sc.startswith("__Host-fah_admin=")
    for flag in ("HttpOnly", "Secure", "SameSite=strict", "Path=/"):
        assert flag.lower() in sc.lower(), flag
    assert "domain" not in sc.lower()


def test_login_and_me(admin):
    me = admin.get("/api/admin/me").json()
    assert me["authenticated"] and me["csrf"] == admin.csrf


def test_csrf_required_for_state_changing(admin):
    sid = event()["session_id"]
    assert admin.delete(f"/api/admin/sessions/{sid}").status_code == 403
    assert admin.delete(f"/api/admin/sessions/{sid}", headers={"X-CSRF-Token": "bad"}).status_code == 403
    assert admin.post("/api/admin/purge", json={"confirm": "DELETE ALL"}).status_code == 403
    assert admin.put("/api/admin/settings", json={"logging_paused": True}).status_code == 403
    assert admin.post("/api/admin/cleanup", json={}).status_code == 403
    assert admin.delete(f"/api/admin/sessions/{sid}", headers=admin.h).status_code == 200


def test_csrf_foreign_origin_rejected(admin):
    r = admin.post("/api/admin/cleanup", json={}, headers={**admin.h, "Origin": "https://evil.com"})
    assert r.status_code == 403
    r = admin.post("/api/admin/cleanup", json={}, headers={**admin.h, "Origin": "http://testserver"})
    assert r.status_code == 200


def test_login_foreign_origin_rejected(client):
    r = client.post("/api/admin/login", json={"password": PASSWORD}, headers={"Origin": "https://evil.com"})
    assert r.status_code == 403


def test_purge_needs_confirmation(admin):
    post_log(admin, event())
    assert admin.post("/api/admin/purge", json={}, headers=admin.h).status_code == 422
    assert admin.get("/api/admin/sessions").json()["total"] == 1
    r = admin.post("/api/admin/purge", json={"confirm": "DELETE ALL"}, headers=admin.h)
    assert r.status_code == 200 and r.json()["deleted"] == 2
    assert admin.get("/api/admin/sessions").json()["total"] == 0


def test_logout_revokes_session(admin):
    cookie = admin.cookies.get("fah_admin")
    assert admin.post("/api/admin/logout", headers=admin.h).status_code == 200
    admin.cookies.set("fah_admin", cookie)     # злоумышленник повторяет старую куку
    assert admin.get("/api/admin/sessions").status_code == 401


def test_tampered_cookie_rejected(admin):
    c = admin.cookies.get("fah_admin")
    body, sig = c.split(".")
    for bad in [body + "." + sig[:-2] + "AA", body[:-1] + "A." + sig, "garbage", body + ".", "." + sig]:
        admin.cookies.set("fah_admin", bad)
        assert admin.get("/api/admin/sessions").status_code == 401


def test_expired_and_forged_session(tmp_path):
    a = AdminAuth(make_settings(tmp_path, ADMIN_SESSION_HOURS=1))
    tok, p = a.issue()
    assert a.parse(tok)
    import hmac, hashlib, base64
    expired = dict(p, exp=int(time.time()) - 5)
    body = base64.urlsafe_b64encode(json.dumps(expired).encode()).rstrip(b"=").decode()
    sig_ok_key = base64.urlsafe_b64encode(hmac.new(a._key, b"sess:" + body.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    assert a.parse(body + "." + sig_ok_key) is None          # подпись верна, но срок истёк
    other = AdminAuth(make_settings(tmp_path, SECRET_KEY="y" * 40))
    assert other.parse(tok) is None                          # чужой ключ


def test_password_change_invalidates_sessions(tmp_path):
    a = AdminAuth(make_settings(tmp_path))
    tok, _ = a.issue()
    b = AdminAuth(make_settings(tmp_path, ADMIN_PASSWORD="another-password-1"))
    assert b.parse(tok) is None


def test_brute_force_lockout(make_client):
    c = make_client(LOGIN_MAX_FAILS=3, LOGIN_LOCK_MINUTES=10)
    assert [login(c, "bad").status_code for _ in range(3)] == [401, 401, 401]
    r = login(c, "bad")
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert login(c, PASSWORD).status_code == 429       # даже верный пароль во время блокировки


def test_successful_login_resets_failures(make_client):
    c = make_client(LOGIN_MAX_FAILS=3)
    login(c, "bad"); login(c, "bad")
    assert login(c).status_code == 200
    login(c, "bad"); login(c, "bad")
    assert login(c).status_code == 200


def test_lockout_is_per_ip(make_client):
    c = make_client(LOGIN_MAX_FAILS=2, TRUST_PROXY="1")
    for _ in range(2):
        c.post("/api/admin/login", json={"password": "bad"}, headers={"CF-Connecting-IP": "1.1.1.1"})
    assert c.post("/api/admin/login", json={"password": PASSWORD}, headers={"CF-Connecting-IP": "1.1.1.1"}).status_code == 429
    assert c.post("/api/admin/login", json={"password": PASSWORD}, headers={"CF-Connecting-IP": "2.2.2.2"}).status_code == 200


def test_admin_disabled_without_password(make_client):
    c = make_client(ADMIN_PASSWORD="")
    assert login(c, "anything").status_code == 503
    assert c.get("/api/admin/sessions").status_code == 401
    c2 = make_client(ADMIN_PASSWORD="change-me")
    assert login(c2, "change-me").status_code == 503


def test_password_hash_env(make_client):
    h = make_password_hash("Sup3r-secret-pass")
    c = make_client(ADMIN_PASSWORD="", ADMIN_PASSWORD_HASH=h)
    assert login(c, "Sup3r-secret-pass").status_code == 200
    assert login(c, "nope").status_code == 401


def test_hash_roundtrip():
    h = make_password_hash("pässwörd")
    assert verify_password_hash("pässwörd", h) and not verify_password_hash("x", h)
    assert not verify_password_hash("x", "garbage") and not verify_password_hash("x", "scrypt$1$2")


def test_uses_constant_time_compare():
    import inspect
    from app import security
    assert "compare_digest" in inspect.getsource(security.verify_password_hash)


def test_security_headers(client):
    for path in ["/admin", "/admin/app.js", "/api/health", "/"]:
        r = client.get(path)
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    csp = client.get("/admin").headers["content-security-policy"]
    assert "script-src 'self'" in csp and "unsafe-inline" not in csp and "unsafe-eval" not in csp and "default-src 'none'" in csp
    assert client.get("/api/health").headers["cache-control"] == "no-store"


def test_hsts_only_on_https(make_client):
    c = make_client(COOKIE_SECURE="1", TRUST_PROXY="1")
    assert "strict-transport-security" not in c.get("/api/health").headers
    assert "max-age" in c.get("/api/health", headers={"X-Forwarded-Proto": "https"}).headers["strict-transport-security"]


def test_no_inline_script_or_style_in_admin_html(client):
    html = client.get("/admin").text
    import re
    assert not re.search(r"<script(?![^>]*\bsrc=)", html)
    assert "<style" not in html and " style=" not in html and " onclick=" not in html


def test_static_whitelist_no_traversal(client):
    for p in ["/admin/../main.py", "/admin/%2e%2e/main.py", "/admin/main.py", "/admin/index.html", "/admin/..%2fconfig.py"]:
        assert client.get(p).status_code in (404, 307, 400), p
    assert client.get("/admin/app.js").status_code == 200
    assert client.get("/admin/admin.css").status_code == 200


def test_docs_and_openapi_disabled(client):
    for p in ["/docs", "/redoc", "/openapi.json"]:
        assert client.get(p).status_code == 404
