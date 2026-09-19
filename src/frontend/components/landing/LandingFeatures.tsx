"use client";

import { motion } from "framer-motion";

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
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="font-display text-4xl font-bold tracking-tight">
            Prediction. Proof. Planning.
          </h2>
          <p className="mt-4 text-fg-secondary max-w-2xl mx-auto">
            Three pillars that no competing free or paid tool delivers together.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="glass rounded-2xl p-6 border border-border-subtle hover:border-glow-cyan/40 hover:shadow-glow-sm transition-all duration-300"
            >
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="font-display text-xl font-semibold text-fg-primary mb-2">
                {f.title}
              </h3>
              <p className="text-sm text-fg-secondary leading-relaxed">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}