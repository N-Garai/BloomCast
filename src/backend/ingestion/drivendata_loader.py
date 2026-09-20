"""DrivenData Tick Tick Bloom loader (loader only — dataset not redistributed).

Competition files (download from drivendata.org/competitions/143 after login):
  train_labels.csv : uid, severity (1-5), density (cells/mL), ...
  metadata.csv     : uid, latitude, longitude, date, split, region, ...

Severity bands (cells/mL): 1:<20k  2:20k–100k  3:100k–1M  4:1M–10M  5:>=10M.
Binary bloom indicator used across BloomCast: severity >= 3.
"""
import csv
import os
from pathlib import Path
from typing import Iterator


def default_data_dir() -> Path | None:
    """Local dataset dir: $TICKTICKBLOOM_DIR or src/data/ticktickbloom/."""
    env = os.environ.get("TICKTICKBLOOM_DIR")
    if env and Path(env, "train_labels.csv").exists():
        return Path(env)
    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        cand = parent / "src" / "data" / "ticktickbloom"
        if (cand / "train_labels.csv").exists():
            return cand
    return None


def load_labels(path: str | Path) -> Iterator[dict]:
    """Yield bloom-severity labels.

    Columns expected (DrivenData Tick Tick Bloom schema):
    lake, year, week, severity (1-5), ...
    """
    path = Path(path)
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield row


def labels_to_binary(row: dict, threshold: int = 3) -> int:
    """Map severity 1-5 to binary bloom indicator (severity >= threshold)."""
    try:
        sev = int(float(row.get("severity", 0)))
    except (ValueError, TypeError):
        return 0
    return 1 if sev >= threshold else 0


def load_training_frame(data_dir: str | Path) -> list:
    """Join train labels with sample metadata, train split only, date-sorted.

    Returns rows: {uid, lat, lon, date, region, severity, density, y}.
    Raises FileNotFoundError when the competition CSVs are absent.
    """
    data_dir = Path(data_dir)
    labels_path = data_dir / "train_labels.csv"
    meta_path = data_dir / "metadata.csv"
    if not labels_path.exists():
        raise FileNotFoundError(f"missing {labels_path} — see docs/training-data.md")
    if not meta_path.exists():
        raise FileNotFoundError(f"missing {meta_path} — see docs/training-data.md")

    with open(labels_path, newline="") as f:
        labels = {r.get("uid"): r for r in csv.DictReader(f)}
    rows = []
    with open(meta_path, newline="") as f:
        for m in csv.DictReader(f):
            uid = m.get("uid")
            lab = labels.get(uid)
            if lab is None:
                continue
            if (m.get("split") or "train").strip().lower() != "train":
                continue
            try:
                lat = float(m["latitude"])
                lon = float(m["longitude"])
                date = str(m["date"])[:10]
            except (KeyError, TypeError, ValueError):
                continue
            rows.append({
                "uid": uid,
                "lat": lat,
                "lon": lon,
                "date": date,
                "region": (m.get("region") or "").strip() or "unknown",
                "severity": lab.get("severity"),
                "density": lab.get("density"),
                "y": labels_to_binary(lab),
            })
    rows.sort(key=lambda r: r["date"])
    return rows