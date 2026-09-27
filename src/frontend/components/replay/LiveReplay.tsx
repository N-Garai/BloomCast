"use client";

import { useRef, useState } from "react";

import { API, readBody } from "@/lib/api";
import { VectorMap } from "@/components/maps/VectorMap";
import { RiskTrajectory, friendlyError } from "@/components/dashboard/Resilience";

interface LiveResult {
  latitude: number;
  longitude: number;
  provenance: string;
  fetched_at: string;
  method: string;
  wash_off: { risk_score: number; risk_level: string };
  model_estimate?: {
    p_bloom: number;
    ci_lo: number;
    ci_hi: number;
    drivers: Array<{ feature: string; human: string; shap_value: number }>;
    training_source?: string;
  } | null;
  signals?: string[];
  daily_outlook?: Array<{ date: string; risk_score: number; risk_level: string }>;
  nearest_waterbody?: { id: string; name: string; distance_km: number } | null;
}

/**
 * Live simulation for an arbitrary map point. Documented replay events have
 * satellite-confirmed history; random points do not — so this mode runs the
 * same live assessment as the forecast page (heuristic + trajectory + model
 * estimate) and labels itself as simulation, never as a documented event.
 */
export function LiveReplay() {
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef<AbortController | null>(null);

  const run = async (latitude: number, longitude: number) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    setPicked({ lat: latitude, lon: longitude });
    setLoading(true);
    setError(null);
    flight.current?.abort();
    const ctrl = new AbortController();
    flight.current = ctrl;
    try {
      const response = await fetch(`${API}/v1/explore?lat=${latitude}&lon=${longitude}`, { signal: ctrl.signal });
      const { data } = await readBody(response);
      if (!response.ok) throw new Error(data?.detail ? `${data.detail} [HTTP ${response.status}]` : `HTTP ${response.status}`);
      setResult(data as LiveResult);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("[live-replay] assessment failed:", e);
      setError(friendlyError(e, "weather"));
    } finally {
      setLoading(false);
    }
  };

  const points = picked
    ? [{ id: "__picked__", name: "Simulation point", lat: picked.lat, lon: picked.lon, risk: undefined, selected: true }]
    : [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-glow-violet/30 bg-glow-violet/5 px-4 py-3 text-xs text-fg-secondary">
        Live simulation — pick any point and the current 7-day outlook is computed on the spot.
        This is not a documented historical event: no satellite confirmation, no NDCI history.
      </div>
      <VectorMap points={points} selectedId={picked ? "__picked__" : undefined} onPick={run} />
      {loading && !result && (
        <p className="text-xs text-fg-muted font-mono">Fetching live assessment…</p>
      )}
      {error && (
        <p className="text-xs font-mono text-glow-red">{error}</p>
      )}
      {result && (
        <div className="glass rounded-2xl p-6 border border-border-subtle">
          <div className="text-xs font-mono text-fg-muted">
            {result.latitude.toFixed(2)}, {result.longitude.toFixed(2)} · fetched {new Date(result.fetched_at).toLocaleTimeString()}
            {loading ? " · updating…" : ""}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-4xl font-bold tabular text-fg-primary">
              {Math.round(result.wash_off.risk_score * 100)}%
            </span>
            <span className="text-xs font-mono uppercase tracking-widest text-fg-muted">
              {result.wash_off.risk_level} wash-off risk
            </span>
          </div>
          {result.daily_outlook && result.daily_outlook.length > 0 && (
            <RiskTrajectory days={result.daily_outlook} />
          )}
          {result.model_estimate ? (
            <div className="mt-4 rounded-xl border border-glow-violet/40 bg-glow-violet/5 p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-glow-violet mb-1">
                Model estimate · experimental{result.model_estimate.training_source ? ` · ${result.model_estimate.training_source}` : ""}
              </div>
              <div className="font-display text-3xl font-bold tabular text-glow-violet">
                {Math.round(result.model_estimate.p_bloom * 100)}%
                <span className="ml-2 text-xs font-mono text-fg-muted">
                  CI {Math.round(result.model_estimate.ci_lo * 100)}–{Math.round(result.model_estimate.ci_hi * 100)}%
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-fg-faint">No exported model on this deployment yet — heuristic only.</p>
          )}
          <p className="mt-3 text-[11px] text-fg-faint">{result.method}</p>
        </div>
      )}
    </div>
  );
}
