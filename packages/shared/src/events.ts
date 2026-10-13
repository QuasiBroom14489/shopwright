import { z } from 'zod';

/**
 * The playbook's stages, in order. A run is one execution of one stage.
 * `measure` feeds the plateau check, which suggests a new `research` run.
 * See docs/decisions/0002-playbook-and-reproducibility.md.
 */
export const STAGES = [
  'research',
  'select',
  'brand',
  'rubric',
  'design',
  'produce',
  'list',
  'publish',
  'measure',
] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'lowercase letters, digits and dashes');

/** A file a run wrote, pinned by content so a replay can prove it got the same bytes. */
export const Artifact = z.object({ path: z.string(), sha256: z.string().length(64) });
export type Artifact = z.infer<typeof Artifact>;

/**
 * Every fact Shopwright knows about "what happened" is one of these events.
 * The log is append-only: a kind's meaning never changes once shipped, and new
 * facts get new kinds. Current state is a fold over this log.
 */
export const EventPayloads = {
  'shop.created': z.object({ slug: Slug, name: z.string().min(1) }),
  'line.created': z.object({ slug: Slug, niche: z.string().min(1) }),
  /**
   * What a run was given. `configVersion` and `promptVersions` are content
   * hashes, so two runs with the same inputs and versions are comparable.
   */
  'run.started': z.object({
    stage: Stage,
    inputs: z.record(z.string(), z.unknown()),
    configVersion: z.string(),
    promptVersions: z.record(z.string(), z.string()).default({}),
    /** Set when this run repeats another's method (`--like`) or replays its evidence. */
    basedOn: z.object({ runId: z.string(), mode: z.enum(['like', 'replay']) }).optional(),
  }),
  'run.completed': z.object({
    summary: z.string(),
    artifacts: z.array(Artifact).default([]),
  }),
  'run.failed': z.object({ error: z.string() }),
  /** One model call, for cost caps and for knowing which model produced what. */
  'llm.called': z.object({
    provider: z.string(),
    model: z.string(),
    purpose: z.string(),
    promptHash: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
} as const;

export type EventKind = keyof typeof EventPayloads;
export const EVENT_KINDS = Object.keys(EventPayloads) as EventKind[];
export type EventPayload<K extends EventKind> = z.infer<(typeof EventPayloads)[K]>;

/** Who or what recorded an event. Provenance, not meaning. */
export const EVENT_SOURCES = ['manual', 'cli', 'web', 'mcp', 'vesper', 'demo'] as const;
export const EventSource = z.enum(EVENT_SOURCES);
export type EventSource = z.infer<typeof EventSource>;

/**
 * Where an event belongs. `shopId` null means studio level: research for a
 * shop that doesn't exist yet, or anything that spans shops (ADR 0001).
 */
export interface EventScope {
  shopId?: string | null;
  lineId?: string | null;
  runId?: string | null;
}

export interface ShopEvent<K extends EventKind = EventKind> {
  seq: number;
  id: string;
  ts: number;
  kind: K;
  shopId: string | null;
  lineId: string | null;
  runId: string | null;
  source: EventSource;
  payload: EventPayload<K>;
}

export type AnyEvent = { [K in EventKind]: ShopEvent<K> }[EventKind];

export interface NewEvent<K extends EventKind = EventKind> extends EventScope {
  kind: K;
  payload: z.input<(typeof EventPayloads)[K]>;
  ts?: number;
  source?: EventSource;
}
