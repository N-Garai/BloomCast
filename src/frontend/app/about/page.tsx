import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";

export const metadata: Metadata = { title: "BloomCast — About & Model Card" };

const CARD = [
  ["Intended use", "Advisory support for environmental decision-makers monitoring cyanobacteria bloom risk in freshwater bodies."],
  ["Not intended for", "Toxin concentration measurement; swimming safety determination; regulatory compliance."],
  ["Training data", "Hybrid LightGBM + 1D-CNN trained on multi-source features (spectral indices, meteorological forcing, citizen observations)."],
  ["Evaluation", "Held-out test set of 5 EU lakes never seen during training; baselines: climatology, persistence, weather-only."],
  ["Architecture", "LightGBM (24 tabular features) + 1D-CNN (30×6 time series) + logistic meta-learner; isotonic calibration."],
  ["Calibration", "Isotonic regression on out-of-fold predictions, refit on full data."],
  ["Update cadence", "Nightly precompute on GitHub Actions; forecasts served statically."],
  ["License", "Code MIT; documentation CC-BY 4.0."],
];

const BIASES = [
  "Training labels are weighted toward well-monitored lakes; generalization to under-monitored regions carries residual bias.",
  "Citizen observation features skew toward tech-literate observers and are capped at ≤30% SHAP contribution per prediction.",
  "Model is trained primarily on summer bloom seasons; shoulder-season forecasts may be less reliable.",
  "StreamFlush Nowcast is a heuristic risk score, not a calibrated probability — it triggers citizen check-missions.",
];

const STACK = [
  ["Satellite imagery", "Copernicus Sentinel-2 L2A — free including commercial, attribution required"],
  ["Weather forecasts", "Open-Meteo — CC-BY 4.0, keyless"],
  ["Map tiles", "OpenFreeMap — free and open-source"],
  ["Backend", "FastAPI on Render free web service"],
  ["Frontend", "Next.js static export on Render free static site"],
  ["Scheduler", "GitHub Actions cron (free for public repos)"],
];

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-28">
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-glow-cyan/10 border border-glow-cyan/30 text-xs text-glow-cyan mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-glow-cyan animate-pulse" />
            Responsible AI
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight">About &amp; Model Card</h1>
          <p className="mt-4 text-fg-secondary max-w-2xl">
            BloomCast is a decision-support tool, not a regulatory instrument. This page
            documents what the model does, what it does not do, and where it can be wrong.
          </p>
        </div>

        <section className="mb-12">
          <h2 className="font-display text-2xl font-semibold mb-6">Model card</h2>
          <div className="glass rounded-2xl border border-border-subtle divide-y divide-border-faint">
            {CARD.map(([k, v]) => (
              <div key={k} className="grid md:grid-cols-3 gap-4 p-5">
                <div className="text-sm font-medium text-fg-primary">{k}</div>
                <div className="md:col-span-2 text-sm text-fg-secondary">{v}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="font-display text-2xl font-semibold mb-6 text-glow-yellow">Known biases &amp; limitations</h2>
          <ul className="space-y-3">
            {BIASES.map((b) => (
              <li key={b} className="flex gap-3 text-sm text-fg-secondary glass rounded-xl p-4 border border-glow-yellow/20">
                <span className="text-glow-yellow flex-shrink-0">⚠</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="font-display text-2xl font-semibold mb-6">Free-tier stack (card-free)</h2>
          <div className="glass rounded-2xl border border-border-subtle divide-y divide-border-faint">
            {STACK.map(([k, v]) => (
              <div key={k} className="grid md:grid-cols-3 gap-4 p-5">
                <div className="text-sm font-medium text-fg-primary">{k}</div>
                <div className="md:col-span-2 text-sm text-fg-secondary">{v}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold mb-6">Safety disclaimer</h2>
          <div className="glass rounded-2xl p-6 border border-glow-red/30">
            <p className="text-sm text-fg-secondary leading-relaxed">
              &ldquo;BloomCast outputs are advisory support for environmental decision-makers
              and do not constitute a safety determination. Always verify with in-situ toxin
              testing before issuing swimming, drinking, or recreation advisories.&rdquo;
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}