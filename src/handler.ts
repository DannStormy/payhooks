import type {
  HandlerResult,
  IdempotencyStore,
  NormalizedEvent,
  PaymentProvider,
  Provider,
} from './types.js';

export interface ProviderRegistration {
  provider: Provider;
  secret: string;
}

export interface HandlerConfig {
  store: IdempotencyStore;
  providers: Partial<Record<PaymentProvider, ProviderRegistration>>;
  // Passed to store.claim() when set. Undefined lets the store apply its own default.
  ttlSeconds?: number;
}

export interface Handler {
  handle(
    rawBody: string | Buffer,
    headers: Record<string, string | undefined>,
    provider?: PaymentProvider,
  ): Promise<HandlerResult>;
}

// The header each provider signs/tags requests with, used to auto-detect the sender.
const DETECT_HEADERS: Record<PaymentProvider, string> = {
  paystack: 'x-paystack-signature',
  flutterwave: 'verif-hash',
};

function hasHeader(headers: Record<string, string | undefined>, name: string): boolean {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target && headers[key] != null && headers[key] !== '') return true;
  }
  return false;
}

function reject(reason: HandlerResult & { ok: false }): HandlerResult {
  return reason;
}

export function createHandler(config: HandlerConfig): Handler {
  const { store, providers, ttlSeconds } = config;

  function select(
    headers: Record<string, string | undefined>,
    explicit?: PaymentProvider,
  ): { name: PaymentProvider; registration: ProviderRegistration } | null {
    if (explicit) {
      const registration = providers[explicit];
      return registration ? { name: explicit, registration } : null;
    }
    for (const name of Object.keys(providers) as PaymentProvider[]) {
      const registration = providers[name];
      if (registration && hasHeader(headers, DETECT_HEADERS[name])) {
        return { name, registration };
      }
    }
    return null;
  }

  async function handle(
    rawBody: string | Buffer,
    headers: Record<string, string | undefined>,
    provider?: PaymentProvider,
  ): Promise<HandlerResult> {
    const selected = select(headers, provider);
    if (!selected) {
      return reject({ ok: false, reason: 'unknown_provider', message: 'no registered provider matched' });
    }

    const { provider: impl, secret } = selected.registration;

    let signatureOk: boolean;
    try {
      signatureOk = impl.verify(rawBody, headers, secret);
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) {
      return reject({ ok: false, reason: 'invalid_signature', message: 'signature verification failed' });
    }

    let event: NormalizedEvent;
    try {
      event = impl.normalize(rawBody, headers);
    } catch {
      return reject({ ok: false, reason: 'unparseable', message: 'could not normalize event body' });
    }

    // claim-before-act: dedup on event identity (NormalizedEvent.id), never reference alone.
    const first = await store.claim(event.id, ttlSeconds);
    if (!first) {
      return { ok: true, event, duplicate: true };
    }

    return { ok: true, event, duplicate: false };
  }

  return { handle };
}
