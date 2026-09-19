"""StreamFlush Nowcast — urban stream post-storm wash-off risk engine.

Sentinel-2's 10-20 m pixels cannot resolve narrow urban streams.
StreamFlush uses Open-Meteo only (no satellite required) to estimate
post-storm organic-wash-off risk that can trigger bloom-initiating conditions.
"""
import math
from scipy.special import expit as sigmoid


def compute_streamflush_risk(
    rainfall_48h: float,
    dry_days_antecedent: float,
    impervious_proxy: float,
) -> float:
    """Risk score in [0, 1].

    StreamFlush_Risk = sigmoid(
        0.04 * rainfall_48h_mm
      + 0.06 * dry_days_antecedent
      + 0.05 * impervious_proxy_0_1
      - 2.5
    )
    """
    return float(sigmoid(
        0.04 * rainfall_48h
        + 0.06 * dry_days_antecedent
        + 0.05 * impervious_proxy
        - 2.5
    ))


def compute_dry_days_antecedent(precip: list, before_window: int = 48) -> float:
    """Consecutive dry days (<0.1mm) immediately before the 48h rainfall window."""
    dry = 0
    prior = precip[:-before_window] if len(precip) > before_window else []
    for p in reversed(prior):
        if p < 0.1:
            dry += 1
        else:
            break
    return min(dry / 24.0, 14.0)


def compute_rainfall_48h(precip: list) -> float:
    return float(sum(precip[-48:])) if len(precip) >= 48 else float(sum(precip))


def risk_level(score: float) -> str:
    if score < 0.3:
        return "low"
    if score < 0.6:
        return "moderate"
    if score < 0.85:
        return "high"
    return "critical"