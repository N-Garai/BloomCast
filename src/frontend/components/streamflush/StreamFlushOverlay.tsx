"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "https://bloomcast-api.onrender.com";

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
      .then(r => r.json())
      .then(d => setSegments(d.data ?? []))
      .catch(() => setSegments([]));
  }, []);

  return (
    <div className="absolute bottom-4 left-4 z-10 glass rounded-xl p-4 border border-border-subtle max-w-xs">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-glow-cyan animate-pulse" />
        <h3 className="text-sm font-semibold text-fg-primary">StreamFlush Nowcast</h3>
      </div>
      <p className="text-xs text-fg-muted mb-3">
        Urban stream post-storm wash-off risk — covers streams satellites cannot see.
      </p>
      <div className="space-y-2">
        {segments.slice(0, 5).map(s => (
          <div key={s.segment_id} className="flex items-center justify-between text-xs">
            <span className="text-fg-secondary truncate mr-2">{s.name}</span>
            <span className={`font-mono px-2 py-0.5 rounded border ${LEVEL_STYLES[s.risk_level]}`}>
              {Math.round(s.risk_score * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}