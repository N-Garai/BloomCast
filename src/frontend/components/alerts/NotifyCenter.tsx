"use client";

import { useEffect, useRef, useState } from "react";

import { API } from "@/lib/api";
import { waterbodyName, type WaterbodyOption } from "@/lib/waterbodies";

const POLL_MS = 60_000;
const TOPIC_KEY = "bc-ntfy-topic";
const WATCH_KEY = "bc-alert-watch";
const CROSSED_KEY = "bc-alert-crossed";
const LOG_KEY = "bc-alert-log";
const ESCALATED_KEY = "bc-alert-escalated";
const CROSSED_CAP = 50;
const LOG_CAP = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const ESCALATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Starting thresholds by waterbody type — a blank form helps nobody. */
const THRESHOLD_PRESETS: Record<string, { threshold: number; horizon: number; label: string }> = {
  lake: { threshold: 0.6, horizon: 5, label: "Lake — large, slow-mixing water" },
  reservoir: { threshold: 0.6, horizon: 5, label: "Reservoir — slow turnover" },
  estuary: { threshold: 0.55, horizon: 5, label: "Estuary — tidal, variable salinity" },
  river: { threshold: 0.5, horizon: 3, label: "River/stream — fast response, shorter lead" },
  stream: { threshold: 0.5, horizon: 3, label: "Stream — very fast response" },
};
const DEFAULT_PRESET = { threshold: 0.55, horizon: 5, label: "Default — no type known" };

export function presetFor(type?: string) {
  if (!type) return DEFAULT_PRESET;
  return THRESHOLD_PRESETS[type] ?? DEFAULT_PRESET;
}

/**
 * Read a capped string list from localStorage. A quota error or private-mode
 * throw must not take the alert watch down, so every failure degrades to [].
 */
function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, values: string[], cap: number) {
  try {
    localStorage.setItem(key, JSON.stringify(values.slice(0, cap)));
  } catch {
    // Quota or private mode — dedup degrades to in-memory only, never throws.
  }
}


/**
 * Device alert delivery — free on every tier, no email, no push server.
 *
 * Two channels, both firing from this page while it is open:
 * 1. Browser Notifications (Windows/macOS/Android Chrome + Edge) for
 *    on-screen delivery with sound/vibration.
 * 2. ntfy.sh topic publish (https://ntfy.sh/<topic>) so the same event
 *    lands in the ntfy Android/iOS app — free, no account, no key.
 *    The topic name is the only secret: anyone who guesses it can read
 *    your alerts, so use something unguessable.
 *
 * Honest limits (also documented in docs/alert-delivery.md): there is no
 * background dispatcher on the free tier — Render has no cron/workers and
 * browsers cannot push to a closed page — so checks run while this page
 * stays open. The server-side alternative is a webhook URL on an always-on
 * host; ntfy is the zero-host equivalent of that webhook channel.
 */
