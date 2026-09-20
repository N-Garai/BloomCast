"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { API } from "@/lib/api";

const STEPS = [
  { id: "satellite", label: "Reading Sentinel-2 red-edge", detail: "NDCI chlorophyll signal" },
  { id: "weather", label: "Fusing 14-day weather ensemble", detail: "Open-Meteo temperature, wind, rain" },
  { id: "citizen", label: "Blending validated observations", detail: "Ground Truth Loop, capped influence" },
  { id: "model", label: "Running hybrid forecast model", detail: "Gradient boosting + temporal network" },
  { id: "calibrate", label: "Calibrating probability", detail: "Isotonic scaling + confidence interval" },
];

export function ForecastPipeline({
  waterbodyId,
  waterbodyName,
  onDone,
}: {
  waterbodyId: string;
  waterbodyName?: string;
  onDone?: (forecast: any) => void;
}) {
  const [activeStep, setActiveStep] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setActiveStep(0);
    setDone(false);
    setError(null);
    setSummary(null);

    // Animate steps while the real request is in flight.
    const stepTimer = setInterval(() => {
      setActiveStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 450);

    fetch(`${API}/v1/forecast/${waterbodyId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        clearInterval(stepTimer);
        setActiveStep(STEPS.length - 1);
        setTimeout(() => {
          if (cancelled) return;
          setDone(true);
          setSummary(d);
          onDone?.(d);
        }, 450);
      })
      .catch((e) => {
        if (cancelled) return;
        clearInterval(stepTimer);
        setError(String(e?.message ?? e));
      });

    return () => {
      cancelled = true;
      clearInterval(stepTimer);
    };
  }, [waterbodyId, onDone]);

  return (
    <div className="rounded-2xl border border-border-subtle glass p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-glow-cyan opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-glow-cyan" />
        </span>
        <h3 className="text-xs font-mono uppercase tracking-[0.25em] text-glow-cyan">
          Live forecast workflow
        </h3>
      </div>
      {waterbodyName && (
        <p className="text-sm text-fg-secondary mb-4">
          Building 3–7 day outlook for <span className="text-fg-primary font-medium">{waterbodyName}</span>
        </p>
      )}
      <ol className="space-y-2.5">
        {STEPS.map((s, i) => {
          const state = done || i < activeStep ? "done" : i === activeStep ? "active" : "waiting";
          return (
            <li key={s.id} className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-mono transition-all ${
                  state === "done"
                    ? "border-glow-green/60 bg-glow-green/15 text-glow-green"
                    : state === "active"
                      ? "border-glow-cyan/60 bg-glow-cyan/15 text-glow-cyan"
                      : "border-border-subtle text-fg-faint"
                }`}
              >
                {state === "done" ? "✓" : `0${i + 1}`}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm leading-tight transition-colors ${
                    state === "waiting" ? "text-fg-faint" : "text-fg-primary"
                  }`}
                >
                  {s.label}
                  {state === "active" && (
                    <motion.span
                      className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-glow-cyan"
                      animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                  )}
                </div>
                <div className="text-xs text-fg-muted truncate">{s.detail}</div>
                {state === "active" && (
                  <motion.div
                    className="mt-1.5 h-0.5 overflow-hidden rounded bg-bg-elevated"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <motion.div
                      className="h-full w-1/3 bg-gradient-to-r from-glow-cyan to-glow-green"
                      animate={{ x: ["-100%", "300%"] }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </motion.div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 text-xs font-mono text-glow-red"
          >
            {error} — retrying on next selection.
          </motion.p>
        )}
        {done && summary && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-xl border border-glow-cyan/25 bg-glow-cyan/5 p-3 text-xs text-fg-secondary"
          >
            Outlook ready — 5-day bloom probability{" "}
            <span className="font-mono text-glow-cyan text-sm">
              {Math.round((summary?.horizons?.["5d"]?.p_bloom ?? summary?.p_bloom ?? 0) * 100)}%
            </span>
            . Open the card to see horizons and drivers.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
