import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { StreamFlushClient } from "@/components/streamflush/StreamFlushClient";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

export const metadata: Metadata = { title: "BloomCast — StreamFlush Nowcast" };

export default function StreamFlushPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-28">
        <ScrollReveal>
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-glow-magenta/10 border border-glow-magenta/30 text-xs text-glow-magenta mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-glow-magenta animate-pulse" />
              Urban streams — below the satellite pixel
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight">StreamFlush Nowcast</h1>
            <p className="mt-4 text-fg-secondary max-w-2xl">
              Sentinel-2&rsquo;s 10–20 m pixels cannot resolve narrow urban streams.
              StreamFlush uses Open-Meteo only — rainfall × dry days × impervious surface —
              to estimate post-storm wash-off risk and trigger citizen check-missions.
            </p>
          </div>
        </ScrollReveal>
        <StreamFlushClient />
      </main>
      <Footer />
    </div>
  );
}
