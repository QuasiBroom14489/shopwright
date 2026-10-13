# 0001 — libSQL with an append-only event log

**Status:** accepted · 2026-10-13

## Context

A shop is a sequence of things that *happen*: a research run ranked niches, a
product was approved, a listing went live, a sale came in, revenue stopped
growing. The questions worth asking are about that sequence: which research
picked the line that sells, how long approvals take, what each line earns
after fees and model costs. A status column answers none of them.

## Decision

- **libSQL** (`@libsql/client`) behind the `Db` interface in
  `packages/core/src/db.ts` is the single source of truth: one local file, or
  a hosted database later with no code change. This is the same engine and
  interface as OfferDesk.
- **Events are append-only.** Triggers abort any `UPDATE` or `DELETE` on
  `events`. New facts get new kinds; a kind's meaning never changes.
- **State is derived.** A run's status, artifacts and cost are folded from its
  events (`foldRun`). Sales, approvals and KPIs will be folds too.
- **Entity tables stay mutable** for descriptive facts (a shop's name, a line's
  niche).
- **Every event carries a scope:** `shop_id`, `line_id`, `run_id`. A NULL
  `shop_id` means *studio level*: work that belongs to no shop yet, such as
  research for a shop that doesn't exist, or anything that spans shops.

## Consequences

- Per-shop and per-line P&L, rubric-vs-owner agreement and "minutes of my time
  per week" can be added later without a migration.
- A mistake is corrected by appending, so the timeline shows it.
- If folding on read gets slow, add a cache table rebuilt from `events`.
