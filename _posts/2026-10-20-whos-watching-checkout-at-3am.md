---
title: "Who's watching checkout at 3 a.m.?"
date: 2026-10-20
description: "One read-only AI agent per subsystem, plus a coordinator that pages a person once. How we'd watch production at 3 a.m."
tags: [AIAgents, SRE, Observability, DevOps]
image: /assets/img/blog/whos-watching-checkout-at-3am.png
linkedin_original: https://www.linkedin.com/pulse/whos-watching-checkout-3-am-nebulosa-io-kjfye
---

Production rarely breaks at noon. It breaks at 3 a.m., quietly: a queue that keeps growing, a config change that only hurts one region.

AI agents suit this kind of watch. They don't sleep and they don't get bored. Their limit is context: a model sees only so much text at once, and a full stack, with its logs, metrics and code, will never fit. Ask one agent to cover all of it and it either samples too thin or forgets what it saw an hour ago.

## One subsystem, one specialist

Split the stack the way your team already does, and give each part its own agent:

- Narrow context. It reads only its subsystem's logs, metrics and code.
- Read-only. It can query and investigate, never deploy or restart.
- Cheap by default. It writes its checks once, a scheduler runs them, and a stronger model joins only when something looks off.

A coordinator sits on top. It never sees raw logs, only short findings, and turns three related signals into one incident for the on-call engineer.

## Where we'd start

- Payments: decline rates by bank and webhook delays, caught before support hears about them.
- Checkout: checks written for each release's diff, ending in a clear keep-or-roll-back call.
- Nightly data load: stale tables flagged before the 8 a.m. meeting.
- Cloud bill: a forgotten debug log or a stuck autoscaler, spotted the same day.

## Start with one

Pick the subsystem that hurts most when it fails silently. We'll build its specialist on your telemetry, read-only, next to the alerts you already have.
