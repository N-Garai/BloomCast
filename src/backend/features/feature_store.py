"""Feature engineering for the BloomCast hybrid model."""
import numpy as np
import pandas as pd


WEATHER_FEATURES = [
    "temp_mean_3d", "temp_mean_7d", "temp_anomaly_7d",
    "wind_speed_mean_3d", "wind_speed_max_3d",
    "wind_dir_variance_3d",
    "precip_sum_7d", "precip_sum_3d", "dry_days_7d",
    "solar_mean_3d", "cloud_cover_mean_3d",
    "dewpoint_mean_3d", "pressure_trend_3d",
    "growing_degree_days", "heat_wave_flag",
]

SPECTRAL_FEATURES = [
    "ndci_mean", "ndci_trend_5d", "ndci_max",
    "chlorophyll_a_mean", "chlorophyll_a_trend_5d",
    "ndvi_mean", "fai_mean", "ndci_std_7d",
]

CITIZEN_FEATURES = [
    "citizen_reports_7d", "citizen_color_green_ratio",
    "citizen_scum_reports_7d", "citizen_consensus_severity",
    "citizen_report_density",
]

STATIC_FEATURES = ["area_km2", "latitude", "longitude", "impervious_proxy"]


def build_tabular_features(
    weather: dict,
    spectral: dict,
    citizen: dict,
    static: dict,
) -> np.ndarray:
    """Assemble the 24-dim tabular feature vector for LightGBM."""
    feats = {}
    for f in WEATHER_FEATURES:
        feats[f] = weather.get(f, 0.0)
    for f in SPECTRAL_FEATURES:
        feats[f] = spectral.get(f, 0.0)
    for f in CITIZEN_FEATURES:
        feats[f] = citizen.get(f, 0.0)
    for f in STATIC_FEATURES:
        feats[f] = static.get(f, 0.0)
    return np.array([feats[f] for f in WEATHER_FEATURES + SPECTRAL_FEATURES + CITIZEN_FEATURES + STATIC_FEATURES],
                    dtype=np.float32)


FEATURE_NAMES = WEATHER_FEATURES + SPECTRAL_FEATURES + CITIZEN_FEATURES + STATIC_FEATURES


def build_time_series(spectral_history: list, weather_history: list, n_timesteps: int = 30) -> np.ndarray:
    """Build 30 x 6 channel tensor for the 1D-CNN branch.

    Channels: ndci, chlorophyll_a, temperature, wind_speed, precipitation, solar.
    """
    channels = [[], [], [], [], [], []]
    for s, w in zip(spectral_history[-n_timesteps:], weather_history[-n_timesteps:]):
        channels[0].append(s.get("ndci_mean", 0.0))
        channels[1].append(s.get("chlorophyll_a_mean", 0.0))
        channels[2].append(w.get("temp_mean", 0.0))
        channels[3].append(w.get("wind_speed_mean", 0.0))
        channels[4].append(w.get("precip_sum", 0.0))
        channels[5].append(w.get("solar_mean", 0.0))
    arr = np.zeros((n_timesteps, 6), dtype=np.float32)
    for i, ch in enumerate(channels):
        for j, v in enumerate(ch):
            arr[j, i] = v
    return arr


def humanize_feature(name: str) -> str:
    mapping = {
        "temp_mean_3d": "Recent warm temperatures",
        "temp_mean_7d": "Sustained warm week",
        "temp_anomaly_7d": "Surface temperature anomaly",
        "wind_speed_mean_3d": "Calm winds (low mixing)",
        "wind_speed_max_3d": "Peak wind speed",
        "wind_dir_variance_3d": "Stable wind direction",
        "precip_sum_7d": "Recent rainfall (nutrient runoff)",
        "precip_sum_3d": "Short-term rainfall",
        "dry_days_7d": "Dry antecedent period",
        "solar_mean_3d": "Solar radiation",
        "cloud_cover_mean_3d": "Clear skies",
        "dewpoint_mean_3d": "High humidity",
        "pressure_trend_3d": "Pressure trend",
        "growing_degree_days": "Cumulative warmth",
        "heat_wave_flag": "Heat wave event",
        "ndci_mean": "Chlorophyll index (NDCI)",
        "ndci_trend_5d": "Rising chlorophyll trend",
        "ndci_max": "Peak chlorophyll index",
        "chlorophyll_a_mean": "Chlorophyll-a concentration",
        "chlorophyll_a_trend_5d": "Chlorophyll-a rising",
        "ndvi_mean": "Vegetation index",
        "fai_mean": "Floating algae index",
        "ndci_std_7d": "Chlorophyll variability",
        "citizen_reports_7d": "Citizen reports",
        "citizen_color_green_ratio": "Green-water reports",
        "citizen_scum_reports_7d": "Scum sightings",
        "citizen_consensus_severity": "Citizen severity consensus",
        "citizen_report_density": "Report density",
        "area_km2": "Waterbody size",
        "latitude": "Latitude",
        "longitude": "Longitude",
        "impervious_proxy": "Surrounding development",
    }
    return mapping.get(name, name.replace("_", " ").title())