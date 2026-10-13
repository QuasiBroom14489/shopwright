import type { Artifact, Stage } from './events.js';

/** A storefront with its own brand, accounts and data folder (ADR 0003). */
export interface Shop {
  id: string;
  slug: string;
  name: string;
  createdAt: number;
}

/** A niche inside a shop. Running the playbook again adds lines or shops. */
export interface ProductLine {
  id: string;
  shopId: string;
  slug: string;
  niche: string;
  createdAt: number;
}

export type RunStatus = 'running' | 'completed' | 'failed';

/** One execution of one stage; its status is folded from events, never stored. */
export interface Run {
  id: string;
  shopId: string | null;
  lineId: string | null;
  stage: Stage;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  inputs: Record<string, unknown>;
  configVersion: string;
  basedOn: { runId: string; mode: 'like' | 'replay' } | null;
  summary: string | null;
  error: string | null;
  artifacts: Artifact[];
  costUsd: number;
}
