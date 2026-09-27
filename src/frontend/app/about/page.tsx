import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/motion/ScrollReveal";
import { SplitHeadline } from "@/components/brand/SplitHeadline";
import { OneHealthSummary } from "@/components/onehealth/OneHealthSummary";
import { VideoBackdrop } from "@/components/brand/BackgroundMedia";

export const metadata: Metadata = { title: "BloomCast — About & Architecture" };

const PILLARS = [
  {
    title: "Forecast",
    body: "A hybrid model fuses seasonal spectral priors, live Open-Meteo weather, and a weather-only LightGBM variant into 3/5/7-day bloom outlooks with confidence intervals. Pilot waterbodies carry calibrated forecasts; arbitrary points get clearly labeled experimental estimates — never a number without its provenance.",
  },
  {
    title: "Rehearse",
    body: "Replay Theatre proves lead time on documented events. The Resilience Sandbox lets planners stress-test warming and nutrient cuts before committing capital.",
  },
  {
    title: "Interoperate",
    body: "StreamFlush covers narrow urban streams satellites cannot resolve. Alert bundles follow open health-data standards so utilities and public-health teams can act on them.",
  },
];

const ARCHITECTURE = [
  ["Ingestion", "Planetary Computer Sentinel-2 reads, Open-Meteo forecast ensembles, and steward-validated citizen observations — priors refreshed monthly, serving reads live."],
  ["Features", "Thirty-two tabular indicators per point: live weather block, seasonal spectral priors, static site data. Citizen features are schema-ready and unwired."],
  ["Model", "Gradient-boosted trees plus a temporal network combined by a meta-learner, then isotonic calibration for honest probabilities — plus a weather-only variant calibrated for anywhere on Earth."],
  ["Serving", "No cron in the request path: every assessment is computed live per request (15-minute cache), so numbers are fresh, not precomputed. Nightly jobs only refresh static seeds and the scorecard."],
  ["API", "One service exposes waterbodies, forecasts, live inference, replay events, sandbox scenarios, scorecard metrics, and alert bundles."],
  ["Frontend", "A static map-first interface with a 3D globe, keyless vector map, replay scrubber, sandbox sliders, and transparency scorecard."],
];

const STACK = [
  ["Satellite", "Copernicus Sentinel-2 optical imagery — free with attribution"],
  ["Weather", "Open-Meteo forecast API — keyless, CC-BY 4.0"],
  ["Maps", "Keyless vector world map (Natural Earth boundaries, committed) — zero tile servers"],
  ["Backend", "Python API service — realtime per-request inference, no serving cron"],
  ["Frontend", "Static map-first interface — globe, replay, sandbox, scorecard"],
  ["Scheduler", "No serving cron; nightly jobs only refresh static seeds and metrics"],
];

