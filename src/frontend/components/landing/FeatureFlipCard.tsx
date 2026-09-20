"use client";

import { useState } from "react";
import { motion } from "framer-motion";

export function FeatureFlipCard({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div
      className="relative h-72 cursor-pointer"
      style={{ perspective: "1200px" }}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
      onClick={() => setFlipped((f) => !f)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setFlipped((f) => !f);
      }}
      aria-label={title}
    >
      <motion.div
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        className="relative h-full w-full preserve-3d"
        style={{ transformStyle: "preserve-3d" }}
      >
        <div
          className="absolute inset-0 glass-card rounded-2xl p-6 flex flex-col justify-between overflow-hidden"
          style={{ backfaceVisibility: "hidden" }}
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-glow-cyan/50 to-transparent" />
          <div className="text-3xl">{icon}</div>
          <div>
            <h3 className="font-display text-2xl font-semibold tracking-wide text-fg-primary">{title}</h3>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-faint">
              Hover to reveal
            </p>
          </div>
        </div>
        <div
          className="absolute inset-0 rounded-2xl p-6 flex flex-col justify-between border border-glow-cyan/30 bg-bg-elevated/90 overflow-hidden"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-glow-cyan/15 via-transparent to-glow-magenta/10" />
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-glow-cyan/15 blur-2xl animate-pulse" />
          <div className="relative">
            <h3 className="font-display text-xl font-semibold text-glow-cyan tracking-wide">{title}</h3>
            <p className="mt-3 text-sm text-fg-secondary leading-relaxed">{body}</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
