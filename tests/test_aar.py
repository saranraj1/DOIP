"""Test After-Action Report (AAR) Generation."""

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.aar import generate_aar


def test_generate_aar_structure():
    """Verify generated AAR contains all standard report sections."""
    sample_run = {
        "id": "RUN-TEST-01",
        "scenario_id": "SC-2",
        "seed": 8841,
        "ticks": 120,
        "events": 45,
        "created_at": "2026-09-16T12:00:00",
    }
    sample_events = [
        {"tick": 1, "type": "world_init", "severity": "low", "entityId": "system", "payload": {}},
        {"tick": 15, "type": "incident_open", "severity": "high", "entityId": "INC-15", "payload": {"kind": "unauthorized-entry"}},
        {"tick": 30, "type": "alert_raise", "severity": "high", "entityId": "AL-30", "payload": {"message": "Breach detected"}},
        {"tick": 100, "type": "system", "severity": "low", "entityId": "system", "payload": {"status": "STOPPED"}},
    ]

    report = generate_aar("RUN-TEST-01", sample_events, sample_run)
    assert report, "AAR report was empty"
    assert "AFTER-ACTION REPORT" in report
    assert "Executive Summary" in report
    assert "Key Events Timeline" in report
    assert "SC-2" in report
    assert "8841" in report
