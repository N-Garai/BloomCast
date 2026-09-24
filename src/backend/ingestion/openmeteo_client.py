"""Open-Meteo forecast + historical archive client (keyless, CC-BY 4.0).

Hardened for realtime serving (v2 M-R1):

* **2 upstream calls per location, not 3.** One call returns the trailing
  72 h *and* the 7-day forecast (``past_days`` on the forecast endpoint); a
  second returns the 30-day archive used for the anomaly baseline. The old
  3-request fan-out tripled the odds of landing on Open-Meteo's rate limit.
* **Retry-After is obeyed.** A 429 with a ``Retry-After`` header is the
  upstream telling us exactly how long to wait; retrying immediately is what
  turns a 2-second hiccup into a hard failure.
* **Jittered backoff.** Un-jittered exponential retries from many instances
  synchronize into a thundering herd against a shared egress IP.
* **Honest failure.** Persistent 429s raise :class:`UpstreamRateLimited` so
  the API layer answers with a friendly "try again in N seconds" instead of
  leaking a URL and a raw status code to the browser.
"""
import asyncio
import random
from datetime import datetime, timezone

import httpx

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
HISTORICAL_URL = "https://archive-api.open-meteo.com/v1/archive"

HOURLY_VARS = [
    "temperature_2m",
    "relativehumidity_2m",
    "dewpoint_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "precipitation",
    "shortwave_radiation",
    "cloud_cover",
    "pressure_msl",
    "soil_temperature_0cm",
    "temperature_80m",
    "wind_speed_80m",
]

# Open-Meteo's archive endpoint rejects the two forecast-model-only variables.
_ARCHIVE_EXCLUDED = {"soil_temperature_0cm", "wind_speed_80m"}


class UpstreamRateLimited(Exception):
    """Raised when the upstream keeps answering 429 after every retry.

    Carries the upstream's own ``Retry-After`` (seconds) when it supplied one,
    so the API layer can pass an honest wait time to the client.
    """

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


def parse_retry_after(value: str | None) -> float | None:
    """Parse a ``Retry-After`` header (delay-seconds, or an HTTP date)."""
    if not value:
        return None
    value = value.strip()
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        pass
    try:
        when = datetime.strptime(value, "%a, %d %b %Y %H:%M:%S %Z")
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())


def backoff_delay(attempt: int, retry_after: float | None = None) -> float:
    """Wait time before retry ``attempt`` (0-based), with full jitter.

    Full jitter (``random(base/2, base)``) rather than base+noise: with many
    instances retrying, sampling spreads the herd instead of stacking it just
    after the nominal delay.
    """
    if retry_after is not None:
        # Give the upstream a small cushion past its own hint.
        return min(30.0, retry_after + random.uniform(0.1, 0.6))
    base = min(8.0, 0.6 * (2 ** attempt))
    return random.uniform(base * 0.5, base)


class OpenMeteoClient:
    """Keyless weather client for Open-Meteo's free endpoints."""

    def __init__(self, timeout: float = 10.0, retries: int = 2):
        self.timeout = timeout
        self.retries = retries

    def _client(self) -> httpx.AsyncClient:
        """Client pinned to IPv4.

        IPv6 is only partially routed on some networks, which makes httpx fail
        with ConnectError even though the endpoint is reachable over IPv4.
        """
        return httpx.AsyncClient(
            timeout=self.timeout,
            transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
        )

    async def _get(self, url: str, params: dict) -> dict:
        """GET with Retry-After-aware, jittered, bounded retries."""
        last_exc: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                async with self._client() as client:
                    r = await client.get(url, params=params)
                    if r.status_code == 429:
                        retry_after = parse_retry_after(r.headers.get("Retry-After"))
                        if attempt == self.retries:
                            raise UpstreamRateLimited(
                                "Open-Meteo rate limit reached", retry_after
                            )
                        await asyncio.sleep(backoff_delay(attempt, retry_after))
                        continue
                    r.raise_for_status()
                    return r.json()
            except UpstreamRateLimited:
                raise
            except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as exc:
                last_exc = exc
                if attempt == self.retries:
                    raise
                await asyncio.sleep(backoff_delay(attempt))
        if last_exc:  # pragma: no cover - unreachable, loop returns or raises
            raise last_exc
        raise RuntimeError("unreachable")

    async def fetch_forecast(self, lat: float, lon: float, days: int = 14,
                             past_days: int = 0) -> dict:
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": ",".join(HOURLY_VARS),
            "forecast_days": days,
            "timezone": "UTC",
            "temperature_unit": "celsius",
            "wind_speed_unit": "ms",
            "precipitation_unit": "mm",
        }
        if past_days:
            params["past_days"] = past_days
        return await self._get(FORECAST_URL, params)

    async def fetch_historical(self, lat: float, lon: float, past_days: int = 30) -> dict:
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": ",".join(
                v for v in HOURLY_VARS if v not in _ARCHIVE_EXCLUDED
            ),
            "past_days": past_days,
            "timezone": "UTC",
            "wind_speed_unit": "ms",
            "precipitation_unit": "mm",
        }
        return await self._get(HISTORICAL_URL, params)

    async def fetch_window(self, lat: float, lon: float, past_days: int = 3,
                           forecast_days: int = 7) -> dict:
        """Trailing history + forecast in ONE call (the M-R1 collapse)."""
        return await self.fetch_forecast(lat, lon, days=forecast_days, past_days=past_days)

    @staticmethod
    def split_window(hourly: dict, now: datetime | None = None,
                     fallback_past_hours: int = 72) -> tuple[dict, dict]:
        """Split a ``past_days`` payload into (past, forecast) hourly blocks.

        The cut is the last hour at or before ``now``. If timestamps are absent
        or unparseable the split falls back to the trailing
        ``fallback_past_hours`` entries, so a malformed payload degrades
        instead of raising.
        """
        times = list(hourly.get("time") or [])
        if not times:
            # No time axis: hand everything to the caller as forecast input.
            return {}, {k: v for k, v in hourly.items() if isinstance(v, list)}
        now = now or datetime.now(timezone.utc)
        cut: int | None = None
        for i, stamp in enumerate(times):
            try:
                t = datetime.fromisoformat(str(stamp))
            except ValueError:
                cut = None
                break
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            if t <= now:
                cut = i + 1
            else:
                break
        if cut is None:
            cut = min(fallback_past_hours, len(times))

        def _slice(lo: int, hi: int) -> dict:
            return {
                k: v[lo:hi] for k, v in hourly.items() if isinstance(v, list)
            }

        return _slice(0, cut), _slice(cut, len(times))

    @staticmethod
    def aggregate_daily(hourly: dict) -> dict:
        """Aggregate an hourly block to daily stats.

        Open-Meteo's response mixes the ``time`` axis (ISO strings) with numeric
        variables, and every variable has a matching ``<var>_unit`` string.
        Both are filtered out: only numeric arrays are aggregated.
        """
        out: dict = {}
        for key, values in hourly.items():
            if key == "time" or key.endswith("_unit"):
                continue
            if not values:
                continue
            nums = []
            for v in values:
                if v is None:
                    continue
                try:
                    nums.append(float(v))
                except (TypeError, ValueError):
                    continue
            if not nums:
                continue
            n = len(nums)
            out[f"{key}_mean"] = sum(nums) / n
            out[f"{key}_max"] = max(nums)
            out[f"{key}_min"] = min(nums)
            out[f"{key}_sum"] = sum(nums)
        return out
