---
title: Supabase project paused: how to restore it on the Free plan
description: Supabase Free project paused? Why it happens, how to restore it within a year, the two-active-project limit, and an app to track several accounts at once.
date: 2026-09-29
updated: 2026-09-29
translation: projet-supabase-en-pause
answer: A free Supabase project is paused after one week of inactivity. You can restore it with one click from the dashboard for up to a year, and after that you can download its backup and files to restore them elsewhere. Since each account only gets two active free projects, you may have to pause another one first.
---

# Supabase project paused: understand it, restore it, stay organized

Your app has stopped responding, and the Supabase dashboard shows the project as "paused"? On the Free plan, this is expected behavior. Here is why it happens, how to bring the project back, and how to keep track of several accounts.

## Why a free project gets paused

Two rules of the Free plan explain almost everything:

- **Inactivity.** The [Supabase pricing page](https://supabase.com/pricing) states that a free project is paused after one week of inactivity. Supabase emails the owner roughly a week before the pause, then confirms it with a second email.
- **The project limit.** The [billing documentation](https://supabase.com/docs/guides/platform/billing-on-supabase) grants two free projects. The limit applies across all organizations where you are an Owner or Administrator. A paused project does not count toward it.

According to the Supabase documentation, a few requests to the database each day are usually enough to avoid the pause. These rules were checked on 29 September 2026. They can change: check them on the Supabase website before making an important decision.

## What the pause changes, and what it does not

A paused project stops responding, so the app that relies on it goes down. Your data, however, does not disappear right away.

According to the Supabase documentation, a paused project can be restored with one click from the dashboard during a one-year restore window. After that, you can still download the database backup and the storage files, then restore them into a new project. The same documentation states that a restored free project moves to the latest available minor version.

## Restoring a paused project, step by step

1. Open the Supabase dashboard and select the paused project.
2. Count your active projects. If you already have two, first pause the one you need least.
3. Start the restore from the project page. Allow a few minutes before everything responds.
4. Test your app: sign-in, reads, writes.
5. Keep in mind that a project that goes idle again will be paused again after the same delay.

**Example.** An account holds three projects: `api-demo` (active, used daily), `poc-client` (active, used now and then) and `showcase` (paused). A meeting tomorrow needs `showcase`. You are at 2 active projects out of 2: pause `poc-client`, then restore `showcase`. You stay at two active projects, and `api-demo` is never interrupted.

## Several accounts: keeping the big picture

Between prototypes and demos, people often juggle several Supabase accounts: their own, a team's, a client's. The dashboard shows one at a time, and knowing what is running, or what you can start, quickly becomes tedious. In every case, follow the Supabase terms of service.

## How Miss Supaboss helps

[Miss Supaboss](https://mister-guiiug.github.io/miss-supaboss/) is an installable web app that brings your free Supabase accounts together on one screen. It uses the Supabase Management API, with one personal access token per account.

- **A consolidated view**: every project from every account, with its status (active, paused, in progress, error), search, filters and sorting.
- **An active-project counter** per account (for example 2/2), and a five-step "Prepare the demo" flow that suggests which projects to pause first: your favorites and "frequent demos" come last, the least recently active come first.
- **Pause and restore** from the app, after confirmation, with a history of operations.
- **Free plan quotas**, project by project: database size, file storage, monthly active users (an estimate), with adjustable alert thresholds (70, 85 and 95% by default). Egress is not exposed by the public API, so the app shows it as unavailable.
- **The pause date**, when the app saw the project being paused, and an estimate of when the restore window ends, whose length you set in the Settings.
- **In the self-hosted version** (a server started with Docker): scheduled pauses and restores, for example every Friday evening, and alerts through Web Push notifications or a webhook.

## Getting started

The published version opens with sample data: you can try everything without connecting anything. For your real accounts, turn off demo mode in the Settings, then add each account with a clear name and its personal access token, created from your Supabase account (Access Tokens section).

The token stays on your device, stored in plain text by default; you can encrypt it with a passphrase, asked for at each launch. It is only sent to the app's relay, over HTTPS, which forwards it to the Supabase API without keeping it. A classic token opens all your organizations: use a trusted device, and revoke the token in Supabase at the slightest doubt. Supabase also offers tokens limited to the projects and permissions you choose; if you use one, check that it can list, pause, restore and read your projects.

Miss Supaboss is an independent app, neither affiliated with nor endorsed by Supabase. Supabase is a trademark of its owner. The French original of this guide is [Projet Supabase en pause](../projet-supabase-en-pause.html).

## Frequently asked questions

### How long before a free Supabase project is paused?

At the time of writing, the Supabase pricing page says one week of inactivity. The rule may change: rely on the current page.

### Does a paused project count toward the two-free-project limit?

No. The Supabase documentation states that paused projects do not count toward the limit. That is why pausing a rarely used project lets you restore another one.

### Is my data lost while the project is paused?

Not right away. During the one-year restore window, one click is enough. After that, Supabase lets you download the backup and the files to restore them elsewhere. Do not count on unlimited retention.

### Does Miss Supaboss prevent the pause?

No. It does not keep your projects awake. It shows you what is active or paused, helps you restore the right project without exceeding the limit and, in the self-hosted version, schedules pauses and restores.

## References

- [Supabase pricing](https://supabase.com/pricing): pause after one week of inactivity.
- [About billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase): two free projects, paused projects not counted.
- [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing): warning emails, one-year restore window.
- [Upgrading](https://supabase.com/docs/guides/platform/upgrading): minor version on restore, backup download after the window.
- [Personal access tokens](https://supabase.com/docs/guides/platform/personal-access-tokens): classic and scoped tokens.
