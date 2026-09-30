"use client";

import { API } from "@/lib/api";

export interface WaterbodyOption {
  id: string;
  name: string;
  region: string;
  country: string;
  centroid: [number, number] | null;
  /** lake | river | reservoir | estuary | stream — drives alert presets (v3 M-V9). */
  type?: string;
}

let cached: WaterbodyOption[] | null = null;
let inflight: Promise<WaterbodyOption[]> | null = null;

function toOption(feature: any): WaterbodyOption | null {
  const properties = feature?.properties ?? {};
  if (!properties.id) return null;
  const geometry = feature?.geometry;
  const centroid = properties.centroid ?? geometry?.coordinates ?? null;
  const valid =
    Array.isArray(centroid) &&
    Number.isFinite(centroid[0]) &&
    Number.isFinite(centroid[1]);
  return {
    id: String(properties.id),
    name: String(properties.name ?? properties.id),
    region: String(properties.region ?? ""),
    country: String(properties.country ?? ""),
    centroid: valid ? [Number(centroid[0]), Number(centroid[1])] : null,
    type: properties.type ? String(properties.type) : undefined,
  };
}

/**
 * Shared pilot-waterbody directory (id → display name + validated centroid).
 * Fetched once per page load and cached module-wide. Centroids that are
 * missing or non-finite come back null so callers can never plot a
 * (0, 0) Null Island marker.
 */
export function getWaterbodies(): Promise<WaterbodyOption[]> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch(`${API}/v1/waterbodies?limit=100`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const features = data.data ?? data.features ?? [];
        const options = (Array.isArray(features) ? features : [])
          .map(toOption)
          .filter((option): option is WaterbodyOption => option !== null);
        cached = options;
        return options;
      })
      .catch(() => [])
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function waterbodyName(list: WaterbodyOption[], id: string): string {
  return list.find((item) => item.id === id)?.name ?? id;
}
