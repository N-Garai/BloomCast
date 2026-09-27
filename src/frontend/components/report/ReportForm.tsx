"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import { API } from "@/lib/api";
import { getWaterbodies, type WaterbodyOption } from "@/lib/waterbodies";

const COLORS = ["clear", "green", "brown", "blue-green", "red", "other"];
const ODORS = ["none", "earthy", "musty", "rotten-egg", "other"];

export function ReportForm() {
  const [form, setForm] = useState({
    waterbody_id: "CH-ZUR-01",
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
  const [photo, setPhoto] = useState<string | null>(null);
  const [waterbodies, setWaterbodies] = useState<WaterbodyOption[]>([]);
  const [gpsBusy, setGpsBusy] = useState(false);

  useEffect(() => {
    getWaterbodies().then(setWaterbodies);
  }, []);

  function onPhoto(file: File | undefined) {
    if (!file) {
      setPhoto(null);
      return;
    }
    if (file.size > 500 * 1024) {
      setError("Photo must be under 500 KB — compress it first.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.onerror = () => setError("Could not read that photo file.");
    reader.readAsDataURL(file);
  }

  function setLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is unavailable in this browser — enter coordinates manually.");
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((current) => ({
          ...current,
          latitude: pos.coords.latitude.toFixed(5),
          longitude: pos.coords.longitude.toFixed(5),
        }));
        setError("");
        setGpsBusy(false);
      },
      (err) => {
        setGpsBusy(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location permission denied — allow it in the browser prompt, or enter coordinates manually.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError("Could not fix your position (indoors/GPS off?) — enter coordinates manually.");
        } else if (err.code === err.TIMEOUT) {
          setError("Location lookup timed out — try again or enter coordinates manually.");
        } else {
          setError("Geolocation unavailable — enter coordinates manually.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError("");
    const observation_id = `obs-${Date.now()}`;
    const lat = Number(form.latitude);
    const lon = Number(form.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setStatus("idle");
      setError("Enter valid latitude and longitude coordinates.");
      return;
    }
    try {
      const res = await fetch(`${API}/v1/citizen/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation_id,
          waterbody_id: form.waterbody_id,
          observed_at: new Date().toISOString(),
          latitude: lat,
          longitude: lon,
          water_color: form.water_color,
          scum_visible: form.scum_visible,
          odor: form.odor,
          wildlife_dead: form.wildlife_dead,
          notes: form.notes || undefined,
          photo_url: photo || undefined,
          source: "bloomcast-form",
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Report service returned HTTP ${res.status}.`);
      }
      setStatus("ok");
    } catch (err: any) {
      setStatus("idle");
      setError(err?.message ?? "The report could not be submitted.");
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
      <div>
        <label className="block text-sm text-fg-secondary mb-2" htmlFor="wb">Waterbody</label>
        <select
          id="wb"
          value={form.waterbody_id}
          onChange={(e) => setForm({ ...form, waterbody_id: e.target.value })}
          className="w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary focus:border-glow-cyan outline-none"
        >
          {waterbodies.length ? (
            waterbodies.map((wb) => (
              <option key={wb.id} value={wb.id}>{wb.name}</option>
            ))
          ) : (
            <option value={form.waterbody_id}>{form.waterbody_id}</option>
          )}
        </select>
        <p className="mt-1.5 text-xs text-fg-faint">Reports are anonymous — no account or email needed.</p>
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
            disabled={gpsBusy}
            className="px-4 py-2.5 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm whitespace-nowrap hover:bg-glow-cyan/20 transition-colors disabled:opacity-50"
          >
            {gpsBusy ? "Locating…" : "Use GPS"}
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

      <div>
        <label className="block text-sm text-fg-secondary mb-2" htmlFor="photo">
          Photo (optional, ≤500 KB — stored with your report)
        </label>
        <input
          id="photo"
          type="file"
          accept="image/*"
          onChange={(e) => onPhoto(e.target.files?.[0])}
          className="block w-full text-sm text-fg-muted file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border file:border-glow-cyan/30 file:bg-glow-cyan/10 file:text-glow-cyan file:text-sm hover:file:bg-glow-cyan/20 file:transition-colors"
        />
        {photo && (
          <img src={photo} alt="Observation preview" className="mt-3 max-h-40 rounded-xl border border-border-subtle" />
        )}
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