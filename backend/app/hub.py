"""War-room WebSocket hub — with persistent message history (P1-5).

On connect: new clients receive a replay of the last 200 messages from DB,
then live messages flow normally.

On add:     task is appended in-memory AND persisted to DB.
On advance: status is updated in-memory AND the stored message is updated.
On delete:  task is removed in-memory AND deleted from DB.

Invariant: in-memory `self.tasks` is the authoritative hot list; DB is the
cold store for replay on reconnect / server restart.
"""

from __future__ import annotations

import json
from fastapi import WebSocket

NEXT_STATUS = {"open": "doing", "doing": "done", "done": "open"}
_HISTORY_REPLAY_LIMIT = 200


class WarRoomHub:
    def __init__(self) -> None:
        self.clients: list[WebSocket] = []
        self.tasks: list[dict] = []
        self._db_loaded = False   # load from DB once on first connection

    # ------------------------------------------------------------------
    def _ensure_loaded(self) -> None:
        """Load task history from DB on the first ever connection."""
        if self._db_loaded:
            return
        self._db_loaded = True
        try:
            from . import db as db_mod
            rows = db_mod.list_warroom_messages(_HISTORY_REPLAY_LIMIT)
            # Rebuild task list from persisted "add" messages (latest wins on id clash)
            task_map: dict[str, dict] = {}
            for row in rows:
                if row["type"] == "add":
                    task = row["payload"].get("task", {})
                    if task.get("id"):
                        task_map[task["id"]] = task
                elif row["type"] == "advance" and (tid := row["payload"].get("id")):
                    if tid in task_map:
                        ns = NEXT_STATUS.get(task_map[tid].get("status", "open"), "open")
                        task_map[tid]["status"] = ns
                elif row["type"] == "delete" and (tid := row["payload"].get("id")):
                    task_map.pop(tid, None)
            self.tasks = list(task_map.values())
        except Exception:
            pass   # DB unavailable — start with empty board

    # ------------------------------------------------------------------
    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._ensure_loaded()
        self.clients.append(ws)
        # Send current task snapshot to the new joiner
        await ws.send_json({"type": "snapshot", "tasks": self.tasks})

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.clients:
            self.clients.remove(ws)

    # ------------------------------------------------------------------
    async def handle(self, ws: WebSocket, data: dict) -> None:
        kind = data.get("type")

        if kind == "add" and isinstance(data.get("task"), dict):
            task = data["task"]
            if not any(t.get("id") == task.get("id") for t in self.tasks):
                self.tasks.append(task)
                _persist("add", {"task": task})

        elif kind == "advance" and (tid := data.get("id")):
            for task in self.tasks:
                if task.get("id") == tid:
                    task["status"] = NEXT_STATUS.get(task.get("status", "open"), "open")
                    _persist("advance", {"id": tid, "status": task["status"]})
                    break

        elif kind == "delete" and (tid := data.get("id")):
            self.tasks = [t for t in self.tasks if t.get("id") != tid]
            _persist("delete", {"id": tid})

        else:
            return   # unknown frame — drop silently

        await self.broadcast(data, exclude=ws)

    # ------------------------------------------------------------------
    async def broadcast(self, data: dict, exclude: WebSocket | None = None) -> None:
        for client in list(self.clients):
            if client is exclude:
                continue
            try:
                await client.send_json(data)
            except Exception:
                self.disconnect(client)


# ---------------------------------------------------------------------------
# Persistence helper — decoupled so tests can monkeypatch
# ---------------------------------------------------------------------------
def _persist(type_: str, payload: dict) -> None:
    try:
        from . import db as db_mod
        db_mod.save_warroom_message(type_, payload)
    except Exception:
        pass   # fail-soft: if DB is unavailable, live state still works


hub = WarRoomHub()
