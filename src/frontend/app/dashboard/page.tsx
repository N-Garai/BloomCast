"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { ForecastCard } from "@/components/dashboard/ForecastCard";
import { ForecastPipeline } from "@/components/dashboard/ForecastPipeline";
import { LocationExplorer } from "@/components/dashboard/LocationExplorer";
import { NdciExplainer } from "@/components/dashboard/NdciExplainer";
import { RiskLegend } from "@/components/dashboard/RiskLegend";
import { DotMatrixGlobe } from "@/components/three/DotMatrixGlobe";
import { VectorMap } from "@/components/maps/VectorMap";
import { StreamFlushOverlay } from "@/components/streamflush/StreamFlushOverlay";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { ErrorState, friendlyError } from "@/components/dashboard/Resilience";
import { API } from "@/lib/api";

interface Waterbody {
  id: string;
  name: string;
  region: string;
  country: string;
  centroid: [number, number];
  type: string;
  _risk?: string;
}

interface Forecast {
  horizons?: Record<string, { p_bloom: number; ci_lo: number; ci_hi: number }>;
  p_bloom?: number;
}

interface ExploreResult {
  latitude: number;
  longitude: number;
  wash_off: { risk_score: number; risk_level: string };
  model_estimate?: { p_bloom: number; ci_lo: number; ci_hi: number } | null;
  signals?: string[];
  nearest_waterbody?: { id: string; name: string; distance_km: number } | null;
}

