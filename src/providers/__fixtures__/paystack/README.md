# Paystack fixtures

These payloads are **documentation-derived**. They were built from Paystack's
documented webhook structure, not captured from live traffic.

They MUST be validated against real captured test-mode webhooks before this
package is published. Field names, nesting, presence/absence of `data.id`, and
the exact `event` strings for refund and dispute events can differ from the
docs. Capture real test-mode deliveries (e.g. via the Paystack dashboard or a
webhook proxy), diff them against these files, and correct any drift.

Files:
- `charge.success.json` — successful charge
- `refund.json` — processed refund (`refund.processed`)
- `unknown.json` — an event type we intentionally do not map (falls through to `unknown`)
