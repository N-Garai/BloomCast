"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingStats } from "@/components/landing/LandingStats";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { Footer } from "@/components/brand/Footer";
import { BootLoader } from "@/components/brand/BootLoader";
import { SectionFilm } from "@/components/brand/SectionFilm";
import { SectionDivider } from "@/components/brand/SectionDivider";

export default function Page() {
  const [booted, setBooted] = useState(false);
  return (
    <main className="bg-bg-abyss">
      <AnimatePresence>{!booted && <BootLoader onDone={() => setBooted(true)} />}</AnimatePresence>
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
    </main>
  );
}
