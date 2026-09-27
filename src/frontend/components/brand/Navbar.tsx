"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
  { href: "/dashboard", label: "Forecast" },
  { href: "/replay", label: "Replay" },
  { href: "/sandbox", label: "Resilience" },
  { href: "/streamflush", label: "StreamFlush" },
  { href: "/report", label: "Report" },
  { href: "/alerts", label: "Alerts" },
  { href: "/fhir", label: "FHIR" },
  { href: "/scorecard", label: "Scorecard" },
  { href: "/about", label: "About" },
];

function BloomMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id="bc-bloom" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#7dffd4" />
          <stop offset="45%" stopColor="#00f0d4" />
          <stop offset="100%" stopColor="#00a382" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="29" fill="#02060f" stroke="rgba(0,240,212,0.5)" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="17" fill="url(#bc-bloom)" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(0,240,212,0.35)" strokeWidth="1" strokeDasharray="4 5" />
      <circle cx="32" cy="32" r="11" fill="rgba(255,255,255,0.25)" />
    </svg>
  );
}

export function Navbar() {
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 40);
      setHidden(y > lastY && y > 200 && !mobileOpen);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mobileOpen]);

  return (
    <>
      <motion.header
        animate={{ y: hidden ? "-100%" : "0%" }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled
            ? "backdrop-blur-xl bg-bg-abyss/80 border-b border-border-subtle"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <nav className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="BloomCast home">
            <BloomMark size={30} />
            <span className="font-display text-xl tracking-wide">
              BLOOM<span className="text-glow-cyan">CAST</span>
            </span>
          </Link>
          <div className="hidden lg:flex items-center gap-4 xl:gap-6">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[13px] xl:text-sm text-fg-secondary hover:text-glow-cyan transition-colors whitespace-nowrap"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="hidden sm:inline-flex px-4 py-2 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors"
            >
              View Dashboard
            </Link>
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden text-fg-primary p-2"
              aria-label="Open menu"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </nav>
      </motion.header>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-bg-abyss/95 backdrop-blur-xl flex flex-col items-center justify-center gap-6"
          >
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-5 right-6 text-fg-primary p-2"
              aria-label="Close menu"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {[{ href: "/", label: "Home" }, ...navItems].map((item, i) => (
              <motion.div
                key={item.href + item.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.05 }}
              >
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="font-display text-4xl tracking-wide text-fg-primary hover:text-glow-cyan transition"
                >
                  {item.label}
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
