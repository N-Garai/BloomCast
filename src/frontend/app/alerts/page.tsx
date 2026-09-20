import { Metadata } from "next";
import { Navbar } from "@/components/brand/Navbar";
import { Footer } from "@/components/brand/Footer";
import { AlertsClient } from "@/components/alerts/AlertsClient";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

export const metadata: Metadata = { title: "BloomCast — Alerts" };

export default function AlertsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-28">
        <ScrollReveal>
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-glow-orange/10 border border-glow-orange/30 text-xs text-glow-orange mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-glow-orange animate-pulse" />
              Early warning
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Alert subscriptions</h1>
            <p className="mt-4 text-fg-secondary">
              Subscribe to a waterbody and threshold. When the forecast crosses it, you
              receive an alert with the SHAP rationale and an optional FHIR R4 bundle export.
            </p>
          </div>
        </ScrollReveal>
        <AlertsClient />
      </main>
      <Footer />
    </div>
  );
}
