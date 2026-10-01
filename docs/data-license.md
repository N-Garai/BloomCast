# BloomCast — Data Sources & Licensing

Every source is free and requires no credit card.

| Source | Used for | License | Card required |
|---|---|---|---|
| Copernicus Sentinel-2 L2A | multispectral imagery → NDCI / NDVI / FAI | free including commercial use, attribution required | No |
| Open-Meteo | weather forecasts (14-day) | CC-BY 4.0, keyless | No |
| OpenFreeMap | map tiles | free and open-source | No |
| DrivenData "Tick Tick Bloom" | benchmark bloom labels | see decision tree below | No |

## DrivenData license decision tree

```
Verify terms
   │
   ├─ terms clear and permit redistribution
   │     → include a small derived label set under those terms
   │
   └─ terms unclear
         → keep the dataset OUT of the repo
         → keep the loader script IN the repo (Apache-2.0, so the pipeline is
           reproducible when terms are clarified)
         → fall back to public-domain labels (NOAA / EPA / EEA Waterbase)
```

Current status: **competition CSVs not redistributed; CAML labels used
instead.** The loader (`src/backend/ingestion/drivendata_loader.py`) reads
either format, but the repo ships neither dataset — the committed model was
trained from the public CAML SeaBASS file
(doi:10.5067/SeaBASS/CAML/DATA001), which needs no login and carries the same
underlying labels. The MVP-era synthetic generator remains in the code only
as the no-labels fallback.

## Attribution

- Copernicus — contains modified Copernicus Sentinel data (2026).
- Open-Meteo — data provided under CC-BY 4.0.
- Map tiles — OpenFreeMap contributors.
