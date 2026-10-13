import {
  ConflictError,
  NotFoundError,
  Shopwright,
  stableStringify,
  versionOf,
} from '@shopwright/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let sw: Shopwright;
beforeEach(async () => {
  sw = await Shopwright.open(':memory:');
});
afterEach(() => sw.close());

describe('shops and lines', () => {
  it('creates and lists shops and their lines', async () => {
    await sw.createShop('paper-owl', 'Paper Owl Studio');
    await sw.createLine('paper-owl', 'semester', 'student semester planners');
    expect((await sw.listShops()).map((s) => s.slug)).toEqual(['paper-owl']);
    expect((await sw.listLines('paper-owl')).map((l) => l.niche)).toEqual([
      'student semester planners',
    ]);
  });

  it('rejects duplicates and bad slugs without leaving rows behind', async () => {
    await sw.createShop('paper-owl', 'Paper Owl Studio');
    await expect(sw.createShop('paper-owl', 'Again')).rejects.toBeInstanceOf(ConflictError);
    await expect(sw.createShop('Bad Slug!', 'Nope')).rejects.toThrow();
    expect(await sw.listShops()).toHaveLength(1);
  });

  it('keeps the event log append-only', async () => {
    await sw.createShop('paper-owl', 'Paper Owl Studio');
    const db = (sw as unknown as { db: { run(sql: string): Promise<unknown> } }).db;
    await expect(db.run('DELETE FROM events')).rejects.toThrow(/append-only/);
    await expect(db.run("UPDATE events SET kind = 'x'")).rejects.toThrow(/append-only/);
  });
});

describe('runs', () => {
  it('folds status, artifacts and cost from events', async () => {
    const run = await sw.startRun({
      stage: 'research',
      inputs: { seeds: ['planner'] },
      configVersion: 'abc123',
    });
    expect(run.status).toBe('running');
    expect(run.shopId).toBeNull();

    await sw.recordLlmCall(run.id, {
      provider: 'claude',
      model: 'claude-sonnet-5-5',
      purpose: 'seed expansion',
      promptHash: 'p1',
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.25,
    });
    const done = await sw.completeRun(run.id, 'ranked 8 niches', [
      { path: 'studio/research/x/report.md', sha256: 'a'.repeat(64) },
    ]);
    expect(done).toMatchObject({ status: 'completed', summary: 'ranked 8 niches', costUsd: 0.25 });
    expect(done.artifacts).toHaveLength(1);
    await expect(sw.failRun(run.id, 'late')).rejects.toBeInstanceOf(ConflictError);
  });

  it('scopes runs to shops and lines, and links replays to their source', async () => {
    await sw.createShop('paper-owl', 'Paper Owl Studio');
    await sw.createLine('paper-owl', 'semester', 'student semester planners');
    const first = await sw.startRun({
      stage: 'research',
      shop: 'paper-owl',
      inputs: {},
      configVersion: 'v1',
    });
    const replay = await sw.startRun({
      stage: 'research',
      shop: 'paper-owl',
      line: 'semester',
      inputs: {},
      configVersion: 'v1',
      basedOn: { runId: first.id, mode: 'replay' },
    });
    expect(replay.basedOn).toEqual({ runId: first.id, mode: 'replay' });
    expect(await sw.listRuns({ shop: 'paper-owl' })).toHaveLength(2);
    expect(await sw.listRuns({ studio: true })).toHaveLength(0);
    await expect(
      sw.startRun({
        stage: 'research',
        inputs: {},
        configVersion: 'v1',
        basedOn: { runId: 'nope', mode: 'like' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('versions', () => {
  it('hashes equal configs equally regardless of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
    expect(versionOf({ a: 1, b: 2 })).toBe(versionOf({ b: 2, a: 1 }));
    expect(versionOf({ a: 1 })).not.toBe(versionOf({ a: 2 }));
  });
});
