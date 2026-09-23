"""SimSession — wraps SimEngine in an async loop and streams events over WebSocket.

P1-4: World snapshots are persisted to DB every SNAPSHOT_EVERY ticks so a
server restart can offer late-joiners the last known world state. The snapshot
is built from engine internals (units, depots, personnel, weather) + the
running reducer state maintained here.

One session per run_id; multiple clients may share one session via
`handle_client`. Late joiners receive the full in-memory event log so they can
replay to the current world without needing the DB snapshot.
"""

import asyncio
import json
from fastapi import WebSocket, WebSocketDisconnect
from .engine import SimEngine
from . import db as db_mod

SNAPSHOT_EVERY = 10   # ticks between world_json upserts


class SimSession:
    def __init__(self, seed: int, scenario_id: str, speed: float = 1.0,
                 run_id: str | None = None) -> None:
        self.engine = SimEngine()
        self.seed = seed
        self.scenario_id = scenario_id
        self.speed = speed
        self.run_id = run_id   # set by main.py so we can key the DB snapshot
        self._clients: list[WebSocket] = []
        self._paused = False
        self._stopped = False
        self._task: asyncio.Task | None = None
        self._log: list[dict] = []    # full event log for run persistence

        # Lightweight world state maintained for snapshot serialisation.
        # Populated from world_init and updated incrementally.
        self._units: dict = {}
        self._depots: dict = {}
        self._personnel: dict = {}
        self._weather: dict = {}
        self._zones: list = []

    # ------------------------------------------------------------------
    async def start(self) -> None:
        """Initialise the engine and begin the tick loop."""
        init_events = self.engine.start(self.seed, self.scenario_id)
        for ev in init_events:
            d = ev.to_dict()
            self._log.append(d)
            self._apply(d)
        await self._broadcast(init_events)
        self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        while not self._stopped:
            interval = max(0.120, 1.0 / self.speed)
            await asyncio.sleep(interval)
            if self._paused or self._stopped:
                continue
            events = self.engine.step()
            if events:
                for ev in events:
                    d = ev.to_dict()
                    self._log.append(d)
                    self._apply(d)
                await self._broadcast(events)

            # Persist snapshot every SNAPSHOT_EVERY ticks
            if self.run_id and self.engine.tick % SNAPSHOT_EVERY == 0:
                world = self._world_snapshot()
                try:
                    db_mod.save_world_snapshot(self.run_id, world)
                except Exception:
                    pass   # fail-soft: live stream continues even if DB write fails

    # ------------------------------------------------------------------
    def _apply(self, ev: dict) -> None:
        """Incrementally update the lightweight world mirror from a single event."""
        t = ev.get("type")
        p = ev.get("payload", {})
        eid = ev.get("entityId", "")

        if t == "world_init":
            for u in p.get("units", []):
                self._units[u["id"]] = u
            for d in p.get("depots", []):
                self._depots[d["id"]] = d
            for prs in p.get("personnel", []):
                self._personnel[prs["id"]] = prs
            self._zones = p.get("zones", [])

        elif t == "unit_move":
            if eid in self._units:
                self._units[eid].update({
                    "lat": p.get("lat"), "lon": p.get("lon"),
                    "heading": p.get("heading"), "lastSeenTick": ev.get("tick", 0),
                })
        elif t == "unit_status":
            if eid in self._units:
                self._units[eid]["status"] = p.get("status")

        elif t == "resource_level":
            if eid in self._units:
                if "fuel" in p:
                    self._units[eid]["fuel"] = p["fuel"]
                if "battery" in p:
                    self._units[eid]["battery"] = p["battery"]
            if eid in self._depots and "stock" in p:
                self._depots[eid]["stock"] = p["stock"]

        elif t == "vitals":
            if eid in self._personnel:
                self._personnel[eid].update({
                    "heartRate": p.get("heartRate"),
                    "fatigue": p.get("fatigue"),
                })

        elif t in ("weather_spawn",):
            self._weather[eid] = p
        elif t == "weather_move":
            if eid in self._weather:
                self._weather[eid].update({"lat": p.get("lat"), "lon": p.get("lon"),
                                            "intensity": p.get("intensity")})
        elif t == "weather_clear":
            self._weather.pop(eid, None)

    def _world_snapshot(self) -> dict:
        """Return a serialisable world snapshot for DB persistence."""
        return {
            "seed": self.seed,
            "scenarioId": self.scenario_id,
            "tick": self.engine.tick,
            "simTime": self.engine.tick * 1000,
            "units": dict(self._units),
            "depots": dict(self._depots),
            "personnel": dict(self._personnel),
            "weather": dict(self._weather),
            "zones": self._zones,
        }

    # ------------------------------------------------------------------
    async def pause(self) -> None:
        self._paused = True
        ev = self.engine._make_event("system", "low", "system", {"status": "PAUSED"})
        await self._broadcast([ev])

    async def resume(self) -> None:
        self._paused = False
        ev = self.engine._make_event("system", "low", "system", {"status": "RUNNING"})
        await self._broadcast([ev])

    async def stop(self) -> None:
        self._stopped = True
        if self._task:
            self._task.cancel()
        ev = self.engine._make_event("system", "low", "system", {"status": "STOPPED"})
        await self._broadcast([ev])

    async def set_speed(self, speed: float) -> None:
        self.speed = max(0.25, min(16.0, speed))
        ev = self.engine._make_event("system", "low", "system", {"speed": self.speed})
        await self._broadcast([ev])

    async def inject(self, partial: dict) -> None:
        events = self.engine.inject(partial)
        for ev in events:
            d = ev.to_dict()
            self._log.append(d)
            self._apply(d)
        await self._broadcast(events)

    # ------------------------------------------------------------------
    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.append(ws)
        # Send the full in-memory log so late joiners see the current world state.
        if self._log:
            try:
                await ws.send_text(json.dumps({"type": "log_replay", "events": self._log}))
            except Exception:
                pass

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._clients:
            self._clients.remove(ws)

    async def _broadcast(self, events: list) -> None:
        if not events:
            return
        msg = json.dumps({"type": "events", "events": [e.to_dict() for e in events]})
        dead: list[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    # ------------------------------------------------------------------
    async def handle_client(self, ws: WebSocket) -> None:
        """Receive operator commands from a single client socket."""
        await self.connect(ws)
        try:
            while True:
                raw = await ws.receive_text()
                msg = json.loads(raw)
                cmd = msg.get("cmd")
                if cmd == "pause":
                    await self.pause()
                elif cmd == "resume":
                    await self.resume()
                elif cmd == "stop":
                    await self.stop()
                elif cmd == "speed":
                    await self.set_speed(float(msg.get("value", 1)))
                elif cmd == "inject":
                    await self.inject(msg.get("event", {}))
                # unknown commands ignored
        except WebSocketDisconnect:
            pass
        finally:
            self.disconnect(ws)
