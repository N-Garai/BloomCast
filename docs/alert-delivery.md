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

Subscriptions live in the deployment's SQLite file plus an anonymous browser
key (`bc-subscriber`). Ephemeral hosts (Render free spin-downs, container
recreates without a volume) wipe them without warning — treat subscriptions
as session Portable, not permanent, until a durable store lands.

## Topic hygiene

An ntfy topic is a public-ish mailbox: anyone who guesses
`bloomcast-lake-zurich` can read those alerts. The UI suggests unguessable
topics and strips everything but `[a-z0-9_-]`. Rotate by changing the topic
— no server state references it.
