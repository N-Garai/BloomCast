"use client";

/**
 * Browser-direct Open-Meteo fetch — the shared-IP throttle escape hatch.
 *
 * Render's free tier funnels every visitor through a handful of egress IPs,
 * so Open-Meteo throttles the *server* no matter how polite each request is.
 * api.open-meteo.com answers browsers directly (CORS: *) with a keyless
 * fair-use quota per visitor IP, so when the server path 429s the browser
 * fetches the same two payloads itself and posts them to POST /v1/infer/score
 * for identical scoring. Params mirror ingestion/openmeteo_client.py exactly.
 */

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

const HOURLY_VARS = [
  "temperature_2m",
  "relativehumidity_2m",
  "dewpoint_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "precipitation",
  "shortwave_radiation",
  "cloud_cover",
  "pressure_msl",
  "soil_temperature_0cm",
  "temperature_80m",
  "wind_speed_80m",
].join(",");

// The archive endpoint rejects the two forecast-model-only variables.
const ARCHIVE_VARS = [
  "temperature_2m",
  "relativehumidity_2m",
  "dewpoint_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "precipitation",
  "shortwave_radiation",
  "cloud_cover",
  "pressure_msl",
].join(",");

export interface ClientWindows {
  window: any;
  archive: any | null;
}

function params(payload: Record<string, string | number>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) search.set(key, String(value));
  return search.toString();
}

async function getJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  return response.json();
}

/**
 * Fetch both payloads with the visitor's IP quota. The archive is best
 * effort (the backend degrades to "unavailable" baseline without it) but
 * the window is required — without it there is nothing to score.
 */
export async function fetchClientWindows(lat: number, lon: number, signal?: AbortSignal): Promise<ClientWindows> {
  const base = {
    latitude: lat,
    longitude: lon,
    timezone: "UTC",
    temperature_unit: "celsius",
    wind_speed_unit: "ms",
    precipitation_unit: "mm",
  };
  const windowPromise = getJson(
    `${FORECAST_URL}?${params({ ...base, hourly: HOURLY_VARS, forecast_days: 7, past_days: 3 })}`,
    signal
  );
  const archivePromise = getJson(
    `${ARCHIVE_URL}?${params({ ...base, hourly: ARCHIVE_VARS, past_days: 30 })}`,
    signal
  ).catch(() => null);
  const [window, archive] = await Promise.all([windowPromise, archivePromise]);
  return { window, archive };
}

/** Post browser-fetched payloads for server-side scoring (zero upstream). */
export async function scoreClientWindows(api: string, lat: number, lon: number, windows: ClientWindows, signal?: AbortSignal) {
  const response = await fetch(`${api}/v1/infer/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: lat, longitude: lon, window: windows.window, archive: windows.archive }),
    signal,
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data?.error ?? data?.detail ?? `HTTP ${response.status}`);
  return data;
}
