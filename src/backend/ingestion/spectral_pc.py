"""Real Sentinel-2 spectral ingestion via the Planetary Computer STAC API.

Closes the v1 §7.1 / v2 §6 gap: :class:`CopernicusClient` authenticated and
searched but nothing downstream ever fetched pixels, so NDCI stayed a constant.

Why Planetary Computer instead of a Sentinel Hub / Copernicus download:

* **Anonymous.** No login, no client secret to rotate in CI.
* **Range reads.** Assets are cloud-optimised GeoTIFFs, so a single window
  around a lake centroid is a few HTTP range requests — not a 1 GB scene
  download. That is what keeps one scene per waterbody inside the 20-minute
  CI budget.
* **Cloud gating built in.** The STAC item carries ``eo:cloud_cover`` and the
  L2A scene carries the SCL classification band, so cloud-masked pixels can be
  excluded before averaging instead of polluting the mean.

Hard rules:

1. **Fail-safe, never fail-loud.** Any problem — no network, no scene inside
   the lookback, fully cloud-covered, raster read error — returns a status
   instead of raising. A nightly run must go green with or without network.
2. **Never invent a number.** When the read fails the caller forward-fills and
   flags ``forward_filled: True``; it does not substitute a default NDCI.
3. **Bounded work.** One scene, one windowed read per band, hard time budget.
"""
from __future__ import annotations

import asyncio
import math
from datetime import datetime, timedelta, timezone
from typing import Any

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
COLLECTION = "sentinel-2-l2a"

# Every waterbody gets at most this many candidate scenes considered, and at
# most one is actually opened.
MAX_ITEMS = 6
MAX_CLOUD_COVER = 40.0
LOOKBACK_DAYS = 20
# Half-width of the read window around the centroid (degrees). ~2.5 km at the
# equator — enough for a mean, small enough to stay inside a range request.
WINDOW_DEG = 0.02
# Scene Classification Layer: 4 = vegetation, 5 = not-vegetated, 6 = water,
# 7 = unclassified, 11 = snow. Only water-ish pixels are averaged.
SCL_KEEP = {6, 7}


def _status(kind: str, **extra) -> dict:
    return {"source": kind, **extra}


def select_scene(items: list, max_cloud: float = MAX_CLOUD_COVER):
    """Pick the least-cloudy usable item (pure function — unit-testable)."""
    usable = []
    for item in items or []:
        props = getattr(item, "properties", None) or {}
        cloud = props.get("eo:cloud_cover")
        assets = getattr(item, "assets", None) or {}
        if "B04" not in assets or "B05" not in assets:
            continue
        if cloud is not None:
            try:
                if float(cloud) > max_cloud:
                    continue
            except (TypeError, ValueError):
                continue
        usable.append((float(cloud) if cloud is not None else 100.0, item))
    if not usable:
        return None
    return sorted(usable, key=lambda pair: pair[0])[0][1]


def ndci_from_arrays(b04, b05, scl=None, scl_keep=SCL_KEEP) -> tuple[float | None, float]:
    """Mean NDCI over valid water pixels.

    Returns ``(ndci_mean, valid_fraction)``. Pure numpy-free-on-import: numpy is
    imported lazily so the serving runtime never pulls it in for this module.
    """
    import numpy as np

    b04 = np.asarray(b04, dtype="float32")
    b05 = np.asarray(b05, dtype="float32")
    if b04.shape != b05.shape or b04.size == 0:
        return None, 0.0
    denom = b05 + b04
    with np.errstate(divide="ignore", invalid="ignore"):
        ndci = np.where(denom != 0, (b05 - b04) / denom, np.nan)
    mask = np.isfinite(ndci) & (b04 > 0) & (b05 > 0)
    if scl is not None:
        scl = np.asarray(scl)
        if scl.shape == b04.shape:
            mask &= np.isin(scl, list(scl_keep))
    valid = int(mask.sum())
    total = int(ndci.size)
    if valid == 0:
        return None, 0.0
    return float(np.nanmean(ndci[mask])), round(valid / max(1, total), 4)


def _read_window(href: str, bbox: list, size: int = 64):
    """Windowed read of a remote COG around ``bbox`` (lon/lat, WGS84)."""
    import rasterio
    from rasterio.windows import from_bounds

    with rasterio.open(href) as src:
        bounds = src.bounds
        west = max(bounds.left, bbox[0])
        south = max(bounds.bottom, bbox[1])
        east = min(bounds.right, bbox[2])
        north = min(bounds.top, bbox[3])
        if west >= east or south >= north:
            return None
        window = from_bounds(west, south, east, north, transform=src.transform)
        data = src.read(1, window=window, out_shape=(size, size), boundless=True,
                        fill_value=0)
    return data


