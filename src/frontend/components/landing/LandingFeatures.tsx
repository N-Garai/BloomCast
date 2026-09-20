"use client";

import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/motion/ScrollReveal";

const FEATURES = [
  {
    icon: "🔮",
    title: "Predict, don't describe",
    body: "Every existing bloom tool shows blooms that already formed. BloomCast fuses Sentinel-2 red-edge chlorophyll indices, 14-day Open-Meteo forecasts, and validated citizen observations into a calibrated 3–7 day forecast.",
  },
  {
    icon: "🎬",
    title: "Bloom Replay Theatre",
    body: "Scrub through documented historical bloom events and watch the forecast probability climb day-by-day before satellite confirmation. Proves the lead time is real.",
  },
  {
    icon: "🛡️",
    title: "Resilience Sandbox",
    body: "What-if climate and nutrient sliders produce per-waterbody projected annual high-risk days. Evidence for capital requests, stormwater planning, and policy decisions.",
  },
  {
    icon: "📊",
    title: "Forecast Integrity Scorecard",
    body: "Published Brier score, reliability diagram, hit/miss rates, and comparison vs. climatology and persistence baselines. Honest small-sample caveats included.",
  },
  {
    icon: "🌊",
    title: "StreamFlush Nowcast",
    body: "A second risk engine for narrow urban streams Sentinel-2 cannot resolve. Uses Open-Meteo only — rainfall × dry days × impervious surface → post-storm wash-off risk.",
  },
  {
    icon: "🩺",
    title: "FHIR R4 One Health Alerts",
    body: "Every alert exportable as a standards-compliant FHIR bundle. Speaks digital-health interoperability — for drinking water utilities, public health officers, and hospital networks.",
  },
];

export function LandingFeatures() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-16">
            <h2 className="font-display text-4xl font-bold tracking-tight">
              Prediction. Proof. Planning.
            </h2>
            <p className="mt-4 text-fg-secondary max-w-2xl mx-auto">
              Three pillars that no competing free or paid tool delivers together.
            </p>
          </div>
        </ScrollReveal>

        <StaggerContainer className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <StaggerItem key={f.title}>
              <div className="glass-card h-full rounded-2xl p-6 hover:shadow-glow-md transition-all duration-300">
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="font-display text-xl font-semibold text-fg-primary mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-fg-secondary leading-relaxed">{f.body}</p>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
