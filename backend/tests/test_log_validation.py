import uuid

from conftest import ORIGIN, event, post_log


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_log_ok_and_stored(admin):
    ev = event()
    r = post_log(admin, ev)
    assert r.status_code == 200 and r.json() == {"ok": True, "stored": 2, "truncated": False}
    d = admin.get(f"/api/admin/sessions/{ev['session_id']}").json()
    assert [m["role"] for m in d["messages"]] == ["user", "assistant"]
    assert d["messages"][0]["text"] == "Привет, как дела?"


def test_log_user_only_then_assistant_later(admin):
    ev = event(assistant_text=None)
    assert post_log(admin, ev).json()["stored"] == 1


def test_idempotent_event_id(admin):
    ev = event(event_id="evt1")
    assert post_log(admin, ev).json()["stored"] == 2
    assert post_log(admin, ev).json()["stored"] == 0


def test_text_plain_beacon_body(client):
    import json
    ev = event()
    r = client.post("/api/log", content=json.dumps(ev), headers={"Origin": ORIGIN, "Content-Type": "text/plain;charset=UTF-8"})
    assert r.status_code == 200


def test_bad_session_id(client):
    for bad in ["nope", "", None, 5, "../../etc/passwd", str(uuid.uuid4()) + "x"]:
        assert post_log(client, event(session_id=bad)).status_code == 422


def test_bad_chat_id_and_meta(client):
    assert post_log(client, event(chat_id="a b")).status_code == 422
    assert post_log(client, event(chat_id="x" * 200)).status_code == 422
    assert post_log(client, event(provider="<script>")).status_code == 422
    assert post_log(client, event(model="a" * 300)).status_code == 422
    assert post_log(client, event(slot="Z")).status_code == 422


def test_requires_text(client):
    assert post_log(client, event(user_text=None, assistant_text=None)).status_code == 422
    assert post_log(client, event(user_text="   ", assistant_text="")).status_code == 422
    assert post_log(client, event(user_text=123)).status_code == 422


def test_not_json_and_not_object(client):
    r = client.post("/api/log", content="{oops", headers={"Origin": ORIGIN})
    assert r.status_code == 400
    r = client.post("/api/log", json=[1, 2], headers={"Origin": ORIGIN})
    assert r.status_code == 422


def test_text_truncated_to_limit(admin):
    ev = event(user_text="я" * 25000)
    r = post_log(admin, ev)
    assert r.status_code == 200 and r.json()["truncated"] is True
    m = admin.get(f"/api/admin/sessions/{ev['session_id']}").json()["messages"][0]
    assert len(m["text"]) == 20000


def test_body_size_limit(make_client):
    c = make_client(MAX_BODY_BYTES=2000)
    r = post_log(c, event(user_text="a" * 5000))
    assert r.status_code == 413


def test_control_chars_stripped(admin):
    ev = event(user_text="a\x00b\x07c\nd")
    post_log(admin, ev)
    assert admin.get(f"/api/admin/sessions/{ev['session_id']}").json()["messages"][0]["text"] == "abc\nd"


def test_sql_injection_stored_literally(admin):
    evil = "'); DROP TABLE messages;-- %"
    ev = event(user_text=evil)
    assert post_log(admin, ev).status_code == 200
    assert admin.get(f"/api/admin/sessions/{ev['session_id']}").json()["messages"][0]["text"] == evil
    r = admin.get("/api/admin/sessions", params={"q": "'; drop table", "provider": "x' OR '1'='1"})
    assert r.status_code == 200 and r.json()["total"] == 0
    assert admin.get("/api/admin/sessions").json()["total"] == 1


def test_pause_logging(admin):
    assert admin.put("/api/admin/settings", json={"logging_paused": True}, headers=admin.h).status_code == 200
    r = post_log(admin, event())
    assert r.json()["stored"] == 0 and r.json()["paused"] is True
    admin.put("/api/admin/settings", json={"logging_paused": False}, headers=admin.h)
    assert post_log(admin, event()).json()["stored"] == 2


def test_db_full_rejected(make_client):
    c = make_client()
    c.app.state.settings.__dict__  # frozen dataclass: подменим размер через метод
    c.app.state.db.size_bytes = lambda: 10 * 1024 * 1024 * 1024
    assert post_log(c, event()).status_code == 507


def test_session_message_cap(make_client, monkeypatch):
    import app.main as m
    monkeypatch.setattr(m, "MAX_SESSION_MESSAGES", 2)
    c = make_client()
    sid = event()["session_id"]
    assert post_log(c, event(session_id=sid)).status_code == 200
    assert post_log(c, event(session_id=sid)).status_code == 429


def test_ip_not_stored_raw(admin):
    ev = event()
    post_log(admin, ev, headers={"X-Forwarded-For": "203.0.113.77", "CF-IPCountry": "de"})
    import sqlite3
    con = sqlite3.connect(admin.app.state.settings.db_path)
    dump = "\n".join(str(r) for r in con.execute("SELECT * FROM sessions"))
    con.close()
    assert "203.0.113.77" not in dump and "testclient" not in dump and "127.0.0.1" not in dump
    d = admin.get(f"/api/admin/sessions/{ev['session_id']}").json()
    assert d["session"]["country"] == "DE"
    assert "ip_hash" in d["session"] and len(d["session"]["ip_hash"]) == 20


def test_country_header_validation(admin):
    ev = event()
    post_log(admin, ev, headers={"CF-IPCountry": "<b>"})
    assert admin.get(f"/api/admin/sessions/{ev['session_id']}").json()["session"]["country"] is None
