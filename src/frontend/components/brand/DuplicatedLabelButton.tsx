"use client";

import Link from "next/link";

export function DuplicatedLabelButton({
  href,
  label,
  variant = "primary",
  className = "",
}: {
  href: string;
  label: string;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-gradient-to-r from-glow-cyan to-glow-green text-bg-abyss font-semibold hover:shadow-glow-md"
      : "glass border border-border-subtle text-fg-primary hover:border-glow-cyan/50";

  return (
    <Link
      href={href}
      className={`group relative overflow-hidden inline-flex h-12 items-center justify-center px-8 rounded-xl text-sm tracking-wide transition-all ${styles} ${className}`}
    >
      {/* Rolling label: a one-line window; the two-line column slides up by
          exactly one line on hover. The old version translated each span by
          its own height inside a 48px box, so both lines stayed visible. */}
      <span className="block h-[1.5em] overflow-hidden leading-[1.5em]">
        <span className="flex flex-col transition-transform duration-300 group-hover:-translate-y-1/2 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
          <span className="block">{label}</span>
          <span aria-hidden className="block">{label}</span>
        </span>
      </span>
    </Link>
  );
}
