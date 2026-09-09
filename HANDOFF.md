# DOIP Command Center — Agent Handoff Document
**Generated:** 2026-08-05  
**Prepared by:** IGRIS (Notion AI)  
**For:** Next engineering agent continuing the DOIP build  
**Project:** Defense Operations Intelligence Platform — software-only military simulation & command platform

---

## 1. Project Overview

DOIP is a **React + FastAPI + PostgreSQL/PostGIS** browser-based military simulation and command platform. All data is **100% synthetic** — no real operational use. It is a training and exercise tool.

**Stack:**
- Frontend: TanStack Start + React 19 + Vite 8 + Tailwind 4 + shadcn/ui + MapLibre GL 6 + Zustand + Bun
- Backend: Python FastAPI + SQLite (dev) / PostgreSQL+PostGIS (prod) + WebSockets
- AI/ML layer: stub endpoints ready — YOLO (vision), LLM SITREP, What-If Monte Carlo
- Runtime: `bun dev` (frontend on :3000), `uvicorn app.main:app` (backend on :8000)

**Locked decisions (do NOT change):**
- Color theme: Blackout palette — bg `#000000`/`#0D0D0D`/`#161616`, borders `#2A2A2A`, text `#F2F2F2`/`#8A8A8A`, accent white, sev colors `#6E6E6E / #FBBF24 / #FB923C / #F87171`, ai `#A78BFA`, success `#4ADE80`
- Map: MapLibre GL 6 + ESRI imagery basemap (dark-matter fallback) — already wired
- Role system: `analyst` (read-only) / `operator` (operate) / `planner` (full) / `admin` (all)
- All 15 screens already built — S1 through S15 + landing page

---

## 2. Overall Completion Status

| Domain | Complete | Notes |
|---|---|---|
| **Frontend screens (S1–S15 + Landing)** | ✅ 100% | All screens built, routed, styled |
| **Frontend animations (§18.8)** | ✅ 100% | Count-up, shimmer, slide-in, follow-mode, shortcut sheet |
| **Frontend keyboard shortcuts** | ✅ 100% | Space/F/E/? + 1-4 layer toggles |
| **Frontend state (Zustand sim store)** | ✅ 95% | Minor: memoization perf pass not done |
| **Backend auth + session** | ✅ 100% | JWT login, role-gating, session hydration |
| **Backend sim engine** | ✅ 80% | PRNG engine runs; missing: save/restore world snapshots to DB |
| **Backend WebSocket sim broadcast** | ✅ 85% | `/ws/sim/{run_id}` works; missing: reconnect token, auth gate on WS |
| **Backend SITREP (LLM)** | 🟡 40% | Stub returns template text; real LLM call (Ollama/OpenAI) not wired |
| **Backend Vision adjudicate (YOLO)** | 🟡 30% | Stub accepts frames; YOLO model load + inference not wired |
| **Backend What-If Monte Carlo** | 🟡 50% | Monte Carlo loop runs; result scoring + DB persistence missing |
| **Backend audit log** | ✅ 90% | Writes to SQLite; missing: pagination endpoint |
| **Backend War-Room WS** | ✅ 85% | Collaborative cursor broadcast works; missing: message history replay |
| **Backend PostgreSQL/PostGIS migration** | ❌ 0% | All dev uses SQLite; production schema + Alembic migrations not written |
| **Backend Docker / deployment** | ❌ 0% | No Dockerfile, no docker-compose, no Nginx config |
| **Testing (frontend)** | ❌ 0% | No unit or integration tests written |
| **Testing (backend)** | ❌ 0% | No pytest suites written |
| **Documentation (in-code)** | 🟡 60% | Key files have JSDoc; many components undocumented |
| **Scenario YAML files** | ❌ 0% | Hardcoded in `scenarios.ts`; no external YAML corpus |
| **SOP corpus** | ❌ 0% | Referenced in spec; not created |
| **Prerecorded footage** | ❌ 0% | Referenced in spec; not created |

**Overall project completion: ~75%**

---

## 3. What Is Specifically Lacking (Detailed)

### 3.1 Backend — Critical gaps

#### A. Real AI/ML wiring
```
backend/app/sitrep.py    — line ~60: replace stub string with actual LLM call
backend/app/vision.py    — line ~45: replace stub with YOLO model load + frame inference
backend/app/whatif.py    — line ~80: persist Monte Carlo results to DB; add result ranking
```
**What to do:** For SITREP — call `ollama` locally (`requests.post('http://localhost:11434/api/generate', ...)`) or OpenAI API. For Vision — `from ultralytics import YOLO; model = YOLO('yolov8n.pt')`. Both should be lazy-loaded singletons.

