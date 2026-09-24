"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export const ADVISORY = "BloomCast outputs are advisory support and never a safety determination.";

export function friendlyError(error: unknown, kind: "weather" | "forecast" | "data" = "data") {
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: unknown }).message ?? error) : String(error);
  if (message.includes("429") || message.includes("Retry-After") || message.includes("Too Many Requests")) {
    return "The service is busy right now. Wait a moment, then try again.";
  }
  // fetch() throws TypeError ("Failed to fetch") when the backend itself is
  // unreachable — blaming the weather service for that misdiagnoses every
  // outage, so it gets its own message.
  if (message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("Load failed")) {
    return "Cannot reach the BloomCast backend — check the API is running, then try again.";
  }
  if (message.includes("Network") || message.includes("offline")) {
    return "You are offline. Reconnect, then try again.";
  }
  if (/HTTP 5\d\d/.test(message)) {
    return "The service hit a problem responding — try again in a minute.";
  }
  if (kind === "weather") return "Weather data is unavailable right now — try again in a minute.";
  if (kind === "forecast") return "Forecast data is unavailable right now.";
  return "This data is unavailable right now. Try again.";
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator === "undefined" ? false : navigator.onLine === false);

  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[90] border-b border-glow-yellow/30 bg-yellow/95 px-4 py-2 text-center text-xs text-yellow-100 shadow-lg">
      You are offline. Changes will be saved locally; live forecasts may be unavailable.
    </div>
  );
}

export function SkeletonCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-deep/50 p-4" aria-hidden>
      <div className={`h-3 w-24 rounded bg-bg-elevated ${compact ? "mb-3" : "mb-4"}`} />
      <div className="h-8 w-20 rounded bg-bg-elevated" />
      {!compact && <div className="mt-4 h-3 w-32 rounded bg-bg-elevated" />}
      {!compact && <div className="mt-3 h-2 w-full rounded bg-bg-elevated/70" />}
      {!compact && <div className="mt-2 h-2 w-2/3 rounded bg-bg-elevated/70" />}
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-deep/40 p-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-glow-cyan/30 bg-glow-cyan/5 text-glow-cyan">
        <span className="text-xs font-mono">∅</span>
      </div>
      <div className="mt-3 font-display text-lg font-semibold text-fg-primary">{title}</div>
      <p className="mt-1 max-w-sm text-xs text-fg-secondary">{detail}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-glow-red/30 bg-glow-red/5 p-5" role="alert">
      <div className="font-display text-lg font-semibold text-glow-red">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-fg-secondary">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-lg border border-glow-cyan/30 bg-glow-cyan/10 px-3 py-1.5 text-xs text-glow-cyan">
          Try again
        </button>
      )}
    </div>
  );
}

export function Advisory({ children = ADVISORY }: { children?: React.ReactNode }) {
  return <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">{children}</p>;
}

export function RiskBadge({ value, level }: { value: number; level?: string }) {
  const normalized = level ?? (value < 0.3 ? "low" : value < 0.5 ? "moderate" : value < 0.7 ? "elevated" : value < 0.85 ? "high" : "critical");
  const classes: Record<string, string> = {
    low: "text-glow-green border-glow-green/40 bg-glow-green/10",
    moderate: "text-glow-yellow border-glow-yellow/40 bg-glow-yellow/10",
    elevated: "text-glow-orange border-glow-orange/40 bg-glow-orange/10",
    high: "text-glow-red border-glow-red/40 bg-glow-red/10",
    critical: "text-glow-magenta border-glow-magenta/40 bg-glow-magenta/10",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${classes[normalized] ?? classes.low}`}>{normalized}</span>;
}

export function RiskTrajectory({ days }: { days: Array<{ date: string; risk_score: number; risk_level: string }> }) {
  const width = 560;
  const height = 140;
  const pad = 24;
  const x = (i: number) => pad + (i / Math.max(1, days.length - 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - value * (height - pad * 2);
  const points = days.map((d, i) => `${x(i).toFixed(1)},${y(d.risk_score).toFixed(1)}`).join(" ");
  return (
    <div className="mt-4 rounded-xl border border-border-faint bg-bg-abyss/50 p-3">
      <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-fg-muted">Risk trajectory</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Risk trajectory">
        {[0.25, 0.5, 0.75].map((level) => <line key={level} x1={pad} x2={width - pad} y1={y(level)} y2={y(level)} stroke="#3d5666" strokeWidth="0.5" strokeDasharray="3 4" opacity="0.6" />)}
        <motion.polygon points={`${pad},${height - pad} ${points} ${width - pad},${height - pad}`} fill="#00f0d4" opacity="0.1" initial={{ opacity: 0 }} animate={{ opacity: 0.1 }} transition={{ duration: 0.8 }} />
        <motion.polyline points={points} fill="none" stroke="#00f0d4" strokeWidth="2.5" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: "easeOut" }} />
        {days.map((day, i) => (
          <g key={day.date}>
            <circle cx={x(i)} cy={y(day.risk_score)} r="4" fill={day.risk_level === "high" || day.risk_level === "critical" ? "#ff3355" : day.risk_level === "elevated" ? "#ff8800" : day.risk_level === "moderate" ? "#ffcc00" : "#00ff88"} />
            <text x={x(i)} y={height - 7} textAnchor="middle" fontSize="9" fill="#5a7888" fontFamily="monospace">{day.date.slice(5)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
