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

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/fhir/Communication/sample`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} on /v1/fhir/Communication/sample`);
        return r.json();
      })
      .then(d => { setBundle(d); setLoading(false); })
      .catch((e) => { setLoading(false); setError(String(e?.message ?? e)); });
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !bundle) return <Spinner label="Loading FHIR bundle" />;
  if ((error && !bundle) || (!loading && !bundle)) {
    return <ErrorBanner message={error ?? "FHIR bundle unavailable."} onRetry={load} />;
  }
  if (!bundle) return null;

  return (
    <div className="space-y-6">
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
