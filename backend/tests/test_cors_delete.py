import uuid

from conftest import ORIGIN, event, post_log


def test_cors_allowed_origins(client):
    for o in [ORIGIN, "https://myapp.pages.dev", "https://chat.example.com", "http://127.0.0.1:8138", "http://127.0.0.1"]:
        r = client.options("/api/log", headers={"Origin": o, "Access-Control-Request-Method": "POST"})
        assert r.status_code == 204, o
        assert r.headers["access-control-allow-origin"] == o
        r = post_log(client, event(), origin=o)
        assert r.status_code == 200 and r.headers["access-control-allow-origin"] == o


def test_cors_rejected_origins(client):
    for o in ["https://evil.com", "https://joliks.github.io.evil.com", "https://evilpages.dev", "http://joliks.github.io",
              "https://pages.dev", "https://a.pages.dev.evil.com", "http://127.0.0.1.evil.com", "null", "https://x@joliks.github.io"]:
        r = client.options("/api/log", headers={"Origin": o, "Access-Control-Request-Method": "POST"})
        assert r.status_code == 403, o
        r = post_log(client, event(), origin=o)
        assert r.status_code == 403 and "access-control-allow-origin" not in r.headers, o


def test_missing_origin_rejected_by_default(client):
    assert post_log(client, event(), origin=None).status_code == 403


def test_missing_origin_allowed_when_enabled(make_client):
    c = make_client(ALLOW_NO_ORIGIN="1")
    assert post_log(c, event(), origin=None).status_code == 200


def test_admin_api_has_no_cors(admin):
    r = admin.get("/api/admin/me", headers={"Origin": ORIGIN})
    assert "access-control-allow-origin" not in r.headers
    r = admin.options("/api/admin/sessions", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers


def test_delete_own_session(admin):
    ev = event()
    post_log(admin, ev)
    other = event()
    post_log(admin, other)
    r = admin.delete(f"/api/session/{ev['session_id']}", headers={"Origin": ORIGIN})
    assert r.status_code == 200 and r.json()["deleted"] == 2
    assert admin.get(f"/api/admin/sessions/{ev['session_id']}").status_code == 404
    assert admin.get(f"/api/admin/sessions/{other['session_id']}").status_code == 200
    # повторное удаление и «чужой» id отвечают одинаково (не раскрываем существование)
    r2 = admin.delete(f"/api/session/{uuid.uuid4()}", headers={"Origin": ORIGIN})
    assert r2.status_code == 200 and r2.json()["deleted"] == 0


def test_delete_requires_valid_origin_and_uuid(client):
    sid = str(uuid.uuid4())
    assert client.delete(f"/api/session/{sid}", headers={"Origin": "https://evil.com"}).status_code == 403
    assert client.delete(f"/api/session/{sid}").status_code == 403
    assert client.delete("/api/session/not-a-uuid", headers={"Origin": ORIGIN}).status_code == 422
    r = client.options(f"/api/session/{sid}", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "DELETE"})
    assert r.status_code == 204 and "DELETE" in r.headers["access-control-allow-methods"]


def test_delete_rate_limited(make_client):
    c = make_client(RATE_LIMIT_DELETE_PER_MIN=3)
    codes = [c.delete(f"/api/session/{uuid.uuid4()}", headers={"Origin": ORIGIN}).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
