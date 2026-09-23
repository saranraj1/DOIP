---
id: REF-02
title: Severity Classification Guide
tags: [severity, classification, alerts, triage]
version: 1.0
---

# REF-02 — Severity Classification Guide

_Simulated training reference._

## Severity levels

| Level        | Definition                  | UI treatment                                 | Examples                                                                                        |
| ------------ | --------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Low**      | Routine, informational      | feed + ticker only                           | position report, scheduled resupply                                                             |
| **Medium**   | Deviation needing awareness | feed + map badge                             | stage-2 comms loss, weather cell entering sector, stock below 40%                               |
| **High**     | Requires operator action    | toast + badge + map ping                     | contact report (initial), confirmed perimeter event, stock below 30%, stage-3 comms loss        |
| **Critical** | Immediate command attention | toast + commander notify + persistent banner | casualty with critical vitals, hostile-behavior air track, confirmed breach, stage-4 comms loss |

## Classification rules

1. Initial classification is automatic per the event-type mappings above; operators may upgrade freely but may downgrade only with a logged reason.
2. Contact reports never enter below **high** (SOP-01 §3).
3. Two related medium events in the same sector within 10 sim-minutes auto-escalate to high.
4. Acknowledgment is required for high and critical; time-to-acknowledge is a primary exercise KPI.

## Medical vitals bands

| Band     | Heart rate             | Fatigue index | Action                            |
| -------- | ---------------------- | ------------- | --------------------------------- |
| Normal   | 60–100                 | < 0.6         | none                              |
| Degraded | 100–130                | 0.6–0.8       | medium alert, rotation suggested  |
| Critical | > 130 sustained 10 min | > 0.8         | critical alert, SOP-03 assessment |
