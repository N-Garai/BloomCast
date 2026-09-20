"use client";

import { useCallback, useEffect, useState, Suspense, lazy } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { ForecastCard } from "@/components/dashboard/ForecastCard";
import { ForecastPipeline } from "@/components/dashboard/ForecastPipeline";
import { RiskLegend } from "@/components/dashboard/RiskLegend";
import { StreamFlushOverlay } from "@/components/streamflush/StreamFlushOverlay";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { API } from "@/lib/api";

const Globe = lazy(() => import("@/components/three/Globe").then(m => ({ default: m.Globe })));

interface Waterbody {
  id: string;
  name: string;
  region: string;
  country: string;
  centroid: [number, number];
  type: string;
  _risk?: string;
}

function riskOf(p: number): string {
  if (p < 0.3) return "low";
  if (p < 0.5) return "moderate";
  if (p < 0.7) return "elevated";
  if (p < 0.85) return "high";
  return "critical";
}

export default function DashboardPage() {
  const [waterbodies, setWaterbodies] = useState<Waterbody[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showGlobe, setShowGlobe] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/waterbodies?limit=25`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} on /v1/waterbodies`);
        return r.json();
      })
      .then(d => {
        const features = (d.data ?? d.features ?? []).filter((f: any) => f?.type === "Feature");
        const mapped: Waterbody[] = features.map((f: any) => {
          const p = f.properties ?? {};
          const g = f.geometry ?? {};
          return {
            id: p.id,
            name: p.name,
            region: p.region,
            country: p.country,
            centroid: g.coordinates ?? p.centroid ?? [0, 0],
            type: p.type,
          };
        });
        setWaterbodies(mapped);
        setLoading(false);
        if (!mapped.length) setError("The service returned no waterbodies.");
        else setSelected((s) => s ?? mapped[0].id);
      })
      .catch((e) => {
        setLoading(false);
        setError(String(e?.message ?? e));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Enrich globe points with live risk (best-effort, never blocks the list).
  useEffect(() => {
    if (!waterbodies.length) return;
    let cancelled = false;
    const enrich = async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        waterbodies.slice(0, 25).map(async (wb) => {
          try {
            const r = await fetch(`${API}/v1/forecast/${wb.id}`);
            if (!r.ok) return;
            const d = await r.json();
            const p = d?.horizons?.["5d"]?.p_bloom ?? d?.p_bloom;
            if (typeof p === "number") updates[wb.id] = riskOf(p);
          } catch {
            /* keep default */
          }
        })
      );
      if (!cancelled && Object.keys(updates).length) {
        setWaterbodies((wbs) => wbs.map((w) => (updates[w.id] ? { ...w, _risk: updates[w.id] } : w)));
      }
    };
    enrich();
    return () => {
      cancelled = true;
    };
  }, [waterbodies.length]);

  const selectedWb = waterbodies.find((w) => w.id === selected) ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex flex-col lg:flex-row pt-16">
        <aside className="lg:w-[380px] w-full border-b lg:border-b-0 lg:border-r border-border-subtle bg-bg-deep/60 backdrop-blur-xl flex flex-col lg:max-h-[calc(100vh-4rem)] lg:sticky lg:top-16">
          <div className="p-4 border-b border-border-subtle">
            <ScrollReveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-glow-cyan">Live outlook</p>
              <h2 className="font-display text-2xl font-semibold mt-1">Forecast Map</h2>
              <p className="text-xs text-fg-muted mt-1">Pilot waterbodies · refreshed nightly</p>
            </ScrollReveal>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 lg:max-h-none max-h-[60vh]">
            {loading && <Spinner label="Loading waterbodies" />}
            {error && !loading && <ErrorBanner message={error} onRetry={load} />}
            {!loading && !error && waterbodies.map((wb, i) => (
              <ScrollReveal key={wb.id} delay={Math.min(i * 0.03, 0.3)}>
                <motion.div
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                >
                  <ForecastCard
                    waterbody={wb}
                    selected={selected === wb.id}
                    onClick={() => setSelected(wb.id)}
                  />
                </motion.div>
              </ScrollReveal>
            ))}
          </div>
          <div className="p-4 border-t border-border-subtle">
            <RiskLegend />
          </div>
        </aside>

        <main className="flex-1 relative min-h-[80vh]">
          <div className="absolute inset-0">
            {showGlobe ? (
              <Suspense fallback={<div className="w-full h-full bg-bg-abyss" />}>
                <Globe
                  waterbodies={waterbodies}
                  selected={selected}
                  onSelect={setSelected}
                />
              </Suspense>
            ) : (
              <div className="w-full h-full bg-bg-abyss flex items-center justify-center text-fg-muted">
                Map view (reduced motion fallback)
              </div>
            )}
          </div>
          <div className="absolute top-4 right-4 z-10 flex gap-2">
            <button
              onClick={() => setShowGlobe(!showGlobe)}
              className="px-3 py-2 rounded-lg glass border border-border-subtle text-xs text-fg-secondary hover:text-fg-primary"
            >
              {showGlobe ? "Flat Map" : "3D Globe"}
            </button>
          </div>
          {selectedWb && (
            <div className="absolute top-4 left-4 z-10 w-[320px] max-w-[calc(100%-2rem)] hidden md:block">
              <ForecastPipeline
                key={selectedWb.id}
                waterbodyId={selectedWb.id}
                waterbodyName={selectedWb.name}
              />
            </div>
          )}
          <StreamFlushOverlay />
        </main>
      </div>
      <Footer />
    </div>
  );
}
