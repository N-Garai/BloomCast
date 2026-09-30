"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function Stars({ paused }: { paused: React.RefObject<boolean> }) {
  const ref = useRef<THREE.Points>(null!);
  const positions = useMemo(() => {
    const arr = new Float32Array(5000 * 3);
    for (let i = 0; i < 5000; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 100;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 100;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    // v3 M-V8: a static frame under prefers-reduced-motion. The rotation here is
    // decorative, so freezing it costs nothing and matches how the intro curtain
    // and 2D backdrop already honour the same preference. Rotating 5000 points
    // forever is exactly the kind of unrequested motion the setting exists to stop.
    if (paused.current) return;
    if (ref.current) {
      ref.current.rotation.y += delta * 0.03;
      ref.current.rotation.x += delta * 0.01;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        color="#00f0d4"
        transparent
        opacity={0.55}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export function StarfieldBackground() {
  // v3 M-V8: stop rendering entirely while the tab is hidden, and while the user
  // has asked for reduced motion. `frameloop` is the lever that matters: with
  // "never" R3F tears down its render loop and stops burning CPU/GPU on a
  // backgrounded tab, rather than merely skipping the rotation while still
  // redrawing 5000 additive-blended points every frame.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPaused(media.matches || document.hidden);
    sync();
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-20" aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 30], fov: 60 }}
        gl={{ antialias: false, alpha: true }}
        frameloop={paused ? "never" : "always"}
        dpr={paused ? 0 : [1, 1.5]}
      >
        <Stars paused={pausedRef} />
      </Canvas>
      <div className="absolute inset-0 bg-gradient-to-b from-bg-abyss/50 via-transparent to-bg-abyss/85" />
    </div>
  );
}
