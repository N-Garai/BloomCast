"""Nightly BloomCast pipeline — runs on GitHub Actions (free cron).

Render's free tier cannot run Cron Jobs, so the scheduled Sentinel-2 +
Open-Meteo refresh happens here. Render only serves the results.

Two stages, both fail-safe:
  1. INGEST  — real network calls (Open-Meteo always; Copernicus when the
               secrets exist). Result is written to src/data/ingested/.
               Skipped cleanly when the network or credentials are missing.
  2. SEED    — regenerate the forecast/sandbox/scorecard/replay artifacts.
               Falls back to the deterministic synthetic generator when stage 1
               produced no real feature rows, so the demo never breaks.

Usage:
    python -m ml.inference.pipeline_nightly --src <repo root> --out src/data/seed
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def _run_ingest(backend_dir: Path, out_dir: Path, report: dict) -> None:
    """Stage 1: real ingestion. Never raises — failure is a skipped step."""
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        sys.path.insert(0, str(backend_dir))
        from ingestion.pipeline import run_pipeline  # noqa: E402

        rows = asyncio.run(
            run_pipeline(
                copernicus_token=os.environ.get("COPERNICUS_TOKEN") or None,
                client_id=os.environ.get("COPERNICUS_USERNAME") or None,
                client_secret=os.environ.get("COPERNICUS_PASSWORD") or None,
            )
        )
        dest = out_dir / "ingested-features.json"
        dest.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")
        n = 0
        if isinstance(rows, list):
            n = len(rows)
        elif isinstance(rows, dict):
            for v in rows.values():
                if isinstance(v, list):
                    n += len(v)
        report["steps"].append(
            {"name": "ingest", "status": "ok" if n else "empty", "rows": n}
        )
    except Exception as exc:  # noqa: BLE001 - pipeline must never fail the run
        report["steps"].append({"name": "ingest", "status": "skipped", "reason": str(exc)})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--src", required=True, help="Repository root (contains src/, scripts/, data/)"
    )
    ap.add_argument(
        "--out", default="src/data/seed", help="Output directory for refreshed JSON"
    )
    args = ap.parse_args()

    root = Path(args.src).resolve()
    src = root / "src"
    out = Path(args.out)
    if not out.is_absolute():
        out = root / out
    out.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report: dict = {"run_at": stamp, "steps": []}

    # Stage 1: real ingestion (network). Writes src/data/ingested/.
    _run_ingest(src / "backend", src / "data", report)

    # Stage 2: regenerate every forecast artifact. generate_seed.py resolves
    # its own paths relative to the repo root, so cwd must be the repo root.
    seed_script = root / "scripts" / "generate_seed.py"
    try:
        subprocess.run([sys.executable, str(seed_script)], check=True, cwd=str(root))
        report["steps"].append({"name": "seed", "status": "ok"})
    except Exception as exc:  # noqa: BLE001
        report["steps"].append({"name": "seed", "status": "skipped", "reason": str(exc)})

    (out / "pipeline_run.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"[pipeline_nightly] done at {stamp} -> {out}")
    for step in report["steps"]:
        print(f"  {step['name']}: {step['status']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