function riskOf(value: number) {
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

export default function DashboardPage() {
  const [waterbodies, setWaterbodies] = useState<Waterbody[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showGlobe, setShowGlobe] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedForecast, setSelectedForecast] = useState<Forecast | null>(null);
  const [dropResult, setDropResult] = useState<ExploreResult | null>(null);
  const [dropLoading, setDropLoading] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/waterbodies?limit=25`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const features = (data.data ?? data.features ?? []).filter((feature: any) => feature?.type === "Feature");
        const mapped = features.map((feature: any) => {
          const properties = feature.properties ?? {};
          const geometry = feature.geometry ?? {};
          return { id: properties.id, name: properties.name, region: properties.region, country: properties.country, centroid: geometry.coordinates ?? properties.centroid ?? [0, 0], type: properties.type };
        });
        setWaterbodies(mapped);
        setLoading(false);
        if (!mapped.length) setError("The service returned no waterbodies.");
        else setSelected((current) => current ?? mapped[0].id);
      })
      .catch((e) => { setLoading(false); setError(friendlyError(e)); });
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!waterbodies.length) return;
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const keyOf = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const coordsOf = (waterbody: Waterbody) => ({ lat: waterbody.centroid[1], lon: waterbody.centroid[0] });

    const applyBatchResults = (results: any[]) => {
      const updates: Record<string, string> = {};
      for (const result of results) {
        // Match by rounded coordinates, not by position: the batch response
        // omits failed locations, so indices shift. model_estimate carries
        // the live bloom probability; wash_off is a different scale and is
        // never substituted for it.
        const key = keyOf(Number(result?.latitude), Number(result?.longitude));
        const match = waterbodies.find((waterbody) => {
          const coords = coordsOf(waterbody);
          return keyOf(coords.lat, coords.lon) === key;
        });
        const pBloom = result?.model_estimate?.p_bloom;
        if (match && typeof pBloom === "number") updates[match.id] = riskOf(pBloom);
      }
      if (!cancelled && Object.keys(updates).length) setWaterbodies((current) => current.map((waterbody) => updates[waterbody.id] ? { ...waterbody, _risk: updates[waterbody.id] } : waterbody));
      return updates;
    };

    // Legacy per-item path: only a fallback when the batch endpoint itself
    // is unreachable — never a retry amplifier (one batch 429 must not
    // become 25 individual requests).
    const legacyEnrich = async (list: Waterbody[]) => {
      const updates: Record<string, string> = {};
      await Promise.all(list.map(async (waterbody) => {
        try {
          const response = await fetch(`${API}/v1/forecast/${waterbody.id}`);
          if (!response.ok) return;
          const data = await response.json();
          const value = data?.horizons?.["5d"]?.p_bloom ?? data?.p_bloom;
          if (typeof value === "number") updates[waterbody.id] = riskOf(value);
        } catch {
          // Keep the default risk marker when enrichment fails.
        }
      }));
      if (!cancelled && Object.keys(updates).length) setWaterbodies((current) => current.map((waterbody) => updates[waterbody.id] ? { ...waterbody, _risk: updates[waterbody.id] } : waterbody));
    };

    const runBatch = async (list: Waterbody[]): Promise<boolean> => {
      const response = await fetch(`${API}/v1/infer/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations: list.map(coordsOf) }),
      });
      if (response.status === 429) {
        // One delayed retry, then stop: hammering a throttled upstream is
        // what got the deployment throttled in the first place.
        const retryAfter = Number(response.headers.get("Retry-After")) || 5;
        await sleep(Math.min(Math.max(retryAfter, 1), 30) * 1000);
        if (cancelled) return true;
        const retry = await fetch(`${API}/v1/infer/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locations: list.map(coordsOf) }),
        });
        if (!retry.ok) return false;
        const data = await retry.json();
        applyBatchResults(data?.results ?? []);
        return true;
      }
      if (!response.ok) return false;
      const data = await response.json();
      const applied = applyBatchResults(data?.results ?? []);
      // Per-item fallback only for the locations the batch itself failed.
      const failed = new Set((data?.errors ?? []).map((entry: any) => Number(entry?.index)));
      const missing = list.filter((waterbody, index) => failed.has(index) && !applied[waterbody.id]);
      if (missing.length) await legacyEnrich(missing);
      return true;
    };

    const enrich = async () => {
      // M4: the whole pilot list resolves in ONE round trip. The server
      // fans out behind a 4-wide semaphore, so upstream never sees a burst.
      const list = waterbodies.slice(0, 25);
      try {
        const ok = await runBatch(list);
        if (!ok && !cancelled) await legacyEnrich(list);
      } catch {
        if (!cancelled) await legacyEnrich(list);
      }
    };
    enrich();
    return () => { cancelled = true; };
  }, [waterbodies.length]);

  const selectedWb = waterbodies.find((waterbody) => waterbody.id === selected) ?? null;

  const loadSelectedForecast = useCallback(async (id: string) => {
    setSelectedForecast(null);
    try {
      const response = await fetch(`${API}/v1/forecast/${id}`);
      if (!response.ok) return;
      setSelectedForecast(await response.json() as Forecast);
    } catch {
      setSelectedForecast(null);
    }
  }, []);

  useEffect(() => { if (selectedWb) loadSelectedForecast(selectedWb.id); }, [selectedWb, loadSelectedForecast]);

  const runExplore = async (latitude: number, longitude: number) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    // The picked pin moves immediately and the previous result stays on
    // screen while the new assessment loads — the working trace is never
    // blanked by an in-flight request.
    setPicked({ lat: latitude, lon: longitude });
    setDropLoading(true);
    setDropError(null);
    try {
      const response = await fetch(`${API}/v1/explore?lat=${latitude}&lon=${longitude}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail ?? `HTTP ${response.status}`);
      setDropResult(data as ExploreResult);
    } catch (e) {
      setDropError(friendlyError(e, "weather"));
    } finally {
      setDropLoading(false);
    }
  };

  // Only waterbodies with real coordinates reach the map and globe — a
  // missing centroid must never become a (0, 0) Null Island marker.
  const mappable = useMemo(() => waterbodies.filter((waterbody) =>
    Array.isArray(waterbody.centroid) && Number.isFinite(waterbody.centroid[0]) && Number.isFinite(waterbody.centroid[1])), [waterbodies]);
  const riskNumber = (level?: string) => level === "low" ? 0.1 : level === "moderate" ? 0.4 : level === "elevated" ? 0.6 : level === "high" ? 0.8 : 0.95;
  const mapPoints = useMemo(() => {
    const list: Array<{ id: string; name: string; lat: number; lon: number; risk?: number; selected: boolean }> =
      mappable.map((waterbody) => ({ id: waterbody.id, name: waterbody.name, lat: waterbody.centroid[1], lon: waterbody.centroid[0], risk: riskNumber(waterbody._risk), selected: !picked && selected === waterbody.id }));
    if (picked) list.push({ id: "__picked__", name: "Picked point", lat: picked.lat, lon: picked.lon, risk: undefined, selected: true });
    return list;
  }, [mappable, picked, selected]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex flex-col lg:flex-row pt-16">
        <aside className="w-full border-b border-border-subtle bg-bg-deep/60 backdrop-blur-xl lg:w-[300px] lg:flex-1 lg:max-h-[calc(100vh-4rem)] lg:sticky lg:top-16 lg:border-b-0 lg:border-r lg:flex lg:flex-col">
          <div className="shrink-0 border-b border-border-subtle p-4">
            <ScrollReveal><p className="font-mono text-[11px] uppercase tracking-[0.3em] text-glow-cyan">Live outlook</p><h2 className="font-display text-2xl font-semibold mt-1">Forecast Map</h2><p className="text-xs text-fg-muted mt-1">Pilot waterbodies · markers live, outlook nightly</p></ScrollReveal>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3 lg:max-h-none" aria-live="polite">
            {loading && <div className="space-y-3">{[0, 1, 2, 3].map((item) => <div key={item} className="rounded-xl border border-border-subtle bg-bg-deep/40 p-4"><div className="h-3 w-24 rounded bg-bg-elevated mb-3" /><div className="h-8 w-20 rounded bg-bg-elevated" /><div className="mt-3 h-2 w-full rounded bg-bg-elevated/70" /><div className="mt-2 h-2 w-2/3 rounded bg-bg-elevated/70" /></div>)}</div>}
            {error && !loading && <ErrorState title="Forecast map unavailable" message={error} onRetry={load} />}
            {!loading && !error && waterbodies.length === 0 && <ErrorState title="No waterbodies here yet" message="The service has no pilot sites for this deployment. Try again after the next refresh." onRetry={load} />}
            {!loading && !error && waterbodies.map((waterbody, index) => <motion.div key={waterbody.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.03, 0.3) }}><ForecastCard waterbody={waterbody} selected={selected === waterbody.id} onClick={() => setSelected(waterbody.id)} /></motion.div>)}
          </div>
          <div className="shrink-0 border-t border-border-subtle p-4 space-y-4 max-h-[32vh] overflow-y-auto">
            <RiskLegend />
            <NdciExplainer waterbodyId={selected} waterbodyName={selectedWb?.name} />
          </div>
        </aside>

        <main className="relative min-h-[70vh] flex-1 overflow-hidden">
          <div className="absolute inset-0">
            {showGlobe ? <DotMatrixGlobe waterbodies={mappable} selected={selected ?? undefined} onSelect={setSelected} onPick={runExplore} picked={picked} /> : <div className="h-full w-full bg-bg-abyss"><VectorMap fill points={mapPoints} selectedId={picked ? "__picked__" : (selected ?? undefined)} onPick={(latitude, longitude) => runExplore(latitude, longitude)} /></div>}
          </div>
          <div className="absolute top-4 right-4 z-10 flex gap-2"><button onClick={() => setShowGlobe((current) => !current)} className="px-3 py-2 rounded-lg glass border border-border-subtle text-xs text-fg-secondary hover:text-fg-primary">{' '}{showGlobe ? "Flat Map" : "3D Globe"}</button></div>
          <div className="absolute left-4 top-4 bottom-4 z-10 w-[330px] max-w-[calc(100%-2rem)] flex flex-col gap-3 overflow-y-auto pr-1">
            {selectedWb && <div className="shrink-0"><ForecastPipeline key={selectedWb.id} waterbodyId={selectedWb.id} waterbodyName={selectedWb.name} onDone={(forecast) => setSelectedForecast(forecast as Forecast)} /><div className="mt-3 rounded-xl border border-border-subtle bg-bg-deep/80 p-4 backdrop-blur-xl"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-mono text-fg-muted">{selectedWb.name}</div><div className="mt-1 font-display text-xl font-semibold text-fg-primary">{selectedForecast ? `${Math.round((selectedForecast.horizons?.["5d"]?.p_bloom ?? selectedForecast.p_bloom ?? 0) * 100)}%` : "Loading outlook"}</div></div>{selectedForecast && <span className={`text-xs font-mono px-2 py-1 rounded-full border border-current ${riskColor(riskOf(selectedForecast.horizons?.["5d"]?.p_bloom ?? selectedForecast.p_bloom ?? 0))}`}>{riskOf(selectedForecast.horizons?.["5d"]?.p_bloom ?? selectedForecast.p_bloom ?? 0).toUpperCase()}</span>}</div><p className="mt-2 text-xs text-fg-muted">Model-backed pilot forecast · confidence interval and drivers are available in the sidebar card.</p><a href="/report" className="mt-3 inline-flex items-center gap-2 text-xs text-glow-cyan">Open full report →</a></div></div>}
            {dropLoading && !dropResult && <div className="shrink-0 rounded-xl border border-border-subtle bg-bg-deep/90 p-4 text-xs text-fg-secondary">Fetching live assessment…</div>}
            {dropResult && <div className="shrink-0 rounded-xl border border-glow-cyan/30 bg-bg-deep/90 p-4 backdrop-blur-xl"><div className="flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-widest text-glow-cyan">Open-water assessment</div><div className="mt-0.5 font-mono text-[11px] text-fg-muted">{dropResult.latitude.toFixed(2)}°, {dropResult.longitude.toFixed(2)}°{dropLoading ? ' · updating…' : ''}</div><div className="mt-1 font-display text-xl font-semibold text-fg-primary">{Math.round(dropResult.wash_off.risk_score * 100)}% wash-off risk</div></div><span className={`text-xs font-mono px-2 py-1 rounded-full border border-current ${riskColor(dropResult.wash_off.risk_level)}`}>{dropResult.wash_off.risk_level.toUpperCase()}</span></div><div className="mt-3 text-xs text-fg-secondary">{dropResult.signals?.slice(0, 3).map((signal) => `${signal} · `).join("") || "Live weather and wash-off signals loaded."}</div>{dropResult.model_estimate && <div className="mt-3 rounded-lg border border-glow-violet/30 bg-glow-violet/5 p-3 text-xs text-fg-secondary">Model estimate: <span className="font-mono text-glow-violet">{Math.round(dropResult.model_estimate.p_bloom * 100)}%</span> · CI {Math.round(dropResult.model_estimate.ci_lo * 100)}–{Math.round(dropResult.model_estimate.ci_hi * 100)}%</div>}</div>}
            {dropError && <div className="shrink-0 rounded-xl border border-glow-red/30 bg-glow-red/5 p-4 text-xs text-glow-red">{dropError}</div>}
            <div className="shrink-0"><StreamFlushOverlay /></div>
          </div>
        </main>
      </div>
      <div className="border-t border-border-subtle bg-bg-abyss"><div className="max-w-6xl mx-auto w-full px-4 md:px-6 py-8"><ScrollReveal><LocationExplorer onSelectWaterbody={setSelected} /></ScrollReveal></div></div>
      <Footer />
    </div>
  );
}
