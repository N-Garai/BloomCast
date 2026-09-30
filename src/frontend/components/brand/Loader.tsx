"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";

/**
 * BloomCast intro curtain — a five-act boot film, ~8.1s to the reveal gate.
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
 * • Fail-safes: a wall-clock arm deadline independent of the timeline, a 22s
 *   watchdog that reveals anyway, and — for prefers-reduced-motion — a calm
 *   cross-fade variant of the same beats rather than no curtain at all. The
 *   page-side reveal is a CSS transition so it finishes even if this component
 *   unmounts mid-iris.
 */

/**
 * Absolute timeline positions (seconds). The gate arms at `arm`.
 *
 * Act 3 is deliberately long. The live read is the one beat that carries real
 * information — the NDCI trace drawing itself, the sweep crossing the frame,
 * the pipeline log and the 000 → 100 counter — and it used to be scheduled so
 * that `collapse` tore the whole layer down 0.15s after the counter started its
 * 2.1s run. The graph was still drawing when it was cut, the counter never left
 * the teens, and the act read as a flash. Everything from `collapse` onward is
 * therefore offset from the end of Act 3, not from its start.
 */
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
  // The counter reaches 100 at 5.1s; hold it so the completed read is legible
  // before the layer collapses.
  collapse: 5.65,
  sloganL1: 5.85,
  sloganL2: 6.35,
  typeOut: 7.05,
  flash: 7.28,
  lockup: 7.48,
  gate: 7.8,
  arm: 8.1,
  hint: 10.9,
  /** v3 M-V10: the skip affordance is advertised from Act 1, not the gate. */
  skipHint: 0.85,
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

/**
 * Calm variant timings (seconds), used when the visitor prefers reduced motion.
 * Same beats and the same copy, but cross-fades only — no parallax, no 3D
 * glyph rotation, no blur, no scale, no idle drift. It lands on the same scroll
 * gate, so the page still has to be entered deliberately.
 */
