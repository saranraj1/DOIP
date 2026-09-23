---
id: REF-01
title: Unit Type Capabilities Sheet
tags: [units, capabilities, reference]
version: 1.0
---

# REF-01 — Unit Type Capabilities Sheet

_Simulated training reference. Values are exercise parameters, not real specifications._

| Unit type                  | Personnel           | Speed (std)                   | Endurance            | Carries                          | Notes                             |
| -------------------------- | ------------------- | ----------------------------- | -------------------- | -------------------------------- | --------------------------------- |
| Ground patrol team         | 4–6                 | 5 km/h foot / 40 km/h vehicle | 8 sim-hours          | medkit, radio                    | Standard patrol & perimeter unit  |
| QRF element                | 8–12                | 60 km/h                       | 6 sim-hours          | medkit ×2, breach kit            | SOP-02 response standards apply   |
| Recon UAV                  | 0 (operator remote) | 70 km/h                       | 90 sim-min / battery | EO camera                        | Grounded in storm intensity ≥ 0.6 |
| Cargo/convoy vehicle       | 2                   | 50 km/h (convoy: slowest)     | fuel-limited         | 2,000 kg supplies                | SOP-04 spacing rules              |
| Medical evacuation vehicle | 3                   | 55 km/h                       | fuel-limited         | 2 litters, med station           | SOP-03 precedence rules           |
| Supply depot (static)      | 6                   | —                             | —                    | fuel, medkit, rations, batteries | Resupply threshold 30% (50% HADR) |

## Usage notes

- Speeds are modified by weather multipliers and terrain cost layers; the values above are clear-condition standards.
- Battery-powered assets report remaining percentage every position report; below 25% they must plan return-to-base.
- Personnel counts drive vitals simulation and CASEVAC capacity checks.
