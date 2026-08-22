import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/handler.js';
import { paystack } from '../src/providers/paystack.js';
import { flutterwave } from '../src/providers/flutterwave.js';
import { MemoryStore } from '../src/stores/memory.js';
import {
  fixtureText,
  paystackHeaders,
  flutterwaveHeaders,
  PAYSTACK_SECRET,
  FLUTTERWAVE_SECRET,
} from './helpers.js';

function newHandler() {
  return createHandler({
    store: new MemoryStore(),
    providers: {
      paystack: { provider: paystack, secret: PAYSTACK_SECRET },
      flutterwave: { provider: flutterwave, secret: FLUTTERWAVE_SECRET },
    },
  });
}

const paystackBody = fixtureText('paystack', 'charge.success.json');
const flutterwaveBody = fixtureText('flutterwave', 'charge.completed.json');

test('handler: ok on a valid signed paystack fixture (auto-detected)', async () => {
  const h = newHandler();
  const res = await h.handle(paystackBody, paystackHeaders(paystackBody, PAYSTACK_SECRET));
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.duplicate, false);
    assert.equal(res.event.provider, 'paystack');
    assert.equal(res.event.type, 'charge.success');
    assert.equal(res.event.id, 'paystack:302961');
  }
});

test('handler: ok on a valid signed flutterwave fixture (auto-detected)', async () => {
  const h = newHandler();
  const res = await h.handle(flutterwaveBody, flutterwaveHeaders(FLUTTERWAVE_SECRET));
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.duplicate, false);
    assert.equal(res.event.provider, 'flutterwave');
    assert.equal(res.event.type, 'charge.success');
  }
});

test('handler: invalid signature is rejected', async () => {
  const h = newHandler();
  const res = await h.handle(paystackBody, { 'x-paystack-signature': 'deadbeef' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'invalid_signature');
});

test('handler: tampered body is rejected as invalid_signature (paystack)', async () => {
  const h = newHandler();
  const headers = paystackHeaders(paystackBody, PAYSTACK_SECRET);
  const tampered = paystackBody.replace('10000', '99999');
  const res = await h.handle(tampered, headers);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'invalid_signature');
});

test('handler: redelivery of the same event is flagged duplicate (no-op)', async () => {
  const h = newHandler();
  const headers = paystackHeaders(paystackBody, PAYSTACK_SECRET);
  const first = await h.handle(paystackBody, headers);
  const second = await h.handle(paystackBody, headers);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok) assert.equal(first.duplicate, false);
  if (second.ok) assert.equal(second.duplicate, true);
  if (first.ok && second.ok) assert.equal(first.event.id, second.event.id);
});

test('handler: a charge then a refund on the same transaction are both processed (not deduped)', async () => {
  const h = newHandler();
  const charge = await h.handle(flutterwaveBody, flutterwaveHeaders(FLUTTERWAVE_SECRET));
  const refundBody = fixtureText('flutterwave', 'refund.json');
  const refund = await h.handle(refundBody, flutterwaveHeaders(FLUTTERWAVE_SECRET));
  assert.equal(charge.ok, true);
  assert.equal(refund.ok, true);
  if (charge.ok) assert.equal(charge.duplicate, false);
  if (refund.ok) assert.equal(refund.duplicate, false); // refund must NOT be swallowed
});

test('handler: unknown_provider when no registered provider header is present', async () => {
  const h = newHandler();
  const res = await h.handle(paystackBody, { 'content-type': 'application/json' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'unknown_provider');
});

test('handler: unknown_provider when an explicit provider is not registered', async () => {
  const h = createHandler({
    store: new MemoryStore(),
    providers: { paystack: { provider: paystack, secret: PAYSTACK_SECRET } },
  });
  const res = await h.handle(flutterwaveBody, flutterwaveHeaders(FLUTTERWAVE_SECRET), 'flutterwave');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'unknown_provider');
});

test('handler: explicit provider hint is honored', async () => {
  const h = newHandler();
  const res = await h.handle(
    paystackBody,
    paystackHeaders(paystackBody, PAYSTACK_SECRET),
    'paystack',
  );
  assert.equal(res.ok, true);
});

test('handler: a valid signature over a non-JSON body is rejected as unparseable', async () => {
  const h = newHandler();
  const garbage = 'this-is-not-json';
  const headers = paystackHeaders(garbage, PAYSTACK_SECRET);
  const res = await h.handle(garbage, headers);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'unparseable');
});

test('handler: an unknown event type is still processed ok (type "unknown")', async () => {
  const h = newHandler();
  const body = fixtureText('paystack', 'unknown.json');
  const res = await h.handle(body, paystackHeaders(body, PAYSTACK_SECRET));
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.event.type, 'unknown');
});
