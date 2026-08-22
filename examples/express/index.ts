import express from 'express';
import { createHandler, MemoryStore, paystack, flutterwave } from 'payhooks';

const PORT = Number(process.env.PORT ?? 3000);
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET ?? 'test_paystack_secret';
const FLUTTERWAVE_SECRET = process.env.FLUTTERWAVE_SECRET ?? 'test_flutterwave_secret';

const handler = createHandler({
  store: new MemoryStore(),
  providers: {
    paystack: { provider: paystack, secret: PAYSTACK_SECRET },
    flutterwave: { provider: flutterwave, secret: FLUTTERWAVE_SECRET },
  },
});

const app = express();

// express.raw keeps req.body as the exact bytes the provider signed. Parsing it as
// JSON first would re-serialize the body and break HMAC signature verification.
app.post('/webhooks/payments', express.raw({ type: '*/*' }), async (req, res) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const result = await handler.handle(rawBody, req.headers as Record<string, string | undefined>);

  if (result.ok) {
    // Ack fast on success AND on duplicates so the provider stops retrying.
    console.log(
      `[ok] ${result.event.provider} ${result.event.type} ${result.event.reference}` +
        (result.duplicate ? ' (duplicate)' : ''),
    );
    res.status(200).json({ ok: true, duplicate: result.duplicate });
    return;
  }

  console.warn(`[reject] ${result.reason}: ${result.message}`);
  const status =
    result.reason === 'invalid_signature' ? 401 : result.reason === 'unknown_provider' ? 404 : 400;
  res.status(status).json({ ok: false, reason: result.reason });
});

app.listen(PORT, () => {
  console.log(`payhooks express example listening on http://localhost:${PORT}`);
  console.log('POST webhooks to /webhooks/payments');
});
