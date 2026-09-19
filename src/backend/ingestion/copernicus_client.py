"""Sentinel-2 L2A acquisition from Copernicus Data Space."""
import os
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
import httpx

COPERNICUS_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
COPERNICUS_SEARCH_URL = "https://catalog.dataspace.copernicus.eu/odata/v1/Products"

BANDS = ["B02", "B03", "B04", "B05", "B06", "B08", "B11", "SCL"]


class CopernicusClient:
    """Free-tier client for Sentinel-2 L2A imagery.

    Requires free Copernicus Data Space registration:
    https://dataspace.copernicus.eu/
    """

    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: str | None = None
        self._token_expires: datetime | None = None

    async def authenticate(self) -> str:
        if self._token and datetime.utcnow() < self._token_expires:
            return self._token
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(COPERNICUS_TOKEN_URL, data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            })
            r.raise_for_status()
            data = r.json()
        self._token = data["access_token"]
        self._token_expires = datetime.utcnow() + timedelta(seconds=data.get("expires_in", 1200) - 60)
        return self._token

    async def search(self, token: str, bbox: tuple, start: str, end: str, limit: int = 10) -> list:
        params = {
            "bbox": ",".join(str(x) for x in bbox),
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
            "collections": "sentinel-2-l2a",
            "limit": limit,
            "filter": "platformname eq 'Sentinel-2' and producttype eq 'S2MSI2A'",
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.get(COPERNICUS_SEARCH_URL, params=params,
                                 headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            return r.json().get("value", [])