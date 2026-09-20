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
      <span className="block transition-transform duration-300 group-hover:-translate-y-full">
        {label}
      </span>
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center translate-y-full transition-transform duration-300 group-hover:translate-y-0"
      >
        {label}
      </span>
    </Link>
  );
}
