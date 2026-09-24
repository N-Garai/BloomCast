"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const RISK_COLORS: Record<string, string> = {
  low: "#00ff88",
  moderate: "#ffcc00",
  elevated: "#ff8800",
  high: "#ff3355",
  critical: "#ff00aa",
};

const LAND_REGIONS: Array<[number, number, number, number]> = [
  [-168, -140, 55, 72],
  [-141, -55, 48, 70],
  [-125, -66, 25, 49],
  [-117, -79, 8, 25],
  [-58, -20, 60, 84],
  [-79, -50, -5, 12],
  [-73, -40, -35, -5],
  [-73, -53, -56, -35],
  [-25, -13, 63, 67],
  [-11, 2, 50, 59],
  [5, 31, 55, 71],
  [-10, 15, 36, 51],
  [15, 45, 40, 55],
  [-17, 35, 18, 37],
  [-18, 50, -12, 18],
  [12, 40, -35, -12],
  [43, 51, -26, -12],
  [35, 60, 12, 42],
  [40, 140, 45, 72],
  [60, 180, 50, 72],
  [68, 90, 8, 35],
  [95, 110, 5, 28],
  [100, 122, 20, 45],
  [122, 146, 30, 46],
  [95, 141, -11, 6],
  [113, 154, -39, -11],
  [166, 179, -47, -34],
  [-180, 180, -90, -63],
];

function latLonToVec3(lat: number, lon: number, radius = 1): [number, number, number] {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return [-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)];
}

function isLand(lat: number, lon: number) {
  return LAND_REGIONS.some(([west, east, south, north]) => lon >= west && lon <= east && lat >= south && lat <= north);
}

function riskFor(wb: any) {
  const p = wb._risk ?? "low";
  return RISK_COLORS[p] ?? RISK_COLORS.low;
}

