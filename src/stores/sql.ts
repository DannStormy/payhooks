import type { IdempotencyStore } from '../types.js';

interface Statement {
  run(...params: unknown[]): { changes: number };
}

interface SqliteDatabase {
  prepare(sql: string): Statement;
  exec(sql: string): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
}

export interface SqlStoreOptions {
  // Table used to record claimed ids. Created on first use if absent.
  tableName?: string;
  // TTL used when claim() is called without an explicit ttlSeconds.
  defaultTtlSeconds?: number;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT'
  );
}

export class SqlStore implements IdempotencyStore {
  private readonly tableName: string;
  private readonly defaultTtlSeconds?: number;
  private dbPromise: Promise<SqliteDatabase> | undefined;
  private claimFn: ((id: string, expiresAt: number | null, now: number) => boolean) | undefined;

  constructor(
    // An existing better-sqlite3 Database instance, or a file path / ':memory:'.
    private readonly dbOrPath: SqliteDatabase | string,
    options: SqlStoreOptions = {},
  ) {
    this.tableName = options.tableName ?? 'payhooks_idempotency';
    this.defaultTtlSeconds = options.defaultTtlSeconds;
  }

  private async db(): Promise<SqliteDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.resolveDb();
    }
    return this.dbPromise;
  }

  private async resolveDb(): Promise<SqliteDatabase> {
    const given = this.dbOrPath;
    let db: SqliteDatabase;

    if (typeof given === 'string') {
      // Indirect specifier so the type checker does not try to resolve this
      // optional peer dep at build time when it is not installed.
      const specifier = 'better-sqlite3';
      let mod: { default: new (path: string) => SqliteDatabase };
      try {
        mod = (await import(specifier)) as unknown as {
          default: new (path: string) => SqliteDatabase;
        };
      } catch {
        throw new Error(
          'SqlStore requires the "better-sqlite3" package, which is not installed. ' +
            'Install it with `npm install better-sqlite3` (it is an optional peer dependency), ' +
            'or pass an existing better-sqlite3 Database instance to the SqlStore constructor.',
        );
      }
      const Database = mod.default;
      db = new Database(given);
    } else {
      db = given;
    }

    db.exec(
      `CREATE TABLE IF NOT EXISTS "${this.tableName}" (` +
        'id TEXT PRIMARY KEY, ' +
        'expires_at INTEGER' +
        ')',
    );

    const insert = db.prepare(
      `INSERT INTO "${this.tableName}" (id, expires_at) VALUES (?, ?)`,
    );
    const reclaim = db.prepare(
      `UPDATE "${this.tableName}" SET expires_at = ? ` +
        'WHERE id = ? AND expires_at IS NOT NULL AND expires_at <= ?',
    );

    this.claimFn = db.transaction(
      (id: string, expiresAt: number | null, now: number): boolean => {
        try {
          insert.run(id, expiresAt);
          return true;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          const res = reclaim.run(expiresAt, id, now);
          return res.changes > 0;
        }
      },
    );

    return db;
  }

  async claim(id: string, ttlSeconds?: number): Promise<boolean> {
    await this.db();
    const now = Date.now();
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = ttl === undefined ? null : now + ttl * 1000;
    return this.claimFn!(id, expiresAt, now);
  }
}
