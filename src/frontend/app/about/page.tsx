import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/motion/ScrollReveal";

export const metadata: Metadata = { title: "BloomCast — About & Architecture" };

const PILLARS = [
  {
    title: "Forecast",
    body: "Hybrid LightGBM + 1D-CNN fuses Sentinel-2 NDCI, 14-day Open-Meteo, and validated citizen observations into calibrated 3/5/7-day probabilities.",
  },
  {
    title: "Rehearse",
    body: "Replay Theatre proves lead time on real events. Resilience Sandbox lets planners stress-test warming and nutrient cuts.",
  },
  {
    title: "Interoperate",
    body: "StreamFlush covers urban streams satellites cannot resolve. FHIR R4 bundles speak digital-health standards for utilities and public health.",
  },
];

const STACK = [
  ["Satellite", "Copernicus Sentinel-2 L2A — free, attribution required"],
  ["Weather", "Open-Meteo — CC-BY 4.0, keyless"],
  ["Maps", "OpenFreeMap — free and open-source"],
  ["Backend", "FastAPI on Render web service"],
  ["Frontend", "Next.js static export served by FastAPI"],
  ["Scheduler", "GitHub Actions cron"],
];

const ARCHITECTURE = [
  ["Ingestion", "Sentinel-2 NDCI, Open-Meteo forecasts, citizen observations"],
  ["Features", "24 tabular features + 30×6 time series"],
  ["Model", "LightGBM + 1D-CNN + logistic meta-learner, isotonic calibration"],
  ["Precompute", "Nightly GitHub Actions generates static forecast JSON"],
  ["API", "FastAPI serves waterbodies, forecasts, replay, scorecard, FHIR"],
  ["Frontend", "Next.js static export, Tailwind, Framer Motion, Three.js"],
];

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-28">
        <ScrollReveal>
          <div className="mb-12">
            <h1 className="font-display text-4xl font-bold tracking-tight">
              About BloomCast
            </h1>
            <p className="mt-4 text-fg-secondary max-w-2xl">
              BloomCast is an open-source early warning system for cyanobacteria blooms.
              It combines satellite remote sensing, weather forecasts, and citizen science
              to give planners a 3–7 day head start before a bloom becomes visible.
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal className="mb-16">
          <div className="glass-card rounded-3xl p-8 md:p-12 border border-glow-cyan/30 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-glow-cyan/5 to-glow-magenta/5" />
            <div className="relative">
              <h2 className="font-display text-3xl font-bold tracking-tight mb-4">
                From data to decision.
              </h2>
              <p className="text-fg-secondary max-w-2xl">
                A 3–7 day lead time turns beach closures after people get sick into advisories
                before exposure. That is the One Health intervention.
              </p>
            </div>
          </div>
        </ScrollReveal>

        <section className="mb-16">
          <ScrollReveal>
            <h2 className="font-display text-2xl font-semibold mb-6">How it works</h2>
          </ScrollReveal>
          <StaggerContainer className="grid md:grid-cols-3 gap-6">
            {PILLARS.map((p) => (
              <StaggerItem key={p.title}>
                <div className="glass-card h-full rounded-2xl p-6 border border-border-subtle">
                  <h3 className="font-display text-xl font-semibold text-glow-cyan mb-2">{p.title}</h3>
                  <p className="text-sm text-fg-secondary leading-relaxed">{p.body}</p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </section>

        <section className="mb-16">
          <ScrollReveal>
            <h2 className="font-display text-2xl font-semibold mb-6">System architecture</h2>
          </ScrollReveal>
          <div className="glass-card rounded-2xl border border-border-subtle divide-y divide-border-faint">
            {ARCHITECTURE.map(([layer, desc]) => (
              <div key={layer} className="grid md:grid-cols-[160px_1fr] gap-4 p-5">
                <div className="text-sm font-medium text-glow-cyan">{layer}</div>
                <div className="text-sm text-fg-secondary">{desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-16">
          <ScrollReveal>
            <h2 className="font-display text-2xl font-semibold mb-6">Free-tier stack</h2>
          </ScrollReveal>
          <div className="glass-card rounded-2xl border border-border-subtle divide-y divide-border-faint">
            {STACK.map(([k, v]) => (
              <div key={k} className="grid md:grid-cols-[160px_1fr] gap-4 p-5">
                <div className="text-sm font-medium text-fg-primary">{k}</div>
                <div className="text-sm text-fg-secondary">{v}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-16">
          <ScrollReveal>
            <h2 className="font-display text-2xl font-semibold mb-6 text-glow-yellow">Known limitations</h2>
          </ScrollReveal>
          <ul className="space-y-3">
            {[
              "Training labels are weighted toward well-monitored lakes; under-monitored regions carry residual bias.",
              "Citizen observations skew toward tech-literate users and are capped at ≤30% SHAP contribution.",
              "Model is trained primarily on summer bloom seasons; shoulder-season forecasts may be less reliable.",
              "StreamFlush is a heuristic risk score, not a calibrated probability — it triggers citizen check-missions.",
            ].map((b) => (
              <li key={b} className="flex gap-3 text-sm text-fg-secondary glass-card rounded-xl p-4 border border-glow-yellow/20">
                <span className="text-glow-yellow flex-shrink-0">⚠</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <ScrollReveal>
            <div className="glass-card rounded-2xl p-6 border border-glow-red/30">
              <h2 className="font-display text-2xl font-semibold mb-3">Safety disclaimer</h2>
              <p className="text-sm text-fg-secondary leading-relaxed">
                BloomCast outputs are advisory support for environmental decision-makers
                and do not constitute a safety determination. Always verify with in-situ toxin
                testing before issuing swimming, drinking, or recreation advisories.
              </p>
            </div>
          </ScrollReveal>
        </section>
      </main>
      <Footer />
    </div>
  );
}
