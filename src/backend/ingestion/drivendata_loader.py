"""DrivenData Tick Tick Bloom loader (loader only — dataset not redistributed)."""
import csv
from pathlib import Path
from typing import Iterator


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