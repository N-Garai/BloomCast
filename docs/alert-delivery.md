# Alert delivery: what works where (and why)

BloomCast subscriptions (waterbody + threshold + horizon) are plain JSON rows.
*Detecting* a crossed threshold is free everywhere. *Delivering* the news to
a human depends on where the app runs — this page states the matrix honestly
so nobody designs around a channel that cannot fire.

## Channel matrix

| Channel | Render free tier | Local Docker | Windows / Android + page open |
|---|---|---|---|
| On-page threshold board (`/alerts`, Check now) | ✅ | ✅ | ✅ |
| Browser Notifications (this device) | ✅ page open | ✅ page open | ✅ Chrome/Edge, permission granted |
| ntfy phone channel (`https://ntfy.sh/<topic>`) | ✅ page open | ✅ page open | ✅ ntfy app installed + subscribed |
| Background push (tab closed) | ❌ | ❌ | ❌ |
| Email / SMS dispatch | ❌ | ❌ (no SMTP creds) | ❌ |

The free tier has no cron jobs and no background workers, and browsers cannot
push to a closed page — so there is no dispatcher that watches thresholds
overnight on any $0 setup. Alerts fire while the app is open: the Alerts page
polls `/v1/alerts/check` every 60 seconds and fans out to every enabled
channel on a *new* crossing (repeat polls of an already-crossed threshold
stay silent).

## Why ntfy (KiloNOVAScout alignment)

KiloNOVAScout solves the same gap server-side with `ALERT_WEBHOOK_URL` — any
HTTPS endpoint that accepts a JSON POST (Discord/Slack webhook, PagerDuty,
ntfy) — plus optional SMTP email, both requiring an always-on host with
secrets. Our setup keeps the webhook half of that pattern and drops the half
that needs a host:

- Their `ALERT_WEBHOOK_URL` → our ntfy topic publish (`POST
  https://ntfy.sh/<topic>`, keyless, CORS-open, free). Same shape: title,
  body, priority/tags. Same fire-and-forget semantics: publish failures are
  logged in the delivery log, never thrown.
- Their SMTP email → not available: no credentials, no background worker, no
  mail queue on the free tier. The in-app threshold board plus browser
  notifications cover the same "don't miss it while watching" need.

If BloomCast ever gains an always-on host, the honest upgrade is a scheduler
calling the existing `/v1/alerts/check` per subscriber and publishing to
their stored ntfy topic — the topic plumbing already exists client-side.

## Subscriptions and storage

Subscriptions live in the deployment's database plus an anonymous browser
key (`bc-subscriber`). Which database depends on one env var: if
`DATABASE_URL` points at Postgres (the free Neon setup in
`architecture.md`), subscriptions survive restarts and redeploys; otherwise
the container's local SQLite file is wiped without warning on ephemeral
hosts (Render free spin-downs, recreates without a volume). Until you confirm
which one the deployment uses, treat subscriptions as session-portable, not
permanent.

## Threshold presets and escalation (v3 M-V9)

**Presets are starting points, not guidance.** Selecting a waterbody pre-fills a
threshold and horizon from its type, because a river and a reservoir do not
share a defensible bloom threshold. The steward can move either control, and a
"Reset to preset" button appears once they have.

| Type | Starting threshold | Horizon | Reasoning |
|---|---|---|---|
| lake / reservoir | 60% | 5-day | large, slow-mixing water; slower response |
| estuary | 55% | 5-day | tidal variability widens the error band |
| river / stream | 50% | 3-day | fast response, so alert earlier and shorter |

These are UI defaults derived from hydrology, not calibrated values. Nothing
here is validated against incident data, and the UI does not claim otherwise.

**Escalation.** A threshold crossing notifies once. If the probability then
climbs to **at least 10 points above the threshold** on a later poll, one
escalation fires for that level ("Bloom risk rising: …"). Levels are 10-point
bands, so a risk climbing from +12 to +25 escalates twice, and each level is
capped at one notification per **6 hours**. Without the cooldown a steadily
rising trend would notify every 60 seconds, which is exactly how a steward
learns to ignore the channel.

**Still page-open only.** Presets and escalation make the watch smarter *within*
the existing envelope; they do not add background monitoring. There is no
server-side dispatcher on the free tier — Render has no cron — and browsers
cannot push to a closed page. Every notification here fires while the alerts
page is open.

## Dedup and history across reloads (v3 M-V6)

Crossed thresholds used to live in a React `useRef`, which resets on every
remount, so reloading mid-watch re-fired device and phone notifications for
alerts the steward had already received. Three keys now persist in
`localStorage`:

| Key | Holds | Cap |
|---|---|---|
| `bc-alert-crossed` | waterbody+horizon keys already alerted | 50 |
| `bc-alert-log` | the delivery log (audit trail) | 20 |
| `bc-alert-escalated` | escalation levels already sent | 50 |

The crossed key is written **before** the notification is sent, so a reload
landing mid-notification cannot duplicate it. All three degrade to in-memory
only when `localStorage` is unavailable (private mode, quota) — the watch keeps
working, it just forgets across reloads. No copy here implies the server
remembers anything.

## Poll timeout

Each check has a 15-second `AbortController` timeout. A hung upstream surfaces
as an explicit error line in the log ("Alert check timed out after 15s — the
watch is still running and will retry next poll") rather than silence, because
silence is indistinguishable from "no alerts" to someone watching a channel.

## Topic hygiene

An ntfy topic is a public-ish mailbox: anyone who guesses
`bloomcast-lake-zurich` can read those alerts. The UI suggests unguessable
topics and strips everything but `[a-z0-9_-]`. Rotate by changing the topic
— no server state references it.
