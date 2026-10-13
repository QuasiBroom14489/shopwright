import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Client, Config, Transaction } from '@libsql/client';

/**
 * Schema. Entity tables hold descriptive facts (a shop's name, a line's
 * niche). The `events` table holds what *happened* and is append-only: run
 * status, sales and approvals are never columns, they are folded from events.
 * `shop_id` NULL means studio level (ADR 0001).
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE shops (
    id         TEXT PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE product_lines (
    id         TEXT PRIMARY KEY,
    shop_id    TEXT NOT NULL REFERENCES shops(id),
    slug       TEXT NOT NULL,
    niche      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (shop_id, slug)
  );

  CREATE TABLE runs (
    id         TEXT PRIMARY KEY,
    shop_id    TEXT REFERENCES shops(id),
    line_id    TEXT REFERENCES product_lines(id),
    stage      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_runs_shop ON runs(shop_id, created_at);

  CREATE TABLE events (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    id      TEXT    NOT NULL UNIQUE,
    ts      INTEGER NOT NULL,
    kind    TEXT    NOT NULL,
    shop_id TEXT REFERENCES shops(id),
    line_id TEXT REFERENCES product_lines(id),
    run_id  TEXT REFERENCES runs(id),
    source  TEXT    NOT NULL,
    payload TEXT    NOT NULL
  );
  CREATE INDEX idx_events_shop    ON events(shop_id, ts, seq);
  CREATE INDEX idx_events_run     ON events(run_id, seq);
  CREATE INDEX idx_events_kind_ts ON events(kind, ts);

  -- The log is append-only; enforce it in the database, not by convention.
  CREATE TRIGGER events_no_update BEFORE UPDATE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
  CREATE TRIGGER events_no_delete BEFORE DELETE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
  `,
];

/** A value SQLite can bind. */
export type SqlArg = string | number | bigint | null;

/**
 * The only way core touches the database: libSQL, which opens a local file,
 * `:memory:` for tests, or a hosted libSQL database. Every call
 * inside `transaction()` runs on that transaction, wherever it is awaited.
 */
export interface Db {
  all<T>(sql: string, ...args: SqlArg[]): Promise<T[]>;
  get<T>(sql: string, ...args: SqlArg[]): Promise<T | undefined>;
  run(sql: string, ...args: SqlArg[]): Promise<{ changes: number; lastInsertRowid: number }>;
  /** Run a script of statements with no parameters. */
  exec(sql: string): Promise<void>;
  /** Run `fn` atomically. Reentrant: a nested call joins the outer transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): void;
}

class LibsqlDb implements Db {
  /** The open transaction for the current async call chain, if any. */
  private readonly tx = new AsyncLocalStorage<Transaction>();

  constructor(private readonly client: Client) {}

  private get target(): Client | Transaction {
    return this.tx.getStore() ?? this.client;
  }

  async all<T>(sql: string, ...args: SqlArg[]): Promise<T[]> {
    const rs = await this.target.execute({ sql, args });
    return rs.rows as unknown as T[];
  }

  async get<T>(sql: string, ...args: SqlArg[]): Promise<T | undefined> {
    return (await this.all<T>(sql, ...args))[0];
  }

  async run(sql: string, ...args: SqlArg[]) {
    const rs = await this.target.execute({ sql, args });
    return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
  }

  async exec(sql: string): Promise<void> {
    await this.target.executeMultiple(sql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.tx.getStore()) return fn();
    const tx = await this.client.transaction('write');
    try {
      const out = await this.tx.run(tx, fn);
      await tx.commit();
      return out;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    } finally {
      tx.close();
    }
  }

  close(): void {
    this.client.close();
  }
}

/**
 * Open (and migrate) a database: a file path, `:memory:`, or a `libsql://`
 * URL with its auth token.
 */
export async function openDb(location: string, authToken?: string): Promise<Db> {
  const remote = /^(libsql|https?|wss?):/.test(location);
  const url = remote || location === ':memory:' ? location : fileUrl(location);
  // Two local processes (web and MCP) can share one file: wait for a lock
  // instead of failing with SQLITE_BUSY. libSQL turns foreign keys on per connection.
  const db = new LibsqlDb(await connect({ url, authToken, timeout: 5000 }));
  if (url.startsWith('file:')) await db.exec('PRAGMA journal_mode = WAL');
  await migrate(db);
  return db;
}

/**
 * A hosted database gets libSQL's fetch-only client. The default client loads
 * the native SQLite binding when imported, which a serverless function has no
 * use for, so it's imported only for files and `:memory:`.
 */
async function connect(config: Config): Promise<Client> {
  if (/^(libsql|https?|wss?):/.test(config.url)) {
    const { createClient } = await import('@libsql/client/web');
    return createClient(config);
  }
  const { createClient } = await import('@libsql/client');
  return createClient(config);
}

function fileUrl(path: string): string {
  const file = path.startsWith('file:') ? path.slice(5) : resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  return `file:${file}`;
}

async function migrate(db: Db): Promise<void> {
  // Applied migrations are rows, so a hosted database (which may not allow
  // setting PRAGMA user_version) migrates the same way as a file.
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const current =
    (await db.get<{ v: number | null }>('SELECT max(version) AS v FROM schema_migrations'))?.v ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    // Table rebuilds need foreign keys off, and the pragma is a no-op inside a
    // transaction, so it wraps BEGIN/COMMIT in the same script (one connection).
    try {
      await db.exec(
        `PRAGMA foreign_keys = OFF; BEGIN; ${MIGRATIONS[v]}; INSERT INTO schema_migrations VALUES (${v + 1}, ${Date.now()}); COMMIT; PRAGMA foreign_keys = ON;`,
      );
    } catch (err) {
      await db.exec('ROLLBACK; PRAGMA foreign_keys = ON;').catch(() => {});
      throw err;
    }
    const broken = await db.all('PRAGMA foreign_key_check');
    if (broken.length > 0) {
      throw new Error(`migration ${v + 1} left ${broken.length} broken foreign key(s)`);
    }
  }
}
