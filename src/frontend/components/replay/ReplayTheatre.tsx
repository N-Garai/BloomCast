"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { API } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = () => {
    setLoading(true);
    setError(null);
    fetch(`${API}/v1/replay/events`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} on /v1/replay/events`);
        return r.json();
      })
      .then((d) => {
        const list = d.data ?? [];
        setEvents(list);
        if (!list.length) {
          setLoading(false);
          setError("The service returned no replay events.");
        }
      })
      .catch((e) => {
        setLoading(false);
        setError(String(e?.message ?? e));
      });
  };

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    if (!events.length) return;
    fetch(`${API}/v1/replay/${events[0].event_id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setActive(d);
        setLoading(false);
      })
      .catch((e) => {
        setLoading(false);
        setError(String(e?.message ?? e));
      });
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

  if (loading && !active) {
    return <Spinner label="Loading replay events" />;
  }

  if ((error && !active) || (!loading && !events.length)) {
    return <ErrorBanner message={error ?? "No replay events available."} onRetry={loadEvents} />;
  }

  if (!active) return null;

  const day = active.days[idx];
  const confirmIdx = active.days.findIndex((d) => d.lead_time_days === 0);
  const confirmed = confirmIdx >= 0 && idx >= confirmIdx;
  const p = day.forecast_probability;

  const selectEvent = (eventId: string) => {
    fetch(`${API}/v1/replay/${eventId}`)
      .then((r) => r.json())
      .then((d) => { setActive(d); setIdx(0); setPlaying(false); })
      .catch(() => {});
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {events.map((ev) => (
          <button
            key={ev.event_id}
            onClick={() => selectEvent(ev.event_id)}
            className={`px-4 py-2 rounded-lg text-sm border transition-all ${
              active.event_id === ev.event_id
                ? "bg-glow-cyan/15 border-glow-cyan/50 text-glow-cyan shadow-glow-sm"
                : "glass border-border-subtle text-fg-secondary hover:text-fg-primary hover:border-glow-cyan/30"
            }`}
          >
            {ev.name}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass rounded-2xl p-6 border border-border-subtle relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-glow-cyan/60 to-transparent" />
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-display text-2xl font-semibold tracking-wide">{active.name}</h3>
              <p className="text-sm text-fg-muted mt-1">{active.description}</p>
            </div>
            <div className="text-right shrink-0 ml-4">
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
                className="font-display text-5xl font-bold text-glow-cyan tabular"
              >
                {Math.round(p * 100)}%
              </motion.span>
            </AnimatePresence>
            <span className="text-sm text-fg-muted font-mono">
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
            {confirmed && (
              <div className="absolute top-2 right-3 text-[11px] font-mono px-2 py-0.5 rounded-full border border-glow-green/50 text-glow-green bg-bg-abyss/70">
                SATELLITE CONFIRMED
              </div>
            )}
          </div>

          <input
            type="range"
            min={0}
            max={active.days.length - 1}
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            className="w-full accent-[#00f0d4]"
            aria-label="Scrub replay timeline"
          />
          <div className="flex justify-between items-center mt-3">
            <button
              onClick={() => setPlaying(!playing)}
              className="group relative overflow-hidden px-4 py-2 rounded-lg bg-glow-cyan/15 border border-glow-cyan/40 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/25 transition-colors"
            >
              {playing ? "❚❚ Pause" : "▶ Play forecast"}
            </button>
            <span className="text-xs text-fg-muted font-mono tabular">
              {idx + 1} / {active.days.length}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass rounded-2xl p-6 border border-border-subtle">
            <h4 className="text-xs uppercase tracking-wider text-fg-muted mb-3">Why this forecast</h4>
            <div className="space-y-2">
              {day.shap_top_features.map((f, i) => (
                <motion.div
                  key={f.feature}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="font-mono">{f.shap_value > 0 ? "▲" : "▼"}</span>
                  <span className="text-fg-secondary flex-1">{f.human}</span>
                  <span className={`font-mono ${f.shap_value > 0 ? "text-glow-orange" : "text-glow-green"}`}>
                    {f.shap_value > 0 ? "+" : ""}{(f.shap_value * 100).toFixed(0)}%
                  </span>
                </motion.div>
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
