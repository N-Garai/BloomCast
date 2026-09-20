"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { API } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

interface Scenario {
  temp_delta_c: number;
  nutrient_reduction_pct: number;
  projected_p_bloom: number;
  projected_annual_high_risk_days: number;
  label: string;
}

export function SandboxClient() {
  const [wbId, setWbId] = useState("CH-ZUR-01");
  const [data, setData] = useState<{ name: string; baseline_annual_high_risk_days: number; scenarios: Record<string, Scenario> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tempDelta, setTempDelta] = useState(0);
  const [nutrient, setNutrient] = useState(0);

  const load = (id: string) => {
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/sandbox/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} on /v1/sandbox/${id}`);
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch((e) => { setLoading(false); setError(String(e?.message ?? e)); setData(null); });
  };

  useEffect(() => {
    load(wbId);
  }, [wbId]);

  if (loading && !data) return <Spinner label="Loading sandbox scenarios" />;
  if ((error && !data) || (!loading && !data)) {
    return <ErrorBanner message={error ?? "No sandbox data."} onRetry={() => load(wbId)} />;
  }
  if (!data) return null;

  const key = `temp+${tempDelta}_nut-${nutrient}`;
  const scenario = data.scenarios[key];
  const baseline = data.baseline_annual_high_risk_days;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-3">
        {["CH-ZUR-01", "CH-GVA-01", "IT-MAG-01", "DE-CON-01", "IT-GAR-01"].map((id) => (
          <button
            key={id}
            onClick={() => setWbId(id)}
            className={`px-4 py-2 rounded-lg text-sm border transition-all font-mono ${
              wbId === id
                ? "bg-glow-cyan/15 border-glow-cyan/50 text-glow-cyan shadow-glow-sm"
                : "glass border-border-subtle text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="glass rounded-2xl p-8 border border-border-subtle">
          <h3 className="font-display text-lg font-semibold mb-6 tracking-wide">Climate forcing</h3>
          <div className="mb-8">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-fg-secondary">Warming</span>
              <span className="font-mono text-glow-orange">+{tempDelta}°C</span>
            </div>
            <input type="range" min={0} max={3} step={1} value={tempDelta} onChange={(e) => setTempDelta(Number(e.target.value))} className="w-full accent-[#ff8800]" />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-fg-secondary">Nutrient reduction</span>
              <span className="font-mono text-glow-green">−{nutrient}%</span>
            </div>
            <input type="range" min={0} max={50} step={10} value={nutrient} onChange={(e) => setNutrient(Number(e.target.value))} className="w-full accent-[#00ff88]" />
          </div>
        </div>

        <motion.div
          key={key}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass rounded-2xl p-8 border border-glow-cyan/30 relative overflow-hidden"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-glow-cyan/60 to-transparent" />
          <h3 className="font-display text-lg font-semibold mb-2">{data.name}</h3>
          <div className="text-xs text-fg-muted mb-6">{scenario?.label}</div>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-5xl font-bold text-glow-cyan tabular">
              {scenario?.projected_annual_high_risk_days ?? baseline}
            </span>
            <span className="text-sm text-fg-muted">projected high-risk days / year</span>
          </div>
          <div className="mt-4 text-sm text-fg-secondary">
            Baseline: <span className="font-mono text-fg-primary">{baseline} days</span> · Delta:{" "}
            <span className={`font-mono ${(scenario?.projected_annual_high_risk_days ?? baseline) > baseline ? "text-glow-red" : "text-glow-green"}`}>
              {(scenario?.projected_annual_high_risk_days ?? baseline) - baseline > 0 ? "+" : ""}
              {(scenario?.projected_annual_high_risk_days ?? baseline) - baseline}
            </span>
          </div>
          <div className="mt-6 pt-6 border-t border-border-faint text-xs text-fg-muted">
            Precomputed via counterfactual sweeps. Bloom probability for this scenario:{" "}
            <span className="font-mono text-fg-secondary">
              {Math.round((scenario?.projected_p_bloom ?? 0) * 100)}%
            </span>
          </div>
        </motion.div>
      </div>

      <div className="glass rounded-2xl p-8 border border-border-subtle">
        <h3 className="font-display text-lg font-semibold mb-6">All 12 scenarios</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(data.scenarios).map(([k, s]) => (
            <button
              key={k}
              onClick={() => { setTempDelta(s.temp_delta_c); setNutrient(s.nutrient_reduction_pct); }}
              className={`rounded-xl p-4 border text-left transition-all ${
                key === k ? "border-glow-cyan/60 bg-glow-cyan/10 shadow-glow-sm" : "border-border-faint hover:border-border-subtle"
              }`}
            >
              <div className="text-xs font-mono text-fg-muted">+{s.temp_delta_c}°C / −{s.nutrient_reduction_pct}%</div>
              <div className="font-display text-2xl font-bold text-fg-primary mt-1 tabular">{s.projected_annual_high_risk_days}</div>
              <div className="text-xs text-fg-faint">days/yr</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
