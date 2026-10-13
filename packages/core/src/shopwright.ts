import { randomUUID } from 'node:crypto';
import type {
  Artifact,
  EventPayload,
  EventSource,
  ProductLine,
  Run,
  Shop,
  Stage,
} from '@shopwright/shared';
import { type Db, openDb } from './db.js';
import { foldRun } from './derive.js';
import { ConflictError, NotFoundError } from './errors.js';
import { EventLog } from './events.js';

interface ShopRow {
  id: string;
  slug: string;
  name: string;
  created_at: number;
}
interface LineRow {
  id: string;
  shop_id: string;
  slug: string;
  niche: string;
  created_at: number;
}
interface RunRow {
  id: string;
  shop_id: string | null;
  line_id: string | null;
  stage: Stage;
  created_at: number;
}

export interface StartRun {
  stage: Stage;
  /** Omit for a studio-level run, e.g. research for a shop that doesn't exist yet. */
  shop?: string;
  line?: string;
  inputs: Record<string, unknown>;
  configVersion: string;
  promptVersions?: Record<string, string>;
  basedOn?: { runId: string; mode: 'like' | 'replay' };
  source?: EventSource;
}

const shopFrom = (r: ShopRow): Shop => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  createdAt: r.created_at,
});
const lineFrom = (r: LineRow): ProductLine => ({
  id: r.id,
  shopId: r.shop_id,
  slug: r.slug,
  niche: r.niche,
  createdAt: r.created_at,
});

/** The engine. Apps (CLI, web, MCP) are shells around this class. */
export class Shopwright {
  readonly events: EventLog;

  private constructor(private readonly db: Db) {
    this.events = new EventLog(db);
  }

  static async open(location: string): Promise<Shopwright> {
    return new Shopwright(await openDb(location));
  }

  close(): void {
    this.db.close();
  }

  // ── Shops and lines ────────────────────────────────────────────────────

  async createShop(slug: string, name: string, source: EventSource = 'manual'): Promise<Shop> {
    if (await this.db.get('SELECT 1 FROM shops WHERE slug = ?', slug)) {
      throw new ConflictError(`a shop called ${slug} already exists`);
    }
    return this.db.transaction(async () => {
      const shop: Shop = { id: randomUUID(), slug, name, createdAt: Date.now() };
      await this.db.run(
        'INSERT INTO shops (id, slug, name, created_at) VALUES (?, ?, ?, ?)',
        shop.id,
        slug,
        name,
        shop.createdAt,
      );
      // The event validates the slug; a bad one rolls the row back with it.
      await this.events.append({
        kind: 'shop.created',
        shopId: shop.id,
        payload: { slug, name },
        source,
        ts: shop.createdAt,
      });
      return shop;
    });
  }

  async listShops(): Promise<Shop[]> {
    return (await this.db.all<ShopRow>('SELECT * FROM shops ORDER BY created_at')).map(shopFrom);
  }

  async getShop(slug: string): Promise<Shop> {
    const row = await this.db.get<ShopRow>('SELECT * FROM shops WHERE slug = ?', slug);
    if (!row) throw new NotFoundError('shop', slug);
    return shopFrom(row);
  }

  async createLine(
    shopSlug: string,
    slug: string,
    niche: string,
    source: EventSource = 'manual',
  ): Promise<ProductLine> {
    const shop = await this.getShop(shopSlug);
    if (
      await this.db.get('SELECT 1 FROM product_lines WHERE shop_id = ? AND slug = ?', shop.id, slug)
    ) {
      throw new ConflictError(`${shopSlug} already has a line called ${slug}`);
    }
    const line: ProductLine = {
      id: randomUUID(),
      shopId: shop.id,
      slug,
      niche,
      createdAt: Date.now(),
    };
    return this.db.transaction(async () => {
      await this.db.run(
        'INSERT INTO product_lines (id, shop_id, slug, niche, created_at) VALUES (?, ?, ?, ?, ?)',
        line.id,
        line.shopId,
        slug,
        niche,
        line.createdAt,
      );
      await this.events.append({
        kind: 'line.created',
        shopId: shop.id,
        lineId: line.id,
        payload: { slug, niche },
        source,
        ts: line.createdAt,
      });
      return line;
    });
  }

