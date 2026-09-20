"use client";

import { useEffect, useState } from "react";

export function MagneticCursor() {
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [hovering, setHovering] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setEnabled(true);

    let raf = 0;
    let tx = -100;
    let ty = -100;
    let cx = -100;
    let cy = -100;

    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      const el = e.target as HTMLElement | null;
      setHovering(!!el?.closest?.("a, button, input, select, textarea, [data-cursor-hover]"));
    };

    const animate = () => {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      setPos({ x: cx, y: cy });
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  if (!enabled) return null;
  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-[9999] mix-blend-screen"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      aria-hidden
    >
      <div
        className="-translate-x-1/2 -translate-y-1/2 rounded-full bg-glow-cyan transition-all duration-200"
        style={{
          width: hovering ? 28 : 8,
          height: hovering ? 28 : 8,
          opacity: hovering ? 0.35 : 0.9,
          boxShadow: "0 0 16px rgba(0,240,212,0.8)",
        }}
      />
      <div className="absolute left-0 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
    </div>
  );
}
