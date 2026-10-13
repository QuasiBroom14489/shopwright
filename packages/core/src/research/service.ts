import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Artifact, Run } from '@shopwright/shared';
import { type ShopwrightConfig, shopDir, studioDir } from '../config.js';
import { ConflictError, UnavailableError } from '../errors.js';
import { sha256, stableStringify } from '../hash.js';
import { type LlmProvider, promptHash } from '../llm/provider.js';
import type { Shopwright } from '../shopwright.js';
import { DEFAULT_RESEARCH_CONFIG, type ResearchConfig, researchConfigVersion } from './config.js';
import { parseFlag, parseNumber, readTable, toCsv } from './csv.js';
import {
  Candidate,
  Candidates,
  type Idea,
  Ideas,
  type KeywordObs,
  type ListingObs,
} from './model.js';
import { type RankedNiche, rankNiches } from './rank.js';
import { renderReport } from './report.js';
import { parseTrendsExport, type TrendSeries } from './trends.js';

export interface StartResearch {
  seeds: string[];
  exclude?: string[];
  /** Research a new line for this shop; omit to research a new shop (studio level). */
  shop?: string;
  config?: Partial<Omit<ResearchConfig, 'weights'>> & {
    weights?: Partial<ResearchConfig['weights']>;
  };
  /** Supply candidates instead of asking the model (offline runs, tests). */
  candidates?: Candidate[];
  basedOn?: { runId: string; mode: 'like' | 'replay' };
}

const CANDIDATES_SYSTEM = `You help a solo seller choose niches for an Etsy shop of digital downloads (printable and fillable PDFs) that are generated from HTML/CSS templates and rendered by headless Chrome. Products are built as code: tables, grids, typography and simple shapes are easy; hand illustration and photography are not available. Favor niches where buyers search Etsy with clear intent, where one template can become many listings, and where quality can be judged objectively. Never propose anything that depends on a trademark, brand, school, team or licensed character.`;
const IDEAS_SYSTEM = `You design digital-download products for an Etsy shop. Every product is a PDF generated from an HTML/CSS template, so favor layouts that are mostly structure (tables, grids, trackers, checklists, calendars, hyperlinked tabs) over artwork. Never use trademarks, brands, schools, teams or licensed characters.`;
const PROMPT_VERSIONS = {
  candidates: promptHash(CANDIDATES_SYSTEM, 'candidates.v1'),
  ideas: promptHash(IDEAS_SYSTEM, 'ideas.v1'),
};

const LISTING_COLUMNS = [
  'keyword',
  'rank',
  'title',
  'shop',
  'price',
  'reviews',
  'bestseller',
  'digital',
  'url',
];

const COLLECT_README = (n: number) => `# Collect evidence for this research run

Fill these in by hand from Etsy search in your browser. Don't use scrapers,
extensions or scripts on etsy.com: Etsy's terms forbid it (ADR 0004).

1. **listings.csv**: for each keyword, search Etsy and record the top ${n}
   results, one row per rank. Fill in at least \`price\` and \`reviews\` (the
   review count shown under the listing). Put \`y\` in \`bestseller\` when the
   listing has the Bestseller badge, and in \`digital\` when it says Digital
   download. \`title\`, \`shop\` and \`url\` are optional notes.
2. **keywords.csv**: the result count Etsy shows for each keyword
   (e.g. "48,000+ results" → 48000). \`suggestions\` is optional: the search
   box's autocomplete, separated by \`;\`.
3. **fit.csv** (optional): your own 1–5 rating of each niche.
4. **trends/** (optional): for each keyword, open Google Trends (past 5 years,
   your country), download "Interest over time" as CSV, and drop the file here.
   One file can hold up to 5 keywords.

Then run \`shopwright research score <run-id>\`. Rows you leave blank are
ignored, and missing data is scored as average and listed in the report.
`;

/** Research: propose niches, collect evidence, rank, and recommend (ADR 0002, 0004). */
export class Research {
  constructor(
    private readonly sw: Shopwright,
    private readonly cfg: ShopwrightConfig,
    private readonly llm: LlmProvider | null,
  ) {}

