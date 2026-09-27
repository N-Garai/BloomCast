"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { SplitHeadline } from "@/components/brand/SplitHeadline";
import { VideoBackdrop } from "@/components/brand/BackgroundMedia";
import { useGsapReveal } from "@/lib/useGsapReveal";

function CountUp({ to, duration = 1600 }: { to: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVal(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);

  return (
    <span ref={ref} className="tabular">
      {val.toLocaleString()}
    </span>
  );
}

const STATS = [
  { value: <CountUp to={2014} />, label: "Toledo 'do not drink' advisory", sub: "500,000 residents, 3 days" },
  { value: "$2–4B", label: "Global annual cost of blooms", sub: "treatment, recreation, fisheries" },
  { value: "3–7", label: "Day lead time", sub: "before bloom maturation" },
  { value: "Tier 2", label: "WHO hazard classification", sub: "recreational water quality" },
];

export function LandingStats() {
  const gridRef = useGsapReveal<HTMLDivElement>();

  return (
    <section className="section-fade relative overflow-hidden py-20 px-6">
      <VideoBackdrop
        src="/bg/bg-hero.mp4"
        brightness={1.05}
        overlay="linear-gradient(180deg, rgba(2,6,15,0.78) 0%, rgba(2,6,15,0.66) 50%, rgba(2,6,15,0.9) 100%)"
      />
      <div className="relative max-w-5xl mx-auto">
        <ScrollReveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-glow-orange text-center mb-4">
            Why it matters
          </p>
          <SplitHeadline
            text="The crisis is real. The lead time is the answer."
            className="font-display text-3xl md:text-4xl font-bold tracking-tight text-center"
          />
        </ScrollReveal>
        <div ref={gridRef} className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
          {STATS.map((s) => (
            <div
              key={s.label}
              data-reveal
              className="glass-card rounded-xl p-6 text-center hover:shadow-glow-md hover:border-glow-orange/40 transition-all duration-300"
            >
              <div className="font-display text-3xl font-bold text-glow-orange tabular">{s.value}</div>
              <div className="text-sm text-fg-primary mt-1">{s.label}</div>
              <div className="text-xs text-fg-muted mt-1">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
