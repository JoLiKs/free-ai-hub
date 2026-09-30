"""SQLite (stdlib). Все запросы параметризованы; значения никогда не подставляются в SQL строкой."""
from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  country      TEXT,
  ip_hash      TEXT,
  lang         TEXT,
  origin       TEXT,
  last_provider TEXT,
  last_model   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  chat_id     TEXT NOT NULL,
  ts          INTEGER NOT NULL,          -- время приёма на сервере, мс UTC
  client_ts   INTEGER,                   -- время на клиенте, мс UTC (справочно)
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  provider    TEXT,
  model       TEXT,
  slot        TEXT,
  event_id    TEXT,
  text        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);
CREATE INDEX IF NOT EXISTS idx_messages_provider ON messages(provider, model);
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_event ON messages(session_id, event_id, role) WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


def _ulower(s: Any) -> Any:
    # SQLite lower()/LIKE регистронезависимы только для ASCII; для кириллицы нужна своя функция.
    return s.casefold() if isinstance(s, str) else s


def like_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class Database:
    def __init__(self, path: str):
        self.path = path
        d = os.path.dirname(os.path.abspath(path))
        if path != ":memory:":
            os.makedirs(d, exist_ok=True)
            try:
                os.chmod(d, 0o700)
            except OSError:
                pass
        with self.connect() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript(SCHEMA)
        if path != ":memory:":
            for suffix in ("", "-wal", "-shm"):
                try:
                    os.chmod(path + suffix, 0o600)
                except OSError:
                    pass

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA secure_delete=ON")   # удалённый текст затирается нулями
        conn.execute("PRAGMA busy_timeout=10000")
        conn.create_function("ulower", 1, _ulower, deterministic=True)
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            try:
                yield c
            except BaseException:
                c.execute("ROLLBACK")
                raise
            else:
                c.execute("COMMIT")

    # ---------- размер ----------
    def size_bytes(self) -> int:
        if self.path == ":memory:":
            return 0
        total = 0
        for suffix in ("", "-wal"):
            try:
                total += os.path.getsize(self.path + suffix)
            except OSError:
                pass
        return total

    # ---------- настройки ----------
    def get_setting(self, key: str, default: str = "") -> str:
        with self.connect() as c:
            r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return r["value"] if r else default

    def set_setting(self, key: str, value: str) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )

    # ---------- запись ----------
    def log_event(
        self,
        *,
        session_id: str,
        chat_id: str,
        provider: str | None,
        model: str | None,
        slot: str | None,
        user_text: str | None,
        assistant_text: str | None,
        event_id: str | None,
        client_ts: int | None,
        lang: str | None,
        origin: str | None,
        country: str | None,
        ip_hash: str,
        now_ms: int | None = None,
    ) -> int:
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        n = 0
        with self.tx() as c:
            c.execute(
                """INSERT INTO sessions(session_id,first_seen,last_seen,country,ip_hash,lang,origin,last_provider,last_model)
                   VALUES(?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(session_id) DO UPDATE SET last_seen=excluded.last_seen,
                     country=COALESCE(excluded.country, sessions.country), ip_hash=excluded.ip_hash,
                     lang=COALESCE(excluded.lang, sessions.lang), origin=COALESCE(excluded.origin, sessions.origin),
                     last_provider=excluded.last_provider, last_model=excluded.last_model""",
                (session_id, now, now, country, ip_hash, lang, origin, provider, model),
            )
            for role, text, dt in (("user", user_text, 0), ("assistant", assistant_text, 1)):
                if not text:
                    continue
                cur = c.execute(
                    """INSERT OR IGNORE INTO messages(session_id,chat_id,ts,client_ts,role,provider,model,slot,event_id,text)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""",
                    (session_id, chat_id, now + dt, client_ts, role, provider,
                     model, slot, event_id, text),
                )
                n += cur.rowcount
        return n

    # ---------- удаление ----------
    def delete_session(self, session_id: str) -> int:
        with self.tx() as c:
            n = c.execute("SELECT COUNT(*) FROM messages WHERE session_id=?", (session_id,)).fetchone()[0]
            c.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
            c.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
        return n

    def purge_all(self) -> int:
        with self.tx() as c:
            n = c.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
            c.execute("DELETE FROM messages")
            c.execute("DELETE FROM sessions")
        with self.connect() as c:
            c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            c.execute("VACUUM")
        return n

    def cleanup(self, retention_days: int, now_ms: int | None = None) -> dict[str, int]:
        """Удаляет сообщения старше retention_days и осиротевшие сессии. retention_days=0 — хранить бессрочно."""
        if retention_days <= 0:
            return {"messages": 0, "sessions": 0}
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        cutoff = now - retention_days * 86_400_000
        with self.tx() as c:
            m = c.execute("DELETE FROM messages WHERE ts < ?", (cutoff,)).rowcount
            s = c.execute(
                "DELETE FROM sessions WHERE NOT EXISTS (SELECT 1 FROM messages WHERE messages.session_id = sessions.session_id)"
            ).rowcount
        if m:
            with self.connect() as c:
                c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        return {"messages": m, "sessions": s}

    # ---------- чтение (админка) ----------
    @staticmethod
    def _filters(q: str | None, provider: str | None, model: str | None, since: int | None, until: int | None) -> tuple[str, list[Any]]:
        conds: list[str] = []
        args: list[Any] = []
        if q:
            conds.append("instr(ulower(m.text), ?) > 0")
            args.append(q.casefold())
        if provider:
            conds.append("m.provider = ?")
            args.append(provider)
        if model:
            conds.append("m.model = ?")
            args.append(model)
        if since is not None:
            conds.append("m.ts >= ?")
            args.append(since)
        if until is not None:
            conds.append("m.ts < ?")
            args.append(until)
        return (" AND ".join(conds), args)

    def list_sessions(
        self, *, q: str | None = None, provider: str | None = None, model: str | None = None,
        since: int | None = None, until: int | None = None, limit: int = 50, offset: int = 0,
    ) -> dict[str, Any]:
        where, args = self._filters(q, provider, model, since, until)
        sub = ""
        if where:
            sub = f"WHERE s.session_id IN (SELECT m.session_id FROM messages m WHERE {where})"
        with self.connect() as c:
            total = c.execute(f"SELECT COUNT(*) FROM sessions s {sub}", args).fetchone()[0]
            rows = c.execute(
                f"""SELECT s.session_id, s.first_seen, s.last_seen, s.country, s.lang, s.origin, s.last_provider, s.last_model,
                           (SELECT COUNT(*) FROM messages x WHERE x.session_id = s.session_id) AS msg_count,
                           (SELECT COUNT(DISTINCT chat_id) FROM messages x WHERE x.session_id = s.session_id) AS chat_count,
                           (SELECT substr(text,1,140) FROM messages x WHERE x.session_id = s.session_id AND role='user' ORDER BY ts LIMIT 1) AS preview
                    FROM sessions s {sub}
                    ORDER BY s.last_seen DESC LIMIT ? OFFSET ?""",
                [*args, limit, offset],
            ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows]}

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with self.connect() as c:
            s = c.execute(
                "SELECT session_id, first_seen, last_seen, country, lang, origin, last_provider, last_model, ip_hash FROM sessions WHERE session_id=?",
                (session_id,),
            ).fetchone()
            if not s:
                return None
            msgs = c.execute(
                "SELECT id, chat_id, ts, client_ts, role, provider, model, slot, text FROM messages WHERE session_id=? ORDER BY ts, id",
                (session_id,),
            ).fetchall()
        return {"session": dict(s), "messages": [dict(m) for m in msgs]}

    def facets(self) -> dict[str, Any]:
        with self.connect() as c:
            prov = [r[0] for r in c.execute("SELECT DISTINCT provider FROM messages WHERE provider IS NOT NULL ORDER BY provider")]
            mod = [dict(provider=r[0], model=r[1]) for r in c.execute(
                "SELECT DISTINCT provider, model FROM messages WHERE model IS NOT NULL ORDER BY provider, model")]
        return {"providers": prov, "models": mod}

    def export_rows(
        self, *, session_id: str | None = None, q: str | None = None, provider: str | None = None,
        model: str | None = None, since: int | None = None, until: int | None = None, limit: int = 200000,
    ) -> list[dict[str, Any]]:
        where, args = self._filters(q, provider, model, since, until)
        conds = [where] if where else []
        if session_id:
            conds.append("m.session_id = ?")
            args.append(session_id)
        w = ("WHERE " + " AND ".join(conds)) if conds else ""
        with self.connect() as c:
            rows = c.execute(
                f"""SELECT m.session_id, m.chat_id, m.ts, m.role, m.provider, m.model, m.slot, m.text, s.country, s.lang
                    FROM messages m JOIN sessions s ON s.session_id = m.session_id {w}
                    ORDER BY m.session_id, m.ts, m.id LIMIT ?""",
                [*args, limit],
            ).fetchall()
        return [dict(r) for r in rows]

    def stats(self, days: int = 30, tz_offset_min: int = 0, now_ms: int | None = None) -> dict[str, Any]:
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        since = now - days * 86_400_000
        off = tz_offset_min * 60
        with self.connect() as c:
            tot_s = c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
            tot_m = c.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
            oldest = c.execute("SELECT MIN(ts) FROM messages").fetchone()[0]
            per_day = c.execute(
                """SELECT strftime('%Y-%m-%d', ts/1000 + ?, 'unixepoch') AS day,
                          SUM(role='user') AS user_msgs, SUM(role='assistant') AS assistant_msgs, COUNT(DISTINCT session_id) AS sessions
                   FROM messages WHERE ts >= ? GROUP BY day ORDER BY day""",
                (off, since),
            ).fetchall()
            prov = c.execute(
                """SELECT COALESCE(provider,'—') AS name, COUNT(*) AS n FROM messages WHERE role='user' AND ts >= ?
                   GROUP BY provider ORDER BY n DESC LIMIT 10""", (since,)).fetchall()
            mod = c.execute(
                """SELECT COALESCE(model,'—') AS name, COALESCE(provider,'—') AS provider, COUNT(*) AS n FROM messages
                   WHERE role='user' AND ts >= ? GROUP BY provider, model ORDER BY n DESC LIMIT 10""", (since,)).fetchall()
            cty = c.execute(
                """SELECT COALESCE(s.country,'—') AS name, COUNT(DISTINCT s.session_id) AS n FROM sessions s
                   WHERE s.last_seen >= ? GROUP BY s.country ORDER BY n DESC LIMIT 10""", (since,)).fetchall()
            active = c.execute("SELECT COUNT(DISTINCT session_id) FROM messages WHERE ts >= ?", (since,)).fetchone()[0]
            period_msgs = c.execute("SELECT COUNT(*) FROM messages WHERE ts >= ?", (since,)).fetchone()[0]
        return {
            "days": days,
            "total_sessions": tot_s, "total_messages": tot_m, "oldest_ts": oldest,
            "period_sessions": active, "period_messages": period_msgs,
            "db_bytes": self.size_bytes(),
            "per_day": [dict(r) for r in per_day],
            "providers": [dict(r) for r in prov],
            "models": [dict(r) for r in mod],
            "countries": [dict(r) for r in cty],
        }
