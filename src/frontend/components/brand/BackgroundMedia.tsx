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
  return (
    <div aria-hidden className={`pointer-events-none ${fixed ? "fixed" : "absolute"} inset-0 overflow-hidden`}>
      <video
        className="h-full w-full object-cover"
        style={{ filter: `brightness(${brightness})` }}
        autoPlay={!reduced}
        muted={muted}
        loop
        playsInline
        preload={preload}
      >
        <source src={src} type="video/mp4" />
      </video>
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
        style={{ filter: `brightness(${brightness})` }}
        loading="lazy"
      />
      <div className="absolute inset-0" style={{ background: overlay }} />
    </div>
  );
}
