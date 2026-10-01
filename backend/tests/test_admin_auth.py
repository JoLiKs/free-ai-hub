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
    c = make_client(LOGIN_MAX_FAILS=2, TRUST_PROXY="1", TRUST_CF_IP="1")
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
    login(client)
    for path in ["/admin", "/admin/login.js", "/admin/panel/", "/admin/panel/app.js", "/api/health", "/"]:
        r = client.get(path)
        assert r.status_code == 200, path
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


def test_no_inline_script_or_style_in_admin_html(admin):
    import re
    for path in ("/admin", "/admin/panel/"):
        html = admin.get(path).text
        assert not re.search(r"<script(?![^>]*\bsrc=)", html), path
        assert "<style" not in html and " style=" not in html and " onclick=" not in html, path


def test_static_whitelist_no_traversal(admin):
    for p in ["/admin/../main.py", "/admin/%2e%2e/main.py", "/admin/main.py", "/admin/index.html", "/admin/..%2fconfig.py",
              "/admin/panel/../main.py", "/admin/panel/%2e%2e/main.py", "/admin/panel/main.py", "/admin/panel/index.html",
              "/admin/panel/..%2fconfig.py", "/admin/panel/login.html"]:
        assert admin.get(p).status_code in (404, 307, 400), p
    assert admin.get("/admin/panel/app.js").status_code == 200
    assert admin.get("/admin/panel/admin.css").status_code == 200


# ---- панель отдаётся только после входа ----
PANEL_FILES = ["/admin/panel/app.js", "/admin/panel/admin.css", "/admin/panel/app.js?x=1", "/admin/panel/nope.js"]


@pytest.mark.parametrize("path", PANEL_FILES)
def test_panel_assets_require_auth(client, path):
    r = client.get(path)
    assert r.status_code == 401
    assert "fetchJson" not in r.text and "logoutBtn" not in r.text and "mainView" not in r.text


