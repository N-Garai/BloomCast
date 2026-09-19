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
