# Scenario DSL Reference

The engine's parser (`engine/dsl/`) is the source of truth; this document describes it. If they disagree, fix one — in the same PR.

## File shape

```yaml
name: "SC-1 Night Patrol Baseline"
area: "geo/ops_area.geojson"
sim_start: "2026-01-10T22:00:00"
duration_minutes: 120
seed: 42

entities:
  - id: g1
    type: ground_team          # ground_team | drone | depot | vehicle
    callsign: "ALPHA-1"
    start: [77.52, 12.97]      # [lon, lat]
    behavior: patrol           # patrol | idle | follow_route | respond
    patrol_zone: "zone_a"
    personnel: 5
    battery_pct: 100
    resources: {fuel: 1.0, medkit: 2, food: 1.0, battery: 1.0}

entity_groups:                  # loader shorthand — expands to N entities
  - count: 8
    template: {type: ground_team, behavior: patrol, patrol_zone: "zone_b", personnel: 4}
    id_prefix: "g"             # deterministic ids g2..g9

timeline:
  - at: "+00:30"
    action: spawn_weather
    params: {kind: storm, intensity: 0.7, center: [77.55, 12.99], radius_km: 4, drift_kmh: 10}

rules:
  - when: unit_in_weather(g1, storm, 0.5)
    then: {action: modify_speed, params: {unit: g1, multiplier: 0.6}}

end_conditions:
  - sim_time_elapsed
```

## Whitelisted actions (exhaustive)

`spawn_weather` · `create_incident` · `unit_report` · `modify_speed` · `raise_alert`

## Whitelisted rule conditions (exhaustive)

`unit_in_weather(unit, kind, threshold)` · `resource_below(depot, item, frac)` · `random_chance(p)` — `random_chance` draws from the run's single seeded RNG, so it is deterministic per seed.

## Validation guarantees

- Malformed YAML → rejected with line-level errors; nothing starts.
- Unknown actions, conditions, or params → rejected. The whitelist is the security boundary for AI-authored content (Ch. 13) — extending it is an architecture decision, not a convenience fix.
- All entity references in `timeline`/`rules` must exist in the roster after group expansion.

## Adding a scenario

See `scenarios/README.md`. Adding a new **action or condition** requires: implementation + validator schema + this doc + a golden-run impact statement.
