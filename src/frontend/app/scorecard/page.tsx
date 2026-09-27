import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { ScorecardClient } from "@/components/scorecard/ScorecardClient";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { ImageBackdrop } from "@/components/brand/BackgroundMedia";

export const metadata: Metadata = { title: "BloomCast — Integrity Scorecard" };

export default function ScorecardPage() {
  return (
    <div className="min-h-screen flex flex-col relative">
      <ImageBackdrop src="/bg/bg-page-a.jpg" />
      <Navbar />
      <main className="relative flex-1 max-w-5xl mx-auto w-full px-6 py-28">
        <ScrollReveal>
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-glow-green/10 border border-glow-green/30 text-xs text-glow-green mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-glow-green animate-pulse" />
              Published transparency
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight">
              Forecast Integrity Scorecard
            </h1>
            <p className="mt-4 text-fg-secondary max-w-2xl">
              How do you know it works? Brier score, reliability, hit rate, and honest
              comparison against climatology, persistence, and weather-only baselines.
            </p>
          </div>
        </ScrollReveal>
        <ScorecardClient />
      </main>
      <Footer />
    </div>
  );
}
