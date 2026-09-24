"""In-process TTL cache + a tiny per-identity throttle.

Why in-process and not Redis: the serving tier is a single free-tier container
(512 MB, spins down when idle). A dict with timestamps costs nothing, survives
exactly as long as the process is warm — which is precisely the window where an
upstream re-fetch would be wasted — and adds no service to operate.

Two rules this module exists to enforce:

1. Every cache read exposes *how old* the value is (``age_s`` / ``cached_at``),
   so a "realtime" score can always be labelled with its staleness.
2. Expired entries are recomputed, not served — except under upstream
   throttling/outage, where a bounded-stale entry (see ``get_stale``) is
   served explicitly labelled ``stale`` with its age, instead of failing.
   A minutes-old real number beats no number during a throttle window.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Callable


class TTLCache:
    """Thread-safe least-recently-used TTL cache with an injectable clock."""

    def __init__(self, ttl_s: float, max_entries: int = 512, clock: Callable[[], float] = time.monotonic):
        self.ttl_s = float(ttl_s)
        self.max_entries = int(max_entries)
        self._clock = clock
        self._lock = threading.Lock()
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> tuple[Any, float] | None:
        """Return ``(value, age_seconds)`` when fresh, else ``None``.

        Expired entries are deliberately NOT evicted here: the throttle
        fallback in ``assess_location`` may still serve them as labelled
        stale via :meth:`get_stale`. Eviction happens by insertion order in
        :meth:`set` (bounded memory) and by max age in :meth:`get_stale`.
        """
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            stored_at, value = entry
            age = self._clock() - stored_at
            if age > self.ttl_s:
                return None
            return value, age

    def get_stale(self, key: str, max_age_s: float) -> tuple[Any, float] | None:
        """Return ``(value, age_seconds)`` when present and younger than
        ``max_age_s``, even past TTL. Entries older than that are dropped.
        Used only when the upstream is throttled or down — callers must label
        the result ``stale`` with its age."""
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            stored_at, value = entry
            age = self._clock() - stored_at
            if age > max_age_s:
                self._store.pop(key, None)
                return None
            return value, age

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            if len(self._store) >= self.max_entries:
                # Evict the oldest insertion (dicts preserve insertion order).
                oldest = next(iter(self._store), None)
                if oldest is not None:
                    self._store.pop(oldest, None)
            self._store[key] = (self._clock(), value)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:  # pragma: no cover - diagnostics only
        with self._lock:
            return len(self._store)


class SlidingWindowThrottle:
    """Per-identity request limiter over a rolling window.

    Used to keep one client from spending the shared upstream quota
    (M4 / §2.4) — the batch endpoint fans out to many upstream calls, so it
    needs a budget even though each individual call is cheap.
    """

    def __init__(self, limit: int, window_s: float = 600.0,
                 clock: Callable[[], float] = time.monotonic):
        self.limit = int(limit)
        self.window_s = float(window_s)
        self._clock = clock
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}

    def check(self, identity: str) -> tuple[bool, float]:
        """Return ``(allowed, retry_after_seconds)``."""
        now = self._clock()
        with self._lock:
            q = self._hits.setdefault(identity, deque())
            while q and now - q[0] > self.window_s:
                q.popleft()
            if len(q) >= self.limit:
                retry_after = max(1.0, self.window_s - (now - q[0]))
                return False, round(retry_after, 1)
            q.append(now)
            return True, 0.0

    def reset(self, identity: str | None = None) -> None:
        with self._lock:
            if identity is None:
                self._hits.clear()
            else:
                self._hits.pop(identity, None)


def coord_key(lat: float, lon: float, decimals: int = 3) -> str:
    """Stable cache key for a location (~110 m at 3 decimals).

    Rounding is deliberate: two clicks 50 m apart are the same weather grid
    cell, so they should share one upstream call rather than burn two.
    """
    return f"{round(float(lat), decimals)},{round(float(lon), decimals)}"
