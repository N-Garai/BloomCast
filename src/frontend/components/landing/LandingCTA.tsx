"use client";

import Link from "next/link";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

export function LandingCTA() {
  return (
    <section className="py-24 px-6">
      <ScrollReveal>
        <div className="max-w-3xl mx-auto glass-card rounded-3xl p-10 md:p-16 border border-glow-cyan/30 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-glow-cyan/5 to-glow-magenta/5" />
          <div className="relative">
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Ready when the bloom is.
            </h2>
            <p className="text-fg-secondary mb-8 max-w-xl mx-auto">
              Open source. Free tier. Zero credit cards. Clone, register four free
              accounts, and have a working global bloom-forecasting service running.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/dashboard"
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-glow-cyan to-glow-green text-abyss font-semibold hover:shadow-glow-lg transition-all"
              >
                Launch Dashboard
              </Link>
              <Link
                href="/report"
                className="px-6 py-3 rounded-xl glass border border-border-subtle text-fg-primary font-medium hover:border-glow-green/50 transition-all"
              >
                Submit an Observation
              </Link>
            </div>
            <p className="mt-6 text-xs text-fg-faint">
              &ldquo;BloomCast outputs are advisory support for environmental
              decision-makers and do not constitute a safety determination.&rdquo;
            </p>
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}
