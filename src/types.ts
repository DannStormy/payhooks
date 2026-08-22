export type PaymentProvider = 'paystack' | 'flutterwave';

export interface NormalizedEvent {
  // `id` is the STABLE DEDUP KEY: the provider's own event id when present, else a
  // deterministic hash of provider + reference + type + payload.
  id: string;
  provider: PaymentProvider;
  // Normalized event type, e.g. 'charge.success' | 'refund' | 'chargeback' | 'unknown'.
  type: string;
  reference: string;
  // Amount in MAJOR currency units (normalizers convert from provider minor units).
  amount: number;
  currency: string;
  customer: { email?: string; name?: string } | null;
  raw: unknown;
}

export interface IdempotencyStore {
  // Claim-before-work: the check IS the write. Returns true if first-seen (now claimed),
  // false if already seen. Must be race-safe by contract.
  claim(id: string, ttlSeconds?: number): Promise<boolean>;
}

export interface Provider {
  name: string;
  // verify/normalize operate on the RAW body because the signature is computed over the raw bytes.
  verify(rawBody: string | Buffer, headers: Record<string, string | undefined>, secret: string): boolean;
  normalize(rawBody: string | Buffer, headers: Record<string, string | undefined>): NormalizedEvent;
}

export type HandlerRejectionReason =
  | 'invalid_signature'
  | 'duplicate'
  | 'unparseable'
  | 'unknown_provider';

export type HandlerResult =
  | { ok: true; event: NormalizedEvent; duplicate: boolean }
  | { ok: false; reason: HandlerRejectionReason; message: string };
