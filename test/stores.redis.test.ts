import { test } from 'node:test';
import assert from 'node:assert/strict';
import RedisMock from 'ioredis-mock';
import { RedisStore } from '../src/stores/redis.js';
import { sleep } from './helpers.js';

// ioredis-mock implements real Redis command semantics (SET with NX + EX,
// and TTL expiry), so these exercise the actual claim path, not a hand-rolled stub.
// All ioredis-mock instances share one dataset, so give each store a unique key
// prefix to keep tests isolated from each other.
let storeSeq = 0;
function newStore(opts = {}) {
  return new RedisStore(new RedisMock(), { keyPrefix: `t${storeSeq++}:`, ...opts });
}

test('redis: first claim returns true', async () => {
  const store = newStore();
  assert.equal(await store.claim('evt_1'), true);
});

test('redis: redelivery of the same id returns false (no-op)', async () => {
  const store = newStore();
  assert.equal(await store.claim('evt_1'), true);
  assert.equal(await store.claim('evt_1'), false);
  assert.equal(await store.claim('evt_1'), false);
});

test('redis: distinct ids are claimed independently', async () => {
  const store = newStore();
  assert.equal(await store.claim('evt_a'), true);
  assert.equal(await store.claim('evt_b'), true);
  assert.equal(await store.claim('evt_a'), false);
});

test('redis: a claim can be re-taken after its ttl expires', async () => {
  const store = newStore();
  assert.equal(await store.claim('short', 1), true); // 1s ttl
  assert.equal(await store.claim('short', 1), false); // still live
  await sleep(1100);
  assert.equal(await store.claim('short', 1), true); // expired, re-claimable
});

test('redis: per-call ttl overrides the store default', async () => {
  const store = newStore({ defaultTtlSeconds: 3600 });
  assert.equal(await store.claim('override', 1), true);
  await sleep(1100);
  assert.equal(await store.claim('override', 1), true);
});

test('redis: default ttl is applied when claim is called without one', async () => {
  const store = newStore({ defaultTtlSeconds: 1 });
  assert.equal(await store.claim('def'), true);
  await sleep(1100);
  assert.equal(await store.claim('def'), true);
});

test('redis: keyPrefix is applied so claims are namespaced', async () => {
  const client = new RedisMock();
  const store = new RedisStore(client, { keyPrefix: 'custom:idem:' });
  await store.claim('evt_1');
  assert.equal(await client.get('custom:idem:evt_1'), '1');
  assert.equal(await client.get('evt_1'), null);
});

test('redis: an existing client instance is reused, not reconnected', async () => {
  const client = new RedisMock();
  const a = new RedisStore(client);
  const b = new RedisStore(client);
  assert.equal(await a.claim('shared'), true);
  assert.equal(await b.claim('shared'), false); // same backing store
});
