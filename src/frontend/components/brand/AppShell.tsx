"use client";

import { useState, useEffect } from "react";
import { Loader } from "@/components/brand/Loader";
import { BioLuminescentBackdrop } from "@/components/brand/BioLuminescentBackdrop";

function shouldBootLoader() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return sessionStorage.getItem("bc-booted") !== "1";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(shouldBootLoader);

  const finish = () => {
    sessionStorage.setItem("bc-booted", "1");
    setBooting(false);
  };

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      {booting && <Loader onDone={finish} />}
      <BioLuminescentBackdrop />
      <main id="main">
        {children}
      </main>
    </div>
  );
}
