"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

interface ReplayDay {
  date: string;
  lead_time_days: number;
  forecast_probability: number;
  ci_lo: number;
  ci_hi: number;
  satellite_ndci: number;
  shap_top_features: Array<{ feature: string; human: string; shap_value: number }>;
}

interface ReplayEvent {
  event_id: string;
  waterbody_id: string;
  name: string;
  confirmation_date: string;
  lead_time_days: number;
  forecast_hit: boolean;
  severity_peak: number;
  description: string;
  source: string;
  days: ReplayDay[];
}

export function ReplayTheatre() {
  const [events, setEvents] = useState<Array<{ event_id: string; name: string; waterbody_id: string }>>([]);
  const [active, setActive] = useState<ReplayEvent | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    fetch(`${API}/v1/replay/events`)
      .then((r) => r.json())
      .then((d) => setEvents(d.data ?? []))
      .catch(() => setEvents([]));
  }, []);

  useEffect(() => {
    if (!events.length) return;
    fetch(`${API}/v1/replay/${events[0].event_id}`)
      .then((r) => r.json())
      .then(setActive)
      .catch(() => setActive(null));
  }, [events]);

  useEffect(() => {
    if (!playing || !active) return;
    const t = setInterval(() => {
      setIdx((i) => {
        if (i >= active.days.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 900);
    return () => clearInterval(t);
  }, [playing, active]);

  if (!active) {
    return (
      <div className="h-[480px] flex items-center justify-center text-fg-muted">
        Loading replay events…
      </div>
    );
  }

  const day = active.days[idx];
  const confirmed = idx >= active.days.findIndex((d) => d.lead_time_days === 0);
  const p = day.forecast_probability;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {events.map((ev) => (
          <button
            key={ev.event_id}
            onClick={() => {
              fetch(`${API}/v1/replay/${ev.event_id}`).then((r) => r.json()).then((d) => { setActive(d); setIdx(0); setPlaying(false); });
            }}
            className={`px-4 py-2 rounded-lg text-sm border transition-all ${
              active.event_id === ev.event_id
                ? "bg-glow-cyan/15 border-glow-cyan/50 text-glow-cyan"
                : "glass border-border-subtle text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {ev.name}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass rounded-2xl p-6 border border-border-subtle">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-display text-2xl font-semibold">{active.name}</h3>
              <p className="text-sm text-fg-muted mt-1">{active.description}</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-fg-muted">Confirmed</div>
              <div className="font-mono text-sm text-fg-primary">{active.confirmation_date}</div>
            </div>
          </div>

          <div className="flex items-baseline gap-3 mb-4">
            <AnimatePresence mode="popLayout">
              <motion.span
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="font-display text-5xl font-bold text-glow-cyan"
              >
                {Math.round(p * 100)}%
              </motion.span>
            </AnimatePresence>
            <span className="text-sm text-fg-muted">
              {day.date} · T-{day.lead_time_days} days
            </span>
          </div>

          <div className="relative h-3 bg-bg-deep rounded-full overflow-hidden mb-2">
            <div
              className="absolute h-full bg-glow-cyan/25 transition-all duration-500"
              style={{ left: `${day.ci_lo * 100}%`, width: `${Math.max(3, (day.ci_hi - day.ci_lo) * 100)}%` }}
            />
            <div className="absolute h-full w-1 bg-glow-cyan transition-all duration-500" style={{ left: `${p * 100}%` }} />
          </div>
          <div className="flex justify-between text-xs font-mono text-fg-muted mb-6">
            <span>CI {Math.round(day.ci_lo * 100)}%</span>
            <span>CI {Math.round(day.ci_hi * 100)}%</span>
          </div>

          <div className="relative h-28 bg-bg-abyss rounded-xl border border-border-faint mb-4 overflow-hidden">
            <motion.div
              className="absolute inset-0"
              animate={{ opacity: [0.3, 0.7, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{
                background: `radial-gradient(circle at ${20 + day.satellite_ndci * 200}% 50%, rgba(0,240,212,${0.15 + day.satellite_ndci}), rgba(255,0,170,${day.satellite_ndci * 0.5}) 70%, transparent)`,
              }}
            />
            <div className="absolute bottom-2 left-3 text-xs font-mono text-fg-secondary">
              NDCI false-color · satellite {day.satellite_ndci.toFixed(2)}
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={active.days.length - 1}
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            className="w-full accent-glow-cyan"
          />
          <div className="flex justify-between items-center mt-3">
            <button
              onClick={() => setPlaying(!playing)}
              className="px-4 py-2 rounded-lg bg-glow-cyan/15 border border-glow-cyan/40 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/25 transition-colors"
            >
              {playing ? "⏸ Pause" : "▶ Play forecast"}
            </button>
            <span className="text-xs text-fg-muted font-mono">
              {idx + 1} / {active.days.length}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass rounded-2xl p-6 border border-border-subtle">
            <h4 className="text-xs uppercase tracking-wider text-fg-muted mb-3">Why this forecast</h4>
            <div className="space-y-2">
              {day.shap_top_features.map((f) => (
                <div key={f.feature} className="flex items-center gap-2 text-sm">
                  <span className="font-mono">{f.shap_value > 0 ? "▲" : "▼"}</span>
                  <span className="text-fg-secondary flex-1">{f.human}</span>
                  <span className={`font-mono ${f.shap_value > 0 ? "text-glow-orange" : "text-glow-green"}`}>
                    {f.shap_value > 0 ? "+" : ""}{(f.shap_value * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <motion.div
            animate={confirmed ? { scale: [1, 1.03, 1] } : {}}
            className={`rounded-2xl p-6 border ${
              confirmed
                ? "bg-glow-green/10 border-glow-green/40"
                : "glass border-border-subtle"
            }`}
          >
            <div className="text-xs uppercase tracking-wider text-fg-muted mb-2">
              {confirmed ? "Forecast verification" : "Predictive lead time"}
            </div>
            {confirmed ? (
              <>
                <div className="font-display text-2xl font-bold text-glow-green">Forecast hit: confirmed</div>
                <p className="text-sm text-fg-secondary mt-2">
                  {active.lead_time_days} days lead time. Satellite NDCI confirms surface scum.
                </p>
              </>
            ) : (
              <>
                <div className="font-display text-2xl font-bold text-glow-cyan">
                  {day.lead_time_days} days ahead of satellite
                </div>
                <p className="text-sm text-fg-secondary mt-2">
                  The bloom is not yet visible in imagery. The forecast is driven by weather forcing + chlorophyll trend.
                </p>
              </>
            )}
          </motion.div>

          <div className="text-xs text-fg-faint px-2">
            Source: {active.source}
          </div>
        </div>
      </div>
    </div>
  );
}