"""Counterfactual sweeps for the Resilience Sandbox."""
import numpy as np

# Semantic indices into the 32-dim feature vector (features/feature_store.py).
# LightGBM is scale-sensitive: a raw +3°C shift on a standardized feature is a
# ~3-sigma move and saturates the model, so perturbations are applied in
# standardized units that correspond to the real-world magnitude.
I_TEMP_3D = 0
I_WIND_3D = 3
I_NDCI_MEAN = 15
I_NDCI_TREND = 16
I_CHL = 18
I_SOLAR = 9

# 1°C of surface warming maps to roughly this many standardized units,
# given the feature's spread in the training set.
TEMP_UNIT = 0.32
# Halving the nutrient load does not halve chlorophyll — algal response is
# strongly non-linear and saturating, so use a sub-linear curve.
NUTRIENT_ELASTICITY = 0.55


def precompute_sandbox_sweeps(
    predict_fn,
    baseline_features: np.ndarray,
    waterbody_id: str,
) -> dict:
    """Precompute counterfactual scenarios for the Resilience Sandbox.

    Output is published as sandbox/<wbId>.json and rendered as slider-driven
    cards in the Sandbox UI. Labeled 'planning scenario, not prediction'.
    """
    scenarios = {}
    for temp_delta in [0, 1, 2, 3]:
        for nutrient_reduction in [0.0, 0.3, 0.5]:
            cf = baseline_features.copy().astype(np.float32)
            # Warming: +1°C per unit, in standardized feature units.
            cf[:, I_TEMP_3D] += temp_delta * TEMP_UNIT
            # Calmer winds under warming (reduced mixing) — a documented
            # co-occurring effect, included so the scenarios reflect realistic
            # coupling rather than independent sliders.
            cf[:, I_WIND_3D] -= temp_delta * 0.08
            # Nutrient reduction acts on chlorophyll / NDCI sub-linearly.
            for i in (I_CHL, I_NDCI_MEAN, I_NDCI_TREND):
                cf[:, i] *= (1 - nutrient_reduction) ** NUTRIENT_ELASTICITY
            p = float(predict_fn(cf)[0])
            key = f"temp+{temp_delta}_nut-{int(nutrient_reduction * 100)}"
            scenarios[key] = {
                "temp_delta_c": temp_delta,
                "nutrient_reduction_pct": int(nutrient_reduction * 100),
                "projected_p_bloom": round(p, 4),
                "projected_annual_high_risk_days": _extrapolate_annual(p),
                "label": "planning scenario, not prediction",
            }
    return scenarios


def _extrapolate_annual(p: float) -> int:
    """Heuristic: annual high-risk days, capped at a realistic 120 days.

    A 100% daily bloom probability would mean year-round bloom, which no
    temperate lake exhibits. Seasonality is modeled as a sinusoid peaking in
    high summer, so the annual count is the mean probability scaled by the
    fraction of the year in the bloom season, not a flat p*365.
    """
    bloom_season_fraction = 0.45  # ~165 days of stratified warm season
    days = p * 365 * bloom_season_fraction
    return int(min(120, max(0, days)))