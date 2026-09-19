"use client";

import { useState } from "react";
import { motion } from "framer-motion";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const COLORS = ["clear", "green", "brown", "blue-green", "red", "other"];
const ODORS = ["none", "earthy", "musty", "rotten-egg", "other"];

export function ReportForm() {
  const [form, setForm] = useState({
    waterbody_id: "CH-ZUR-01",
    observer_id: "",
    water_color: "green",
    scum_visible: false,
    odor: "none",
    wildlife_dead: false,
    notes: "",
    latitude: "",
    longitude: "",
  });
  const [status, setStatus] = useState<"idle" | "submitting" | "ok" | "error">("idle");
  const [error, setError] = useState("");

  function setLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) }));
      },
      () => setError("Geolocation unavailable — enter coordinates manually"),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    const observation_id = `obs-${Date.now()}`;
    const lat = parseFloat(form.latitude) || 0;
    const lon = parseFloat(form.longitude) || 0;
    try {
      const res = await fetch(`${API}/v1/citizen/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation_id,
          waterbody_id: form.waterbody_id,
          observer_id: form.observer_id || undefined,
          observed_at: new Date().toISOString(),
          latitude: lat,
          longitude: lon,
          water_color: form.water_color,
          scum_visible: form.scum_visible,
          odor: form.odor,
          wildlife_dead: form.wildlife_dead,
          notes: form.notes || undefined,
          source: "bloomcast-form",
        }),
      });
      if (!res.ok) throw new Error("submit failed");
      setStatus("ok");
    } catch (err: any) {
      setStatus("error");
      setError(err.message);
    }
  }

  if (status === "ok") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass rounded-2xl p-10 border border-glow-green/40 text-center"
      >
        <div className="font-display text-3xl font-bold text-glow-green mb-3">Observation accepted</div>
        <p className="text-fg-secondary max-w-md mx-auto">
          Your report entered the Ground Truth Loop validation queue. A community steward
          will review it — validated observations feed back into the forecast, and the
          influence is displayed on the waterbody page.
        </p>
        <button
          onClick={() => setStatus("idle")}
          className="mt-6 px-5 py-2.5 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors"
        >
          Submit another
        </button>
      </motion.div>
    );
  }

  return (
    <form onSubmit={submit} className="glass rounded-2xl p-8 border border-border-subtle space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm text-fg-secondary mb-2" htmlFor="wb">Waterbody</label>
          <select
            id="wb"
            value={form.waterbody_id}
            onChange={(e) => setForm({ ...form, waterbody_id: e.target.value })}
            className="w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary focus:border-glow-cyan outline-none"
          >
            {["CH-ZUR-01", "CH-GVA-01", "IT-MAG-01", "DE-CON-01", "IT-GAR-01", "IT-COM-01", "US-ERI-01", "IN-VEM-01"].map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-fg-secondary mb-2" htmlFor="email">Observer email (optional)</label>
          <input
            id="email"
            type="email"
            value={form.observer_id}
            onChange={(e) => setForm({ ...form, observer_id: e.target.value })}
            placeholder="you@example.org"
            className="w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary focus:border-glow-cyan outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm text-fg-secondary mb-2">Location</label>
        <div className="flex gap-3">
          <input
            type="number" step="any" placeholder="Latitude"
            value={form.latitude}
            onChange={(e) => setForm({ ...form, latitude: e.target.value })}
            className="flex-1 bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary focus:border-glow-cyan outline-none font-mono"
          />
          <input
            type="number" step="any" placeholder="Longitude"
            value={form.longitude}
            onChange={(e) => setForm({ ...form, longitude: e.target.value })}
            className="flex-1 bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary focus:border-glow-cyan outline-none font-mono"
          />
          <button
            type="button"
            onClick={setLocation}
            className="px-4 py-2.5 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm whitespace-nowrap hover:bg-glow-cyan/20 transition-colors"
          >
            Use GPS
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm text-fg-secondary mb-2">Water color</label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm({ ...form, water_color: c })}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                  form.water_color === c
                    ? "bg-glow-cyan/15 border-glow-cyan/50 text-glow-cyan"
                    : "border-border-subtle text-fg-muted hover:text-fg-primary"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm text-fg-secondary mb-2">Odor</label>
          <div className="flex flex-wrap gap-2">
            {ODORS.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setForm({ ...form, odor: o })}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                  form.odor === o
                    ? "bg-glow-cyan/15 border-glow-cyan/50 text-glow-cyan"
                    : "border-border-subtle text-fg-muted hover:text-fg-primary"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2.5 text-sm text-fg-secondary cursor-pointer">
          <input
            type="checkbox" checked={form.scum_visible}
            onChange={(e) => setForm({ ...form, scum_visible: e.target.checked })}
            className="w-4 h-4 accent-glow-cyan"
          />
          Surface scum visible
        </label>
        <label className="flex items-center gap-2.5 text-sm text-fg-secondary cursor-pointer">
          <input
            type="checkbox" checked={form.wildlife_dead}
            onChange={(e) => setForm({ ...form, wildlife_dead: e.target.checked })}
            className="w-4 h-4 accent-glow-red"
          />
          Dead wildlife observed
        </label>
      </div>

      <div>
        <label className="block text-sm text-fg-secondary mb-2" htmlFor="notes">Notes (optional)</label>
        <textarea
          id="notes"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Anything else the steward should know…"
          className="w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary focus:border-glow-cyan outline-none resize-none"
        />
      </div>

      {error && <div className="text-sm text-glow-red">{error}</div>}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-glow-cyan to-glow-green text-bg-abyss font-semibold hover:shadow-glow-md transition-all disabled:opacity-50"
      >
        {status === "submitting" ? "Submitting…" : "Submit observation"}
      </button>
      <p className="text-xs text-fg-faint">
        Reports enter a steward validation queue before influencing any forecast.
        BloomCast outputs are advisory support and never a safety determination.
      </p>
    </form>
  );
}