#### B. WebSocket auth gate
```
backend/app/hub.py       — WS /ws/sim/{run_id} currently accepts any connection
```
Add JWT query-param validation: `token = query_params.get('token'); verify_token(token)` before accepting.

#### C. World snapshot persistence
The sim engine runs in-memory. If the server restarts, the run is lost.
```
backend/app/session.py   — add save_world(run_id, world_json) and load_world(run_id)
```
Store in `runs` table as a `TEXT` column (JSON-serialized `WorldState`).

#### D. PostgreSQL migration
All `db.py` calls use SQLite. For production:
1. Add `asyncpg` to `requirements.txt`
2. Write `alembic init alembic` migration scripts for tables: `users`, `runs`, `audit_log`, `whatif_results`
3. Add PostGIS extension for zone/geo queries

#### E. Audit log pagination
```
GET /audit           — currently returns all rows (no limit/offset)
```
Add `?page=1&per_page=50` query params.

#### F. War-Room message history replay
```
backend/app/hub.py   — on new WS connect to warroom, send last N messages from DB
```
Currently new joiners see only live messages, missing prior context.

---

### 3.2 Frontend — Remaining gaps

#### A. Memoization performance pass
Several route components recompute heavy derived state on every tick:
```
src/routes/index.tsx     — units/incidents/weather useMemo deps are broad
src/routes/analytics.tsx — sparkline data recomputed every render
src/routes/personnel.tsx — full personnel list filtered inline
```
Wrap heavy computations with `useMemo` and stabilise deps.

#### B. WS source fail-soft UX
```
src/sim/wsSource.ts   — falls back to local sim after 2s timeout
```
Currently silent. Add a toast notification: `"Backend unreachable — running local simulation"`.

#### C. S9 (Replay) scrubber not wired to real data
```
src/routes/replay.tsx — scrubber renders but `currentTick` is not driven by a real snapshot store
```
Needs: a `replayStore` that holds loaded tick snapshots; the scrubber seeks into that array.

#### D. S11 (Vision Feed) — live frame pipe not connected
```
src/routes/vision.tsx — shows placeholder camera tiles
```
Needs: WebSocket or HTTP polling to `/vision/frames` endpoint; render base64 frame data in `<img>`.

#### E. S15 (Admin) — user management is UI-only
```
src/routes/admin.tsx — create/delete user forms exist but call no API
```
Wire to `POST /admin/users` and `DELETE /admin/users/{id}` (endpoints to be created).

#### F. `SimStore.pause()` / `resume()` not implemented
```
src/sim/store.tsx — pause/resume stubs exist but don't halt the engine tick interval
```
Fix: `clearInterval(tickInterval)` on pause; restart on resume.

---

### 3.3 Infrastructure — Not started

#### Dockerfile (frontend)
```dockerfile
# Suggested location: /Dockerfile.frontend
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install && bun run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

#### Dockerfile (backend)
```dockerfile
# Suggested location: /Dockerfile.backend
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### docker-compose.yml
```yaml
# Suggested location: /docker-compose.yml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: doip
      POSTGRES_USER: doip
      POSTGRES_PASSWORD: doip
    volumes:
      - pgdata:/var/lib/postgresql/data
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports: ["8000:8000"]
    depends_on: [db]
    environment:
      DATABASE_URL: postgresql+asyncpg://doip:doip@db/doip
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports: ["80:80"]
    depends_on: [backend]
volumes:
  pgdata:
```

---

### 3.4 Content assets — Not created

| Asset | Location expected | Status |
|---|---|---|
| Scenario YAML files (5+ scenarios) | `backend/scenarios/*.yaml` | ❌ Not created |
| SOP corpus (Markdown SOPs) | `backend/sop/*.md` | ❌ Not created |
| Prerecorded footage metadata | `backend/footage/index.json` | ❌ Not created |

**Scenario YAML format** (for the agent to create):
```yaml
id: op-crimson-dawn
name: Operation Crimson Dawn
theatre: urban
units:
  - id: ALPHA-1
    kind: infantry
    lat: 12.9716
    lon: 77.5946
    sector: A
    fuel: 100
    battery: 100
    status: active
    lastSeenTick: 0
    personnel: []
zones:
  - id: Z1
    name: Restricted Zone Alpha
    kind: restricted
    points: [[12.97, 77.59], [12.98, 77.59], [12.98, 77.60], [12.97, 77.60]]
```

---

## 4. File Map — Where Everything Lives

