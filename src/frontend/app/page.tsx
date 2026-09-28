"use client";

import { LandingHero } from "@/components/landing/LandingHero";
import { LandingStats } from "@/components/landing/LandingStats";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { Footer } from "@/components/brand/Footer";
import { SectionFilm } from "@/components/brand/SectionFilm";
import { SectionDivider } from "@/components/brand/SectionDivider";

/**
 * The intro curtain is mounted once by `AppShell`, above this tree, and owns
 * the loading state and the "enter" affordance for the whole site.
 *
 * This page used to mount a second, superseded loader (`BootLoader`, 7.2s of
 * framer-motion plus a rAF loop calling setState every frame) *inside* the
 * hidden `<main>`. It was invisible — its ancestor sits at `opacity: 0` — but
 * it still re-rendered the page 60 times a second for the whole duration of
 * the real film, competing with the GSAP timeline for the main thread. It also
 * nested a `<main>` inside AppShell's `<main>`, which is invalid HTML.
 */
export default function Page() {
  return (
    <div className="bg-bg-abyss">
      <LandingHero />
      <SectionDivider tone="cyan" />
      <LandingStats />
      <SectionDivider tone="orange" />
      <SectionFilm film="caustic" videoOpacity={0.62}>
        <LandingFeatures />
      </SectionFilm>
      <SectionDivider tone="violet" />
      <SectionFilm film="night" videoOpacity={0.6}>
        <LandingCTA />
      </SectionFilm>
      <Footer />
    </div>
  );
}
