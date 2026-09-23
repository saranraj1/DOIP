"""Test Headless What-If Runner and Monte Carlo Ensembles."""

import sys
from pathlib import Path
import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.whatif import run_branch, _compute_tick_risk_series


def test_whatif_deterministic_branch():
    """Deterministic branch run produces valid event logs and risk series."""
    actions = [
        {"tick": 10, "type": "weather_spawn", "severity": "medium", "payload": {"intensity": 0.8}},
        {"tick": 20, "type": "incident_open", "severity": "high", "payload": {"kind": "hostile_contact"}},
    ]
    res = run_branch(seed=42, scenario_id="SC-1", actions=actions, ticks=30, runs=1)

    assert res.seed == 42
    assert res.scenario_id == "SC-1"
    assert res.ticks == 30
    assert len(res.baseline_events) > 0
    assert len(res.branch_events) > 0
    assert len(res.baseline_risk) == 31
    assert len(res.branch_risk) == 31
    assert "units" in res.trajectories["baseline"]
    assert "tracks" in res.trajectories["baseline"]
    assert "weatherCells" in res.spatial_annotations["branch"]


def test_whatif_monte_carlo_ensembles():
    """Monte Carlo ensemble returns P10, P50, and P90 risk percentile ribbons."""
    actions = [
        {"tick": 5, "type": "weather_spawn", "severity": "high", "payload": {"intensity": 0.9}},
    ]
    res = run_branch(seed=100, scenario_id="SC-1", actions=actions, ticks=30, runs=5)

    assert res.monte_carlo_runs == 5
    assert res.p10_risk is not None and len(res.p10_risk) == 31
    assert res.p50_risk is not None and len(res.p50_risk) == 31
    assert res.p90_risk is not None and len(res.p90_risk) == 31

    # Verify P10 <= P50 <= P90 for all ticks
    for t in range(len(res.p10_risk)):
        assert res.p10_risk[t] <= res.p50_risk[t] <= res.p90_risk[t]
