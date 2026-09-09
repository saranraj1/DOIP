---
id: REF-03
title: Sector Map Legend & Zone Types
tags: [map, sectors, zones, legend]
version: 1.0
---

# REF-03 — Sector Map Legend & Zone Types

*Simulated training reference.*

## Sectors

The operational area is divided into lettered sectors (A, B, C, …) defined in each scenario's GeoJSON. Sector boundaries drive War-Room operator scoping, alert routing, and analytics grouping.

## Zone types

| Zone | Map style | Meaning | Routing behavior |
|---|---|---|---|
| Patrol zone | dashed blue outline | Assigned patrol area | preferred cost |
| Monitoring zone | dotted amber outline | Watch area; unknown tracks raise medium | normal cost |
| Restricted zone | solid red fill (hatched) | No entry without authorization | never routed through |
| Threat zone | orange gradient fill | Elevated risk (scenario- or inject-defined) | high routing cost |
| Weather cell | translucent gray/blue blob | Active weather; slows units | dynamic cost by intensity |

## Marker severity shapes

Incidents render by severity: ● low · ■ medium · △ high · ◈ critical. Stale unit markers (missed report window) show a hollow outline with last-report age.

## Attribution

Base map: © OpenStreetMap contributors (ODbL) — the attribution line is mandatory on every map view, including screenshots in reports.
