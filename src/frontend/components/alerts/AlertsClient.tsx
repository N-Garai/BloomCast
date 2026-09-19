"use client";

import { useState } from "react";
import { motion } from "framer-motion";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export function AlertsClient() {
  const [form, setForm] = useState({
    email: "",
    waterbody_id: "CH-ZUR-01",
    threshold: 0.6,
    horizon_days: 5,
    fhir_export_consent: false,
  });
  const [status, setStatus] = useState<"idle" | "submitting" | "ok" | "error">("idle");
  const [token, setToken] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch(`${API}/v1/alerts/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass rounded-2xl p-10 border border-glow-green/40"
      >
        <div className="font-display text-3xl font-bold text-glow-green mb-3">Subscribed</div>
        <p className="text-fg-secondary mb-6">
          You will be alerted when the {form.horizon_days}-day bloom probability for{" "}
          <span className="font-mono text-fg-primary">{form.waterbody_id}</span> crosses{" "}
          {Math.round(form.threshold * 100)}%.
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
    );
  }

  return (
    <form onSubmit={submit} className="glass rounded-2xl p-8 border border-border-subtle space-y-6">
      <div>
        <label className="block text-sm text-fg-secondary mb-2" htmlFor="aemail">Email</label>
        <input
          id="aemail"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="you@example.org"
          className="w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary focus:border-glow-cyan outline-none"
        />
      </div>
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
        Include FHIR R4 bundle export in alert emails (GDPR consent)
      </label>
      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-glow-cyan to-glow-green text-bg-abyss font-semibold hover:shadow-glow-md transition-all disabled:opacity-50"
      >
        {status === "submitting" ? "Subscribing…" : "Subscribe to alerts"}
      </button>
    </form>
  );
}