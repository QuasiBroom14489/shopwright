#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ClaudeProvider,
  loadConfig,
  Research,
  Shopwright,
  shopDir,
  studioDir,
} from '@shopwright/core';
import type { Run } from '@shopwright/shared';

const USAGE = `shopwright <command>

  init                              create the data dir ($SHOPWRIGHT_DATA, default ~/shopwright-data)
  shop create <slug> <name…>        add a shop
  shop list                         list shops
  line create <shop> <slug> <niche…> add a product line (a niche) to a shop
  line list <shop>                  list a shop's lines
  runs [--shop <slug> | --studio]   list playbook runs, newest first
  run <id>                          show one run

  research start --seeds <a,b,…> [--exclude <a,b>] [--shop <slug>] [--count <n>] [--candidates <file.json>]
                                    propose niches and write evidence templates to fill in
  research score <run> [--no-ideas] snapshot the evidence, rank the niches, write the report
  research replay <run>             re-score a finished run's evidence; must match byte for byte
  research like <run>               the same method on fresh evidence (e.g. when sales plateau)

The model is Claude ($SHOPWRIGHT_MODEL, default claude-opus-5-5). Credentials come from
ANTHROPIC_API_KEY, $SHOPWRIGHT_DATA/.env, or an "ant auth login" profile.
`;

async function main(argv: string[]): Promise<void> {
  const cfg = loadConfig();
  const [command, sub, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }
  if (command === 'init') {
    init(cfg.dataDir);
    return;
  }
  const sw = await Shopwright.open(cfg.dbPath);
  try {
    if (command === 'research') {
      await research(sw, cfg, sub, rest);
      return;
    }
    switch (`${command} ${sub ?? ''}`.trim()) {
      case 'shop create': {
        const [slug, ...name] = rest;
        if (!slug || name.length === 0) throw new Usage('shop create <slug> <name…>');
        const shop = await sw.createShop(slug, name.join(' '), 'cli');
        mkdirSync(shopDir(cfg, slug), { recursive: true });
        console.log(`created ${shop.slug} (${shop.name}) → ${shopDir(cfg, slug)}`);
        return;
      }
      case 'shop list':
        for (const s of await sw.listShops()) console.log(`${s.slug}\t${s.name}`);
        return;
      case 'line create': {
        const [shop, slug, ...niche] = rest;
        if (!shop || !slug || niche.length === 0)
          throw new Usage('line create <shop> <slug> <niche…>');
        const line = await sw.createLine(shop, slug, niche.join(' '), 'cli');
        console.log(`created ${shop}/${line.slug}: ${line.niche}`);
        return;
      }
      case 'line list': {
        const [shop] = rest;
        if (!shop) throw new Usage('line list <shop>');
        for (const l of await sw.listLines(shop)) console.log(`${l.slug}\t${l.niche}`);
        return;
      }
    }
    switch (command) {
      case 'runs': {
        const args = [sub, ...rest].filter(Boolean) as string[];
        const shop = flag(args, '--shop');
        const runs = await sw.listRuns({ shop, studio: args.includes('--studio') });
        for (const r of runs) console.log(runLine(r));
        return;
      }
      case 'run': {
        if (!sub) throw new Usage('run <id>');
        console.log(JSON.stringify(await sw.getRun(sub), null, 2));
        return;
      }
    }
    throw new Usage(USAGE);
  } finally {
    sw.close();
  }
}

async function research(
  sw: Shopwright,
  cfg: ReturnType<typeof loadConfig>,
  sub: string | undefined,
  args: string[],
): Promise<void> {
  const env = join(cfg.dataDir, '.env');
  if (existsSync(env)) process.loadEnvFile(env);
  const llm = args.includes('--no-llm')
    ? null
    : new ClaudeProvider({ model: process.env.SHOPWRIGHT_MODEL });
  const r = new Research(sw, cfg, llm);
  const list = (s: string | undefined) =>
    (s ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  switch (sub) {
    case 'start': {
      const seeds = list(flag(args, '--seeds'));
      if (seeds.length === 0) throw new Usage('research start --seeds <a,b,…>');
      const count = flag(args, '--count');
      const file = flag(args, '--candidates');
      const candidates = file ? JSON.parse(readFileSync(file, 'utf8')).candidates : undefined;
      const { run, dir } = await r.start({
        seeds,
        exclude: list(flag(args, '--exclude')),
        shop: flag(args, '--shop'),
        config: count ? { candidates: Number(count) } : undefined,
        candidates,
      });
      console.log(
        `research run ${run.id.slice(0, 8)} started${run.costUsd ? ` ($${run.costUsd.toFixed(2)})` : ''}`,
      );
      console.log(`fill in the templates: ${join(dir, 'collect')}  (see README.md there)`);
      console.log(`then: shopwright research score ${run.id.slice(0, 8)}`);
      return;
    }
    case 'score': {
      const [id] = args;
      if (!id) throw new Usage('research score <run>');
      const { run } = await r.score(id, { ideas: !args.includes('--no-ideas') });
      console.log(`${run.summary}  →  ${join(r.runDir(run), 'report.md')}`);
      return;
    }
    case 'replay': {
      const [id] = args;
      if (!id) throw new Usage('research replay <run>');
      const { run, identical } = await r.replay(id);
      console.log(
        identical ? `identical  →  ${join(r.runDir(run), 'report.md')}` : `DIFFERS: ${run.error}`,
      );
      if (!identical) process.exitCode = 1;
      return;
    }
    case 'like': {
      const [id] = args;
      if (!id) throw new Usage('research like <run>');
      const { run, dir } = await r.like(id);
      console.log(
        `research run ${run.id.slice(0, 8)} started like ${id}; fill in ${join(dir, 'collect')}`,
      );
      return;
    }
  }
  throw new Usage('research start|score|replay|like …');
}

/** Lay out the data dir. It's meant to be its own private git repo (ADR 0003). */
function init(dataDir: string): void {
  mkdirSync(join(dataDir, 'shops'), { recursive: true });
  mkdirSync(studioDir({ dataDir, dbPath: '' }), { recursive: true });
  const ignore = join(dataDir, '.gitignore');
  if (!existsSync(ignore)) {
    writeFileSync(
      ignore,
      '# The database and secrets stay local even in the private repo.\n*.db\n*.db-*\n.env\n.env.*\n.DS_Store\n',
    );
  }
  console.log(`data dir ready at ${dataDir}`);
  if (!existsSync(join(dataDir, '.git')))
    console.log(`next: git -C ${dataDir} init (keep this repo private)`);
}

function runLine(r: Run): string {
  const when = new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' ');
  const cost = r.costUsd ? ` $${r.costUsd.toFixed(2)}` : '';
  return `${r.id.slice(0, 8)}  ${when}  ${r.stage.padEnd(8)} ${r.status.padEnd(9)}${cost}  ${r.summary ?? r.error ?? ''}`;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

class Usage extends Error {}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof Usage) {
    console.error(
      err.message.startsWith('shopwright') ? err.message : `usage: shopwright ${err.message}`,
    );
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
