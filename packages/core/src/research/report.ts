import { COMPONENTS, type ResearchConfig } from './config.js';
import type { Candidate, Idea } from './model.js';
import type { RankedNiche } from './rank.js';

export interface ReportInput {
  seeds: string[];
  configVersion: string;
  config: ResearchConfig;
  candidates: Candidate[];
  ranking: RankedNiche[];
  ideas: Idea[] | null;
  evidence: { path: string; sha256: string }[];
  warnings: string[];
}

const pct = (x: number) => `${Math.round(x * 100)}`;
const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');

/**
 * The research report. Built only from evidence and config, with no run ids,
 * paths or timestamps, so a replay of the same evidence is byte-identical.
 */
export function renderReport(r: ReportInput): string {
  const [pick, runnerUp] = r.ranking;
  const byNiche = new Map(r.candidates.map((c) => [c.niche, c]));
  const out: string[] = [];
  out.push('# Niche research', '');
  out.push(`- **Seeds:** ${r.seeds.join(', ')}`);
  out.push(`- **Method:** research config \`${r.configVersion}\``);
  out.push(`- **Niches compared:** ${r.ranking.length}`, '');
  if (pick) {
    out.push('## Recommendation', '');
    out.push(
      `**Pick: ${pick.niche}** (score ${pct(pick.score)}/100).${runnerUp ? ` Runner-up: **${runnerUp.niche}** (${pct(runnerUp.score)}).` : ''}`,
    );
    const why = byNiche.get(pick.niche)?.rationale;
    if (why) out.push('', why);
    if (pick.missing.length)
      out.push('', `Scored without: ${pick.missing.join(', ')} (treated as average).`);
    out.push('');
  }
  out.push('## Ranking', '');
  out.push(`| # | Niche | Score | ${COMPONENTS.join(' | ')} | Listings seen |`);
  out.push(`|---|---|---|${COMPONENTS.map(() => '---').join('|')}|---|`);
  r.ranking.forEach((n, i) => {
    const parts = COMPONENTS.map((k) => (n.missing.includes(k) ? '–' : pct(n.parts[k])));
    out.push(
      `| ${i + 1} | ${cell(n.niche)} | **${pct(n.score)}** | ${parts.join(' | ')} | ${n.listingsSeen} |`,
    );
  });
  out.push(
    '',
    'Each component is scaled 0–100 across these niches (competition is inverted: fewer results scores higher).',
    '',
  );
  out.push('### Raw evidence per niche', '');
  out.push(
    '| Niche | Keywords | Median reviews (log) | Bestseller share | Results (log10) | Median price | Digital share | Trends mean | Momentum | Code | Variants | Fit |',
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const n of r.ranking) {
    const v = (k: (typeof COMPONENTS)[number]) => (n.raw[k] == null ? '–' : String(n.raw[k]));
    out.push(
      `| ${cell(n.niche)} | ${cell(n.keywords.join('; '))} | ${v('demand')} | ${v('bestsellers')} | ${v('competition')} | ${v('price')} | ${v('digital')} | ${v('interest')} | ${v('momentum')} | ${v('code')} | ${v('variants')} | ${v('fit')} |`,
    );
  }
  out.push('');
  if (r.ideas?.length && pick) {
    out.push(`## Product ideas: ${pick.niche}`, '');
    r.ideas.forEach((idea, i) => {
      out.push(`${i + 1}. **${idea.name}.** ${idea.whyItSells}`);
      out.push(`   - Buyer: ${idea.buyer}`);
      out.push(`   - Contents: ${idea.pages}`);
      if (idea.variants.length) out.push(`   - Variants: ${idea.variants.join('; ')}`);
    });
    out.push('');
  }
  out.push('## Method', '');
  out.push('| Component | Weight |', '|---|---|');
  for (const k of COMPONENTS) out.push(`| ${k} | ${r.config.weights[k]} |`);
  out.push('');
  if (r.warnings.length) {
    out.push('## Warnings', '');
    for (const w of r.warnings) out.push(`- ${w}`);
    out.push('');
  }
  out.push('## Evidence', '', '| File | sha256 |', '|---|---|');
  for (const e of r.evidence) out.push(`| ${e.path} | \`${e.sha256.slice(0, 16)}\` |`);
  out.push('');
  return out.join('\n');
}
