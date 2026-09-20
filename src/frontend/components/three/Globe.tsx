"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Sphere, Points, PointMaterial } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const RISK_COLORS: Record<string, string> = {
  low: "#00ff88",
  moderate: "#ffcc00",
  elevated: "#ff8800",
  high: "#ff3355",
  critical: "#ff00aa",
};

function latLonToVec3(lat: number, lon: number, r = 1.005): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return [
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  ];
}

function BloomPoint({ wb, selected, onSelect }: any) {
  const ref = useRef<THREE.Mesh>(null!);
  // Centroids are GeoJSON [lon, lat].
  const pos = latLonToVec3(wb.centroid[1], wb.centroid[0]);
  const color = RISK_COLORS[wb._risk ?? "low"] ?? "#00f0d4";

  useFrame(({ clock }) => {
    if (ref.current && selected) {
      const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.35;
      ref.current.scale.setScalar(s);
    } else if (ref.current) {
      ref.current.scale.setScalar(1);
    }
  });

  return (
    <mesh
      ref={ref}
      position={pos}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(wb.id);
      }}
    >
      <sphereGeometry args={[selected ? 0.04 : 0.022, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={selected ? 2.5 : 1.2}
      />
    </mesh>
  );
}

export function Globe({ waterbodies, selected, onSelect }: any) {
  const stars = useMemo(() => {
    const n = 800;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 12 + Math.random() * 8;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(p) * Math.cos(t);
      positions[i * 3 + 1] = r * Math.sin(p) * Math.sin(t);
      positions[i * 3 + 2] = r * Math.cos(p);
    }
    return positions;
  }, []);

  const points = useMemo(
    () => waterbodies.map((wb: any) => ({ ...wb, _risk: wb._risk ?? "low" })),
    [waterbodies]
  );

  return (
    <Canvas
      camera={{ position: [0, 0, 2.5], fov: 45 }}
      style={{ background: "radial-gradient(ellipse at 50% 50%, #041a2e, #02060f)" }}
      gl={{ antialias: true }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={1.2} color="#00f0d4" />
      <pointLight position={[-5, -3, -5]} intensity={0.6} color="#ff00aa" />

      <Sphere args={[1, 64, 64]}>
        <meshStandardMaterial
          color="#04111f"
          emissive="#0a2a4a"
          emissiveIntensity={0.3}
          roughness={0.9}
          metalness={0.1}
        />
      </Sphere>

      <Points positions={stars} stride={3} frustumCulled={false}>
        <PointMaterial
          transparent
          color="#3d7a9a"
          size={0.025}
          sizeAttenuation
          depthWrite={false}
        />
      </Points>

      {points.map((wb: any) => (
        <BloomPoint
          key={wb.id}
          wb={wb}
          selected={selected === wb.id}
          onSelect={onSelect}
        />
      ))}

      <OrbitControls
        enableZoom
        enablePan={false}
        minDistance={1.3}
        maxDistance={4}
        autoRotate
        autoRotateSpeed={0.4}
        dampingFactor={0.08}
      />
    </Canvas>
  );
}