export function DotMatrixGlobe({
  waterbodies = [],
  selected,
  onSelect,
  onPick,
  autoRotate = true,
  picked = null,
}: {
  waterbodies?: any[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  onPick?: (lat: number, lon: number) => void;
  autoRotate?: boolean;
  picked?: { lat: number; lon: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ angle: 0, targetAngle: 0, dragging: false, lastX: 0, moved: 0, downX: 0, downY: 0 });
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const spin = autoRotate && !reduceMotion;

  const points = useMemo(() => waterbodies.map((wb) => ({ ...wb, color: riskFor(wb) })), [waterbodies]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let animation: number;
    let resize: ResizeObserver;
    let cancelled = false;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(320, Math.round(rect.width * ratio));
      const height = Math.max(320, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.39;
      const angle = stateRef.current.angle;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const project = (vec: [number, number, number]) => {
        // Spin is a rotation about the Y (polar) axis, so latitude (vec[1])
        // is fixed and depth is the rotated Z. (An earlier revision used Z
        // for vertical, which collapsed the sphere into a northern dome.)
        const x = cos * vec[0] + sin * vec[2];
        const z = -sin * vec[0] + cos * vec[2];
        return { x: centerX + x * radius, y: centerY - vec[1] * radius, z };
      };
      const drawDots = () => {
        for (let lat = -80; lat <= 80; lat += 4) {
          for (let lon = -180; lon < 180; lon += 4) {
            const vec = latLonToVec3(lat, lon, 1.004);
            const p = project(vec);
            if (p.z < 0.06) continue;
            context.beginPath();
            context.arc(p.x, p.y, Math.max(1, radius * 0.008), 0, Math.PI * 2);
            context.fillStyle = isLand(lat, lon) ? "rgba(0, 240, 212, 0.35)" : "rgba(8, 65, 88, 0.22)";
            context.fill();
          }
        }
      };
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.strokeStyle = "rgba(0, 240, 212, 0.28)";
      context.lineWidth = ratio;
      context.stroke();
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fillStyle = "rgba(2, 6, 15, 0.28)";
      context.fill();
      drawDots();
      for (let lat = -75; lat <= 75; lat += 15) {
        const p = project(latLonToVec3(lat, -180, 1.004));
        const q = project(latLonToVec3(lat, 180, 1.004));
        if (p.z > 0 && q.z > 0) {
          context.beginPath();
          context.moveTo(p.x, p.y);
          context.lineTo(q.x, q.y);
          context.strokeStyle = "rgba(31, 182, 168, 0.12)";
          context.stroke();
        }
      }
      points.forEach((wb) => {
        const vec = latLonToVec3(wb.centroid[1], wb.centroid[0], 1.02);
        const p = project(vec);
        if (p.z < 0.08) return;
        const selectedPoint = selected === wb.id;
        if (selectedPoint) {
          context.beginPath();
          context.arc(p.x, p.y, radius * 0.045, 0, Math.PI * 2);
          context.strokeStyle = wb.color;
          context.globalAlpha = 0.5;
          context.stroke();
          context.globalAlpha = 1;
        }
        context.beginPath();
        context.arc(p.x, p.y, selectedPoint ? radius * 0.025 : radius * 0.016, 0, Math.PI * 2);
        context.fillStyle = wb.color;
        context.shadowColor = wb.color;
        context.shadowBlur = selectedPoint ? radius * 0.04 : radius * 0.02;
        context.fill();
        context.shadowBlur = 0;
      });
      const labelFor = (lat: number, lon: number) => {
        const target = latLonToVec3(lat, lon, 1);
        let best: any = null;
        let bestDot = -2;
        for (const wb of points) {
          if (!Array.isArray(wb.centroid)) continue;
          const vec = latLonToVec3(wb.centroid[1], wb.centroid[0], 1);
          const dot = target[0] * vec[0] + target[1] * vec[1] + target[2] * vec[2];
          if (dot > bestDot) {
            bestDot = dot;
            best = wb;
          }
        }
        // ~8° hotspot radius: a nearby pilot names the spot, otherwise the
        // coordinates themselves are the label — never a silent dot.
        if (best && bestDot > 0.99 && best.name) return best.name;
        return `Open water · ${lat.toFixed(1)}°, ${lon.toFixed(1)}°`;
      };
      const drawLabel = (lat: number, lon: number, color: string) => {
        const p = project(latLonToVec3(lat, lon, 1.02));
        if (p.z < 0.08) return;
        const font = `${Math.max(10, radius * 0.032)}px "JetBrains Mono", monospace`;
        context.font = font;
        const text = labelFor(lat, lon);
        const padding = 6 * ratio;
        const textWidth = context.measureText(text).width;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = Math.max(16, radius * 0.05) + padding;
        let boxX = Math.min(Math.max(p.x - boxWidth / 2, 4), width - boxWidth - 4);
        let boxY = p.y - boxHeight - radius * 0.03;
        if (boxY < 4) boxY = p.y + radius * 0.03;
        context.beginPath();
        context.fillStyle = "rgba(2, 6, 15, 0.88)";
        context.strokeStyle = color;
        context.lineWidth = Math.max(1, ratio * 0.75);
        context.rect(boxX, boxY, boxWidth, boxHeight);
        context.fill();
        context.stroke();
        context.beginPath();
        context.fillStyle = "#e8fbff";
        context.textBaseline = "middle";
        context.fillText(text, boxX + padding, boxY + boxHeight / 2 + 1);
      };
      const selectedPoint = points.find((wb) => wb.id === selected);
      if (selectedPoint && Array.isArray(selectedPoint.centroid)) {
        drawLabel(selectedPoint.centroid[1], selectedPoint.centroid[0], selectedPoint.color);
      }
      if (picked && Number.isFinite(picked.lat) && Number.isFinite(picked.lon)) {
        const marker = project(latLonToVec3(picked.lat, picked.lon, 1.02));
        if (marker.z >= 0.08) {
          context.beginPath();
          context.arc(marker.x, marker.y, radius * 0.03, 0, Math.PI * 2);
          context.strokeStyle = "#8b5cf6";
          context.lineWidth = Math.max(1.5, ratio);
          context.stroke();
          context.beginPath();
          context.arc(marker.x, marker.y, radius * 0.014, 0, Math.PI * 2);
          context.fillStyle = "#8b5cf6";
          context.fill();
        }
        drawLabel(picked.lat, picked.lon, "#8b5cf6");
      }
      if (onPick && !cancelled) {
        canvas.onmousemove = (event: MouseEvent) => {
          const state = stateRef.current;
          if (state.dragging) {
            state.angle += (event.clientX - state.lastX) * 0.008;
            state.lastX = event.clientX;
            state.moved = Math.max(state.moved, Math.abs(event.clientX - state.downX));
            draw();
          }
        };
        canvas.onmouseup = () => {
          stateRef.current.dragging = false;
        };
        canvas.onmousedown = (event: MouseEvent) => {
          stateRef.current.dragging = true;
          stateRef.current.lastX = event.clientX;
          stateRef.current.downX = event.clientX;
          stateRef.current.downY = event.clientY;
          stateRef.current.moved = 0;
          const pointerEvent = event as PointerEvent;
          canvas.setPointerCapture?.(pointerEvent.pointerId);
        };
        canvas.onclick = (event: MouseEvent) => {
          const state = stateRef.current;
          // A drag that ends over the canvas also fires click — only treat
          // near-stationary presses as picks.
          if (state.moved > 6) {
            state.moved = 0;
            return;
          }
          state.moved = 0;
          const bounds = canvas.getBoundingClientRect();
          // Orthographic inverse in CSS pixels: vertical screen offset maps
          // back to latitude (vec[1]), horizontal to rotated X; depth comes
          // from the front-hemisphere root. Clicks outside the disc ignored.
          const r = Math.min(bounds.width, bounds.height) * 0.39;
          const dx = (event.clientX - (bounds.left + bounds.width / 2)) / r;
          const dy = (event.clientY - (bounds.top + bounds.height / 2)) / r;
          if (dx * dx + dy * dy > 1) return;
          const y0 = -dy;
          const zr = Math.sqrt(Math.max(0, 1 - dx * dx - y0 * y0));
          // Undo the draw() Y-rotation (X = c*x0 + s*z0, Z = -s*x0 + c*z0).
          const x0 = Math.cos(state.angle) * dx - Math.sin(state.angle) * zr;
          const z0 = Math.sin(state.angle) * dx + Math.cos(state.angle) * zr;
          const lat = 90 - Math.acos(Math.max(-1, Math.min(1, y0))) * 180 / Math.PI;
          const lon = (Math.atan2(z0, -x0) * 180 / Math.PI - 180 + 180 + 360) % 360 - 180;
          onPick(lat, lon);
        };
      }
    };

    const loop = () => {
      const state = stateRef.current;
      if (!state.dragging && spin) {
        state.angle += 0.0018;
        draw();
      }
      animation = requestAnimationFrame(loop);
    };
    resize = new ResizeObserver(draw);
    resize.observe(canvas);
    draw();
    animation = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(animation);
      resize.disconnect();
      canvas.onmousemove = null;
      canvas.onmouseup = null;
      canvas.onmousedown = null;
      canvas.onclick = null;
    };
  }, [autoRotate, onPick, points, selected, picked]);

  return <canvas ref={canvasRef} className="h-full w-full cursor-grab touch-none select-none" aria-label="Interactive dot-matrix globe" />;
}
