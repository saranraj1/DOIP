"""SQLite persistence for the DOIP MVP backend (v2 — P1-3 + P1-4).

Tables:
  runs            — full event log per recorded run (with optional world snapshot)
  audit           — append-only audit trail
  whatif_results  — persisted what-if branch results (P1-3)
  warroom_messages — war-room chat/task history for replay on join (P1-5)

Swap this module for a Postgres implementation in Phase 2 without touching
main.py routes.
"""

import json
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "doip.db"
_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# Schema  (idempotent — safe to call on every startup)
# ---------------------------------------------------------------------------
def init() -> None:
    with _lock, _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS runs (
              id          TEXT PRIMARY KEY,
              seed        INTEGER NOT NULL,
              scenario_id TEXT NOT NULL,
              ticks       INTEGER NOT NULL,
              events      INTEGER NOT NULL,
              log         TEXT NOT NULL,
              world_json  TEXT,
              created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS audit (
              id         INTEGER PRIMARY KEY AUTOINCREMENT,
              actor      TEXT NOT NULL,
              action     TEXT NOT NULL,
              detail     TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS whatif_results (
              id              INTEGER PRIMARY KEY AUTOINCREMENT,
              seed            INTEGER NOT NULL,
              scenario_id     TEXT NOT NULL,
              ticks           INTEGER NOT NULL,
              actions_json    TEXT NOT NULL DEFAULT '[]',
              baseline_kpis   TEXT NOT NULL DEFAULT '{}',
              branch_kpis     TEXT NOT NULL DEFAULT '{}',
              deltas_json     TEXT NOT NULL DEFAULT '{}',
              created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS warroom_messages (
              id         INTEGER PRIMARY KEY AUTOINCREMENT,
              type       TEXT NOT NULL,
              payload    TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- P2-5: persistent user roster
            CREATE TABLE IF NOT EXISTS users (
              id         INTEGER PRIMARY KEY AUTOINCREMENT,
              name       TEXT NOT NULL UNIQUE,
              role       TEXT NOT NULL,
              unit       TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- P2-1: author-created scenario definitions
            CREATE TABLE IF NOT EXISTS custom_scenarios (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              scenario_id TEXT NOT NULL UNIQUE,
              name        TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '',
              config_json TEXT NOT NULL DEFAULT '{}',
              actions_json TEXT NOT NULL DEFAULT '[]',
              status      TEXT NOT NULL DEFAULT 'draft',
              author      TEXT NOT NULL DEFAULT '',
              created_at  TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )
        # Migrate: add world_json to older DBs that pre-date P1-4
        try:
            conn.execute("ALTER TABLE runs ADD COLUMN world_json TEXT")
        except sqlite3.OperationalError:
            pass  # column already exists


# ---------------------------------------------------------------------------
# Run persistence
# ---------------------------------------------------------------------------
def save_run(run: dict) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO runs (id, seed, scenario_id, ticks, events, log) "
            "VALUES (?,?,?,?,?,?)",
            (
                run["id"],
                run["seed"],
                run["scenarioId"],
                run["ticks"],
                run["events"],
                json.dumps(run["log"]),
            ),
        )


def list_runs(limit: int = 8) -> list[dict]:
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [
        {
            "id": r["id"],
            "seed": r["seed"],
            "scenarioId": r["scenario_id"],
            "ticks": r["ticks"],
            "events": r["events"],
            "log": json.loads(r["log"]),
        }
        for r in reversed(rows)   # oldest-first, matching the frontend run list
    ]


# ---------------------------------------------------------------------------
# World snapshot persistence  (P1-4)
# ---------------------------------------------------------------------------
def save_world_snapshot(run_id: str, world: dict) -> None:
    """Upsert the live world snapshot for an active run.

    Called every 10 ticks from SimSession._loop so the run can be resumed
    after a server restart. `run_id` maps to the `id` column in `runs`.
    The row is created if it doesn't yet exist (uses a placeholder log).
    """
    with _lock, _connect() as conn:
        # Ensure a stub row exists so the UPDATE doesn't silently no-op
        conn.execute(
            "INSERT OR IGNORE INTO runs "
            "(id, seed, scenario_id, ticks, events, log, world_json) "
            "VALUES (?,?,?,0,0,'[]',?)",
            (run_id, world.get("seed", 0), world.get("scenarioId", "SC-1"),
             json.dumps(world)),
        )
        conn.execute(
            "UPDATE runs SET world_json = ? WHERE id = ?",
            (json.dumps(world), run_id),
        )


def load_world_snapshot(run_id: str) -> dict | None:
    """Return the most recent world snapshot for `run_id`, or None."""
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT world_json FROM runs WHERE id = ?", (run_id,)
        ).fetchone()
    if row and row["world_json"]:
        try:
            return json.loads(row["world_json"])
        except (json.JSONDecodeError, TypeError):
            return None
    return None


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
def add_audit(actor: str, action: str, detail: str = "") -> None:
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO audit (actor, action, detail) VALUES (?,?,?)",
            (actor, action, detail),
        )


def list_audit(limit: int = 100) -> list[dict]:
    """Return the most-recent `limit` audit rows, newest-first (legacy helper)."""
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def list_audit_page(page: int = 1, per_page: int = 50) -> tuple[list[dict], int]:
    """Return a paginated slice of the audit log plus the total row count."""
    page = max(1, page)
    offset = (page - 1) * per_page
    with _lock, _connect() as conn:
        total: int = conn.execute("SELECT COUNT(*) FROM audit").fetchone()[0]
        rows = conn.execute(
            "SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?",
            (per_page, offset),
        ).fetchall()
    return [dict(r) for r in rows], total


# ---------------------------------------------------------------------------
# What-If result persistence  (P1-3)
# ---------------------------------------------------------------------------
def save_whatif_result(
    seed: int,
    scenario_id: str,
    ticks: int,
    actions: list,
    deltas: dict,
) -> int:
    """Persist a what-if result. Returns the new row id."""
    # Extract baseline/branch KPIs from deltas dict
    baseline_kpis = {k: v.get("baseline") for k, v in deltas.items()}
    branch_kpis   = {k: v.get("branch")   for k, v in deltas.items()}
    with _lock, _connect() as conn:
        cur = conn.execute(
            "INSERT INTO whatif_results "
            "(seed, scenario_id, ticks, actions_json, baseline_kpis, branch_kpis, deltas_json) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                seed, scenario_id, ticks,
                json.dumps(actions),
                json.dumps(baseline_kpis),
                json.dumps(branch_kpis),
                json.dumps(deltas),
            ),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_whatif_results(limit: int = 20) -> list[dict]:
    """Return the most-recent `limit` what-if results, newest-first."""
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT id, seed, scenario_id, ticks, actions_json, "
            "baseline_kpis, branch_kpis, deltas_json, created_at "
            "FROM whatif_results ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "seed": r["seed"],
            "scenarioId": r["scenario_id"],
            "ticks": r["ticks"],
            "actions": json.loads(r["actions_json"]),
            "baselineKpis": json.loads(r["baseline_kpis"]),
            "branchKpis": json.loads(r["branch_kpis"]),
            "deltas": json.loads(r["deltas_json"]),
            "createdAt": r["created_at"],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# War-room message persistence  (P1-5)
# ---------------------------------------------------------------------------
def save_warroom_message(type_: str, payload: dict) -> int:
    """Persist a war-room message. Returns the new row id."""
    with _lock, _connect() as conn:
        cur = conn.execute(
            "INSERT INTO warroom_messages (type, payload) VALUES (?,?)",
            (type_, json.dumps(payload)),
        )
        return cur.lastrowid  # type: ignore[return-value]


def list_warroom_messages(limit: int = 200) -> list[dict]:
    """Return the most-recent `limit` war-room messages, oldest-first."""
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT id, type, payload, created_at FROM warroom_messages "
            "ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "type": r["type"],
            "payload": json.loads(r["payload"]),
            "created_at": r["created_at"],
        }
        for r in reversed(rows)   # oldest-first for replay
    ]


