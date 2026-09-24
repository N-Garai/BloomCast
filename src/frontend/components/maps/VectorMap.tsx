"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LAND_PATHS } from "@/components/maps/land-paths";

export interface VectorMapPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  risk?: number;
  selected?: boolean;
}

function project(lat: number, lon: number, width: number, height: number) {
  return {
    x: ((lon + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  };
}

export function VectorMap({ points = [], onPick, selectedId, fill = false, panel = null }: { points?: VectorMapPoint[]; onPick: (lat: number, lon: number) => void; selectedId?: string; fill?: boolean; panel?: React.ReactNode }) {
  const ref = useRef<SVGSVGElement>(null);
  const width = 900;
  const height = 450;
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const selected = useMemo(() => points.find((point) => point.id === selectedId), [points, selectedId]);

  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    // Map the click through the REAL content rect, not the element box: with
    // meet there are letterbox bars, with slice the edges are cropped — both
    // offset a naive clientX/width mapping (the old code put pins left of
    // the click for exactly this reason).
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = fill
      ? Math.max(rect.width / width, rect.height / height)
      : Math.min(rect.width / width, rect.height / height);
    const offX = (rect.width - width * scale) / 2;
    const offY = (rect.height - height * scale) / 2;
    const x = (event.clientX - rect.left - offX) / scale;
    const y = (event.clientY - rect.top - offY) / scale;
    if (x < 0 || x > width || y < 0 || y > height) return;
    const lon = (x / width) * 360 - 180;
    const lat = 90 - (y / height) * 180;
    if (Number.isFinite(lat) && Number.isFinite(lon)) onPick(lat, lon);
  };

  return (
    <div className={`flex flex-col gap-3 sm:flex-row ${fill ? "h-full" : ""}`}>
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={fill ? "xMidYMid slice" : "xMidYMid meet"}
        className={`${fill ? "h-72 sm:h-full" : "h-72"} w-full rounded-xl border border-border-subtle bg-[#02060f] cursor-crosshair touch-manipulation sm:min-w-0 sm:flex-1`}
        role="application"
        aria-label="World map. Click to pick coordinates."
        onClick={handleClick}
      >
        <defs>
          <radialGradient id="ocean" cx="50%" cy="42%" r="75%">
            <stop offset="0%" stopColor="#06273d" />
            <stop offset="100%" stopColor="#02060f" />
          </radialGradient>
          <linearGradient id="land" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#0d5c61" />
            <stop offset="100%" stopColor="#087f83" />
          </linearGradient>
          <filter id="landGlow"><feGaussianBlur stdDeviation="1.2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <pattern id="graticule" width="90" height="90" patternUnits="userSpaceOnUse">
            <path d="M 90 0 L 0 0 0 90" fill="none" stroke="#155e66" strokeWidth="0.7" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#ocean)" />
        <rect width={width} height={height} fill="url(#graticule)" opacity="0.45" />
        <g filter="url(#landGlow)">
          {LAND_PATHS.map((d, i) => <path key={i} d={d} fill="url(#land)" stroke="#1fb6a8" strokeWidth="0.8" opacity="0.92" />)}
        </g>
        {selected && (() => {
          const p = project(selected.lat, selected.lon, width, height);
          return (
            <g>
              <line x1={p.x} y1="0" x2={p.x} y2={height} stroke="#8b5cf6" strokeWidth="0.8" strokeDasharray="3 4" opacity="0.65" />
              <line x1="0" y1={p.y} x2={width} y2={p.y} stroke="#8b5cf6" strokeWidth="0.8" strokeDasharray="3 4" opacity="0.65" />
              <circle cx={p.x} cy={p.y} r="14" fill="none" stroke="#8b5cf6" strokeWidth="1" opacity="0.55" />
              <circle cx={p.x} cy={p.y} r="5" fill="#8b5cf6" />
            </g>
          );
        })()}
        {points.map((point) => {
          const p = project(point.lat, point.lon, width, height);
          const color = point.risk === undefined ? "#00f0d4" : point.risk < 0.3 ? "#00ff88" : point.risk < 0.5 ? "#ffcc00" : point.risk < 0.7 ? "#ff8800" : point.risk < 0.85 ? "#ff3355" : "#ff00aa";
          return (
            <g key={point.id} className="cursor-pointer" onClick={(event) => { event.stopPropagation(); onPick(point.lat, point.lon); }}>
              {!reducedMotion && <circle cx={p.x} cy={p.y} r="9" fill={color} opacity="0.18">
                <animate attributeName="r" values="7;11;7" dur="2s" repeatCount="indefinite" />
              </circle>}
              <circle cx={p.x} cy={p.y} r="4" fill={color} stroke="#02060f" strokeWidth="1.5" />
              {point.selected && <circle cx={p.x} cy={p.y} r="8" fill="none" stroke="#8b5cf6" strokeWidth="1.5" />}
            </g>
          );
        })}
      </svg>
      <aside className="shrink-0 rounded-xl border border-border-subtle bg-bg-deep/60 p-3 sm:w-44" aria-live="polite">
        {panel ?? (<>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-glow-cyan">Coordinates</div>
        {selected ? (
          <div className="mt-2">
            <div className="text-sm font-medium text-fg-primary">{selected.name}</div>
            <div className="mt-1 font-mono text-lg tabular text-fg-primary">{selected.lat.toFixed(2)}°</div>
            <div className="font-mono text-lg tabular text-fg-primary">{selected.lon.toFixed(2)}°</div>
            <div className="mt-2 text-[11px] leading-relaxed text-fg-muted">Crosshair marks this spot. Click elsewhere to move it.</div>
          </div>
        ) : (
          <div className="mt-2 text-[11px] leading-relaxed text-fg-muted">Click ocean or land to drop a pin and run the live assessment.</div>
        )}
        </>)}
      </aside>
    </div>
  );
}
