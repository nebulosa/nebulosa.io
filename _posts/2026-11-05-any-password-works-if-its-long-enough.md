---
title: "Any password works, if it's long enough"
date: 2026-11-05
description: "A musl quirk lets any 257+ character password log in to some Alpine servers running OpenSSH without PAM. Who's exposed and what to do now."
tags: [DevSecOps, CyberSecurity, OpenSSH, CloudSecurity]
image: /assets/img/blog/any-password-works-if-its-long-enough.png
linkedin_original: https://www.linkedin.com/pulse/any-password-works-its-long-enough-nebulosa-io-mbrge
---

On November 5, OpenSSH shipped an emergency release and Alpine Linux published an advisory. The bug, nicknamed sshole, lets anyone log in to certain accounts on Alpine servers with any password between 257 and 1,024 characters. One connection, no brute force.

## Two defaults that collide

Since 2012, musl's crypt() returns "\*" when it can't hash a password, and anything over 256 bytes fails. "\*" is also what Linux stores for an account with no password. Long password in, "\*" out, "\*" on file: login accepted. A 2016 OpenSSH change makes sshd borrow another account's salt, so the attack only needs one user on the box with a real password.

## Who's exposed

All four at once: Alpine (or another musl system) running OpenSSH without PAM, which is how Alpine ships it; password logins on, the default; an account with no password set ("\*", not locked with "!"); and another account that has one. Debian, Ubuntu, PAM setups and containers that don't run sshd are fine.

Where it bites: a payroll SaaS takes client files over SFTP in an Alpine container. Clients use passwords, the internal ops account uses keys only. Anyone who reaches port 22 can sign in as ops. Or an Alpine cloud VM whose alpine user (passwordless doas, so root) was safe until someone added a password account for an auditor.

## What to do now

- Run `apk upgrade -U -a` and restart sshd. Upgrading the package doesn't replace the running daemon.
- Turn off password logins wherever keys work.
- Lock unused accounts with "!" instead of leaving them empty.
- Search auth logs for "Accepted password for" on key-only users. If you can't rule one out, treat the host as compromised.

The same week, a Paint RCE fix that some Windows fleets couldn't get from the Store, and an AI coding agent sending its user's email to third-party sites, made the same point: the risk sits in defaults nobody reviewed.

## How Nebulosa helps

We inventory what actually runs on your hosts, VMs and edge devices, enforce SSH and account baselines in CI, and keep one patch report across packages, images and apps. Send us your list of base images and hosts, and within days you'll know which ones would have let a 257-character password in.

## Sources

- [Alpine Linux: Security advisory, openssh-server password authentication bypass](https://alpinelinux.org/posts/2026-11-05-openssh-password-authentication-bypass/)
- [Upwind: sshole, Alpine/musl OpenSSH accepts any 257+ character password](https://www.upwind.io/blog/sshole-alpine-musl-openssh-accepts-any-257-character-password)
- [LWN.net: Critical security vulnerability affects OpenSSH on Alpine Linux systems](https://lwn.net/Articles/1105464/)
- [Techzine: Paint vulnerability allows RCE, patch is hard to find](https://www.techzine.eu/news/security/145581/paint-vulnerability-allows-rce-patch-is-hard-to-find/)
- [GitHub: anthropics/claude-code issue #101659](https://github.com/anthropics/claude-code/issues/101659)
