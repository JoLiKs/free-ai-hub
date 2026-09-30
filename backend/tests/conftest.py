import os
import sys
import uuid

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

ORIGIN = "https://joliks.github.io"
PASSWORD = "correct-horse-battery"


def make_settings(tmp_path, **over):
    env = {
        "DB_PATH": str(tmp_path / "t.db"), "SECRET_KEY": "x" * 40, "ADMIN_PASSWORD": PASSWORD,
        "ALLOWED_ORIGINS": "https://joliks.github.io,https://*.pages.dev,https://chat.example.com,http://127.0.0.1:*",
        "COOKIE_SECURE": "0", "LOGIN_FAIL_DELAY": "0", "RATE_LIMIT_PER_MIN": "1000",
    }
    env.update({k: str(v) for k, v in over.items()})
    return Settings.from_env(env)


@pytest.fixture
def make_client(tmp_path):
    clients = []

    def _mk(**over):
        app = create_app(make_settings(tmp_path, **over))
        c = TestClient(app, base_url="http://testserver")
        c.__enter__()
        clients.append(c)
        return c

    yield _mk
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client):
    return make_client()


def event(**over):
    e = {"session_id": str(uuid.uuid4()), "chat_id": "chat1", "provider": "ovh", "model": "gpt-oss-20b",
         "user_text": "Привет, как дела?", "assistant_text": "Отлично!", "ts": 1_780_000_000_000, "lang": "ru-RU"}
    e.update(over)
    return e


def post_log(client, ev, origin=ORIGIN, headers=None):
    h = {"Origin": origin} if origin else {}
    h.update(headers or {})
    return client.post("/api/log", json=ev, headers=h)


def login(client, pw=PASSWORD):
    r = client.post("/api/admin/login", json={"password": pw})
    return r


@pytest.fixture
def admin(client):
    r = login(client)
    assert r.status_code == 200, r.text
    client.csrf = r.json()["csrf"]
    client.h = {"X-CSRF-Token": client.csrf}
    return client
