"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { API } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export function FhirClient() {
  const [bundle, setBundle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [bundleId, setBundleId] = useState("sample");

  const load = (id: string = bundleId) => {
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/fhir/Communication/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — no bundle with that id on this deployment.`);
        return r.json();
      })
      .then(d => { setBundle(d); setLoading(false); })
      .catch((e) => { setLoading(false); setError(String(e?.message ?? e)); });
  };

  useEffect(() => {
    load("sample");
  }, []);

  if (loading && !bundle) return <Spinner label="Loading FHIR bundle" />;
  if ((error && !bundle) || (!loading && !bundle)) {
    return <ErrorBanner message={error ?? "FHIR bundle unavailable."} onRetry={load} />;
  }
  if (!bundle) return null;

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => { e.preventDefault(); load(bundleId.trim() || "sample"); }}
        className="flex flex-wrap gap-3 items-end"
      >
        <label className="flex-1 min-w-52">
          <span className="text-xs font-mono uppercase tracking-widest text-fg-muted">Bundle id</span>
          <input
            value={bundleId}
            onChange={(e) => setBundleId(e.target.value)}
            placeholder="sample"
            className="mt-1 w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary font-mono text-sm focus:border-glow-magenta outline-none"
          />
        </label>
        <button
          type="submit"
          className="px-4 py-2.5 rounded-lg bg-glow-magenta/10 border border-glow-magenta/30 text-glow-magenta text-sm font-medium hover:bg-glow-magenta/20 transition-colors"
        >
          Load bundle
        </button>
      </form>
      {/* Conformance badge (v3 M-V5). The bundle self-reports its validation
          result; this renders it verbatim rather than inventing a green tick,
          and lists the named issues when the report is not clean. */}
      {bundle.validation && (
        <div className={`rounded-xl border p-4 text-xs ${
          bundle.validation.ok
            ? "border-glow-green/30 bg-glow-green/5"
            : "border-glow-red/40 bg-glow-red/5"
        }`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-mono uppercase tracking-widest ${
              bundle.validation.ok ? "text-glow-green" : "text-glow-red"
            }`}>
              {bundle.validation.ok ? "Profile validation: pass" : "Profile validation: fail"}
            </span>
            <span className="text-fg-muted">
              {bundle.validation.ok
                ? "— conforms to fhir/StructureDefinition-bloomcast-alert.json"
                : `— ${bundle.validation.issues.length} issue(s)`}
            </span>
          </div>
          {bundle.validation.issues?.length > 0 && (
            <ul className="mt-3 space-y-1 font-mono text-[11px] text-fg-secondary">
              {bundle.validation.issues.map((issue: any, i: number) => (
                <li key={i}>
                  <span className="text-glow-red">{issue.path}</span> — {issue.message}
                </li>
              ))}
            </ul>
          )}
          {bundle.validation.checked?.length > 0 && (
            <details className="mt-3 text-fg-muted">
              <summary className="cursor-pointer hover:text-fg-secondary">
                What was checked ({bundle.validation.checked.length} checks)
              </summary>
              <ul className="mt-2 space-y-1">
                {bundle.validation.checked.map((c: string, i: number) => (
                  <li key={i}>· {c}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <div className="grid md:grid-cols-3 gap-4">
        {(bundle.entry ?? []).map((e: any, i: number) => {
          const r = e.resource;
          const id = r.id;
          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: Math.min(i * 0.08, 0.4) }}
              className="glass rounded-2xl p-5 border border-border-subtle hover:border-glow-magenta/30 transition-colors"
            >
              <div className="text-xs font-mono text-glow-magenta">{r.resourceType}</div>
              <div className="font-display text-lg font-semibold text-fg-primary mt-1">{id}</div>
              <div className="text-xs text-fg-muted mt-1">status: {r.status}</div>
              <button
                onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
                className="mt-3 text-xs text-glow-cyan hover:underline"
              >
                {open[id] ? "Hide JSON" : "View JSON"}
              </button>
              {open[id] && (
                <pre className="mt-3 text-[10px] font-mono text-fg-secondary bg-bg-abyss rounded-lg p-3 overflow-x-auto max-h-48 border border-border-faint">
                  {JSON.stringify(r, null, 2)}
                </pre>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="glass rounded-2xl p-6 border border-border-subtle">
        <h3 className="font-display text-lg font-semibold mb-3">Full bundle</h3>
        <pre className="text-[10px] font-mono text-fg-secondary bg-bg-abyss rounded-lg p-4 overflow-x-auto max-h-80 border border-border-faint">
          {JSON.stringify(bundle, null, 2)}
        </pre>
      </div>
    </div>
  );
}
