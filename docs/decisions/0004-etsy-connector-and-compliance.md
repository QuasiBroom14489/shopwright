# 0004 — Etsy connector and compliance

**Status:** proposed · 2026-10-13. Endpoints confirmed by the spike; the terms question below blocks the research design.

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

## Phase 0 spike · 2026-10-13 (Open API v3 spec 3.0.0)

**Public endpoints (app key only):**
- `findAllListingsActive` (`GET /v3/application/listings/active`) supports
  `keywords`, `sort_on` (created, price, updated, score), `min_price`/`max_price`
  and `taxonomy_id`, with `limit` ≤ 100 plus `offset`.
- Single listings and batches: `getListing`, `getListingsByListingIds`.
- Reviews: `getReviewsByListing`, `getReviewsByShop` (rating, timestamps).
- Shops: `getShop`, `findAllActiveListingsByShop`.
- Taxonomy: `getBuyerTaxonomyNodes`, `getSellerTaxonomyNodes`.

**Useful fields:**
- `ShopListing` has `num_favorers`, `price`, `tags`, `taxonomy_id`,
  `listing_type` (`physical` | `download` | `both`), `creation_timestamp`
  and `original_creation_timestamp`. It has **no `views` field.**
- `Shop` has `transaction_sold_count`, `review_count`, `review_average`,
  `num_favorers`, `listing_active_count` and `digital_listing_count`.

**OAuth2, owner's shop only:**
- `createDraftListing`, `updateListing`, `uploadListingFile` and
  `uploadListingImage` need `listings_w`.
- `getShopReceipts` and the per-listing transactions endpoint need
  `transactions_r`.

**There is no stats endpoint.** Views and visits for our own listings aren't
available through the API, so measurement uses receipts (sales) plus an
owner-provided Shop Manager stats CSV for views.

**Terms (blocking).** The current API terms page returns 403 to automated
fetches. An archived version says the API may not be used "to collect, scan, or
request Etsy content for analytics or machine learning" without Etsy's express
authorization. Secondary sources say a seller app is limited to the registered
shop. Until the live terms are read, competitor research through the API is
**not assumed to be allowed**.

## Decision · 2026-10-13: research runs on imported evidence

Research doesn't use Etsy's API for competitor data. The Etsy evidence is
**imported**: the owner reads Etsy search in a browser and fills in CSV
templates that the research run generates. Google Trends data comes from its
own CSV export. Both are snapshotted like any other evidence (ADR 0002), so
replays stay byte-identical. In parallel the owner will apply for API access
and describe the research use. If Etsy approves it in writing, an API source
can be added beside the import one without changing how runs are scored.
