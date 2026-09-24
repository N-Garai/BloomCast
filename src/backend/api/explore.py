"""Live location explorer — realtime weather-only assessment for any coordinates.

This module is now a thin compatibility layer over :mod:`api.infer`, which
holds the assessment core (v2 M1). The public shape of ``GET /v1/explore`` is
unchanged — same keys, same values — so existing clients and tests keep
working, while the request path got three upgrades:

* 2 upstream calls instead of 3 (see :mod:`ingestion.openmeteo_client`)
* a 15-minute TTL cache keyed on rounded coordinates
* rate-limit failures surfaced as a friendly message, never a raw URL

New consumers should prefer ``GET /v1/infer`` or ``POST /v1/infer/batch``,
which additionally carry ``provenance``, ``cache``, ``caveats`` and
``spectral_prior``.
"""
from fastapi import HTTPException

from api.infer import (  # noqa: F401 - re-exported for backwards compatibility
    IMPERVIOUS_ASSUMED,
    build_daily_outlook,
    _haversine_km,
    _live_feature_row,
    _model_estimate,
    _num_list,
    nearest_waterbody,
)
from api.infer import AssessError, assess_location

__all__ = [
    "IMPERVIOUS_ASSUMED",
    "build_daily_outlook",
    "nearest_waterbody",
    "explore_location",
]


async def explore_location(lat: float, lon: float) -> dict:
    """Fetch live weather for any point and score it.

    Raises :class:`fastapi.HTTPException` (string ``detail``) to preserve the
    original endpoint contract; ``/v1/infer`` uses the structured error shape
    instead.
    """
    try:
        return await assess_location(lat, lon)
    except AssessError as exc:
        headers = {}
        if exc.retry_after_s:
            headers["Retry-After"] = str(int(exc.retry_after_s))
        raise HTTPException(
            status_code=exc.status_code, detail=exc.message, headers=headers
        ) from exc
