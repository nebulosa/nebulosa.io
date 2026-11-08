---
title: "AI multiplies your engineers. Including the bad ones."
date: 2026-10-26
description: "Coding agents amplify whoever steers them. What that looks like in real systems, and how Nebulosa screens engineers for judgment."
tags: [AIEngineering, StaffAugmentation, Nearshore, SoftwareQuality]
image: /assets/img/blog/ai-multiplies-your-engineers.png
linkedin_original: https://www.linkedin.com/pulse/ai-multiplies-your-engineers-including-bad-ones-nebulosa-io-oetye
---

A weak engineer used to cost you a slow sprint. A few hundred lines a week, a reviewer catching most of the mess, a manager noticing by month two.

With a coding agent, that same engineer ships four thousand lines before Friday. The pull requests look clean, the tests are green, and the design decisions underneath are still bad. Only now there are ten times as many of them, spread across your codebase.

## The data agrees

Google's DORA team surveyed nearly 5,000 technology professionals for its 2025 report on AI-assisted development. Their headline: AI acts as an amplifier. It magnifies what high-performing teams already do well, and the dysfunctions of teams that struggle. Throughput went up with AI adoption. Delivery instability kept rising too.

GitClear analyzed 211 million lines of code and found the same pattern from another angle. In 2024, code blocks with five or more duplicated lines grew eightfold, and moved (refactored) lines fell almost 40%. It was the first year copy-paste outnumbered refactoring.

Agents write code fast. Whether that code stays cheap to change depends on the person steering them.

## What it looks like in a real business

A fintech reconciliation service. The agent needs rounding rules and writes them inline, four times, in four files. Months later, a regulator changes the rule. Someone updates three of them. The fourth produces a one-cent mismatch per transaction that finance spends a quarter chasing.

A marketplace order API. A junior asks for "retry on failure" and gets exactly that, minus an idempotency key. Under load, the payment provider times out, the job retries, and a slice of customers are charged twice on your biggest sales day.

A SaaS reporting module. Every new report gets its own query, written from scratch by the agent. Each one is fine alone. Together they turn the database into the bottleneck, and nobody can say which of 60 near-identical queries to optimize.

A logistics schema migration. Generated in seconds, reviewed in minutes, no down migration. It works in staging. In production it locks a table during peak hours, and rolling back means a manual restore.

None of these are model failures. The model did what it was asked. The missing piece was someone who knew what to ask, and what to reject.

## What a good engineer adds now

Typing speed stopped being a differentiator. What separates engineers in 2026 is judgment:

- They read what the agent wrote. Every line that reaches main has an owner who can explain it.
- They keep the system coherent. Before generating something new, they check whether it already exists and extend it.
- They specify before they prompt. Constraints, failure modes and edge cases go into the task, not into the postmortem.
- They write the tests the agent can't guess. Business rules, money paths and concurrency get explicit checks.
- They delete code. Smaller diffs, fewer abstractions, less for the next person and the next agent to misread.

A strong engineer with an agent is a small team. A weak one with an agent is a growing maintenance bill.

## How Nebulosa staffs your team

Nebulosa provides managed engineering contractors from Latin America for companies that need to grow their team or run part of it. You get engineers who work in your stack, your time zone and your repos, and we handle the rest:

- Screening for judgment. Candidates review an AI-generated pull request and tell us what they'd send back, and why.
- Working agreements for AI. Clear rules on which agents are used, what needs human review and how changes are tested, agreed with you on day one.
- Ongoing management. Code quality checks, performance follow-up and replacement if someone isn't a fit, so your leads aren't doing HR.
- One contract. English and Spanish, US time-zone overlap, scale up or down as your roadmap changes.

The cost of a bad hire grew with every model release. The upside of a good one grew faster.

## Sources

- [DORA, 2025 State of AI-assisted Software Development, Google Cloud](https://dora.dev/research/ai)
- [InfoQ, DORA 2025: State of AI-assisted Software Development](https://www.infoq.com/news/2025/09/dora-state-of-ai-in-dev-2025)
- [DevClass, AI is eroding code quality, states new in-depth report (GitClear, 2025)](https://devclass.com/2025/02/20/ai-is-eroding-code-quality-states-new-in-depth-report/)
