"use client";

import { useEffect, useRef, useState } from "react";

import { API } from "@/lib/api";
import { waterbodyName, type WaterbodyOption } from "@/lib/waterbodies";

const POLL_MS = 60_000;
const TOPIC_KEY = "bc-ntfy-topic";
const WATCH_KEY = "bc-alert-watch";

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
 * stays open. KiloNOVAScout solves the same gap server-side with an
 * ALERT_WEBHOOK_URL that needs an always-on host; ntfy is our zero-host
 * equivalent of that webhook channel.
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
  const knownCrossed = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      setTopic(localStorage.getItem(TOPIC_KEY) || "");
      setWatching(localStorage.getItem(WATCH_KEY) === "1");
    } catch {
      // Private mode — notifications still work, topics just don't persist.
    }
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
    setLog((current) => [`${new Date().toLocaleTimeString()} — ${line}`, ...current].slice(0, 5));
  };

  const notifyDevice = (title: string, body: string) => {
    try {
      if (permission === "granted") {
        new Notification(title, { body, tag: `bloomcast-${Date.now()}` });
      }
    } catch {
      // Notification constructor can throw in some embedded webviews.
    }
  };

  const publishNtfy = async (title: string, body: string) => {
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
    if (!subscriberKey) return;
    setError(null);
    try {
      const response = await fetch(`${API}/v1/alerts/check?subscriber_key=${encodeURIComponent(subscriberKey)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail ?? `HTTP ${response.status}`);
      const crossed = (data.alerts ?? []).filter((a: any) => a.crossed);
      setLastCheck(new Date().toLocaleTimeString());
      for (const alert of crossed) {
        const key = `${alert.waterbody_id}-${alert.horizon_days}`;
        if (knownCrossed.current.has(key)) continue;
        knownCrossed.current.add(key);
        const name = waterbodyName(waterbodies, alert.waterbody_id);
        const pct = Math.round((alert.current_probability ?? 0) * 100);
        const title = `Bloom risk crossed: ${name}`;
        const body = `${alert.horizon_days}-day probability ${pct}% is over your threshold.`;
        notifyDevice(title, body);
        const sent = await publishNtfy(title, body);
        pushLog(`${name} ${pct}% — device ${permission === "granted" ? "notified" : "notification off"}${topic ? (sent ? ", phone notified" : ", phone failed") : ""}`);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
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
