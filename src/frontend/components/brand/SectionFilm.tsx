"use client";

import { type ReactNode } from "react";

const FILMS: Record<string, { src: string; overlay: string }> = {
  abyss: {
    src: "https://videos.pexels.com/video-files/854141/854141-hd_1920_1080_30fps.mp4",
    overlay:
      "linear-gradient(180deg, rgba(7,10,14,0.35) 0%, rgba(7,10,14,0.72) 55%, rgba(7,10,14,0.94) 100%)",
  },
  caustic: {
    src: "https://videos.pexels.com/video-files/1409899/1409899-uhd_2560_1440_25fps.mp4",
    overlay:
      "linear-gradient(180deg, rgba(4,18,22,0.55) 0%, rgba(4,18,22,0.78) 100%)",
  },
  aerial: {
    src: "https://videos.pexels.com/video-files/3571264/3571264-uhd_2560_1440_30fps.mp4",
    overlay:
      "linear-gradient(90deg, rgba(8,16,12,0.82) 0%, rgba(8,16,12,0.45) 50%, rgba(8,16,12,0.82) 100%)",
  },
  night: {
    src: "https://videos.pexels.com/video-files/1093662/1093662-hd_1920_1080_30fps.mp4",
    overlay:
      "linear-gradient(180deg, rgba(10,8,16,0.7) 0%, rgba(10,8,16,0.88) 100%)",
  },
  storm: {
    src: "https://videos.pexels.com/video-files/2169880/2169880-uhd_2560_1440_30fps.mp4",
    overlay:
      "linear-gradient(180deg, rgba(12,10,8,0.55) 0%, rgba(12,10,8,0.86) 100%)",
  },
};

export function SectionFilm({
  film = "abyss",
  children,
  className = "",
}: {
  film?: keyof typeof FILMS;
  children: ReactNode;
  className?: string;
}) {
  const f = FILMS[film];
  return (
    <section className={`relative overflow-hidden ${className}`}>
      <div className="pointer-events-none absolute inset-0 -z-10">
        <video
          className="absolute inset-0 h-full w-full scale-110 object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        >
          <source src={f.src} type="video/mp4" />
        </video>
        <div className="absolute inset-0" style={{ background: f.overlay }} />
        <div className="film-grain absolute inset-0 opacity-40" />
      </div>
      {children}
    </section>
  );
}
