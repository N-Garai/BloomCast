import { LandingHero } from "@/components/landing/LandingHero";
import { LandingStats } from "@/components/landing/LandingStats";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { Footer } from "@/components/brand/Footer";
import { SectionFilm } from "@/components/brand/SectionFilm";

export default function Page() {
  return (
    <main>
      <SectionFilm film="abyss" className="relative">
        <LandingHero />
      </SectionFilm>
      <LandingStats />
      <SectionFilm film="caustic" className="mt-4">
        <LandingFeatures />
      </SectionFilm>
      <SectionFilm film="night" className="mt-4">
        <LandingCTA />
      </SectionFilm>
      <Footer />
    </main>
  );
}
