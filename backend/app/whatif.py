"""Headless What-If runner (Ch18 S8, Ch13 FR).

Runs deterministic 60-tick branch scenarios server-side with injected
actions, returning full event logs, Monte Carlo variance envelopes (P10/P50/P90),
and unit spatial trajectories for tactical wargaming diffs.

Design:
- Branching from a recorded run seed guarantees the same initial world.
- Injected actions are synthetic events pushed at specified ticks.
- The branch log is separate from the main run log; no side effects.
- Monte Carlo ensemble executes N seeded runs to compute risk variance bands.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

from .engine import SimEngine


@dataclass
class WhatIfAction:
    """One branch action injected at a specific tick."""
    tick: int              # tick at which to inject (0 = inject at start, before first step)
    type: str              # SimEvent type, e.g. 'weather_spawn', 'incident_open'
    severity: str = "medium"
    entity_id: str = "system"
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class WhatIfResult:
    seed: int
    scenario_id: str
    ticks: int
    baseline_events: list[dict]
    branch_events: list[dict]
    deltas: dict                     # high-level KPI diff
    baseline_risk: list[float]        # tick-by-tick risk [0..ticks]
    branch_risk: list[float]          # tick-by-tick risk [0..ticks]
    p10_risk: list[float] | None = None  # Monte Carlo 10th percentile (optimistic)
    p50_risk: list[float] | None = None  # Monte Carlo 50th percentile (median)
    p90_risk: list[float] | None = None  # Monte Carlo 90th percentile (worst-case)
    trajectories: dict[str, Any] = field(default_factory=dict)
    spatial_annotations: dict[str, Any] = field(default_factory=dict)
    monte_carlo_runs: int = 1


# Simple KPIs extracted from an event log
def _kpis(events: list[dict]) -> dict:
    incidents_opened = sum(1 for e in events if e["type"] == "incident_open")
    incidents_closed = sum(1 for e in events if e["type"] == "incident_close")
    comms_loss = sum(1 for e in events if e["type"] == "comms_loss")
    detections = sum(1 for e in events if e["type"] == "detection")
    critical_alerts = sum(
        1 for e in events
        if e["type"] == "alert_raise" and e["severity"] == "critical"
    )
    # Mean response time: ticks between incident_open and incident_close for same entity
    open_at: dict[str, int] = {}
    close_times: list[int] = []
    for e in events:
        if e["type"] == "incident_open":
            open_at[e["entityId"]] = e["tick"]
        elif e["type"] == "incident_close" and e["entityId"] in open_at:
            close_times.append(e["tick"] - open_at.pop(e["entityId"]))
    mean_close = round(sum(close_times) / len(close_times), 1) if close_times else None

    # Coverage estimate based on unit active status
    total_moves = sum(1 for e in events if e["type"] == "unit_move")
    moves_in_weather = sum(1 for e in events if e["type"] == "unit_move" and e.get("payload", {}).get("inWeather"))
    weather_ratio = (moves_in_weather / total_moves) if total_moves > 0 else 0.0
    coverage_pct = max(20, round(92 - weather_ratio * 35 - (incidents_opened * 4.5)))

    # Sustainment estimate
    sustainment_hours = max(12, round(48 - (incidents_opened * 2.8) - (critical_alerts * 1.5)))

    return {
        "incidents_opened": incidents_opened,
        "incidents_closed": incidents_closed,
        "comms_loss": comms_loss,
        "detections": detections,
        "critical_alerts": critical_alerts,
        "mean_response_ticks": mean_close,
        "total_events": len(events),
        "coverage_pct": coverage_pct,
        "sustainment_hours": sustainment_hours,
    }


def _compute_tick_risk_series(events: list[dict], ticks: int) -> list[float]:
    """Calculate empirical operational risk (1-100) at each tick based on real engine events."""
    risk_series = []
    
    # Pre-index events by tick
    events_by_tick: dict[int, list[dict]] = {t: [] for t in range(ticks + 1)}
    for e in events:
        t = e.get("tick", 0)
        if 0 <= t <= ticks:
            events_by_tick[t].append(e)

    active_incidents: dict[str, float] = {}  # entityId -> severity weight
    recent_alerts: list[tuple[int, float]] = []  # (tick, weight)

    base_risk = 8.0
    current_risk = base_risk

    for t in range(ticks + 1):
        for e in events_by_tick[t]:
            etype = e.get("type")
            sev = e.get("severity", "low")
            weight = 18.0 if sev == "critical" else 10.0 if sev == "high" else 5.0 if sev == "medium" else 2.0

            if etype == "incident_open":
                active_incidents[e.get("entityId", f"inc-{t}")] = weight
            elif etype == "incident_close":
                active_incidents.pop(e.get("entityId", ""), None)
            elif etype == "alert_raise":
                recent_alerts.append((t, weight * 0.7))

        # Expire alerts older than 12 ticks
        recent_alerts = [(at, w) for at, w in recent_alerts if t - at <= 12]

        incident_stress = sum(active_incidents.values())
        alert_stress = sum(w * max(0.2, 1.0 - (t - at) / 12.0) for at, w in recent_alerts)

        # Count units in weather at this tick
        units_in_weather = sum(
            1 for e in events_by_tick[t]
            if e.get("type") == "unit_move" and e.get("payload", {}).get("inWeather")
        )

        target_risk = base_risk + incident_stress + alert_stress + (units_in_weather * 6.0)
        # Smooth transition towards target risk
        current_risk += (target_risk - current_risk) * 0.22
        clamped = max(3.0, min(98.0, round(current_risk, 1)))
        risk_series.append(clamped)

    return risk_series


def _extract_trajectories(events: list[dict]) -> dict[str, Any]:
    """Extract unit paths for both baseline and branch visualization."""
    units_info: dict[str, dict] = {}
    positions_by_unit: dict[str, list[dict]] = {}

    for e in events:
        if e.get("type") == "world_init":
            for u in e.get("payload", {}).get("units", []):
                uid = u.get("id")
                units_info[uid] = {
                    "id": uid,
                    "callsign": u.get("callsign", uid),
                    "kind": u.get("kind", "patrol"),
                    "color": "#38bdf8" if u.get("kind") == "uav" else "#4ade80" if u.get("kind") == "convoy" else "#a3e635",
                }
        elif e.get("type") == "unit_move":
            uid = e.get("entityId")
            p = e.get("payload", {})
            if uid and "lat" in p and "lon" in p:
                if uid not in positions_by_unit:
                    positions_by_unit[uid] = []
                positions_by_unit[uid].append({
                    "tick": e.get("tick", 0),
                    "lat": round(p["lat"], 5),
                    "lon": round(p["lon"], 5),
                    "heading": round(p.get("heading", 0), 1),
                    "inWeather": bool(p.get("inWeather", False)),
                })

    return {
        "units": list(units_info.values()),
        "tracks": positions_by_unit,
    }


def _extract_spatial_annotations(events: list[dict]) -> dict[str, Any]:
    """Extract weather cells and incident locations for map overlay."""
    weather_cells: list[dict] = []
    incidents: list[dict] = []

    for e in events:
        t = e.get("tick", 0)
        p = e.get("payload", {})
        if e.get("type") in ("weather_spawn", "spawn_weather") or "WeatherCell" in str(p):
            weather_cells.append({
                "id": e.get("entityId", f"W-{t}"),
                "tick": t,
                "lat": p.get("lat", 34.02),
                "lon": p.get("lon", 71.55),
                "radiusKm": p.get("radiusKm", p.get("radius_km", 4.5)),
                "intensity": p.get("intensity", 0.7),
            })
        elif e.get("type") == "incident_open":
            incidents.append({
                "id": e.get("entityId", f"INC-{t}"),
                "tick": t,
                "lat": p.get("lat", 34.0),
                "lon": p.get("lon", 71.5),
                "severity": e.get("severity", "medium"),
                "kind": p.get("kind", "hostile_contact"),
                "callsign": p.get("callsign", "Unit"),
            })

    return {
        "weatherCells": weather_cells,
        "incidents": incidents,
    }


def run_branch(
    seed: int,
    scenario_id: str,
    actions: list[dict],
    ticks: int = 60,
    runs: int = 1,
) -> WhatIfResult:
    """Run both a baseline and a branched simulation for `ticks` steps.

    If runs > 1, runs a Monte Carlo ensemble with seeds [seed .. seed+runs-1]
    to produce P10, P50, and P90 confidence envelopes.
    """
    parsed_actions = [
        WhatIfAction(
            tick=int(a.get("tick", 0)),
            type=a.get("type", "system"),
            severity=a.get("severity", "medium"),
            entity_id=a.get("entityId", "system"),
            payload=a.get("payload", {}),
        )
        for a in actions
    ]

    # --- 1. Baseline Primary Run ---
    baseline_engine = SimEngine()
    baseline_events = baseline_engine.start(seed, scenario_id)
    for _ in range(ticks):
        baseline_events.extend(baseline_engine.step())
    baseline_log = [e.to_dict() for e in baseline_events]
    baseline_risk = _compute_tick_risk_series(baseline_log, ticks)

    # --- 2. Branch Primary Run ---
    branch_engine = SimEngine()
    branch_events = branch_engine.start(seed, scenario_id)
    for t in range(1, ticks + 1):
        tick_events = branch_engine.step()
        for action in parsed_actions:
            if action.tick == t:
                injected = branch_engine.inject({
                    "type": action.type,
                    "severity": action.severity,
                    "entityId": action.entity_id,
                    "payload": action.payload,
                })
                tick_events.extend(injected)
        branch_events.extend(tick_events)
    branch_log = [e.to_dict() for e in branch_events]
    branch_risk = _compute_tick_risk_series(branch_log, ticks)

    baseline_kpis = _kpis(baseline_log)
    branch_kpis = _kpis(branch_log)

    deltas = {}
    for key in baseline_kpis:
        b = baseline_kpis[key]
        br = branch_kpis[key]
        if b is not None and br is not None:
            deltas[key] = {"baseline": b, "branch": br, "delta": round(br - b, 2)}
        else:
            deltas[key] = {"baseline": b, "branch": br, "delta": None}

    # Extract spatial paths & annotations
    trajectories = {
        "baseline": _extract_trajectories(baseline_log),
        "branch": _extract_trajectories(branch_log),
    }
    spatial_annotations = {
        "baseline": _extract_spatial_annotations(baseline_log),
        "branch": _extract_spatial_annotations(branch_log),
    }

    # --- 3. Monte Carlo Ensemble (if requested) ---
    p10_risk = None
    p50_risk = None
    p90_risk = None

    if runs > 1:
        ensemble_risks: list[list[float]] = [branch_risk]
        for idx in range(1, runs):
            ens_seed = seed + (idx * 37)
            eng = SimEngine()
            eng.start(ens_seed, scenario_id)
            run_evs = []
            for t in range(1, ticks + 1):
                t_evs = eng.step()
                for action in parsed_actions:
                    if action.tick == t:
                        inj = eng.inject({
                            "type": action.type,
                            "severity": action.severity,
                            "entityId": action.entity_id,
                            "payload": action.payload,
                        })
                        t_evs.extend(inj)
                run_evs.extend(t_evs)
            log = [e.to_dict() for e in run_evs]
            ensemble_risks.append(_compute_tick_risk_series(log, ticks))

        p10_risk = []
        p50_risk = []
        p90_risk = []
        for t in range(ticks + 1):
            t_vals = sorted(ens[t] for ens in ensemble_risks if t < len(ens))
            n = len(t_vals)
            p10_idx = max(0, int(n * 0.1))
            p50_idx = max(0, int(n * 0.5))
            p90_idx = min(n - 1, int(n * 0.9))
            p10_risk.append(round(t_vals[p10_idx], 1))
            p50_risk.append(round(t_vals[p50_idx], 1))
            p90_risk.append(round(t_vals[p90_idx], 1))

    return WhatIfResult(
        seed=seed,
        scenario_id=scenario_id,
        ticks=ticks,
        baseline_events=baseline_log,
        branch_events=branch_log,
        deltas=deltas,
        baseline_risk=baseline_risk,
        branch_risk=branch_risk,
        p10_risk=p10_risk,
        p50_risk=p50_risk,
        p90_risk=p90_risk,
        trajectories=trajectories,
        spatial_annotations=spatial_annotations,
        monte_carlo_runs=runs,
    )
