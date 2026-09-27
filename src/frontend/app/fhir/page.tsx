import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { FhirClient } from "@/components/fhir/FhirClient";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { ImageBackdrop } from "@/components/brand/BackgroundMedia";

export const metadata: Metadata = { title: "BloomCast — FHIR Bundle Viewer" };

export default function FhirPage() {
  return (
    <div className="min-h-screen flex flex-col relative">
      <ImageBackdrop src="/bg/bg-page-a.jpg" />
      <Navbar />
      <main className="relative flex-1 max-w-4xl mx-auto w-full px-6 py-28">
        <ScrollReveal>
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-glow-magenta/10 border border-glow-magenta/30 text-xs text-glow-magenta mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-glow-magenta animate-pulse" />
              HL7 FHIR R4 · digital health interoperability
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight">FHIR Bundle Viewer</h1>
            <p className="mt-4 text-fg-secondary max-w-2xl">
              Every BloomCast alert is exportable as a FHIR R4 bundle — Communication +
              Observation + Location, with model-version, lead-time, and confidence extensions.
            </p>
          </div>
        </ScrollReveal>
        <FhirClient />
      </main>
      <Footer />
    </div>
  );
}
