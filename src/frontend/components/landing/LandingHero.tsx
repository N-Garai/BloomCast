"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/brand/Navbar";
import { SplitHeadline } from "@/components/brand/SplitHeadline";
import { DuplicatedLabelButton } from "@/components/brand/DuplicatedLabelButton";
import { DotMatrixGlobe } from "@/components/three/DotMatrixGlobe";
import { VideoBackdrop } from "@/components/brand/BackgroundMedia";
import { API } from "@/lib/api";

const SAMPLE_WATERBODIES = [
  { id: "CH-ZUR-01", name: "Zurich", region: "Switzerland", country: "CH", centroid: [8.54, 47.38], _risk: "moderate" },
  { id: "US-ERI-01", name: "Lake Erie", region: "North America", country: "US", centroid: [-83.1, 41.9], _risk: "high" },
  { id: "IN-VEM-01", name: "Vembanad", region: "Kerala", country: "IN", centroid: [76.35, 9.6], _risk: "elevated" },
  { id: "DE-CON-01", name: "Lake Constance", region: "Germany", country: "DE", centroid: [9.3, 47.6], _risk: "low" },
  { id: "IT-GAR-01", name: "Lake Garda", region: "Italy", country: "IT", centroid: [10.7, 45.6], _risk: "low" },
  { id: "IT-COM-01", name: "Lake Como", region: "Italy", country: "IT", centroid: [9.27, 46.0], _risk: "low" },
];

export function LandingHero() {
  const [erieRisk, setErieRisk] = useState<{ level: string; pct: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${API}/v1/forecast/US-ERI-01`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const p = d?.horizons?.["5d"]?.p_bloom ?? d?.p_bloom;
        if (typeof p !== "number") return;
        const level = p < 0.3 ? "LOW" : p < 0.5 ? "MODERATE" : p < 0.7 ? "ELEVATED" : p < 0.85 ? "HIGH" : "CRITICAL";
        setErieRisk({ level, pct: Math.round(p * 100) });
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <section className="relative min-h-screen overflow-hidden bg-bg-abyss">
      <VideoBackdrop
        src="/bg/bg-hero.mp4"
        preload="auto"
        brightness={1.15}
        overlay="linear-gradient(180deg, rgba(2,6,15,0.5) 0%, rgba(2,6,15,0.62) 55%, rgba(2,6,15,0.94) 100%)"
      />
      <Navbar />
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl grid-cols-1 items-center gap-10 px-6 pb-16 pt-28 md:grid-cols-[1.05fr_0.95fr] md:gap-14">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }} className="max-w-2xl">
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.7 }} className="mb-5 font-mono text-[11px] uppercase tracking-[0.35em] text-glow-cyan">Sentinel-2 · Open-Meteo · Citizen Science</motion.p>
          <h1 className="font-display text-6xl font-semibold leading-[0.9] tracking-tight md:text-8xl">
            <span className="bg-gradient-to-r from-glow-cyan via-glow-green to-glow-cyan bg-clip-text text-transparent">BloomCast</span>
          </h1>
          <SplitHeadline text="See the bloom before it surfaces." className="mt-4 font-serif italic text-xl md:text-2xl text-fg-secondary max-w-xl leading-relaxed" />
          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.7 }} className="mt-5 max-w-xl font-body text-base leading-relaxed text-fg-muted">A 3–7 day cyanobacteria forecast for the waterbodies communities rely on. Free, predictive, and honest about what the model knows.</motion.p>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.7 }} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <DuplicatedLabelButton href="/dashboard" label="View Forecast" />
            <DuplicatedLabelButton href="/about" label="Why BloomCast" variant="ghost" />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7, duration: 0.7 }} className="mt-10 grid grid-cols-2 gap-5 max-w-xl border-t border-border-subtle pt-5">
            {[["3–7", "day lead time"], ["19", "pilot waterbodies"], ["$0", "monthly cost"], ["100%", "free & open"]].map(([value, label]) => <div key={label}><div className="font-display text-3xl font-bold text-glow-cyan tabular">{value}</div><div className="mt-1 text-xs text-fg-muted">{label}</div></div>)}
          </motion.div>
        </motion.div>
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.35, duration: 0.9 }} className="relative h-[420px] w-full overflow-hidden rounded-2xl border border-border-subtle bg-[#02060f] shadow-glow-md md:h-[520px]">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-bg-deep/80 via-bg-abyss to-bg-deep/80" />
          <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-between rounded-full border border-glow-cyan/20 bg-bg-abyss/75 px-3 py-1.5 backdrop-blur-xl"><span className="font-mono text-[10px] uppercase tracking-[0.25em] text-glow-cyan">Live outlook</span><span className="h-1.5 w-1.5 rounded-full bg-glow-green animate-pulse" /></div>
          <div className="absolute inset-0 p-3">
            <DotMatrixGlobe waterbodies={SAMPLE_WATERBODIES} selected="US-ERI-01" autoRotate />
          </div>
          <div className="absolute bottom-4 left-4 right-4 z-10 rounded-xl border border-border-subtle bg-bg-abyss/80 p-3 backdrop-blur-xl"><div className="flex items-center justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Selected pilot</div><div className="mt-0.5 text-sm font-medium text-fg-primary">Lake Erie · live 5-day</div></div><span className="text-xs font-mono text-glow-orange">{erieRisk ? `${erieRisk.level} · ${erieRisk.pct}%` : "loading…"}</span></div></div>
        </motion.div>
      </div>
      <div className="absolute bottom-7 left-1/2 z-10 -translate-x-1/2 text-fg-muted"><span className="font-mono text-[10px] uppercase tracking-[0.3em]">Scroll</span><div className="mx-auto mt-2 h-7 w-px bg-gradient-to-b from-glow-cyan to-transparent" /></div>
    </section>
  );
}
