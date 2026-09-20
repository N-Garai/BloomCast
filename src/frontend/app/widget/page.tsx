"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API } from "@/lib/api";
import { ForecastCard } from "@/components/dashboard/ForecastCard";
import { Spinner } from "@/components/ui/Spinner";

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
      .then((props) =>
        setWb({
          id: props.id,
          name: props.name,
          region: props.region,
          country: props.country,
          centroid: props.centroid ?? [0, 0],
        })
      )
      .catch((e) => setError(String(e?.message ?? e)));
  }, [wbId]);

  if (error) return <p className="p-4 font-mono text-xs text-glow-red">{error}</p>;
  if (!wb) return <Spinner label="Loading widget" />;
  return (
    <div className="p-3 max-w-sm">
      <ForecastCard waterbody={wb} />
      <p className="mt-2 text-center text-[11px] text-fg-faint">
        Powered by <span className="text-glow-cyan">BloomCast</span> · advisory only
      </p>
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
