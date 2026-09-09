"""Deterministic simulation engine — faithful Python port of src/sim/engine.ts.

The mulberry32 PRNG (prng.py) produces bit-identical float sequences to the
TypeScript original, so recorded event logs are fully interchangeable between
server and browser replay.

Entry point for callers: `SimEngine`. Use `start()` to initialise a run and
call `step()` in a loop (or let `SimSession` drive the async loop via WS).
"""

import math
from typing import Any

from .prng import Rand, between, mulberry32, pick
from .sim_types import Depot, Person, SimEvent, Unit, WeatherCell, Zone

BASE_LAT = 12.9716
BASE_LON = 77.5946

PATROL_NAMES = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL"]
UAV_NAMES = ["RAVEN", "KITE", "FALCON", "OSPREY", "SHRIKE", "HARRIER", "MERLIN", "CONDOR"]
CONVOY_NAMES = ["MULE", "CARAVAN", "IRONHORSE", "PACKHORSE", "OXCART", "DRAY"]
SECTORS = ["A", "B", "C", "D"]
FIRST = ["A. Rao", "S. Menon", "K. Iyer", "P. Singh", "N. Das", "R. Kapoor", "V. Nair", "M. Bose"]
RANKS = ["SGT", "CPL", "LT", "PVT", "SSG"]
INCIDENT_KINDS = [
    "unauthorized-entry", "signal-jamming", "vehicle-breakdown",
    "unidentified-contact", "perimeter-breach", "medical", "supply-shortfall",
]
SEVERITIES = ["low", "medium", "high", "critical"]

SCENARIOS: dict[str, dict] = {
    "SC-1": {"id": "SC-1", "name": "Night Patrol Baseline",
             "incidentRate": 0.05, "weatherRate": 0.02,
             "uavCount": 4, "patrolCount": 8, "convoyCount": 3},
    "SC-2": {"id": "SC-2", "name": "Border Surveillance",
             "incidentRate": 0.09, "weatherRate": 0.04,
             "uavCount": 6, "patrolCount": 7, "convoyCount": 2},
    "SC-3": {"id": "SC-3", "name": "Counter-UAV Airspace Watch",
             "incidentRate": 0.14, "weatherRate": 0.03,
             "uavCount": 8, "patrolCount": 5, "convoyCount": 2},
    "SC-4": {"id": "SC-4", "name": "Convoy Escort",
             "incidentRate": 0.10, "weatherRate": 0.08,
             "uavCount": 3, "patrolCount": 6, "convoyCount": 6},
}


def _ring(rand: Rand, cx: float, cy: float, r: float, n: int) -> list[tuple[float, float]]:
    pts = []
    phase = rand() * math.pi * 2
    for i in range(n):
        a = phase + (i / n) * math.pi * 2
        rr = r * (0.7 + rand() * 0.6)
        pts.append((cx + math.sin(a) * rr, cy + math.cos(a) * rr))
    return pts


