"""Rule-based sitrep generator (Ch18 S7/sitrep, Ch13 FR).

No LLM required for MVP: derives situation text from the live event log and
world snapshot, cites every claim with source event IDs, and tags each claim
as FACT (from the live log) or PROJ (modelled extrapolation) — matching the
Ch14 S13 evidence-chip contract.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Any


@dataclass
class SitrepSection:
    heading: str
    body: str
    confidence: float
    citations: list[dict]  # list of {id, tick, type, entityId}
    evidence_kind: str  # FACT | PROJ


def generate(world_snapshot: dict, events: list[dict]) -> list[dict]:
    """Return a list of sitrep sections as dicts, ready to JSON-serialise."""

    def cite(type_: str, n: int = 3) -> list[dict]:
        return [
            {"id": e["id"], "tick": e["tick"], "type": e["type"],
             "entityId": e["entityId"], "severity": e["severity"]}
            for e in reversed(events)
            if e["type"] == type_
        ][:n]

    units = list(world_snapshot.get("units", {}).values())
    incidents = list(world_snapshot.get("incidents", {}).values())
    alerts = list(world_snapshot.get("alerts", {}).values())
    depots = list(world_snapshot.get("depots", {}).values())
    tick = world_snapshot.get("tick", 0)

    open_inc = [i for i in incidents if i.get("open")]
    crit_inc = [i for i in open_inc if i.get("severity") in ("critical", "high")]
    stale = [u for u in units if tick - u.get("lastSeenTick", 0) >= 180]
    low_fuel = [u for u in units if u.get("fuel", 100) < 30]
    low_depot_fuel = [d for d in depots if d.get("stock", {}).get("fuel", 999) < 600]
    unacked = [a for a in alerts if not a.get("acked")]

    sections: list[SitrepSection] = [
        SitrepSection(
            heading="Overall posture",
            body=(
                f"{len(units)} units committed across {world_snapshot.get('scenarioId', 'unknown')} "
                f"at T+{tick}. "
                + (
                    f"{len(crit_inc)} incident(s) at high or critical severity are shaping the picture."
                    if crit_inc else "No high-severity incidents are currently open."
                )
                + f" {len(unacked)} alert(s) remain unacknowledged."
            ),
            confidence=0.92,
            citations=cite("incident_open"),
            evidence_kind="FACT",
        ),
        SitrepSection(
            heading="Communications",
            body=(
                f"{len(stale)} unit(s) have exceeded the 3-minute reporting threshold and are rendered "
                f"stale. Recommend comms check on {', '.join(u.get('callsign', u['id']) for u in stale)}."
                if stale else
                "All units reporting inside the 3-minute threshold; no comms gaps detected."
            ),
            confidence=0.78 if stale else 0.95,
            citations=cite("comms_loss"),
            evidence_kind="FACT",
        ),
        SitrepSection(
            heading="Sustainment",
            body=(
                f"{len(low_fuel)} unit(s) below 30% fuel: "
                f"{', '.join(u.get('callsign', u['id']) for u in low_fuel)}. "
                f"{len(low_depot_fuel)} depot(s) below 600-unit fuel threshold. "
                "Consider tasking resupply now."
                if low_fuel or low_depot_fuel else
                "Fuel and battery states nominal across all committed units and depots."
            ),
            confidence=0.71,
            citations=cite("resource_level"),
            evidence_kind="PROJ",   # forecast element makes this a projection
        ),
        SitrepSection(
            heading="Recommended actions",
            body=" ".join(filter(None, [
                f"Prioritise closure of {len(crit_inc)} high/critical incident(s)." if crit_inc else None,
                "Re-establish comms with stale units before the next phase line." if stale else None,
                "Issue resupply tasking from the nearest depot." if low_fuel else None,
                "Maintain current patrol density; no re-tasking required at this time.",
            ])),
            confidence=0.64,
            citations=cite("alert_raise"),
            evidence_kind="PROJ",
        ),
    ]

    return [
        {
            "heading": s.heading,
            "body": s.body,
            "confidence": s.confidence,
            "citations": s.citations,
            "evidenceKind": s.evidence_kind,
        }
        for s in sections
    ]
