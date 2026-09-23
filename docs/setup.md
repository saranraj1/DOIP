# Local Development Setup

## Prerequisites

- Docker + Docker Compose
- Python 3.12+, Node 20+ (only for running services outside Compose)
- Ollama (optional until Phase 3 AI work): `ollama pull llama3`

## Bring-up

```bash
cp .env.example .env        # defaults work for local dev
docker compose up -d        # postgres+postgis, redis, api, web
make migrate                # apply DB migrations
make seed                   # load geo files + SC-1 scenario
```

Web UI: http://localhost:3000 · API docs: http://localhost:8000/docs

Dev logins (dev only, disabled outside `ENV=dev`): `admin/admin`, `planner/planner`, `operator/operator`, `viewer/viewer`.

## Running a scenario

```bash
make run SCENARIO=scenarios/sc1_night_patrol.yaml SEED=42
```

The engine validates the YAML first — malformed files are rejected with line-level errors before anything starts.

## Tests

```bash
make test          # unit + integration
make golden        # golden-run determinism check (read docs/golden-run.md first)
make lint
```

## Common problems

| Symptom                             | Cause / fix                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Golden test fails after your change | You broke determinism. Read `docs/golden-run.md`. Do NOT re-freeze the fixture.                          |
| Map tiles blank                     | OSM tile fetch blocked offline — use the bundled tile cache (`make tiles`)                               |
| LLM endpoints time out              | Ollama not running, or model not pulled; AI features degrade gracefully — the platform runs without them |
| `license-check` CI failure          | New dependency missing from `THIRD_PARTY_LICENSES.md`                                                    |