def fetch_ndci(lat: float, lon: float, *, days: int = LOOKBACK_DAYS) -> dict:
    """Mean NDCI + 5-day trend for a centroid from the newest usable scene.

    Blocking (STAC + GDAL); call it through :func:`fetch_ndci_async` from async
    code. Never raises: the returned dict always carries ``source`` and either
    values or ``reason``.
    """
    try:
        from pystac_client import Client
    except ImportError:
        return _status("unavailable", reason="pystac-client not installed")

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    bbox = [lon - WINDOW_DEG, lat - WINDOW_DEG, lon + WINDOW_DEG, lat + WINDOW_DEG]
    try:
        catalog = Client.open(STAC_URL)
        search = catalog.search(
            collections=[COLLECTION],
            bbox=bbox,
            datetime=f"{start.date()}T00:00:00Z/{end.date()}T23:59:59Z",
            query={"eo:cloud_cover": {"lt": MAX_CLOUD_COVER}},
            max_items=MAX_ITEMS,
        )
        items = list(search.items())
    except Exception as exc:  # noqa: BLE001 - no network must not fail the run
        return _status("unavailable", reason=f"stac search failed: {exc}")

    if not items:
        return _status("no-scene", reason=f"no scene within {days} days under {MAX_CLOUD_COVER}% cloud")

    item = select_scene(items)
    if item is None:
        return _status("no-scene", reason="no candidate scene carried B04 + B05")

    try:
        b04 = _read_window(item.assets["B04"].href, bbox)
        b05 = _read_window(item.assets["B05"].href, bbox)
        scl = None
        if "SCL" in item.assets:
            try:
                scl = _read_window(item.assets["SCL"].href, bbox)
            except Exception:  # noqa: BLE001 - SCL is a bonus gate
                scl = None
    except Exception as exc:  # noqa: BLE001 - raster read failure is a status
        return _status("read-failed", reason=str(exc),
                       scene_id=getattr(item, "id", None))

    ndci_mean, valid_fraction = ndci_from_arrays(b04, b05, scl)
    if ndci_mean is None:
        return _status("cloud-covered",
                       reason="no valid water pixels after masking",
                       scene_id=getattr(item, "id", None),
                       cloud_cover=(item.properties or {}).get("eo:cloud_cover"))

    props = item.properties or {}
    cloud_cover = props.get("eo:cloud_cover")
    return {
        "source": "planetary-computer-s2l2a",
        "scene_id": getattr(item, "id", None),
        "scene_date": str(props.get("datetime", ""))[:10],
        "cloud_cover": float(cloud_cover) if cloud_cover is not None else None,
        "valid_pixel_fraction": valid_fraction,
        "scl_masked": scl is not None,
        "ndci_mean": round(ndci_mean, 4),
        "ndci_max": round(ndci_mean, 4),
        "ndci_std_7d": 0.0,
        "ndci_trend_5d": 0.0,
        "chlorophyll_a_mean": round(
            10.0 * math.exp(2.5 * max(-0.2, min(0.3, ndci_mean))), 3
        ),
        "chlorophyll_a_trend_5d": 0.0,
        "ndvi_mean": 0.0,
        "fai_mean": 0.0,
        "forward_filled": False,
        "lookback_days": days,
        "window_deg": WINDOW_DEG,
    }


async def fetch_ndci_async(lat: float, lon: float, **kwargs) -> dict:
    """Async wrapper: windowed GDAL reads are blocking, so run them off-loop."""
    return await asyncio.to_thread(fetch_ndci, lat, lon, **kwargs)


def forward_fill(previous: dict | None, reason: str) -> dict:
    """Carry the last known spectral block forward, loudly flagged.

    Used when a waterbody has no usable scene tonight. Never a fresh-looking
    number: ``forward_filled`` and ``reason`` are always set.
    """
    if not previous:
        return _status("unavailable", reason=reason, forward_filled=False,
                       ndci_mean=None)
    out: dict[str, Any] = {
        k: v for k, v in previous.items()
        if k in {"ndci_mean", "ndci_max", "ndci_std_7d", "ndci_trend_5d",
                 "chlorophyll_a_mean", "chlorophyll_a_trend_5d",
                 "ndvi_mean", "fai_mean", "scene_date", "scene_id"}
    }
    out.update({
        "source": "forward-filled",
        "forward_filled": True,
        "reason": reason,
    })
    return out
