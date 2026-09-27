"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API } from "@/lib/api";
import { ForecastCard } from "@/components/dashboard/ForecastCard";
import { Spinner } from "@/components/ui/Spinner";
import { ImageBackdrop } from "@/components/brand/BackgroundMedia";

function WidgetBody() {
  const params = useSearchParams();
  const wbId = params.get("wb") || "CH-ZUR-01";
  const [wb, setWb] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/v1/waterbodies/${wbId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((props) => {
        const centroid = props.centroid;
        const valid =
          Array.isArray(centroid) &&
          Number.isFinite(centroid[0]) &&
          Number.isFinite(centroid[1]);
        if (!props.id || !valid) {
          throw new Error("waterbody unavailable");
        }
        setWb({
          id: props.id,
          name: props.name,
          region: props.region,
          country: props.country,
          centroid,
        });
      })
      .catch(() => setError("Forecast unavailable right now — try again in a minute."));
  }, [wbId]);

  if (error) return <p className="p-4 font-mono text-xs text-glow-red">{error}</p>;
  if (!wb) return <Spinner label="Loading widget" />;
  return (
    <div className="p-3 max-w-sm relative overflow-hidden rounded-xl">
      <ImageBackdrop src="/bg/bg-page-b.jpg" />
      <div className="relative">
      <ForecastCard waterbody={wb} />
      <p className="mt-2 text-center text-[11px] text-fg-faint">
        Powered by <span className="text-glow-cyan">BloomCast</span> · advisory only
      </p>
      </div>
    </div>
  );
}

export default function WidgetPage() {
  return (
    <Suspense fallback={<Spinner label="Loading widget" />}>
      <WidgetBody />
    </Suspense>
  );
}
