"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { API } from "@/lib/api";
import { LocationMap } from "@/components/dashboard/LocationMap";

interface ExploreResult {
  latitude: number;
  longitude: number;
  provenance: string;
  fetched_at: string;
  method: string;
  wash_off: {
    risk_score: number;
    risk_level: string;
    rainfall_48h_mm: number;
    dry_days_antecedent: number;
    impervious_proxy: number;
    impervious_note: string;
  };
  week_ahead: {
    temp_mean_c: number | null;
    temp_max_c: number | null;
    wind_mean_ms: number | null;
    solar_mean_wm2: number | null;
    precip_sum_mm: number;
  };
  signals: string[];
  model_estimate?: {
    experimental: boolean;
    p_bloom: number;
    ci_lo: number;
    ci_hi: number;
    drivers: Array<{ feature: string; human: string; shap_value: number; method?: string }>;
    model_version?: string;
    training_source?: string;
    caveats: string;
  } | null;
  daily_outlook?: Array<{
    date: string;
    risk_score: number;
    risk_level: string;
    rain_mm: number;
    temp_max_c: number | null;
    wind_mean_ms: number | null;
  }>;
  past_30d?: { temp_mean_c: number | null; precip_sum_mm: number };
  nearest_waterbody: { id: string; name: string; distance_km: number } | null;
}

const PRESETS = [
  { label: "Zurich", lat: "47.38", lon: "8.54" },
  { label: "Lake Erie", lat: "41.90", lon: "-83.10" },
  { label: "Vembanad", lat: "9.60", lon: "76.35" },
];

const STEPS = ["Fetching live weather", "Scoring wash-off risk", "Locating nearest pilot waterbody"];

const LEVEL_STYLE: Record<string, string> = {
  low: "text-glow-green border-glow-green/40 bg-glow-green/10",
  moderate: "text-glow-yellow border-glow-yellow/40 bg-glow-yellow/10",
  high: "text-glow-orange border-glow-orange/40 bg-glow-orange/10",
  critical: "text-glow-red border-glow-red/40 bg-glow-red/10",
};

const DOT_COLOR: Record<string, string> = {
  low: "#00ff88",
  moderate: "#ffcc00",
  high: "#ff8800",
  critical: "#ff3355",
};

