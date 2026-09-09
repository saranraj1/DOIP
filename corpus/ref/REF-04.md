---
id: REF-04
title: Escalation Matrix
tags: [escalation, roles, notification, matrix]
version: 1.0
---

# REF-04 — Escalation Matrix

*Simulated training reference.*

## Who is notified, when

| Trigger | Operator | Planner | Commander | Action reference |
|---|---|---|---|---|
| Medium alert | feed/badge | — | — | monitor |
| High alert | notify + ack required | — | — | SOP per event type |
| Critical alert | notify + ack required | notified | notify + banner | immediate |
| Stage-3 comms loss | ack required | — | — | SOP-06, QRF readiness |
| Stage-4 comms loss | ack required | notified | notified | SOP-06 search plan |
| Confirmed perimeter event | ack required | — | posture Amber+ notified | SOP-07 |
| Convoy > 45 min late | ack required | notified | — | SOP-04 §5 |
| Urgent CASEVAC | ack required | — | notified | SOP-03 |
| Hostile-behavior air track | ack required | notified | notify + banner | SOP-05 |

## Alternate designation

If a primary responder (e.g., QRF) fails feasibility checks, the alternate is the nearest same-type unit with passing checks; ties break by lowest callsign. The designation is a logged operator decision.

## Time standards

Acknowledgment: 2 sim-minutes (high), 1 sim-minute (critical). Unacknowledged critical alerts re-notify every 2 sim-minutes and appear in the after-action report with total unacknowledged time.
