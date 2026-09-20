import { LandingHero } from "@/components/landing/LandingHero";
import { LandingStats } from "@/components/landing/LandingStats";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { Footer } from "@/components/brand/Footer";
import { SectionFilm } from "@/components/brand/SectionFilm";
import { SectionDivider } from "@/components/brand/SectionDivider";

export default function Page() {
  return (
    <main className="bg-bg-abyss">
      <SectionFilm film="abyss" className="relative">
        <LandingHero />
      </SectionFilm>
      <SectionDivider tone="cyan" />
      <LandingStats />
      <SectionDivider tone="orange" />
      <SectionFilm film="caustic">
        <LandingFeatures />
      </SectionFilm>
      <SectionDivider tone="violet" />
      <SectionFilm film="night">
        <LandingCTA />
      </SectionFilm>
      <Footer />
    </main>
  );
}
