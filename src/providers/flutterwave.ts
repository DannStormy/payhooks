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

/**
 * Flutterwave provider. Normalizes both webhook shapes to one `NormalizedEvent`:
 * v3 (Standard checkout / v3 API, the current standard) and v2 (legacy Rave Pages).
 *
 * Validation note: the v2 charge shape is verified against real test-mode traffic.
 * The v3 fixtures are documentation-derived and not yet captured from live traffic;
 * the v3 refund event in particular is unverified, so confirm it before relying on
 * v3 refund handling in production.
 */
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
    const body = parsed ?? {};

    // Flutterwave ships two webhook shapes. v3 (Standard/API): top-level `event`
    // string + a `data` object. v2 (legacy Rave Pages): fields at the root,
    // camelCase (txRef/flwRef), customer.fullName, and a key literally named
    // "event.type" holding the channel (CARD_TRANSACTION, BANK_TRANSFER_TRANSACTION).
    // Both are live in the wild, so pick the shape before reading any field.
    const isV3 = typeof str(body.event) === 'string';
    const src = isV3 ? (body.data ?? {}) : body;

    const eventName = (isV3 ? str(body.event) : str(body['event.type']))?.toLowerCase() ?? '';
    const status = str(src.status)?.toLowerCase();

    const reference = isV3
      ? str(src.tx_ref) ?? str(src.reference) ?? ''
      : str(src.txRef) ?? str(src.flwRef) ?? '';

    let type: string;
    if (eventName === 'charge.completed' || eventName.endsWith('_transaction')) {
      // v3 lifecycle event, or any v2 channel event: the outcome is in `status`.
      type = status === 'successful' ? 'charge.success' : 'charge.failed';
    } else if (eventName.includes('refund')) {
      type = 'refund';
    } else {
      type = 'unknown';
    }

    // Flutterwave sends amounts in MAJOR units already (e.g. 100 == NGN 100), unlike Paystack's kobo, so no minor->major conversion.
    const amount = num(src.amount_refunded) ?? num(src.amount) ?? 0;
    const currency = str(src.currency) ?? '';

    // The transaction id is reused across a transaction's events (charge, refund,
    // chargeback all carry the same one), so compose the type in to keep distinct
    // events on one transaction from colliding and a refund from being swallowed.
    const providerId = src.id ?? body.id;
    const id =
      providerId != null ? `${String(providerId)}:${type}` : hashId(reference, type, raw);

    let customer: NormalizedEvent['customer'] = null;
    const c = src.customer;
    if (c && typeof c === 'object') {
      const email = str(c.email);
      const name = str(c.name) ?? str(c.fullName); // v3 `name`, v2 `fullName`
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
