"""DOIP MVP Backend — FastAPI v0.5.0.

Endpoints:
  /health                           liveness probe
  /auth/login                       demo HMAC tokens per role
  /scenarios                        built-in scenario catalogue
  /scenarios/custom GET/POST/DELETE author-created scenarios (P2-1)
  /scenarios/validate POST          DSL validation gate (P2-1)
  /runs   POST/GET                  persist + list recorded runs (SQLite)
  /runs/{id}/report GET             After-Action Report (AAR) plain-text (P2-4)
  /audit  GET                       append-only audit trail — paginated, admin only
  /admin/users GET/POST/DELETE      user roster — now DB-backed (P2-5)
  /sitrep POST                      LLM-enhanced sitrep (Ollama / rule-based fallback)
  /vision/adjudicate POST           batch-adjudicate detection events
  /vision/frames GET                latest synthetic surveillance frames (PNG base64)
  /whatif POST                      headless 60-tick branch run — result persisted
  /whatif/history GET               paginated list of past what-if results
  WS /ws/sim/{run_id}               live event stream — requires ?token= JWT
  WS /ws/warroom                    shared task-board hub — requires ?token= JWT

Run:  uvicorn app.main:app --reload --port 8000  (from backend/)
"""

import asyncio
import base64
from pathlib import Path
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
from . import aar as aar_mod
from . import dsl_parser
from . import rag as rag_mod

app = FastAPI(title="DOIP Command Center Backend", version="0.6.0")

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
    db.seed_users()   # P2-5: populate demo roster if users table is empty


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


