import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { ReportForm } from "@/components/report/ReportForm";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

export const metadata: Metadata = { title: "BloomCast — Submit Observation" };

export default function ReportPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-28">
        <ScrollReveal>
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-glow-cyan/10 border border-glow-cyan/30 text-xs text-glow-cyan mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-glow-cyan animate-pulse" />
              Ground Truth Loop
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Submit an observation</h1>
            <p className="mt-4 text-fg-secondary">
              Your report enters a validation queue. A steward confirms it, and validated
              observations feed back as model features — the influence is shown on the waterbody page.
            </p>
          </div>
        </ScrollReveal>
        <ReportForm />
      </main>
      <Footer />
    </div>
  );
}
