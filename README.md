# Shopwright

A reproducible AI playbook for digital-download Etsy shops: niche research,
products as code, listings, approvals and KPIs.

When a niche stops growing, you shouldn't have to remember how you found it.
Shopwright runs the whole process as recorded stages, so it can run again on
fresh data, and every choice can be traced back to the evidence behind it.

> Status: **phase 1**. Research works end to end: candidates, evidence templates,
> deterministic ranking, product ideas, replay and like. Brand, products and listings are next.

## The playbook

```
research → select → brand → rubric → design → produce → list → publish → measure
   ▲                                                                       │
   └────────────── plateau: suggest a new line or a new shop ◄──────────────┘
```

- **Research** scores niches on demand, competition, price, how well they can
  be built as code, variant potential and fit, using snapshotted evidence from
  Etsy's API and trend data.
- **Products are code:** HTML/CSS templates rendered to PDF by headless Chrome,
  with variants (sizes, years, themes, hyperlinked digital planners) and
  automatic QA.
- **The owner approves** specs, listings, prices and anything sent to a buyer.
  AI workers do the rest.

## Design

- An **append-only event log**, with state derived from it (ADR 0001).
- **Every run is reproducible:** a `replay` is byte-identical, and `like`
  repeats the method on new data (ADR 0002).
- **Public engine, private data:** shop data lives in a separate private repo
  (ADR 0003).
- **Models run on your Claude subscription** through the Claude Agent SDK, with
  isolated calls and no API key (ADR 0005).
- **Etsy through its Open API only**, with compliance checks before any
  approval is requested (ADR 0004).

## Research, step by step

```sh
shopwright research start --seeds "study planners,budget trackers"   # Claude proposes niches + writes CSV templates
# fill in collect/listings.csv and keywords.csv from Etsy search by hand; drop Google Trends CSVs in collect/trends/
shopwright research score <run>    # snapshot evidence, rank, product ideas, report.md
shopwright research replay <run>   # must reproduce report.md byte for byte
shopwright research like <run>     # same method, fresh evidence (when sales plateau)
```

Etsy data is collected by hand, not through the API or scraping (ADR 0004).

## Layout

```
packages/shared/   event kinds and entity types
packages/core/     the engine: db, event log, folds, runs (research, render, … to come)
apps/cli/          `shopwright` command line
```

## Setup

Requires Node 24+ and pnpm.

```sh
pnpm install && pnpm build
node apps/cli/dist/cli.js init            # creates ~/shopwright-data (make it a private repo)
node apps/cli/dist/cli.js shop create my-shop My Shop
```

`pnpm test`, `pnpm lint` and `pnpm typecheck` run in CI.
