import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paystack } from '../src/providers/paystack.js';
import { fixtureText, paystackSignature, PAYSTACK_SECRET } from './helpers.js';

const body = fixtureText('paystack', 'charge.success.json');

test('paystack: valid signature passes', () => {
  const headers = { 'x-paystack-signature': paystackSignature(body, PAYSTACK_SECRET) };
  assert.equal(paystack.verify(body, headers, PAYSTACK_SECRET), true);
});

test('paystack: valid signature passes for a Buffer body', () => {
  const headers = { 'x-paystack-signature': paystackSignature(body, PAYSTACK_SECRET) };
  assert.equal(paystack.verify(Buffer.from(body, 'utf8'), headers, PAYSTACK_SECRET), true);
});

test('paystack: tampered body fails', () => {
  const headers = { 'x-paystack-signature': paystackSignature(body, PAYSTACK_SECRET) };
  const tampered = body.replace('10000', '99999');
  assert.notEqual(tampered, body);
  assert.equal(paystack.verify(tampered, headers, PAYSTACK_SECRET), false);
});

test('paystack: wrong secret fails', () => {
  const headers = { 'x-paystack-signature': paystackSignature(body, PAYSTACK_SECRET) };
  assert.equal(paystack.verify(body, headers, 'sk_test_wrong_secret'), false);
});

test('paystack: missing header fails', () => {
  assert.equal(paystack.verify(body, {}, PAYSTACK_SECRET), false);
});

test('paystack: empty signature header fails', () => {
  assert.equal(paystack.verify(body, { 'x-paystack-signature': '' }, PAYSTACK_SECRET), false);
});

test('paystack: signature of wrong length fails without throwing', () => {
  assert.equal(paystack.verify(body, { 'x-paystack-signature': 'deadbeef' }, PAYSTACK_SECRET), false);
});
