"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { API } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

interface Segment {
  segment_id: string;
  name: string;
  city: string;
  country: string;
  risk_score: number;
  risk_level: string;
  rainfall_48h_mm: number;
  dry_days_antecedent: number;
  impervious_proxy: number;
}

const STYLES: Record<string, string> = {
  low: "text-glow-green border-glow-green/30 bg-glow-green/5",
  moderate: "text-glow-yellow border-glow-yellow/30 bg-glow-yellow/5",
  high: "text-glow-orange border-glow-orange/30 bg-glow-orange/5",
  critical: "text-glow-red border-glow-red/30 bg-glow-red/10 animate-pulse",
};

export function StreamFlushClient() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/streamflush`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} on /v1/streamflush`);
        return r.json();
      })
      .then((d) => { setSegments(d.data ?? []); setLoading(false); })
      .catch((e) => { setLoading(false); setError(String(e?.message ?? e)); });
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <Spinner label="Loading stream nowcast" />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!segments.length) return <ErrorBanner message="No stream segments returned." onRetry={load} />;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {segments.map((s, i) => (
        <motion.div
          key={s.segment_id}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: Math.min(i * 0.06, 0.4) }}
          className="glass rounded-2xl p-6 border border-border-subtle relative overflow-hidden hover:border-glow-cyan/30 transition-colors"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-display text-lg font-semibold tracking-wide">{s.name}</h3>
              <p className="text-xs text-fg-muted">{s.city}, {s.country}</p>
            </div>
            <span className={`text-xs font-mono px-2.5 py-1 rounded-full border ${STYLES[s.risk_level] ?? STYLES.low}`}>
              {s.risk_level.toUpperCase()}
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-4">
            <span className="font-display text-4xl font-bold text-fg-primary tabular">
              {Math.round(s.risk_score * 100)}%
            </span>
            <span className="text-xs text-fg-muted">wash-off risk</span>
          </div>

          <div className="relative h-2 bg-bg-deep rounded-full overflow-hidden mb-4">
            <motion.div
              className="absolute h-full bg-gradient-to-r from-glow-cyan to-glow-magenta"
              initial={{ width: 0 }}
              whileInView={{ width: `${s.risk_score * 100}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg bg-bg-deep/60 p-3 border border-border-faint">
              <div className="text-fg-muted">Rainfall 48h</div>
              <div className="font-mono text-fg-primary text-sm mt-0.5">{s.rainfall_48h_mm} mm</div>
            </div>
            <div className="rounded-lg bg-bg-deep/60 p-3 border border-border-faint">
              <div className="text-fg-muted">Dry days</div>
              <div className="font-mono text-fg-primary text-sm mt-0.5">{s.dry_days_antecedent}</div>
            </div>
            <div className="rounded-lg bg-bg-deep/60 p-3 border border-border-faint">
              <div className="text-fg-muted">Impervious</div>
              <div className="font-mono text-fg-primary text-sm mt-0.5">{Math.round(s.impervious_proxy * 100)}%</div>
            </div>
          </div>

          <a
            href={`/report?segment=${s.segment_id}`}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors"
          >
            Submit observation →
          </a>
        </motion.div>
      ))}
    </div>
  );
}
