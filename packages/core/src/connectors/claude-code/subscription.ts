import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  type JsonRequest,
  type LlmProvider,
  type LlmResult,
  promptHash,
} from '../../llm/provider.js';

export interface ClaudeCodeOptions {
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/**
 * Claude through the Claude Agent SDK, billed to the owner's Claude
 * subscription (the `claude` login), not an API key. The call is isolated:
 * no tools, no settings or CLAUDE.md, no memory, no saved session, and a
 * throwaway working directory, so nothing about the owner leaks into a
 * prompt (ADR 0003).
 */
/** zod's JSON Schema without the draft tag, which Claude Code's validator doesn't resolve. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _draft, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export class ClaudeCodeProvider implements LlmProvider {
  readonly name = 'claude-code';
  readonly model: string;
  private readonly effort: NonNullable<ClaudeCodeOptions['effort']>;

  constructor(opts: ClaudeCodeOptions = {}) {
    this.model = opts.model ?? 'claude-opus-5-5';
    this.effort = opts.effort ?? 'high';
  }

  async json<S extends z.ZodType>(req: JsonRequest<S>): Promise<LlmResult<z.infer<S>>> {
    const cwd = mkdtempSync(join(tmpdir(), 'shopwright-llm-'));
    // An API key in the environment would take precedence over the
    // subscription login, so it never reaches the Claude Code process.
    const { ANTHROPIC_API_KEY: _key, ANTHROPIC_AUTH_TOKEN: _token, ...env } = process.env;
    try {
      let result: {
        structured?: unknown;
        error?: string;
        model?: string;
        tokens: [number, number];
      } | null = null;
      let model = this.model;
      for await (const msg of query({
        prompt: req.prompt,
        options: {
          systemPrompt: req.system,
          model: this.model,
          effort: this.effort,
          tools: [],
          settingSources: [],
          persistSession: false,
          maxTurns: 3,
          cwd,
          env: { ...env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
          outputFormat: {
            type: 'json_schema',
            schema: jsonSchema(req.schema),
          },
        },
      })) {
        if (msg.type === 'assistant' && msg.message.model) model = msg.message.model;
        if (msg.type === 'result') {
          const usage = msg.usage;
          const tokens: [number, number] = [
            usage.input_tokens +
              (usage.cache_read_input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0),
            usage.output_tokens,
          ];
          result =
            msg.subtype === 'success'
              ? { structured: msg.structured_output, tokens }
              : {
                  error: `${msg.subtype}${msg.errors?.length ? `: ${msg.errors.join('; ')}` : ''}`,
                  tokens,
                };
        }
      }
      if (!result) throw new Error(`${req.purpose}: Claude Code returned no result`);
      if (result.error)
        throw new Error(
          `${req.purpose} failed (${result.error}). Is \`claude\` logged in to your subscription?`,
        );
      const value = req.schema.parse(result.structured) as z.infer<S>;
      return {
        value,
        call: {
          provider: this.name,
          model,
          purpose: req.purpose,
          promptHash: promptHash(req.system, req.prompt),
          inputTokens: result.tokens[0],
          outputTokens: result.tokens[1],
          // Covered by the subscription; usage counts against its limits, not dollars.
          costUsd: 0,
        },
      };
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
}
