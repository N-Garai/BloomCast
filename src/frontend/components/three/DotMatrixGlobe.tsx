"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// Real coastline geometry: ~5.7k land dots + simplified coast rings sampled
// offline from Natural Earth 110m (see .agent/gen_land_dots.py) and committed
// as data — no runtime CDN fetch, no tile server, works fully offline.
import landData from "@/components/maps/land-dots.json";

const RISK_COLORS: Record<string, string> = {
  low: "#00ff88",
  moderate: "#ffcc00",
  elevated: "#ff8800",
  high: "#ff3355",
  critical: "#ff00aa",
};

function latLonToVec3(lat: number, lon: number, radius = 1): [number, number, number] {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return [-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)];
}

const LAND_DOTS = landData.dots as Array<[number, number]>;
const COASTS = landData.coasts as Array<Array<[number, number]>>;

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
  const visibleRef = useRef(true);
  const stateRef = useRef({
    angle: -1.309, tilt: 0.3, velA: 0, velT: 0,
    dragging: false, hovering: false, lastX: 0, lastY: 0, lastT: 0,
    downX: 0, downY: 0, moved: 0, idleAt: 0,
  });
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
      if (cancelled) return;
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
      const tilt = stateRef.current.tilt;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const project = (vec: [number, number, number]) => {
        // Free rotation: spin about the polar (Y) axis, then tilt about the
        // X axis. Latitude is fixed by the spin; depth is the twice-rotated
        // Z. (An earlier revision used depth for vertical, which collapsed
        // the sphere into a northern dome.)
        const x = cos * vec[0] + sin * vec[2];
        const z = -sin * vec[0] + cos * vec[2];
        const yp = vec[1] * ct - z * st;
        const zp = vec[1] * st + z * ct;
        return { x: centerX + x * radius, y: centerY - yp * radius, z: zp };
      };
      // Deterministic hash → stable twinkle phase per dot (no per-frame RNG).
      const hashPhase = (lat: number, lon: number) => {
        const h = Math.sin(lat * 127.1 + lon * 311.7) * 43758.5453;
        return (h - Math.floor(h)) * Math.PI * 2;
      };
      const now = performance.now();
      // Starfield outside the disc — seeded once per draw from a fixed
      // palette so stars never crawl while the globe spins.
      for (let i = 0; i < 130; i++) {
        const sx = hashPhase(i, 7) / (Math.PI * 2);
        const sy = hashPhase(i, 91) / (Math.PI * 2);
        const px = sx * width;
        const py = sy * height;
        const dist = Math.hypot(px - centerX, py - centerY) / radius;
        if (dist < 1.15) continue;
        const tw = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.0009 + hashPhase(i, 13)));
        context.beginPath();
        context.arc(px, py, Math.max(0.6, ratio * 0.7), 0, Math.PI * 2);
        context.fillStyle = `rgba(180, 230, 255, ${tw.toFixed(3)})`;
        context.fill();
      }
      // Depth-graded disc: lit upper-left, dark limb — the ball reads as a
      // sphere instead of a flat plate (the bioluminescent-night-earth feel).
      const disc = context.createRadialGradient(
        centerX - radius * 0.35, centerY - radius * 0.4, radius * 0.1,
        centerX, centerY, radius
      );
      disc.addColorStop(0, "rgba(20, 32, 48, 0.62)");
      disc.addColorStop(0.55, "rgba(13, 20, 32, 0.55)");
      disc.addColorStop(1, "rgba(5, 8, 15, 0.9)");
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fillStyle = disc;
      context.fill();
      // Cyan atmosphere halo: three falling-off strokes plus a soft bleed.
      context.save();
      context.shadowColor = "rgba(0, 240, 212, 0.55)";
      context.shadowBlur = 18 * ratio;
      context.beginPath();
      context.arc(centerX, centerY, radius * 1.001, 0, Math.PI * 2);
      context.strokeStyle = "rgba(0, 240, 212, 0.5)";
      context.lineWidth = Math.max(1, ratio);
      context.stroke();
      context.restore();
      for (const [mult, alpha] of [[1.035, 0.22], [1.075, 0.1]] as const) {
        context.beginPath();
        context.arc(centerX, centerY, radius * mult, 0, Math.PI * 2);
        context.strokeStyle = `rgba(0, 240, 212, ${alpha})`;
        context.lineWidth = Math.max(1, ratio * 0.75);
        context.stroke();
      }
      const drawDots = () => {
        // Land dots from real coastline data (warm ivory, DepthGlobe-style);
        // water stays a clean dark sphere — no ocean-dot texture.
        for (const [lat, lon] of LAND_DOTS) {
          const vec = latLonToVec3(lat, lon, 1.004);
          const p = project(vec);
          if (p.z < 0.06) continue;
          // Limb darkening: dots fade toward the edge — depth cue.
          const limb = Math.min(1, Math.max(0, (p.z - 0.06) / 0.5));
          // Bioluminescent shimmer: each dot breathes on its own phase.
          const tw = 0.72 + 0.28 * Math.sin(now * 0.0012 + hashPhase(lat, lon));
          const h = hashPhase(lon, lat);
          // Rare warm "city-light" sparks among the ivory field.
          const warm = h % 1 < 0.035;
          const base = warm ? [255, 205, 140] : [255, 233, 196];
          const shade = 0.82 + 0.18 * (h % 1);
          const alpha = (0.62 * tw * (0.35 + 0.65 * limb)).toFixed(3);
          context.beginPath();
          context.arc(p.x, p.y, Math.max(1, radius * 0.0095), 0, Math.PI * 2);
          context.fillStyle = `rgba(${Math.round(base[0] * shade)}, ${Math.round(base[1] * shade)}, ${Math.round(base[2] * shade)}, ${alpha})`;
          context.fill();
        }
        // Coastline outlines: projected ring segments, front hemisphere only.
        context.lineWidth = Math.max(0.75, ratio * 0.6);
        context.strokeStyle = "rgba(255, 233, 196, 0.3)";
        context.beginPath();
        for (const ring of COASTS) {
          let pen = false;
          for (const [lat, lon] of ring) {
            const p = project(latLonToVec3(lat, lon, 1.004));
            if (p.z < 0.06) {
              pen = false;
              continue;
            }
            if (!pen) {
              context.moveTo(p.x, p.y);
              pen = true;
            } else {
              context.lineTo(p.x, p.y);
            }
          }
        }
        context.stroke();
      };
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
        // Expanding pulse ring — hotspots breathe like the reference.
        const pulse = (now * 0.0006 + hashPhase(wb.centroid[1], wb.centroid[0])) % 1;
        context.beginPath();
        context.arc(p.x, p.y, radius * (0.02 + pulse * 0.05), 0, Math.PI * 2);
        context.strokeStyle = wb.color;
        context.globalAlpha = 0.45 * (1 - pulse);
        context.lineWidth = Math.max(1, ratio * 0.8);
        context.stroke();
        context.globalAlpha = 1;
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
      // Drag-to-spin works on every globe, with or without a pick handler —
      // the hero globe has no onPick and was previously undraggable.
      // Pointer Events (not mouse events) so touch and pen drag too, and
      // pointercancel ends the gesture so rotation can never stick.
      const endDrag = () => {
        const state = stateRef.current;
        if (!state.dragging) return;
        state.dragging = false;
        state.idleAt = performance.now();
        if (reduceMotion) {
          state.velA = 0;
          state.velT = 0;
        }
        // Pointer capture releases implicitly on pointerup; pointercancel
        // and lostpointercapture funnel here so rotation can never stick.
      };
      canvas.onpointerdown = (event: PointerEvent) => {
        const state = stateRef.current;
        state.dragging = true;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        state.lastT = performance.now();
        state.downX = event.clientX;
        state.downY = event.clientY;
        state.moved = 0;
        state.velA = 0;
        state.velT = 0;
        canvas.setPointerCapture?.(event.pointerId);
        draw();
      };
      canvas.onpointermove = (event: PointerEvent) => {
        const state = stateRef.current;
        if (!state.dragging) {
          // Hover pauses the auto-spin (stopOnHover) — tracked without a
          // re-render; the loop reads it straight from the ref.
          const bounds = canvas.getBoundingClientRect();
          const r = Math.min(bounds.width, bounds.height) * 0.39;
          const dx = (event.clientX - (bounds.left + bounds.width / 2)) / r;
          const dy = (event.clientY - (bounds.top + bounds.height / 2)) / r;
          state.hovering = dx * dx + dy * dy <= 1;
          return;
        }
        const now = performance.now();
        const dt = Math.max(1, now - state.lastT);
        const dx = event.clientX - state.lastX;
        const dy = event.clientY - state.lastY;
        state.angle += dx * 0.008;
        state.tilt = Math.min(1.0, Math.max(-1.0, state.tilt + dy * 0.005));
        // Exponentially smoothed pixels/ms — released as inertia.
        const instantaneousA = (dx * 0.008) / dt;
        const instantaneousT = (dy * 0.005) / dt;
        state.velA = state.velA * 0.7 + instantaneousA * 0.3;
        state.velT = state.velT * 0.7 + instantaneousT * 0.3;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        state.lastT = now;
        state.moved = Math.max(state.moved, Math.hypot(event.clientX - state.downX, event.clientY - state.downY));
        draw();
      };
      canvas.onpointerup = (event: PointerEvent) => {
        const state = stateRef.current;
        const wasTap = state.dragging && state.moved < 6;
        endDrag();
        // A near-stationary press is a pick, not a drag.
        if (!wasTap || !onPick) return;
        const r = Math.min(canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height) * 0.39;
        const bounds = canvas.getBoundingClientRect();
        const dx = (event.clientX - (bounds.left + bounds.width / 2)) / r;
        const dy = (event.clientY - (bounds.top + bounds.height / 2)) / r;
        if (dx * dx + dy * dy > 1) return;
        // Orthographic inverse with tilt: vertical maps to tilted Y, depth
        // comes from the front-hemisphere root; then un-tilt, then un-spin.
        const yp = -dy;
        const zp = Math.sqrt(Math.max(0, 1 - dx * dx - yp * yp));
        const t = stateRef.current.tilt;
        const y0 = yp * Math.cos(t) + zp * Math.sin(t);
        const zd = -yp * Math.sin(t) + zp * Math.cos(t);
        const a = stateRef.current.angle;
        const x0 = Math.cos(a) * dx - Math.sin(a) * zd;
        const z0 = Math.sin(a) * dx + Math.cos(a) * zd;
        const lat = 90 - Math.acos(Math.max(-1, Math.min(1, y0))) * 180 / Math.PI;
        const lon = (Math.atan2(z0, -x0) * 180 / Math.PI - 180 + 180 + 360) % 360 - 180;
        onPick(lat, lon);
      };
      canvas.onpointercancel = () => endDrag();
      canvas.onlostpointercapture = () => endDrag();
    };

    const loop = () => {
      // Offscreen or tab-hidden: keep the frame request alive but skip all
      // work (both reference globes gate on visibility the same way).
      if (document.hidden || !visibleRef.current) {
        animation = requestAnimationFrame(loop);
        return;
      }
      const state = stateRef.current;
      let active = false;
      if (!state.dragging) {
        // Inertia after release, eased out — this is what makes the motion
        // feel physical instead of robotic.
        if (Math.abs(state.velA) > 0.00002 || Math.abs(state.velT) > 0.00002) {
          state.angle += state.velA * 16;
          state.tilt = Math.min(1.0, Math.max(-1.0, state.tilt + state.velT * 16));
          state.velA *= 0.94;
          state.velT *= 0.94;
          active = true;
        } else if (spin && performance.now() - state.idleAt > 2500 && !state.hovering) {
          state.angle += 0.0022;
          active = true;
        } else if (!reduceMotion || performance.now() - state.idleAt <= 2500) {
          // Keep the shimmer alive: twinkle and pulse rings need continuous
          // frames. Reduced-motion freezes 2.5 s after the last gesture.
          active = true;
        }
      } else {
        active = true;
      }
      if (active) draw();
      animation = requestAnimationFrame(loop);
    };
    resize = new ResizeObserver(draw);
    resize.observe(canvas);
    const visibility = new IntersectionObserver(
      ([entry]) => { visibleRef.current = entry?.isIntersecting ?? true; },
      { rootMargin: "100px" }
    );
    visibility.observe(canvas);
    draw();
    animation = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(animation);
      resize.disconnect();
      visibility.disconnect();
      canvas.onpointerdown = null;
      canvas.onpointermove = null;
      canvas.onpointerup = null;
      canvas.onpointercancel = null;
      canvas.onlostpointercapture = null;
    };
  }, [autoRotate, onPick, points, selected, picked]);

  return <canvas ref={canvasRef} className="h-full w-full cursor-grab touch-none select-none" aria-label="Interactive dot-matrix globe" />;
}