```
doip-command-center-main/
├── src/
│   ├── styles.css                     ← All CSS custom utilities + §18.8 keyframes
│   ├── sim/
│   │   ├── store.tsx                  ← Zustand store — ALL sim state lives here
│   │   ├── engine.ts                  ← Local sim tick engine (PRNG-driven)
│   │   ├── reducer.ts                 ← Pure state reducers
│   │   ├── types.ts                   ← All TypeScript types (WorldState, Unit, etc.)
│   │   ├── scenarios.ts               ← Hardcoded starting scenarios
│   │   ├── tasks.ts                   ← Shared task types for S14
│   │   └── wsSource.ts                ← WS→local failover abstraction
│   ├── lib/
│   │   ├── doip.ts                    ← SEVERITY_META, helper fns, role utils
│   │   └── api.ts                     ← All fetch() calls to FastAPI backend
│   ├── hooks/
│   │   ├── useCountUp.ts              ← §18.8 rAF count-up animation
│   │   └── useKeyboard.ts             ← §18.8 global keyboard shortcut registrar
│   ├── components/
│   │   ├── doip/
│   │   │   ├── primitives.tsx         ← Panel, Stat, EmptyState, LoadingState, AnimatedFeedItem
│   │   │   ├── ShortcutSheet.tsx      ← §18.8 ? overlay
│   │   │   └── DisconnectBanner.tsx   ← §18.8 STOPPED state banner
│   │   ├── map/
│   │   │   ├── TacticalMap.tsx        ← MapLibre GL map (full implementation)
│   │   │   └── MapView.tsx            ← Lazy wrapper for TacticalMap
│   │   └── shell/
│   │       ├── AppShell.tsx           ← Root layout + keyboard wiring
│   │       ├── TopBar.tsx             ← Status bar + AI toggle
│   │       ├── SideNav.tsx            ← Navigation sidebar
│   │       ├── CommandPalette.tsx     ← Cmd+K palette
│   │       ├── LoginScreen.tsx        ← Login form
│   │       └── AiDrawer.tsx           ← Right-side AI chat drawer
│   └── routes/
│       ├── index.tsx                  ← S3 Live Map (primary screen)
│       ├── dashboard.tsx              ← S1 Dashboard
│       ├── run.tsx                    ← S2 Run Control
│       ├── analytics.tsx              ← S4 Analytics
│       ├── sitrep.tsx                 ← S5 SITREP
│       ├── logistics.tsx              ← S6 Logistics
│       ├── personnel.tsx              ← S7 Personnel
│       ├── planner.tsx                ← S8 Mission Planner
│       ├── replay.tsx                 ← S9 Replay (partial)
│       ├── warroom.tsx                ← S10 War Room
│       ├── vision.tsx                 ← S11 Vision Feed (stub)
│       ├── advisor.tsx                ← S12 Investment Advisor
│       ├── whatif.tsx                 ← S13 What-If Theater
│       ├── admin.tsx                  ← S15 Admin (UI-only)
│       └── __root.tsx                 ← Root with AppShell
└── backend/
    └── app/
        ├── main.py                    ← FastAPI app + all route registration
        ├── auth.py                    ← JWT login + verify_token
        ├── db.py                      ← SQLite connection + table init
        ├── engine.py                  ← Server-side sim engine (mirrors frontend)
        ├── session.py                 ← Run lifecycle management
        ├── hub.py                     ← WebSocket broadcast hub
        ├── sitrep.py                  ← LLM SITREP stub
        ├── vision.py                  ← YOLO vision stub
        ├── whatif.py                  ← Monte Carlo what-if
        ├── scenarios.py               ← Scenario loader
        ├── prng.py                    ← PRNG engine (mirrors frontend)
        └── sim_types.py               ← Pydantic models
```

---

## 5. Priority Task Queue for Next Agent

Prioritised by impact. Do these in order.

### 🔴 P0 — Must fix before any real demo

1. **Wire `pause()` / `resume()` in `store.tsx`**  
   `clearInterval` on pause, restart interval on resume. Space key is already wired.

2. **Auth-gate the WebSocket endpoint**  
   In `hub.py`, read `?token=` query param and call `verify_token(token)` before accepting. Reject with 403 if invalid.

3. **Add WS fallback toast notification**  
   In `wsSource.ts` after the 2s timeout fires, call `toast.warning("Backend unreachable — running local simulation")` via Sonner.

4. **Fix S15 Admin user management API calls**  
   Create `POST /admin/users` and `DELETE /admin/users/{id}` in `main.py`. Wire from `admin.tsx`.

### 🟠 P1 — Complete the backend AI layer

5. **Real LLM SITREP**  
   In `sitrep.py`: call local Ollama (`llama3.2`) or OpenAI. Prompt template is already in the stub.

