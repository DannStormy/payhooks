import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'node-sqlite3-wasm';
import { SqlStore } from '../src/stores/sql.js';

const { Database: WasmDatabase } = sqlite3;
import { sleep } from './helpers.js';

// node-sqlite3-wasm is a real SQLite engine (no native build), so these run the
// store's actual SQL. It exposes a slightly different API than better-sqlite3,
// so this adapter maps it to the { prepare, exec, transaction } shape SqlStore
// expects, including translating a constraint error to the code the store checks.
function makeDb() {
  const db = new WasmDatabase(':memory:');
  return {
    prepare(sql: string) {
      // Re-prepare per run: better-sqlite3 auto-resets a reused statement, but
      // node-sqlite3-wasm does not, so a fresh statement each call keeps the
      // adapter honest without changing the store under test.
      return {
        run(...params: unknown[]) {
          const stmt = db.prepare(sql);
          try {
            const res = stmt.run(params as never);
            return { changes: res.changes };
          } catch (err) {
            const msg = (err as { message?: string })?.message ?? '';
            if (/constraint/i.test(msg)) {
              const e = new Error(msg) as Error & { code: string };
              e.code = 'SQLITE_CONSTRAINT_UNIQUE';
              throw e;
            }
            throw err;
          }
        },
      };
    },
    exec(sql: string) {
      return db.exec(sql);
    },
    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return ((...args: never[]) => {
        db.exec('BEGIN');
        try {
          const out = fn(...args);
          db.exec('COMMIT');
          return out;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      }) as T;
    },
  };
}

function newStore(opts = {}) {
  return new SqlStore(makeDb(), opts);
}

test('sql: first claim returns true', async () => {
  const store = newStore();
  assert.equal(await store.claim('evt_1'), true);
});

test('sql: redelivery of the same id returns false (no-op)', async () => {
  const store = newStore();
  assert.equal(await store.claim('evt_1'), true);
  assert.equal(await store.claim('evt_1'), false);
  assert.equal(await store.claim('evt_1'), false);
});

test('sql: distinct ids are claimed independently', async () => {
  const store = newStore();
  assert.equal(await store.claim('evt_a'), true);
  assert.equal(await store.claim('evt_b'), true);
  assert.equal(await store.claim('evt_a'), false);
});

test('sql: no ttl means the claim never expires', async () => {
  const store = newStore();
  assert.equal(await store.claim('forever'), true);
  await sleep(30);
  assert.equal(await store.claim('forever'), false);
});

test('sql: a claim can be re-taken after its ttl expires', async () => {
  const store = newStore();
  assert.equal(await store.claim('short', 0.03), true); // 30ms ttl
  assert.equal(await store.claim('short', 0.03), false); // still live
  await sleep(60);
  assert.equal(await store.claim('short', 0.03), true); // expired, re-claimable
});

test('sql: per-call ttl overrides the store default', async () => {
  const store = newStore({ defaultTtlSeconds: 3600 });
  assert.equal(await store.claim('override', 0.03), true);
  await sleep(60);
  assert.equal(await store.claim('override', 0.03), true);
});

test('sql: default ttl is applied when claim is called without one', async () => {
  const store = newStore({ defaultTtlSeconds: 0.03 });
  assert.equal(await store.claim('def'), true);
  await sleep(60);
  assert.equal(await store.claim('def'), true);
});

test('sql: a custom table name is honored', async () => {
  const store = newStore({ tableName: 'my_idem' });
  assert.equal(await store.claim('evt_1'), true);
  assert.equal(await store.claim('evt_1'), false);
});
