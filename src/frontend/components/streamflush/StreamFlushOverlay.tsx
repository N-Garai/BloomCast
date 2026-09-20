"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";

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

const LEVEL_STYLES: Record<string, string> = {
  low: "text-glow-green border-glow-green/30",
  moderate: "text-glow-yellow border-glow-yellow/30",
  high: "text-glow-orange border-glow-orange/30",
  critical: "text-glow-red border-glow-red/30 animate-pulse",
};

export function StreamFlushOverlay() {
  const [segments, setSegments] = useState<Segment[]>([]);

  useEffect(() => {
    fetch(`${API}/v1/streamflush`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => setSegments(d.data ?? []))
      .catch(() => setSegments([]));
  }, []);

  if (!segments.length) return null;

  return (
    <div className="absolute bottom-4 left-4 z-10 glass rounded-xl p-4 border border-border-subtle max-w-xs backdrop-blur-xl">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-glow-cyan opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-glow-cyan" />
        </span>
        <h3 className="text-sm font-semibold text-fg-primary">StreamFlush Nowcast</h3>
      </div>
      <p className="text-xs text-fg-muted mb-3">
        Urban stream post-storm wash-off risk — covers streams satellites cannot see.
      </p>
      <div className="space-y-2">
        {segments.slice(0, 5).map(s => (
          <div key={s.segment_id} className="flex items-center justify-between text-xs">
            <span className="text-fg-secondary truncate mr-2">{s.name}</span>
            <span className={`font-mono px-2 py-0.5 rounded border tabular ${LEVEL_STYLES[s.risk_level] ?? LEVEL_STYLES.low}`}>
              {Math.round(s.risk_score * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
