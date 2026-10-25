# Paystack fixtures

`charge.success.json` and `refund.json` are **real test-mode webhooks**, captured
from Paystack over a tunnel on 2026-10-24 and used as-is. Capturing them caught a
real bug: refunds carry no `data.reference`, only `data.transaction_reference`
(the original charge's ref), and the normalizer now falls back to it.

`unknown.json` is still hand-written (an event type we intentionally don't map).

Files:
- `charge.success.json` — successful charge (real capture)
- `refund.json` — refund, `event: refund.pending` (real capture; no `data.reference`)
- `dispute.json` — a dispute event (`charge.dispute.create`), maps to `chargeback`. Hand-written from the docs, not yet captured from real traffic.
- `unknown.json` — an event type we intentionally do not map (falls through to `unknown`)
