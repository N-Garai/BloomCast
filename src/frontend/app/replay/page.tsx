import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { ReplayTheatre } from "@/components/replay/ReplayTheatre";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { ImageBackdrop } from "@/components/brand/BackgroundMedia";

export const metadata: Metadata = { title: "BloomCast — Replay Theatre" };

export default function ReplayPage() {
  return (
    <div className="min-h-screen flex flex-col relative">
      <ImageBackdrop src="/bg/bg-page-b.jpg" />
      <Navbar />
      <main className="relative flex-1 max-w-6xl mx-auto w-full px-6 py-28">
        <ScrollReveal>
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-glow-cyan/10 border border-glow-cyan/30 text-xs text-glow-cyan mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-glow-cyan animate-pulse" />
              Bloom Replay Theatre
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight">
              Watch the forecast beat the satellite.
            </h1>
            <p className="mt-4 text-fg-secondary max-w-2xl">
              Scrub through documented historical bloom events. The forecast probability
              climbs days before satellite confirmation — this is the lead time, made visible.
            </p>
          </div>
        </ScrollReveal>
        <ReplayTheatre />
      </main>
      <Footer />
    </div>
  );
}
