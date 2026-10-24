import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paystack } from '../src/providers/paystack.js';
import { flutterwave } from '../src/providers/flutterwave.js';
import { fixtureText } from './helpers.js';

function normPaystack(file: string) {
  return paystack.normalize(fixtureText('paystack', file), {});
}
function normFlutterwave(file: string) {
  return flutterwave.normalize(fixtureText('flutterwave', file), {});
}

test('paystack: charge.success maps to the expected normalized fields', () => {
  const e = normPaystack('charge.success.json');
  assert.equal(e.provider, 'paystack');
  assert.equal(e.id, 'paystack:6691413829');
  assert.equal(e.type, 'charge.success');
  assert.equal(e.reference, 'T161186953677433');
  assert.equal(e.amount, 8000); // 800000 kobo -> 8000 NGN major units
  assert.equal(e.currency, 'NGN');
  assert.deepEqual(e.customer, { email: 'company@yopmail.com', name: 'Liya Pra7' });
  assert.ok(e.raw);
});

test('paystack: refund (refund.pending) maps to type "refund"', () => {
  const e = normPaystack('refund.json');
  assert.equal(e.type, 'refund');
  // real refunds carry no data.reference; reference comes from transaction_reference (the original charge)
  assert.equal(e.reference, 'T161186953677433');
  assert.equal(e.id, 'paystack:18833241'); // the refund's own data.id
  assert.equal(e.amount, 8000);
  assert.equal(e.currency, 'NGN');
  assert.deepEqual(e.customer, { email: 'company@yopmail.com', name: 'Liya Pra7' });
});

test('paystack: unknown event type passes through as "unknown" without throwing', () => {
  const e = normPaystack('unknown.json');
  assert.equal(e.type, 'unknown');
  assert.equal(e.reference, 'SUB_ref_001');
  assert.equal(e.amount, 500);
  assert.equal(e.currency, 'NGN');
});

test('paystack: distinct events on the same reference get distinct dedup ids', () => {
  const charge = normPaystack('charge.success.json');
  const refund = normPaystack('refund.json');
  assert.equal(charge.reference, refund.reference);
  assert.notEqual(charge.id, refund.id);
});

test('flutterwave: charge.completed (successful) maps to "charge.success"', () => {
  const e = normFlutterwave('charge.completed.json');
  assert.equal(e.provider, 'flutterwave');
  assert.equal(e.type, 'charge.success');
  assert.equal(e.reference, 'Links-616626414629');
  assert.equal(e.amount, 100); // flutterwave amounts are already in major units
  assert.equal(e.currency, 'NGN');
  assert.deepEqual(e.customer, { email: 'user@gmail.com', name: 'Yemi Desola' });
  assert.ok(e.raw);
});

test('flutterwave: legacy v2 Rave webhook (event.type, no data wrapper) maps to charge.success', () => {
  const e = normFlutterwave('charge.v2.json');
  assert.equal(e.provider, 'flutterwave');
  assert.equal(e.type, 'charge.success');
  assert.equal(e.reference, 'Rave-Pages213861598699'); // v2 txRef, not data.tx_ref
  assert.equal(e.amount, 4000);
  assert.equal(e.currency, 'NGN');
  assert.deepEqual(e.customer, { email: 'ravesb_test@example.com', name: 'Jane Doe' }); // v2 fullName -> name
  assert.equal(e.id, '10572720:charge.success');
});

test('flutterwave: charge.refund maps to type "refund"', () => {
  const e = normFlutterwave('refund.json');
  assert.equal(e.type, 'refund');
  assert.equal(e.reference, 'Links-616626414629');
  assert.equal(e.amount, 100); // amount_refunded
  assert.equal(e.currency, 'NGN');
});

test('flutterwave: unknown event type passes through as "unknown" without throwing', () => {
  const e = normFlutterwave('unknown.json');
  assert.equal(e.type, 'unknown');
  assert.equal(e.reference, 'Sub-991827364550');
  assert.equal(e.amount, 5000);
  assert.equal(e.currency, 'NGN');
});

// Core guarantee: one transaction fires several distinct events (success, refund).
// They share Flutterwave's data.id (a transaction id, not an event id), so the dedup
// key MUST still tell them apart or the refund gets swallowed as a duplicate.
test('flutterwave: a charge and a refund on the same transaction get distinct dedup ids', () => {
  const charge = normFlutterwave('charge.completed.json');
  const refund = normFlutterwave('refund.json');
  assert.notEqual(charge.id, refund.id);
});