  /** Start a run: propose candidates and write the evidence templates to fill in. */
  async start(req: StartResearch): Promise<{ run: Run; dir: string }> {
    const config = mergeConfig(req.config);
    const relDir = relative(this.cfg.dataDir, this.newRunDir(req.shop));
    const seeds = req.seeds.map((s) => s.trim()).filter(Boolean);
    if (seeds.length === 0) throw new ConflictError('research needs at least one seed');
    if (!req.candidates && !this.llm) {
      throw new UnavailableError(
        'no model configured: set ANTHROPIC_API_KEY or pass --candidates <file.json>',
      );
    }
    const run = await this.sw.startRun({
      stage: 'research',
      shop: req.shop,
      inputs: { seeds, exclude: req.exclude ?? [], shop: req.shop ?? null, dir: relDir },
      configVersion: researchConfigVersion(config),
      promptVersions: PROMPT_VERSIONS,
      basedOn: req.basedOn,
      source: 'cli',
    });
    const dir = join(this.cfg.dataDir, relDir);
    try {
      const candidates = req.candidates
        ? req.candidates.map((c) => Candidate.parse(c))
        : await this.proposeCandidates(run.id, seeds, req.exclude ?? [], config.candidates);
      if (candidates.length === 0) throw new Error('no candidates proposed');
      write(join(dir, 'evidence/candidates.json'), json({ candidates }));
      write(join(dir, 'evidence/config.json'), json(config));
      this.writeTemplates(dir, candidates, config);
    } catch (err) {
      await this.sw.failRun(run.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
    return { run: await this.sw.getRun(run.id), dir };
  }

  /**
   * Snapshot what was collected, rank, and write the report. If the evidence
   * is invalid the run stays open, so the owner can fix it and score again.
   */
  async score(
    runId: string,
    opts: { ideas?: boolean } = {},
  ): Promise<{ run: Run; report: string; ranking: RankedNiche[] }> {
    const run = await this.researchRun(runId);
    if (run.status !== 'running') throw new ConflictError(`run ${runId} is already ${run.status}`);
    const dir = this.runDir(run);
    snapshotCollected(dir);
    const ev = loadEvidence(dir);
    if (ev.listings.length === 0) {
      throw new ConflictError(`no filled-in rows in ${join(dir, 'collect/listings.csv')} yet`);
    }
    const ranking = rankNiches(ev, ev.config);
    const ideasFile = join(dir, 'evidence/ideas.json');
    const pick = ranking[0];
    try {
      if (opts.ideas !== false && this.llm && pick && !existsSync(ideasFile)) {
        const ideas = await this.proposeIdeas(
          run.id,
          ev.candidates.find((c) => c.niche === pick.niche) ?? pick,
        );
        write(ideasFile, json({ ideas }));
      }
      const { report, artifacts } = this.writeReport(dir, run, ranking);
      const summary = pick
        ? `pick: ${pick.niche} (${Math.round(pick.score * 100)}/100)`
        : 'no niches ranked';
      return { run: await this.sw.completeRun(run.id, summary, artifacts), report, ranking };
    } catch (err) {
      await this.sw.failRun(run.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /** Re-score a finished run's evidence; the report must match byte for byte. */
  async replay(runId: string): Promise<{ run: Run; identical: boolean }> {
    const source = await this.researchRun(runId);
    if (source.status !== 'completed')
      throw new ConflictError(`run ${runId} is ${source.status}, not completed`);
    const sourceDir = this.runDir(source);
    const sourceReport = source.artifacts.find((a) => a.path.endsWith('/report.md'));
    if (!sourceReport) throw new ConflictError(`run ${runId} has no report to compare against`);
    const shop = (source.inputs.shop as string | null) ?? undefined;
    const relDir = relative(this.cfg.dataDir, this.newRunDir(shop));
    const run = await this.sw.startRun({
      stage: 'research',
      shop,
      inputs: { ...source.inputs, dir: relDir },
      configVersion: source.configVersion,
      basedOn: { runId: source.id, mode: 'replay' },
      source: 'cli',
    });
    const dir = join(this.cfg.dataDir, relDir);
    try {
      cpSync(join(sourceDir, 'evidence'), join(dir, 'evidence'), { recursive: true });
      const ev = loadEvidence(dir);
      if (researchConfigVersion(ev.config) !== source.configVersion) {
        throw new Error('evidence/config.json no longer matches the run’s config version');
      }
      const ranking = rankNiches(ev, ev.config);
      const { artifacts } = this.writeReport(dir, run, ranking);
      const mine = artifacts.find((a) => a.path.endsWith('/report.md'));
      const identical = mine?.sha256 === sourceReport.sha256;
      if (!identical) {
        await this.sw.failRun(
          run.id,
          `replay differs from ${source.id.slice(0, 8)}: report ${mine?.sha256.slice(0, 12)} ≠ ${sourceReport.sha256.slice(0, 12)}`,
        );
        return { run: await this.sw.getRun(run.id), identical };
      }
      return {
        run: await this.sw.completeRun(
          run.id,
          `replay of ${source.id.slice(0, 8)}: identical`,
          artifacts,
        ),
        identical,
      };
    } catch (err) {
      const r = await this.sw.getRun(run.id);
      if (r.status === 'running')
        await this.sw.failRun(run.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /** The same method (seeds and config) on fresh evidence, e.g. when a line plateaus. */
  async like(runId: string): Promise<{ run: Run; dir: string }> {
    const source = await this.researchRun(runId);
    const config = JSON.parse(
      readFileSync(join(this.runDir(source), 'evidence/config.json'), 'utf8'),
    ) as ResearchConfig;
    return this.start({
      seeds: source.inputs.seeds as string[],
      exclude: source.inputs.exclude as string[],
      shop: (source.inputs.shop as string | null) ?? undefined,
      config,
      basedOn: { runId: source.id, mode: 'like' },
    });
  }

  runDir(run: Run): string {
    return join(this.cfg.dataDir, run.inputs.dir as string);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private newRunDir(shop: string | undefined): string {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const base = shop
      ? join(shopDir(this.cfg, shop), 'research')
      : join(studioDir(this.cfg), 'research');
    let dir = join(base, stamp);
    for (let i = 2; existsSync(dir); i++) dir = join(base, `${stamp}-${i}`);
    return dir;
  }

  private async researchRun(runId: string): Promise<Run> {
    const run = await this.sw.getRun(await this.sw.resolveRunId(runId));
    if (run.stage !== 'research')
      throw new ConflictError(`run ${runId} is a ${run.stage} run, not research`);
    return run;
  }

  private async proposeCandidates(
    runId: string,
    seeds: string[],
    exclude: string[],
    count: number,
  ): Promise<Candidate[]> {
    const llm = this.llm as LlmProvider;
    const prompt = [
      `Propose ${count} distinct niches for a digital-download Etsy shop, starting from these seeds: ${seeds.join(', ')}.`,
      exclude.length ? `Do not propose anything in or near: ${exclude.join(', ')}.` : '',
      'Spread the candidates out: include a few close to the seeds and a few adjacent niches a seller might miss.',
      'For each, give 2–3 search phrases a buyer would actually type into Etsy, a short rationale, and honest 1–5 ratings for code-friendliness and variant potential.',
    ]
      .filter(Boolean)
      .join('\n');
    const { value, call } = await llm.json({
      purpose: 'research.candidates',
      system: CANDIDATES_SYSTEM,
      prompt,
      schema: Candidates,
    });
    await this.sw.recordLlmCall(runId, call);
    return value.candidates.slice(0, count);
  }

  private async proposeIdeas(
    runId: string,
    pick: Pick<Candidate, 'niche' | 'keywords'>,
  ): Promise<Idea[]> {
    const llm = this.llm as LlmProvider;
    const prompt = `Propose 10 concrete products for the niche "${pick.niche}" (buyers search for: ${pick.keywords.join(', ')}). Make them different enough to be separate listings, and say what each PDF contains and which variants it could have.`;
    const { value, call } = await llm.json({
      purpose: 'research.ideas',
      system: IDEAS_SYSTEM,
      prompt,
      schema: Ideas,
    });
    await this.sw.recordLlmCall(runId, call);
    return value.ideas.slice(0, 10);
  }

  private writeTemplates(dir: string, candidates: Candidate[], config: ResearchConfig): void {
    const listings: (string | number)[][] = [LISTING_COLUMNS];
    const keywords: (string | number)[][] = [['niche', 'keyword', 'results', 'suggestions']];
    for (const c of candidates) {
      for (const k of c.keywords) {
        keywords.push([c.niche, k.toLowerCase(), '', '']);
        for (let r = 1; r <= config.listingsPerKeyword; r++) {
          listings.push([k.toLowerCase(), r, '', '', '', '', '', '', '']);
        }
      }
    }
    write(join(dir, 'collect/listings.csv'), toCsv(listings));
    write(join(dir, 'collect/keywords.csv'), toCsv(keywords));
    write(
      join(dir, 'collect/fit.csv'),
      toCsv([['niche', 'fit', 'notes'], ...candidates.map((c) => [c.niche, '', ''])]),
    );
    mkdirSync(join(dir, 'collect/trends'), { recursive: true });
    write(join(dir, 'collect/README.md'), COLLECT_README(config.listingsPerKeyword));
  }

  private writeReport(
    dir: string,
    run: Run,
    ranking: RankedNiche[],
  ): { report: string; artifacts: Artifact[] } {
    const ev = loadEvidence(dir);
    const evidence = listFiles(join(dir, 'evidence')).map((f) => ({
      path: relative(dir, f),
      sha256: sha256(readFileSync(f)),
    }));
    const report = renderReport({
      seeds: run.inputs.seeds as string[],
      configVersion: run.configVersion,
      config: ev.config,
      candidates: ev.candidates,
      ranking,
      ideas: ev.ideas,
      evidence,
      warnings: ev.warnings,
    });
    write(join(dir, 'report.md'), report);
    write(join(dir, 'ranking.json'), json({ ranking }));
    const artifacts = [
      ...evidence.map((e) => join(dir, e.path)),
      join(dir, 'report.md'),
      join(dir, 'ranking.json'),
    ].map((f) => ({ path: relative(this.cfg.dataDir, f), sha256: sha256(readFileSync(f)) }));
    return { report, artifacts };
  }
}

// ── evidence ─────────────────────────────────────────────────────────────

interface Evidence {
  config: ResearchConfig;
  candidates: Candidate[];
  listings: ListingObs[];
  keywords: KeywordObs[];
  fit: Map<string, number>;
  trends: TrendSeries[];
  ideas: Idea[] | null;
  warnings: string[];
}

/** Copy the owner's files into evidence/, byte for byte, before anything reads them. */
function snapshotCollected(dir: string): void {
  for (const f of ['listings.csv', 'keywords.csv', 'fit.csv']) {
    const from = join(dir, 'collect', f);
    if (existsSync(from)) cpSync(from, join(dir, 'evidence', f));
  }
  const trends = join(dir, 'collect/trends');
  if (existsSync(trends)) {
    for (const f of readdirSync(trends)
      .filter((n) => n.toLowerCase().endsWith('.csv'))
      .sort()) {
      cpSync(join(trends, f), join(dir, 'evidence/trends', f));
    }
  }
}

/** Read everything a ranking depends on, from evidence/ only. */
function loadEvidence(dir: string): Evidence {
  const ev = join(dir, 'evidence');
  const read = (f: string) => (existsSync(join(ev, f)) ? readFileSync(join(ev, f), 'utf8') : null);
  const config = JSON.parse(read('config.json') ?? 'null') as ResearchConfig | null;
  if (!config) throw new ConflictError(`${ev} has no config.json`);
  const candidates = Candidates.parse(
    JSON.parse(read('candidates.json') ?? '{"candidates":[]}'),
  ).candidates;
  const known = new Set(candidates.flatMap((c) => c.keywords.map((k) => k.toLowerCase())));
  const warnings: string[] = [];

  const listings: ListingObs[] = [];
  const unknown = new Set<string>();
  for (const row of readTable(read('listings.csv') ?? '')) {
    const keyword = (row.keyword ?? '').toLowerCase();
    const price = parseNumber(row.price);
    const reviews = parseNumber(row.reviews);
    if (price == null && reviews == null) continue;
    if (!known.has(keyword)) {
      unknown.add(keyword);
      continue;
    }
    listings.push({
      keyword,
      rank: parseNumber(row.rank) ?? 0,
      price,
      reviews,
      bestseller: parseFlag(row.bestseller),
      digital: parseFlag(row.digital),
    });
  }
  if (unknown.size)
    warnings.push(
      `listings.csv rows for unknown keywords were ignored: ${[...unknown].sort().join(', ')}`,
    );
  const unfilled = [...known].filter((k) => !listings.some((l) => l.keyword === k)).sort();
  if (unfilled.length) warnings.push(`No listings recorded for: ${unfilled.join(', ')}`);

  const keywords: KeywordObs[] = readTable(read('keywords.csv') ?? '')
    .map((r) => ({ keyword: (r.keyword ?? '').toLowerCase(), results: parseNumber(r.results) }))
    .filter((k) => known.has(k.keyword));

  const fit = new Map<string, number>();
  for (const r of readTable(read('fit.csv') ?? '')) {
    const n = parseNumber(r.fit);
    if (r.niche && n != null) fit.set(r.niche.toLowerCase(), Math.min(5, Math.max(1, n)));
  }

  const trends: TrendSeries[] = [];
  const trendDir = join(ev, 'trends');
  if (existsSync(trendDir)) {
    for (const f of readdirSync(trendDir)
      .filter((n) => n.toLowerCase().endsWith('.csv'))
      .sort()) {
      try {
        trends.push(
          ...parseTrendsExport(readFileSync(join(trendDir, f), 'utf8')).filter((s) =>
            known.has(s.keyword),
          ),
        );
      } catch (err) {
        warnings.push(`trends/${f} skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const ideasText = read('ideas.json');
  const ideas = ideasText ? Ideas.parse(JSON.parse(ideasText)).ideas : null;
  return { config, candidates, listings, keywords, fit, trends, ideas, warnings };
}

// ── helpers ──────────────────────────────────────────────────────────────

function mergeConfig(over: StartResearch['config']): ResearchConfig {
  return {
    ...DEFAULT_RESEARCH_CONFIG,
    ...over,
    weights: { ...DEFAULT_RESEARCH_CONFIG.weights, ...over?.weights },
  };
}

/** Stable JSON, so the same value always writes the same bytes. */
function json(value: unknown): string {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`;
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? listFiles(p) : [p];
    });
}
