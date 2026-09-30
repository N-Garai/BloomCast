"use client";

import { ErrorRecovery } from "@/components/ui/ErrorRecovery";

/**
 * Route-level error boundary for `streamflush` (v3 M-V7). Without this, any render
 * error here fell through to the unstyled Next.js crash page with no retry.
 * `reset` re-renders the segment without a full page load.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorRecovery digest={error?.digest} onRetry={reset} />;
}