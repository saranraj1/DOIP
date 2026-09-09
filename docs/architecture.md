# Architecture (One Page)

Full detail: Master Project Document, Ch. 3 (Notion). This page is the orientation map, not the spec.

## Shape: modular monolith

One deployable API process with strict internal module boundaries. Vision splits out in Phase 4, analytics in Phase 6; Redis→Kafka and Compose→k3s land in Phase 7. Do not split earlier.

```
[React Web App]  (live map · dashboard · replay · war-room)
      |  WebSocket + REST
[Nginx] -> [FastAPI Gateway]  (JWT · RBAC: admin/planner/operator/viewer)
      |
[Core modules — one process]
   Simulation Engine (deterministic tick loop)   <- the heart
   Mission & Map service (A* routing, cost layers)
   AI service (sitreps · RAG Q&A · vision)  -> Ollama / YOLO / vector DB
   Session service (war-room · red-team injects)
      |
[DSL Validation Gate]  <- ALL AI-authored content passes here + human approval
      |
[Data]  PostgreSQL+PostGIS · append-only event store · Redis pub/sub
[Ops]   Docker Compose · Prometheus · Grafana
```

## The three invariants

1. **Determinism** — one seeded RNG; sim-time from tick counter; golden-run CI enforces (see `docs/golden-run.md`).
2. **Events are the spine** — every state change is an append-only typed event; map, alerts, AI, analytics, and replay are all consumers. Replay reads events only — if a feature can't be rebuilt from events, its events are wrong.
3. **AI authors scenarios, never outcomes** — LLM output enters the engine only through the whitelisted DSL gate with human approval; every displayed AI claim cites an event or corpus doc.

## Performance targets (NFRs)

200 entities · 1 Hz tick · 50 events/s · < 50 ms/tick · p95 UI update < 1 s.

## Decision history

See `docs/adr/` — one file per irreversible decision.
