import { COMPONENTS, type Component, type ResearchConfig } from './config.js';
import type { Candidate, KeywordObs, ListingObs } from './model.js';
import { type TrendSeries, trendStats } from './trends.js';

export interface RankInput {
  candidates: Candidate[];
  listings: ListingObs[];
  keywords: KeywordObs[];
  /** Owner's 1–5 fit rating by niche (lowercased). */
  fit: Map<string, number>;
  trends: TrendSeries[];
}

export interface RankedNiche {
  niche: string;
  keywords: string[];
  score: number;
  /** Normalized 0–1 per component; 0.5 where data was missing. */
  parts: Record<Component, number>;
  /** The raw value behind each part, null where missing. */
  raw: Record<Component, number | null>;
  missing: Component[];
  listingsSeen: number;
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
const clamp15 = (n: number) => Math.min(5, Math.max(1, Math.round(n)));

/** Raw metrics for one niche, from the evidence about its keywords. */
function rawMetrics(
  c: Candidate,
  input: RankInput,
): { raw: Record<Component, number | null>; seen: number } {
  const kws = new Set(c.keywords.map((k) => k.toLowerCase()));
  const rows = input.listings.filter((l) => kws.has(l.keyword));
  const reviews = rows.flatMap((l) => (l.reviews == null ? [] : [l.reviews]));
  const prices = rows.flatMap((l) => (l.price == null ? [] : [l.price]));
  const results = input.keywords
    .filter((k) => kws.has(k.keyword) && k.results != null)
    .map((k) => k.results as number);
  const stats = input.trends
    .filter((t) => kws.has(t.keyword))
    .map(trendStats)
    .filter((s) => s != null);
  const med = median(reviews);
  const res = mean(results);
  return {
    seen: rows.length,
    raw: {
      demand: med == null ? null : round(Math.log1p(med)),
      bestsellers: rows.length
        ? round(rows.filter((l) => l.bestseller).length / rows.length)
        : null,
      competition: res == null ? null : round(Math.log10(1 + res)),
      price: median(prices),
      digital: rows.length ? round(rows.filter((l) => l.digital).length / rows.length) : null,
      interest: stats.length ? round(mean(stats.map((s) => s.mean)) as number) : null,
      momentum: stats.length ? round(mean(stats.map((s) => s.momentum)) as number) : null,
      code: clamp15(c.codeFriendliness),
      variants: clamp15(c.variantPotential),
      fit: input.fit.get(c.niche.toLowerCase()) ?? null,
    },
  };
}

/**
 * Rank niches. Pure and deterministic: the same evidence and config always
 * give the same ranking, which is what `research replay` checks (ADR 0002).
 */
export function rankNiches(input: RankInput, cfg: ResearchConfig): RankedNiche[] {
  const rows = input.candidates.map((c) => ({ c, ...rawMetrics(c, input) }));
  const totalWeight = COMPONENTS.reduce((a, k) => a + Math.max(0, cfg.weights[k]), 0) || 1;
  const ranked = rows.map(({ c, raw, seen }) => {
    const parts = {} as Record<Component, number>;
    const missing: Component[] = [];
    for (const k of COMPONENTS) {
      const values = rows.map((r) => r.raw[k]).filter((v): v is number => v != null);
      const v = raw[k];
      if (v == null) {
        missing.push(k);
        parts[k] = 0.5;
        continue;
      }
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      let n = hi === lo ? 0.5 : (v - lo) / (hi - lo);
      if (k === 'competition') n = 1 - n;
      parts[k] = round(n);
    }
    const score = round(
      COMPONENTS.reduce((a, k) => a + Math.max(0, cfg.weights[k]) * parts[k], 0) / totalWeight,
    );
    return {
      niche: c.niche,
      keywords: c.keywords.map((k) => k.toLowerCase()),
      score,
      parts,
      raw,
      missing,
      listingsSeen: seen,
    };
  });
  return ranked.sort(
    (a, b) => b.score - a.score || (a.niche < b.niche ? -1 : a.niche > b.niche ? 1 : 0),
  );
}
