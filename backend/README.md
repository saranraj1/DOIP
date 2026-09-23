# DOIP MVP Backend

FastAPI service that adds persistence, auth and real multi-user collaboration
to the DOIP Command Center frontend. The deterministic simulation engine stays
in the browser for the MVP — `simStore.ingest()` in `src/sim/store.tsx` is the
documented seam for moving it server-side later.

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then start the frontend as usual (`bun dev`). No frontend config is needed for
localhost; to point elsewhere set `VITE_DOIP_API_URL` (see `.env.example`).

## What it does

| Endpoint           | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `GET /health`      | Liveness probe                                                  |
| `POST /auth/login` | Demo HMAC token for a role (`admin/planner/operator/viewer`)    |
| `GET /scenarios`   | Scenario catalogue (mirror of `src/sim/scenarios.ts`)           |
| `POST /runs`       | Persist a recorded run incl. full event log (Bearer token)      |
| `GET /runs`        | Last 8 persisted runs — hydrates the frontend run list on login |
| `GET /audit`       | Append-only audit trail (admin token only)                      |
| `WS /ws/warroom`   | Shared war-room task board — tasks sync live across browsers    |

## Frontend wiring (fail-soft by design)

- `src/lib/api.ts` — the only place that talks HTTP. Every call times out in
  2.5 s and resolves `null` when the backend is missing: **the app works
  fully offline, unchanged.**
- Login (`simStore.login`) fetches a token and hydrates persisted runs.
- Stopping/replacing a run (`recordRun`) fire-and-forgets a `POST /runs`.
- The S11/S14 task store (`src/sim/tasks.ts`) opens `WS /ws/warroom` on first
  use; if it connects, task creates/advances replicate to every open client.

## MVP limits (known, deliberate)

- SQLite instead of PostgreSQL+PostGIS — swap `app/db.py` in Phase 2.
- Demo HMAC auth, no user DB; set `DOIP_SECRET` env var beyond localhost.
- Task board is in-memory (resets on restart); task IDs are client-assigned,
  so two clients creating tasks in the same instant can collide — acceptable
  for exercise-scale concurrency, fix with server-assigned IDs later.
- CORS is wide open for the demo; restrict `allow_origins` before sharing.
- Sitrep/RAG, vision jobs and the headless what-if runner remain frontend-side
  or future phases per the roadmap.