def delete_warroom_message(msg_id: int) -> bool:
    """Remove a war-room message. Returns True if a row was deleted."""
    with _lock, _connect() as conn:
        cur = conn.execute("DELETE FROM warroom_messages WHERE id = ?", (msg_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# User roster persistence  (P2-5)
# ---------------------------------------------------------------------------
_SEED_USERS = [
    {"name": "Col. A. Verma",     "role": "admin",    "unit": "HQ"},
    {"name": "Maj. R. Sethi",     "role": "planner",  "unit": "Ops Cell"},
    {"name": "Sgt. P. Kulkarni",  "role": "operator", "unit": "Watch Floor"},
    {"name": "Obs. L. Fernandes", "role": "viewer",   "unit": "Evaluation"},
]


def seed_users() -> None:
    """Insert the demo roster if the users table is empty."""
    with _lock, _connect() as conn:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            conn.executemany(
                "INSERT OR IGNORE INTO users (name, role, unit) VALUES (?,?,?)",
                [(u["name"], u["role"], u["unit"]) for u in _SEED_USERS],
            )


def list_users() -> list[dict]:
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT name, role, unit FROM users ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]


def add_user(name: str, role: str, unit: str) -> dict:
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO users (name, role, unit) VALUES (?,?,?)",
            (name, role, unit),
        )
    return {"name": name, "role": role, "unit": unit}


def remove_user(name: str) -> bool:
    with _lock, _connect() as conn:
        cur = conn.execute("DELETE FROM users WHERE name = ?", (name,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Custom scenario store  (P2-1)
# ---------------------------------------------------------------------------
def list_custom_scenarios() -> list[dict]:
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT id, scenario_id, name, description, config_json, actions_json, "
            "status, author, created_at, updated_at "
            "FROM custom_scenarios ORDER BY id DESC"
        ).fetchall()
    return [
        {
            "id": r["id"],
            "scenarioId": r["scenario_id"],
            "name": r["name"],
            "description": r["description"],
            "config": json.loads(r["config_json"]),
            "actions": json.loads(r["actions_json"]),
            "status": r["status"],
            "author": r["author"],
            "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
        }
        for r in rows
    ]


def save_custom_scenario(
    scenario_id: str,
    name: str,
    description: str,
    config: dict,
    actions: list,
    status: str,
    author: str,
) -> dict:
    """Upsert a custom scenario. Returns the saved row."""
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO custom_scenarios
              (scenario_id, name, description, config_json, actions_json, status, author, updated_at)
            VALUES (?,?,?,?,?,?,?, datetime('now'))
            ON CONFLICT(scenario_id) DO UPDATE SET
              name        = excluded.name,
              description = excluded.description,
              config_json = excluded.config_json,
              actions_json= excluded.actions_json,
              status      = excluded.status,
              author      = excluded.author,
              updated_at  = excluded.updated_at
            """,
            (scenario_id, name, description,
             json.dumps(config), json.dumps(actions),
             status, author),
        )
    return {
        "scenarioId": scenario_id, "name": name,
        "description": description, "config": config,
        "actions": actions, "status": status, "author": author,
    }


def delete_custom_scenario(scenario_id: str) -> bool:
    with _lock, _connect() as conn:
        cur = conn.execute(
            "DELETE FROM custom_scenarios WHERE scenario_id = ?", (scenario_id,)
        )
        return cur.rowcount > 0
