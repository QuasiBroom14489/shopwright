# 0005 — Models run on the owner's Claude subscription

**Status:** accepted · 2026-10-13

## Context

Research (and later design, listing and editing) needs a strong model. The
owner already pays for a Claude subscription and uses Claude Code; a separate
API key would be a second bill and a second secret to guard.

## Decision

- **The default `LlmProvider` is `ClaudeCodeProvider`**
  (`connectors/claude-code/subscription.ts`). It calls Claude through the
  Claude Agent SDK, which uses the local `claude` login, so usage counts
  against the subscription.
- **It strips `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`** from the
  child process's environment, so a stray key never silently switches billing
  to the API.
- **Each call is isolated.** It loads no tools, no settings, no CLAUDE.md and
  no auto-memory, saves no session, and runs in a throwaway directory. The
  owner's personal context never reaches a shop prompt (ADR 0003). Vesper hit
  this leak when its research ran with user memory loaded.
- **Answers are structured.** Each request passes the zod schema as
  `outputFormat: json_schema`, and the answer is validated again with zod.
- **Cost is recorded as $0** with token counts. Subscription usage is measured
  in limits, not dollars, so per-shop budget caps will use tokens.
- `SHOPWRIGHT_LLM=api` still selects `ClaudeProvider` (Messages API, API key)
  for setups without a subscription. Both sit behind `LlmProvider`, and a local
  model can join later the same way.

## Consequences

- Shopwright needs a logged-in Claude Code on the machine that runs it. That
  fits a local-first app driven by Vesper on the same machine.
- Heavy automated use counts against the same limits as interactive Claude
  Code, so runs should stay small and deliberate.
