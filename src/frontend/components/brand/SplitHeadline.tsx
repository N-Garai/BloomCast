"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

export function SplitHeadline({
  text,
  className = "",
  as: Tag = "h2",
}: {
  text: string;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const words = text.split(" ");

  return (
    <Tag ref={ref} className={`split-headline ${className}`}>
      {words.map((word, wi) => (
        <span key={`${word}-${wi}`} className="inline-block overflow-hidden pb-[0.12em] pr-[0.28em] align-bottom">
          <motion.span
            className="inline-block"
            initial={{ y: "110%", rotateX: -40, opacity: 0 }}
            animate={inView ? { y: "0%", rotateX: 0, opacity: 1 } : undefined}
            transition={{
              duration: 0.7,
              delay: wi * 0.045,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}
