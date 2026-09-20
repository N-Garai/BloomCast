"use client";

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-2xl border border-glow-red/40 bg-glow-red/5 p-6 text-center"
      role="alert"
    >
      <p className="font-display text-xl font-semibold text-glow-red">Couldn&apos;t load data</p>
      <p className="mt-2 font-mono text-xs text-fg-secondary break-all">{message}</p>
      <p className="mt-2 text-sm text-fg-muted">
        Check your connection — the forecast service may be waking up. Retrying usually works within a minute.
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-5 py-2.5 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
