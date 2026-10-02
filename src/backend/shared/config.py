"""Backend configuration from environment variables.

Every variable has a working default so the demo runs with no secrets and no
credit card. Real deployments set these in the Render dashboard.
"""

import logging
import os
from pathlib import Path

# src/backend/shared/config.py -> shared -> backend -> src
ROOT = Path(__file__).resolve().parent.parent.parent

DATA_DIR = Path(os.environ.get("DATA_DIR", str(ROOT / "data")))
SEED_DIR = Path(os.environ.get("SEED_DIR", str(DATA_DIR / "seed")))
WATERBODY_FILE = Path(
    os.environ.get("WATERBODY_FILE", str(DATA_DIR / "waterbodies.geojson"))
)
STREAM_FILE = Path(
    os.environ.get("STREAM_FILE", str(DATA_DIR / "stream_segments.geojson"))
)
REPLAY_FILE = Path(
    os.environ.get("REPLAY_FILE", str(DATA_DIR / "replay_events.json"))
)
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./bloomcast.db")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
PORT = int(os.environ.get("PORT", "8000"))

# Optional integration keys. All are optional; ingestion degrades to
# deterministic seed data when they are absent.
COPERNICUS_TOKEN = os.environ.get("COPERNICUS_TOKEN", "")
OPEN_METEO_BASE = os.environ.get("OPEN_METEO_BASE", "https://api.open-meteo.com")

# --- realtime serving knobs (v2 §2.3/§2.4) ---------------------------------
# Every score that is served from memory is stamped with its age, so the
# staleness of a "realtime" number is never hidden from the user.
INFER_CACHE_TTL_S = int(os.environ.get("INFER_CACHE_TTL_S", "900"))       # 15 min
UPSTREAM_TIMEOUT_S = float(os.environ.get("UPSTREAM_TIMEOUT_S", "10"))    # per upstream call
UPSTREAM_RETRIES = int(os.environ.get("UPSTREAM_RETRIES", "2"))
BATCH_MAX_LOCATIONS = int(os.environ.get("BATCH_MAX_LOCATIONS", "50"))
BATCH_CONCURRENCY = int(os.environ.get("BATCH_CONCURRENCY", "4"))
BATCH_THROTTLE_PER_10MIN = int(os.environ.get("BATCH_THROTTLE_PER_10MIN", "30"))
# Citizen reports are cheap to store but expensive to moderate: an unthrottled
# endpoint lets anyone flood the steward queue (and the Neon free-tier DB)
# during a public demo. 20 per 10 min per IP is generous for humans submitting
# one form at a time; floods get a 429 with Retry-After, never silent drops.
CITIZEN_REPORT_PER_10MIN = int(os.environ.get("CITIZEN_REPORT_PER_10MIN", "20"))
SPECTRAL_INGEST = os.environ.get("BLOOMCAST_SPECTRAL", "auto")            # auto|on|off

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")


def get_logger(name: str) -> logging.Logger:
    """Structured-ish logger used across the backend."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
        logger.addHandler(handler)
        logger.setLevel(LOG_LEVEL)
    return logger
