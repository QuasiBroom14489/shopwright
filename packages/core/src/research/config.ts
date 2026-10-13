import { versionOf } from '../hash.js';

/** The scoring components, each normalized to 0–1 across the niches in a run. */
export const COMPONENTS = [
  'demand',
  'bestsellers',
  'competition',
  'price',
  'digital',
  'interest',
  'momentum',
  'code',
  'variants',
  'fit',
] as const;
export type Component = (typeof COMPONENTS)[number];

export interface ResearchConfig {
  /** How many niches to propose. */
  candidates: number;
  /** Top search results to record per keyword. */
  listingsPerKeyword: number;
  /** Relative weights; they're normalized, so only ratios matter. */
  weights: Record<Component, number>;
}

/**
 * The method. Changing any of this changes `configVersion`, so two runs'
 * rankings are only compared when their versions match (ADR 0002).
 */
export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  candidates: 8,
  listingsPerKeyword: 10,
  weights: {
    demand: 0.25, // median review count of the top listings (log)
    bestsellers: 0.1, // share of top listings with a Bestseller badge
    competition: 0.15, // search result count (log), lower is better
    price: 0.1, // median price of the top listings
    digital: 0.05, // share of top listings that are digital downloads
    interest: 0.05, // Google Trends level over the last year
    momentum: 0.05, // last quarter vs the three before it
    code: 0.1, // can it be built well in HTML/CSS (model judgment)
    variants: 0.1, // how many listings one template can become (model judgment)
    fit: 0.05, // the owner's own 1–5 rating
  },
};

export function researchConfigVersion(cfg: ResearchConfig): string {
  return versionOf({ kind: 'research', cfg });
}
