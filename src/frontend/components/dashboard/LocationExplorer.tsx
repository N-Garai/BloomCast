"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { API, readBody } from "@/lib/api";
import { VectorMap } from "@/components/maps/VectorMap";
import { BloomReport } from "@/components/report/BloomReport";
import { ErrorState, RiskBadge, RiskTrajectory, friendlyError } from "@/components/dashboard/Resilience";

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
  model_status?: { status?: string; reason?: string } | null;
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
  daily_outlook?: Array<{ date: string; risk_score: number; risk_level: string; rain_mm: number; temp_max_c: number | null; wind_mean_ms: number | null }>;
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

export function LocationExplorer({ onSelectWaterbody }: { onSelectWaterbody?: (id: string) => void }) {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  // Rapid map clicks must not pile up in-flight assessments (each costs two
  // upstream calls): the previous request is aborted and the new one waits
  // 600 ms so a drag-click burst becomes a single fetch.
  const flight = useRef<{ timer?: ReturnType<typeof setTimeout>; ctrl?: AbortController; autoRetried?: boolean; timedOut?: boolean }>({});

  useEffect(() => {
    if (phase !== "working") return;
    const timer = setInterval(() => setStep((current) => Math.min(current + 1, STEPS.length - 1)), 700);
    return () => clearInterval(timer);
  }, [phase]);

  const run = async (plat: string, plon: string) => {
    const la = parseFloat(plat);
    const lo = parseFloat(plon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
      setError("Enter a valid latitude (-90…90) and longitude (-180…180).");
      setPhase("error");
      return;
    }
    setPicked({ lat: la, lon: lo });
    setPhase("working");
    setStep(0);
    setError(null);
    setRetryNote(null);
    // The previous result stays mounted while the new fetch runs — the
    // working trace is updated, never blanked.
    clearTimeout(flight.current.timer);
    flight.current.ctrl?.abort();
    flight.current.autoRetried = false;
    flight.current.timer = setTimeout(() => void fetchAssessment(la, lo), 600);
  };

  const fetchAssessment = async (la: number, lo: number) => {
    const ctrl = new AbortController();
    flight.current.ctrl = ctrl;
    flight.current.timedOut = false;
    // Free-tier containers sleep after idle: a hanging request is usually a
    // cold start, not a dead service — time out loudly instead of spinning.
    const timeout = setTimeout(() => {
      flight.current.timedOut = true;
      ctrl.abort();
    }, 30000);
    try {
      const response = await fetch(`${API}/v1/explore?lat=${la}&lon=${lo}`, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (response.status === 429 && !flight.current.autoRetried) {
        // One automatic retry honoring the server's backoff, then stop —
        // hammering a throttled upstream is what causes these errors.
        flight.current.autoRetried = true;
        const waitS = Math.min(Math.max(Number(response.headers.get("Retry-After")) || 20, 1), 120);
        setRetryNote(`Weather service is throttling requests — retrying automatically in ${waitS}s…`);
        flight.current.timer = setTimeout(() => void fetchAssessment(la, lo), waitS * 1000);
        return;
      }
      // Gateway/proxy failures come back as empty bodies or HTML — parse
      // defensively so a missing body can never mask the HTTP status.
      const { data } = await readBody(response);
      if (!response.ok) throw new Error(data?.detail ? `${data.detail} [HTTP ${response.status}]` : `HTTP ${response.status} (no error body)`);
      setResult(data as ExploreResult);
      setPhase("done");
    } catch (e) {
      clearTimeout(timeout);
      if (e instanceof DOMException && e.name === "AbortError") {
        if (!flight.current.timedOut) return;
        setError("The request timed out — the service may be waking from sleep (free tier idles). Try again in a few seconds.");
        setPhase("error");
        return;
      }
      console.error("[explore] live fetch failed:", e);
      setError(friendlyError(e, "weather"));
      setPhase("error");
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
      (position) => {
        const nextLat = position.coords.latitude.toFixed(3);
        const nextLon = position.coords.longitude.toFixed(3);
        setLat(nextLat);
        setLon(nextLon);
        setGpsBusy(false);
        run(nextLat, nextLon);
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
  // The pin follows the PICK, not the result — it appears the instant you
  // click, even if the fetch then fails. A pilot only names the pin when the
  // finished assessment is for the same spot and the pilot is actually near
  // (100 km); otherwise it stays "Picked point".
  const matchesResult = result && picked
    && result.latitude.toFixed(2) === picked.lat.toFixed(2)
    && result.longitude.toFixed(2) === picked.lon.toFixed(2);
  const nearby = matchesResult && result!.nearest_waterbody && result!.nearest_waterbody.distance_km < 100
    ? result!.nearest_waterbody
    : null;
  const placeName = nearby?.name ?? (picked ? "Picked point" : "");
  const displayLat = picked ? picked.lat.toFixed(2) : (lat || "—");
  const displayLon = picked ? picked.lon.toFixed(2) : (lon || "—");
  const markerId = picked ? (nearby?.id ?? "__picked__") : undefined;
  const mapPoints = picked ? [{ id: markerId as string, name: placeName, lat: picked.lat, lon: picked.lon, selected: true }] : [];

  return (
    <div className="glass rounded-2xl border border-border-subtle p-6 md:p-8 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-glow-violet/60 to-transparent" />
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-glow-violet opacity-60" /><span className="relative inline-flex rounded-full h-2 w-2 bg-glow-violet" /></span>
        <h2 className="font-display text-2xl font-semibold tracking-wide">Explore any location</h2>
        <span className="ml-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-glow-violet/50 text-glow-violet uppercase tracking-widest">Live</span>
      </div>
      <p className="text-sm text-fg-secondary max-w-2xl mb-5">
        Pick any point on Earth — click the offline vector map, type coordinates, use GPS, or choose a preset — and BloomCast fetches realtime weather for it on the spot and scores wash-off risk instantly. Every selection triggers a fresh live fetch; nothing here waits on the nightly job.
      </p>

      <div className="mb-4">
        <VectorMap
          points={mapPoints}
          selectedId={markerId}
          onPick={(nextLat, nextLon) => {
            const roundedLat = nextLat.toFixed(2);
            const roundedLon = nextLon.toFixed(2);
            setLat(roundedLat);
            setLon(roundedLon);
            run(roundedLat, roundedLon);
          }}
          panel={(
            <div aria-live="polite">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-glow-cyan">Coordinates</div>
              <div className="mt-2 text-sm font-medium text-fg-primary">{placeName}</div>
              <div className="mt-1 font-mono text-lg tabular text-fg-primary">{displayLat}°</div>
              <div className="font-mono text-lg tabular text-fg-primary">{displayLon}°</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-fg-muted">Lat</span>
                  <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="47.38" inputMode="decimal" className="mt-1 w-full bg-bg-deep border border-border-subtle rounded-lg px-2 py-1.5 text-fg-primary font-mono text-xs focus:border-glow-violet outline-none" />
                </label>
                <label className="block">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-fg-muted">Lon</span>
                  <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="8.54" inputMode="decimal" className="mt-1 w-full bg-bg-deep border border-border-subtle rounded-lg px-2 py-1.5 text-fg-primary font-mono text-xs focus:border-glow-violet outline-none" />
                </label>
              </div>
              <button onClick={() => run(lat, lon)} disabled={phase === "working"} className="mt-2 w-full px-3 py-2 rounded-lg bg-gradient-to-r from-glow-violet to-glow-cyan text-bg-abyss text-xs font-semibold hover:shadow-glow-md transition-all disabled:opacity-50 whitespace-nowrap">{phase === "working" ? "Fetching…" : "Check this spot"}</button>
              <button onClick={useGps} disabled={gpsBusy || phase === "working"} className="mt-2 w-full px-3 py-2 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-xs font-medium hover:bg-glow-cyan/20 transition-colors disabled:opacity-50 whitespace-nowrap">{gpsBusy ? "Locating…" : "Use my GPS"}</button>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {PRESETS.map((preset) => <button key={preset.label} onClick={() => { setLat(preset.lat); setLon(preset.lon); run(preset.lat, preset.lon); }} className="px-2 py-1 rounded-lg text-[11px] font-mono border border-border-subtle text-fg-muted hover:text-glow-cyan hover:border-glow-cyan/40 transition-colors">{preset.label}</button>)}
              </div>
              <div className="mt-2 text-[11px] leading-relaxed text-fg-muted">Click the map to move the crosshair — the assessment runs automatically.</div>
            </div>
          )}
        />
        <p className="mt-1.5 text-[11px] font-mono text-fg-faint">Offline vector map · click anywhere to run the same live assessment</p>
      </div>

      {/* Working trace: mounted from the first run on and never removed —
          working steps progress, done checks everything, error freezes at
          the failed step in red. The trace outlives every request. */}
      {phase !== "idle" && (
        <div className="mt-5 space-y-2" aria-live="polite">
          {STEPS.map((label, index) => {
            const state = phase === "done" || index < step ? "done" : phase === "error" ? (index === step ? "failed" : "waiting") : index === step ? "active" : "waiting";
            return <div key={label} className="flex items-center gap-3 text-sm"><span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-mono ${state === "done" ? "border-glow-green/60 bg-glow-green/15 text-glow-green" : state === "active" ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet" : state === "failed" ? "border-glow-red/60 bg-glow-red/15 text-glow-red" : "border-border-subtle text-fg-faint"}`}>{state === "done" ? "✓" : state === "failed" ? "✕" : `0${index + 1}`}</span><span className={state === "waiting" ? "text-fg-faint" : "text-fg-primary"}>{label}{state === "active" ? "…" : ""}{state === "failed" ? " — failed here" : ""}</span></div>;
          })}
        </div>
      )}
      <AnimatePresence mode="wait">
        {phase === "error" && error && <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-5"><ErrorState title="Live fetch failed" message={error} onRetry={() => run(lat, lon)} />{retryNote && <p className="mt-2 text-[11px] font-mono text-fg-muted">{retryNote}</p>}</motion.div>}
        {(phase === "done" || (phase === "working" && result)) && result && w && (
          <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-5 rounded-xl border border-border-subtle bg-bg-deep/50 p-5">
            {phase === "working" && <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-glow-violet/40 bg-glow-violet/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-glow-violet"><span className="h-1.5 w-1.5 rounded-full bg-glow-violet animate-pulse" /> Updating assessment…</div>}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-mono text-fg-muted">{result.latitude.toFixed(3)}, {result.longitude.toFixed(3)} · fetched {new Date(result.fetched_at).toLocaleTimeString()}</div>
                <div className="mt-1 flex items-baseline gap-2"><span className="font-display text-4xl font-bold tabular text-fg-primary">{Math.round(w.risk_score * 100)}%</span><RiskBadge value={w.risk_score} level={w.risk_level} /></div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded border border-glow-green/50 text-glow-green uppercase tracking-widest animate-pulse">● realtime</span>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg bg-bg-abyss/60 p-3 border border-border-faint"><div className="text-fg-muted">Rainfall 48h</div><div className="font-mono text-fg-primary text-sm mt-0.5">{w.rainfall_48h_mm} mm</div></div>
              <div className="rounded-lg bg-bg-abyss/60 p-3 border border-border-faint"><div className="text-fg-muted">Dry days</div><div className="font-mono text-fg-primary text-sm mt-0.5">{w.dry_days_antecedent}</div></div>
              <div className="rounded-lg bg-bg-abyss/60 p-3 border border-border-faint"><div className="text-fg-muted">Week mean temp</div><div className="font-mono text-fg-primary text-sm mt-0.5">{result.week_ahead.temp_mean_c ?? "—" }°C</div></div>
              <div className="rounded-lg bg-bg-abyss/60 p-3 border border-border-faint"><div className="text-fg-muted">Week mean wind</div><div className="font-mono text-fg-primary text-sm mt-0.5">{result.week_ahead.wind_mean_ms ?? "—" } m/s</div></div>
            </div>
            <ul className="mt-3 space-y-1">{result.signals.map((signal) => <li key={signal} className="text-xs text-fg-secondary flex gap-2"><span className="text-glow-cyan">→</span>{signal}</li>)}</ul>
            {result.daily_outlook && result.daily_outlook.length > 0 && <RiskTrajectory days={result.daily_outlook} />}
            {result.past_30d && <p className="mt-3 text-[11px] font-mono text-fg-muted">Past 30 days here: {result.past_30d.temp_mean_c ?? "—" }°C mean · {result.past_30d.precip_sum_mm} mm rain — the baseline behind this outlook.</p>}
            <p className="mt-3 text-[11px] text-fg-faint">{result.method} Land cover assumed neutral — {w.impervious_note.toLowerCase().replace(/^assumed neutral[ —–-]*\s*/, "")}.</p>
            {result.model_estimate ? (
              <div className="mt-4 rounded-xl border border-glow-violet/40 bg-glow-violet/5 p-4">
                <div className="flex flex-wrap items-center gap-2 mb-1"><span className="text-[10px] font-mono px-2 py-0.5 rounded border border-glow-violet/50 text-glow-violet uppercase tracking-widest">Model estimate · experimental</span>{result.model_estimate.training_source && <span className="text-[10px] font-mono text-fg-faint">{result.model_estimate.training_source} · {result.model_estimate.model_version}</span>}</div>
                <div className="flex items-baseline gap-2"><span className="font-display text-3xl font-bold tabular text-glow-violet">{Math.round(result.model_estimate.p_bloom * 100)}%</span><span className="text-xs font-mono text-fg-muted">CI {Math.round(result.model_estimate.ci_lo * 100)}–{Math.round(result.model_estimate.ci_hi * 100)}%</span></div>
                <div className="mt-2 space-y-1">{result.model_estimate.drivers.map((driver) => <div key={driver.feature} className="flex items-center gap-2 text-xs"><span className="text-fg-secondary flex-1">{driver.human}</span><span className="font-mono text-fg-muted">{driver.shap_value > 0 ? "+" : ""}{(driver.shap_value * 100).toFixed(1)}%</span></div>)}</div>
                <p className="mt-2 text-[11px] text-fg-faint">{result.model_estimate.caveats}</p>
              </div>
            ) : <p className="mt-3 text-[11px] text-fg-faint">No exported model on this deployment yet{result.model_status?.reason ? ` — backend reports: ${result.model_status.reason}` : " — the model estimate appears once real-label artifacts are committed and loadable"}.</p>}
            {nearby && <button onClick={() => onSelectWaterbody?.(nearby!.id)} className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors">Open calibrated forecast: {nearby.name} ({nearby.distance_km} km away) →</button>}
            {!nearby && result.nearest_waterbody && <p className="mt-3 text-[11px] text-fg-faint">Nearest pilot {result.nearest_waterbody.name} is {Math.round(result.nearest_waterbody.distance_km).toLocaleString()} km away — too far for its calibrated forecast to apply. Every number above is this spot&apos;s own live assessment.</p>}
            {result && <BloomReport latitude={result.latitude} longitude={result.longitude} waterbodyName={nearby?.name} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
