"""Test Simulation Engine Determinism."""

import json
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.engine import SimEngine


def _run_sim(seed: int, scenario_id: str, ticks: int = 50) -> list[dict]:
    engine = SimEngine()
    events = engine.start(seed=seed, scenario_id=scenario_id)
    for _ in range(ticks):
        events.extend(engine.step())
    return [e.to_dict() for e in events]


def test_sc1_determinism_identical_runs():
    """Identical scenario + seed must produce identical event sequences."""
    run1 = _run_sim(seed=42, scenario_id="SC-1", ticks=60)
    run2 = _run_sim(seed=42, scenario_id="SC-1", ticks=60)

    assert len(run1) == len(run2)
    assert json.dumps(run1, sort_keys=True) == json.dumps(run2, sort_keys=True)


def test_sc2_determinism_identical_runs():
    """SC-2 run twice with identical seed 8841 produces identical events."""
    run1 = _run_sim(seed=8841, scenario_id="SC-2", ticks=80)
    run2 = _run_sim(seed=8841, scenario_id="SC-2", ticks=80)

    assert len(run1) == len(run2)
    assert json.dumps(run1, sort_keys=True) == json.dumps(run2, sort_keys=True)


def test_different_seeds_diverge():
    """Different seeds must produce diverging event sequences."""
    run1 = _run_sim(seed=1001, scenario_id="SC-1", ticks=30)
    run2 = _run_sim(seed=9999, scenario_id="SC-1", ticks=30)

    assert json.dumps(run1, sort_keys=True) != json.dumps(run2, sort_keys=True)
