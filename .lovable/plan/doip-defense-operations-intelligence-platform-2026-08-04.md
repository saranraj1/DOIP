# DOIP — Defense Operations Intelligence Platform

A dark command-center web app for military training & simulation, fully frontend, driven by a deterministic in-browser simulation engine. All data synthetic.

## Build order

**Phase 1 — foundation (first delivery)**
- Design tokens + app shell: top status bar (sim clock, RUNNING/PAUSED/REPLAY, tick rate, unacked alert badge, role), collapsible left nav, synthetic-data footer disclaimer.
- Mock simulation engine + event log + derived state store.
- S1 Login (role picker), S3 Live Map (home), S4 Run Control.
- Global command palette on `/`.

**Phase 2** — S2 Dashboard, S6 Replay, S5 Mission Planner, S10 Logistics, S11 Personnel.

**Phase 3** — S7 AI Sitrep, S8 What-If Theater, S9 Vision Review, S12 Analytics, S13 Investment Advisor, S14 War-Room, S15 Admin.

## Simulation layer

- `mulberry32` seeded PRNG — same seed + scenario reproduces a run exactly.
- 1 Hz tick loop (speed 1–8x), ~20 entities: patrol teams, UAVs, convoy vehicles, depots, with callsigns (ALPHA-1, RAVEN-2, …) moving along patrol routes near Bengaluru (lon 77.5x / lat 12.9x).
- Per tick: movement, drifting weather cells that slow units inside them, incident spawns, resource burn (fuel / medkit / rations / battery), personnel vitals (heart rate, fatigue), comms silence.
- Every change appends a typed `Event {id, tick, simTime, type, severity, entityId, payload}` to an immutable in-memory log.
- A reducer folds the log into derived state (units, incidents, alerts, depots, personnel, zones). Screens read only derived state + the log; no screen owns data.
- Scenarios: SC-1 Night Patrol Baseline, SC-2 Border Surveillance, SC-3 Counter-UAV Airspace Watch, SC-4 Convoy Escort.

## Backend seam

One `SimSource` interface (`start / pause / resume / stop / setSpeed / subscribe(event)`). The mock tick engine is one implementation; a FastAPI WebSocket feed later becomes a second implementation of the same interface. UI, store, and reducer stay untouched.

## Roles

Mock login with admin / planner / operator / viewer. planner+ plans missions; operator+ acknowledges alerts and controls runs; admin sees S15; viewer read-only everywhere (controls disabled with reason tooltips, never hidden dead buttons).

## Design system

- Background #0A0E14, surface #111722, raised #1A2230, border #232D3F; text #E6EDF3 / #8B98A9 / mono #9FB1C4. Never pure black or white.
- Accent cyan #22D3EE (actions, links, selected nav, friendly units); success #34D399.
- Violet #A78BFA reserved exclusively for AI-generated content (sitrep cards, AI badges, What-If narration) — used nowhere else.
- Severity always color **and** shape + text label: Low ● #6B7A8F, Medium ■ #FBBF24, High △ #FB923C, Critical ◈ #F87171. Only critical elements may pulse.
- Monospace for ids, timestamps, ticks, coordinates. Dense information layout.
- Maps: Leaflet with dark tiles; patrol zones dashed cyan 30%, restricted red hatched 20%, threat orange gradient, weather slate #64748B 25–40% by intensity; "© OpenStreetMap contributors" on every map.

## Screens

S1 Login · S2 Dashboard · S3 Live Map (home) · S4 Run Control · S5 Mission Planner · S6 Replay · S7 AI Sitrep · S8 What-If Theater · S9 Vision Review · S10 Logistics · S11 Personnel · S12 Analytics · S13 Investment Advisor · S14 War-Room · S15 Admin — each as its own route with its own page metadata, built to the detail in the brief (feasibility-gated LAUNCH, citation chips `[e:1234]` that pulse map markers, DSL action table with edit/approve/discard, FACT vs PROJECTION labels, append-only audit log, etc.).

## Quality bar

No dead buttons — every control mutates the mock layer. Loading and empty states everywhere. Keyboard-accessible command palette. Severity never color-only.

## Technical notes

- TanStack Start routes under `src/routes/`; shell in `__root.tsx`.
- Sim engine in plain TS modules (`src/sim/`), exposed through a React context store with selector hooks to avoid whole-tree re-renders each tick.
- Leaflet loaded client-side only (lazy import behind `ClientOnly`) so SSR does not break.
- Tokens defined in `src/styles.css` under `@theme inline`; components use semantic classes only.
- Charts via Recharts; canned AI text assembled from real events in the log (no LLM call).
