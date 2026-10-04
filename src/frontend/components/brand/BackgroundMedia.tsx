"use client";

import { useEffect, useState } from "react";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

// Edge melt: the media itself fades to transparent
// across the top/bottom 12%, so adjacent sections crossfade instead of
// cutting with a hard strip — no matter what sits on either side.
const EDGE_MASK =
  "linear-gradient(180deg, transparent 0%, black 12%, black 88%, transparent 100%)";

function useVideoOk() {
  const [ok, setOk] = useState(true);
  return {
    ok,
    hide: () => setOk(false),
  };
}

/**
 * Full-bleed background video (local file, muted loop). Blends into the
 * page through a caller-supplied overlay gradient — every usage passes one
 * so section boundaries melt instead of cutting.
 */
export function VideoBackdrop({
  src,
  muted = true,
  brightness = 1,
  overlay = "linear-gradient(180deg, rgba(2,6,15,0.55) 0%, rgba(2,6,15,0.7) 50%, rgba(2,6,15,0.92) 100%)",
  fixed = false,
  preload = "metadata",
}: {
  src: string;
  muted?: boolean;
  brightness?: number;
  overlay?: string;
  fixed?: boolean;
  preload?: "auto" | "metadata" | "none";
}) {
  const reduced = useReducedMotion();
  const video = useVideoOk();
  return (
    <div aria-hidden className={`pointer-events-none ${fixed ? "fixed" : "absolute"} inset-0 overflow-hidden`}>
      {video.ok && (
        <video
          ref={(el) => {
            // React does not always apply the muted *property* (attribute
            // alone leaves Chrome blocking autoplay) — set it imperatively
            // and kick playback so backgrounds never sit black.
            if (el) {
              el.muted = muted;
              el.defaultMuted = muted;
              if (!reduced && el.paused) el.play().catch(() => {});
            }
          }}
          className="h-full w-full object-cover"
          style={{
            filter: `brightness(${brightness})`,
            maskImage: EDGE_MASK,
            WebkitMaskImage: EDGE_MASK,
          }}
          autoPlay={!reduced}
          muted={muted}
          loop
          playsInline
          preload={preload}
          onError={video.hide}
        >
          <source src={src} type="video/mp4" />
        </video>
      )}
      <div className="absolute inset-0" style={{ background: overlay }} />
    </div>
  );
}

/**
 * Full-bleed background image (local file). Same overlay contract as video.
 */
export function ImageBackdrop({
  src,
  brightness = 1,
  overlay = "linear-gradient(180deg, rgba(2,6,15,0.72) 0%, rgba(2,6,15,0.82) 55%, rgba(2,6,15,0.94) 100%)",
}: {
  src: string;
  brightness?: number;
  overlay?: string;
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        style={{
          filter: `brightness(${brightness})`,
          maskImage: EDGE_MASK,
          WebkitMaskImage: EDGE_MASK,
        }}
        loading="lazy"
      />
      <div className="absolute inset-0" style={{ background: overlay }} />
    </div>
  );
}
