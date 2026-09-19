"use client";

import { motion } from "framer-motion";

const STATS = [
  { value: "2014", label: "Toledo 'do not drink' advisory", sub: "500,000 residents, 3 days" },
  { value: "$2–4B", label: "Global annual cost of blooms", sub: "across treatment, recreation, fisheries" },
  { value: "3–7", label: "Day lead time", sub: "before bloom maturation" },
  { value: "Tier 2", label: "WHO hazard classification", sub: "for recreational water quality" },
];

export function LandingStats() {
  return (
    <section className="py-20 px-6 bg-bg-deep/50">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="font-display text-3xl font-bold tracking-tight">
            The crisis is real. The lead time is the answer.
          </h2>
        </motion.div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="glass rounded-xl p-6 text-center border border-border-subtle"
            >
              <div className="font-display text-3xl font-bold text-glow-orange">{s.value}</div>
              <div className="text-sm text-fg-primary mt-1">{s.label}</div>
              <div className="text-xs text-fg-muted mt-1">{s.sub}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}