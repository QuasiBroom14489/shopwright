# 0003 — Public engine, private data

**Status:** accepted · 2026-10-13

## Context

The engine is worth showing: an event-sourced core, reproducible research, and
products as code. The shops are not: their brands, products, research
evidence, account credentials and sales belong to a real business, and
publishing a winning niche invites copies.

## Decision

- **This repo is public and holds no shop data.** `.gitignore` excludes
  databases, `.env*`, PDFs, zips, `data/` and `shops/`.
- **Shop data lives in a data dir**, `$SHOPWRIGHT_DATA` (default
  `~/shopwright-data`), which is meant to be its own **private** git repo:
  - `shops/<slug>/`: `brand/`, `rubric.md`, `gold/`, `products/<sku>/`,
    `listings/`, `research/<run-id>/`.
  - `studio/`: studio-level runs, e.g. research before a shop exists.
  - The database file and `.env` are gitignored inside it too; `shopwright
    init` writes that `.gitignore`.
- **Each shop is an isolated tenant** (Vesper's candidate rule 5): its own
  email, Etsy account and credentials. A worker on one shop never sees
  another's data or the owner's personal context.
- **Tests, fixtures and screenshots use a fictional demo shop only.**

## Consequences

- Products, templates and research are versioned by git in the data repo, so
  "what did we sell in March and why" has an answer.
- Two repos to keep in sync is a small cost; the CLI always points at one data
  dir.
