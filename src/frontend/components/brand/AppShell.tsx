"use client";

import { useState } from "react";
import { Loader } from "@/components/brand/Loader";
import { BioLuminescentBackdrop } from "@/components/brand/BioLuminescentBackdrop";
import { StarfieldBackground } from "@/components/three/StarfieldBackground";
import { ScrollProgress } from "@/components/brand/ScrollProgress";
import { MagneticCursor } from "@/components/brand/MagneticCursor";
import { OfflineBanner } from "@/components/dashboard/Resilience";
import { useKeepAlive } from "@/hooks/useKeepAlive";
import { useLenis } from "@/lib/useLenis";

function shouldBootLoader() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    return sessionStorage.getItem("bc-booted") !== "1";
  } catch {
    return true;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(shouldBootLoader);

  useLenis(!booting);
  useKeepAlive();

  const finish = () => {
    try {
      sessionStorage.setItem("bc-booted", "1");
    } catch {}
    setBooting(false);
  };

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      {booting && <Loader onDone={finish} />}
      <ScrollProgress />
      <OfflineBanner />
      <MagneticCursor />
      <StarfieldBackground />
      <BioLuminescentBackdrop />
      <main id="main" className="relative">
        {children}
      </main>
    </div>
  );
}
