"use client";

import { useEffect, useState } from "react";

const LINES = [
  "aligning orbital sensors",
  "reading red-edge chlorophyll",
  "fusing weather ensembles",
  "calibrating bloom probability",
];

export function Loader({ onDone }: { onDone: () => void }) {
  const [pct, setPct] = useState(0);
  const [exit, setExit] = useState(false);
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    const orig = link?.href;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const cx = c.getContext("2d");
    let fav = 0;
    const paint = () => {
      if (!cx || !link) return;
      const t = fav / 12;
      cx.clearRect(0, 0, 64, 64);
      cx.fillStyle = "#071014";
      cx.beginPath();
      cx.roundRect(0, 0, 64, 64, 16);
      cx.fill();
      cx.strokeStyle = `rgba(125,255,212,${0.25 + Math.sin(t) * 0.25})`;
      cx.lineWidth = 2;
      cx.beginPath();
      cx.arc(32, 32, 22 + Math.sin(t) * 2, 0, Math.PI * 2);
      cx.stroke();
      const g = cx.createRadialGradient(28, 24, 4, 32, 32, 18);
      g.addColorStop(0, "#7dffd4");
      g.addColorStop(1, "#06343a");
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(32, 32, 16, 0, Math.PI * 2);
      cx.fill();
      link.href = c.toDataURL("image/png");
      fav += 1;
    };
    const favTimer = window.setInterval(paint, 80);

    if (reduce) {
      onDone();
      return () => {
        window.clearInterval(favTimer);
        if (link && orig) link.href = orig;
      };
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(100, ((t - start) / 2400) * 100);
      setPct(p);
      if (p >= 100) {
        setExit(true);
        window.setTimeout(onDone, 720);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(favTimer);
      if (link && orig) link.href = orig;
    };
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
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <div className="loader-mark">
          <div className="h-28 w-28 md:h-36 md:w-36 rounded-full bg-gradient-to-br from-glow-cyan to-glow-green opacity-80 animate-pulse" />
        </div>
        <p className="loader-kicker mt-8 font-mono text-[11px] uppercase tracking-[0.42em] text-glow-cyan">
          BloomCast
        </p>
        <h1 className="loader-title mt-3 font-display text-5xl font-extrabold uppercase leading-[0.86] tracking-tight text-[#f6f3ea] md:text-8xl">
          See it
          <span className="block text-glow-cyan">coming.</span>
        </h1>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.22em] text-fg-muted">{line}</p>
        <div className="mt-8 h-[2px] w-[min(420px,70vw)] overflow-hidden bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-glow-cyan via-[#e8ff9a] to-glow-orange"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-3 font-mono text-sm tabular text-fg-secondary">{String(Math.round(pct)).padStart(3, "0")}</p>
      </div>
    </div>
  );
}
