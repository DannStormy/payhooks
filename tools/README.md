# Fixture validation harness

The fixtures under `src/providers/__fixtures__` are documentation-derived. Before
publishing payhooks, they must be checked against real test-mode webhooks. This
harness runs the actual `verify()` + `normalize()` on a real payload and diffs its
structure against the matching fixture, so drift shows up as a report.

This is the last gate before making the repo public / publishing to npm.

## What you need

Test-mode secrets from each dashboard (only needed to check signatures):

- **Paystack**: Settings -> API Keys & Webhooks -> Secret Key (`sk_test_...`)
- **Flutterwave**: Settings -> Webhooks -> the Secret Hash you set there

Pass them as env vars. Without them the harness still captures, normalizes, and
diffs; it just skips the signature check.

## Mode A: live capture (primary path)

Fires real deliveries at a local server that verifies + diffs each one.

```bash
PAYSTACK_SECRET=sk_test_xxx FLUTTERWAVE_SECRET=your_verif_hash npm run validate:fixtures
```

Then:

1. Expose the port publicly (either works):
   ```bash
   npx cloudflared tunnel --url http://localhost:4000
   # or: ngrok http 4000
   ```
2. Put the public URL in each dashboard's webhook setting, with the provider path:
   - Paystack webhook URL: `https://<tunnel>/paystack`
   - Flutterwave webhook URL: `https://<tunnel>/flutterwave`
3. Fire a test event: make a test-mode charge, trigger a refund, or use the
   dashboard's "Send test webhook" button. Do one per event type you care about
   (charge, refund).
4. Read the report printed in the terminal. Each captured payload is also saved
   raw to `tools/captured/` (gitignored).

## Mode B: paste a saved payload (no tunnel)

Both dashboards show the raw request body of a delivered webhook in their logs.
Copy it into a file and validate offline:

```bash
npm run validate:file -- --file tools/captured/mine.json --provider paystack
```

Signature check in this mode is optional:
- Paystack: add `--sig-header <x-paystack-signature value>` and set `PAYSTACK_SECRET`.
- Flutterwave: set `FLUTTERWAVE_SECRET` (it compares `verif-hash` to the secret).

## Mode C: re-diff what you already captured

```bash
npm run validate:diff
```

Re-runs the structural diff on every file in `tools/captured/`. No server, no secrets.

## Reading the report

- `[PASS]` signature verified / field present / structure identical.
- `[WARN]` optional field absent, or extra keys in the real payload (usually fine).
- `[DRIFT]` the real payload differs from the fixture in a way that matters:
  a changed `event` string, a changed `data.status`, or a key the normalizer
  reads that is missing.
- `[FAIL]` signature did not verify, body was not JSON, or `normalize()` threw.

The `normalized event` block shows exactly what payhooks produces from the real
payload. Sanity-check `type`, `reference`, `amount`, `currency`, `customer`, and
the dedup `id`. `type: "unknown"` for a charge or refund means the event string
drifted from the type map in the provider file.

## On drift

1. Update the fixture in `src/providers/__fixtures__/<provider>/` to match the real
   payload (or fix the normalizer/type map in `src/providers/<provider>.ts` if the
   real event string is what changed).
2. Re-run the unit tests: `npm test`.
3. When every event type reports PASS with no meaningful DRIFT, delete the
   "documentation-derived" warning from the fixtures' README files. Fixtures are
   now validated and the package is safe to publish.
