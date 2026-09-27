"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Loader } from "@/components/brand/Loader";
import { BioLuminescentBackdrop } from "@/components/brand/BioLuminescentBackdrop";
import { StarfieldBackground } from "@/components/three/StarfieldBackground";
import { ScrollProgress } from "@/components/brand/ScrollProgress";
import { MagneticCursor } from "@/components/brand/MagneticCursor";
import { useKeepAlive } from "@/hooks/useKeepAlive";
import { useLenis } from "@/lib/useLenis";

/**
 * Should the intro curtain run? Read once, on the client only — SSR and the
 * first client render must agree, so nothing here may run during render.
 *
 * `prefers-reduced-motion` deliberately does NOT suppress the curtain. An
 * earlier version returned false on reduce-motion, which left those visitors
 * with a bare hero, no loading state and no "enter" affordance at all — the
 * one thing the curtain is for. The Loader now plays a calm, opacity-only
 * version of the same beats instead, so the preference is honoured by
 * removing motion, not information.
 *
 * `?intro=off` is a sticky opt-out and `?intro=on` forces the film back on
 * (clearing the opt-out). Both exist for QA and for visitors who want to
 * settle this once for the machine.
 */
function shouldBootLoader() {
  if (typeof window === "undefined") return false;
  try {
    const override = new URLSearchParams(window.location.search).get("intro");
    if (override === "off") {
      localStorage.setItem("bc-intro-off", "1");
      return false;
    }
    if (override === "on") {
      localStorage.removeItem("bc-intro-off");
      return true;
    }
    if (localStorage.getItem("bc-intro-off") === "1") return false;
  } catch {
    // Private mode or blocked storage: fall through to the session check.
  }
  try {
    return sessionStorage.getItem("bc-booted") !== "1";
  } catch {
    return true;
  }
}

// The curtain is decided *after* mount, never during render, so hydration can
// never mismatch; `useLayoutEffect` applies it before the first paint so the
// hero is never glimpsed behind the curtain.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(false);
  // "hidden" → "opening" (aperture animates) → "open" (clip-path dropped so
  // fixed-position descendants such as the Navbar stay fixed).
  // Server HTML ships "hidden": with JS not yet running there is no curtain to
  // hide behind, so the first paint must be the abyss, not a flash of the hero.
  const [revealed, setRevealed] = useState<"hidden" | "opening" | "open">("hidden");

  useIsoLayoutEffect(() => {
    if (shouldBootLoader()) {
      setBooting(true);
      setRevealed("hidden");
      return;
    }
    setRevealed("open");
  }, []);

  // Lenis stays off until the curtain is open.
  useLenis(!booting);
  useKeepAlive();

  // Scroll is locked while the curtain covers the page, so the gesture that
  // opens the gate cannot also drag the hero out of position.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("bc-scroll-lock", booting && revealed === "hidden");
    return () => root.classList.remove("bc-scroll-lock");
  }, [booting, revealed]);

  /** The gate opened: reveal the hero now, let the curtain finish exiting. */
  const handleEnter = useCallback(() => {
    try {
      sessionStorage.setItem("bc-booted", "1");
    } catch {}
    setRevealed("opening");
    window.scrollTo(0, 0);
  }, []);

  /** The exit finished: settle the page and drop the curtain. */
  const handleDone = useCallback(() => {
    setRevealed("open");
    setBooting(false);
  }, []);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      {/* With scripting off there is no curtain and no reveal animation, so
          the page must not stay hidden. Rendered via dangerouslySetInnerHTML
          because a <noscript> child is raw text in the parsed DOM. */}
      <noscript
        dangerouslySetInnerHTML={{
          __html:
            "<style>.bc-page{opacity:1!important;transform:none!important;" +
            "clip-path:none!important;-webkit-clip-path:none!important}</style>",
        }}
      />
      {booting && <Loader onEnter={handleEnter} onDone={handleDone} />}
      <ScrollProgress />
      <MagneticCursor />
      <StarfieldBackground />
      <BioLuminescentBackdrop />
      <main
        id="main"
        className="bc-page relative"
        data-revealed={revealed}
        aria-hidden={revealed === "hidden" ? true : undefined}
      >
        {children}
      </main>
    </div>
  );
}
