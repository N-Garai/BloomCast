"use client";

import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { SplitHeadline } from "@/components/brand/SplitHeadline";
import { DuplicatedLabelButton } from "@/components/brand/DuplicatedLabelButton";

export function LandingCTA() {
  return (
    <section className="py-24 px-6">
      <ScrollReveal direction="scale">
        <div className="max-w-3xl mx-auto glass-card rounded-3xl p-10 md:p-16 border border-glow-cyan/30 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-glow-cyan/10 via-glow-violet/5 to-glow-magenta/10 animate-caustic" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-glow-cyan/70 to-transparent" />
          <div className="relative">
            <SplitHeadline
              text="Ready when the bloom is."
              className="font-display text-3xl md:text-5xl font-bold tracking-tight mb-4"
            />
            <p className="font-serif italic text-lg text-fg-secondary mb-8 max-w-xl mx-auto">
              Open source. Free tier. No credit cards — a working bloom-forecasting service in an afternoon.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <DuplicatedLabelButton href="/dashboard" label="Launch Dashboard" />
              <DuplicatedLabelButton href="/report" label="Submit an Observation" variant="ghost" />
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
