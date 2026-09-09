# DOIP — Defense Operations Intelligence Platform

> **Training & simulation platform. All data is synthetic. Not for operational military use.**

DOIP is a software-only command and decision-support platform that simulates complete military operational environments — units, missions, weather, logistics, and personnel — on a live map, entirely with synthetic data.

- A **deterministic simulation engine** generates the world (same seed = identical run).
- Every state change is an **append-only typed event**.
- **AI services** turn the event stream into cited situation reports, doctrine Q&A (RAG), and vision detections — with grounding verification. Humans always decide.
- Every run **replays exactly** for after-action review.

Full specification: see the DOIP Master Project Document (Notion, 19 chapters). This repo intentionally does **not** duplicate it.

## Quickstart (5 minutes)

```bash
git clone <repo-url> && cd doip
cp .env.example .env
docker compose up -d          # postgres + redis + api + web
ollama pull llama3            # local LLM (optional for Phase 1)
make seed                     # load SC-1 Night Patrol Baseline
make run SCENARIO=scenarios/sc1_night_patrol.yaml SEED=42
```

Open http://localhost:3000 — default dev login is `operator / operator` (dev only).

## Repository layout

```
scenarios/     # scenario YAML files (SC-1 … SC-8) — engine input
corpus/        # SOP / REF / POL markdown corpus — RAG input
ai-service/    # LLM, RAG, vision pipelines + prompts/
engine/        # deterministic tick engine (the core)
api/           # FastAPI gateway (JWT, RBAC, WebSocket)
web/           # React frontend
footage/       # sourced/synthetic aerial clips + manifest.yaml
docs/          # thin operational docs + ADRs
```

## Ground rules

1. **Determinism is sacred.** One seeded RNG. A stray `random()` breaks golden-run CI.
2. **AI authors scenarios, never outcomes.** All AI-generated actions pass the whitelisted DSL validation gate with human approval.
3. **Free & open source only.** Every dependency must be recorded in `THIRD_PARTY_LICENSES.md` (CI-enforced).
4. **Phase discipline.** Modular monolith first. No Kafka, no Kubernetes until Phase 7.

## License

Apache-2.0. See `THIRD_PARTY_LICENSES.md` for third-party notices.
