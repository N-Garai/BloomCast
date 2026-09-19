import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { SandboxClient } from "@/components/sandbox/SandboxClient";

export const metadata: Metadata = { title: "BloomCast — Resilience Sandbox" };

export default function SandboxPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-28">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-glow-orange/10 border border-glow-orange/30 text-xs text-glow-orange mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-glow-orange animate-pulse" />
            Planning scenarios, not predictions
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            Resilience Sandbox
          </h1>
          <p className="mt-4 text-fg-secondary max-w-2xl">
            What if it were warmer? What if nutrient load dropped? Precomputed
            counterfactual sweeps show projected annual high-risk days per waterbody.
          </p>
        </div>
        <SandboxClient />
      </main>
      <Footer />
    </div>
  );
}