6. **Real YOLO vision inference**  
   In `vision.py`: `from ultralytics import YOLO; model = YOLO('yolov8n.pt')`. Add `ultralytics` to `requirements.txt`.

7. **What-If result persistence**  
   In `whatif.py`: write Monte Carlo results to a `whatif_results` table. Add GET `/whatif/history` endpoint.

### 🟡 P2 — Completeness

8. **S9 Replay scrubber**  
   Create `src/sim/replayStore.ts` holding an array of `WorldState` snapshots. Wire `currentTick` state to the scrubber slider.

9. **S11 Vision Feed live frames**  
   Add `GET /vision/frames` (returns latest synthetic base64 frames array). Poll from `vision.tsx` every 500ms.

10. **World snapshot persistence**  
    In `session.py`: serialize `WorldState` to JSON and upsert into `runs.world_json` column on each tick (throttled to every 10 ticks).

11. **Audit log pagination**  
    Add `?page=&per_page=` to `GET /audit`. Update `admin.tsx` to paginate.

12. **Scenario YAML corpus**  
    Create 5 YAML files in `backend/scenarios/` using the format in §3.4 above. Update `scenarios.py` to load them.

### 🟢 P3 — Production readiness

13. **Dockerfile (frontend + backend)**  
    Use the templates in §3.3 above.

14. **docker-compose.yml**  
    Use the template in §3.3 above. Wire `DATABASE_URL` env var.

15. **Alembic migrations**  
    `pip install alembic; alembic init alembic`. Write migrations for: `users`, `runs`, `audit_log`, `whatif_results`.

16. **Frontend memoization pass**  
    Audit `src/routes/*.tsx` for unstable `useMemo` deps. Stabilise.

17. **Pytest suite**  
    Cover: auth flow, run lifecycle, WebSocket broadcast, sitrep generation, whatif scoring.

---

## 6. Running the Project Locally

```bash
# Frontend
cd doip-command-center-main
bun install
bun dev
# → http://localhost:3000

# Backend (optional — frontend falls back to local sim if unreachable)
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000

# Login credentials (any username works in dev mode)
# Roles: analyst | operator | planner | admin
```

> **Note:** `bun install` requires network access. In a sandboxed environment with no network, skip this step — the existing `bun.lock` and `node_modules` (if present) are sufficient. The frontend degrades gracefully to the local PRNG sim engine.

---

## 7. Design Rules the Next Agent Must Respect

1. **Never change the Blackout color palette** — all values are hardcoded in `styles.css` CSS variables. Do not introduce new colors without adding them there first.
2. **Never add a dependency without checking it is available offline** — the sandbox has no `npm install` access.
3. **All data is synthetic** — the exercise banner (`EXERCISE — SYNTHETIC DATA`) must remain visible at all times. Do not remove it.
4. **Military-only framing** — this is a defense simulation platform. No civilian use-case language.
5. **Role gating is mandatory** — every write action must check `canOperate(role)` from `src/lib/doip.ts` before executing.
6. **Notion master doc** is the canonical spec — 19 chapters at `https://app.notion.com/p/65b88bf38087486d8ea612a309a6a3fc`. When in doubt, spec wins.
7. **Do not split files unnecessarily** — keep related components co-located. The `primitives.tsx` file is intentionally large.
8. **`updatePage.contentUpdates`** not `properties` — when editing Notion pages, always use `contentUpdates` with exact `oldStr`.

---

## 8. Key External References

| Reference | URL / Location |
|---|---|  
| Notion master doc (19-chapter spec) | `https://app.notion.com/p/65b88bf38087486d8ea612a309a6a3fc` |
| Chapter 18 (design system) | `https://app.notion.com/p/4710716a37054965bad103abce2a2a92` |
| Chapter 19 (AI agents) | `https://app.notion.com/p/cfd6eb5616c54400a98952480695b70a` |
| Feature catalog | `https://app.notion.com/p/9b9e5eaaec714a3c8feffa56960624fe` |
| Previous thread context | `thread://054740f3-9032-81d5-95a5-0003d03fbafb/3a4740f3-9032-8079-90b0-00a985711dfe` |
| Last full zip delivered | `file://%7B%22source%22%3A%22attachment%3Abc84ebab-7980-493e-af23-017b3f13fe66%3Adoip-command-center-optimized.zip%22%2C%22permissionRecord%22%3A%7B%22id%22%3A%223a4740f3-9032-8079-90b0-00a985711dfe%22%2C%22table%22%3A%22thread%22%2C%22spaceId%22%3A%22054740f3-9032-81d5-95a5-0003d03fbafb%22%7D%7D` (308 KB — full project with animations) |

---

*End of handoff document. Good luck, next agent.*
