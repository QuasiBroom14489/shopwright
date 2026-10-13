import { parseCsv } from './csv.js';

/** One keyword's interest-over-time series from a Google Trends export. */
export interface TrendSeries {
  keyword: string;
  points: { date: string; interest: number }[];
}

/**
 * Parse Google Trends' "Interest over time" CSV (multiTimeline.csv). The file
 * starts with a category line and a blank line, then a header like
 * `Week,planner: (United States),…`. "<1" means under 1 and reads as 0.5.
 */
export function parseTrendsExport(text: string): TrendSeries[] {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => /^(day|week|month)$/i.test((r[0] ?? '').trim()) && r.length > 1);
  if (h < 0)
    throw new Error('not a Google Trends interest-over-time export (no Day/Week/Month header)');
  const header = rows[h] as string[];
  const series: TrendSeries[] = header.slice(1).map((col) => ({
    keyword: col
      .replace(/:\s*\(.*\)\s*$/, '')
      .trim()
      .toLowerCase(),
    points: [],
  }));
  for (const r of rows.slice(h + 1)) {
    const date = (r[0] ?? '').trim();
    if (!date) continue;
    series.forEach((s, i) => {
      const raw = (r[i + 1] ?? '').trim();
      const interest = raw === '<1' ? 0.5 : Number(raw);
      if (raw !== '' && Number.isFinite(interest)) s.points.push({ date, interest });
    });
  }
  return series;
}

/** Level, seasonality and momentum over the most recent year of points. */
export function trendStats(
  s: TrendSeries,
): { mean: number; peakRatio: number; momentum: number } | null {
  const year = s.points.slice(-52).map((p) => p.interest);
  if (year.length < 8) return null;
  const mean = year.reduce((a, b) => a + b, 0) / year.length;
  if (mean === 0) return { mean: 0, peakRatio: 0, momentum: 0 };
  const q = Math.max(1, Math.floor(year.length / 4));
  const recent = year.slice(-q);
  const before = year.slice(0, -q);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    mean,
    peakRatio: Math.max(...year) / mean,
    momentum: before.length ? avg(recent) / Math.max(avg(before), 0.5) : 1,
  };
}
