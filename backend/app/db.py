"""SQLite persistence for the DOIP MVP backend.

MVP choice: SQLite (stdlib, zero infra) instead of PostgreSQL+PostGIS. The
schema is deliberately boring — runs are stored with their full event log as
JSON, which is exactly what the frontend's RunRecord carries. Swap this module
for a Postgres implementation in Phase 2 without touching main.py routes.
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


def init() -> None:
    with _lock, _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS runs (
              id TEXT PRIMARY KEY,
              seed INTEGER NOT NULL,
              scenario_id TEXT NOT NULL,
              ticks INTEGER NOT NULL,
              events INTEGER NOT NULL,
              log TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS audit (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              actor TEXT NOT NULL,
              action TEXT NOT NULL,
              detail TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )


def save_run(run: dict) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO runs (id, seed, scenario_id, ticks, events, log) VALUES (?,?,?,?,?,?)",
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
        for r in reversed(rows)  # oldest-first, matching the frontend run list
    ]


def add_audit(actor: str, action: str, detail: str = "") -> None:
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO audit (actor, action, detail) VALUES (?,?,?)",
            (actor, action, detail),
        )


def list_audit(limit: int = 100) -> list[dict]:
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]
