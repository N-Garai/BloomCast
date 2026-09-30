"use client";

/**
 * Global error boundary (v3 M-V7) — the last line of defence.
 *
 * `global-error.tsx` replaces the entire document, so it cannot use the root
 * layout and the compiled stylesheet is not guaranteed to apply. It must render
 * its own <html>/<body>, and it inlines critical styles rather than importing
 * `ErrorRecovery` — that component's Tailwind classes would be unstyled here.
 *
 * This is the only boundary that can catch a failure in the root layout itself
 * (the loader, navigation, and background layers), which is why it exists
 * alongside the per-route boundaries rather than replacing them.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0, minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: "1.25rem",
          padding: "2rem", textAlign: "center", background: "#02060f",
          color: "#e6f0f5", fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <p
          style={{
            fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.7rem",
            letterSpacing: "0.35em", textTransform: "uppercase", color: "#ff3355", margin: 0,
          }}
        >
          Signal lost
        </p>
        <h1 style={{ fontSize: "clamp(1.75rem, 6vw, 3.5rem)", margin: 0, lineHeight: 1.1 }}>
          BloomCast hit an error
        </h1>
        <p style={{ maxWidth: "28rem", color: "#9fb3c0", margin: 0, lineHeight: 1.6 }}>
          The application shell failed to render. Retrying usually clears it. If it
          persists, reload the page.
        </p>
        {error?.digest && (
          <p style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.7rem", color: "#5d7382", margin: 0 }}>
            ref: {error.digest}
          </p>
        )}
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={reset}
            style={{
              height: "3rem", padding: "0 2rem", borderRadius: "0.75rem", border: "none",
              cursor: "pointer", fontWeight: 600, fontSize: "0.875rem",
              background: "linear-gradient(90deg, #00f0d4, #00ff88)", color: "#02060f",
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              height: "3rem", padding: "0 2rem", borderRadius: "0.75rem",
              border: "1px solid #1d2c3a", color: "#9fb3c0", fontSize: "0.875rem",
              display: "inline-flex", alignItems: "center", textDecoration: "none",
            }}
          >
            ← Return to surface
          </a>
        </div>
      </body>
    </html>
  );
}