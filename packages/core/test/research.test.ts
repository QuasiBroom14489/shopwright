import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Candidate,
  DEFAULT_RESEARCH_CONFIG,
  parseCsv,
  parseTrendsExport,
  Research,
  rankNiches,
  researchConfigVersion,
  ScriptedLlm,
  Shopwright,
  toCsv,
} from '@shopwright/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Fictional niches and numbers; no real shop data (ADR 0003).
const CANDIDATES: Candidate[] = [
  {
    niche: 'Plant care logs',
    keywords: ['plant care log', 'houseplant tracker'],
    rationale: 'Steady hobby demand.',
    codeFriendliness: 5,
    variantPotential: 4,
  },
  {
    niche: 'Wedding seating charts',
    keywords: ['seating chart template'],
    rationale: 'Seasonal and pricey.',
    codeFriendliness: 3,
    variantPotential: 5,
  },
  {
    niche: 'Chore charts for kids',
    keywords: ['kids chore chart'],
    rationale: 'Crowded but popular.',
    codeFriendliness: 4,
    variantPotential: 3,
  },
];

function listingsCsv(): string {
  const rows: (string | number)[][] = [
    ['keyword', 'rank', 'title', 'shop', 'price', 'reviews', 'bestseller', 'digital', 'url'],
  ];
  const add = (kw: string, prices: number[], reviews: number[], best: number) => {
    for (const [i, p] of prices.entries()) {
      rows.push([
        kw,
        i + 1,
        `Demo ${kw} ${i + 1}`,
        'DemoShop',
        p,
        reviews[i] ?? '',
        i < best ? 'y' : '',
        'y',
        '',
      ]);
    }
  };
  add('plant care log', [4.5, 5, 6], [120, 300, 80], 1);
  add('houseplant tracker', [3.99, 4.25], [60, 45], 0);
  add('seating chart template', [12, 15, 9.5], [900, 1500, 400], 2);
  add('kids chore chart', [2.5, 3, 3.5], [2000, 3500, 1200], 3);
  return toCsv(rows);
}
const KEYWORDS = toCsv([
  ['niche', 'keyword', 'results', 'suggestions'],
  ['Plant care logs', 'plant care log', '3,200 results', ''],
  ['Plant care logs', 'houseplant tracker', '1,100', ''],
  ['Wedding seating charts', 'seating chart template', '48,000+', ''],
  ['Chore charts for kids', 'kids chore chart', '95,000', ''],
]);
const FIT = toCsv([
  ['niche', 'fit', 'notes'],
  ['Plant care logs', 4, ''],
  ['Wedding seating charts', 2, ''],
]);
const TRENDS = `Category: All categories\n\nWeek,plant care log: (United States),kids chore chart: (United States)\n${Array.from(
  { length: 52 },
  (_, i) =>
    `2025-${String(1 + Math.floor(i / 5)).padStart(2, '0')}-0${(i % 5) + 1},${10 + i},${i % 13 === 0 ? '<1' : 40}`,
).join('\n')}\n`;
const IDEAS = {
  ideas: Array.from({ length: 10 }, (_, i) => ({
    name: `Idea ${i + 1}`,
    buyer: 'Hobbyists',
    pages: 'Weekly log',
    variants: ['A4', 'Letter'],
    whyItSells: 'Clear need.',
  })),
};

let sw: Shopwright;
let dataDir: string;
let research: Research;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'shopwright-'));
  sw = await Shopwright.open(':memory:');
  research = new Research(sw, { dataDir, dbPath: ':memory:' }, new ScriptedLlm([IDEAS]));
});
afterEach(() => sw.close());

function fill(dir: string): void {
  writeFileSync(join(dir, 'collect/listings.csv'), listingsCsv());
  writeFileSync(join(dir, 'collect/keywords.csv'), KEYWORDS);
  writeFileSync(join(dir, 'collect/fit.csv'), FIT);
  writeFileSync(join(dir, 'collect/trends/multiTimeline.csv'), TRENDS);
}

