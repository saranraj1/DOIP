---
id: SOP-06
title: Communications-Loss Protocol
tags: [comms, comms-loss, lost-contact, escalation]
version: 1.0
---

# SOP-06 — Communications-Loss Protocol

*Simulated training document. Not real doctrine.*

## 1. Stages

- **Stage 1 (one missed report window):** automated comms-check at +5 sim-minutes. Unit marker flagged stale on the operational picture.
- **Stage 2 (two consecutive missed windows):** severity **medium** alert; last-known position and heading published; adjacent units notified.
- **Stage 3 (30 sim-minutes without contact):** severity **high**; QRF readiness per SOP-02; UAV re-tasking to sweep the projected route is recommended to the operator.
- **Stage 4 (60 sim-minutes):** severity **critical**; commander notification; search plan initiated along the movement corridor.

## 2. Unit-side procedure

A unit that loses communications continues to its next scheduled waypoint, then holds and attempts contact every 10 sim-minutes. After 60 minutes without contact, it proceeds to the nearest designated rally point.

## 3. Re-establishment

On re-contact, the unit transmits a full status report (position, personnel, resources). The comms-loss interval is reconstructed in the event log from the unit's buffered reports and flagged for the after-action review — total comms-loss minutes is a primary exercise KPI.
