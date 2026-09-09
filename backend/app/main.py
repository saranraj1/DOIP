"""DOIP MVP Backend — FastAPI (40-50% phase).

What this backend owns:
  /health                    liveness probe
  /auth/login                demo HMAC tokens per role
  /scenarios                 scenario catalogue
  /runs   POST/GET           persist + list recorded runs (SQLite)
  /audit  GET                append-only audit trail (admin)
  /sitrep POST               rule-based sitrep from world snapshot + events
  /vision/adjudicate POST    batch-adjudicate detection events
  /whatif POST               headless 60-tick branch run (blocking, fast)
  WS /ws/sim/{run_id}        live event stream from server-side engine
  WS /ws/warroom             shared task-board hub

Run:  uvicorn app.main:app --reload --port 8000  (from backend/)
"""

import asyncio
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import auth, db
from .hub import hub
from .scenarios import SCENARIOS
from .session import SimSession
from . import sitrep as sitrep_mod
from . import vision as vision_mod
from . import whatif as whatif_mod

app = FastAPI(title="DOIP MVP Backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- active sim sessions keyed by run_id ---
_sessions: dict[str, SimSession] = {}
_sessions_lock = asyncio.Lock()


@app.on_event("startup")
def _startup() -> None:
    db.init()


# ============================================================
# Auth helpers
# ============================================================
class LoginBody(BaseModel):
    role: str
    userName: str


def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    user = auth.verify(authorization.removeprefix("Bearer "))
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user


# ============================================================
# Core endpoints
# ============================================================
@app.get("/health")
def health() -> dict:
    active = list(_sessions.keys())
    return {"ok": True, "service": "doip-backend", "version": "0.2.0",
            "active_sessions": active}


@app.post("/auth/login")
def login(body: LoginBody) -> dict:
    if body.role not in auth.ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown role: {body.role}")
    db.add_audit(body.userName or "unknown", "login", body.role)
    return {"token": auth.issue(body.role, body.userName)}


@app.get("/scenarios")
def scenarios_list() -> dict:
    return {"scenarios": SCENARIOS}


# ============================================================
# Run persistence
# ============================================================
class RunBody(BaseModel):
    id: str
    seed: int
    scenarioId: str
    ticks: int
    events: int
    log: list[dict[str, Any]]


@app.post("/runs")
def save_run(body: RunBody, user: dict = Depends(current_user)) -> dict:
    db.save_run(body.model_dump())
    db.add_audit(user.get("name", "unknown"), "run_saved", body.id)
    return {"ok": True}


@app.get("/runs")
def list_runs(user: dict = Depends(current_user)) -> dict:
    return {"runs": db.list_runs()}


@app.get("/audit")
def list_audit(user: dict = Depends(current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"audit": db.list_audit()}


# ============================================================
# Sitrep
# ============================================================
class SitrepBody(BaseModel):
    world: dict[str, Any]
    events: list[dict[str, Any]]


@app.post("/sitrep")
def generate_sitrep(body: SitrepBody,
                    user: dict = Depends(current_user)) -> dict:
    sections = sitrep_mod.generate(body.world, body.events)
    return {"sections": sections, "generatedAtTick": body.world.get("tick", 0)}


# ============================================================
# Vision adjudication
# ============================================================
class VisionBody(BaseModel):
    detections: list[dict[str, Any]]
    minConfidence: float = 0.50
    autoAcceptAbove: float | None = None  # e.g. 0.80 for "accept all >= 80%"


@app.post("/vision/adjudicate")
def adjudicate_vision(body: VisionBody,
                      user: dict = Depends(current_user)) -> dict:
    result = vision_mod.adjudicate(
        body.detections,
        min_confidence=body.minConfidence,
        auto_accept_above=body.autoAcceptAbove,
    )
    db.add_audit(user.get("name", "?"), "vision_adjudicate",
                 f"confirmed={len(result['confirmed'])} pending={len(result['pending'])}")
    return result


# ============================================================
# What-If headless runner
# ============================================================
class WhatIfBody(BaseModel):
    seed: int
    scenarioId: str
    ticks: int = 60
    actions: list[dict[str, Any]] = []


@app.post("/whatif")
def run_whatif(body: WhatIfBody,
              user: dict = Depends(current_user)) -> dict:
    if user.get("role") not in ("admin", "planner"):
        raise HTTPException(status_code=403, detail="Planner role required")
    result = whatif_mod.run_branch(
        seed=body.seed,
        scenario_id=body.scenarioId,
        actions=body.actions,
        ticks=body.ticks,
    )
    db.add_audit(user.get("name", "?"), "whatif_run",
                 f"seed={body.seed} sc={body.scenarioId} ticks={body.ticks} "
                 f"actions={len(body.actions)}")
    return {
        "seed": result.seed,
        "scenarioId": result.scenario_id,
        "ticks": result.ticks,
        "deltas": result.deltas,
        "baselineEvents": result.baseline_events,
        "branchEvents": result.branch_events,
    }


# ============================================================
# Live sim WebSocket  —  WS /ws/sim/{run_id}
# ============================================================
@app.websocket("/ws/sim/{run_id}")
async def sim_ws(ws: WebSocket, run_id: str) -> None:
    """Stream live sim events to the browser.

    First connection for a run_id starts the engine; subsequent connections
    receive the full replay log so they see the current world state.

    Query params (on connect):
        seed, scenarioId, speed  (only used when starting a new session)
    """
    params = dict(ws.query_params)
    async with _sessions_lock:
        if run_id not in _sessions:
            seed = int(params.get("seed", 20260101))
            sc_id = params.get("scenarioId", "SC-1")
            speed = float(params.get("speed", 1.0))
            session = SimSession(seed, sc_id, speed)
            _sessions[run_id] = session
            await session.start()
        session = _sessions[run_id]

    await session.handle_client(ws)

    # Clean up idle sessions (no clients, stopped)
    async with _sessions_lock:
        if run_id in _sessions and not _sessions[run_id]._clients:
            if _sessions[run_id]._stopped:
                del _sessions[run_id]


# ============================================================
# War-room task board WebSocket  —  WS /ws/warroom
# ============================================================
@app.websocket("/ws/warroom")
async def warroom(ws: WebSocket) -> None:
    await hub.connect(ws)
    try:
        while True:
            data = await ws.receive_json()
            await hub.handle(ws, data)
    except WebSocketDisconnect:
        hub.disconnect(ws)
