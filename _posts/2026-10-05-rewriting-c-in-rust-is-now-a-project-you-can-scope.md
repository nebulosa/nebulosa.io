---
title: "Rewriting C in Rust is now a project you can scope"
date: 2026-10-05
description: "AI now writes the first draft of C-to-Rust migrations. The real work is the test oracle, the unsafe boundary and a way back. How we run it."
tags: [Rust, MemorySafety, DevSecOps, AppSec, AIEngineering]
image: /assets/img/blog/rewriting-c-in-rust-is-now-a-project-you-can-scope.png
linkedin_original: https://www.linkedin.com/pulse/rewriting-c-rust-now-project-you-can-scope-nebulosa-io-6nwxf
---

For years, "rewrite it in Rust" was a good idea that no budget could carry. A mature C library is thousands of lines of pointer logic, and nobody wanted to retype it by hand.

That changed in 2026. [Google's security team](https://bughunters.google.com/blog/scaling-memory-safety) now has AI agents doing the first draft of C-to-Rust migrations, and engineers spending their time on verification instead of typing.

The pressure behind it is not new. Memory safety bugs account for about 70% of vulnerabilities in C and C++ codebases, according to Google's security team. What is new is the clock: as models get better at finding bugs, the time between discovery and exploit keeps shrinking.

## What Google showed this fall

Two Google announcements, weeks apart, moved this from research to practice.

**The pilot: giflib.** Google's security team [rewrote giflib](https://bughunters.google.com/blog/scaling-memory-safety), a widely used C library for GIF images, using Gemini.

- About 3,000 lines of C, translated to Rust in one shot.
- The first draft had "an initially very unsound memory management pattern" at the C boundary. Engineers iterated with the model until experts signed off on every unsafe block.
- Validation: 30 million real GIFs with identical output, and a differential fuzzer running C and Rust side by side for six days and 200 million iterations with no deviations.
- In production it was performance-neutral, and it let some services drop the sandbox they ran around the C library.
- Soon after rollout, a new heap overflow was reported in the C original (CVE-2026-26740). Google's services were already on Rust. The port is open source as [giflib-rs](https://github.com/google/giflib-rs).

**The model: Gemini 4 Argon.** On September 30, Google announced [Gemini 4 Argon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/). It is a general frontier model, but migrations were one of its headline uses.

- Argon agents are moving C/C++ codebases to Rust across Google, from core libraries like re2 and libgav1 up to the 800K+ line Fuchsia Zircon kernel.
- In libgav1, a video decoder, agents replaced 32K lines of SIMD code with safe Rust the compiler can vectorize. It runs 2.7x faster than the earlier Rust port, with identical video output.
- Access is limited for now: trusted cyber defenders first, then paid API customers and Google AI Ultra subscribers.

## The translation is the easy part

Google's own write-up is clear that AI rewrites are not hands-off. The work moved from typing code to proving it behaves the same. Four things decide whether a rewrite reaches production:

- **The C boundary.** Existing callers still speak C, so the Rust library has to expose the same API. That layer is unsafe by nature, and pointer ownership there needs an expert's eye on every line.
- **Proof of equivalence.** Google says you need "large amounts of real-world data or good existing tests." Without a corpus of real inputs, there is nothing to compare the Rust version against.
- **Trust and rollback.** Service owners will not swap a dependency on faith. Google calls it the social side of security: transparent validation and a defined way back.
- **Life after the rewrite.** A fork in a new language drifts from upstream. If the C project is still active, someone has to own that gap.

Scope matters too. Google picked giflib because it was small, stable and had no SIMD or assembly. Hand-tuned SIMD code, like libgav1's, took many rounds of profile-guided work.

## How we run a C-to-Rust rewrite

We start with the test oracle, not the translation. The order matters, because every later step depends on having something to compare against.

1. **Pick the right target.** Rank your C components by exposure (does it parse untrusted input?), size, SIMD or assembly, and how active upstream is. Start where risk is high and complexity is low.
2. **Build the oracle first.** Collect real inputs from production, existing tests and fuzz corpora. Set up a harness that runs the C and Rust versions side by side on the same input.
3. **Draft with AI.** A frontier model writes the first Rust version. For a mechanical baseline, open source [C2Rust](https://github.com/immunant/c2rust) can transpile C99 to unsafe Rust inside your own infrastructure, so code never leaves it.
4. **Harden the C boundary.** Keep the same API so callers don't change. Every unsafe block gets a human review, and ownership rules at the boundary are written down.
5. **Prove it behaves the same.** Regression on real data plus differential fuzzing. Every mismatch goes back to the model as a targeted fix until the fuzzer runs clean.
6. **Ship it behind a switch.** Canary or blue-green rollout, the C version kept as fallback, and metrics on latency and errors from day one.
7. **Decide on upstream.** Maintain a fork, contribute back, or plan an idiomatic rewrite later. Someone owns that call before go-live.

## Where a rewrite pays off first

- **Parsers for user uploads.** Images, PDFs, archives and spreadsheets go through C libraries that read untrusted bytes. A Rust drop-in with the same API closes the memory bug class there, and can retire the sandbox you run around it.
- **Network-facing protocol code.** Gateways, proxies and device agents that decode packets in C. Moving the decoder to Rust removes the most exposed memory-unsafe code from the edge, without touching the rest of the stack.
- **Native extensions in Python or Node services.** A C extension that occasionally crashes a worker is a classic hidden cost. Rewritten in Rust behind the same interface, the service code doesn't change and the crashes have one less place to come from.
- **The C module nobody wants to touch.** Every company has one: critical, undocumented, owned by whoever is left. A verified Rust version with a test oracle around it turns it back into code your team can change.

## Bring us your C

The model writes the first draft fast. The real work is choosing what to migrate, building the oracle, owning the unsafe boundary and shipping with a way back. That's what we do.

Have a C library that reads untrusted input? Send us the repo and a sample of real inputs. We'll build a proof of concept: a Rust drop-in running side by side with your C version under a differential fuzzer, so you see the evidence before you decide.

## Sources

- [Scaling Memory Safety: AI-Assisted Rewrites of C/C++ Dependencies to Rust, Google Bug Hunters](https://bughunters.google.com/blog/scaling-memory-safety)
- [Gemini 4 Argon: our next era of frontier intelligence, Google, Sep 30, 2026](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/)
- [google/giflib-rs, GitHub](https://github.com/google/giflib-rs)
- [immunant/c2rust, GitHub](https://github.com/immunant/c2rust)
