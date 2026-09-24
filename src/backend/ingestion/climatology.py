"""Climatology priors for the spectral block (v2 M2).

The block cannot be realtime: NDCI/chlorophyll need satellite overpasses.
What it *can* be is honest — every arbitrary-point assessment now carries a
seasonal spectral prior with a stated basis instead of a silent zero, and the
provenance says exactly what kind of prior it is:

  ``waterbody-climatology``  seasonal means computed from the ingested
                             spectral record for that pilot waterbody
  ``grid-climatology``       seasonal prior from the committed coarse-grid
                             fallback rule (latitude × month);
                             **modelled**, not measured
  ``unavailable``            no prior — the block stays zero and the caller
                             must render the "spectral input unavailable"
                             caveat

The prior never claims to be an observation. ``method_note`` is designed to be
rendered verbatim in the UI.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

from shared.config import DATA_DIR

PRIOR_FILE = Path(DATA_DIR) / "climatology.json"

# The eight spectral features the 32-dim feature vector expects.
SPECTRAL_KEYS = (
    "ndci_mean",
    "ndci_trend_5d",
    "ndci_max",
    "chlorophyll_a_mean",
    "chlorophyll_a_trend_5d",
    "ndvi_mean",
    "fai_mean",
    "ndci_std_7d",
)

_CACHE: dict | None = None


def load_priors(path: Path | None = None, force: bool = False) -> dict:
    """Load the committed prior table (cached; missing file is not an error)."""
    global _CACHE
    if _CACHE is not None and not force and path is None:
        return _CACHE
    p = Path(path) if path is not None else PRIOR_FILE
    if not p.exists():
        data: dict = {}
    else:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
    if path is None:
        _CACHE = data
    return data


def fallback_rule_value(rule: dict, lat: float, month: int) -> dict:
    """Evaluate the committed latitude × month fallback rule.

    This is a *model*, not a measurement, and every field it produces is
    labelled as such by :func:`prior_for`. Kept deliberately tiny: one
    seasonal term and one latitude-belt term, so the assumption is auditable
    by eye rather than buried in a table nobody can check.
    """
    base = float(rule.get("ndci_base", 0.02))
    ampl = float(rule.get("ndci_amplitude", 0.10))
    belt_lat = float(rule.get("belt_centroid_deg", 45.0))
    belt_w = float(rule.get("belt_width_deg", 25.0))
    chl_ref = float(rule.get("chlorophyll_at_ndci", 10.0))

    # Seasonal term: peaked on the summer solstice month of the hemisphere.
    peak_month = float(rule.get(
        "north_peak_month" if lat >= 0 else "south_peak_month", 8 if lat >= 0 else 2))
    seasonal = math.cos(2 * math.pi * (month - peak_month) / 12.0)
    # Latitude belt: temperate productive waters, tapering to poles/tropics.
    belt = math.exp(-((abs(lat) - belt_lat) ** 2) / (2 * belt_w ** 2))
    ndci_mean = base + ampl * seasonal * belt
    chl = chl_ref * math.exp(2.5 * max(-0.2, min(0.3, ndci_mean)))
    return {
        "ndci_mean": round(ndci_mean, 4),
        "ndci_trend_5d": round(ndci_mean * float(rule.get("trend_fraction", 0.25)), 4),
        "ndci_max": round(ndci_mean + float(rule.get("max_offset", 0.04)), 4),
        "chlorophyll_a_mean": round(chl, 3),
        "chlorophyll_a_trend_5d": round(chl * float(rule.get("chl_trend_fraction", 0.12)), 3),
        "ndvi_mean": round(float(rule.get("ndvi_base", 0.08)) + 0.05 * seasonal * belt, 4),
        "fai_mean": round(float(rule.get("fai_base", 0.01)) + 0.02 * seasonal * belt, 4),
        "ndci_std_7d": round(float(rule.get("std_base", 0.012)) + 0.01 * belt, 4),
    }


def _pick(vals: dict, month: int) -> dict | None:
    """Select a month's values from a prior record (falling back to annual)."""
    if not vals:
        return None
    monthly = vals.get("monthly") or {}
    chosen = monthly.get(str(month)) or vals.get("annual")
    if not chosen:
        return None
    return {k: chosen[k] for k in SPECTRAL_KEYS if k in chosen}


def prior_for(lat: float, lon: float, month: int | None = None,
              waterbody_id: str | None = None) -> dict:
    """Seasonal spectral prior for a location. Never raises, never silent."""
    now = datetime.now(timezone.utc)
    month = int(month or now.month)
    table = load_priors()
    refreshed = table.get("generated_at")
    method = table.get("method", "latitude-season-fallback")
    method_note = table.get("method_note", "")

    def _base(source: str, basis: str, values: dict,
              meth: str | None = None) -> dict:
        return {
            "source": source,
            "method": meth or method,
            "basis": basis,
            "method_note": method_note,
            "refreshed": refreshed,
            "month": month,
            "values": values,
        }

    bodies = (table.get("waterbodies") or {})
    if waterbody_id and waterbody_id in bodies:
        vals = _pick(bodies[waterbody_id], month)
        if vals:
            return _base(
                "waterbody-climatology",
                f"{bodies[waterbody_id].get('name', waterbody_id)} seasonal record",
                vals,
            )

    rule = table.get("fallback_rule")
    if rule:
        vals = fallback_rule_value(rule, lat, month)
        return _base(
            "grid-climatology",
            "coarse latitude × month prior",
            vals,
            meth=rule.get("method", "latitude-season-fallback"),
        )

    return {
        "source": "unavailable",
        "method": "none",
        "basis": "no prior table committed",
        "method_note": (
            "No spectral climatology is available for this location, so the "
            "spectral inputs to the model are zero."
        ),
        "refreshed": None,
        "month": month,
        "values": {},
    }
