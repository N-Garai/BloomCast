"""Open-Meteo forecast + historical archive client (keyless, CC-BY 4.0)."""
import asyncio
from datetime import datetime, timedelta

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


class OpenMeteoClient:
    """Keyless weather client for Open-Meteo's free endpoints."""

    def __init__(self, timeout: float = 45.0, retries: int = 2):
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
        """GET with bounded retries on transport errors (rate limiting)."""
        last_exc: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                async with self._client() as client:
                    r = await client.get(url, params=params)
                    r.raise_for_status()
                    return r.json()
            except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as exc:
                last_exc = exc
                if attempt == self.retries:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))
        if last_exc:  # pragma: no cover - unreachable, loop returns or raises
            raise last_exc
        raise RuntimeError("unreachable")

    async def fetch_forecast(self, lat: float, lon: float, days: int = 14) -> dict:
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
        return await self._get(FORECAST_URL, params)

    async def fetch_historical(self, lat: float, lon: float, past_days: int = 30) -> dict:
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": ",".join(
                v for v in HOURLY_VARS if v not in {"soil_temperature_0cm", "wind_speed_80m"}
            ),
            "past_days": past_days,
            "timezone": "UTC",
            "wind_speed_unit": "ms",
            "precipitation_unit": "mm",
        }
        return await self._get(HISTORICAL_URL, params)

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
