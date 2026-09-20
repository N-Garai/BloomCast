"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

/**
 * Click-to-pick world map (dark CARTO tiles, no API key). A click drops a
 * glowing marker and reports lat/lon to the parent, which fills the inputs
 * and runs the live assessment automatically.
 */
export function LocationMap({
  onPick,
}: {
  onPick: (lat: number, lon: number) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !divRef.current || mapRef.current) return;
      const map = L.map(divRef.current, {
        center: [28, 8],
        zoom: 2,
        minZoom: 2,
        maxZoom: 12,
        worldCopyJump: true,
        zoomControl: true,
      });
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 20,
        }
      ).addTo(map);
      map.on("click", (e: any) => {
        const { lat, lng } = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng(e.latlng);
        } else {
          markerRef.current = L.circleMarker(e.latlng, {
            radius: 8,
            color: "#00f0d4",
            weight: 2,
            fillColor: "#00f0d4",
            fillOpacity: 0.5,
          }).addTo(map);
        }
        pickRef.current(
          Math.round(lat * 1000) / 1000,
          Math.round(lng * 1000) / 1000
        );
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={divRef}
        className="h-64 w-full rounded-xl border border-border-subtle overflow-hidden z-0"
        style={{ background: "#02060f" }}
      />
      <p className="mt-1.5 text-[11px] font-mono text-fg-faint">
        Click anywhere on the map — coordinates fill in and the live check runs.
      </p>
    </div>
  );
}