def test_panel_index_redirects_to_login_without_session(client):
    for p in ("/admin/panel", "/admin/panel/"):
        r = client.get(p, follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == "/admin/"
        assert "mainView" not in r.text


def test_old_public_panel_paths_gone(client):
    for p in ("/admin/app.js", "/admin/admin.css", "/admin/index.html"):
        r = client.get(p)
        assert r.status_code == 404 and "logoutBtn" not in r.text and "api/admin" not in r.text


def test_login_page_public_and_has_no_panel_code(client):
    r = client.get("/admin")
    assert r.status_code == 200 and client.get("/admin/").status_code == 200
    assert 'id="loginForm"' in r.text and "mainView" not in r.text and "/admin/panel/" not in r.text
    js = client.get("/admin/login.js")
    assert js.status_code == 200 and "loadSessions" not in js.text and "export" not in js.text.lower().split("fetch")[0]
    assert client.get("/admin/login.css").status_code == 200


def test_panel_served_with_session_and_no_store(admin):
    r = admin.get("/admin/panel/")
    assert r.status_code == 200 and 'id="mainView"' in r.text and 'id="loginForm"' not in r.text
    assert "/admin/panel/app.js" in r.text and "/admin/panel/admin.css" in r.text
    assert r.headers["cache-control"] == "no-store"
    assert "script-src 'self'" in r.headers["content-security-policy"]
    js = admin.get("/admin/panel/app.js")
    assert js.status_code == 200 and js.headers["content-type"].startswith("text/javascript") and js.headers["cache-control"] == "no-store"
    assert admin.get("/admin/panel/admin.css").headers["content-type"].startswith("text/css")
    assert admin.get("/admin/panel/nope.js").status_code == 404


def test_panel_again_401_after_logout(admin):
    cookie = admin.cookies.get("fah_admin")
    assert admin.get("/admin/panel/app.js").status_code == 200
    assert admin.post("/api/admin/logout", headers=admin.h).status_code == 200
    admin.cookies.clear()
    assert admin.get("/admin/panel/app.js").status_code == 401
    admin.cookies.set("fah_admin", cookie)             # повтор старой куки
    assert admin.get("/admin/panel/app.js").status_code == 401
    assert admin.get("/admin/panel/", follow_redirects=False).status_code == 302


def test_panel_rejects_forged_cookie(client):
    client.cookies.set("fah_admin", "abc.def")
    assert client.get("/admin/panel/app.js").status_code == 401


# ---- прокси Cloudflare: секрет, IP, Origin ----
SECRET = "s" * 40
PROXY = {"X-FAH-Proxy-Secret": SECRET}


def proxied(ip, **extra):
    return {**PROXY, "X-FAH-Client-IP": ip, "Origin": "https://aihubai.site", **extra}


def test_short_proxy_secret_disables_proxy_mode(make_client):
    c = make_client(LOGIN_MAX_FAILS=2, PROXY_SECRET="short", ADMIN_ORIGINS="https://aihubai.site")
    assert c.app.state.settings.proxy_secret == ""
    h = {"X-FAH-Proxy-Secret": "short", "X-FAH-Client-IP": "9.9.9.9", "Origin": "https://aihubai.site"}
    assert c.post("/api/admin/login", json={"password": PASSWORD}, headers=h).status_code == 403   # чужой Origin


def test_proxy_origin_accepted_only_with_secret(make_client):
    c = make_client(PROXY_SECRET=SECRET, ADMIN_ORIGINS="https://aihubai.site,https://www.aihubai.site")
    o = {"Origin": "https://aihubai.site"}
    assert c.post("/api/admin/login", json={"password": PASSWORD}, headers=o).status_code == 403
    assert c.post("/api/admin/login", json={"password": PASSWORD}, headers={**o, "X-FAH-Proxy-Secret": "w" * 40}).status_code == 403
    r = c.post("/api/admin/login", json={"password": PASSWORD}, headers=proxied("5.5.5.5"))
    assert r.status_code == 200
    h = {"X-CSRF-Token": r.json()["csrf"]}
    assert c.post("/api/admin/cleanup", json={}, headers={**h, **proxied("5.5.5.5")}).status_code == 200
    assert c.post("/api/admin/cleanup", json={}, headers={**h, **proxied("5.5.5.5", Origin="https://www.aihubai.site")}).status_code == 200
    assert c.post("/api/admin/cleanup", json={}, headers={**h, **proxied("5.5.5.5", Origin="https://evil.com")}).status_code == 403
    assert c.post("/api/admin/cleanup", json={}, headers={**h, **proxied("5.5.5.5", Origin="https://aihubai.site.evil.com")}).status_code == 403
    assert c.post("/api/admin/cleanup", json={}, headers={**h, "Origin": "https://aihubai.site"}).status_code == 403   # без секрета


def test_admin_origin_not_enabled_by_default(make_client):
    c = make_client(PROXY_SECRET=SECRET)
    assert c.post("/api/admin/login", json={"password": PASSWORD}, headers=proxied("5.5.5.5")).status_code == 403


def test_lockout_keyed_on_proxied_client_ip(make_client):
    c = make_client(LOGIN_MAX_FAILS=2, TRUST_PROXY="1", PROXY_SECRET=SECRET, ADMIN_ORIGINS="https://aihubai.site")
    for _ in range(2):
        assert c.post("/api/admin/login", json={"password": "bad"}, headers=proxied("1.1.1.1")).status_code == 401
    assert c.post("/api/admin/login", json={"password": PASSWORD}, headers=proxied("1.1.1.1")).status_code == 429
    assert c.post("/api/admin/login", json={"password": PASSWORD}, headers=proxied("2.2.2.2")).status_code == 200


def test_spoofed_ip_headers_cannot_bypass_lockout(make_client):
    """Без верного секрета X-FAH-Client-IP и CF-Connecting-IP игнорируются: ротация «адресов» не сбрасывает блокировку."""
    c = make_client(LOGIN_MAX_FAILS=2, TRUST_PROXY="1", PROXY_SECRET=SECRET)
    for i in range(2):
        assert c.post("/api/admin/login", json={"password": "bad"},
                      headers={"X-FAH-Client-IP": f"7.7.7.{i}", "CF-Connecting-IP": f"8.8.8.{i}"}).status_code == 401
    r = c.post("/api/admin/login", json={"password": PASSWORD}, headers={"X-FAH-Client-IP": "7.7.7.99", "CF-Connecting-IP": "8.8.8.99",
                                                                          "X-FAH-Proxy-Secret": "x" * 40})
    assert r.status_code == 429
    r = c.post("/api/admin/login", json={"password": PASSWORD}, headers={"X-FAH-Client-IP": "7.7.7.5"})
    assert r.status_code == 429


def test_cf_connecting_ip_not_trusted_by_default(make_client):
    from app.security import client_ip
    assert client_ip({"cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9"}, "10.0.0.1", True) == "9.9.9.9"
    assert client_ip({"cf-connecting-ip": "1.2.3.4"}, "10.0.0.1", True, trust_cf_ip=True) == "1.2.3.4"
    assert client_ip({"cf-connecting-ip": "1.2.3.4"}, "10.0.0.1", False) == "10.0.0.1"
    assert client_ip({"x-fah-proxy-secret": SECRET, "x-fah-client-ip": "not-an-ip", "x-forwarded-for": "9.9.9.9"}, "10.0.0.1", True, SECRET) == "9.9.9.9"
    assert client_ip({"x-fah-proxy-secret": SECRET, "x-fah-client-ip": "2001:db8::1"}, "10.0.0.1", False, SECRET) == "2001:db8::1"
    assert client_ip({"x-fah-client-ip": "1.2.3.4"}, "10.0.0.1", True, SECRET) == "10.0.0.1"


def test_docs_and_openapi_disabled(client):
    for p in ["/docs", "/redoc", "/openapi.json"]:
        assert client.get(p).status_code == 404
