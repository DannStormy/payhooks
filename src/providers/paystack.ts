import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NormalizedEvent, Provider } from '../types.js';

const SIGNATURE_HEADER = 'x-paystack-signature';

function toBuffer(rawBody: string | Buffer): Buffer {
  return typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
}

function verify(
  rawBody: string | Buffer,
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  const provided = headers[SIGNATURE_HEADER];
  if (!provided) return false;

  const expected = createHmac('sha512', secret).update(toBuffer(rawBody)).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Paystack event.event -> our normalized type. Anything not here becomes 'unknown'.
const TYPE_MAP: Record<string, string> = {
  'charge.success': 'charge.success',
  'refund.processed': 'refund',
  'refund.failed': 'refund',
  'refund.pending': 'refund',
  'refund.processing': 'refund',
  'charge.dispute.create': 'chargeback',
  'charge.dispute.remind': 'chargeback',
  'charge.dispute.resolve': 'chargeback',
};

interface PaystackCustomer {
  email?: string;
  first_name?: string;
  last_name?: string;
  [k: string]: unknown;
}

interface PaystackData {
  id?: number | string;
  reference?: string;
  amount?: number;
  currency?: string;
  customer?: PaystackCustomer | null;
  [k: string]: unknown;
}

interface PaystackPayload {
  event?: string;
  data?: PaystackData;
  [k: string]: unknown;
}

function normalizeCustomer(c: PaystackCustomer | null | undefined): NormalizedEvent['customer'] {
  if (!c) return null;
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  const out: { email?: string; name?: string } = {};
  if (c.email) out.email = c.email;
  if (name) out.name = name;
  return out.email || out.name ? out : null;
}

function koboToMajor(amount: number | undefined): number {
  return typeof amount === 'number' ? amount / 100 : 0;
}

function normalize(
  rawBody: string | Buffer,
  _headers: Record<string, string | undefined>,
): NormalizedEvent {
  const rawString = toBuffer(rawBody).toString('utf8');
  const payload = JSON.parse(rawString) as PaystackPayload;
  const data = payload.data ?? {};

  const eventName = typeof payload.event === 'string' ? payload.event : '';
  const type = TYPE_MAP[eventName] ?? 'unknown';

  const reference = typeof data.reference === 'string' ? data.reference : '';

  const providerId =
    data.id !== undefined && data.id !== null && data.id !== ''
      ? String(data.id)
      : reference || undefined;

  const id = providerId
    ? `paystack:${providerId}`
    : `paystack:${createHash('sha256')
        .update(`paystack|${reference}|${type}|${rawString}`)
        .digest('hex')}`;

  return {
    id,
    provider: 'paystack',
    type,
    reference,
    amount: koboToMajor(data.amount),
    currency: typeof data.currency === 'string' ? data.currency : '',
    customer: normalizeCustomer(data.customer),
    raw: payload,
  };
}

export const paystack: Provider = {
  name: 'paystack',
  verify,
  normalize,
};
