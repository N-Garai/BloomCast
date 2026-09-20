"use client";

import { useEffect, useState, Suspense, lazy } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { ForecastCard } from "@/components/dashboard/ForecastCard";
import { RiskLegend } from "@/components/dashboard/RiskLegend";
import { StreamFlushOverlay } from "@/components/streamflush/StreamFlushOverlay";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

const Globe = lazy(() => import("@/components/three/Globe").then(m => ({ default: m.Globe })));

const API = process.env.NEXT_PUBLIC_API_BASE ?? "/v1";

interface Waterbody {
  id: string;
  name: string;
  region: string;
  country: string;
  centroid: [number, number];
  type: string;
}

export default function DashboardPage() {
  const [waterbodies, setWaterbodies] = useState<Waterbody[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showGlobe, setShowGlobe] = useState(true);

  useEffect(() => {
    fetch(`${API}/v1/waterbodies?limit=25`)
      .then(r => r.json())
      .then(d => {
        const features = (d.data ?? []).filter((f: any) => f?.type === "Feature");
        const mapped = features.map((f: any) => {
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
      })
      .catch(() => setWaterbodies([]));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <aside className="w-80 border-r border-border-subtle bg-bg-deep/60 backdrop-blur-xl flex flex-col">
          <div className="p-4 border-b border-border-subtle">
            <ScrollReveal>
              <h2 className="font-display text-lg font-semibold">Forecast Map</h2>
              <p className="text-xs text-fg-muted mt-1">25 pilot waterbodies · updated nightly</p>
            </ScrollReveal>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {waterbodies.map((wb, i) => (
              <ScrollReveal key={wb.id} delay={i * 0.03}>
                <motion.div
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
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

        <main className="flex-1 relative">
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
          <div className="absolute top-4 right-4 z-10">
            <button
              onClick={() => setShowGlobe(!showGlobe)}
              className="px-3 py-2 rounded-lg glass border border-border-subtle text-xs text-fg-secondary hover:text-fg-primary"
            >
              {showGlobe ? "Flat Map" : "3D Globe"}
            </button>
          </div>
          <StreamFlushOverlay />
        </main>
      </div>
      <Footer />
    </div>
  );
}
