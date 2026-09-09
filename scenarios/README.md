# Scenarios — Index & Contribution Rules

Scenario YAML files are engine input. Format: `docs/scenario-dsl.md`. Authored content source: Starter Artifact Pack (Notion, under Master Doc Ch. 19).

## Library

| File | Scenario | Entities | Duration | Purpose |
|---|---|---|---|---|
| `sc1_night_patrol.yaml` | SC-1 Night Patrol Baseline | 12 | 2 h | Phase 1 smoke test; quick golden variant (seed 42) |
| `sc2_border_surveillance.yaml` | SC-2 Border Surveillance & Infiltration Response | 35 | 6 h | **Flagship demo + canonical golden-run fixture (seed 8841 — frozen)** |
| `sc3_counter_uav.yaml` | SC-3 Counter-UAV Airspace Watch | 28 | 4 h | SOP-05 exercise |
| `sc4_convoy_escort.yaml` | SC-4 Convoy Escort Under Threat | 20 | 5 h | SOP-04 exercise |
| `sc5_casevac.yaml` | SC-5 Forward Post Casualty Evacuation | 40 | 3 h | SOP-03 KPIs |
| `sc6_logistics.yaml` | SC-6 Extended Logistics Sustainment | 30 | 12 h | forecasting stress |
| `sc7_multi_sector.yaml` | SC-7 Multi-Sector Escalation Exercise | 60 | 8 h | War-Room / NFR load |
| `sc8_hadr_flood.yaml` | SC-8 HADR Deployment — Flood Relief | 25 | 6 h | SOP-08; sole HADR entry; Ch. 14 benchmark link |

## Rules

1. Every scenario declares a default seed. **SC-2 seed 8841 is frozen** — changing it or the file invalidates the golden run (see `docs/golden-run.md`).
2. Whitelisted DSL actions/conditions only — CI validates every file on every push.
3. New scenarios: add the file + a row here + referenced geo files in `geo/` — one PR.
4. Keep rosters compact: explicit key entities + `entity_groups` for bulk.
