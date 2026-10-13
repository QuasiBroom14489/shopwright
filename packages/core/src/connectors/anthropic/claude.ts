import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import {
  type JsonRequest,
  type LlmProvider,
  type LlmResult,
  promptHash,
} from '../../llm/provider.js';

/** USD per million tokens (input, output), first-party API rates. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export interface ClaudeOptions {
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/**
 * Claude through the Messages API with structured outputs. Credentials come
 * from the environment (ANTHROPIC_API_KEY or an `ant auth login` profile),
 * never from config.
 */
export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude';
  private readonly client = new Anthropic();
  readonly model: string;
  private readonly effort: NonNullable<ClaudeOptions['effort']>;

  constructor(opts: ClaudeOptions = {}) {
    this.model = opts.model ?? 'claude-opus-5-5';
    this.effort = opts.effort ?? 'high';
  }

  async json<S extends z.ZodType>(req: JsonRequest<S>): Promise<LlmResult<z.infer<S>>> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      output_config: { effort: this.effort, format: zodOutputFormat(req.schema) },
    });
    if (response.stop_reason === 'refusal') {
      throw new Error(
        `${this.model} declined ${req.purpose}: ${response.stop_details?.explanation ?? 'no reason given'}`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error(`${req.purpose} ran out of output tokens; raise maxTokens`);
    }
    if (response.parsed_output == null)
      throw new Error(`${req.purpose} returned no parseable JSON`);
    const { input_tokens, output_tokens } = response.usage;
    const [inRate, outRate] = PRICES[this.model] ?? [0, 0];
    return {
      value: response.parsed_output as z.infer<S>,
      call: {
        provider: this.name,
        model: response.model,
        purpose: req.purpose,
        promptHash: promptHash(req.system, req.prompt),
        inputTokens: input_tokens,
        outputTokens: output_tokens,
        costUsd: (input_tokens * inRate + output_tokens * outRate) / 1_000_000,
      },
    };
  }
}
