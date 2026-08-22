import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixturesDir = join(root, 'src', 'providers', '__fixtures__');

export function fixtureText(provider: 'paystack' | 'flutterwave', file: string): string {
  return readFileSync(join(fixturesDir, provider, file), 'utf8');
}

export function fixtureJson<T = any>(provider: 'paystack' | 'flutterwave', file: string): T {
  return JSON.parse(fixtureText(provider, file)) as T;
}

// Paystack signs the raw body with HMAC-SHA512, hex-encoded, in x-paystack-signature.
export function paystackSignature(rawBody: string, secret: string): string {
  return createHmac('sha512', secret).update(Buffer.from(rawBody, 'utf8')).digest('hex');
}

export function paystackHeaders(rawBody: string, secret: string): Record<string, string> {
  return { 'x-paystack-signature': paystackSignature(rawBody, secret) };
}

// Flutterwave sends a static secret hash verbatim in verif-hash (it does NOT sign the body).
export function flutterwaveHeaders(secret: string): Record<string, string> {
  return { 'verif-hash': secret };
}

export const PAYSTACK_SECRET = 'sk_test_paystack_secret_0123456789';
export const FLUTTERWAVE_SECRET = 'flw_verif_hash_secret_abcdef';

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
