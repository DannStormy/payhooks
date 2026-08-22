# payhooks express example

A runnable Express server that mounts a webhook route on the `payhooks` library. It
verifies the provider signature, normalizes the event, dedups it, and acks correctly.
Doubles as a local integration smoke test.

## Why `express.raw`

The signature is an HMAC over the exact request bytes. `express.json()` re-serializes
the body, which changes the bytes and breaks verification. This route uses
`express.raw({ type: '*/*' })` so the untouched raw body reaches the handler.

## Setup

The parent library ships as compiled JS in `dist/`, so build it once first.

```bash
# from repo root
cd ../..            # /Users/dann/Documents/my-proj/payments-webhook-kit
npm install
npm run build

# then this example
cd examples/express
npm install
npm start
```

Server listens on `http://localhost:3000` and accepts POSTs at
`/webhooks/payments`.

## Try it: signed request (verify + normalize + dedup)

The default Paystack secret is `test_paystack_secret` (override with
`PAYSTACK_SECRET`). Compute the signature over the exact fixture bytes and send it:

```bash
SECRET=test_paystack_secret
SIG=$(openssl dgst -sha512 -hmac "$SECRET" fixture.paystack.json | sed 's/^.*= //')

curl -sS -X POST http://localhost:3000/webhooks/payments \
  -H "x-paystack-signature: $SIG" \
  --data-binary @fixture.paystack.json
# -> 200 {"ok":true,"duplicate":false}
```

Send the identical request again and dedup kicks in:

```bash
curl -sS -X POST http://localhost:3000/webhooks/payments \
  -H "x-paystack-signature: $SIG" \
  --data-binary @fixture.paystack.json
# -> 200 {"ok":true,"duplicate":true}
```

`--data-binary` matters: it sends the file bytes unchanged so they match what the
signature was computed over.

## Try it: bad signature

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/webhooks/payments \
  -H "x-paystack-signature: deadbeef" \
  --data-binary @fixture.paystack.json
# -> 401
```

## Try it: unparseable body (valid signature, junk payload)

```bash
BODY='not json'
SECRET=test_paystack_secret
SIG=$(printf '%s' "$BODY" | openssl dgst -sha512 -hmac "$SECRET" | sed 's/^.*= //')

curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/webhooks/payments \
  -H "x-paystack-signature: $SIG" \
  --data-binary "$BODY"
# -> 400
```

## Response mapping

| result | HTTP |
| --- | --- |
| ok (new or duplicate) | 200 |
| invalid_signature | 401 |
| unparseable | 400 |
| unknown_provider | 404 |
