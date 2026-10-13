# 0002 — The playbook, and why every run is reproducible

**Status:** accepted · 2026-10-13

## Context

Shopwright exists to run a digital-download shop from niche research through
listings and sales, mostly by AI workers. A niche that sells today will
flatten. When it does, the owner should be able to run the same process again,
to add a product line or start a new shop, and trust that it is the same
process: same method, comparable results, and a record of why each choice was
made.

## Decision

- **The playbook is a fixed sequence of stages:** `research → select → brand →
  rubric → design → produce → list → publish → measure`, then back to
  `research` when the plateau check fires.
- **A run is one execution of one stage.** `run.started` records its inputs,
  a `configVersion` and `promptVersions` (content hashes from `versionOf`),
  and what it is `basedOn`. `run.completed` records its artifacts by path and
  sha256. Model calls are `llm.called` events charged to the run.
- **Evidence is snapshotted.** Anything fetched from outside (Etsy API
  responses, trend data, web results, and every LLM judgment used for a
  decision) is saved under the run's folder, content-hashed, before it is
  used.
- **Decisions are deterministic code over evidence.** Scoring and ranking are
  plain functions with weights in versioned config. The LLM proposes ideas and
  makes judgments; those judgments are stored as evidence, and they never
  directly decide anything.
- **Two ways to run a stage again:**
  - `replay`: the same evidence and config produce byte-identical output. This
    is a test, and CI runs it on fixtures.
  - `like`: the same method (inputs and config) on fresh evidence. This is what
    a plateau triggers.
- **A plateau is a suggestion, not an action.** The measure stage proposes a
  new research run; the owner confirms it.

## Consequences

- A changed weight shows up as a new `configVersion`, so two runs' rankings
  can be compared honestly.
- Snapshots take disk space and may hold third-party data. They live in the
  private data repo (ADR 0003), never in this one.
- LLM output is never treated as reproducible; only what was recorded is.
