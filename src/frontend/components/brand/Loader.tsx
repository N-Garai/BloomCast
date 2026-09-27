"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";

/**
 * BloomCast intro curtain — a five-act boot film, ~5.6s to the reveal gate.
 *
 * Motion-design brief
 * ───────────────────
 * The theme is a bloom igniting in deep water: bioluminescent cyan rising
 * through an abyss, graded toward seafoam and warm chlorophyll amber. Nothing
 * is radar-like — the references were the type-led, mask-reveal intros of
 * Zentry and the punctuated shutdown of ChronoCut, re-scored for water.
 *
 *   Act 1 · DEEP      abyss, grain, drifting caustics, a single cyan seed
 *   Act 2 · IGNITION  the mark blooms in, rings echo outward, horizon drawn
 *   Act 3 · ANALYSIS  "BLOOMCAST" cascades glyph by glyph while the live read
 *                     runs: NDCI trace, scan sweep, pipeline log, counter
 *   Act 4 · TYPE      "SEE IT / COMING." fills the frame, then collapses
 *   Act 5 · SETTLE    flash, lockup resolves, the gate opens
 *
 * Then the curtain waits. The last beat is a scroll gate: the film ends on
 * SCROLL TO ENTER and only a scroll/swipe/key/click opens the iris onto the
 * hero. An impatient gesture early compresses the remaining film (timeScale)
 * instead of cutting it, so a skip still lands on designed frames.
 *
 * Precision notes
 * ───────────────
 * • One paused GSAP timeline, absolute positions, `expo.out` entrances and
 *   `power*.in` exits — the timing curve the reference intros use.
 * • React never re-renders per frame: the counter is written by `onUpdate`
 *   straight to the DOM.
 * • Every layer is laid out up front and only animated, so nothing reflows.
 * • Fail-safes: reduced motion skips to the gate, a 22s watchdog reveals
 *   anyway, and the page-side reveal is a CSS transition so it finishes even
 *   if this component unmounts mid-iris.
 */

/** Absolute timeline positions (seconds). The gate arms at `arm`. */
const ACT = {
  deep: 0.0,
  seed: 0.12,
  hud: 0.2,
  horizon: 0.32,
  ignite: 0.55,
  echo: 0.6,
  horizonOut: 0.95,
  wordmark: 1.25,
  sub: 1.95,
  ndci: 2.05,
  sweep: 2.2,
  log: 2.35,
  logStagger: 0.25,
  counter: 3.0,
  counterDur: 2.1,
  collapse: 3.15,
  sloganL1: 3.35,
  sloganL2: 3.85,
  flare: 4.15,
  typeOut: 4.55,
  flash: 4.78,
  lockup: 4.98,
  gate: 5.3,
  arm: 5.6,
  hint: 8.4,
} as const;

const WORDMARK = "BLOOMCAST";
const SLOGAN_L1 = "SEE IT";
const SLOGAN_L2 = "COMING.";
const SLOGAN_SERIF = "See it coming.";

const LOG_LINES = [
  "aligning orbital sensors",
  "fusing 14-day weather ensemble",
  "scoring stream wash-off risk",
  "calibrating bloom probability",
];

const WATCHDOG_MS = 22000;

