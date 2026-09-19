"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "/v1";

interface Forecast {
  waterbody_id: string;
  name: string;
  p_bloom: number;
  ci_lo: number;
  ci_hi: number;
  baseline_climatology: number;
  shap_top_features: Array<{ feature: string; human: string; shap_value: number }>;
  horizons: {
    "3d": any; "5d": any; "7d": any;
  };
}

function riskLevel(p: number): string {
  if (p < 0.3) return "low";
  if (p < 0.5) return "moderate";
  if (p < 0.7) return "elevated";
  if (p < 0.85) return "high";
  return "critical";
}

function riskColor(level: string): string {
  switch (level) {
    case "low": return "text-glow-green";
    case "moderate": return "text-glow-yellow";
    case "elevated": return "text-glow-orange";
    case "high": return "text-glow-red";
    case "critical": return "text-glow-magenta";
    default: return "text-fg-muted";
  }
}

function riskBg(level: string): string {
  switch (level) {
    case "low": return "bg-glow-green/10 border-glow-green/30";
    case "moderate": return "bg-glow-yellow/10 border-glow-yellow/30";
    case "elevated": return "bg-glow-orange/10 border-glow-orange/30";
    case "high": return "bg-glow-red/10 border-glow-red/30";
    case "critical": return "bg-glow-magenta/10 border-glow-magenta/30";
    default: return "bg-bg-surface border-border-subtle";
  }
}

export function ForecastCard({
  waterbody,
  selected = false,
  onClick,
}: {
  waterbody: { id: string; name: string; region: string; country: string; centroid: [number, number] };
  selected?: boolean;
  onClick?: () => void;
}) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [horizon, setHorizon] = useState<"3d" | "5d" | "7d">("5d");

  useEffect(() => {
    fetch(`${API}/v1/forecast/${waterbody.id}`)
      .then(r => r.json())
      .then(d => setForecast(d))
      .catch(() => setForecast(null));
  }, [waterbody.id]);

  if (!forecast) {
    return (
      <div className="rounded-xl p-4 glass border border-border-subtle animate-pulse">
        <div className="h-4 w-32 bg-bg-elevated rounded mb-2" />
        <div className="h-3 w-24 bg-bg-elevated rounded" />
      </div>
    );
  }

  const h = forecast.horizons[horizon];
  const level = riskLevel(h.p_bloom);

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className={`rounded-xl p-4 border cursor-pointer transition-all ${riskBg(level)} ${
        selected ? "ring-2 ring-glow-cyan" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-display font-semibold text-fg-primary">{waterbody.name}</h3>
          <p className="text-xs text-fg-muted">{waterbody.region}, {waterbody.country}</p>
        </div>
        <span className={`text-xs font-mono px-2 py-1 rounded-full ${riskColor(level)}`}>
          {level.toUpperCase()}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className={`font-display text-3xl font-bold ${riskColor(level)}`}>
          {Math.round(h.p_bloom * 100)}
          <span className="text-lg text-fg-muted">%</span>
        </span>
        <span className="text-xs text-fg-muted">{horizon} bloom risk</span>
      </div>

      <div className="mt-2 relative h-2 bg-bg-deep rounded-full overflow-hidden">
        <div
          className="absolute h-full bg-glow-cyan/30"
          style={{
            left: `${h.ci_lo * 100}%`,
            width: `${Math.max(2, (h.ci_hi - h.ci_lo) * 100)}%`,
          }}
        />
        <div
          className="absolute h-full w-0.5 bg-glow-cyan"
          style={{ left: `${h.p_bloom * 100}%` }}
        />
      </div>
      <div className="mt-1 text-xs font-mono text-fg-secondary flex justify-between">
        <span>{Math.round(h.ci_lo * 100)}%</span>
        <span>{Math.round(h.ci_hi * 100)}%</span>
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-xs uppercase tracking-wider text-fg-muted">Why this forecast</p>
        {(h.shap_top_features ?? []).slice(0, 3).map((f: any) => (
          <div key={f.feature} className="flex items-center gap-2 text-sm">
            <span className="font-mono">{f.shap_value > 0 ? "▲" : "▼"}</span>
            <span className="text-fg-secondary flex-1">{f.human}</span>
            <span className={`font-mono ${f.shap_value > 0 ? "text-glow-orange" : "text-glow-green"}`}>
              {f.shap_value > 0 ? "+" : ""}{(f.shap_value * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-border-faint text-xs text-fg-muted flex justify-between">
        <span>Climatology: {Math.round(forecast.baseline_climatology * 100)}%</span>
        <span>Delta: +{Math.round((h.p_bloom - forecast.baseline_climatology) * 100)}%</span>
      </div>

      <div className="mt-3 flex gap-2">
        {(["3d", "5d", "7d"] as const).map(hz => (
          <button
            key={hz}
            onClick={e => { e.stopPropagation(); setHorizon(hz); }}
            className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
              horizon === hz ? "bg-glow-cyan/20 text-glow-cyan" : "text-fg-muted hover:text-fg-primary"
            }`}
          >
            {hz}
          </button>
        ))}
      </div>
    </motion.div>
  );
}