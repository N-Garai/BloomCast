"use client";

import { useState, type ReactNode } from "react";
import { SectionBackdrop, type BackdropTone } from "@/components/brand/SectionBackdrop";

const POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'%3E%3Cdefs%3E%3CradialGradient id='g' cx='50%25' cy='45%25' r='70%25'%3E%3Cstop offset='0%25' stop-color='%23083344'/%3E%3Cstop offset='55%25' stop-color='%2302060f'/%3E%3Cstop offset='100%25' stop-color='%2302060f'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23g)'/%3E%3C/svg%3E";

const FILMS: Record<string, { src: string; overlay: string }> = {
  abyss: {
    src: "https://videos.pexels.com/video-files/854141/854141-hd_1920_1080_30fps.mp4",
    overlay:
      "linear-gradient(180deg, rgba(2,6,15,0.55) 0%, rgba(2,6,15,0.78) 55%, rgba(2,6,15,0.94) 100%)",
  },
  caustic: {
    src: "https://videos.pexels.com/video-files/1409899/1409899-uhd_2560_1440_25fps.mp4",
    overlay:
      "linear-gradient(180deg, rgba(2,6,15,0.45) 0%, rgba(2,6,15,0.68) 100%)",
  },
  aerial: {
    src: "https://videos.pexels.com/video-files/3571264/3571264-uhd_2560_1440_30fps.mp4",
    overlay:
      "linear-gradient(90deg, rgba(2,6,15,0.85) 0%, rgba(2,6,15,0.55) 50%, rgba(2,6,15,0.85) 100%)",
  },
  night: {
    src: "https://videos.pexels.com/video-files/1093662/1093662-hd_1920_1080_30fps.mp4",
    overlay:
      "linear-gradient(180deg, rgba(2,6,15,0.55) 0%, rgba(2,6,15,0.75) 100%)",
  },
  storm: {
    src: "https://videos.pexels.com/video-files/2169880/2169880-uhd_2560_1440_30fps.mp4",
    overlay:
      "linear-gradient(180deg, rgba(2,6,15,0.6) 0%, rgba(2,6,15,0.88) 100%)",
  },
};

const FILM_TONES: Record<string, BackdropTone> = {
  abyss: "cyan",
  caustic: "violet",
  aerial: "cyan",
  night: "magenta",
  storm: "orange",
};

export function SectionFilm({
  film = "abyss",
  children,
  className = "",
  videoOpacity = 0.45,
}: {
  film?: keyof typeof FILMS;
  children: ReactNode;
  className?: string;
  videoOpacity?: number;
}) {
  const f = FILMS[film];
  const [videoOk, setVideoOk] = useState(true);

  return (
    <section className={`section-fade relative overflow-hidden ${className}`}>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {/* Animated gradient base — always alive, even if the clip is blocked */}
        <SectionBackdrop tone={FILM_TONES[film] ?? "cyan"} />
        {videoOk && (
          <video
            className="absolute inset-0 h-full w-full scale-105 object-cover mix-blend-screen"
            style={{ opacity: videoOpacity }}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={POSTER}
            onError={() => setVideoOk(false)}
          >
            <source src={f.src} type="video/mp4" />
          </video>
        )}
        <div className="absolute inset-0" style={{ background: f.overlay }} />
        <div className="film-grain absolute inset-0 opacity-40" />
      </div>
      <div className="relative">{children}</div>
    </section>
  );
}
