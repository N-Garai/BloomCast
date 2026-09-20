"use client";

import { motion } from "framer-motion";
import { Navbar } from "@/components/brand/Navbar";
import { SplitHeadline } from "@/components/brand/SplitHeadline";
import { DuplicatedLabelButton } from "@/components/brand/DuplicatedLabelButton";

export function LandingHero() {
  return (
    <section className="relative min-h-screen flex flex-col overflow-hidden">
      <Navbar />
      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 flex-1 flex flex-col justify-center pt-28 pb-20">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="mb-6 font-mono text-[11px] md:text-xs uppercase tracking-[0.4em] text-glow-cyan"
        >
          Sentinel-2 · Open-Meteo · Citizen Science
        </motion.p>

        <h1 className="font-display leading-[0.85] tracking-tight">
          <SplitHeadline
            text="SEE IT"
            as="span"
            className="block text-[22vw] md:text-[11rem] text-fg-primary"
          />
          <span className="block bg-gradient-to-r from-glow-cyan via-glow-green to-glow-cyan bg-clip-text text-transparent">
            <SplitHeadline text="COMING." as="span" className="block text-[22vw] md:text-[11rem]" />
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.8 }}
          className="mt-8 max-w-xl font-body text-lg text-fg-secondary leading-relaxed"
        >
          3–7 day cyanobacteria bloom forecasts —{" "}
          <span className="text-fg-primary">free, predictive, provably accurate.</span>
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4, duration: 0.8 }}
          className="mt-10 flex flex-col sm:flex-row gap-4"
        >
          <DuplicatedLabelButton href="/dashboard" label="View Forecast" />
          <DuplicatedLabelButton href="/about" label="Why BloomCast" variant="ghost" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.8, duration: 1 }}
          className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl"
        >
          {[
            { value: "3–7", label: "day lead time" },
            { value: "25", label: "pilot waterbodies" },
            { value: "$0", label: "monthly cost" },
            { value: "100%", label: "free & open" },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.8 + i * 0.1 }}
            >
              <div className="font-display text-3xl font-bold text-glow-cyan tabular">{s.value}</div>
              <div className="text-xs text-fg-muted mt-1">{s.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
          className="flex flex-col items-center gap-2 text-fg-muted"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Scroll</span>
          <svg width="16" height="26" viewBox="0 0 16 26" fill="none" aria-hidden>
            <rect x="0.5" y="0.5" width="15" height="25" rx="7.5" stroke="currentColor" />
            <motion.circle
              cx="8"
              cy="8"
              r="2"
              fill="#00f0d4"
              animate={{ cy: [8, 15, 8] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
            />
          </svg>
        </motion.div>
      </div>
    </section>
  );
}
