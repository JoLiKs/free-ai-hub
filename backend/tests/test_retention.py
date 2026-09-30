import time

from app.db import Database
from conftest import event, make_settings, post_log


def add(db, sid, ts, text="hi"):
    db.log_event(session_id=sid, chat_id="c", provider="ovh", model="m", slot="A", user_text=text, assistant_text=None,
                 event_id=None, client_ts=None, lang="ru", origin=None, country=None, ip_hash="h", now_ms=ts)


def test_cleanup_removes_old_only(tmp_path):
    db = Database(str(tmp_path / "r.db"))
    now = int(time.time() * 1000)
    day = 86_400_000
    add(db, "00000000-0000-4000-8000-000000000001", now - 100 * day)
    add(db, "00000000-0000-4000-8000-000000000002", now - 10 * day)
    r = db.cleanup(90, now)
    assert r["messages"] == 1 and r["sessions"] == 1
    assert db.list_sessions()["total"] == 1
    assert db.get_session("00000000-0000-4000-8000-000000000001") is None


def test_cleanup_zero_keeps_all(tmp_path):
    db = Database(str(tmp_path / "r.db"))
    add(db, "00000000-0000-4000-8000-000000000001", 1000)
    assert db.cleanup(0) == {"messages": 0, "sessions": 0}
    assert db.list_sessions()["total"] == 1


def test_cleanup_endpoint_uses_setting(make_client):
    c = make_client(RETENTION_DAYS=30)
    from conftest import login
    csrf = login(c).json()["csrf"]
    db = c.app.state.db
    add(db, "00000000-0000-4000-8000-000000000001", int(time.time() * 1000) - 40 * 86_400_000)
    r = c.post("/api/admin/cleanup", json={}, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200 and r.json()["messages"] == 1


def test_background_task_runs(tmp_path):
    from fastapi.testclient import TestClient
    from app.main import create_app
    s = make_settings(tmp_path, RETENTION_DAYS=1, CLEANUP_INTERVAL_S=1)
    db = Database(s.db_path)
    add(db, "00000000-0000-4000-8000-000000000001", 1000)
    with TestClient(create_app(s)) as c:
        for _ in range(30):
            if db.list_sessions()["total"] == 0:
                break
            time.sleep(0.1)
    assert db.list_sessions()["total"] == 0


def test_default_retention_is_90():
    from app.config import Settings
    assert Settings.from_env({}).retention_days == 90


def test_dotenv_loader(tmp_path, monkeypatch):
    from app.config import load_dotenv
    f = tmp_path / ".env"
    f.write_text('# c\nFOO_T1=bar\nQ_T1="quoted value"\nEXISTING_T1=new\n\nbad line\n')
    monkeypatch.setenv("EXISTING_T1", "old")
    monkeypatch.delenv("FOO_T1", raising=False)
    monkeypatch.delenv("Q_T1", raising=False)
    import os
    assert load_dotenv(str(f)) == 2
    assert os.environ["FOO_T1"] == "bar" and os.environ["Q_T1"] == "quoted value" and os.environ["EXISTING_T1"] == "old"
    monkeypatch.delenv("FOO_T1"); monkeypatch.delenv("Q_T1")


def test_example_env_keeps_admin_disabled():
    from app.config import Settings, load_dotenv
    import os
    env = {}
    for line in open(os.path.join(os.path.dirname(__file__), "..", ".env.example")):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v.split("#")[0].strip()
    s = Settings.from_env(env)
    assert s.admin_enabled is False and s.secret_is_ephemeral is True   # шаблонные значения не дают доступа