const WRITEUP = [
  {
    title: "The problem",
    body: "Cyanobacteria blooms can shut down drinking water and recreation with almost no warning. Existing public tools mostly describe blooms that already formed — after exposure has happened.",
  },
  {
    title: "The approach",
    body: "BloomCast predicts instead of describing. Satellite chlorophyll trends plus weather forcing give a 3–7 day head start; citizen observers fill the gaps satellites cannot see, and every forecast ships with its own accuracy receipt.",
  },
  {
    title: "The proof",
    body: "Replay Theatre scrubs through real historical events showing probability climbing before satellite confirmation. The Integrity Scorecard publishes Brier score, reliability, and baseline comparisons — including honest limitations.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <VideoBackdrop
        fixed
        src="/bg/bg-about.mp4"
        muted={false}
        brightness={1.02}
        overlay="linear-gradient(180deg, rgba(2,6,15,0.62) 0%, rgba(2,6,15,0.55) 50%, rgba(2,6,15,0.88) 100%)"
      />
      <Navbar />
      <main className="flex-1 relative">
        <div className="relative overflow-hidden">
          <div className="max-w-4xl mx-auto w-full px-6 pt-32 pb-16">
            <ScrollReveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-glow-cyan mb-4">
                About the project
              </p>
              <SplitHeadline
                text="From seeing blooms to seeing them coming."
                className="font-display text-4xl md:text-6xl font-bold tracking-tight"
              />
              <p className="mt-6 text-fg-secondary max-w-2xl text-lg leading-relaxed">
                BloomCast is an open-source early warning system for cyanobacteria blooms in
                urban freshwater. It combines satellite-informed priors, live weather, and
                a calibrated model core to give planners a 3–7 day head start before a bloom
                becomes visible — turning emergency closures into timely advisories.
              </p>
            </ScrollReveal>
          </div>
        </div>

        <div className="max-w-4xl mx-auto w-full px-6 py-16">
          <section className="mb-16">
            <ScrollReveal>
              <h2 className="font-display text-2xl font-semibold mb-6 tracking-wide">Project writeup</h2>
            </ScrollReveal>
            <StaggerContainer className="grid md:grid-cols-3 gap-6">
              {WRITEUP.map((p) => (
                <StaggerItem key={p.title}>
                  <div className="glass-card h-full rounded-2xl p-6 border border-border-subtle hover:border-glow-cyan/30 transition-colors">
                    <h3 className="font-display text-xl font-semibold text-glow-cyan mb-2">{p.title}</h3>
                    <p className="text-sm text-fg-secondary leading-relaxed">{p.body}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </section>

          <ScrollReveal className="mb-16">
            <div className="glass-card rounded-3xl p-8 md:p-12 border border-glow-cyan/30 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-glow-cyan/10 via-glow-violet/5 to-glow-magenta/10" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-glow-cyan/70 to-transparent" />
              <div className="relative">
                <h2 className="font-display text-3xl font-bold tracking-tight mb-4">
                  From data to decision.
                </h2>
                <p className="font-serif italic text-lg text-fg-secondary max-w-2xl">
                  A 3–7 day lead time turns beach closures after people get sick into
                  advisories before exposure. That is the public-health intervention.
                </p>
              </div>
            </div>
          </ScrollReveal>

          <section className="mb-16">
            <ScrollReveal>
              <h2 className="font-display text-2xl font-semibold mb-6 tracking-wide">How it works</h2>
            </ScrollReveal>
            <StaggerContainer className="grid md:grid-cols-3 gap-6">
              {PILLARS.map((p) => (
                <StaggerItem key={p.title}>
                  <div className="glass-card h-full rounded-2xl p-6 border border-border-subtle hover:border-glow-cyan/30 hover:shadow-glow-md transition-all">
                    <h3 className="font-display text-xl font-semibold text-glow-cyan mb-2">{p.title}</h3>
                    <p className="text-sm text-fg-secondary leading-relaxed">{p.body}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </section>

          <section className="mb-16">
            <ScrollReveal>
              <h2 className="font-display text-2xl font-semibold mb-6 tracking-wide">System architecture</h2>
            </ScrollReveal>
            <div className="glass-card rounded-2xl border border-border-subtle divide-y divide-border-faint overflow-hidden">
              {ARCHITECTURE.map(([layer, desc], i) => (
                <ScrollReveal key={layer} delay={Math.min(i * 0.05, 0.3)}>
                  <div className="grid md:grid-cols-[160px_1fr] gap-4 p-5 hover:bg-glow-cyan/[0.03] transition-colors">
                    <div className="text-sm font-medium text-glow-cyan font-mono">{layer}</div>
                    <div className="text-sm text-fg-secondary">{desc}</div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </section>

          <section className="mb-16">
            <ScrollReveal>
              <h2 className="font-display text-2xl font-semibold mb-6 tracking-wide">Open data stack</h2>
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
              <OneHealthSummary />
            </ScrollReveal>
          </section>

          <section className="mb-16">
            <ScrollReveal>
              <h2 className="font-display text-2xl font-semibold mb-6 text-glow-yellow">Known limitations</h2>
            </ScrollReveal>
            <ul className="space-y-3">
              {[
                "Training labels are weighted toward well-monitored lakes; under-monitored regions carry residual bias.",
                "Citizen observations skew toward connected users and are capped in model influence.",
                "The model is trained primarily on warm-season blooms; shoulder-season forecasts may be less reliable.",
                "StreamFlush is a heuristic risk score, not a calibrated probability — it triggers check-missions.",
              ].map((b) => (
                <li key={b} className="flex gap-3 text-sm text-fg-secondary glass-card rounded-xl p-4 border border-glow-yellow/20">
                  <span className="text-glow-yellow flex-shrink-0">◆</span>
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
        </div>
      </main>
      <Footer />
    </div>
  );
}
