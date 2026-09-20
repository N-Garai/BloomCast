"use client";

import { API } from "@/lib/api";

/**
 * "See Like the Satellite" (§7.2/§9.5): NDCI red-edge explainer with a
 * per-waterbody false-color chip and a teal→magenta legend. The chip is a
 * stylized visualization rendered from the latest NDCI value, not raw
 * satellite imagery.
 */
export function NdciExplainer({ waterbodyId, waterbodyName }: { waterbodyId: string | null; waterbodyName?: string }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-fg-muted mb-2">
        See like the satellite
      </h3>
      {waterbodyId ? (
        <div className="rounded-xl overflow-hidden border border-border-subtle">
          <img
            key={waterbodyId}
            src={`${API}/v1/forecast/${waterbodyId}/chip`}
            alt={waterbodyName ? `NDCI snapshot for ${waterbodyName}` : "NDCI snapshot chip"}
            className="w-full h-28 object-cover"
            loading="lazy"
          />
          <div className="p-3 bg-bg-deep/60">
            <div
              className="h-2 rounded-full"
              style={{
                background: "linear-gradient(90deg, #0e4d5c, #00f0d4 35%, #7dffd4 55%, #ff3df0 80%, #ff00aa)",
              }}
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-fg-muted">
              <span>low NDCI</span>
              <span>high NDCI</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-fg-faint">Select a waterbody to see its NDCI snapshot.</p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
        <span className="font-mono text-fg-secondary">NDCI = (B05 − B04) / (B05 + B04)</span>
        <br />
        Sentinel-2&apos;s red-edge band B05 (705&nbsp;nm) catches chlorophyll-a where
        normal vegetation indices go blind. A rising NDCI is the satellite watching
        a bloom assemble — days before eyes on the shore can see it.
      </p>
    </div>
  );
}
