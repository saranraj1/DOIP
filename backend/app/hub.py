"""War-room WebSocket hub (Ch18 S14 / Ch15).

Holds the shared task board in memory and relays task operations between
connected clients. New clients get a snapshot; operations are broadcast to
everyone except the sender (the sender already applied the change locally —
echoing an "advance" back would double-advance it).

MVP limits: in-memory only (tasks reset on restart), no per-sector
server-side filtering yet.
"""

from fastapi import WebSocket

NEXT_STATUS = {"open": "doing", "doing": "done", "done": "open"}


class WarRoomHub:
    def __init__(self) -> None:
        self.clients: list[WebSocket] = []
        self.tasks: list[dict] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.append(ws)
        await ws.send_json({"type": "snapshot", "tasks": self.tasks})

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.clients:
            self.clients.remove(ws)

    async def handle(self, ws: WebSocket, data: dict) -> None:
        kind = data.get("type")
        if kind == "add" and isinstance(data.get("task"), dict):
            task = data["task"]
            if not any(t.get("id") == task.get("id") for t in self.tasks):
                self.tasks.append(task)
        elif kind == "advance":
            for task in self.tasks:
                if task.get("id") == data.get("id"):
                    task["status"] = NEXT_STATUS.get(task.get("status", "open"), "open")
        else:
            return  # unknown frame — drop silently
        await self.broadcast(data, exclude=ws)

    async def broadcast(self, data: dict, exclude: WebSocket | None = None) -> None:
        for client in list(self.clients):
            if client is exclude:
                continue
            try:
                await client.send_json(data)
            except Exception:
                self.disconnect(client)


hub = WarRoomHub()
