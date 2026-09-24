# BloomCast — Model Card

Responsible-AI disclosure for the BloomCast bloom-risk model and its
request-time assessment path.

## Intended use

Advisory support for environmental decision-makers (water utilities, public
health officers, lake managers) monitoring cyanobacteria bloom risk in
freshwater bodies.

## Not intended for

- Toxin concentration measurement.
- Swimming or drinking-water safety determination.
- Regulatory compliance.
- A calibrated 3–7 day forecast for an arbitrary coordinate without local
  calibration data.

## Model architecture

The training pipeline contains a hybrid ensemble:

| Branch | Input | Role |
|---|---|---|
| LightGBM | 32-dim tabular vector | weather, spectral indices, citizen observations, and static geometry |
| 1D-CNN | 30 timesteps × 6 channels | temporal pattern of spectral, chlorophyll, temperature, wind, precipitation, and solar inputs |
| Meta-learner | branch embeddings and tabular features | calibrated ensemble output |

Calibration uses isotonic regression on out-of-fold predictions. The training
scorecard also publishes climatology, persistence, and weather-only baselines.

### Request-time serving

`GET /v1/infer` is not the full pilot forecasting workflow. It builds a live
32-dim row from Open-Meteo weather, a committed spectral climatology prior, and
static coordinate defaults. The StreamFlush heuristic is always available. If
compatible artifacts are committed, the exported LightGBM/calibrator path adds
`model_estimate`.

The model estimate is labelled `weather-only-model` but remains
experimental for an arbitrary point: the spectral block is a prior rather than
a live observation and the point is outside the pilot calibration envelope.
The top-level response keeps `is_calibrated: false`. If artifacts are absent,
incomplete, or feature-incompatible, only `live-heuristic-nowcast` is returned.

## Training data

Two paths are selected at training time and recorded as `training_source`:

1. **Real labels** (`tick-tick-bloom`): DrivenData Tick Tick Bloom in-situ
   severity samples joined with trailing Open-Meteo archive weather
   (`ml/training/real_labels.py`, setup in `docs/training-data.md`).
   Active when `train_labels.csv` and `metadata.csv` are present and usable.
2. **Synthetic stand-in** (`synthetic-seed`, the v2 MVP default): a
   deterministic generator produces physically motivated labels
   (warm + calm + rising chlorophyll → bloom) with label noise so calibrated
   probabilities span the risk bands rather than saturating at 0/1.

The real-label weather join leaves spectral and citizen blocks zeroed and
records that limitation. Scheduled Sentinel-2 ingestion is a separate path and
does not automatically add labels to the real-label training frame.

## Performance and provenance

Cross-validated (out-of-fold) metrics are published on the Integrity Scorecard
and refreshed by the scheduled seed workflow; see
`src/data/seed/scorecard.json` for the current values and `training_source`.
Do not quote fixed numbers from this card: they can go stale after a refresh.

**The committed seed is synthetic and the current scorecard is not real-world
skill.** It describes the generator, not forecasting accuracy on real lakes.
Real-label artifacts must carry `tick-tick-bloom` provenance before they are
treated as production model evidence.

Every request-time assessment carries a machine-readable provenance label:

- `live-heuristic-nowcast`: StreamFlush wash-off score plus bloom-favourable
  weather signals; not a calibrated probability.
- `weather-only-model`: optional exported model estimate using live
  weather and a labelled spectral prior; not a pilot-calibrated arbitrary-point
  forecast.

The response also carries `cache`, `spectral_prior`, and `caveats` so the origin
and staleness of every number are visible.

## Known biases and limitations

1. **Monitoring bias.** Training labels are weighted toward well-monitored
   lakes; generalization to under-monitored regions carries residual bias.
2. **Citizen-observation bias.** Citizen features skew toward tech-literate
   observers. The training pipeline records this limitation; downstream UIs
   must not imply complete coverage.
3. **Seasonality.** Training is concentrated in summer bloom seasons;
   shoulder-season forecasts may be less reliable.
4. **StreamFlush is a heuristic.** The urban-stream nowcast is a risk score
   from rainfall, antecedent dry days, and an assumed impervious-proxy value,
   not a calibrated probability.
5. **Region policy.** Competition labels cover four U.S. regions. Region IDs
   do not enter fitted models; the climatology baseline sees them by design.
   Per-region skill is published on the scorecard. Pilots outside the U.S.
   training range are extrapolation.
6. **Spectral prior.** The current committed table is a modelled latitude ×
   month fallback because no measured spectral history is committed. It is not
   a satellite observation. Measured seasonal means are used only after real
   records pass the generator's sample threshold.
7. **Synthetic seed.** MVP pilot forecast numbers come from the deterministic
   generator, not real satellite retrieval or real labels.
8. **EU hold-out.** A literal EU-lake hold-out is data-blocked by the available
   U.S.-only labels; the scorecard states this explicitly.
9. **Artifact fallback.** A deployment without compatible artifacts serves the
   heuristic. A deployment with artifacts can show an experimental model
   estimate, but model absence must not be hidden by a green health check.

## Update cadence

- **Nightly, scheduled:** Open-Meteo and optional Sentinel-2 ingestion, seed
  regeneration, scorecard refresh, and spectral-climatology generation in
  GitHub Actions.
- **Request time:** live weather fetch, 15-minute in-process cache, heuristic
  scoring, and optional lazy-loaded model inference.
- **Static pilot content:** committed forecast, replay, sandbox, and FHIR seed
  files remain available when the scheduled job is stopped.

## Safety disclaimer

> BloomCast outputs are advisory support for environmental decision-makers
> and do not constitute a safety determination. Always verify with in-situ
> toxin testing before issuing swimming, drinking, or recreation advisories.
