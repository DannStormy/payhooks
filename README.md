# payhooks

Verify, normalize, and exactly-once process inbound webhooks from Paystack and Flutterwave.

## The gap it fills

Unified SDKs for African payments (Voltax, use-africa-pay) cover the outbound half:
calling the provider. They stop before the inbound half, and that is where the
reliability problems live. Webhooks arrive unverified, in provider-specific shapes,
and get redelivered. Duplicates cause double credits; a swallowed event loses a real
refund or chargeback.

payhooks owns the inbound half:

- **Verify** the signature over the raw request body, per provider's own scheme.
- **Normalize** each provider's payload into one typed `NormalizedEvent`.
- **Dedup** exactly-once through a pluggable store, so a redelivered webhook is a no-op.

It is a framework-agnostic library. No hosted service, no ops.

## Install

```sh
npm install payhooks
```

Node 18+. The Redis and SQL stores need an optional peer dep (see below); the
in-memory store needs nothing.

## Quickstart

Pass the **raw** request body (not a parsed object) and the request headers. The
signature is computed over the exact bytes, so parsing first breaks verification.

```ts
import { createHandler, paystack, flutterwave, MemoryStore } from 'payhooks';

const handler = createHandler({
  store: new MemoryStore(),
  providers: {
    paystack: { provider: paystack, secret: process.env.PAYSTACK_SECRET! },
    flutterwave: { provider: flutterwave, secret: process.env.FLW_VERIF_HASH! },
  },
});

// Express example. Mount with a raw body parser on this route:
//   app.post('/webhooks', express.raw({ type: '*/*' }), ...)
app.post('/webhooks', async (req, res) => {
  const result = await handler.handle(req.body, req.headers);

  if (!result.ok) {
    // 'invalid_signature' | 'duplicate' | 'unparseable' | 'unknown_provider'
    return res.status(result.reason === 'invalid_signature' ? 401 : 400).end();
  }

  if (result.duplicate) {
    return res.status(200).end(); // already processed, no-op
  }

  // First time we have seen this event. Do the work.
  await onPaymentEvent(result.event); // { id, provider, type, reference, amount, currency, customer, raw }
  res.status(200).end();
});
```

The provider is auto-detected from the signature header. Pass a third argument
(`handler.handle(body, headers, 'paystack')`) to pin it explicitly.

### The normalized event

```ts
interface NormalizedEvent {
  id: string;        // stable dedup key (see "Why" below)
  provider: 'paystack' | 'flutterwave';
  type: string;      // 'charge.success' | 'refund' | 'chargeback' | 'unknown'
  reference: string;
  amount: number;    // MAJOR units (e.g. NGN, not kobo)
  currency: string;
  customer: { email?: string; name?: string } | null;
  raw: unknown;      // the original parsed payload, untouched
}
```

Amounts are always major units: Paystack kobo is divided by 100, Flutterwave (already
major) is passed through. An event type the kit does not map becomes `'unknown'`
rather than throwing, so a new provider event never crashes your endpoint.

## Store options

The store is where dedup state lives. `claim(id)` returns `true` the first time an id
is seen and `false` on every redelivery. Pick one:

| Store | Import | Peer dep | Use for |
| --- | --- | --- | --- |
| `MemoryStore` | built in | none | tests, single-process, dev |
| `RedisStore` | built in | `ioredis` (`^5`) | multi-instance / serverless |
| `SqlStore` | built in | `better-sqlite3` (`^11`) | you already run SQLite |

```ts
import { RedisStore, SqlStore } from 'payhooks';

// Redis: pass a URL/options, or an existing ioredis client.
const store = new RedisStore(process.env.REDIS_URL!, { defaultTtlSeconds: 86400 });

// SQL: pass a path/':memory:', or an existing better-sqlite3 Database.
const store = new SqlStore('./webhooks.db');
```

Install the peer dep for the store you use:

```sh
npm install ioredis         # for RedisStore
npm install better-sqlite3  # for SqlStore
```

Both are optional peer deps: they are not pulled in unless you use that store, and
the store throws a clear error if the package is missing. `ttlSeconds` bounds how long
a claim is remembered; unset means it is kept indefinitely (memory/sql) or for 24h
(redis default).

## Why

Money movement has to be exactly-once, and webhooks are at-least-once by design:
providers retry until you 200, so the same event lands more than once. The kit
**claims before it works**. The dedup check is the write: `store.claim(id)` atomically
records the id and tells you whether you were first. You only do the side effect when
you were first, so a redelivery can never double-credit.

The dedup key is the event's identity, never the reference alone. One transaction
fires several distinct events (a charge, then a refund, then maybe a chargeback) that
all share a reference. Keying on the reference would treat the refund as a duplicate of
the charge and drop it. So `id` is the provider's own event id when there is one, and
otherwise a deterministic hash of provider + reference + type + payload. Flutterwave
reuses one transaction id across those events, so the normalized type is folded into
the key to keep them distinct.

Verification runs on the raw bytes because that is what the signature covers. Paystack
signs the body with HMAC-SHA512. Flutterwave does not sign the body at all: its
`verif-hash` header is a static shared secret you set in the dashboard, echoed back
verbatim. That means the Flutterwave header proves the sender knows your secret but
does **not** authenticate the body, so it cannot detect a body modified in transit.
That is Flutterwave's design, not a kit limitation. Treat the secret as a secret and
serve your endpoint over TLS.

## NOTE: validate the fixtures before you publish

The provider fixtures under `src/providers/__fixtures__` are **documentation-derived**.
They were hand-built from each provider's published webhook docs, not captured from
live traffic. Field names, nesting, whether `data.id` is present, and the exact `event`
strings for refund and dispute events can drift from the docs.

Before publishing or relying on this in production, capture real **test-mode** webhooks
(point a test integration at a request-capture endpoint, trigger a charge and a
refund), diff them against the fixtures, and correct any drift. Adjust the normalizers'
event-name matching if the live names differ. Each fixture directory has a README with
the specific uncertainties for that provider.

## License

MIT.
