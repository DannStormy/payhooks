# Flutterwave fixtures

Flutterwave sends two different webhook shapes, and payhooks handles both:

- **v3 (Standard checkout / v3 API):** top-level `event` string (e.g. `charge.completed`)
  plus a `data` object. Fields are snake_case (`tx_ref`), customer name is `customer.name`.
- **v2 (legacy Rave Pages):** fields at the root, camelCase (`txRef`, `flwRef`), customer
  name is `customer.fullName`, and a key literally named `"event.type"` holds the channel
  (`CARD_TRANSACTION`, `BANK_TRANSFER_TRANSACTION`). Still very common for older Nigerian
  merchants.

Files:
- `charge.v2.json` — **real test-mode capture** (2026-10-24, a Rave Pages bank-transfer
  charge). Scrubbed of IP, email, name, phone. This is why v2 support exists: a real
  capture proved the published v3-only normalizer returned `unknown` on live Rave traffic.
- `charge.completed.json` — v3 successful charge. Still **doc-derived**, not yet captured.
- `refund.json` — v3 refund. Still **doc-derived**. The normalizer matches any event name
  containing "refund". Note: Rave **v2** does not send a refund webhook at all (verified
  2026-10-24, a test-mode refund fired nothing), so refunds there are a dashboard/API
  action whose status you poll. This fixture only covers the v3 refund event.
- `unknown.json` — a v3 event we intentionally do not map (falls through to `unknown`).

Remaining gate before a clean 1.0: capture a real **v3** charge + refund (fire them through
a Standard/inline integration, not a Rave Page) and replace the two doc-derived files.
