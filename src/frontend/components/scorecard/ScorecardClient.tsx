"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "/v1";

interface Scorecard {
  model_version: string;
  sample_size: number;
  brier: number;
  auc: number;
  hit_rate: number;
  false_alarm_rate: number;
  reliability_diagram: { prob_true: number[]; prob_pred: number[] };
  baselines: Record<string, { auc: number; brier: number; hit_rate: number; false_alarm_rate: number }>;
  delta_vs_climatology: { brier: number; auc: number };
  delta_vs_persistence: { brier: number; auc: number };
  delta_vs_weather_only: { brier: number; auc: number };
  calibration_method: string;
  limitations: string;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass rounded-xl p-5 border border-border-subtle">
      <div className="text-xs uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="font-display text-3xl font-bold text-glow-cyan mt-1">{value}</div>
      {hint && <div className="text-xs text-fg-faint mt-1">{hint}</div>}
    </div>
  );
}

export function ScorecardClient() {
  const [sc, setSc] = useState<Scorecard | null>(null);

  useEffect(() => {
    fetch(`${API}/v1/scorecard`)
      .then((r) => r.json())
      .then(d => setSc(d))
      .catch(() => setSc(null));
  }, []);

  if (!sc) return <div className="text-fg-muted">Loading scorecard…</div>;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="Brier score" value={sc.brier.toFixed(3)} hint="lower is better" />
        <Metric label="ROC-AUC" value={sc.auc.toFixed(3)} hint="discrimination" />
        <Metric label="Hit rate" value={`${(sc.hit_rate * 100).toFixed(0)}%`} hint="predicted | observed" />
        <Metric label="False alarm" value={`${(sc.false_alarm_rate * 100).toFixed(0)}%`} hint="predicted | not observed" />
      </div>

      <div className="glass rounded-2xl p-8 border border-border-subtle">
        <h3 className="font-display text-lg font-semibold mb-6">Reliability diagram</h3>
        <div className="relative h-56 bg-bg-abyss rounded-xl border border-border-faint">
          <svg viewBox="0 0 400 200" className="w-full h-full">
            <line x1="20" y1="180" x2="380" y2="180" stroke="#3d5666" strokeWidth="1" />
            <line x1="20" y1="20" x2="20" y2="180" stroke="#3d5666" strokeWidth="1" />
            <line x1="20" y1="180" x2="380" y2="20" stroke="#3d5666" strokeWidth="1" strokeDasharray="4 4" />
            <motion.polyline
              points={sc.reliability_diagram.prob_pred.map((p, i) => `${20 + p * 360},${180 - sc.reliability_diagram.prob_true[i] * 160}`).join(" ")}
              fill="none"
              stroke="#00f0d4"
              strokeWidth="2.5"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.2 }}
            />
            {sc.reliability_diagram.prob_pred.map((p, i) => (
              <circle key={i} cx={20 + p * 360} cy={180 - sc.reliability_diagram.prob_true[i] * 160} r="4" fill="#00f0d4" />
            ))}
          </svg>
        </div>
        <div className="flex justify-between text-xs font-mono text-fg-muted mt-2">
          <span>0%</span><span>predicted probability</span><span>100%</span>
        </div>
      </div>

      <div className="glass rounded-2xl p-8 border border-border-subtle">
        <h3 className="font-display text-lg font-semibold mb-6">Baseline comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-fg-muted text-xs uppercase tracking-wider">
                <th className="text-left pb-3">Model</th>
                <th className="text-right pb-3">Brier</th>
                <th className="text-right pb-3">AUC</th>
                <th className="text-right pb-3">Hit rate</th>
                <th className="text-right pb-3">False alarm</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border-faint text-glow-cyan">
                <td className="py-3 font-medium">BloomCast hybrid</td>
                <td className="text-right font-mono">{sc.brier.toFixed(3)}</td>
                <td className="text-right font-mono">{sc.auc.toFixed(3)}</td>
                <td className="text-right font-mono">{(sc.hit_rate * 100).toFixed(0)}%</td>
                <td className="text-right font-mono">{(sc.false_alarm_rate * 100).toFixed(0)}%</td>
              </tr>
              {Object.entries(sc.baselines).map(([name, m]) => (
                <tr key={name} className="border-t border-border-faint text-fg-secondary">
                  <td className="py-3 capitalize">{name.replace(/_/g, " ")}</td>
                  <td className="text-right font-mono">{m.brier.toFixed(3)}</td>
                  <td className="text-right font-mono">{m.auc.toFixed(3)}</td>
                  <td className="text-right font-mono">{(m.hit_rate * 100).toFixed(0)}%</td>
                  <td className="text-right font-mono">{(m.false_alarm_rate * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 grid md:grid-cols-3 gap-4 text-sm">
          {[
            ["Δ vs climatology", sc.delta_vs_climatology],
            ["Δ vs persistence", sc.delta_vs_persistence],
            ["Δ vs weather-only", sc.delta_vs_weather_only],
          ].map(([label, d]: any) => (
            <div key={label} className="rounded-lg bg-bg-deep/60 p-4 border border-border-faint">
              <div className="text-xs text-fg-muted mb-1">{label}</div>
              <div className="font-mono text-sm">
                <span className={d.brier < 0 ? "text-glow-green" : "text-glow-red"}>Brier {d.brier > 0 ? "+" : ""}{d.brier.toFixed(3)}</span>
                <span className="text-fg-faint mx-2">·</span>
                <span className={d.auc > 0 ? "text-glow-green" : "text-glow-red"}>AUC {d.auc > 0 ? "+" : ""}{d.auc.toFixed(3)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass rounded-2xl p-8 border border-glow-yellow/30">
        <h3 className="font-display text-lg font-semibold mb-3 text-glow-yellow">Honest limitations</h3>
        <p className="text-sm text-fg-secondary leading-relaxed">{sc.limitations}</p>
        <div className="mt-6 text-xs text-fg-muted">
          Calibration: {sc.calibration_method} · Model version: <span className="font-mono">{sc.model_version}</span> · n={sc.sample_size}
        </div>
      </div>
    </div>
  );
}