  async listLines(shopSlug: string): Promise<ProductLine[]> {
    const shop = await this.getShop(shopSlug);
    const rows = await this.db.all<LineRow>(
      'SELECT * FROM product_lines WHERE shop_id = ? ORDER BY created_at',
      shop.id,
    );
    return rows.map(lineFrom);
  }

  // ── Runs ───────────────────────────────────────────────────────────────

  async startRun(req: StartRun): Promise<Run> {
    const shop = req.shop ? await this.getShop(req.shop) : null;
    let lineId: string | null = null;
    if (req.line) {
      if (!shop) throw new ConflictError('a line needs a shop');
      const line = await this.db.get<LineRow>(
        'SELECT * FROM product_lines WHERE shop_id = ? AND slug = ?',
        shop.id,
        req.line,
      );
      if (!line) throw new NotFoundError('line', `${shop.slug}/${req.line}`);
      lineId = line.id;
    }
    if (req.basedOn) await this.getRun(req.basedOn.runId);
    const id = randomUUID();
    const now = Date.now();
    await this.db.transaction(async () => {
      await this.db.run(
        'INSERT INTO runs (id, shop_id, line_id, stage, created_at) VALUES (?, ?, ?, ?, ?)',
        id,
        shop?.id ?? null,
        lineId,
        req.stage,
        now,
      );
      await this.events.append({
        kind: 'run.started',
        shopId: shop?.id ?? null,
        lineId,
        runId: id,
        source: req.source,
        ts: now,
        payload: {
          stage: req.stage,
          inputs: req.inputs,
          configVersion: req.configVersion,
          promptVersions: req.promptVersions ?? {},
          basedOn: req.basedOn,
        },
      });
    });
    return this.getRun(id);
  }

  async completeRun(runId: string, summary: string, artifacts: Artifact[] = []): Promise<Run> {
    await this.appendToRun(runId, 'run.completed', { summary, artifacts });
    return this.getRun(runId);
  }

  async failRun(runId: string, error: string): Promise<Run> {
    await this.appendToRun(runId, 'run.failed', { error });
    return this.getRun(runId);
  }

  /** Charge a model call to a run, so its cost counts against the shop's caps. */
  async recordLlmCall(runId: string, call: EventPayload<'llm.called'>): Promise<void> {
    await this.appendToRun(runId, 'llm.called', call);
  }

  async getRun(id: string): Promise<Run> {
    const row = await this.db.get<RunRow>('SELECT * FROM runs WHERE id = ?', id);
    if (!row) throw new NotFoundError('run', id);
    return this.fold(row);
  }

  /** Newest first. `shop` filters to one shop; `studio` to studio-level runs. */
  async listRuns(filter: { shop?: string; studio?: boolean; stage?: Stage } = {}): Promise<Run[]> {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.shop) {
      where.push('shop_id = ?');
      args.push((await this.getShop(filter.shop)).id);
    } else if (filter.studio) {
      where.push('shop_id IS NULL');
    }
    if (filter.stage) {
      where.push('stage = ?');
      args.push(filter.stage);
    }
    const rows = await this.db.all<RunRow>(
      `SELECT * FROM runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`,
      ...args,
    );
    return Promise.all(rows.map((r) => this.fold(r)));
  }

  private async fold(row: RunRow): Promise<Run> {
    const events = await this.events.forRun(row.id);
    return foldRun(
      { id: row.id, shopId: row.shop_id, lineId: row.line_id, stage: row.stage },
      events,
    );
  }

  private async appendToRun<K extends 'run.completed' | 'run.failed' | 'llm.called'>(
    runId: string,
    kind: K,
    payload: EventPayload<K>,
  ): Promise<void> {
    const run = await this.getRun(runId);
    if (kind !== 'llm.called' && run.status !== 'running') {
      throw new ConflictError(`run ${runId} already ${run.status}`);
    }
    await this.events.append({
      kind,
      shopId: run.shopId,
      lineId: run.lineId,
      runId,
      payload,
    } as Parameters<EventLog['append']>[0]);
  }
}