class SimEngine:
    """One simulation run. Thread-safe for a single asyncio task."""

    def __init__(self) -> None:
        self.seed = 20260101
        self.scenario_id = "SC-1"
        self._rand: Rand = mulberry32(self.seed)
        self._next_id = 1
        self.tick = 0
        self._units: list[Unit] = []
        self._personnel: list[Person] = []
        self._depots: list[Depot] = []
        self._weather: list[WeatherCell] = []
        self._route_idx: dict[str, int] = {}
        self._silence: dict[str, int] = {}  # unit_id -> silent_until_tick
        self._sc: dict = SCENARIOS["SC-1"]

    # ------------------------------------------------------------------
    def start(self, seed: int, scenario_id: str) -> list[SimEvent]:
        self.seed = seed
        self.scenario_id = scenario_id
        self._sc = SCENARIOS.get(scenario_id, SCENARIOS["SC-1"])
        self._rand = mulberry32(seed)
        self._next_id = 1
        self.tick = 0
        self._route_idx.clear()
        self._silence.clear()
        self._weather = []

        rand = self._rand

        def mk(kind: str, callsign: str, i: int) -> Unit:
            cx = BASE_LAT + between(rand, -0.05, 0.05)
            cy = BASE_LON + between(rand, -0.05, 0.05)
            radius = 0.03 if kind == "uav" else 0.018
            route = _ring(rand, cx, cy, radius, 6)
            speed = 68.0 if kind == "uav" else (34.0 if kind == "convoy" else 6.0)
            return Unit(
                id=f"U-{kind.upper()}-{i}",
                callsign=callsign,
                kind=kind,
                lat=route[0][0], lon=route[0][1],
                heading=0.0, speedKph=speed,
                status="active",
                fuel=between(rand, 55, 100),
                battery=between(rand, 60, 100),
                lastSeenTick=0,
                sector=pick(rand, SECTORS),
                route=route,
            )

        sc = self._sc
        self._units = []
        self._personnel = []

        for i in range(sc["patrolCount"]):
            u = mk("patrol", f"{PATROL_NAMES[i % len(PATROL_NAMES)]}-{1 + (i % 3)}", i + 1)
            self._units.append(u)
            team_size = 2 + int(rand() * 2)
            for p_idx in range(team_size):
                self._personnel.append(Person(
                    id=f"P-{u.id}-{p_idx}",
                    name=pick(rand, FIRST), rank=pick(rand, RANKS),
                    unitId=u.id,
                    heartRate=round(between(rand, 62, 92)),
                    fatigue=round(between(rand, 0.1, 0.55), 2),
                    history=[],
                ))

        for i in range(sc["uavCount"]):
            self._units.append(mk("uav", f"{UAV_NAMES[i % len(UAV_NAMES)]}-{1 + (i % 3)}", i + 1))
        for i in range(sc["convoyCount"]):
            self._units.append(mk("convoy", f"{CONVOY_NAMES[i % len(CONVOY_NAMES)]}-{1 + (i % 3)}", i + 1))

        self._depots = []
        for i, label in enumerate(["NORTH", "CENTRAL", "SOUTH"]):
            self._depots.append(Depot(
                id=f"D-{i + 1}", name=f"{label} DEPOT",
                lat=BASE_LAT + between(rand, -0.04, 0.04),
                lon=BASE_LON + between(rand, -0.04, 0.04),
                stock={"fuel": round(between(rand, 2200, 4000)),
                       "medkit": round(between(rand, 60, 140)),
                       "rations": round(between(rand, 300, 700)),
                       "battery": round(between(rand, 80, 200))},
                capacity={"fuel": 4000, "medkit": 150, "rations": 700, "battery": 200},
            ))

        zones = [
            {"id": "Z-1", "name": "PATROL GRID NORTH", "kind": "patrol",
             "points": _ring(rand, BASE_LAT + 0.03, BASE_LON - 0.02, 0.035, 7)},
            {"id": "Z-2", "name": "PATROL GRID SOUTH", "kind": "patrol",
             "points": _ring(rand, BASE_LAT - 0.035, BASE_LON + 0.02, 0.03, 6)},
            {"id": "Z-3", "name": "RESTRICTED AIRSPACE R-12", "kind": "restricted",
             "points": _ring(rand, BASE_LAT + 0.01, BASE_LON + 0.045, 0.022, 5)},
            {"id": "Z-4", "name": "THREAT SECTOR C", "kind": "threat",
             "points": _ring(rand, BASE_LAT - 0.02, BASE_LON - 0.045, 0.026, 6)},
        ]

        world_init = self._make_event(
            "world_init", "low", "system",
            {
                "seed": seed, "scenarioId": scenario_id,
                "units": [u.to_dict() for u in self._units],
                "depots": [d.to_dict() for d in self._depots],
                "personnel": [p.to_dict() for p in self._personnel],
                "zones": zones,
            }
        )
        return [world_init]

    # ------------------------------------------------------------------
    def inject(self, partial: dict) -> list[SimEvent]:
        """Apply an operator-sourced event (mission tasking, ack, close)."""
        # Mission tasking rewrites route so the engine follows the plan.
        p = partial.get("payload", {})
        if partial.get("type") == "system" and p.get("mission") and p.get("route"):
            for u in self._units:
                if u.id == partial.get("entityId"):
                    u.route = [tuple(wp) for wp in p["route"]]
                    self._route_idx[u.id] = 0
        ev = self._make_event(
            partial["type"], partial.get("severity", "low"),
            partial.get("entityId", "system"), p,
        )
        return [ev]

    def step(self) -> list[SimEvent]:
        """Advance the simulation by one tick; return the produced events."""
        self.tick += 1
        rand = self._rand
        sc = self._sc
        out: list[dict[str, Any]] = []   # partials

        # weather
        if rand() < sc["weatherRate"] and len(self._weather) < 4:
            cell = WeatherCell(
                id=f"W-{self.tick}",
                lat=BASE_LAT + between(rand, -0.05, 0.05),
                lon=BASE_LON + between(rand, -0.05, 0.05),
                radiusM=round(between(rand, 900, 2600)),
                intensity=round(between(rand, 0.3, 1.0), 2),
                kind=pick(rand, ["rain", "storm", "fog", "dust"]),
            )
            self._weather.append(cell)
            out.append({"type": "weather_spawn",
                         "severity": "high" if cell.intensity > 0.7 else "medium",
                         "entityId": cell.id, "payload": cell.to_dict()})

        surviving = []
        for w in self._weather:
            w.lat += between(rand, -0.0016, 0.0016)
            w.lon += between(rand, -0.0016, 0.0016)
            w.intensity = round(max(0.0, w.intensity - 0.004), 3)
            if w.intensity <= 0.05:
                out.append({"type": "weather_clear", "severity": "low",
                             "entityId": w.id, "payload": {}})
            else:
                out.append({"type": "weather_move", "severity": "low",
                             "entityId": w.id,
                             "payload": {"lat": w.lat, "lon": w.lon, "intensity": w.intensity}})
                surviving.append(w)
        self._weather = surviving

        # units
        for u in self._units:
            silent_until = self._silence.get(u.id, 0)
            if silent_until > self.tick:
                continue
            if rand() < 0.004:
                self._silence[u.id] = self.tick + round(between(rand, 180, 320))
                out.append({"type": "comms_loss", "severity": "high",
                             "entityId": u.id, "payload": {"callsign": u.callsign}})
                out.append({"type": "alert_raise", "severity": "high",
                             "entityId": u.id,
                             "payload": {"message": f"{u.callsign} comms silence detected",
                                         "alertId": f"AL-{self.tick}-{u.id}"}})
                continue
            if silent_until == self.tick:
                out.append({"type": "comms_restore", "severity": "low",
                             "entityId": u.id, "payload": {"callsign": u.callsign}})

            idx = self._route_idx.get(u.id, 0)
            target = u.route[idx % len(u.route)]
            d_lat = target[0] - u.lat
            d_lon = target[1] - u.lon
            dist = math.hypot(d_lat, d_lon)
            in_weather = any(
                math.hypot(w.lat - u.lat, w.lon - u.lon) * 111000 < w.radiusM
                for w in self._weather
            )
            base_step = (u.speedKph / 3600 / 111) * (0.45 if in_weather else 1.0) * 4
            if dist < base_step * 1.2:
                self._route_idx[u.id] = idx + 1
            else:
                u.lat += (d_lat / dist) * base_step
                u.lon += (d_lon / dist) * base_step
                u.heading = math.degrees(math.atan2(d_lon, d_lat))

            new_status = "slowed" if in_weather else "active"
            if new_status != u.status:
                u.status = new_status
                out.append({"type": "unit_status", "severity": "low",
                             "entityId": u.id, "payload": {"status": new_status}})
            u.lastSeenTick = self.tick
            out.append({"type": "unit_move", "severity": "low",
                         "entityId": u.id,
                         "payload": {"lat": u.lat, "lon": u.lon,
                                      "heading": u.heading, "inWeather": in_weather}})

            if self.tick % 5 == 0:
                u.fuel = max(0.0, u.fuel - between(rand, 0.05, 0.35))
                bat_drain = between(rand, 0.1, 0.5) * (2 if u.kind == "uav" else 1)
                u.battery = max(0.0, u.battery - bat_drain)
                sev = "high" if u.battery < 15 or u.fuel < 15 else "low"
                out.append({"type": "resource_level", "severity": sev,
                             "entityId": u.id,
                             "payload": {"fuel": round(u.fuel, 1), "battery": round(u.battery, 1)}})
                if u.battery < 12:
                    out.append({"type": "alert_raise", "severity": "critical",
                                 "entityId": u.id,
                                 "payload": {"message": f"{u.callsign} battery critical ({u.battery:.0f}%)",
                                              "alertId": f"AL-{self.tick}-BAT-{u.id}"}})

            if u.kind == "uav" and rand() < 0.02:
                out.append({"type": "detection", "severity": "medium",
                             "entityId": u.id,
                             "payload": {"label": pick(rand, ["vehicle", "person", "uav", "structure"]),
                                          "confidence": round(between(rand, 0.45, 0.98), 2),
                                          "model": "yolov8n-doip-v1.4",
                                          "lat": u.lat, "lon": u.lon,
                                          "frame": f"F-{self.tick}-{u.id}"}})

        # depots
        if self.tick % 10 == 0:
            for d in self._depots:
                d.stock["fuel"] = max(0, d.stock["fuel"] - round(between(rand, 2, 14)))
                d.stock["medkit"] = max(0, d.stock["medkit"] - (1 if rand() < 0.3 else 0))
                d.stock["rations"] = max(0, d.stock["rations"] - round(between(rand, 1, 5)))
                d.stock["battery"] = max(0, d.stock["battery"] - (1 if rand() < 0.5 else 0))
                out.append({"type": "resource_level",
                             "severity": "high" if d.stock["fuel"] < 600 else "low",
                             "entityId": d.id, "payload": {"stock": dict(d.stock)}})

        # vitals
        if self.tick % 8 == 0:
            for p in self._personnel:
                p.heartRate = round(min(180, max(52, p.heartRate + between(rand, -5, 6))))
                p.fatigue = round(min(1.0, p.fatigue + between(rand, -0.004, 0.012)), 3)
                out.append({"type": "vitals",
                             "severity": "high" if p.fatigue > 0.8 else "low",
                             "entityId": p.id,
                             "payload": {"heartRate": p.heartRate, "fatigue": p.fatigue}})

        # incidents
        if rand() < sc["incidentRate"]:
            u = pick(rand, self._units)
            bump = 0.6 if sc["incidentRate"] > 0.1 else 0
            sev_idx = min(3, int(rand() * 4 + bump))
            sev = SEVERITIES[sev_idx]
            inc_id = f"INC-{self.tick}"
            out.append({"type": "incident_open", "severity": sev,
                         "entityId": inc_id,
                         "payload": {"kind": pick(rand, INCIDENT_KINDS),
                                      "lat": u.lat + between(rand, -0.004, 0.004),
                                      "lon": u.lon + between(rand, -0.004, 0.004),
                                      "reportedBy": u.id, "callsign": u.callsign}})
            out.append({"type": "alert_raise", "severity": sev,
                         "entityId": inc_id,
                         "payload": {"message": f"Incident {inc_id} reported by {u.callsign}",
                                      "alertId": f"AL-{inc_id}"}})

        return [self._make_event(p["type"], p["severity"], p["entityId"], p["payload"])
                for p in out]

    # ------------------------------------------------------------------
    def _make_event(self, type_: str, severity: str, entity_id: str,
                    payload: dict) -> SimEvent:
        ev = SimEvent(
            id=self._next_id,
            tick=self.tick,
            simTime=self.tick * 1000,
            type=type_,
            severity=severity,
            entityId=entity_id,
            payload=payload,
        )
        self._next_id += 1
        return ev
