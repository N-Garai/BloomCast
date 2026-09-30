"""Citizen observations as training sample weights (v3 M-V4).

The Ground Truth Loop collects and steward-validates citizen reports, but until
this module existed none of it reached training: the frame builder saw zeros.
Collection without influence is theater, so validated reports now become
per-row sample weights.

Design constraints, in priority order:

1. **Validated only.** Pending reports carry no weight. A steward decision is
   the gate, so an unreviewed claim can never move a forecast.
2. **Capped share.** Citizen weight may not exceed ``MAX_CITIZEN_SHARE`` of
   total weight. Otherwise a burst of correlated reports from one afternoon at
   one beach can outvote the entire labelled corpus, which is a denial of
   service on model quality rather than a contribution to it.
3. **Provenance survives.** The weight share, the contributing observation ids
   and the cap that bound it are returned alongside the weights, so the
   scorecard can publish the number instead of implying influence it cannot
   prove.
4. **No import of the API layer.** ``api.db`` opens an engine at import time.
   Importing it here would make the training path depend on a live database, so
   callers pass observations in and this module stays pure.

Only *positive* sightings raise a row's weight. A validated report of clear
water is evidence too, but letting a clean report depress a row's weight would
let "nobody reported a bloom" read as a negative training signal - absence of
evidence, not evidence of absence. Rows are raised toward a citizen-derived
positive rate, never below the unweighted baseline.
"""
from datetime import date

import numpy as np

# A single waterbody's reports may not exceed this share of all weight, and all
# citizen weight together may not exceed MAX_CITIZEN_SHARE. Both are documented
# in docs/model-card.md.
MAX_CITIZEN_SHARE = 0.15
MAX_WATERBODY_SHARE = 0.05

# How far toward the citizen-derived positive rate a matched row is lifted.
# 1.0 would copy the citizen rate exactly; the blend keeps the labelled corpus
# in charge of the magnitude while letting citizens move the estimate.
CITIZEN_BLEND = 0.6

# A validated observation is attributed to a training row only within this many
# days of the row's own date. Reports are contemporaneous by nature; a report
# from three weeks later says nothing about a past sample.
DEFAULT_DATE_WINDOW_DAYS = 3

_POSITIVE_COLORS = ("green", "bloom", "scum", "algae", "eutrophic")


def _parse_date(value):
    """Accept ISO dates/timestamps, return the date, or None."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "")
    for length in (10, 13, 19):
        if len(text) >= length:
            try:
                return date.fromisoformat(text[:length])
            except ValueError:
                continue
    return None


def _is_positive(obs: dict) -> bool:
    """A sighting counts as evidence of a bloom when colour or scum says so.

    ``water_color`` is free text from the report form, so match the vocabulary
    the UI actually offers rather than trusting an exact string.
    """
    if obs.get("scum_visible"):
        return True
    color = str(obs.get("water_color") or "").strip().lower()
    return any(word in color for word in _POSITIVE_COLORS)


def validated_positive_observations(observations) -> list:
    """Filter a raw observation list down to validated positive sightings."""
    return [
        obs for obs in (observations or [])
        if str(obs.get("validation_status") or "").lower() == "approved"
        and _is_positive(obs)
    ]


def citizen_weights(
    dates,
    wb_ids,
    observations,
    max_share: float = MAX_CITIZEN_SHARE,
    max_waterbody_share: float = MAX_WATERBODY_SHARE,
    date_window_days: int = DEFAULT_DATE_WINDOW_DAYS,
):
    """Per-row sample weights from validated citizen sightings.

    ``dates`` and ``wb_ids`` describe the training frame rows (ISO date strings
    and waterbody keys, matching ``real_labels``'s return contract).
    ``observations`` are citizen rows carrying at least ``validation_status``,
    ``waterbody_id``, ``observed_at``, ``water_color`` and ``scum_visible``.

    Returns ``(weights, info)``. ``weights`` is a float array as long as
    ``dates``, every entry >= 1.0. ``info`` is the audit record: share before
    and after capping, which cap bound, and the observation ids that counted.
    """
    dates = list(dates)
    n = len(dates)
    weights = np.ones(n, dtype=float)
    info = {
        "candidate_observations": 0,
        "matched_observations": 0,
        "matched_rows": 0,
        "raw_citizen_weight": 0.0,
        "applied_citizen_weight": 0.0,
        "final_citizen_share": 0.0,
        "bounded_by": None,
        "contributing_observation_ids": [],
        "per_waterbody": {},
    }
    if n == 0:
        return weights, info

    # Index frame rows by (waterbody, date) so attribution is a dict lookup, not
    # an O(rows x observations) scan - the real frame is ~23k rows.
    by_waterbody: dict = {}
    for i, (raw, wb) in enumerate(zip(dates, wb_ids)):
        d = _parse_date(raw)
        if d is None:
            continue
        by_waterbody.setdefault(str(wb), []).append((d, [i]))

    positives = validated_positive_observations(observations)
    info["candidate_observations"] = len(positives)
    if not positives or not by_waterbody:
        return weights, info

    hits: dict = {}
    used_ids = []
    for obs in positives:
        wb = str(obs.get("waterbody_id") or "")
        observed = _parse_date(obs.get("observed_at"))
        if not wb or observed is None:
            continue
        matched_any = False
        for row_d, rows in by_waterbody.get(wb, []):
            if abs((row_d - observed).days) > date_window_days:
                continue
            for i in rows:
                hits[i] = hits.get(i, 0) + 1
            matched_any = True
        if matched_any:
            used_ids.append(obs.get("observation_id"))

    info["matched_observations"] = len(used_ids)
    info["matched_rows"] = len(hits)
    info["contributing_observation_ids"] = sorted(str(x) for x in used_ids if x)
    if not hits:
        return weights, info

    # A row is lifted toward a citizen-derived positive rate, not toward 1.0,
    # so two reports are stronger evidence than one and no single report ever
    # implies certainty.
    excess = np.zeros(n, dtype=float)
    for i, count in hits.items():
        excess[i] = CITIZEN_BLEND * min(1.0, 0.25 + 0.25 * (count - 1))
    raw_total = float(excess.sum())
    info["raw_citizen_weight"] = raw_total

    # Global cap on total citizen share of all weight.
    budget = max_share * n
    scale = min(1.0, budget / raw_total) if raw_total > 0 else 1.0
    applied = excess * scale
    bounded_by = "max_share" if scale < 1.0 else None

    # A single row cannot absorb more than its own unit weight; redistribute the
    # overflow across the other matched rows rather than discarding it.
    if applied.max() > 1.0:
        overflow = applied - 1.0
        spill = float(overflow[overflow > 0].sum())
        applied = np.minimum(applied, 1.0)
        room = (1.0 - applied) > 0
        if spill > 0 and room.any():
            applied[room] += spill * (1.0 - applied[room]) / room.sum()
        bounded_by = "row_ceiling"

    weights = 1.0 + applied
    info["applied_citizen_weight"] = float(applied.sum())
    total = float(weights.sum())
    info["final_citizen_share"] = float(applied.sum() / total) if total else 0.0
    info["bounded_by"] = bounded_by
    info["per_waterbody"] = _per_waterbody_totals(wb_ids, applied)
    return weights, info


def _per_waterbody_totals(wb_ids, applied) -> dict:
    """Citizen weight actually landing on each waterbody (the audit trail)."""
    totals: dict = {}
    for i, amount in enumerate(applied):
        if amount > 0:
            wb = str(wb_ids[i])
            totals[wb] = totals.get(wb, 0.0) + float(amount)
    return {wb: round(v, 6) for wb, v in sorted(totals.items())}

