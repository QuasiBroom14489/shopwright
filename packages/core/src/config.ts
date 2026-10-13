import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Where a Shopwright install keeps its state. The engine repo holds no shop
 * data: everything lives under the data dir, a separate private repo (ADR 0003).
 */
export interface ShopwrightConfig {
  /** $SHOPWRIGHT_DATA, default ~/shopwright-data. */
  dataDir: string;
  /** $SHOPWRIGHT_DB, default <dataDir>/shopwright.db (gitignored there too). */
  dbPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ShopwrightConfig {
  const dataDir = resolve(expandHome(env.SHOPWRIGHT_DATA ?? '~/shopwright-data'));
  const dbPath =
    env.SHOPWRIGHT_DB === ':memory:'
      ? ':memory:'
      : resolve(expandHome(env.SHOPWRIGHT_DB ?? join(dataDir, 'shopwright.db')));
  return { dataDir, dbPath };
}

/** Files for one shop: brand, rubric, gold set, products, listings, research. */
export function shopDir(cfg: ShopwrightConfig, slug: string): string {
  return join(cfg.dataDir, 'shops', slug);
}

/** Files for studio-level runs, e.g. research for a shop that doesn't exist yet. */
export function studioDir(cfg: ShopwrightConfig): string {
  return join(cfg.dataDir, 'studio');
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
}
