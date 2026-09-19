"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Navbar } from "@/components/brand/Navbar";

const STATS = [
  { value: "3–7", label: "Day Lead Time", suffix: " days" },
  { value: "25", label: "Pilot Waterbodies", suffix: "" },
  { value: "$0", label: "Monthly Cost", suffix: "" },
  { value: "100%", label: "Free & Open", suffix: "" },
];

export function LandingHero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref });
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const y = useTransform(scrollYProgress, [0, 0.5], [0, 60]);

  return (
    <section ref={ref} className="relative min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 pt-24 pb-16">
        <motion.div style={{ opacity, y }} className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-glow-cyan/10 border border-glow-cyan/30 text-xs text-glow-cyan mb-6"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-glow-cyan animate-pulse" />
            Operational · v2 pipeline online
          </motion.div>

          <h1 className="font-display text-5xl md:text-7xl font-bold leading-tight tracking-tight">
            From seeing blooms{" "}
            <span className="text-gradient-to-r from-glow-cyan via-glow-green to-glow-cyan bg-clip-text">
              to seeing them coming.
            </span>
          </h1>

          <p className="mt-6 text-lg md:text-xl text-fg-secondary max-w-2xl mx-auto leading-relaxed">
            The first free, global system that predicts cyanobacteria blooms{" "}
            <span className="text-fg-primary font-medium">3–7 days ahead</span>,
            proves its own accuracy, and lets planners rehearse the future.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/dashboard"
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-glow-cyan to-glow-green text-bg-abyss font-semibold hover:shadow-glow-md transition-all"
            >
              View Live Forecast →
            </a>
            <a
              href="/replay"
              className="px-6 py-3 rounded-xl glass border border-border-subtle text-fg-primary font-medium hover:border-glow-cyan/50 transition-all"
            >
              Watch Replay Theatre
            </a>
          </div>

          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl mx-auto">
            {STATS.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 + i * 0.1 }}
                className="text-center"
              >
                <div className="font-display text-3xl font-bold text-glow-cyan">
                  {s.value}
                  <span className="text-lg text-fg-muted">{s.suffix}</span>
                </div>
                <div className="text-xs text-fg-muted mt-1">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      <div className="pb-8 text-center">
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-fg-faint text-sm"
        >
          ↓ Scroll to explore
        </motion.div>
      </div>
    </section>
  );
}