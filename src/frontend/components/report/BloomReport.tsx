"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { API } from "@/lib/api";
import { Advisory } from "@/components/dashboard/Resilience";
import { downloadReportPdf, type ReportPdfInput } from "@/lib/reportPdf";

export function BloomReport({ latitude, longitude, waterbodyName, assessment }: {
  latitude: number;
  longitude: number;
  waterbodyName?: string;
  assessment?: any;
}) {
  const [report, setReport] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [degradeReason, setDegradeReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
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
    // A standalone PDF of just this report — never a screenshot of the page.
    if (!assessment) return;
    setPrinting(true);
    try {
      const w = assessment.wash_off ?? {};
      const week = assessment.week_ahead ?? {};
      const estimate = assessment.model_estimate ?? null;
      const input: ReportPdfInput = {
        latitude: assessment.latitude ?? latitude,
        longitude: assessment.longitude ?? longitude,
        placeName: waterbodyName ?? assessment.nearest_waterbody?.name ?? "Picked point",
        fetchedAt: assessment.fetched_at,
        provenance: assessment.provenance,
        headlineRiskPct: Math.round((w.risk_score ?? 0) * 100),
        headlineRiskLevel: w.risk_level ?? "low",
        rainfall48hMm: w.rainfall_48h_mm ?? "—",
        dryDays: w.dry_days_antecedent ?? "—",
        weekTempC: week.temp_mean_c ?? null,
        weekWindMs: week.wind_mean_ms ?? null,
        signals: Array.isArray(assessment.signals) ? assessment.signals : [],
        trajectory: Array.isArray(assessment.daily_outlook)
          ? assessment.daily_outlook.map((d: any) => ({ date: String(d.date ?? ""), risk: Number(d.risk_score ?? 0) }))
          : [],
        past30d: assessment.past_30d
          ? `Past 30 days here: ${assessment.past_30d.temp_mean_c ?? "—"}°C mean · ${assessment.past_30d.precip_sum_mm ?? "—"} mm rain — the baseline behind this outlook.`
          : null,
        methodLine: assessment.method ?? null,
        modelEstimate: estimate ? {
          pct: Math.round((estimate.p_bloom ?? 0) * 100),
          ciLo: Math.round((estimate.ci_lo ?? 0) * 100),
          ciHi: Math.round((estimate.ci_hi ?? 0) * 100),
          drivers: Array.isArray(estimate.drivers) ? estimate.drivers.slice(0, 5).map((d: any) => ({
            human: String(d.human ?? d.feature ?? ""),
            contribution: `${d.shap_value > 0 ? "+" : ""}${((d.shap_value ?? 0) * 100).toFixed(1)}%`,
          })) : [],
          trainingLine: estimate.training_source ? `${estimate.training_source}${estimate.model_version ? ` · ${estimate.model_version}` : ""}` : null,
          caveats: estimate.caveats ?? null,
        } : null,
        reportText: report ?? "(No AI report generated yet — press Generate report first.)",
        provider,
      };
      downloadReportPdf(input);
    } finally {
      setPrinting(false);
    }
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
          <button onClick={print} disabled={!assessment || printing} className="rounded-lg border border-border-subtle px-3 py-2 text-xs text-fg-secondary hover:text-glow-cyan disabled:opacity-40">
            {printing ? "Preparing…" : "PDF"}
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
