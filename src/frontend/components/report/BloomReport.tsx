"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { API } from "@/lib/api";
import { Advisory } from "@/components/dashboard/Resilience";

export function BloomReport({ latitude, longitude, waterbodyName }: { latitude: number; longitude: number; waterbodyName?: string }) {
  const [report, setReport] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [degradeReason, setDegradeReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    setDegraded(false);
    setDegradeReason(null);
    try {
      const response = await fetch(`${API}/v1/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? data?.error ?? `Report service returned HTTP ${response.status}.`);
      setReport(data?.report ?? "The report service did not return a report.");
      setProvider(data?.provider ?? null);
      setDegraded(Boolean(data?.degraded?.degraded));
      // The backend always explains WHY it fell back (provider error text
      // or the failed validation step) — surface it so "template" is a
      // diagnosis, not a shrug.
      setDegradeReason(typeof data?.degraded?.reason === "string" ? data.degraded.reason : null);
    } catch (e) {
      setError("Assessment unavailable — the live result remains available below.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const print = () => {
    window.print();
  };

  return (
    <div className="mt-5 rounded-xl border border-glow-violet/30 bg-glow-violet/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-glow-violet">Grounded assessment</div>
          <h3 className="mt-1 font-display text-lg font-semibold text-fg-primary">{waterbodyName ? `Report for ${waterbodyName}` : "Live assessment report"}</h3>
        </div>
        <div className="flex gap-2">
          <button onClick={generate} disabled={loading} className="rounded-lg border border-glow-violet/40 bg-glow-violet/10 px-3 py-2 text-xs text-glow-violet hover:bg-glow-violet/20 disabled:opacity-50">
            {loading ? "Generating…" : "Generate report"}
          </button>
          <button onClick={copy} disabled={!report || copied} className="rounded-lg border border-border-subtle px-3 py-2 text-xs text-fg-secondary hover:text-glow-cyan disabled:opacity-40">
            {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={print} disabled={!report} className="rounded-lg border border-border-subtle px-3 py-2 text-xs text-fg-secondary hover:text-glow-cyan disabled:opacity-40">
            Print
          </button>
        </div>
      </div>
      {error && <p className="mt-3 rounded-lg border border-glow-red/30 bg-glow-red/5 px-3 py-2 text-xs text-glow-red">{error}</p>}
      {report && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-lg border border-border-subtle bg-bg-deep/50 p-4 text-xs leading-relaxed text-fg-secondary">
          <div className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">What / Why / Cause to effect / What to check next {provider && <span className="text-glow-violet">· {provider}</span>}{degraded && <span className="text-glow-yellow"> · template fallback</span>}</div>
          {degraded && degradeReason && <p className="mt-2 rounded-lg border border-glow-yellow/30 bg-glow-yellow/5 px-3 py-2 font-mono text-[11px] text-glow-yellow">Fallback reason: {degradeReason}</p>}
          <p className="mt-2 whitespace-pre-line">{report}</p>
          <p className="mt-2 text-fg-faint">Generated from the selected location&apos;s live weather, wash-off, model, and stream signals. Review with local guidance before acting.</p>
          <Advisory />
        </motion.div>
      )}
    </div>
  );
}
