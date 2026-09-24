"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { API } from "@/lib/api";
import { Advisory, ErrorState, SkeletonCard, friendlyError } from "@/components/dashboard/Resilience";

interface Forecast {
  waterbody_id: string;
  name: string;
  p_bloom: number;
  ci_lo: number;
  ci_hi: number;
  baseline_climatology: number;
  shap_top_features: Array<{ feature: string; human: string; shap_value: number }>;
  horizons: { "3d": any; "5d": any; "7d": any };
}

function riskLevel(value: number) {
  if (value < 0.3) return "low";
  if (value < 0.5) return "moderate";
  if (value < 0.7) return "elevated";
  if (value < 0.85) return "high";
  return "critical";
}

function riskColor(level: string) {
  return { low: "text-glow-green", moderate: "text-glow-yellow", elevated: "text-glow-orange", high: "text-glow-red", critical: "text-glow-magenta" }[level] ?? "text-fg-muted";
}

function riskBackground(level: string) {
  return { low: "bg-glow-green/10 border-glow-green/30", moderate: "bg-glow-yellow/10 border-glow-yellow/30", elevated: "bg-glow-orange/10 border-glow-orange/30", high: "bg-glow-red/10 border-glow-red/30", critical: "bg-glow-magenta/10 border-glow-magenta/30" }[level] ?? "bg-bg-surface border-border-subtle";
}

export function ForecastCard({ waterbody, selected = false, onClick }: { waterbody: { id: string; name: string; region: string; country: string; centroid: [number, number] }; selected?: boolean; onClick?: () => void }) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<"3d" | "5d" | "7d">("5d");

  useEffect(() => {
    let live = true;
    setForecast(null);
    setError(null);
    fetch(`${API}/v1/forecast/${waterbody.id}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => { if (live) setForecast(data); })
      .catch((e) => { if (live) setError(friendlyError(e, "forecast")); });
    return () => { live = false; };
  }, [waterbody.id]);

  if (error) return <div className="rounded-xl border border-glow-red/30 bg-glow-red/5 p-4"><p className="text-sm text-fg-primary">{waterbody.name}</p><p className="mt-1 text-xs text-fg-muted">Forecast unavailable right now.</p><ErrorState title="Forecast unavailable" message={error} onRetry={() => window.location.reload()} /></div>;
  if (!forecast) return <SkeletonCard />;

  const horizonData = forecast.horizons?.[horizon];
  if (!horizonData) return <div className="rounded-xl border border-border-subtle p-4 text-xs text-fg-muted">Forecast data is missing this horizon.</div>;
  const level = riskLevel(horizonData.p_bloom);
  const drivers = ((horizonData.shap_top_features ?? []) as Array<{ feature: string; human: string; shap_value: number }>).slice(0, 3);

  return (
    <motion.div whileHover={{ scale: 1.01 }} onClick={onClick} className={`relative min-h-[230px] rounded-xl border p-4 cursor-pointer transition-all ${riskBackground(level)} ${selected ? "ring-2 ring-glow-cyan shadow-glow-md" : ""}`} aria-pressed={selected}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="truncate font-display font-semibold text-fg-primary tracking-wide">{waterbody.name}</h3><p className="truncate text-xs text-fg-muted">{waterbody.region}, {waterbody.country}</p></div>
        <span className={`shrink-0 text-xs font-mono px-2 py-1 rounded-full border border-current ${riskColor(level)}`}>{level.toUpperCase()}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2"><motion.span key={horizon + Math.round(horizonData.p_bloom * 100)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`font-display text-3xl font-bold ${riskColor(level)}`}>{Math.round(horizonData.p_bloom * 100)}<span className="text-lg text-fg-muted">%</span></motion.span><span className="text-xs text-fg-muted">{horizon} bloom risk</span></div>
      <div className="mt-2 relative h-2 bg-bg-deep rounded-full overflow-hidden"><div className="absolute h-full bg-glow-cyan/30" style={{ left: `${Math.max(0, horizonData.ci_lo * 100)}%`, width: `${Math.max(2, Math.min(100, (horizonData.ci_hi - horizonData.ci_lo) * 100))}%` }} /><div className="absolute h-full w-0.5 bg-glow-cyan" style={{ left: `${Math.max(0, Math.min(100, horizonData.p_bloom * 100))}%` }} /></div>
      <div className="mt-1 text-xs font-mono text-fg-secondary flex justify-between"><span>{Math.round(horizonData.ci_lo * 100)}%</span><span>{Math.round(horizonData.ci_hi * 100)}%</span></div>
      <div className="mt-3 space-y-1"><p className="text-xs uppercase tracking-wider text-fg-muted">Why this forecast</p>{drivers.length ? drivers.map((driver, index) => <motion.div key={driver.feature} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.08 }} className="flex items-center gap-2 text-sm"><span className="font-mono">{driver.shap_value > 0 ? "▲" : "▼"}</span><span className="text-fg-secondary flex-1 truncate">{driver.human}</span><span className={`font-mono shrink-0 ${driver.shap_value > 0 ? "text-glow-orange" : "text-glow-green"}`}>{driver.shap_value > 0 ? "+" : ""}{(driver.shap_value * 100).toFixed(0)}%</span></motion.div>) : <p className="text-xs text-fg-faint">Driver details are not exported for this deployment.</p>}</div>
      <div className="mt-3 pt-3 border-t border-border-faint text-xs text-fg-muted flex flex-wrap justify-between gap-2"><span>Climatology: {Math.round(forecast.baseline_climatology * 100)}%</span><span>Delta: {forecast.baseline_climatology >= horizonData.p_bloom ? "−" : "+"}{Math.round(Math.abs(horizonData.p_bloom - forecast.baseline_climatology) * 100)}%</span></div>
      <div className="mt-3 flex gap-2">{(["3d", "5d", "7d"] as const).map((nextHorizon) => <button key={nextHorizon} onClick={(event) => { event.stopPropagation(); setHorizon(nextHorizon); }} className={`px-2 py-1 rounded text-xs font-mono transition-colors ${horizon === nextHorizon ? "bg-glow-cyan/20 text-glow-cyan" : "text-fg-muted hover:text-fg-primary"}`}>{nextHorizon}</button>)}</div>
      <Advisory />
    </motion.div>
  );
}
