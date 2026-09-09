"""SimSession — wraps SimEngine in an async loop and streams events over WebSocket.

One session per connected client (or per run, if multiple clients share one).
The loop ticks at ~120ms (speed=1) matching the browser engine interval.
"""

import asyncio
import json
from fastapi import WebSocket, WebSocketDisconnect
from .engine import SimEngine


class SimSession:
    def __init__(self, seed: int, scenario_id: str, speed: float = 1.0) -> None:
        self.engine = SimEngine()
        self.seed = seed
        self.scenario_id = scenario_id
        self.speed = speed
        self._clients: list[WebSocket] = []
        self._paused = False
        self._stopped = False
        self._task: asyncio.Task | None = None
        self._log: list[dict] = []  # full event log for run persistence

    # ------------------------------------------------------------------
    async def start(self) -> None:
        """Initialise the engine and begin the tick loop."""
        init_events = self.engine.start(self.seed, self.scenario_id)
        for ev in init_events:
            self._log.append(ev.to_dict())
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
                    self._log.append(ev.to_dict())
                await self._broadcast(events)

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
            self._log.append(ev.to_dict())
        await self._broadcast(events)

    # ------------------------------------------------------------------
    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.append(ws)
        # Send the full log so late joiners see the current world state.
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
