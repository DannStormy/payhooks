import { createHash, timingSafeEqual } from 'node:crypto';
import type { NormalizedEvent, Provider } from '../types.js';

function toStr(rawBody: string | Buffer): string {
  return typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function hashId(reference: string, type: string, rawBody: string): string {
  return createHash('sha256')
    .update(`flutterwave|${reference}|${type}|${rawBody}`)
    .digest('hex');
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export const flutterwave: Provider = {
  name: 'flutterwave',

  verify(rawBody, headers, secret) {
    // Unlike Paystack (HMAC-SHA512 over the raw body), Flutterwave sends a static 'verif-hash' header that must equal the merchant's configured secret hash verbatim.
    const sent = header(headers, 'verif-hash');
    if (!sent || !secret) return false;
    return constantTimeEquals(sent, secret);
  },

  normalize(rawBody) {
    const raw = toStr(rawBody);
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    const data = parsed?.data ?? {};
    // Flutterwave uses both `event` (v3) and legacy `event.type`; check both.
    const eventName = str(parsed?.event) ?? str(parsed?.['event.type']) ?? '';
    const status = str(data?.status)?.toLowerCase();

    const reference = str(data?.tx_ref) ?? str(data?.reference) ?? '';

    let type: string;
    const e = eventName.toLowerCase();
    if (e === 'charge.completed') {
      type = status === 'successful' ? 'charge.success' : 'charge.failed';
    } else if (e.includes('refund') || e === 'refund') {
      type = 'refund';
    } else {
      type = 'unknown';
    }

    // Flutterwave sends amounts in MAJOR units already (e.g. 100 == NGN 100), unlike Paystack's kobo, so no minor->major conversion.
    const amount =
      num(data?.amount_refunded) ?? num(data?.amount) ?? 0;

    const currency = str(data?.currency) ?? '';

    // data.id is Flutterwave's TRANSACTION id, reused across a transaction's events
    // (charge, refund, chargeback all carry the same one). Compose type in so distinct
    // events on one transaction get distinct dedup keys and a refund is not swallowed.
    const providerId = data?.id ?? parsed?.id;
    const id =
      providerId != null ? `${String(providerId)}:${type}` : hashId(reference, type, raw);

    let customer: NormalizedEvent['customer'] = null;
    const c = data?.customer;
    if (c && typeof c === 'object') {
      const email = str(c.email);
      const name = str(c.name);
      if (email || name) {
        customer = {};
        if (email) customer.email = email;
        if (name) customer.name = name;
      }
    }

    return {
      id,
      provider: 'flutterwave',
      type,
      reference,
      amount,
      currency,
      customer,
      raw: parsed,
    };
  },
};