def require_admin(user: dict = Depends(current_user)) -> dict:
    """Convenience dependency — short-circuits with 403 for non-admin callers."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def _ws_user(ws: WebSocket) -> dict | None:
    """Extract and verify the JWT from the ?token= query param on a WebSocket.

    Returns the decoded user dict on success, None on failure.
    The caller must close the socket when None is returned.
    """
    token = dict(ws.query_params).get("token", "")
    return auth.verify(token) if token else None


# ============================================================
# Core endpoints
# ============================================================
@app.get("/health")
def health() -> dict:
    active = list(_sessions.keys())
    return {"ok": True, "service": "doip-backend", "version": "0.5.0",
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


@app.get("/runs/{run_id}/report")
def run_aar(run_id: str, user: dict = Depends(current_user)) -> dict:
    """Generate a plain-text After-Action Report for a finished run (P2-4)."""
    runs = db.list_runs(limit=100)
    run = next((r for r in runs if r["id"] == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    world = db.load_world_snapshot(run_id)
    report = aar_mod.generate(run_id, run["log"], world)
    db.add_audit(user.get("name", "?"), "aar_download", run_id)
    return {"runId": run_id, "report": report}


# ============================================================
# Audit log  —  paginated  (P0-4)
# ============================================================
@app.get("/audit")
def list_audit(
    page: int = 1,
    per_page: int = 50,
    user: dict = Depends(require_admin),
) -> dict:
    """Return a paginated slice of the audit log.

    Query params:
        page     — 1-based page index (default: 1)
        per_page — rows per page, capped at 200 (default: 50)
    """
    per_page = min(per_page, 200)
    rows, total = db.list_audit_page(page=page, per_page=per_page)
    return {
        "audit": rows,
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": max(1, -(-total // per_page)),  # ceiling division
    }


# ============================================================
# Admin — user management  (P2-5: now DB-backed)
# ============================================================
class UserBody(BaseModel):
    name: str
    role: str
    unit: str = "Unassigned"


@app.get("/admin/users")
def list_users_endpoint(_admin: dict = Depends(require_admin)) -> dict:
    return {"users": db.list_users()}


@app.post("/admin/users", status_code=201)
def create_user(body: UserBody, admin: dict = Depends(require_admin)) -> dict:
    if body.role not in auth.ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown role: {body.role}")
    existing = db.list_users()
    if any(u["name"] == body.name for u in existing):
        raise HTTPException(status_code=409, detail="User already exists")
    entry = db.add_user(body.name, body.role, body.unit)
    db.add_audit(admin.get("name", "?"), "user_create", f"{body.name}:{body.role}")
    return {"ok": True, "user": entry}


@app.delete("/admin/users/{name}")
def delete_user(name: str, admin: dict = Depends(require_admin)) -> dict:
    if not db.remove_user(name):
        raise HTTPException(status_code=404, detail="User not found")
    db.add_audit(admin.get("name", "?"), "user_delete", name)
    return {"ok": True}


# ============================================================
# Custom Scenario CRUD + DSL validation gate  (P2-1)
# ============================================================

# Whitelisted DSL verbs — AGENTS.md §Ch13: never extend without human approval
_DSL_WHITELIST = {"spawn_weather", "create_incident", "raise_alert", "modify_speed"}


class ScenarioActionBody(BaseModel):
    id: int
    verb: str
    target: str
    magnitude: float   # 0–100
    tick: int = 0      # inject at this tick (0 = start)
    rationale: str = ""


class CustomScenarioBody(BaseModel):
    scenarioId: str
    name: str
    description: str = ""
    config: dict[str, Any] = {}
    actions: list[ScenarioActionBody] = []
    status: str = "draft"   # draft | approved


def _validate_actions(actions: list[ScenarioActionBody]) -> list[dict]:
    """Validate each action against the DSL whitelist. Returns per-action results."""
    results = []
    for a in actions:
        ok = a.verb in _DSL_WHITELIST
        results.append({
            "id": a.id,
            "verb": a.verb,
            "valid": ok,
            "error": None if ok else f"Verb '{a.verb}' is not in the approved whitelist.",
        })
    return results


@app.get("/scenarios/custom")
def list_custom_scenarios(user: dict = Depends(current_user)) -> dict:
    return {"scenarios": db.list_custom_scenarios()}


@app.post("/scenarios/custom", status_code=201)
def save_custom_scenario(
    body: CustomScenarioBody,
    user: dict = Depends(current_user),
) -> dict:
    """Save or update a custom scenario. Planner or admin only."""
    if user.get("role") not in ("admin", "planner"):
        raise HTTPException(status_code=403, detail="Planner role required")
    # Run validation — reject if any action fails
    results = _validate_actions(body.actions)
    if any(not r["valid"] for r in results):
        raise HTTPException(
            status_code=422,
            detail={"message": "DSL validation failed", "results": results},
        )
    saved = db.save_custom_scenario(
        scenario_id=body.scenarioId,
        name=body.name,
        description=body.description,
        config=body.config,
        actions=[a.model_dump() for a in body.actions],
        status=body.status,
        author=user.get("name", "?"),
    )
    db.add_audit(user.get("name", "?"), "scenario_save", body.scenarioId)
    return {"ok": True, "scenario": saved}


@app.delete("/scenarios/custom/{scenario_id}")
def delete_custom_scenario(
    scenario_id: str,
    user: dict = Depends(current_user),
) -> dict:
    if user.get("role") not in ("admin", "planner"):
        raise HTTPException(status_code=403, detail="Planner role required")
    if not db.delete_custom_scenario(scenario_id):
        raise HTTPException(status_code=404, detail="Scenario not found")
    db.add_audit(user.get("name", "?"), "scenario_delete", scenario_id)
    return {"ok": True}


@app.post("/scenarios/validate")
def validate_scenario(
    body: CustomScenarioBody,
    user: dict = Depends(current_user),
) -> dict:
    """Dry-run DSL validation without saving. Returns per-action pass/fail."""
    if user.get("role") not in ("admin", "planner"):
        raise HTTPException(status_code=403, detail="Planner role required")
    results = _validate_actions(body.actions)
    valid = all(r["valid"] for r in results)
    return {"valid": valid, "results": results}


# ============================================================
# Canonical Scenario YAML library (Phase 3)
# ============================================================
@app.get("/scenarios/yaml")
def list_yaml_scenarios(user: dict = Depends(current_user)) -> dict:
    scenarios_dir = Path(__file__).resolve().parent.parent.parent / "scenarios"
    out = []
    if scenarios_dir.exists():
        for f in sorted(scenarios_dir.glob("*.yaml")):
            try:
                sc = dsl_parser.load_yaml_scenario(f)
                out.append({
                    "file": f.name,
                    "id": sc["id"],
                    "name": sc["name"],
                    "duration_minutes": sc["duration_minutes"],
                    "seed": sc["seed"],
                    "entity_count": sc["entity_count"],
                    "timeline_events": len(sc.get("timeline", [])),
                    "rules_count": len(sc.get("rules", [])),
                })
            except Exception:
                continue
    return {"scenarios": out}


# ============================================================
# Doctrine RAG & Grounding Verifier (Phase 3)
# ============================================================
class RagQueryBody(BaseModel):
    query: str
    recentEvents: list[dict[str, Any]] = []


@app.post("/rag/query")
def rag_query_endpoint(body: RagQueryBody, user: dict = Depends(current_user)) -> dict:
    """Execute grounded RAG query across doctrine corpus and active sim events."""
    db.add_audit(user.get("name", "?"), "rag_query", body.query[:80])
    return rag_mod.query_rag(body.query, recent_events=body.recentEvents)


@app.get("/corpus/docs")
def list_corpus_docs(user: dict = Depends(current_user)) -> dict:
    """List all 15 doctrine documents across POL, REF, and SOP categories."""
    docs = [
        {
            "id": d.doc_id,
            "category": d.category,
            "title": d.title,
            "tags": d.tags,
            "version": d.version,
        }
        for d in sorted(rag_mod.corpus_index.docs.values(), key=lambda x: x.doc_id)
    ]
    return {"docs": docs, "total": len(docs)}


@app.get("/corpus/docs/{doc_id}")
def get_corpus_doc(doc_id: str, user: dict = Depends(current_user)) -> dict:
    """Get full document content and section breakdown by document ID."""
    doc = rag_mod.corpus_index.docs.get(doc_id.upper())
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in corpus")
    return {
        "id": doc.doc_id,
        "category": doc.category,
        "title": doc.title,
        "tags": doc.tags,
        "version": doc.version,
        "content": doc.content,
        "sections": [{"heading": h, "text": t} for h, t in doc.sections],
    }


# ============================================================
# Sitrep  (P1-1: now async, uses LLM when Ollama is available)
# ============================================================
class SitrepBody(BaseModel):
    world: dict[str, Any]
    events: list[dict[str, Any]]


@app.post("/sitrep")
async def generate_sitrep(body: SitrepBody,
                          user: dict = Depends(current_user)) -> dict:
    """Generate a situation report from the world snapshot + recent events.

    Attempts LLM enhancement via Ollama (llama3.2). Falls back to deterministic
    rule-based text if Ollama is unreachable or times out.
    """
    sections = await sitrep_mod.generate_async(body.world, body.events)
    return {"sections": sections, "generatedAtTick": body.world.get("tick", 0)}


# ============================================================
# Vision adjudication + frames endpoint  (P1-2)
# ============================================================
class VisionBody(BaseModel):
    detections: list[dict[str, Any]]
    minConfidence: float = 0.50
    autoAcceptAbove: float | None = None


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


@app.get("/vision/status")
def vision_status(user: dict = Depends(current_user)) -> dict:
    """Return YOLOv8n neural core status, loaded weights, and class definitions."""
    return vision_mod.get_model_status()


@app.get("/vision/samples")
def vision_samples(user: dict = Depends(current_user)) -> dict:
    """Return pre-loaded tactical surveillance frames for 1-click YOLO verification."""
    samples = vision_mod.get_tactical_samples()
    return {"samples": samples, "count": len(samples)}


class InferBody(BaseModel):
    image_b64: str
    unitId: str = "CAM-01"
    tick: int = 0
    confThreshold: float = 0.25


@app.post("/vision/infer")
def run_vision_inference(body: InferBody, user: dict = Depends(current_user)) -> dict:
    """Execute real-time YOLOv8n inference on a base64-encoded image."""
    try:
        raw_b64 = body.image_b64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        img_bytes = base64.b64decode(raw_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image data: {exc}")

    res = vision_mod.infer_frame(
        img_bytes,
        unit_id=body.unitId,
        tick=body.tick,
        conf_threshold=body.confThreshold,
    )
    db.add_audit(
        user.get("name", "?"),
        "vision_inference",
        f"unit={body.unitId} detected={res.get('count', 0)} latency={res.get('infer_ms', 0)}ms",
    )
    return res


@app.get("/vision/frames")
def vision_frames(
    n: int = 6,
    tick: int = 0,
    user: dict = Depends(current_user),
) -> dict:
    """Return `n` synthetic surveillance frames as base64-encoded PNG.

    In production, replace the generator with a real camera feed adapter.
    The frame schema matches the VisionPanel contract in the frontend.

    Query params:
        n    — number of frames (1–12, default 6)
        tick — simulation tick used for deterministic frame generation
    """
    frames = vision_mod.generate_frames(n=min(n, 12), tick=tick)
    return {"frames": frames, "count": len(frames)}


# ============================================================
# What-If headless runner + history  (P1-3)
# ============================================================
class WhatIfBody(BaseModel):
    seed: int
    scenarioId: str
    ticks: int = 60
    actions: list[dict[str, Any]] = []
    runs: int = 1


@app.post("/whatif")
def run_whatif(body: WhatIfBody,
              user: dict = Depends(current_user)) -> dict:
    """Run a headless branch simulation and persist the result."""
    if user.get("role") not in ("admin", "planner", "operator"):
        raise HTTPException(status_code=403, detail="Operator, planner, or admin role required")
    result = whatif_mod.run_branch(
        seed=body.seed,
        scenario_id=body.scenarioId,
        actions=body.actions,
        ticks=body.ticks,
        runs=max(1, min(20, body.runs)),
    )
    # Persist result to DB  (P1-3)
    whatif_id = db.save_whatif_result(
        seed=result.seed,
        scenario_id=result.scenario_id,
        ticks=result.ticks,
        actions=body.actions,
        deltas=result.deltas,
    )
    db.add_audit(user.get("name", "?"), "whatif_run",
                 f"id={whatif_id} seed={body.seed} sc={body.scenarioId} "
                 f"ticks={body.ticks} actions={len(body.actions)} runs={result.monte_carlo_runs}")
    return {
        "id": whatif_id,
        "seed": result.seed,
        "scenarioId": result.scenario_id,
        "ticks": result.ticks,
        "deltas": result.deltas,
        "baselineEvents": result.baseline_events,
        "branchEvents": result.branch_events,
        "baselineRisk": result.baseline_risk,
        "branchRisk": result.branch_risk,
        "p10Risk": result.p10_risk,
        "p50Risk": result.p50_risk,
        "p90Risk": result.p90_risk,
        "trajectories": result.trajectories,
        "spatialAnnotations": result.spatial_annotations,
        "monteCarloRuns": result.monte_carlo_runs,
    }


@app.get("/whatif/history")
def whatif_history(
    limit: int = 20,
    user: dict = Depends(current_user),
) -> dict:
    """Return the most-recent `limit` persisted what-if results (newest-first)."""
    if user.get("role") not in ("admin", "planner", "operator"):
        raise HTTPException(status_code=403, detail="Operational role required")
    return {"results": db.list_whatif_results(limit=min(limit, 50))}


class CorpusQueryBody(BaseModel):
    query: str
    top_k: int = 5


@app.post("/corpus/query")
def corpus_query_endpoint(body: CorpusQueryBody) -> dict:
    """Semantic/token-scored search over the 15 canonical defense doctrine and SOP documents."""
    results = rag_mod.corpus_index.search(body.query, top_k=body.top_k)
    return {"results": results, "count": len(results)}




# ============================================================
# Live sim WebSocket  —  WS /ws/sim/{run_id}
# ============================================================
@app.websocket("/ws/sim/{run_id}")
async def sim_ws(ws: WebSocket, run_id: str) -> None:
    """Stream live sim events to the browser.

    Requires a valid JWT in the ?token= query param.
    Rejects unauthenticated connections with WS close code 4008 before accepting.

    Query params:
        token                    required — HMAC-signed JWT
        seed, scenarioId, speed  used only when starting a new session
    """
    if not _ws_user(ws):
        await ws.close(code=4008, reason="Missing or invalid token")
        return

    params = dict(ws.query_params)
    async with _sessions_lock:
        if run_id not in _sessions:
            seed = int(params.get("seed", 20260101))
            sc_id = params.get("scenarioId", "SC-1")
            speed = float(params.get("speed", 1.0))
            # Pass run_id so the session can key world snapshots in DB  (P1-4)
            session = SimSession(seed, sc_id, speed, run_id=run_id)
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
    """Shared collaborative task board.

    Requires a valid JWT in the ?token= query param.
    Rejects unauthenticated connections with WS close code 4008 before accepting.
    """
    if not _ws_user(ws):
        await ws.close(code=4008, reason="Missing or invalid token")
        return

    await hub.connect(ws)
    try:
        while True:
            data = await ws.receive_json()
            await hub.handle(ws, data)
    except WebSocketDisconnect:
        hub.disconnect(ws)