export function NotifyCenter({ subscriberKey, waterbodies }: {
  subscriberKey: string;
  waterbodies: WaterbodyOption[];
}) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  const [topic, setTopic] = useState("");
  const [watching, setWatching] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Dedup state is state, not a ref: it has to survive a reload, and a ref
  // silently resets on every remount. Persistence happens on write.
  const [knownCrossed, setKnownCrossed] = useState<Set<string>>(new Set());
  const [escalated, setEscalated] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The 60s interval captures the FIRST checkOnce closure for the whole watch
  // session, so reading state directly inside the poll goes stale after the
  // first poll: every crossed alert re-fires each minute and the escalation
  // branch below becomes unreachable. The mirror is reassigned on every
  // render and read inside the poll, so the interval always sees current
  // values; state still drives rendering and persistence-on-write.
  const liveRef = useRef({ knownCrossed, escalated, topic, permission, subscriberKey, waterbodies });
  liveRef.current = { knownCrossed, escalated, topic, permission, subscriberKey, waterbodies };

  useEffect(() => {
    try {
      setTopic(localStorage.getItem(TOPIC_KEY) || "");
      setWatching(localStorage.getItem(WATCH_KEY) === "1");
    } catch {
      // Private mode — notifications still work, topics just don't persist.
    }
    // v3 M-V6: rehydrate dedup state and the delivery log so a reload mid-watch
    // neither re-fires an already-crossed alert nor loses the audit trail.
    setKnownCrossed(new Set(readList(CROSSED_KEY)));
    setLog(readList(LOG_KEY).reverse());
    setEscalated(new Set(readList(ESCALATED_KEY)));
  }, []);

  const saveTopic = (value: string) => {
    const clean = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    setTopic(clean);
    try {
      localStorage.setItem(TOPIC_KEY, clean);
    } catch {
      // ignore
    }
  };

  const requestPermission = async () => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      setPermission("denied");
    }
  };

  const pushLog = (line: string) => {
    const stamped = `${new Date().toLocaleTimeString()} — ${line}`;
    setLog((current) => {
      const next = [stamped, ...current].slice(0, LOG_CAP);
      // Persist the log so a reload keeps the audit trail (v3 M-V6). The list
      // is stored newest-first, so the UI reverses it on rehydrate.
      writeList(LOG_KEY, next, LOG_CAP);
      return next;
    });
  };

  const notifyDevice = (title: string, body: string) => {
    try {
      // Read via the mirror: notifyDevice is called from the interval-held
      // checkOnce, whose own closure is stale (see liveRef above).
      if (liveRef.current.permission === "granted") {
        new Notification(title, { body, tag: `bloomcast-${Date.now()}` });
      }
    } catch {
      // Notification constructor can throw in some embedded webviews.
    }
  };

  const publishNtfy = async (title: string, body: string) => {
    // Same staleness reason as notifyDevice: the topic may have been set
    // after the watch started.
    const topic = liveRef.current.topic;
    if (!topic) return false;
    try {
      const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: "POST",
        headers: { Title: title, Tags: "warning,alembic", Priority: "high" },
        body,
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const checkOnce = async () => {
    // Snapshot the mirror: this closure is held by the interval for the whole
    // session (see liveRef), so every value it reads must come from here,
    // never from render-scope state.
    const snap = liveRef.current;
    if (!snap.subscriberKey) return;
    setError(null);
    // v3 M-V6: a hung upstream must not stall the watch forever. The poll has a
    // hard timeout and reports it as an error line rather than going silent,
    // because silence is indistinguishable from "no alerts" to a steward.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${API}/v1/alerts/check?subscriber_key=${encodeURIComponent(snap.subscriberKey)}`,
        { signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail ?? `HTTP ${response.status}`);
      const crossed = (data.alerts ?? []).filter((a: any) => a.crossed);
      setLastCheck(new Date().toLocaleTimeString());
      for (const alert of crossed) {
        const key = `${alert.waterbody_id}-${alert.horizon_days}`;
        const name = waterbodyName(snap.waterbodies, alert.waterbody_id);
        const pct = Math.round((alert.current_probability ?? 0) * 100);
        const thresholdPct = Math.round((alert.threshold ?? 0) * 100);
        const risePoints = Math.round(((alert.current_probability ?? 0) - (alert.threshold ?? 0)) * 100);

        if (snap.knownCrossed.has(key)) {
          // v3 M-V9 escalation: already crossed, but the risk has climbed
          // >= 10 points above the threshold since. Re-notify once per level,
          // honouring a 6h cooldown so a rising trend cannot spam a steward
          // into ignoring the channel.
          const level = Math.floor(risePoints / 10);
          if (level < 1) continue;
          const escKey = `${key}-L${level}`;
          const last = Number(localStorage.getItem(escKey) || 0);
          if (snap.escalated.has(escKey)) continue;
          if (last && Date.now() - last < ESCALATION_COOLDOWN_MS) {
            pushLog(`${name} still rising to ${pct}% — escalation held by cooldown.`);
            continue;
          }
          try {
            localStorage.setItem(escKey, String(Date.now()));
          } catch {
            // ignore — escalation still fires, it just may repeat after reload
          }
          setEscalated((current) => {
            const next = new Set(current).add(escKey);
            writeList(ESCALATED_KEY, [...next], CROSSED_CAP);
            return next;
          });
          const title = `Bloom risk rising: ${name}`;
          const text = `${pct}% is now ${risePoints} points above your ${thresholdPct}% threshold.`;
          notifyDevice(title, text);
          const sent = await publishNtfy(title, text);
          pushLog(`${name} escalating to ${pct}% (${risePoints} pts over threshold) — device ${snap.permission === "granted" ? "notified" : "notification off"}${snap.topic ? (sent ? ", phone notified" : ", phone failed") : ""}`);
          continue;
        }

        // First crossing for this key. Persist before notifying so a reload
        // mid-notification cannot re-fire the same alert.
        setKnownCrossed((current) => {
          const next = new Set(current).add(key);
          writeList(CROSSED_KEY, [...next], CROSSED_CAP);
          return next;
        });
        const title = `Bloom risk crossed: ${name}`;
        const text = `${alert.horizon_days}-day probability ${pct}% is over your ${thresholdPct}% threshold.`;
        notifyDevice(title, text);
        const sent = await publishNtfy(title, text);
        pushLog(`${name} ${pct}% — device ${snap.permission === "granted" ? "notified" : "notification off"}${snap.topic ? (sent ? ", phone notified" : ", phone failed") : ""}`);
      }
    } catch (e: any) {
      const aborted = e?.name === "AbortError";
      const message = aborted
        ? `Alert check timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s — the watch is still running and will retry next poll.`
        : String(e?.message ?? e);
      setError(message);
      pushLog(`Check failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(WATCH_KEY, watching ? "1" : "0");
    } catch {
      // ignore
    }
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (watching && subscriberKey) {
      void checkOnce();
      timer.current = setInterval(() => void checkOnce(), POLL_MS);
    }
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, subscriberKey]);

  const testPublish = async () => {
    notifyDevice("BloomCast test", "Device notifications are working.");
    if (topic) {
      const sent = await publishNtfy("BloomCast test", "If your phone buzzed, the ntfy channel works end to end.");
      pushLog(sent ? "Test published to ntfy topic." : "ntfy publish failed — check the topic name and connection.");
    } else {
      pushLog("Device notification sent (no ntfy topic set).");
    }
  };

  return (
    <div className="glass rounded-2xl p-6 border border-border-subtle">
      <h3 className="font-display text-lg font-semibold tracking-wide">Alert delivery on this device</h3>
      <p className="text-xs text-fg-muted mt-1 mb-4">
        Free on every tier: browser notifications plus an ntfy phone channel. Checks run every
        minute while this page stays open — there is no background dispatcher on the free tier.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        {permission === "unsupported" ? (
          <span className="text-xs text-fg-muted">This browser cannot show notifications — use Chrome or Edge.</span>
        ) : permission === "granted" ? (
          <span className="text-xs font-mono px-2.5 py-1 rounded-full border border-glow-green/40 text-glow-green">DEVICE NOTIFICATIONS ON</span>
        ) : (
          <button
            onClick={requestPermission}
            className="px-4 py-2 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors"
          >
            Enable device notifications
          </button>
        )}
        <button
          onClick={() => setWatching((w) => !w)}
          disabled={!subscriberKey}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
            watching
              ? "bg-glow-red/10 border-glow-red/40 text-glow-red hover:bg-glow-red/20"
              : "bg-glow-green/10 border-glow-green/40 text-glow-green hover:bg-glow-green/20"
          }`}
        >
          {watching ? "Stop watching" : "Watch thresholds"}
        </button>
        <button
          onClick={testPublish}
          className="px-4 py-2 rounded-lg border border-border-subtle text-xs text-fg-secondary hover:text-glow-cyan transition-colors"
        >
          Send test
        </button>
      </div>

      <label className="block text-xs text-fg-muted mb-1.5" htmlFor="ntfy-topic">
        ntfy phone topic (optional — install the ntfy app and subscribe to the same topic)
      </label>
      <input
        id="ntfy-topic"
        value={topic}
        onChange={(e) => saveTopic(e.target.value)}
        placeholder="e.g. bloomcast-a3f9-q7xk"
        autoComplete="off"
        className="w-full bg-bg-deep border border-border-subtle rounded-lg px-3 py-2.5 text-fg-primary font-mono text-sm focus:border-glow-cyan outline-none"
      />
      <p className="mt-1.5 text-[11px] text-fg-faint">
        Anyone who guesses the topic can read these alerts — use something unguessable.
      </p>

      <div className="mt-4 text-xs font-mono text-fg-muted">
        {watching ? `Watching · last check ${lastCheck ?? "starting…"} · every 60s` : "Not watching."}
      </div>
      {error && <p className="mt-2 text-xs font-mono text-glow-red">{error}</p>}
      {log.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {log.map((line, i) => (
            <li key={`${i}-${line}`} className="text-xs font-mono text-fg-secondary rounded-lg border border-border-faint bg-bg-abyss/50 px-3 py-2">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
