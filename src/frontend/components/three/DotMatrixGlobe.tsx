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
}: {
  waterbodies?: any[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  onPick?: (lat: number, lon: number) => void;
  autoRotate?: boolean;
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
        const x = cos * vec[0] + sin * vec[2];
        const z = -sin * vec[0] + cos * vec[2];
        return { x: centerX + x * radius, y: centerY - z * radius, z };
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
          // Orthographic inverse in CSS pixels: the globe disc has radius r
          // around its center; clicks outside the disc are ignored, and the
          // front-hemisphere root keeps southern clicks southern.
          const r = Math.min(bounds.width, bounds.height) * 0.39;
          const dx = (event.clientX - (bounds.left + bounds.width / 2)) / r;
          const dy = (event.clientY - (bounds.top + bounds.height / 2)) / r;
          if (dx * dx + dy * dy > 1) return;
          const y0 = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
          // Undo the draw() rotation (X = c*x0 + s*z0, Z = -s*x0 + c*z0)
          // and the screen flip (screenY = cy - Z*r).
          const rx = dx;
          const rz = -dy;
          const x0 = Math.cos(state.angle) * rx - Math.sin(state.angle) * rz;
          const z0 = Math.sin(state.angle) * rx + Math.cos(state.angle) * rz;
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
  }, [autoRotate, onPick, points, selected]);

  return <canvas ref={canvasRef} className="h-full w-full cursor-grab touch-none select-none" aria-label="Interactive dot-matrix globe" />;
}
