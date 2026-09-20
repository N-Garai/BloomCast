"use client";

import { ScrollReveal } from "@/components/motion/ScrollReveal";

export function LandingStats() {
  return (
    <section className="py-20 px-6 bg-bg-deep/50">
      <div className="max-w-5xl mx-auto">
        <ScrollReveal>
          <h2 className="font-display text-3xl font-bold tracking-tight text-center">
            The crisis is real. The lead time is the answer.
          </h2>
        </ScrollReveal>
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { value: "2014", label: "Toledo 'do not drink' advisory", sub: "500,000 residents, 3 days" },
            { value: "$2–4B", label: "Global annual cost of blooms", sub: "across treatment, recreation, fisheries" },
            { value: "3–7", label: "Day lead time", sub: "before bloom maturation" },
            { value: "Tier 2", label: "WHO hazard classification", sub: "for recreational water quality" },
          ].map((s, i) => (
            <ScrollReveal key={s.label} delay={i * 0.1}>
              <div className="glass-card rounded-xl p-6 text-center">
                <div className="font-display text-3xl font-bold text-glow-orange">{s.value}</div>
                <div className="text-sm text-fg-primary mt-1">{s.label}</div>
                <div className="text-xs text-fg-muted mt-1">{s.sub}</div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
