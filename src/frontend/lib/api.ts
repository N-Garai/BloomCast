/**
 * Single source of truth for the backend base URL.
 *
 * NEXT_PUBLIC_API_BASE is either "" (same-origin, production on Render where
 * FastAPI serves both /v1/* and the static frontend) or a full origin in dev
 * (e.g. "http://localhost:8000").
 *
 * Usage: fetch(`${API}/v1/waterbodies?limit=25`)
 *   prod -> "/v1/waterbodies?limit=25"  (same origin, no double prefix)
 *   dev  -> "http://localhost:8000/v1/waterbodies?limit=25"
 */
export const API = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}
