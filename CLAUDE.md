# Shopwright — house rules

- **Business logic lives in `packages/core`.** `apps/cli`, `apps/mcp` and
  `apps/web` are shells: they validate input, call `Shopwright`, render output.
- **Events are append-only** (enforced by triggers). Never add an UPDATE/DELETE
  on `events`; never change an existing event kind's meaning. Add a new kind.
- **State is derived** (`foldRun` and friends). Don't add status columns.
- **Every event has a scope:** `shop_id`, `line_id`, `run_id`; NULL `shop_id`
  means studio level (ADR 0001). Add new migrations to the end of `MIGRATIONS`
  in `db.ts`; never edit a shipped one.
- **Reproducibility (ADR 0002):** anything fetched or generated that a decision
  depends on is saved as evidence before use; decisions are deterministic code
  over evidence with versioned config; `replay` must be byte-identical.
- **No shop data in this repo (ADR 0003).** It lives in `$SHOPWRIGHT_DATA`.
  Tests and fixtures use the fictional demo shop only.
- **Etsy via the Open API only, never scraping (ADR 0004).** Vendor code lives
  only in `packages/core/src/connectors/<provider>`; secrets go through a
  `CredentialStore`, never config, logs or plaintext in the database.
- **Suggest, then confirm.** Nothing is published, repriced, spent or sent to a
  buyer without an approval event.
- **Models run on the Claude subscription (ADR 0005)** through `ClaudeCodeProvider`:
  isolated calls, no API key. All model access goes through `LlmProvider`.
- The database is `@libsql/client` behind `Db` in `db.ts`: no ORM, every call async.
- Tests run against `src/` via vitest aliases; `pnpm build` before `pnpm typecheck`.
- Conventional commits. Record structural decisions as ADRs in `docs/decisions/`.
