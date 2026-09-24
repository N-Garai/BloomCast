"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { Advisory, ErrorState, SkeletonCard } from "@/components/dashboard/Resilience";

interface Waterbody {
  id: string;
  name: string;
  region: string;
  country: string;
  centroid: [number, number];
}

interface Forecast {
  horizons?: Record<string, { p_bloom: number; ci_lo: number; ci_hi: number }>;
  p_bloom?: number;
  baseline_climatology?: number;
}

interface StreamSegment {
  name: string;
  risk_score: number;
  risk_level: string;
}

interface Scorecard {
  sample_size: number;
  auc: number;
  brier: number;
  limitations: string;
}

function level(value: number) {
  return value < 0.3 ? "low" : value < 0.5 ? "moderate" : value < 0.7 ? "elevated" : value < 0.85 ? "high" : "critical";
}

export function OneHealthSummary() {
  const [waterbodies, setWaterbodies] = useState<Waterbody[]>([]);
  const [forecasts, setForecasts] = useState<Record<string, Forecast>>({});
  const [streams, setStreams] = useState<StreamSegment[]>([]);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [fhirAvailable, setFhirAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${API}/v1/waterbodies?limit=25`).then((r) => r.json()),
      fetch(`${API}/v1/streamflush`).then((r) => r.json()),
      fetch(`${API}/v1/scorecard`).then((r) => r.json()),
      fetch(`${API}/v1/fhir/Communication/sample`).then((r) => {
        if (!r.ok) throw new Error("FHIR sample unavailable");
        return r.json();
      }),
    ])
      .then(([waterbodyData, streamData, scoreData, fhirData]) => {
        const features = (waterbodyData.data ?? waterbodyData.features ?? []).filter((f: any) => f?.type === "Feature");
        const mapped: Waterbody[] = features.map((f: any) => {
          const p = f.properties ?? {};
          const g = f.geometry ?? {};
          return { id: p.id, name: p.name, region: p.region, country: p.country, centroid: g.coordinates ?? p.centroid ?? [0, 0] };
        });
        setWaterbodies(mapped);
        setStreams((streamData.data ?? []) as StreamSegment[]);
        setScorecard(scoreData as Scorecard);
        setFhirAvailable(true);
        return Promise.all(mapped.slice(0, 12).map(async (wb) => {
          try {
            const response = await fetch(`${API}/v1/forecast/${wb.id}`);
            if (!response.ok) return null;
            return [wb.id, await response.json()] as const;
          } catch {
            return null;
          }
        }))
          .then((items) => setForecasts(Object.fromEntries(items.filter(Boolean) as Array<[string, Forecast]>)));
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <SkeletonCard key={i} />)}</div>;
  }
  if (error && !waterbodies.length) return <ErrorState title="One Health summary is unavailable" message={error} onRetry={load} />;

  const forecastsFor = (id: string) => forecasts[id]?.horizons?.["5d"]?.p_bloom ?? forecasts[id]?.p_bloom ?? 0;
  const humanRiskDays = waterbodies.reduce((sum, wb) => sum + (forecastsFor(wb.id) >= 0.5 ? 5 : 0), 0);
  const ecologicalSeverity = streams.reduce((sum, stream) => sum + stream.risk_score, 0) / Math.max(1, streams.length);
  const systemTrust = scorecard ? scorecard.auc : 0;

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-deep/50 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-glow-cyan">One Health Impact Summary</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-wide">One signal, three consequences</h2>
          <p className="mt-1 text-sm text-fg-secondary">Live API signals, shown side by side for people, ecosystems, and systems.</p>
        </div>
        <a href="/fhir" className="rounded-lg border border-glow-cyan/30 bg-glow-cyan/10 px-3 py-2 text-xs text-glow-cyan hover:bg-glow-cyan/20">View FHIR sample</a>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-glow-cyan/20 bg-glow-cyan/5 p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Human</span>
            <span className="text-glow-cyan">Advisory</span>
          </div>
          <div className="mt-3 font-display text-3xl font-bold text-fg-primary">{waterbodies.length} <span className="text-sm font-mono font-normal text-fg-muted">pilot sites</span></div>
          <p className="mt-2 text-xs leading-relaxed text-fg-secondary">{humanRiskDays} sites currently cross the 50% five-day threshold. Use this as a check signal, not a closure order.</p>
        </div>
        <div className="rounded-xl border border-glow-orange/20 bg-glow-orange/5 p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Ecological</span>
            <span className="text-glow-orange">StreamFlush</span>
          </div>
          <div className="mt-3 font-display text-3xl font-bold text-fg-primary">{streams.length} <span className="text-sm font-mono font-normal text-fg-muted">segments</span></div>
          <p className="mt-2 text-xs leading-relaxed text-fg-secondary">Mean wash-off risk {Math.round(ecologicalSeverity * 100)}% across current urban stream segments. High scores trigger field checks.</p>
        </div>
        <div className="rounded-xl border border-glow-violet/20 bg-glow-violet/5 p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">System</span>
            <span className="text-glow-violet">Scorecard</span>
          </div>
          <div className="mt-3 font-display text-3xl font-bold text-fg-primary">{scorecard ? scorecard.auc.toFixed(3) : "—"}</div>
          <p className="mt-2 text-xs leading-relaxed text-fg-secondary">Current ROC-AUC from the integrity scorecard · {scorecard ? scorecard.sample_size : "—"} observations.</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead><tr className="text-left text-fg-muted"><th className="pb-3">Waterbody</th><th className="pb-3">5-day bloom risk</th><th className="pb-3">StreamFlush</th><th className="pb-3">FHIR readiness</th></tr></thead>
          <tbody>
            {waterbodies.map((wb) => {
              const forecast = forecasts[wb.id];
              const value = forecastsFor(wb.id);
              return (
                <tr key={wb.id} className="border-t border-border-faint">
                  <td className="py-3 pr-4 font-medium text-fg-primary">{wb.name}</td>
                  <td className="py-3 pr-4 font-mono tabular">{Math.round(value * 100)}% <span className="text-fg-muted">· {level(value)}</span></td>
                  <td className="py-3 pr-4 font-mono tabular">{streams.length ? `${Math.round(ecologicalSeverity * 100)}% mean` : "No segments"}</td>
                  <td className="py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${fhirAvailable ? "border-glow-green/40 text-glow-green" : "border-glow-red/40 text-glow-red"}`}>{fhirAvailable ? "sample available" : "sample unavailable"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Advisory />
    </section>
  );
}
