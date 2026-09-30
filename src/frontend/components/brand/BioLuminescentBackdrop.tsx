"use client";

import { useEffect, useRef } from "react";

export function BioLuminescentBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const particles = Array.from({ length: reduce ? 40 : 120 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.8 + 0.4,
      s: Math.random() * 0.00035 + 0.00008,
      a: Math.random() * Math.PI * 2,
      hue: Math.random() > 0.82 ? 350 : 170,
    }));

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();

    // v3 M-V8: stop the loop while the tab is hidden. A backgrounded tab still
    // gets throttled rAF, but not enough to stop a 120-particle fullscreen
    // canvas from waking a laptop on battery. Pausing is free: the particles
    // keep their state and resume exactly where they stopped.
    let hidden = document.hidden;
    const drawFrame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.a += p.s * 18;
        p.x += Math.cos(p.a) * 0.00035;
        p.y += Math.sin(p.a * 0.7) * 0.00028 + p.s;
        if (p.y > 1.05) p.y = -0.05;
        if (p.x < -0.05) p.x = 1.05;
        if (p.x > 1.05) p.x = -0.05;
        const x = p.x * canvas.width;
        const y = p.y * canvas.height;
        const pulse = reduce ? 0.45 : 0.35 + Math.sin(performance.now() * 0.0015 + p.a) * 0.25;
        ctx.beginPath();
        ctx.fillStyle =
          p.hue > 300
            ? `rgba(255, 51, 85, ${pulse * 0.35})`
            : `rgba(0, 240, 212, ${pulse * 0.45})`;
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const tick = () => {
      if (!hidden) drawFrame();
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      hidden = document.hidden;
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-abyss" />
      <div className="bio-grid absolute inset-0 opacity-70" />
      <div
        className="absolute -left-24 top-[-10%] h-[52vh] w-[52vh] rounded-full bg-[radial-gradient(circle,rgba(0,240,212,0.16),transparent_64%)] blur-2xl animate-drift"
      />
      <div
        className="absolute right-[-12%] top-[20%] h-[46vh] w-[46vh] rounded-full bg-[radial-gradient(circle,rgba(0,180,255,0.12),transparent_64%)] blur-2xl animate-drift"
        style={{ animationDelay: "-4s" }}
      />
      <div
        className="absolute bottom-[-18%] left-[30%] h-[50vh] w-[50vh] rounded-full bg-[radial-gradient(circle,rgba(255,51,85,0.08),transparent_64%)] blur-2xl animate-drift"
        style={{ animationDelay: "-8s" }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-80" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-abyss/90" />
    </div>
  );
}
