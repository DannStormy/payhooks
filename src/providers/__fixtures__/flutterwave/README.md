# Flutterwave fixtures

These payloads are DOCUMENTATION-DERIVED, hand-built from Flutterwave's published
webhook docs. They have NOT been captured from live traffic.

Known uncertainties:
- The exact refund event name. Flutterwave has used `charge.refund`, `charge.refunded`,
  and a legacy `event.type: "REFUND"` shape across versions. `refund.json` uses one of
  these; the normalizer matches any event name containing "refund".
- Field presence on refunds (`amount_refunded` vs `amount`) varies by version.
- Whether a top-level event id is ever sent (we only observe `data.id` in the docs).

MUST validate against real captured test-mode webhooks before publish. Point a Flutterwave
test-mode integration at a request-capture endpoint, trigger a successful charge and a
refund, and replace these files with the real bodies. Adjust the normalizer's event-name
matching if the live names differ.
