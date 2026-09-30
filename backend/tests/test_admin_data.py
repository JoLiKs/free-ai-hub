import csv
import io
import json
import re
import uuid

from conftest import event, post_log


def seed(c):
    a = event(provider="ovh", model="gpt-oss-20b", user_text="Расскажи про Python", assistant_text="Python — язык")
    b = event(provider="chat", model="gpt-4o", user_text="How to bake bread?", assistant_text="Mix flour")
    c2 = event(provider="ovh", model="qwen", user_text="Погода в Минске", assistant_text=None)
    for e in (a, b, c2):
        assert post_log(c, e).status_code == 200
    return a, b, c2


def test_list_search_and_filters(admin):
    a, b, c2 = seed(admin)
    assert admin.get("/api/admin/sessions").json()["total"] == 3
    r = admin.get("/api/admin/sessions", params={"q": "python"}).json()       # регистр
    assert [x["session_id"] for x in r["items"]] == [a["session_id"]]
    assert admin.get("/api/admin/sessions", params={"q": "ПОГОДА"}).json()["total"] == 1    # кириллица без учёта регистра
    assert admin.get("/api/admin/sessions", params={"provider": "ovh"}).json()["total"] == 2
    assert admin.get("/api/admin/sessions", params={"provider": "ovh", "model": "qwen"}).json()["total"] == 1
    assert admin.get("/api/admin/sessions", params={"since": 4_000_000_000_000}).json()["total"] == 0
    assert admin.get("/api/admin/sessions", params={"until": 1}).json()["total"] == 0
    assert admin.get("/api/admin/sessions", params={"since": "abc"}).status_code == 422
    r = admin.get("/api/admin/sessions", params={"limit": 1, "offset": 1}).json()
    assert r["total"] == 3 and len(r["items"]) == 1


def test_like_wildcards_are_literal(admin):
    seed(admin)
    assert admin.get("/api/admin/sessions", params={"q": "%"}).json()["total"] == 0
    assert admin.get("/api/admin/sessions", params={"q": "_"}).json()["total"] == 0


def test_facets(admin):
    seed(admin)
    f = admin.get("/api/admin/facets").json()
    assert f["providers"] == ["chat", "ovh"]
    assert {"provider": "ovh", "model": "qwen"} in f["models"]


def test_stats(admin):
    import time
    seed(admin)
    s = admin.get("/api/admin/stats", params={"days": 3650 // 10}).json()
    assert s["total_sessions"] == 3 and s["total_messages"] == 5
    assert {p["name"]: p["n"] for p in s["providers"]} == {"ovh": 2, "chat": 1}
    assert sum(d["user_msgs"] for d in s["per_day"]) == 3
    assert s["models"][0]["n"] == 1


def test_delete_session_admin(admin):
    a, b, _ = seed(admin)
    r = admin.delete(f"/api/admin/sessions/{a['session_id']}", headers=admin.h)
    assert r.json()["deleted"] == 2
    assert admin.get("/api/admin/sessions").json()["total"] == 2
    assert admin.get(f"/api/admin/sessions/{a['session_id']}").status_code == 404
    assert admin.get("/api/admin/sessions/not-a-uuid").status_code == 404


def test_export_json_csv(admin):
    a, _, _ = seed(admin)
    r = admin.get("/api/admin/export", params={"format": "json"})
    d = r.json()
    assert d["count"] == 5 and "attachment" in r.headers["content-disposition"]
    r = admin.get("/api/admin/export", params={"format": "csv", "session_id": a["session_id"]})
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0][0] == "session_id" and len(rows) == 3 and rows[1][-1] == "Расскажи про Python"
    assert admin.get("/api/admin/export", params={"format": "xml"}).status_code == 422
    assert admin.get("/api/admin/export", params={"format": "csv", "session_id": "bad"}).status_code == 422


def test_csv_formula_injection_neutralised(admin):
    e = event(user_text="=HYPERLINK(\"http://evil\",\"x\")", assistant_text="+cmd|' /C calc'!A0")
    post_log(admin, e)
    r = admin.get("/api/admin/export", params={"format": "csv"})
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert all(not row[-1].startswith(("=", "+", "-", "@")) for row in rows[1:])


def test_xss_payload_returned_as_data_only(admin):
    """Сервер отдаёт текст как есть в JSON (application/json); безопасность вывода — на клиенте (textContent)."""
    payload = '<img src=x onerror=alert(1)><script>alert(2)</script>'
    e = event(user_text=payload, assistant_text=payload)
    post_log(admin, e)
    r = admin.get(f"/api/admin/sessions/{e['session_id']}")
    assert r.headers["content-type"].startswith("application/json")
    assert r.json()["messages"][0]["text"] == payload
    ex = admin.get("/api/admin/export", params={"format": "json"})
    assert ex.headers["content-type"].startswith("application/json") and ex.headers["x-content-type-options"] == "nosniff"


def test_admin_js_never_uses_innerhtml(client):
    js = client.get("/admin/app.js").text
    for bad in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "srcdoc"):
        assert bad not in js, bad


def test_settings_validation(admin):
    assert admin.put("/api/admin/settings", json={"logging_paused": "yes"}, headers=admin.h).status_code == 422
    assert admin.put("/api/admin/settings", content="x", headers=admin.h).status_code == 400
    assert admin.get("/api/admin/settings").json()["logging_paused"] is False


def test_pause_persists_across_restart(tmp_path):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from conftest import login, make_settings
    s = make_settings(tmp_path)
    with TestClient(create_app(s)) as c:
        csrf = login(c).json()["csrf"]
        c.put("/api/admin/settings", json={"logging_paused": True}, headers={"X-CSRF-Token": csrf})
    with TestClient(create_app(s)) as c2:
        assert post_log(c2, event()).json()["paused"] is True
