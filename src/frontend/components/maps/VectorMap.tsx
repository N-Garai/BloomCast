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

export function VectorMap({ points = [], onPick, selectedId }: { points?: VectorMapPoint[]; onPick: (lat: number, lon: number) => void; selectedId?: string }) {
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
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    const lon = (x / width) * 360 - 180;
    const lat = 90 - (y / height) * 180;
    if (Number.isFinite(lat) && Number.isFinite(lon)) onPick(lat, lon);
  };

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        className="h-64 w-full rounded-xl border border-border-subtle bg-[#02060f] cursor-crosshair touch-manipulation"
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
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg border border-border-subtle bg-bg-abyss/85 px-2 py-1 font-mono text-[10px] text-fg-muted">
        {selected ? `${selected.name} · ${selected.lat.toFixed(2)}, ${selected.lon.toFixed(2)}` : "Click ocean or land to pick coordinates"}
      </div>
    </div>
  );
}