const CALM = {
  hud: 0.05,
  seed: 0.1,
  mark: 0.3,
  word: 0.85,
  sub: 1.35,
  // Same defect as the full film, in miniature: `lockup` used to start 0.25s
  // after `sub`, so the calm counter was torn down at 0.25s of a 1.1s run and
  // the read this variant exists to communicate never resolved.
  counter: 1.6,
  counterDur: 1.9,
  lockup: 3.7,
  gate: 4.3,
  arm: 4.7,
  /** Same early skip advertisement as the full film, proportionally placed. */
  skipHint: 0.5,
} as const;

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

  // Safe to read during render: the Loader is only mounted once `booting` flips
  // in a post-hydration layout effect, so it never renders on the server or
  // during hydration and cannot mismatch.
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  /** The exit: stage bursts, the shutter bloom closes to a point, then unmount. */
  const reveal = useCallback(() => {
    const root = rootRef.current;
    if (!root || exitedRef.current || finishedRef.current) return;
    exitedRef.current = true;
    armedRef.current = false;
    // The film stops the instant the gate opens — the exit owns the frame.
    tlRef.current?.pause();
    enterRef.current();

    // Calm variant: a plain cross-fade. The iris, the stage scale and the
    // shockwave are all motion, and this visitor asked for none of it.
    if (reducedRef.current) {
      exitTlRef.current = gsap
        .timeline({
          onComplete: () => {
            finishedRef.current = true;
            doneRef.current();
          },
        })
        .to(root, { opacity: 0, duration: 0.45, ease: "none" });
      return;
    }

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

  // ── The film ────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const q = gsap.utils.selector(root);

    // The intro promises a duration. GSAP's default lag smoothing freezes the
    // timeline clock whenever a frame exceeds 500ms, which stretched the 5.6s
    // film past 10s on a slow machine. Follow real time instead and let the
    // arm-deadline watchdog cover the pathological case.
    gsap.ticker.lagSmoothing(0);

    // ── Calm variant · prefers-reduced-motion ─────────────────────────────
    // Honouring the preference means dropping the motion, not the curtain.
    // Same story, cross-fades only, and the same scroll gate so the page is
    // still entered deliberately. The stage layers (analysis → type → lockup)
    // are stacked in one place, so each layer must fade out before the next
    // fades in — showing two at once reads as a broken pile, not a calm film.
    const counter = { v: 0 };
    const countEl = q(".bcl-count")[0] as HTMLElement | undefined;
    const barEl = q(".bcl-bar-fill")[0] as HTMLElement | undefined;
    const writeCounter = () => {
      if (countEl) countEl.textContent = String(Math.round(counter.v)).padStart(3, "0");
      if (barEl) barEl.style.transform = `scaleX(${Math.min(1, counter.v / 100)})`;
    };

    if (reduced) {
      // Everything the calm film reveals starts hidden, including the type
      // layer (the full-frame slogan is the most aggressive beat, and the
      // lockup already carries "See it coming.").
      gsap.set(
        q(
          [
            ".bcl-hud", ".bcl-seed", ".bcl-mark", ".bcl-echo", ".bcl-type", ".bcl-bloom",
            ".bcl-analysis .bcl-wordmark .bcl-char", ".bcl-sub", ".bcl-ndci",
            ".bcl-counter", ".bcl-flash", ".bcl-lockup", ".bcl-lockup-mark",
            ".bcl-slogan-serif .bcl-char", ".bcl-gate", ".bcl-hint",
            ...LOG_LINES.map((_, i) => `.bcl-log-${i}`),
          ].join(",")
        ),
        { opacity: 0 }
      );

      const calm = gsap.timeline({ paused: true, defaults: { ease: "power1.out" } });
      tlRef.current = calm;
      calm
        // Act 1-2 · DEEP → IGNITION
        .to(q(".bcl-hud"), { opacity: 1, duration: 0.4 }, CALM.hud)
        .to(q(".bcl-seed"), { opacity: 1, duration: 0.5 }, CALM.seed)
        .to(q(".bcl-mark"), { opacity: 1, duration: 0.6 }, CALM.mark)
        .to(q(".bcl-echo"), { opacity: 0.4, duration: 0.6, stagger: 0.12 }, CALM.mark + 0.1)
        // Act 3 · ANALYSIS
        .to(q(".bcl-analysis .bcl-wordmark .bcl-char"),
          { opacity: 1, duration: 0.4, stagger: 0.05 }, CALM.word)
        .to(q(".bcl-sub, .bcl-ndci"), { opacity: 1, duration: 0.4, stagger: 0.1 }, CALM.sub)
        .to(q(LOG_LINES.map((_, i) => `.bcl-log-${i}`).join(",")),
          { opacity: 1, duration: 0.35, stagger: 0.07 }, CALM.sub + 0.2)
        .to(q(".bcl-counter"), { opacity: 1, duration: 0.4 }, CALM.counter)
        .to(counter, { v: 100, duration: CALM.counterDur, ease: "none", onUpdate: writeCounter }, CALM.counter)
        // Act 5 · SETTLE + GATE — the analysis layer clears out first
        .to(q(".bcl-analysis"), { opacity: 0, duration: 0.5 }, CALM.lockup)
        .to(q(".bcl-lockup"), { opacity: 1, duration: 0.5 }, CALM.lockup + 0.35)
        .to(q(".bcl-lockup-mark"), { opacity: 1, duration: 0.5 }, CALM.lockup + 0.4)
        .to(q(".bcl-slogan-serif .bcl-char"),
          { opacity: 1, duration: 0.4, stagger: 0.05 }, CALM.lockup + 0.55)
        .to(q(".bcl-gate, .bcl-hint"),
          { opacity: 1, duration: 0.45, stagger: 0.08 }, CALM.gate)
        // v3 M-V10: the calm variant advertises the skip the same way, so the
        // reduced-motion path is not the one that hides the affordance.
        .fromTo(q(".bcl-skip-hint"), { opacity: 0 },
          { opacity: 1, duration: 0.4, ease: "power2.out" }, CALM.skipHint)
        .to(q(".bcl-skip-hint"), { opacity: 0, duration: 0.4 }, CALM.gate)
        .call(() => {
          armedRef.current = true;
          setArmed(true);
          if (pendingRef.current) reveal();
        }, undefined, CALM.arm);

      writeCounter();
      calm.play();
      return () => {
        gsap.ticker.lagSmoothing(500, 33);
        calm.kill();
        tlRef.current = null;
        exitTlRef.current?.kill();
      };
    }

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
      // A light sweep across the slogan used to live here, tweening `.bcl-flare`
      // at ACT.flare. That element is not in the markup, so the beat animated
      // nothing and logged four "GSAP target not found" warnings per run.
      // Removed rather than re-invented: a dead tween is worse than no tween,
      // and this is a visual decision, not a bug fix.
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
      // v3 M-V10: advertise the skip from the first act. The gesture already
      // fast-forwards the remaining film rather than cutting it, so this line
      // only tells the truth about behaviour that has always existed — it does
      // not add a new shortcut, and the film still plays in full for anyone who
      // does not touch the page. This is option 1 of the three the PRD offers;
      // the gate timing and the reduced-motion path are deliberately untouched.
      .fromTo(q(".bcl-skip-hint"),
        { opacity: 0 },
        { opacity: 1, duration: 0.6, ease: "power2.out" }, ACT.skipHint)
      .to(q(".bcl-skip-hint"), { opacity: 0, duration: 0.5, ease: "power2.in" }, ACT.gate)
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
      gsap.ticker.lagSmoothing(500, 33);
      tl.kill();
      tlRef.current = null;
      exitTlRef.current?.kill();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, reveal]);

  // ── The gate: one gesture opens it ──────────────────────────────────────
  useEffect(() => {
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
  }, [requestEnter]);

  // Two guarantees that do not depend on the timeline having run:
  //   1. the gate arms on wall-clock time, so a janky first paint or a stalled
  //      ticker can never leave the visitor staring at a locked curtain;
  //   2. a visitor who never interacts still gets the page.
  useEffect(() => {
    const armDeadline = (reduced ? CALM.arm : ACT.arm) * 1000 + 1200;
    const armId = window.setTimeout(() => {
      if (armedRef.current || exitedRef.current) return;
      armedRef.current = true;
      setArmed(true);
      if (pendingRef.current) reveal();
    }, armDeadline);
    const openId = window.setTimeout(() => requestEnter(), WATCHDOG_MS);
    return () => {
      window.clearTimeout(armId);
      window.clearTimeout(openId);
    };
  }, [reduced, reveal, requestEnter]);

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

        {/* v3 M-V10: the skip affordance, visible from Act 1. It fades out at the
            gate, where the "scroll to enter" prompt takes over. Purely
            informational — the gesture it advertises already exists and already
            fast-forwards the film rather than cutting it. */}
        <div className="bcl-skip-hint pointer-events-none absolute inset-x-0 bottom-[9vh] z-20 flex justify-center opacity-0" aria-hidden>
          <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-fg-faint">
            scroll or click to skip ahead
          </p>
        </div>

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

        {/* Act 5b · GATE — the scroll invitation.
            `opacity-0` is load-bearing, not styling: the film hides this layer
            with a gsap.set in a layout effect, and a layout effect can still
            land after the browser has painted the mount. Without it the gate
            and its "scroll to enter" line flash at full opacity over Act 1,
            measured at t=389ms with the counter still on 000 — an invitation
            to scroll before there is anything to scroll past. GSAP writes
            inline opacity, which wins over the class, so the film's own
            tweens are unaffected. */}
        <div className="bcl-layer bcl-layer-gate bcl-gate opacity-0">
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
            <p className="bcl-hint font-mono text-[9px] uppercase tracking-[0.3em] text-fg-faint opacity-0">
              or press enter
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
