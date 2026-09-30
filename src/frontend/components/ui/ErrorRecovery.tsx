"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Shared recovery UI for route error boundaries (v3 M-V7).
 *
 * Next.js error boundaries only catch errors thrown during render, so a failed
 * fetch chain in a client component lands here rather than on the unstyled
 * crash page. "Try again" calls `reset`, which re-renders the segment without a
 * full page load, so a transient upstream failure does not cost the demo its
 * scroll position or its intro state.
 *
 * The digest is shown because it is the only handle a user can quote when
 * reporting a failure; the raw message is not shown in production because a
 * thrown upstream URL or key would otherwise leak through the error page.
 */
export function ErrorRecovery({
  title,
  message,
  digest,
  onRetry,
}: {
  title?: string;
  message?: string;
  digest?: string;
  onRetry: () => void;
}) {
  useEffect(() => {
    // Next.js already logs the error; repeating it with context makes the
    // failure obvious in a console during a demo.
    console.error("[bloomcast] route error boundary caught", message, digest ?? "");
  }, [message, digest]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.35em] text-glow-red">
        This panel hit a snag
      </p>
      <h1 className="font-display text-4xl md:text-6xl leading-tight text-fg-primary">
        {title ?? "Something went wrong"}
      </h1>
      <p className="font-body text-fg-secondary max-w-md">
        {message ??
          "This section failed to render. The rest of BloomCast is unaffected â€” retry, or head back to the surface."}
      </p>
      {digest && (
        <p className="font-mono text-[11px] text-fg-faint">ref: {digest}</p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={onRetry}
          className="group relative overflow-hidden inline-flex h-12 items-center px-8 rounded-xl bg-gradient-to-r from-glow-cyan to-glow-green text-bg-abyss font-semibold text-sm"
        >
          <span className="block transition-transform duration-300 group-hover:-translate-y-full">
            Try again
          </span>
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center translate-y-full transition-transform duration-300 group-hover:translate-y-0"
          >
            Try again
          </span>
        </button>
        <Link
          href="/"
          className="inline-flex h-12 items-center px-8 rounded-xl border border-border-subtle text-fg-secondary text-sm hover:border-glow-cyan hover:text-glow-cyan transition-colors"
        >
          â† Return to surface
        </Link>
      </div>
    </div>
  );
}

