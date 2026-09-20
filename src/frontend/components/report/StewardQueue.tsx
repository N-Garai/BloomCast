"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { API } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

interface QueuedReport {
  observation_id: string;
  waterbody_id: string;
  observer_id: string | null;
  observed_at: string;
  water_color: string;
  scum_visible: boolean;
  odor: string;
  wildlife_dead: boolean;
  notes: string | null;
}

interface Influence {
  prior_probability: number;
  new_probability: number;
  probability_delta: number;
}

export function StewardQueue() {
  const [queue, setQueue] = useState<QueuedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [lastInfluence, setLastInfluence] = useState<(Influence & { waterbody_id: string }) | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/v1/citizen/queue?limit=50`);
      const d = await r.json();
      setQueue(r.ok ? (d.data ?? []) : []);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setActing(id);
    try {
      const r = await fetch(`${API}/v1/citizen/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observation_id: id, decision, steward: "web-steward" }),
      });
      const d = await r.json();
      if (r.ok) {
        setQueue((q) => q.filter((x) => x.observation_id !== id));
        if (d.influence) setLastInfluence(d.influence);
      }
    } catch {
      /* keep the item in the queue on failure */
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="glass rounded-2xl p-6 md:p-8 border border-border-subtle relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-glow-yellow/60 to-transparent" />
      <h2 className="font-display text-2xl font-semibold tracking-wide mb-1">Steward validation queue</h2>
      <p className="text-sm text-fg-muted mb-5">
        Community stewards confirm reports. Approved bloom evidence is written to the
        influence ledger with its estimated forecast delta.
      </p>

      <AnimatePresence>
        {lastInfluence && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-4 rounded-xl border border-glow-green/40 bg-glow-green/5 p-4 text-sm"
          >
            <span className="text-glow-green font-medium">Influence recorded. </span>
            <span className="text-fg-secondary font-mono">
              {lastInfluence.waterbody_id}: {Math.round(lastInfluence.prior_probability * 100)}% →{" "}
              {Math.round(lastInfluence.new_probability * 100)}% (+
              {Math.round(lastInfluence.probability_delta * 100)}pp)
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <Spinner label="Loading queue" />
      ) : queue.length === 0 ? (
        <p className="text-sm text-fg-muted">Queue is clear — no reports awaiting validation.</p>
      ) : (
        <div className="space-y-3">
          {queue.map((q) => (
            <motion.div
              key={q.observation_id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-xl border border-border-faint bg-bg-deep/50 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm">
                  <span className="font-mono text-fg-primary">{q.waterbody_id}</span>
                  <span className="text-fg-muted"> · {q.water_color}</span>
                  {q.scum_visible && <span className="text-glow-orange"> · scum</span>}
                  {q.wildlife_dead && <span className="text-glow-red"> · wildlife</span>}
                  <div className="text-xs text-fg-faint mt-1 font-mono">
                    {q.observation_id} · {q.observed_at}
                  </div>
                  {q.notes && <div className="text-xs text-fg-secondary mt-1">{q.notes}</div>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => decide(q.observation_id, "approved")}
                    disabled={acting === q.observation_id}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-glow-green/15 border border-glow-green/40 text-glow-green hover:bg-glow-green/25 transition-colors disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => decide(q.observation_id, "rejected")}
                    disabled={acting === q.observation_id}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-glow-red/10 border border-glow-red/40 text-glow-red hover:bg-glow-red/20 transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
