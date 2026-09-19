import { LandingHero } from "@/components/landing/LandingHero";
import { LandingStats } from "@/components/landing/LandingStats";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { Footer } from "@/components/brand/Footer";

export default function Page() {
  return (
    <main>
      <LandingHero />
      <LandingStats />
      <LandingFeatures />
      <LandingCTA />
      <Footer />
    </main>
  );
}