"""In-situ label loaders — Tick Tick Bloom competition CSVs and CAML SeaBASS.

Two accepted inputs (loader only — datasets are not redistributed):

1. Competition files (drivendata.org/competitions/143 after login):
     train_labels.csv : uid, severity (1-5), density (cells/mL), ...
     metadata.csv     : uid, latitude, longitude, date, split, region, ...
2. CAML SeaBASS file (doi:10.5067/SeaBASS/CAML/DATA001 — same underlying
   labels, one table): a `.sb` file or CAML csv with columns
     uid, data_provider, region, latitude, longitude, date,
     density_cells_per_ml, severity, distance_to_water_m, ...

Severity bands (cells/mL): 1:<20k  2:20k–100k  3:100k–1M  4:1M–10M  5:>=10M.
Binary bloom indicator used across BloomCast: severity >= 3.
"""
import csv
import os
from pathlib import Path
from typing import Iterator

SEVERITY_BANDS = (20000, 100000, 1000000, 10000000)


def severity_from_density(density) -> int | None:
    """Map a raw cells/mL measurement onto the 1-5 severity scale."""
    try:
        d = float(density)
    except (TypeError, ValueError):
        return None
    if d < 20000:
        return 1
    if d < 100000:
        return 2
    if d < 1000000:
        return 3
    if d < 10000000:
        return 4
    return 5


def default_data_dir() -> Path | None:
    """Local dataset dir: $TICKTICKBLOOM_DIR, $CAML_DIR, or src/data/ticktickbloom/.

    Competition CSVs win when both formats are present (exact TTB schema).
    """
    for env in ("TICKTICKBLOOM_DIR", "CAML_DIR"):
        val = os.environ.get(env)
        if val and _has_dataset(Path(val)):
            return Path(val)
    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        cand = parent / "src" / "data" / "ticktickbloom"
        if _has_dataset(cand):
            return cand
    return None


def _has_dataset(data_dir: Path) -> bool:
    if (data_dir / "train_labels.csv").exists():
        return True
    return _find_caml_file(data_dir) is not None


def _find_caml_file(data_dir: Path) -> Path | None:
    """First SeaBASS .sb file or CAML csv in the directory (non-recursive)."""
    try:
        entries = sorted(data_dir.iterdir())
    except OSError:
        return None
    for p in entries:
        if p.is_file() and p.suffix.lower() == ".sb":
            return p
    for p in entries:
        name = p.name.lower()
        if p.is_file() and name.endswith(".csv") and "caml" in name:
            return p
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


def load_training_frame(data_dir: str | Path, max_distance_m: float | None = None) -> list:
    """Load training rows from competition CSVs or a CAML SeaBASS file.

    Competition pair wins when present; otherwise the first `.sb` / CAML csv
    in the directory is parsed. Rows carry:
      {uid, lat, lon, date, region, severity, density, y, distance_to_water_m}
    date-sorted. `max_distance_m` drops CAML rows sampled far from water
    (manual §Table 4: the column flags noisy/mislocated points); None keeps all.
    Raises FileNotFoundError when neither format is present.
    """
    data_dir = Path(data_dir)
    labels_path = data_dir / "train_labels.csv"
    meta_path = data_dir / "metadata.csv"
    if labels_path.exists() and meta_path.exists():
        return _frame_from_competition(labels_path, meta_path)
    caml = _find_caml_file(data_dir)
    if caml is not None:
        return _frame_from_caml(caml, max_distance_m=max_distance_m)
    raise FileNotFoundError(
        f"no train_labels.csv+metadata.csv or CAML .sb file in {data_dir} — "
        "see docs/training-data.md"
    )


def _frame_from_competition(labels_path: Path, meta_path: Path) -> list:
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
                "distance_to_water_m": None,
                "y": labels_to_binary(lab),
            })
    rows.sort(key=lambda r: r["date"])
    return rows


_CAML_ALIASES = {
    "lat": "latitude", "lon": "longitude",
    "density_cells_per_ml": "density", "density_cells_ml": "density",
}


def _parse_seabass(path: Path) -> tuple[list[str], list[list[str]]]:
    """Split a SeaBASS .sb file (or plain CAML csv) into (columns, rows).

    SeaBASS: `/`-prefixed header lines up to `/end_header`, column names from
    `/fields=`, delimiter from `/delimiter=` (comma) with sniffing fallback.
    A plain csv without any `/` header is accepted as-is.
    """
    with open(path, encoding="utf-8-sig") as f:
        lines = [ln.rstrip("\n") for ln in f]
    header: dict = {}
    data_start: int | None = None
    saw_header = False
    for i, line in enumerate(lines):
        s = line.strip()
        if not s.startswith("/"):
            continue
        saw_header = True
        if s == "/end_header":
            data_start = i + 1
            break
        body = s[1:]
        if "=" in body:
            k, v = body.split("=", 1)
            header[k.strip().lower()] = v.strip()
    if not saw_header:
        # No SeaBASS header at all — treat the whole file as csv.
        nonempty = [ln for ln in lines if ln.strip()]
        if not nonempty:
            return [], []
        cols = [c.strip() for c in nonempty[0].split(",")]
        return cols, [ln.split(",") for ln in nonempty[1:]]
    if data_start is None:
        data_start = len(lines)
    cols = [c.strip() for c in header.get("fields", "").split(",") if c.strip()]
    raw = [ln for ln in lines[data_start:] if ln.strip()]
    if header.get("delimiter", "").lower() == "comma" or (raw and "," in raw[0]):
        rows = [ln.split(",") for ln in raw]
    else:
        rows = [ln.split() for ln in raw]
    if not cols and rows:
        cols = [f"col{i}" for i in range(len(rows[0]))]
    return cols, rows


def _frame_from_caml(path: Path, max_distance_m: float | None = None) -> list:
    cols, raw_rows = _parse_seabass(path)
    norm = [_CAML_ALIASES.get(c.strip().lower(), c.strip().lower()) for c in cols]
    rows = []
    for i, vals in enumerate(raw_rows):
        if len(vals) != len(norm):
            continue
        rec = dict(zip(norm, (v.strip() for v in vals)))
        try:
            lat = float(rec["latitude"])
            lon = float(rec["longitude"])
            date = str(rec["date"])[:10]
        except (KeyError, TypeError, ValueError):
            continue
        sev_raw = (rec.get("severity") or "").strip()
        try:
            sev = int(float(sev_raw)) if sev_raw not in ("", "-9999") else None
        except (TypeError, ValueError):
            sev = None
        dens_raw = (rec.get("density") or "").strip()
        dens = None
        try:
            dens = float(dens_raw) if dens_raw not in ("", "-9999") else None
        except (TypeError, ValueError):
            dens = None
        if sev is None and dens is not None:
            sev = severity_from_density(dens)
        if sev is None:
            continue
        dist = None
        try:
            draw = (rec.get("distance_to_water_m") or "").strip()
            dist = float(draw) if draw not in ("", "-9999") else None
        except (TypeError, ValueError):
            dist = None
        if max_distance_m is not None and dist is not None and dist > max_distance_m:
            continue
        rows.append({
            "uid": rec.get("uid") or f"caml-{i}",
            "lat": lat,
            "lon": lon,
            "date": date,
            "region": (rec.get("region") or "").strip() or "unknown",
            "severity": sev,
            "density": dens,
            "distance_to_water_m": dist,
            "y": 1 if sev >= 3 else 0,
        })
    rows.sort(key=lambda r: r["date"])
    return rows