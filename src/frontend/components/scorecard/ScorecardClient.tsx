"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { API } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

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
  per_region?: Record<string, { auc: number | null; brier: number; n: number; positive_rate: number }>;
  holdout_region?: { status: string; protocol?: string; mean_auc?: number | null; worst_region?: { name: string; auc: number | null; n: number } | null; regions?: Record<string, { auc: number | null; brier: number | null; n: number; note?: string }> ; reason?: string };
  eu_holdout?: { status: string; reason: string };
  variants?: Record<string, { auc: number; brier: number; n: number; features?: number; provenance: string; note?: string }>;
}

function Metric({ label, value, hint, delay = 0 }: { label: string; value: string; hint?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5 }}
      className="glass rounded-xl p-5 border border-border-subtle relative overflow-hidden"
    >
      <div className="text-xs uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="font-display text-3xl font-bold text-glow-cyan mt-1 tabular">{value}</div>
      {hint && <div className="text-xs text-fg-faint mt-1">{hint}</div>}
    </motion.div>
  );
}

export function ScorecardClient() {
  const [sc, setSc] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/scorecard`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} on /v1/scorecard`);
        return r.json();
      })
      .then(d => { setSc(d); setLoading(false); })
      .catch((e) => { setLoading(false); setError(String(e?.message ?? e)); });
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !sc) return <Spinner label="Loading integrity scorecard" />;
  if ((error && !sc) || (!loading && !sc)) {
    return <ErrorBanner message={error ?? "Scorecard unavailable."} onRetry={load} />;
  }
  if (!sc) return null;

  return (
    <div className="space-y-8">
      {(sc as any).training_source && (
        <div className="rounded-2xl border border-glow-violet/30 bg-glow-violet/5 px-5 py-4 text-sm">
          <span className="font-mono text-xs uppercase tracking-widest text-glow-violet">
            Training provenance
          </span>
          <p className="mt-1 text-fg-secondary">
            {(sc as any).training_source === "tick-tick-bloom"
              ? "Trained on real Tick Tick Bloom in-situ labels."
              : "Trained on synthetic stand-in labels — metrics describe the generator, not real-lake skill."}{" "}
            <span className="font-mono text-xs text-fg-muted">
              5-fold time-series CV · OOF AUC {((sc as any).oof_auc ?? sc.auc).toFixed(3)} · n={sc.sample_size}
            </span>
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="Brier score" value={sc.brier.toFixed(3)} hint="lower is better" delay={0} />
        <Metric label="ROC-AUC" value={sc.auc.toFixed(3)} hint="discrimination" delay={0.08} />
        <Metric label="Hit rate" value={`${(sc.hit_rate * 100).toFixed(0)}%`} hint="predicted | observed" delay={0.16} />
        <Metric label="False alarm" value={`${(sc.false_alarm_rate * 100).toFixed(0)}%`} hint="predicted | not observed" delay={0.24} />
      </div>

      <div className="glass rounded-2xl p-8 border border-border-subtle">
        <h3 className="font-display text-lg font-semibold mb-6 tracking-wide">Reliability diagram</h3>
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
            ["vs climatology", sc.delta_vs_climatology],
            ["vs persistence", sc.delta_vs_persistence],
            ["vs weather-only", sc.delta_vs_weather_only],
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

      {sc.per_region && Object.keys(sc.per_region).length > 0 && (
        <div className="glass rounded-2xl p-8 border border-glow-violet/30">
          <h3 className="font-display text-lg font-semibold mb-2 tracking-wide">Skill by region</h3>
          <p className="text-xs text-fg-muted mb-4">
            Region IDs never enter any fitted model — only the climatology baseline sees
            them. This table audits whether skill is evenly spread or geography-dependent.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg-muted text-xs uppercase tracking-wider">
                  <th className="text-left pb-3">Region</th>
                  <th className="text-right pb-3">Samples</th>
                  <th className="text-right pb-3">AUC</th>
                  <th className="text-right pb-3">Brier</th>
                  <th className="text-right pb-3">Positive rate</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(sc.per_region).map(([name, m]) => (
                  <tr key={name} className="border-t border-border-faint text-fg-secondary">
                    <td className="py-3 capitalize">{name}</td>
                    <td className="text-right font-mono">{m.n}</td>
                    <td className="text-right font-mono">{m.auc == null ? "—" : m.auc.toFixed(3)}</td>
                    <td className="text-right font-mono">{m.brier.toFixed(3)}</td>
                    <td className="text-right font-mono">{(m.positive_rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="glass rounded-2xl p-8 border border-glow-yellow/30">
        <h3 className="font-display text-lg font-semibold mb-3 text-glow-yellow">Honest limitations</h3>
        <p className="text-sm text-fg-secondary leading-relaxed">{sc.limitations}</p>
        {sc.eu_holdout && (
          <p className="mt-3 text-xs text-fg-muted leading-relaxed">
            <span className="font-mono uppercase tracking-widest text-glow-yellow">EU hold-out: {sc.eu_holdout.status}</span>
            {" — "}{sc.eu_holdout.reason}
          </p>
        )}
        <div className="mt-6 text-xs text-fg-muted">
          Calibration: {sc.calibration_method} · n={sc.sample_size}
        </div>
      </div>

      {sc.holdout_region && sc.holdout_region.status === "ok" && (
        <div className="glass rounded-2xl p-8 border border-border-subtle">
          <h3 className="font-display text-lg font-semibold mb-2 tracking-wide">Region hold-out rotation</h3>
          <p className="text-xs text-fg-muted mb-4">
            {sc.holdout_region.protocol} Mean AUC {sc.holdout_region.mean_auc?.toFixed(3) ?? "—"} ·
            worst region {sc.holdout_region.worst_region?.name ?? "—"} ({sc.holdout_region.worst_region?.auc?.toFixed(3) ?? "—"}).
            The worst region is the number a new deployment actually experiences.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg-muted text-xs uppercase tracking-wider">
                  <th className="text-left pb-3">Held-out region</th>
                  <th className="text-right pb-3">Samples</th>
                  <th className="text-right pb-3">AUC</th>
                  <th className="text-right pb-3">Brier</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(sc.holdout_region.regions ?? {}).map(([name, m]) => (
                  <tr key={name} className="border-t border-border-faint text-fg-secondary">
                    <td className="py-3 capitalize">{name}</td>
                    <td className="text-right font-mono">{m.n}</td>
                    <td className="text-right font-mono">{m.auc == null ? "—" : m.auc.toFixed(3)}</td>
                    <td className="text-right font-mono">{m.brier == null ? "—" : m.brier.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.values(sc.holdout_region.regions ?? {}).some((m: any) => m.note) && (
            <p className="mt-3 text-xs text-fg-faint">Single-class hold-outs report no AUC — there is nothing to discriminate.</p>
          )}
        </div>
      )}

      {sc.variants && Object.keys(sc.variants).length > 0 && (
        <div className="glass rounded-2xl p-8 border border-glow-violet/30">
          <h3 className="font-display text-lg font-semibold mb-2 tracking-wide">Model variants</h3>
          <p className="text-xs text-fg-muted mb-4">
            The weather-only variant answers arbitrary coordinates where no satellite pixels exist.
            Lower skill is expected and published — not hidden.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg-muted text-xs uppercase tracking-wider">
                  <th className="text-left pb-3">Variant</th>
                  <th className="text-right pb-3">Samples</th>
                  <th className="text-right pb-3">AUC</th>
                  <th className="text-right pb-3">Brier</th>
                  <th className="text-right pb-3">Trained on</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(sc.variants).map(([name, m]) => (
                  <tr key={name} className="border-t border-border-faint text-fg-secondary">
                    <td className="py-3 capitalize">{name.replace(/_/g, " ")}</td>
                    <td className="text-right font-mono">{m.n}</td>
                    <td className="text-right font-mono">{m.auc.toFixed(3)}</td>
                    <td className="text-right font-mono">{m.brier.toFixed(3)}</td>
                    <td className="text-right font-mono text-xs">{m.provenance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.values(sc.variants).map((m) => m.note).filter(Boolean)[0] && (
            <p className="mt-3 text-xs text-fg-faint">{Object.values(sc.variants).map((m) => m.note).filter(Boolean)[0]}</p>
          )}
        </div>
      )}
    </div>
  );
}
