import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/stores/memory.js';
import { sleep } from './helpers.js';

test('memory: first claim returns true', async () => {
  const store = new MemoryStore();
  assert.equal(await store.claim('evt_1'), true);
});

test('memory: redelivery of the same id returns false (no-op)', async () => {
  const store = new MemoryStore();
  assert.equal(await store.claim('evt_1'), true);
  assert.equal(await store.claim('evt_1'), false);
  assert.equal(await store.claim('evt_1'), false);
});

test('memory: distinct ids are claimed independently', async () => {
  const store = new MemoryStore();
  assert.equal(await store.claim('evt_a'), true);
  assert.equal(await store.claim('evt_b'), true);
  assert.equal(await store.claim('evt_a'), false);
});

test('memory: no ttl means the claim never expires', async () => {
  const store = new MemoryStore();
  assert.equal(await store.claim('forever'), true);
  await sleep(30);
  assert.equal(await store.claim('forever'), false);
});

test('memory: a claim can be re-taken after its ttl expires', async () => {
  const store = new MemoryStore();
  assert.equal(await store.claim('short', 0.03), true); // 30ms ttl
  assert.equal(await store.claim('short', 0.03), false); // still live
  await sleep(60);
  assert.equal(await store.claim('short', 0.03), true); // expired, re-claimable
});

test('memory: per-call ttl overrides the store default', async () => {
  const store = new MemoryStore({ defaultTtlSeconds: 3600 });
  assert.equal(await store.claim('override', 0.03), true);
  await sleep(60);
  assert.equal(await store.claim('override', 0.03), true);
});

test('memory: default ttl is applied when claim is called without one', async () => {
  const store = new MemoryStore({ defaultTtlSeconds: 0.03 });
  assert.equal(await store.claim('def'), true);
  await sleep(60);
  assert.equal(await store.claim('def'), true);
});
