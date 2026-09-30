"""Простые in-memory ограничители: скользящее окно, дневная квота и блокировка входа."""
from __future__ import annotations

import threading
import time
from collections import deque


class RateLimiter:
    """Не более `limit` событий за `window` секунд на ключ. Потокобезопасно."""

    def __init__(self, limit: int, window: float = 60.0, max_keys: int = 50_000, clock=time.monotonic):
        self.limit, self.window, self.max_keys, self.clock = limit, window, max_keys, clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> tuple[bool, float]:
        """(разрешено, через сколько секунд повторить)."""
        now = self.clock()
        with self._lock:
            dq = self._hits.get(key)
            if dq is None:
                if len(self._hits) >= self.max_keys:
                    self._gc(now)
                    if len(self._hits) >= self.max_keys:
                        return False, self.window  # защита памяти: слишком много разных источников
                dq = self._hits[key] = deque()
            while dq and now - dq[0] >= self.window:
                dq.popleft()
            if len(dq) >= self.limit:
                return False, max(0.1, self.window - (now - dq[0]))
            dq.append(now)
            return True, 0.0

    def _gc(self, now: float) -> None:
        for k in [k for k, dq in self._hits.items() if not dq or now - dq[-1] >= self.window]:
            del self._hits[k]

    def gc(self) -> None:
        with self._lock:
            self._gc(self.clock())


class DailyQuota:
    """Сумма байт на ключ за сутки (UTC-день). Не даёт одному адресу забить диск."""

    def __init__(self, max_bytes: int, max_keys: int = 50_000, day_fn=lambda: int(time.time() // 86400)):
        self.max_bytes, self.max_keys, self.day_fn = max_bytes, max_keys, day_fn
        self._day = day_fn()
        self._used: dict[str, int] = {}
        self._lock = threading.Lock()

    def add(self, key: str, n: int) -> bool:
        with self._lock:
            d = self.day_fn()
            if d != self._day:
                self._day, self._used = d, {}
            if key not in self._used and len(self._used) >= self.max_keys:
                return False
            cur = self._used.get(key, 0)
            if cur + n > self.max_bytes:
                return False
            self._used[key] = cur + n
            return True


class LoginGuard:
    """Блокировка подбора пароля: N неудач с одного адреса -> блок на M минут; общий предохранитель на все адреса."""

    def __init__(self, max_fails: int, lock_s: float, global_max: int, global_lock_s: float, clock=time.monotonic):
        self.max_fails, self.lock_s = max_fails, lock_s
        self.global_max, self.global_lock_s = global_max, global_lock_s
        self.clock = clock
        self._fails: dict[str, list[float]] = {}   # ключ -> [число неудач, время последней, блок до]
        self._g_fails: deque[float] = deque()
        self._g_until = 0.0
        self._lock = threading.Lock()

    def locked_for(self, key: str) -> float:
        now = self.clock()
        with self._lock:
            wait = max(0.0, self._g_until - now)
            rec = self._fails.get(key)
            if rec and rec[2] > now:
                wait = max(wait, rec[2] - now)
            return wait

    def fail(self, key: str) -> None:
        now = self.clock()
        with self._lock:
            rec = self._fails.get(key)
            if rec is None or now - rec[1] > self.lock_s * 2 and rec[2] <= now:
                rec = self._fails[key] = [0, now, 0.0]
                if len(self._fails) > 20_000:
                    self._fails = {k: v for k, v in self._fails.items() if v[2] > now}
                    self._fails[key] = rec
            rec[0] += 1
            rec[1] = now
            if rec[0] >= self.max_fails:
                rec[2] = now + self.lock_s
                rec[0] = 0
            self._g_fails.append(now)
            while self._g_fails and now - self._g_fails[0] > 300:
                self._g_fails.popleft()
            if len(self._g_fails) >= self.global_max:
                self._g_until = now + self.global_lock_s
                self._g_fails.clear()

    def success(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)
