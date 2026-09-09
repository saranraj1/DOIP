"""Headless What-If runner (Ch18 S8, Ch13 FR).

Runs a deterministic 60-tick branch scenario server-side with injected
actions, returning the full event log. The caller (frontend S8 or API client)
can diff the branch log against the baseline to compute outcome deltas.

Design:
- Branching from a recorded run seed guarantees the same initial world.
- Injected actions are synthetic events pushed at specified ticks.
- The branch log is separate from the main run log; no side effects.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

from .engine import SCENARIOS, SimEngine


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
    deltas: dict         # high-level KPI diff


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
    return {
        "incidents_opened": incidents_opened,
        "incidents_closed": incidents_closed,
        "comms_loss": comms_loss,
        "detections": detections,
        "critical_alerts": critical_alerts,
        "mean_response_ticks": mean_close,
        "total_events": len(events),
    }


def run_branch(
    seed: int,
    scenario_id: str,
    actions: list[dict],   # list of {tick, type, severity?, entityId?, payload?}
    ticks: int = 60,
) -> WhatIfResult:
    """Run both a baseline and a branched simulation for `ticks` steps.

    actions format:
        [{"tick": 10, "type": "weather_spawn", "payload": {...}}, ...]

    Returns WhatIfResult with both event logs and delta KPIs.
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

    # --- baseline (no injections) ---
    baseline_engine = SimEngine()
    baseline_events = baseline_engine.start(seed, scenario_id)
    for _ in range(ticks):
        baseline_events.extend(baseline_engine.step())
    baseline_log = [e.to_dict() for e in baseline_events]

    # --- branch (with injections) ---
    branch_engine = SimEngine()
    branch_events = branch_engine.start(seed, scenario_id)
    for t in range(1, ticks + 1):
        tick_events = branch_engine.step()
        # inject any actions scheduled at this tick
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

    baseline_kpis = _kpis(baseline_log)
    branch_kpis = _kpis(branch_log)

    deltas = {}
    for key in baseline_kpis:
        b = baseline_kpis[key]
        br = branch_kpis[key]
        if b is not None and br is not None:
            deltas[key] = {"baseline": b, "branch": br,
                           "delta": round(br - b, 2)}
        else:
            deltas[key] = {"baseline": b, "branch": br, "delta": None}

    return WhatIfResult(
        seed=seed,
        scenario_id=scenario_id,
        ticks=ticks,
        baseline_events=baseline_log,
        branch_events=branch_log,
        deltas=deltas,
    )