/** Split a string into per-glyph masks so letters can rise from below. */
function SplitChars({
  text,
  className = "",
  charClassName = "",
}: {
  text: string;
  className?: string;
  charClassName?: string;
}) {
  return (
    <span className={className}>
      {Array.from(text).map((ch, i) => (
        <span key={`${ch}-${i}`} className="bcl-mask">
          <span className={`bcl-char ${charClassName}`}>
            {ch === " " ? "\u00A0" : ch}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * The app mark. Geometry matches `public/favicon.svg` (same radii, dashes and
 * gradients) with namespaced gradient ids so it can coexist with the Navbar's
 * copy of the same artwork.
 */
function BloomMark({ className = "", size = 96 }: { className?: string; size?: number }) {
  return (
    <svg
      className={`bcl-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
    >
      <defs>
        <radialGradient id="bcl-core-g" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#7dffd4" />
          <stop offset="45%" stopColor="#00f0d4" />
          <stop offset="100%" stopColor="#00a382" />
        </radialGradient>
        <radialGradient id="bcl-halo-g" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00f0d4" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#00f0d4" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="bcl-halo" cx="32" cy="32" r="28" fill="url(#bcl-halo-g)" />
      <circle
        className="bcl-dash"
        cx="32"
        cy="32"
        r="24"
        fill="none"
        stroke="#00f0d4"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeDasharray="4 5"
      />
      <circle className="bcl-core" cx="32" cy="32" r="16" fill="url(#bcl-core-g)" />
      <circle cx="27" cy="27" r="5" fill="#ffffff" opacity="0.35" />
    </svg>
  );
}

export function Loader({
  onEnter,
  onDone,
}: {
  /** Fired the instant the user opens the gate — the page starts revealing. */
  onEnter: () => void;
  /** Fired when the exit choreography has fully finished; safe to unmount. */
  onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const exitTlRef = useRef<gsap.core.Timeline | null>(null);
  const armedRef = useRef(false);
  const exitedRef = useRef(false);
  const finishedRef = useRef(false);
  const pendingRef = useRef(false);
  const compressedRef = useRef(false);
  const enterRef = useRef(onEnter);
  const doneRef = useRef(onDone);
  enterRef.current = onEnter;
  doneRef.current = onDone;

  const [armed, setArmed] = useState(false);

  /** The exit: stage bursts, the shutter bloom closes to a point, then unmount. */
  const reveal = useCallback(() => {
    const root = rootRef.current;
    if (!root || exitedRef.current || finishedRef.current) return;
    exitedRef.current = true;
    armedRef.current = false;
    // The film stops the instant the gate opens — the exit owns the frame.
    tlRef.current?.pause();
    enterRef.current();

    const q = gsap.utils.selector(root);
    exitTlRef.current = gsap
      .timeline({
        onComplete: () => {
          finishedRef.current = true;
          doneRef.current();
        },
      })
      .to(q(".bcl-stage"), {
        scale: 1.07,
        opacity: 0,
        filter: "blur(7px)",
        duration: 0.5,
        ease: "power2.in",
      }, 0)
      .to(q(".bcl-echo"), { scale: 3.8, opacity: 0, duration: 0.85, stagger: 0.07 }, 0)
      .to(q(".bcl-hud"), { opacity: 0, duration: 0.3 }, 0)
      .to(q(".bcl-flash"), { opacity: 0.55, duration: 0.22 }, 0.04)
      .to(q(".bcl-flash"), { opacity: 0, duration: 0.42 }, 0.28)
      .to(root, {
        clipPath: "circle(0% at 50% 50%)",
        WebkitClipPath: "circle(0% at 50% 50%)",
        duration: 0.95,
        ease: "power3.inOut",
      }, 0.24)
      .set(root, { autoAlpha: 0 });
  }, []);

  /** One gesture entry point, shared by wheel / swipe / key / click. */
  const requestEnter = useCallback(() => {
    if (finishedRef.current) return;
    pendingRef.current = true;
    const tl = tlRef.current;
    if (!tl || armedRef.current) {
      reveal();
      return;
    }
    // Before the gate: fast-forward the remaining film rather than cut it, so
    // an impatient scroll still resolves through every designed frame.
    if (!compressedRef.current) {
      compressedRef.current = true;
      if (tl.timeScale() < 1.5) tl.timeScale(2.6);
    }
  }, [reveal]);

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── The film ────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (reduced) {
      armedRef.current = true;
      reveal();
      return;
    }

    const q = gsap.utils.selector(root);
    const counter = { v: 0 };
    const countEl = q(".bcl-count")[0] as HTMLElement | undefined;
    const barEl = q(".bcl-bar-fill")[0] as HTMLElement | undefined;
    const writeCounter = () => {
      if (countEl) countEl.textContent = String(Math.round(counter.v)).padStart(3, "0");
      if (barEl) barEl.style.transform = `scaleX(${Math.min(1, counter.v / 100)})`;
    };
    writeCounter();

    // Explicit initial states — nothing here waits on immediateRender
    // semantics of a paused timeline, so the first painted frame is correct.
    gsap.set(q(".bcl-caustic"), { opacity: 0.2 });
    gsap.set(q(".bcl-caustic-b"), { opacity: 0.2 });
    gsap.set(q(".bcl-seed"), { opacity: 0, scale: 0 });
    gsap.set(q(".bcl-hud"), { opacity: 0 });
    gsap.set(q(".bcl-horizon-l"), { scaleX: 0 });
    gsap.set(q(".bcl-horizon-r"), { scaleX: 0 });
    gsap.set(q(".bcl-mark"), { opacity: 0, scale: 0.55, filter: "blur(10px)" });
    gsap.set(q(".bcl-halo"), { opacity: 0 });
    gsap.set(q(".bcl-echo"), { opacity: 0 });
    gsap.set(q(".bcl-wordmark .bcl-char"), { yPercent: 118, opacity: 0, rotateX: -72 });
    gsap.set(q(".bcl-sub"), { opacity: 0, clipPath: "inset(0 100% 0 0)" });
    gsap.set(q(".bcl-live-dot"), { scale: 0, opacity: 0 });
    gsap.set(q(".bcl-ndci"), { opacity: 0, y: 8 });
    gsap.set(q(".bcl-ndci-path"), { strokeDashoffset: 1 });
    gsap.set(q(".bcl-scan"), { x: "-4vw", opacity: 0 });
    gsap.set(q(LOG_LINES.map((_, i) => `.bcl-log-${i}`).join(",")), { opacity: 0, x: -14 });
    gsap.set(q(".bcl-counter"), { opacity: 0, y: 14 });
    gsap.set(q(".bcl-sigil"), { y: 58 });
    gsap.set(q(".bcl-bloom"), { opacity: 0, scale: 0.4 });
    gsap.set(q(".bcl-type"), { opacity: 0 });
    gsap.set(q(".bcl-slogan-l1 .bcl-char"), { yPercent: 118, opacity: 0, rotateX: -68 });
    gsap.set(q(".bcl-slogan-l2 .bcl-char"), { yPercent: 118, opacity: 0, rotateX: -68 });
    gsap.set(q(".bcl-lockup"), { opacity: 0, scale: 0.94, filter: "blur(6px)" });
    gsap.set(q(".bcl-lockup-mark"), { scale: 0.6, opacity: 0 });
    gsap.set(q(".bcl-slogan-serif .bcl-char"), { yPercent: 120, opacity: 0 });
    gsap.set(q(".bcl-gate"), { opacity: 0, y: 16 });
    gsap.set(q(".bcl-hint"), { opacity: 0 });

    const tl = gsap.timeline({ paused: true, defaults: { ease: "expo.out" } });
    tlRef.current = tl;

    // ── Act 1 · DEEP ──────────────────────────────────────────────────────
    tl.to(q(".bcl-caustic"), { opacity: 1, duration: 1.6, ease: "power2.out" }, ACT.deep)
      .to(q(".bcl-caustic-b"), { opacity: 1, duration: 1.8, ease: "power2.out" }, ACT.deep + 0.15)
      .fromTo(q(".bcl-seed"),
        { opacity: 0, scale: 0 },
        { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2.4)" }, ACT.seed)
      .fromTo(q(".bcl-hud"), { opacity: 0, y: -10 },
        { opacity: 1, y: 0, duration: 0.7 }, ACT.hud)
      .fromTo(q(".bcl-horizon-l"), { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power3.inOut" }, ACT.horizon)
      .fromTo(q(".bcl-horizon-r"), { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power3.inOut" }, ACT.horizon)

      // ── Act 2 · IGNITION ────────────────────────────────────────────────
      .fromTo(q(".bcl-mark"),
        { opacity: 0, scale: 0.55, filter: "blur(10px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.8, ease: "back.out(1.7)" }, ACT.ignite)
      .to(q(".bcl-seed"), { opacity: 0, scale: 2.4, duration: 0.35, ease: "power2.out" }, ACT.ignite + 0.08)
      .fromTo(q(".bcl-dash"), { rotation: -105, transformOrigin: "50% 50%" },
        { rotation: 0, duration: 1.15, ease: "power3.out" }, ACT.ignite)
      .fromTo(q(".bcl-halo"), { opacity: 0 }, { opacity: 1, duration: 0.7 }, ACT.ignite + 0.2)
      .fromTo(q(".bcl-echo"),
        { opacity: 0.55, scale: 0.55 },
        { opacity: 0, scale: 2.7, duration: 1.2, ease: "power2.out", stagger: 0.2 }, ACT.echo)
      .to(q(".bcl-horizon-l"), { opacity: 0.35, duration: 0.5 }, ACT.horizonOut)
      .to(q(".bcl-horizon-r"), { opacity: 0.35, duration: 0.5 }, ACT.horizonOut)

      // ── Act 3 · ANALYSIS ───────────────────────────────────────────────
      .to(q(".bcl-sigil"), { y: 0, duration: 0.9, ease: "power3.out" }, ACT.wordmark - 0.3)
      .fromTo(q(".bcl-wordmark .bcl-char"),
        { yPercent: 118, opacity: 0, rotateX: -72 },
        { yPercent: 0, opacity: 1, rotateX: 0, duration: 0.95, stagger: 0.045, ease: "expo.out" }, ACT.wordmark)
      .fromTo(q(".bcl-wordmark"),
        { letterSpacing: "0.46em", backgroundPosition: "190% 50%" },
        { letterSpacing: "0.14em", backgroundPosition: "0% 50%", duration: 1.25, ease: "power3.inOut" },
        ACT.wordmark + 0.05)
      .fromTo(q(".bcl-sub"),
        { opacity: 0, clipPath: "inset(0 100% 0 0)" },
        { opacity: 1, clipPath: "inset(0 0% 0 0)", duration: 0.9, ease: "power3.inOut" }, ACT.sub)
      .fromTo(q(".bcl-live-dot"), { scale: 0, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2)" }, ACT.sub + 0.22)
      .fromTo(q(".bcl-ndci"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6 }, ACT.ndci)
      .fromTo(q(".bcl-ndci-path"), { strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 1.25, ease: "power2.inOut" }, ACT.ndci + 0.06)
      .fromTo(q(".bcl-scan"),
        { x: "-4vw", opacity: 0 },
        { x: "104vw", opacity: 1, duration: 1.75, ease: "power2.inOut" }, ACT.sweep);

    LOG_LINES.forEach((_, i) => {
      tl.fromTo(q(`.bcl-log-${i}`), { opacity: 0, x: -14 },
        { opacity: 1, x: 0, duration: 0.45 }, ACT.log + i * ACT.logStagger);
    });

    tl.fromTo(q(".bcl-counter"), { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5 }, ACT.counter - 0.12)
      .to(counter, {
        v: 100, duration: ACT.counterDur, ease: "power2.inOut", onUpdate: writeCounter,
      }, ACT.counter)

      // ── Act 4 · TYPE ───────────────────────────────────────────────────
      .to(q(".bcl-analysis"), {
        opacity: 0, y: -26, filter: "blur(6px)", duration: 0.5, ease: "power2.in",
      }, ACT.collapse)
      .set(q(".bcl-type"), { opacity: 1 }, ACT.sloganL1 - 0.05)
      .fromTo(q(".bcl-bloom"), { opacity: 0, scale: 0.4 },
        { opacity: 1, scale: 1.5, duration: 1.7, ease: "power2.out" }, ACT.sloganL1)
      .fromTo(q(".bcl-slogan-l1 .bcl-char"),
        { yPercent: 118, opacity: 0, rotateX: -68 },
        { yPercent: 0, opacity: 1, rotateX: 0, duration: 1, stagger: 0.055, ease: "expo.out" }, ACT.sloganL1)
      .fromTo(q(".bcl-slogan-l2 .bcl-char"),
        { yPercent: 118, opacity: 0, rotateX: -68 },
        { yPercent: 0, opacity: 1, rotateX: 0, duration: 1, stagger: 0.055, ease: "expo.out" }, ACT.sloganL2)
      .fromTo(q(".bcl-slogan-l2"), { backgroundPosition: "180% 50%" },
        { backgroundPosition: "0% 50%", duration: 1.1, ease: "power2.inOut" }, ACT.sloganL2 + 0.15)
      .fromTo(q(".bcl-flare"), { opacity: 0, x: "-12%" },
        { opacity: 0.45, duration: 0.45, ease: "power2.out" }, ACT.flare)
      .to(q(".bcl-flare"), { opacity: 0, x: "62%", duration: 0.75, ease: "power2.in" }, ACT.flare + 0.42)
      .to(q(".bcl-type"), {
        opacity: 0, scale: 1.07, filter: "blur(5px)", duration: 0.6, ease: "power2.in",
      }, ACT.typeOut)
      .to(q(".bcl-bloom"), { opacity: 0, scale: 0.55, duration: 0.7, ease: "power2.in" }, ACT.typeOut)
      .to(q(".bcl-flash"), { opacity: 0.85, duration: 0.12, ease: "power3.in" }, ACT.flash)
      .to(q(".bcl-flash"), { opacity: 0, duration: 0.5, ease: "power2.out" }, ACT.flash + 0.14)

      // ── Act 5 · SETTLE + GATE ──────────────────────────────────────────
      .fromTo(q(".bcl-lockup"),
        { opacity: 0, scale: 0.94, filter: "blur(6px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.95, ease: "power3.out" }, ACT.lockup)
      .fromTo(q(".bcl-lockup-mark"), { scale: 0.6, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.75, ease: "back.out(1.8)" }, ACT.lockup + 0.1)
      .fromTo(q(".bcl-slogan-serif .bcl-char"), { yPercent: 120, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 0.9, stagger: 0.035, ease: "expo.out" }, ACT.lockup + 0.34)
      .fromTo(q(".bcl-gate"), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.75 }, ACT.gate)
      .fromTo(q(".bcl-gate-line"), { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power3.inOut" }, ACT.gate - 0.1)
      .to(q(".bcl-hint"), { opacity: 1, duration: 0.7, ease: "power2.out" }, ACT.hint);

    // Arm the gate. If a gesture already arrived, honour it right here — the
    // user never has to scroll twice.
    tl.call(() => {
      armedRef.current = true;
      setArmed(true);
      if (pendingRef.current) reveal();
    }, undefined, ACT.arm);

    tl.play();
    return () => {
      tl.kill();
      tlRef.current = null;
      exitTlRef.current?.kill();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, reveal]);

  // ── The gate: one gesture opens it ──────────────────────────────────────
  useEffect(() => {
    if (reduced) return;
    let touchY: number | null = null;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY > 4) requestEnter();
    };
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY === null) return;
      const y = e.touches[0]?.clientY ?? touchY;
      // Swipe up (content rises) — the natural "scroll down" on touch.
      if (touchY - y > 16) requestEnter();
      touchY = y;
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowDown", "PageDown", " ", "Spacebar", "Enter"].includes(e.key)) {
        e.preventDefault();
        requestEnter();
      }
    };
    const onPointer = () => requestEnter();

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [reduced, requestEnter]);

  // Watchdog: if the visitor never interacts, the site must still open.
  useEffect(() => {
    if (reduced) return;
    const id = window.setTimeout(() => requestEnter(), WATCHDOG_MS);
    return () => window.clearTimeout(id);
  }, [reduced, requestEnter]);

  return (
    <div
      ref={rootRef}
      className="bcl-root"
      role="status"
      aria-live="polite"
      aria-label="BloomCast is igniting the bloom forecast"
    >
      {/* Act 1 · DEEP — the abyss itself */}
      <div className="bcl-caustic" aria-hidden />
      <div className="bcl-caustic-b" aria-hidden />
      <div className="bcl-vignette" aria-hidden />
      <div className="bcl-grain" aria-hidden />
      <div className="bcl-scan" aria-hidden />
      <div className="bcl-flash" aria-hidden />

      {/* HUD — broadcast furniture; the favicon chip is the real app icon */}
      <div className="bcl-hud" aria-hidden>
        <div className="absolute left-5 top-5 flex items-center gap-2.5 sm:left-8 sm:top-7">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={15} height={15} className="bcl-chip" />
          <span className="text-fg-muted">BloomCast</span>
          <span className="text-glow-cyan/80">· boot</span>
          <span className="bcl-caret" />
        </div>
        <div className="absolute right-5 top-5 flex items-center gap-3 sm:right-8 sm:top-7">
          <span className="hidden text-glow-cyan/60 sm:inline">live · open data</span>
          <span className="bcl-num">01 / 05</span>
        </div>
        <div className="absolute bottom-5 left-5 hidden sm:bottom-7 sm:left-8 sm:block">
          Sentinel-2 · Open-Meteo · no api key
        </div>
        <div className="bcl-num absolute bottom-5 right-5 sm:bottom-7 sm:right-8">
          free tier
        </div>
        <div className="bcl-horizon-l bcl-hairline-h" />
        <div className="bcl-horizon-r bcl-hairline-h" />
      </div>

      <div className="bcl-stage">
        <div className="bcl-bloom" aria-hidden />

        {/* Act 4 · TYPE — the slogan fills the frame */}
        <div className="bcl-layer bcl-type" aria-hidden>
          <h1 className="text-center font-display leading-[0.84] tracking-[0.01em]">
            <SplitChars
              text={SLOGAN_L1}
              className="bcl-slogan-l1 bcl-gradient-text block text-[clamp(3.4rem,14vw,10.5rem)]"
            />
            <SplitChars
              text={SLOGAN_L2}
              className="bcl-slogan-l2 bcl-gradient-text block text-[clamp(3.4rem,14vw,10.5rem)]"
            />
          </h1>
        </div>

        {/* Act 5 · SETTLE — the lockup */}
        <div className="bcl-layer bcl-lockup" aria-hidden>
          <div className="flex flex-col items-center gap-5">
            <BloomMark size={104} className="bcl-lockup-mark" />
            <span className="bcl-wordmark bcl-gradient-text text-center text-[clamp(2.8rem,9vw,6.5rem)]">
              {WORDMARK}
            </span>
            <p className="text-center text-[clamp(1.1rem,3vw,1.7rem)] text-fg-secondary">
              <SplitChars text={SLOGAN_SERIF} className="bcl-slogan-serif bcl-serif" />
            </p>
          </div>
        </div>

        {/* Act 3 · ANALYSIS — mark, wordmark, and the live read */}
        <div className="bcl-layer bcl-analysis">
          <div className="flex w-full max-w-2xl flex-col items-center">
            <div className="bcl-sigil">
              <span className="bcl-seed" aria-hidden />
              <span className="bcl-echo" aria-hidden />
              <span className="bcl-echo" aria-hidden />
              <span className="bcl-echo" aria-hidden />
              <BloomMark size={96} />
            </div>

            <h2 className="mt-6 text-center">
              <SplitChars
                text={WORDMARK}
                className="bcl-wordmark bcl-gradient-text text-[clamp(2.6rem,11vw,7rem)]"
              />
              <span className="sr-only">BloomCast</span>
            </h2>

            <p className="bcl-sub mt-3 flex items-center justify-center gap-2 text-center font-mono text-[10px] uppercase tracking-[0.34em] text-fg-secondary sm:text-[11px]">
              <span
                className="bcl-live-dot inline-block h-1.5 w-1.5 rounded-full bg-glow-cyan"
                aria-hidden
              />
              Predictive cyanobacteria early warning · 3–7 day lead time
            </p>

            <div className="bcl-ndci mt-7 w-full max-w-md">
              <div className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.3em] text-fg-faint">
                <span>NDCI red-edge trace</span>
                <span className="text-glow-cyan/70">B05 − B04 / B05 + B04</span>
              </div>
              <svg
                viewBox="0 0 300 40"
                className="mt-2 h-10 w-full"
                aria-hidden
                preserveAspectRatio="none"
              >
                <path
                  d="M0 30 C 26 30 34 12 52 16 C 72 20 80 34 104 32 C 126 30 138 10 162 14 C 186 18 196 30 220 26 C 244 22 258 8 300 12"
                  fill="none"
                  stroke="rgba(0,240,212,0.85)"
                  strokeWidth="1.4"
                  pathLength={1}
                  strokeDasharray={1}
                  className="bcl-ndci-path"
                />
                <line x1="0" y1="39" x2="300" y2="39" stroke="rgba(159,184,199,0.18)" strokeWidth="1" />
              </svg>
            </div>

            <div className="mt-6 flex min-h-[76px] w-full max-w-md flex-col justify-start gap-1.5 font-mono text-[10px] leading-4 text-fg-muted sm:text-[11px]">
              {LOG_LINES.map((line, i) => (
                <div key={line} className={`bcl-log-line bcl-log-${i}`}>
                  <span className="text-glow-cyan/80">›</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>

            <div className="bcl-counter mt-2 flex flex-col items-center gap-3">
              <div className="bcl-num text-[clamp(2.2rem,8vw,3.6rem)] font-light leading-none tracking-[0.12em] text-fg-primary">
                <span className="bcl-count">000</span>
                <span className="text-glow-cyan/80">%</span>
              </div>
              <div className="bcl-bar">
                <div className="bcl-bar-fill" />
              </div>
            </div>
          </div>
        </div>

        {/* Act 5b · GATE — the scroll invitation */}
        <div className="bcl-layer bcl-layer-gate bcl-gate">
          <div className="flex flex-col items-center gap-3">
            <div className="bcl-gate-line" aria-hidden />
            <p
              className={`font-mono text-[10px] uppercase tracking-[0.42em] transition-colors duration-700 sm:text-[11px] ${
                armed ? "text-glow-cyan" : "text-fg-muted"
              }`}
            >
              Scroll to enter
            </p>
            <svg
              className="bcl-chev text-glow-cyan/80"
              width="18"
              height="26"
              viewBox="0 0 16 24"
              fill="none"
              aria-hidden
              style={{ animation: reduced ? undefined : "bclBlink 2.4s ease-in-out infinite" }}
            >
              <path d="M8 2 V 18" stroke="currentColor" strokeWidth="1" opacity="0.55" />
              <path d="M3 13 L8 19 L13 13" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
            <p className="bcl-hint font-mono text-[9px] uppercase tracking-[0.3em] text-fg-faint">
              or press enter
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
