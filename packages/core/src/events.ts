import { randomUUID } from 'node:crypto';
import {
  type AnyEvent,
  type EventKind,
  EventPayloads,
  type NewEvent,
  type ShopEvent,
} from '@shopwright/shared';
import type { Db } from './db.js';

interface EventRow {
  seq: number;
  id: string;
  ts: number;
  kind: string;
  shop_id: string | null;
  line_id: string | null;
  run_id: string | null;
  source: string;
  payload: string;
}

function fromRow(row: EventRow): AnyEvent {
  return {
    seq: row.seq,
    id: row.id,
    ts: row.ts,
    kind: row.kind,
    shopId: row.shop_id,
    lineId: row.line_id,
    runId: row.run_id,
    source: row.source,
    payload: JSON.parse(row.payload),
  } as AnyEvent;
}

/** The only write path for events. Payloads are validated before they land. */
export class EventLog {
  constructor(private readonly db: Db) {}

  async append<K extends EventKind>(ev: NewEvent<K>): Promise<ShopEvent<K>> {
    const payload = EventPayloads[ev.kind].parse(ev.payload) as ShopEvent<K>['payload'];
    const id = randomUUID();
    const ts = ev.ts ?? Date.now();
    const source = ev.source ?? 'manual';
    const scope = { shopId: ev.shopId ?? null, lineId: ev.lineId ?? null, runId: ev.runId ?? null };
    const info = await this.db.run(
      `INSERT INTO events (id, ts, kind, shop_id, line_id, run_id, source, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ts,
      ev.kind,
      scope.shopId,
      scope.lineId,
      scope.runId,
      source,
      JSON.stringify(payload),
    );
    return { seq: info.lastInsertRowid, id, ts, kind: ev.kind, ...scope, source, payload };
  }

  forShop(shopId: string): Promise<AnyEvent[]> {
    return this.select('WHERE shop_id = ? ORDER BY ts, seq', shopId);
  }

  forRun(runId: string): Promise<AnyEvent[]> {
    return this.select('WHERE run_id = ? ORDER BY seq', runId);
  }

  ofKinds(...kinds: EventKind[]): Promise<AnyEvent[]> {
    return this.select(
      `WHERE kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY ts, seq`,
      ...kinds,
    );
  }

  private async select(tail: string, ...params: string[]): Promise<AnyEvent[]> {
    const rows = await this.db.all<EventRow>(`SELECT * FROM events ${tail}`, ...params);
    return rows.map(fromRow);
  }
}