function RiskTrajectory({ days }: { days: NonNullable<ExploreResult["daily_outlook"]> }) {
  const W = 560;
  const H = 150;
  const PAD = 26;
  const x = (i: number) => PAD + (i / Math.max(1, days.length - 1)) * (W - PAD * 2);
  const y = (p: number) => H - PAD - p * (H - PAD * 2);
  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d.risk_score).toFixed(1)}`).join(" ");
  return (
    <div className="mt-4 rounded-xl border border-border-faint bg-bg-abyss/60 p-4">
      <div className="text-xs font-mono uppercase tracking-widest text-fg-muted mb-2">
        7-day risk trajectory · live forecast window
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="7-day wash-off risk trajectory">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)} stroke="#3d5666" strokeWidth="0.5" strokeDasharray="3 4" opacity="0.6" />
        ))}
        <motion.polygon
          points={`${PAD},${H - PAD} ${pts} ${W - PAD},${H - PAD}`}
          fill="url(#trajFill)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.35 }}
          transition={{ duration: 1 }}
        />
        <defs>
          <linearGradient id="trajFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00f0d4" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#00f0d4" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.polyline
          points={pts}
          fill="none"
          stroke="#00f0d4"
          strokeWidth="2.5"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
        {days.map((d, i) => (
          <g key={d.date}>
            <circle cx={x(i)} cy={y(d.risk_score)} r="4.5" fill={DOT_COLOR[d.risk_level] ?? "#00f0d4"} stroke="#02060f" strokeWidth="1.5" />
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#5a7888" fontFamily="monospace">
              {d.date.slice(5)}
            </text>
            <text x={x(i)} y={y(d.risk_score) - 9} textAnchor="middle" fontSize="10" fill="#e8f4f8" fontFamily="monospace">
              {Math.round(d.risk_score * 100)}%
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function LocationExplorer({
  onSelectWaterbody,
}: {
  onSelectWaterbody?: (id: string) => void;
}) {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [rationaleBusy, setRationaleBusy] = useState(false);
  const [rationaleError, setRationaleError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "working") return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 700);
    return () => clearInterval(t);
  }, [phase]);

  const run = async (plat: string, plon: string) => {
    const la = parseFloat(plat);
    const lo = parseFloat(plon);
    if (!isFinite(la) || !isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
      setError("Enter a valid latitude (-90…90) and longitude (-180…180).");
      setPhase("error");
      return;
    }
    setPhase("working");
    setStep(0);
    setError(null);
    setResult(null);
    setRationale(null);
    setRationaleError(null);
    try {
      // Realtime by design: every selection triggers a fresh live fetch —
      // no cache, no nightly job involved.
      const r = await fetch(`${API}/v1/explore?lat=${la}&lon=${lo}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail ?? `HTTP ${r.status}`);
      setResult(d);
      setPhase("done");
    } catch (e: any) {
      setError(e?.message ?? "Live weather unavailable — try again in a minute.");
      setPhase("error");
    }
  };

  const explain = async () => {
    if (!result) return;
    setRationaleBusy(true);
    setRationaleError(null);
    try {
      const r = await fetch(`${API}/v1/rationale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            latitude: result.latitude,
            longitude: result.longitude,
            wash_off: result.wash_off,
            week_ahead: result.week_ahead,
            signals: result.signals,
            model_estimate: result.model_estimate,
          },
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setRationale(d.rationale);
    } catch (e: any) {
      setRationaleError(String(e?.message ?? e));
    } finally {
      setRationaleBusy(false);
    }
  };

  const useGps = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      setPhase("error");
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude.toFixed(3);
        const lo = pos.coords.longitude.toFixed(3);
        setLat(la);
        setLon(lo);
        setGpsBusy(false);
        run(la, lo);
      },
      () => {
        setGpsBusy(false);
        setError("Location permission denied — enter coordinates manually.");
        setPhase("error");
      },
      { timeout: 10000 }
    );
  };

  const w = result?.wash_off;
  const levelStyle = (w && LEVEL_STYLE[w.risk_level]) || LEVEL_STYLE.low;

  return (
    <div className="glass rounded-2xl border border-border-subtle p-6 md:p-8 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-glow-violet/60 to-transparent" />
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-glow-violet opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-glow-violet" />
        </span>
        <h2 className="font-display text-2xl font-semibold tracking-wide">Explore any location</h2>
        <span className="ml-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-glow-violet/50 text-glow-violet uppercase tracking-widest">
          Live
        </span>
      </div>
      <p className="text-sm text-fg-secondary max-w-2xl mb-5">
        Pick any point on Earth — click the map, type coordinates, use GPS, or a
        preset — and BloomCast fetches realtime weather for it on the spot and
        scores wash-off risk instantly. Every selection triggers a fresh live
        fetch; nothing here waits on the nightly job.
      </p>

      <div className="mb-4">
        <LocationMap
          onPick={(la, lo) => {
            const sla = String(la);
            const slo = String(lo);
            setLat(sla);
            setLon(slo);
            run(sla, slo);
          }}
        />
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:items-end">
        <label className="flex-1">
          <span className="text-xs font-mono uppercase tracking-widest text-fg-muted">Latitude</span>
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="47.38"
            inputMode="decimal"
            className="mt-1 w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary font-mono focus:border-glow-violet outline-none"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs font-mono uppercase tracking-widest text-fg-muted">Longitude</span>
          <input
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            placeholder="8.54"
            inputMode="decimal"
            className="mt-1 w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary font-mono focus:border-glow-violet outline-none"
          />
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => run(lat, lon)}
            disabled={phase === "working"}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-glow-violet to-glow-cyan text-bg-abyss text-sm font-semibold hover:shadow-glow-md transition-all disabled:opacity-50 whitespace-nowrap"
          >
            {phase === "working" ? "Fetching…" : "Check this spot"}
          </button>
          <button
            onClick={useGps}
            disabled={gpsBusy || phase === "working"}
            className="px-4 py-2.5 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {gpsBusy ? "Locating…" : "Use my GPS"}
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setLat(p.lat);
              setLon(p.lon);
              run(p.lat, p.lon);
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-mono border border-border-subtle text-fg-muted hover:text-glow-cyan hover:border-glow-cyan/40 transition-colors"
          >
            {p.label} · {p.lat}, {p.lon}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {phase === "working" && (
          <motion.div
            key="working"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-5 space-y-2"
          >
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-mono ${
                    i < step
                      ? "border-glow-green/60 bg-glow-green/15 text-glow-green"
                      : i === step
                        ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet"
                        : "border-border-subtle text-fg-faint"
                  }`}
                >
                  {i < step ? "✓" : `0${i + 1}`}
                </span>
                <span className={i <= step ? "text-fg-primary" : "text-fg-faint"}>{s}…</span>
                {i === step && (
                  <motion.span
                    className="inline-block h-1.5 w-1.5 rounded-full bg-glow-violet"
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                )}
              </div>
            ))}
          </motion.div>
        )}

        {phase === "error" && error && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-5 rounded-xl border border-glow-red/40 bg-glow-red/5 p-4 text-sm"
          >
            <span className="text-glow-red font-medium">Live fetch failed. </span>
            <span className="text-fg-secondary font-mono text-xs">{error}</span>
          </motion.div>
        )}

        {phase === "done" && result && w && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 rounded-xl border border-border-subtle bg-bg-deep/50 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-mono text-fg-muted">
                  {result.latitude.toFixed(3)}, {result.longitude.toFixed(3)} · fetched{" "}
                  {new Date(result.fetched_at).toLocaleTimeString()}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-4xl font-bold tabular text-fg-primary">
                    {Math.round(w.risk_score * 100)}%
                  </span>
                  <span className={`text-xs font-mono px-2.5 py-1 rounded-full border uppercase ${levelStyle}`}>
                    {w.risk_level}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded border border-glow-green/50 text-glow-green uppercase tracking-widest animate-pulse">
                ● realtime
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg bg-bg-abyss/60 p-3 border border-border-faint">
                <div className="text-fg-muted">Rainfall 48h</div>
                <div className="font-mono text-fg-primary text-sm mt-0.5">{w.rainfall_48h_mm} mm</div>
              </div>
              <div className="rounded-lg bg-bg-abyss/60 p-3 border border-border-faint">
                <div className="text-fg-muted">Dry days</div>
                <div className="font-mono text-fg-primary text-sm mt-0.5">{w.dry_days_antecedent}</div>
              </div>
              <div className="rounded-lg bg-bg-abyss/60 p-3 border border-border-faint">
                <div className="text-fg-muted">Week mean temp</div>
                <div className="font-mono text-fg-primary text-sm mt-0.5">
                  {result.week_ahead.temp_mean_c ?? "—"}°C
                </div>
              </div>
              <div className="rounded-lg bg-bg-abyss/60 p-3 border border-border-faint">
                <div className="text-fg-muted">Week mean wind</div>
                <div className="font-mono text-fg-primary text-sm mt-0.5">
                  {result.week_ahead.wind_mean_ms ?? "—"} m/s
                </div>
              </div>
            </div>

            <ul className="mt-3 space-y-1">
              {result.signals.map((s) => (
                <li key={s} className="text-xs text-fg-secondary flex gap-2">
                  <span className="text-glow-cyan">→</span> {s}
                </li>
              ))}
            </ul>

            {result.daily_outlook && result.daily_outlook.length > 0 && (
              <RiskTrajectory days={result.daily_outlook} />
            )}

            {result.past_30d && (
              <p className="mt-3 text-[11px] font-mono text-fg-muted">
                Past 30 days here: {result.past_30d.temp_mean_c ?? "—"}°C mean ·{" "}
                {result.past_30d.precip_sum_mm} mm rain — the baseline behind this outlook.
              </p>
            )}

            <p className="mt-3 text-[11px] text-fg-faint">
              Weather-only heuristic ({result.method}). Land cover assumed neutral —{" "}
              {w.impervious_note.toLowerCase()}.
            </p>

            {result.model_estimate ? (
              <div className="mt-4 rounded-xl border border-glow-violet/40 bg-glow-violet/5 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-glow-violet/50 text-glow-violet uppercase tracking-widest">
                    Model estimate · experimental
                  </span>
                  {result.model_estimate.training_source && (
                    <span className="text-[10px] font-mono text-fg-faint">
                      {result.model_estimate.training_source} · {result.model_estimate.model_version}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold tabular text-glow-violet">
                    {Math.round(result.model_estimate.p_bloom * 100)}%
                  </span>
                  <span className="text-xs font-mono text-fg-muted">
                    CI {Math.round(result.model_estimate.ci_lo * 100)}–{Math.round(result.model_estimate.ci_hi * 100)}%
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {result.model_estimate.drivers.map((d) => (
                    <div key={d.feature} className="flex items-center gap-2 text-xs">
                      <span className="text-fg-secondary flex-1">{d.human}</span>
                      <span className="font-mono text-fg-muted">
                        {d.shap_value > 0 ? "+" : ""}{(d.shap_value * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-fg-faint">{result.model_estimate.caveats}</p>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-fg-faint">
                No exported model on this deployment yet — the model estimate appears
                once real-label artifacts are committed (docs/kaggle-training.md).
              </p>
            )}

            {result.nearest_waterbody && (
              <button
                onClick={() => onSelectWaterbody?.(result.nearest_waterbody!.id)}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors"
              >
                Open calibrated forecast: {result.nearest_waterbody.name} ({result.nearest_waterbody.distance_km} km away) →
              </button>
            )}

            <div className="mt-4">
              <button
                onClick={explain}
                disabled={rationaleBusy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg glass border border-border-subtle text-fg-secondary text-sm hover:text-glow-cyan hover:border-glow-cyan/40 transition-colors disabled:opacity-50"
              >
                {rationaleBusy ? "Explaining…" : "✦ Explain with AI"}
              </button>
              {rationaleError && (
                <p className="mt-2 text-xs font-mono text-fg-muted">{rationaleError}</p>
              )}
              {rationale && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 rounded-xl border border-glow-cyan/25 bg-glow-cyan/5 p-4 text-sm text-fg-secondary leading-relaxed"
                >
                  {rationale}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
