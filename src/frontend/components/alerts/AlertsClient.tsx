"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import { API } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

interface CheckedAlert {
  waterbody_id: string;
  threshold: number;
  horizon_days: number;
  current_probability: number;
  crossed: boolean;
}

function ThresholdStatus({ subscriberKey }: { subscriberKey: string }) {
  const [alerts, setAlerts] = useState<CheckedAlert[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/v1/alerts/check?subscriber_key=${encodeURIComponent(subscriberKey)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail ?? `HTTP ${r.status}`);
      setAlerts(d.alerts ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6 border border-border-subtle">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h3 className="font-display text-lg font-semibold tracking-wide">Your thresholds, right now</h3>
        <button
          onClick={check}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors disabled:opacity-50"
        >
          {loading ? "Checking…" : "Check now"}
        </button>
      </div>
      <p className="text-xs text-fg-muted mb-4">
        Evaluated live against current forecasts — no email service needed.
      </p>
      {loading && <Spinner label="Evaluating thresholds" />}
      {error && <p className="text-xs font-mono text-glow-red">{error}</p>}
      {alerts && alerts.length === 0 && (
        <p className="text-sm text-fg-muted">No subscriptions on this device yet.</p>
      )}
      {alerts && alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div
              key={`${a.waterbody_id}-${a.horizon_days}`}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                a.crossed ? "border-glow-red/50 bg-glow-red/5" : "border-border-faint"
              }`}
            >
              <div>
                <span className="font-mono text-fg-primary">{a.waterbody_id}</span>
                <span className="text-fg-muted"> · {a.horizon_days}d ≥ {Math.round(a.threshold * 100)}%</span>
              </div>
              <span
                className={`font-mono text-xs px-2.5 py-1 rounded-full border ${
                  a.crossed
                    ? "border-glow-red/50 text-glow-red animate-pulse"
                    : "border-glow-green/40 text-glow-green"
                }`}
              >
                {a.crossed ? `CROSSED · ${Math.round(a.current_probability * 100)}%` : `${Math.round(a.current_probability * 100)}% · quiet`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AlertsClient() {
  const [subscriberKey, setSubscriberKey] = useState("");
  const [form, setForm] = useState({
    waterbody_id: "CH-ZUR-01",
    threshold: 0.6,
    horizon_days: 5,
    fhir_export_consent: false,
  });
  const [status, setStatus] = useState<"idle" | "submitting" | "ok" | "error">("idle");
  const [token, setToken] = useState("");

  useEffect(() => {
    let key = "";
    try {
      key = localStorage.getItem("bc-subscriber") || "";
      if (!key) {
        key = (crypto.randomUUID ? crypto.randomUUID() : `sub-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        localStorage.setItem("bc-subscriber", key);
      }
    } catch {
      key = `sub-${Date.now()}`;
    }
    setSubscriberKey(key);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch(`${API}/v1/alerts/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, subscriber_key: subscriberKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "subscribe failed");
      setToken(data.unsubscribe_token);
      setStatus("ok");
    } catch (err: any) {
      setStatus("error");
    }
  }

  if (status === "ok") {
    return (
      <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass rounded-2xl p-10 border border-glow-green/40"
      >
        <div className="font-display text-3xl font-bold text-glow-green mb-3">Subscribed</div>
        <p className="text-fg-secondary mb-6">
          Tracking the {form.horizon_days}-day bloom probability for{" "}
          <span className="font-mono text-fg-primary">{form.waterbody_id}</span> against{" "}
          {Math.round(form.threshold * 100)}%. Check your thresholds below anytime.
        </p>
        <div className="rounded-lg bg-bg-deep/60 p-4 border border-border-faint text-xs text-fg-muted break-all">
          Unsubscribe token: <span className="font-mono text-fg-secondary">{token}</span>
        </div>
        <button
          onClick={() => setStatus("idle")}
          className="mt-6 px-5 py-2.5 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors"
        >
          Add another subscription
        </button>
      </motion.div>
      <ThresholdStatus subscriberKey={subscriberKey} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
    <form onSubmit={submit} className="glass rounded-2xl p-8 border border-border-subtle space-y-6">
      <p className="text-xs text-fg-faint -mb-2">Anonymous — subscriptions live on this device, no email needed.</p>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm text-fg-secondary mb-2" htmlFor="awb">Waterbody</label>
          <select
            id="awb"
            value={form.waterbody_id}
            onChange={(e) => setForm({ ...form, waterbody_id: e.target.value })}
            className="w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary focus:border-glow-cyan outline-none"
          >
            {["CH-ZUR-01", "CH-GVA-01", "IT-MAG-01", "DE-CON-01", "IT-GAR-01", "US-ERI-01", "IN-VEM-01"].map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-fg-secondary mb-2" htmlFor="ahor">Forecast horizon</label>
          <select
            id="ahor"
            value={form.horizon_days}
            onChange={(e) => setForm({ ...form, horizon_days: Number(e.target.value) })}
            className="w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary focus:border-glow-cyan outline-none"
          >
            {[3, 5, 7].map((d) => (
              <option key={d} value={d}>{d}-day</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-fg-secondary">Alert threshold</span>
          <span className="font-mono text-glow-orange">{Math.round(form.threshold * 100)}%</span>
        </div>
        <input
          type="range" min={0.3} max={0.95} step={0.05}
          value={form.threshold}
          onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
          className="w-full accent-glow-orange"
        />
      </div>
      <label className="flex items-center gap-2.5 text-sm text-fg-secondary cursor-pointer">
        <input
          type="checkbox" checked={form.fhir_export_consent}
          onChange={(e) => setForm({ ...form, fhir_export_consent: e.target.checked })}
          className="w-4 h-4 accent-glow-cyan"
        />
        Include FHIR R4 bundle export with triggered alerts (export consent)
      </label>
      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-glow-cyan to-glow-green text-bg-abyss font-semibold hover:shadow-glow-md transition-all disabled:opacity-50"
      >
        {status === "submitting" ? "Subscribing…" : "Subscribe to alerts"}
      </button>
    </form>
    {subscriberKey && <ThresholdStatus subscriberKey={subscriberKey} />}
    </div>
  );
}