---
id: POL-03
title: After-Action Report Template
tags: [aar, template, debrief, review]
version: 1.0
---

# POL-03 — After-Action Report Template

_Simulated training policy. This template is the required structure for every exercise AAR; the aar-summarizer prompt follows it verbatim._

## Required sections

1. **Summary** — scenario, seed, duration, participating roles, end condition reached. Three to five sentences.
2. **Timeline highlights** — chronological key events with event citations `[e:<id>]`: contacts, alerts, dispatches, casualties, posture changes, injects.
3. **Decision review** — each significant decision: what was decided, by which role, at what sim-time, what followed. Name roles, not individuals. No blame language; the AAR evaluates process, not people.
4. **Metrics** — the primary KPIs, verbatim from analytics: time-to-acknowledge (high/critical), QRF time-on-scene vs the 20-minute standard, urgent CASEVAC vs the 60-minute standard, comms-loss minutes, resource-empty incidents.
5. **Red-Team disclosure** — every inject with timing and rationale. Mandatory when injects occurred; write “No injects” otherwise.
6. **Lessons observed** — two to five, each traceable to cited evidence. “Observed”, not “learned”: a lesson is learned only when a later run shows the change.

## Rules

- Every claim in sections 2–3 carries an event citation; uncited claims are removed at review.
- The AAR is distributed to all participants — write it to be read by the people it evaluates.