describe('research runs', () => {
  it('writes templates, then scores the collected evidence into a report', async () => {
    const { run, dir } = await research.start({ seeds: ['planners'], candidates: CANDIDATES });
    expect(run.status).toBe('running');
    const template = parseCsv(readFileSync(join(dir, 'collect/listings.csv'), 'utf8'));
    expect(template).toHaveLength(1 + 4 * DEFAULT_RESEARCH_CONFIG.listingsPerKeyword);
    await expect(research.score(run.id)).rejects.toThrow(/no filled-in rows/);

    fill(dir);
    const scored = await research.score(run.id.slice(0, 8));
    expect(scored.run.status).toBe('completed');
    expect(scored.ranking).toHaveLength(3);
    expect(scored.report).toContain('## Recommendation');
    expect(scored.report).toContain('## Product ideas');
    expect(existsSync(join(dir, 'evidence/trends/multiTimeline.csv'))).toBe(true);
    expect(scored.run.artifacts.some((a) => a.path.endsWith('report.md'))).toBe(true);
  });

  it('replays a finished run byte for byte, and notices tampered evidence', async () => {
    const { run, dir } = await research.start({ seeds: ['planners'], candidates: CANDIDATES });
    fill(dir);
    await research.score(run.id);

    const replay = await research.replay(run.id.slice(0, 8));
    expect(replay.identical).toBe(true);
    expect(replay.run).toMatchObject({
      status: 'completed',
      basedOn: { runId: run.id, mode: 'replay' },
    });
    const replayDir = research.runDir(replay.run);
    expect(readFileSync(join(replayDir, 'report.md'), 'utf8')).toBe(
      readFileSync(join(dir, 'report.md'), 'utf8'),
    );

    writeFileSync(join(dir, 'evidence/listings.csv'), listingsCsv().replace('2000', '20'));
    const tampered = await research.replay(run.id);
    expect(tampered.identical).toBe(false);
    expect(tampered.run.status).toBe('failed');
  });

  it('repeats the method on fresh evidence with `like`', async () => {
    const { run, dir } = await research.start({
      seeds: ['planners'],
      candidates: CANDIDATES,
      config: { weights: { fit: 0.5 } },
    });
    fill(dir);
    await research.score(run.id, { ideas: false });
    const ideas = new Research(
      sw,
      { dataDir, dbPath: ':memory:' },
      new ScriptedLlm([{ candidates: CANDIDATES }]),
    );
    const again = await ideas.like(run.id);
    expect(again.run.configVersion).toBe(run.configVersion);
    expect(again.run.basedOn).toEqual({ runId: run.id, mode: 'like' });
    expect(again.run.configVersion).not.toBe(researchConfigVersion(DEFAULT_RESEARCH_CONFIG));
  });

  it('records model calls against the run', async () => {
    const withModel = new Research(
      sw,
      { dataDir, dbPath: ':memory:' },
      new ScriptedLlm([{ candidates: CANDIDATES }]),
    );
    const { run } = await withModel.start({ seeds: ['planners'] });
    const events = await sw.events.forRun(run.id);
    expect(events.filter((e) => e.kind === 'llm.called')).toHaveLength(1);
  });
});

describe('ranking', () => {
  it('scores fewer results higher and treats missing data as average', () => {
    const ranked = rankNiches(
      {
        candidates: CANDIDATES,
        listings: [
          {
            keyword: 'plant care log',
            rank: 1,
            price: 5,
            reviews: 100,
            bestseller: false,
            digital: true,
          },
          {
            keyword: 'kids chore chart',
            rank: 1,
            price: 5,
            reviews: 100,
            bestseller: false,
            digital: true,
          },
        ],
        keywords: [
          { keyword: 'plant care log', results: 1000 },
          { keyword: 'kids chore chart', results: 100000 },
        ],
        fit: new Map(),
        trends: [],
      },
      DEFAULT_RESEARCH_CONFIG,
    );
    const by = new Map(ranked.map((r) => [r.niche, r]));
    expect(by.get('Plant care logs')?.parts.competition).toBe(1);
    expect(by.get('Chore charts for kids')?.parts.competition).toBe(0);
    expect(by.get('Wedding seating charts')?.missing).toContain('demand');
    expect(by.get('Wedding seating charts')?.parts.demand).toBe(0.5);
    expect(
      rankNiches(
        { candidates: CANDIDATES, listings: [], keywords: [], fit: new Map(), trends: [] },
        DEFAULT_RESEARCH_CONFIG,
      ),
    ).toEqual(
      rankNiches(
        {
          candidates: [...CANDIDATES].reverse(),
          listings: [],
          keywords: [],
          fit: new Map(),
          trends: [],
        },
        DEFAULT_RESEARCH_CONFIG,
      ),
    );
  });
});

describe('parsers', () => {
  it('reads quoted CSV and Google Trends exports', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
    const series = parseTrendsExport(TRENDS);
    expect(series.map((s) => s.keyword)).toEqual(['plant care log', 'kids chore chart']);
    expect(series[1]?.points[0]?.interest).toBe(0.5);
    expect(() => parseTrendsExport('nope')).toThrow(/Google Trends/);
  });
});

describe('collect instructions', () => {
  it('reads Etsy-style counts and lists every search', async () => {
    const { parseNumber, collectReadme } = await import('@shopwright/core');
    expect(parseNumber('(1.2k)')).toBe(1200);
    expect(parseNumber('48,213 results')).toBe(48213);
    expect(parseNumber('$4.99')).toBe(4.99);
    expect(parseNumber('')).toBeNull();
    const md = collectReadme(10, CANDIDATES, 'abcdef1234');
    for (const k of CANDIDATES.flatMap((c) => c.keywords))
      expect(md).toContain(`[${k}](https://www.etsy.com/search?q=`);
    expect(md).toContain('research score abcdef12');
  });
});
