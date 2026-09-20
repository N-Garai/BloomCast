import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.35em] text-glow-cyan">Off the chart</p>
      <h1 className="font-display text-[26vw] md:text-[10rem] leading-none text-glow-cyan tabular">
        404
      </h1>
      <p className="font-body text-fg-secondary max-w-md">
        This waterbody doesn&apos;t exist. The current pulled you somewhere unmapped.
      </p>
      <Link
        href="/"
        className="group relative overflow-hidden inline-flex h-12 items-center px-8 rounded-xl bg-gradient-to-r from-glow-cyan to-glow-green text-bg-abyss font-semibold text-sm"
      >
        <span className="block transition-transform duration-300 group-hover:-translate-y-full">
          ← Return to surface
        </span>
        <span aria-hidden className="absolute inset-0 flex items-center justify-center translate-y-full transition-transform duration-300 group-hover:translate-y-0">
          ← Return to surface
        </span>
      </Link>
    </div>
  );
}
