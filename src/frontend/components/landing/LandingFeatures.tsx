"use client";

import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/motion/ScrollReveal";
import { SplitHeadline } from "@/components/brand/SplitHeadline";
import { FeatureFlipCard } from "@/components/landing/FeatureFlipCard";

const FEATURES = [
  {
    icon: "◉",
    title: "Predict, don't describe",
    body: "Fuses Sentinel-2 red-edge chlorophyll, 14-day weather forecasts, and validated citizen observations into a calibrated 3–7 day forecast.",
  },
  {
    icon: "▶",
    title: "Bloom Replay Theatre",
    body: "Scrub through documented bloom events and watch forecast probability climb days before satellite confirmation.",
  },
  {
    icon: "◈",
    title: "Resilience Sandbox",
    body: "What-if climate and nutrient sliders project annual high-risk days — evidence for planning and policy.",
  },
  {
    icon: "✓",
    title: "Integrity Scorecard",
    body: "Published Brier score, reliability diagram, and hit/miss rates against climatology and persistence baselines.",
  },
  {
    icon: "≈",
    title: "StreamFlush Nowcast",
    body: "A second risk engine for narrow urban streams satellites cannot resolve — rainfall × dry days × impervious surface.",
  },
  {
    icon: "+",
    title: "FHIR Alerts",
    body: "Every alert exportable as a standards-compliant FHIR bundle for utilities and public-health teams.",
  },
];

export function LandingFeatures() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-16">
            <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-glow-cyan mb-4">
              Prediction · Proof · Planning
            </p>
            <SplitHeadline
              text="Prediction. Proof. Planning."
              className="font-display text-4xl md:text-5xl font-bold tracking-tight"
            />
            <p className="mt-4 text-fg-secondary max-w-2xl mx-auto">
              Three pillars that no competing free or paid tool delivers together.
            </p>
          </div>
        </ScrollReveal>

        <StaggerContainer className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <StaggerItem key={f.title}>
              <FeatureFlipCard icon={f.icon} title={f.title} body={f.body} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
