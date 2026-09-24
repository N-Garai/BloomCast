"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { ErrorState, friendlyError } from "@/components/dashboard/Resilience";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/streamflush`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => setSegments((data.data ?? []) as Segment[]))
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="absolute bottom-4 left-4 z-10 w-[340px] max-w-xs rounded-xl border border-border-subtle bg-bg-deep/90 p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 mb-2"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-glow-cyan opacity-60" /><span className="relative inline-flex rounded-full h-2 w-2 bg-glow-cyan" /></span><h3 className="text-sm font-semibold text-fg-primary">StreamFlush Nowcast</h3></div>
      <p className="text-xs text-fg-muted mb-3">Urban stream post-storm wash-off risk — covers streams satellites cannot see.</p>
      {loading && <div className="text-xs text-fg-muted">Loading stream signals…</div>}
      {error && !loading && <ErrorState title="Stream signals unavailable" message={error} onRetry={load} />}
      {!loading && !error && segments.length === 0 && <div className="rounded-lg border border-border-subtle bg-bg-abyss/50 p-3 text-xs text-fg-muted">No stream segments returned for this deployment.</div>}
      {!loading && !error && segments.slice(0, 4).map((segment) => <div key={segment.segment_id} className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="truncate text-fg-secondary">{segment.name}</span><span className={`shrink-0 font-mono px-2 py-0.5 rounded border tabular ${LEVEL_STYLES[segment.risk_level] ?? LEVEL_STYLES.low}`}>{Math.round(segment.risk_score * 100)}%</span></div>)}
    </div>
  );
}
