# MVP.md — What to Build First, and What Comes Next

> The MVP question is not “which features?” — it is “what is the smallest thing that proves the core risk is dead?” For DOIP the core risk is the **deterministic simulation engine feeding a live map**. Everything else is decoration until that works.

## The MVP (Phase 0–1): “watch a synthetic world run, live”

**Demo sentence:** *“I load SC-1, press start, and watch 12 units patrol a real map with live events — then I run it again with the same seed and get the identical run.”*

### In scope — build in this order

| # | Item | Why first | Done when |
|---|---|---|---|
| 1 | Repo skeleton, Docker Compose (postgres+postgis, redis, api, web), CI with lint + tests | everything else lands on this | `docker compose up` gives a hello-world API + web page |
| 2 | Scenario YAML loader + DSL validator (incl. `entity_groups` expansion) | the engine's input contract; AI safety boundary later | SC-1 loads; malformed YAML rejected with line errors |
| 3 | Deterministic tick engine: clock, seeded RNG, movement, patrol behavior | THE core risk | 100 ticks of SC-1, seed 42, twice → identical event sequence |
| 4 | Typed append-only event store + Redis publish | the spine every feature consumes | every state change queryable + streamable |
| 5 | **Golden-run CI job** | locks determinism before features pile on | CI fails on hash drift |
| 6 | FastAPI WebSocket stream + minimal JWT auth (operator role only) | thinnest path to a screen | browser receives live events |
| 7 | React + Leaflet live map: unit markers, movement, basic event feed | the demo | SC-1 visibly runs on the map |
| 8 | Weather cells + speed effects, `create_incident`, severity alerts (REF-02 mapping) | first “the world fights back” moment | storm slows a patrol on screen |

### Explicitly OUT of the MVP

LLM/RAG/vision, mission planner & A\*, replay UI, analytics, logistics forecasting, vitals, full RBAC (one role is enough), War-Room, What-If, Red-Team, Advisor, Kafka, k3s. **Cutting these is what makes the MVP real.** The engine writes events from day one, so replay and analytics lose nothing by waiting.

### MVP acceptance test

1. `make run SCENARIO=scenarios/sc1_night_patrol.yaml SEED=42` — twice → identical event log hash.
2. Map shows 12 units patrolling; storm at +00:30 slows units inside it; incident raises an alert.
3. Golden-run CI green; `THIRD_PARTY_LICENSES.md` check green.

---

## After the MVP — advancements in priority order

Priority = (risk killed + demo value) per week of work. Resist reordering by excitement.

| Priority | Advancement | Contents | Rationale |
|---|---|---|---|
| **P1** | Replay + run control | pause/resume/speed, replay any run from events, run picker | cheapest big win — events already exist; proves the event spine honestly |
| **P2** | Mission planning | waypoint tasking, A\* with terrain/threat/weather costs, feasibility gate, naive-vs-optimized | first *interactive* feature; turns viewers into operators |
| **P3** | AI layer v1 | Ollama sitreps with grounding verifier, query-router, RAG over the 15-doc corpus | the differentiator — but only credible AFTER there are real events to cite |
| **P4** | Logistics + vitals | consumption model, burn-down, forecasts, vitals bands + alerts (SOP-03/REF-02 KPIs) | makes SC-4–SC-6 runnable; depth for long exercises |
| **P5** | Vision service | synthetic-frame pipeline, YOLO detections, review queue (S9), AGPL isolation | high wow, low coupling — safe to defer |
| **P6** | Analytics + AAR | KPI dashboards, run comparison, aar-summarizer to POL-03 template | needs P1–P4 data to be meaningful |
| **P7** | Full RBAC + admin | four roles, audit log, admin screen (S15) | required before multi-user work |
| **P8** | What-If Theater (Ch. 13) | scenario-author → validation gate → headless fast run → animated playback | flagship extension; needs P1+P3+P7 |
| **P9** | War-Room (Ch. 15) | sessions, sector scoping, shared annotations, task board | multiplayer only pays off once single-player is deep |
| **P10** | Red-Team Agent (Ch. 16) | assessor, director policy, inject planner + playbook | tuning it fairly needs P6 metrics |
| **P11** | Investment Advisor (Ch. 14) | imports, scenario battery, gap register, MILP portfolios, benchmarks | most speculative; needs a mature scenario battery |
| **P12** | Scale-out (Phase 7) | Redis→Kafka, Compose→k3s | only on measured NFR breach — may never be needed |

## Standing rule

If a lower-priority item ever blocks a higher one, the ordering is wrong — update this file in the same PR and say why. This document is the argument you have with yourself before adding a feature.
