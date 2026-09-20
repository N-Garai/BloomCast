"use client";

import { useEffect, useState } from "react";

const LINES = [
  "aligning orbital sensors",
  "reading red-edge chlorophyll",
  "fusing weather ensembles",
  "calibrating bloom probability",
];

function useAnimatedFavicon(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) return;
    const orig = link.href;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const cx = c.getContext("2d");
    if (!cx) return;

    let frame = 0;
    const total = 24;
    const paint = () => {
      cx.clearRect(0, 0, 64, 64);
      cx.fillStyle = "#02060f";
      cx.beginPath();
      if (typeof cx.roundRect === "function") cx.roundRect(0, 0, 64, 64, 14);
      else cx.rect(0, 0, 64, 64);
      cx.fill();

      // Sweep arc
      cx.strokeStyle = "rgba(0,240,212,0.6)";
      cx.lineWidth = 3;
      cx.beginPath();
      cx.arc(32, 32, 26, -Math.PI / 2, -Math.PI / 2 + (frame / total) * Math.PI * 2);
      cx.stroke();

      // Bloom core grows with progress
      const radius = 6 + (frame / total) * 12;
      const g = cx.createRadialGradient(32, 32, 0, 32, 32, radius);
      g.addColorStop(0, "#7dffd4");
      g.addColorStop(0.55, "#00f0d4");
      g.addColorStop(1, "rgba(0,240,212,0)");
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(32, 32, radius, 0, Math.PI * 2);
      cx.fill();

      try {
        link.href = c.toDataURL("image/png");
      } catch {}
      frame = (frame + 1) % (total + 6);
    };
    paint();
    const timer = window.setInterval(paint, 120);
    return () => {
      window.clearInterval(timer);
      link.href = orig;
    };
  }, [active]);
}

export function Loader({ onDone }: { onDone: () => void }) {
  const [pct, setPct] = useState(0);
  const [exit, setExit] = useState(false);
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useAnimatedFavicon(!reduce && !exit);

  useEffect(() => {
    if (reduce) {
      onDone();
      return;
    }
    const start = performance.now();
    const DURATION = 2400;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(100, ((t - start) / DURATION) * 100);
      setPct(p);
      if (p >= 100) {
        setExit(true);
        window.setTimeout(onDone, 720);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone, reduce]);

  const line = LINES[Math.min(LINES.length - 1, Math.floor((pct / 100) * LINES.length))];

  return (
    <div
      className={`loader-screen ${exit ? "is-exit" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="BloomCast is loading"
    >
      <div className="loader-grain" />
      <div className="loader-vignette" />
      {/* Ambient bloom glows */}
      <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,240,212,0.14),transparent_65%)] blur-2xl animate-pulse" />
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        {/* Radar-sweep mark */}
        <div className="relative h-32 w-32 md:h-40 md:w-40">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute inset-0 rounded-full border border-glow-cyan/30"
              style={{ animation: `loaderPulse 2.2s ease-in-out ${i * 0.35}s infinite` }}
            />
          ))}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(0,240,212,0.75), rgba(0,255,136,0.25) 25%, transparent 32%, transparent 100%)",
              animation: "spin 1.6s linear infinite",
              maskImage: "radial-gradient(circle, transparent 32%, black 33%)",
              WebkitMaskImage: "radial-gradient(circle, transparent 32%, black 33%)",
            }}
          />
          {/* Orbiting satellite dot */}
          <div className="absolute inset-0" style={{ animation: "spin 3.2s linear infinite" }}>
            <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-glow-green shadow-glow-md" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <svg width="44" height="44" viewBox="0 0 64 64" className="mx-auto loader-mark" aria-hidden>
                <circle cx="32" cy="32" r="15" fill="#00f0d4" opacity="0.9" />
                <circle cx="32" cy="32" r="21" fill="none" stroke="rgba(0,240,212,0.5)" strokeWidth="1.5" strokeDasharray="4 5" />
              </svg>
              <div className="mt-1 font-mono text-xl text-glow-cyan tabular">
                {String(Math.round(pct)).padStart(3, "0")}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.42em] text-glow-cyan">
          BloomCast
        </p>
        <h1 className="loader-title mt-3 font-display text-5xl font-extrabold uppercase leading-[0.86] tracking-tight md:text-8xl">
          See it
          <span className="block">coming.</span>
        </h1>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.22em] text-fg-muted">{line}</p>
        <div className="mt-8 h-[2px] w-[min(420px,70vw)] overflow-hidden rounded bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-glow-cyan via-[#e8ff9a] to-glow-orange transition-[width]"
            style={{ width: `${pct}%`, boxShadow: "0 0 12px rgba(0,240,212,0.8)" }}
          />
        </div>
      </div>
    </div>
  );
}
