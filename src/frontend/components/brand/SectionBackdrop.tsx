const TONES = {
  cyan: { a: "rgba(0,240,212,0.15)", b: "rgba(0,140,255,0.10)" },
  orange: { a: "rgba(255,136,0,0.13)", b: "rgba(255,51,85,0.09)" },
  violet: { a: "rgba(139,92,246,0.17)", b: "rgba(0,240,212,0.08)" },
  magenta: { a: "rgba(255,0,170,0.11)", b: "rgba(139,92,246,0.13)" },
} as const;

export type BackdropTone = keyof typeof TONES;

/**
 * Self-contained animated section background. Pure CSS/canvas-free motion
 * (drifting gradient orbs + grid + grain) so every section stays alive even
 * when the remote film clip is blocked or still buffering. Edge fades melt
 * each section into the abyss background for seamless joints.
 */
export function SectionBackdrop({ tone = "cyan" }: { tone?: BackdropTone }) {
  const t = TONES[tone];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute inset-0 bg-bg-abyss" />
      <div
        className="absolute -left-[10%] top-[-20%] h-[60vh] w-[60vh] rounded-full blur-3xl animate-orb-a"
        style={{ background: `radial-gradient(circle, ${t.a}, transparent 65%)` }}
      />
      <div
        className="absolute right-[-10%] bottom-[-25%] h-[65vh] w-[65vh] rounded-full blur-3xl animate-orb-b"
        style={{ background: `radial-gradient(circle, ${t.b}, transparent 65%)` }}
      />
      <div className="bio-grid absolute inset-0 opacity-50" />
      {/* Melt top + bottom edges into the page background */}
      <div className="absolute inset-0 bg-gradient-to-b from-bg-abyss via-transparent to-bg-abyss" />
      <div className="film-grain absolute inset-0 opacity-30" />
    </div>
  );
}
