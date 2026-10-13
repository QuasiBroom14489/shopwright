import type { EventPayload } from '@shopwright/shared';
import type { z } from 'zod';
import { sha256 } from '../hash.js';

/** A request for one JSON answer that must match `schema`. */
export interface JsonRequest<S extends z.ZodType> {
  /** What the call is for, e.g. "research.candidates"; shows up in cost reports. */
  purpose: string;
  system: string;
  prompt: string;
  schema: S;
  maxTokens?: number;
}

export interface LlmResult<T> {
  value: T;
  /** The `llm.called` payload to charge to the run. */
  call: EventPayload<'llm.called'>;
}

/**
 * Every model call goes through this, so runs can swap Claude for a local
 * model (or a script in tests) without changing the stage code.
 */
export interface LlmProvider {
  readonly name: string;
  json<S extends z.ZodType>(req: JsonRequest<S>): Promise<LlmResult<z.infer<S>>>;
}

/** Identifies the exact prompt a call used, so prompt changes are visible in the log. */
export function promptHash(system: string, prompt: string): string {
  return sha256(`${system}\n\n${prompt}`).slice(0, 16);
}

/**
 * Replays canned answers in order. Tests use it, and it keeps an offline run
 * honest: a run without a model must supply its judgments as files instead.
 */
export class ScriptedLlm implements LlmProvider {
  readonly name = 'scripted';
  private readonly answers: unknown[];

  constructor(answers: unknown[]) {
    this.answers = [...answers];
  }

  async json<S extends z.ZodType>(req: JsonRequest<S>): Promise<LlmResult<z.infer<S>>> {
    if (this.answers.length === 0) throw new Error(`no scripted answer left for ${req.purpose}`);
    const value = req.schema.parse(this.answers.shift());
    return {
      value,
      call: {
        provider: this.name,
        model: 'scripted',
        purpose: req.purpose,
        promptHash: promptHash(req.system, req.prompt),
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    };
  }
}
