# 0004 — Etsy connector and compliance

**Status:** proposed · 2026-10-13. The endpoint inventory is pending the phase 0 spike.

## Context

Research, publishing and measurement all depend on Etsy. Etsy's terms forbid
scraping the site, its API needs an approved app key, and it has rules on
AI-assisted items, trademarks and digital downloads.

## Decision

- **Etsy data comes from the Open API v3 only.** The site is never scraped.
  - Research uses public endpoints with the app key alone.
  - Publishing and sales use OAuth2 (PKCE) for the owner's own shop.
- **The SDK and HTTP code live in `packages/core/src/connectors/etsy`.**
  Tokens go through a `CredentialStore`, never config, logs or the database in
  plaintext.
- **Connectors suggest, the owner confirms (L0).** Nothing is published,
  repriced, spent or sent to a buyer without an approval event.
- **Until the key is approved, publishing is a manual packet:**
  `dist/<sku>/` with files, images and listing text to paste in.
- **Compliance checks run in QA, before any approval is requested:**
  - A trademark blocklist covers designs, titles and tags.
  - AI-assisted work is disclosed where Etsy's creativity standards require it.
  - Listing limits: title ≤ 140 characters, 13 tags of ≤ 20 characters each,
    file count and size limits.
- **Research data from other shops is kept as evidence only.** It is never
  republished.

## Open (phase 0 spike)

- Which v3 endpoints and fields exist for listing search, review counts,
  receipts and per-listing stats such as views. Where stats are missing,
  measurement falls back to an owner-provided CSV import.
- The API terms on rate limits, caching and AI use.
