import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flutterwave } from '../src/providers/flutterwave.js';
import { fixtureText, FLUTTERWAVE_SECRET } from './helpers.js';

const body = fixtureText('flutterwave', 'charge.completed.json');

test('flutterwave: valid verif-hash passes', () => {
  const headers = { 'verif-hash': FLUTTERWAVE_SECRET };
  assert.equal(flutterwave.verify(body, headers, FLUTTERWAVE_SECRET), true);
});

test('flutterwave: header casing is ignored (Verif-Hash passes)', () => {
  const headers = { 'Verif-Hash': FLUTTERWAVE_SECRET };
  assert.equal(flutterwave.verify(body, headers, FLUTTERWAVE_SECRET), true);
});

// Flutterwave's verif-hash is a shared secret echoed verbatim, NOT a signature over
// the body. An attacker who cannot produce the correct hash is rejected, which is the
// real protection. See the "tampered body" note below.
test('flutterwave: wrong verif-hash fails (an attacker who lacks the secret is rejected)', () => {
  const headers = { 'verif-hash': 'not-the-secret' };
  assert.equal(flutterwave.verify(body, headers, FLUTTERWAVE_SECRET), false);
});

test('flutterwave: wrong secret fails', () => {
  const headers = { 'verif-hash': FLUTTERWAVE_SECRET };
  assert.equal(flutterwave.verify(body, headers, 'different-configured-secret'), false);
});

test('flutterwave: missing header fails', () => {
  assert.equal(flutterwave.verify(body, {}, FLUTTERWAVE_SECRET), false);
});

test('flutterwave: empty secret fails', () => {
  const headers = { 'verif-hash': '' };
  assert.equal(flutterwave.verify(body, headers, ''), false);
});

// DESIGN LIMITATION (documented, asserted so nobody assumes otherwise):
// Flutterwave's verif-hash does not cover the request body, so a body tampered in
// transit while the correct hash is still present is NOT detectable by this scheme.
// The only thing that stops forgery is that an attacker cannot produce the hash.
// This is a property of Flutterwave's design, not a bug in the kit. It is called out
// in the README so integrators do not rely on body integrity from the header alone.
test('flutterwave: tampered body with a valid hash is NOT detectable (documented design limitation)', () => {
  const headers = { 'verif-hash': FLUTTERWAVE_SECRET };
  const tampered = body.replace('100', '999999');
  assert.notEqual(tampered, body);
  assert.equal(flutterwave.verify(tampered, headers, FLUTTERWAVE_SECRET), true);
});
