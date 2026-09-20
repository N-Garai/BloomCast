# BloomCast — Model Card

Responsible-AI disclosure for the BloomCast hybrid bloom-risk model.

## Intended use

Advisory support for environmental decision-makers (water utilities, public
health officers, lake managers) monitoring cyanobacteria bloom risk in
freshwater bodies.

## Not intended for

- Toxin concentration measurement.
- Swimming or drinking-water safety determination.
- Regulatory compliance.

## Model architecture

Hybrid ensemble:

| Branch | Input | Role |
|---|---|---|
| LightGBM | 32-dim tabular vector | weather forcing, spectral indices, citizen observations, static geometry |
| 1D-CNN | 30 timesteps × 6 channels | temporal pattern of NDCI, chlorophyll, temperature, wind, precip, solar |
| Meta-learner | logistic regression over the two branches' outputs | final calibrated probability |

Calibration: isotonic regression on out-of-fold predictions.

Baselines (for the Integrity Scorecard): climatology, persistence,
weather-only logistic regression.

## Training data

Two paths, selected automatically at seed-generation time
(`ml/inference/predict.py`, recorded as `training_source`):

1. **Real labels** (`tick-tick-bloom`): DrivenData Tick Tick Bloom in-situ
   severity samples joined with trailing Open-Meteo archive weather
   (`ml/training/real_labels.py`, setup in `docs/training-data.md`).
   Active when `train_labels.csv` + `metadata.csv` are present.
2. **Synthetic stand-in** (`synthetic-seed`, the v2 MVP default): a
   deterministic generator produces physically-motivated labels
   (warm + calm + rising chlorophyll → bloom) with heavy label noise, so
   calibrated probabilities span the risk bands rather than saturating
   at 0/1.

All verification below is 5-fold time-series cross-validation
(out-of-fold predictions), never in-sample. The real ingestion clients
(Copernicus Sentinel-2, Open-Meteo) are implemented in
`src/backend/bloomcast/ingestion/` and the pipeline runs end-to-end on
GitHub Actions once credentials exist.

## Performance

Cross-validated (out-of-fold) metrics are published on the live Integrity
Scorecard and refresh with every nightly seed — see `src/data/seed/scorecard.json`
for the current values with their `training_source`. Do not quote static
numbers from this card: any fixed table here goes stale on the next refresh.

**These are synthetic-data numbers, not real-world skill.** They describe the
model's behavior on the generator, not forecasting accuracy on real lakes.
The published scorecard makes this distinction explicit.

## Known biases and limitations

1. **Monitoring bias.** Training labels are weighted toward well-monitored
   lakes; generalization to under-monitored regions carries residual bias.
2. **Citizen-observation bias.** Citizen features skew toward tech-literate
   observers. Capped at ≤30% SHAP contribution per prediction as a guardrail.
3. **Seasonality.** Trained primarily on summer bloom seasons; shoulder-season
   forecasts may be less reliable.
4. **StreamFlush is a heuristic.** The urban-stream nowcast is a risk score
   from rainfall × dry days × impervious surface, not a calibrated
   probability. It triggers citizen check-missions.
5. **Synthetic seed.** MVP forecast numbers come from the deterministic
   generator (see above), not from real satellite retrieval.

## Update cadence

Nightly precompute on GitHub Actions; forecasts served statically.

## Safety disclaimer

> BloomCast outputs are advisory support for environmental decision-makers
> and do not constitute a safety determination. Always verify with in-situ
> toxin testing before issuing swimming, drinking, or recreation advisories.
