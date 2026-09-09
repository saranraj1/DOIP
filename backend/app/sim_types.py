"""Dataclass mirrors of src/sim/types.ts — used by engine.py and reducers."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Literal

Severity = Literal["low", "medium", "high", "critical"]
EventType = Literal[
    "world_init", "unit_move", "unit_status", "comms_loss", "comms_restore",
    "incident_open", "incident_close", "alert_raise", "alert_ack",
    "resource_level", "vitals", "weather_spawn", "weather_move",
    "weather_clear", "detection", "system",
]


@dataclass
class SimEvent:
    id: int
    tick: int
    simTime: int
    type: str
    severity: str
    entityId: str
    payload: dict[str, Any]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "tick": self.tick,
            "simTime": self.simTime,
            "type": self.type,
            "severity": self.severity,
            "entityId": self.entityId,
            "payload": self.payload,
        }


@dataclass
class Unit:
    id: str
    callsign: str
    kind: str  # patrol | uav | convoy | depot
    lat: float
    lon: float
    heading: float
    speedKph: float
    status: str  # active | slowed | halted | stale
    fuel: float
    battery: float
    lastSeenTick: int
    sector: str
    route: list[tuple[float, float]]

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class Depot:
    id: str
    name: str
    lat: float
    lon: float
    stock: dict[str, float]
    capacity: dict[str, float]

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class Person:
    id: str
    name: str
    rank: str
    unitId: str
    heartRate: float
    fatigue: float
    history: list[float] = field(default_factory=list)

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class WeatherCell:
    id: str
    lat: float
    lon: float
    radiusM: float
    intensity: float
    kind: str

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class Zone:
    id: str
    name: str
    kind: str  # patrol | restricted | threat
    points: list[tuple[float, float]]

    def to_dict(self) -> dict:
        return self.__dict__.copy()
