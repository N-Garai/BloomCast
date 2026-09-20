"use client";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16" role="status" aria-live="polite">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 rounded-full border border-glow-cyan/20" />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "conic-gradient(from 0deg, rgba(0,240,212,0.9), transparent 35%, transparent 100%)",
            maskImage: "radial-gradient(circle, transparent 55%, black 56%)",
            WebkitMaskImage: "radial-gradient(circle, transparent 55%, black 56%)",
            animation: "spin 1.1s linear infinite",
          }}
        />
        <div className="absolute inset-[18px] rounded-full bg-glow-cyan/25 blur-[6px] animate-pulse" />
      </div>
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-fg-muted">{label}…</p>
    </div>
  );
}
