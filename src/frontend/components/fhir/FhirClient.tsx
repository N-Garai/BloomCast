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
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [copied, setCopied] = useState(false);
  const [fhirBase, setFhirBase] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

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

  const loadCustom = () => {
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
      setError("Enter a valid latitude (-90…90) and longitude (-180…180) for the custom bundle.");
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/fhir/Communication/custom?lat=${la}&lon=${lo}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — no bundle could be built there right now.`);
        return r.json();
      })
      .then(d => { setBundle(d); setLoading(false); })
      .catch((e) => { setLoading(false); setError(String(e?.message ?? e)); });
  };

  const download = () => {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const loc = bundle?.entry?.find((e: any) => e.resource?.resourceType === "Location");
    a.href = url;
    a.download = `bloomcast-${loc?.resource?.id ?? "bundle"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  // Push the bundle to a FHIR server ("ingest" = their server stores it).
  // This posts from the visitor's browser straight to the base URL they
  // paste — BloomCast never sees their server or credentials. A public test
  // server (https://hapi.fhir.org/baseR4) accepts it; a hospital endpoint
  // may refuse cross-origin posts, and that refusal is shown, not hidden.
  const sendToServer = async () => {
    if (!bundle) return;
    const base = fhirBase.trim().replace(/\/+$/, "");
    if (!base) {
      setSendResult("Paste a FHIR server base URL first (e.g. https://hapi.fhir.org/baseR4).");
      return;
    }
    setSending(true);
    setSendResult(null);
    try {
      const { validation: _dropped, ...fhirOnly } = bundle;
      const r = await fetch(`${base}/Bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(fhirOnly),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`Server answered HTTP ${r.status}: ${text.slice(0, 160)}`);
      let createdId = "";
      try {
        const created = JSON.parse(text);
        createdId = created?.id ? `Stored as Bundle/${created.id}.` : "";
      } catch { /* non-JSON ok response */ }
      setSendResult(`Accepted (HTTP ${r.status}). ${createdId} Check the server's own records — BloomCast cannot confirm what a remote server does after accepting.`);
    } catch (e: any) {
      setSendResult(`Not delivered: ${String(e?.message ?? e)} — most often the server blocks cross-origin browser posts (CORS). The bundle below is still valid; deliver it from a backend or import the downloaded file instead.`);
    } finally {
      setSending(false);
    }
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
      <div className="rounded-xl border border-border-subtle bg-bg-deep/50 p-4 text-xs leading-relaxed text-fg-secondary">
        <span className="font-mono uppercase tracking-widest text-glow-magenta">What this page does</span>
        <p className="mt-2">
          Hospitals and health offices don&apos;t read dashboards — they ingest <span className="text-fg-primary">FHIR</span>, the
          international health-data standard. Each bundle below is one machine-readable alert with three parts:{" "}
          <span className="text-fg-primary">Communication</span> (who is warned, and the plain-language message),{" "}
          <span className="text-fg-primary">Observation</span> (the probability plus its confidence interval as numbers),{" "}
          <span className="text-fg-primary">Location</span> (which waterbody, with coordinates). The badge underneath proves
          the bundle conforms to our published profile — that proof is what makes a hospital server willing to accept it.
        </p>
      </div>
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
      <p className="-mt-3 text-xs text-fg-faint">
        Try <span className="font-mono">sample</span>, a pilot id like <span className="font-mono">CH-ZUR-01</span> for a
        live bundle — or build one for any coordinates below. Pilot bundles and custom points both work.
      </p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="w-36">
          <span className="text-xs font-mono uppercase tracking-widest text-fg-muted">Latitude</span>
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="47.38"
            inputMode="decimal"
            className="mt-1 w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary font-mono text-sm focus:border-glow-magenta outline-none"
          />
        </label>
        <label className="w-36">
          <span className="text-xs font-mono uppercase tracking-widest text-fg-muted">Longitude</span>
          <input
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            placeholder="8.54"
            inputMode="decimal"
            className="mt-1 w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary font-mono text-sm focus:border-glow-magenta outline-none"
          />
        </label>
        <button
          type="button"
          onClick={loadCustom}
          className="px-4 py-2.5 rounded-lg border border-glow-magenta/30 text-glow-magenta text-sm font-medium hover:bg-glow-magenta/10 transition-colors"
        >
          Build for custom location
        </button>
      </div>
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
      <div className="rounded-xl border border-border-subtle bg-bg-deep/50 p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Take this bundle somewhere</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={download}
            disabled={!bundle}
            className="px-4 py-2 rounded-lg border border-border-subtle text-xs text-fg-secondary hover:text-glow-cyan disabled:opacity-40"
          >
            Download JSON
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={!bundle || copied}
            className="px-4 py-2 rounded-lg border border-border-subtle text-xs text-fg-secondary hover:text-glow-cyan disabled:opacity-40"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-3 text-xs text-fg-faint">
          To ingest it into a FHIR server, paste the server&apos;s base URL and push — the bundle posts
          straight from your browser to their <span className="font-mono">/Bundle</span> endpoint.
          BloomCast never sees their server. A hospital endpoint may refuse browser posts; that refusal
          is shown below, and the downloaded file imports the same way.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <input
            value={fhirBase}
            onChange={(e) => setFhirBase(e.target.value)}
            placeholder="https://hapi.fhir.org/baseR4"
            autoComplete="off"
            className="flex-1 min-w-52 bg-bg-deep border border-border-subtle rounded-lg px-3 py-2 text-fg-primary font-mono text-xs focus:border-glow-magenta outline-none"
          />
          <button
            type="button"
            onClick={sendToServer}
            disabled={!bundle || sending}
            className="px-4 py-2 rounded-lg bg-glow-magenta/10 border border-glow-magenta/30 text-glow-magenta text-xs font-medium hover:bg-glow-magenta/20 transition-colors disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send to FHIR server"}
          </button>
        </div>
        {sendResult && <p className="mt-2 text-xs font-mono text-fg-secondary">{sendResult}</p>}
      </div>
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
