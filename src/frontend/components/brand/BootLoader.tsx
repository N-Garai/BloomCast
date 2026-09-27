"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

/**
 * Pre-hero boot loader — BloomCast-native motion design (no radar; that's
 * KiloNova's signature). A dot-matrix ripple blooms outward like a bloom
 * assembling on water: caustic color field, staggered blur-rise wordmark,
 * shimmer tagline, eased counter with pipeline phases. ~7.5 s total.
 */

const DURATION_MS = 7200;

const PHASES = [
  { until: 30, label: "READING SPECTRAL BASELINE" },
  { until: 58, label: "FUSING WEATHER ENSEMBLE" },
  { until: 84, label: "CALIBRATING PROBABILITY" },
  { until: 100, label: "LIVE OUTLOOK" },
];

const LETTERS = "BLOOMCAST".split("");

const GRID = 13;
const CENTER = (GRID - 1) / 2;

function RippleField() {
  const dots = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const dist = Math.hypot(row - CENTER, col - CENTER);
      const nearCenter = dist < 2.1;
      dots.push(
        <span
          key={`${row}-${col}`}
          className={`ripple-dot ${nearCenter ? "opacity-0" : ""} ${(row * GRID + col) % 6 === 0 ? "ripple-green" : ""}`}
          style={{ animationDelay: `${(dist * 0.16).toFixed(2)}s` }}
        />
      );
    }
  }
  return <div className="ripple-grid">{dots}</div>;
}

function LogoMark() {
  return (
    <svg width="104" height="104" viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id="boot-bloom" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#7dffd4" />
          <stop offset="45%" stopColor="#00f0d4" />
          <stop offset="100%" stopColor="#00a382" />
        </radialGradient>
      </defs>
      <motion.circle
        cx="32"
        cy="32"
        r="29"
        fill="#02060f"
        stroke="rgba(0,240,212,0.55)"
        strokeWidth="1.5"
        strokeDasharray="4 5"
        initial={{ rotate: -120, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 1.6, ease: "easeOut" }}
        style={{ transformOrigin: "32px 32px" }}
      />
      <motion.circle
        cx="32"
        cy="32"
        r="16"
        fill="url(#boot-bloom)"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.15, 1], opacity: 1 }}
        transition={{ delay: 0.4, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformOrigin: "32px 32px" }}
      />
      <motion.circle
        cx="27"
        cy="27"
        r="5"
        fill="#ffffff"
        opacity="0.35"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.85, duration: 0.6, ease: "easeOut" }}
        style={{ transformOrigin: "27px 27px" }}
      />
    </svg>
  );
}

export function BootLoader({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      const t = setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION_MS);
      setProgress(Math.round(100 * (1 - Math.pow(1 - t, 3))));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setTimeout(onDone, 350);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  const phase = PHASES.find((p) => progress < p.until)?.label ?? "ONLINE";

  return (
    <motion.div
      exit={{ opacity: 0, scale: 1.04, filter: "brightness(1.5)" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-bg-abyss"
      aria-label="Loading BloomCast"
    >
      <style>{`
        .ripple-grid {
          display: grid;
          grid-template-columns: repeat(${GRID}, 1fr);
          gap: 9px;
          width: 216px;
          height: 216px;
        }
        .ripple-dot {
          width: 5px;
          height: 5px;
          margin: auto;
          border-radius: 9999px;
          background: #00f0d4;
          animation: ripple-bloom 2.8s ease-in-out infinite;
        }
        .ripple-dot.ripple-green { background: #00ff88; }
        @keyframes ripple-bloom {
          0%, 100% { transform: scale(0.35); opacity: 0.22; }
          50% { transform: scale(1.15); opacity: 0.9; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ripple-dot { animation: none; opacity: 0.5; }
        }
      `}</style>

      {/* Caustic color field: two slow-drifting glows + vignette */}
      <div aria-hidden className="absolute inset-0">
        {!reduced && (
          <>
            <motion.div
              animate={{ x: [0, 60, -20, 0], y: [0, 30, -40, 0] }}
              transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -left-32 -top-32 h-[480px] w-[480px] rounded-full opacity-25 blur-[130px]"
              style={{ background: "radial-gradient(circle, #00f0d4 0%, transparent 70%)" }}
            />
            <motion.div
              animate={{ x: [0, -50, 30, 0], y: [0, -35, 45, 0] }}
              transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -bottom-40 -right-32 h-[520px] w-[520px] rounded-full opacity-20 blur-[140px]"
              style={{ background: "radial-gradient(circle, #00ff88 0%, transparent 70%)" }}
            />
          </>
        )}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse 75% 65% at 50% 45%, transparent 55%, rgba(2,6,15,0.85) 100%)" }}
        />
      </div>

      <div className="relative px-6 text-center">
        {/* Bloom instrument: ripple field with the mark blooming at center */}
        <div className="relative mx-auto mb-9 flex h-56 w-56 items-center justify-center">
          <div className="absolute inset-0 flex items-center justify-center">
            {!reduced ? <RippleField /> : null}
          </div>
          <motion.div
            className="relative z-10 rounded-full"
            animate={reduced ? {} : { scale: [1, 1.04, 1] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            style={{ filter: "drop-shadow(0 0 26px rgba(0,240,212,0.35))" }}
          >
            <LogoMark />
          </motion.div>
        </div>

        {/* Wordmark: blur-rise per letter */}
        <div className="mb-3 flex justify-center" aria-label="BloomCast">
          {LETTERS.map((letter, i) => (
            <motion.span
              key={i}
              initial={{ y: 30, opacity: 0, filter: "blur(14px)" }}
              animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
              transition={{ delay: 0.7 + i * 0.085, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="bg-gradient-to-b from-glow-cyan via-fg-primary to-glow-green bg-clip-text font-display text-4xl font-semibold tracking-[0.08em] text-transparent md:text-5xl"
            >
              {letter}
            </motion.span>
          ))}
        </div>

        {/* Tagline: shimmer sweep across serif italic */}
        <div className="overflow-hidden">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6, duration: 0.9 }}
            className="mx-auto max-w-md font-serif text-sm italic tracking-wide md:text-base"
          >
            <motion.span
              animate={{ backgroundPosition: ["0% 0%", "200% 0%"] }}
              transition={{ delay: 1.6, duration: 3.2, repeat: Infinity, ease: "linear" }}
              className="bg-gradient-to-r from-fg-muted via-white to-fg-muted bg-clip-text text-transparent"
              style={{ backgroundSize: "200% auto" }}
            >
              See the bloom before it surfaces.
            </motion.span>
          </motion.p>
        </div>

        {/* Counter + bar + phase */}
        <div className="mt-8 font-mono text-sm tabular text-glow-cyan">
          {String(progress).padStart(3, "0")}%
        </div>
        <div className="mx-auto mt-3 h-[3px] w-64 overflow-hidden rounded-full bg-bg-elevated md:w-80">
          <div
            className="h-full rounded-full bg-gradient-to-r from-glow-cyan via-glow-green to-glow-cyan shadow-glow-md transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-fg-faint">
          <span className="h-1 w-1 rounded-full bg-glow-green animate-pulse" />
          {phase}
        </div>
      </div>
    </motion.div>
  );
}
