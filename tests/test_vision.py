"""Tests for YOLO vision inference and human adjudication (AGENTS.md § Ch.13)."""

from __future__ import annotations

import base64
from app import vision


def test_yolo_model_status():
    """Verify model status returns online with 80 classes when weights are present."""
    status = vision.get_model_status()
    assert "status" in status
    assert "classes" in status
    assert status["classes"] in (80, 4)  # 80 for real YOLOv8n, 4 for fallback
    assert status["adjudication_gate"] == "human_operator_required"


def test_tactical_samples_catalog():
    """Verify tactical surveillance sample imagery catalog is available."""
    samples = vision.get_tactical_samples()
    assert len(samples) >= 3
    for s in samples:
        assert "id" in s
        assert "title" in s
        assert "category" in s
        assert "image_b64" in s
        assert len(s["image_b64"]) > 50


def test_infer_frame_with_sample():
    """Verify real or fallback inference extracts detections and normalized bounding boxes."""
    samples = vision.get_tactical_samples()
    s0 = samples[0]
    img_bytes = base64.b64decode(s0["image_b64"])
    result = vision.infer_frame(img_bytes, unit_id="CAM-TEST", tick=1)

    assert result["status"] == "ok"
    assert "infer_ms" in result
    assert result["count"] >= 1
    assert len(result["detections"]) == result["count"]

    det = result["detections"][0]
    assert det["type"] == "detection"
    assert det["entityId"] == "CAM-TEST"
    assert "box" in det["payload"]
    box = det["payload"]["box"]
    assert "x" in box and "y" in box and "w" in box and "h" in box
    assert 0.0 <= box["x"] <= 100.0
    assert 0.0 <= box["y"] <= 100.0


def test_adjudication_threshold_gate():
    """Verify detections strictly obey threshold and auto-confirmation rules (AGENTS.md § Ch.13)."""
    detections = [
        {
            "id": "DET-1",
            "type": "detection",
            "entityId": "UAV-1",
            "tick": 10,
            "payload": {"label": "vehicle", "confidence": 0.92, "model": "yolov8n-doip-v1.4"},
        },
        {
            "id": "DET-2",
            "type": "detection",
            "entityId": "UAV-2",
            "tick": 10,
            "payload": {"label": "person", "confidence": 0.65, "model": "yolov8n-doip-v1.4"},
        },
        {
            "id": "DET-3",
            "type": "detection",
            "entityId": "UAV-3",
            "tick": 10,
            "payload": {"label": "unknown", "confidence": 0.35, "model": "yolov8n-doip-v1.4"},
        },
    ]

    res = vision.adjudicate(detections, min_confidence=0.50, auto_accept_above=0.85)

    assert res["stats"]["total"] == 3
    assert res["stats"]["above_threshold"] == 2
    assert res["stats"]["auto_confirmed"] == 1
    assert res["stats"]["awaiting_review"] == 1

    assert len(res["confirmed"]) == 1
    assert res["confirmed"][0]["eventId"] == "DET-1"

    assert len(res["pending"]) == 1
    assert res["pending"][0]["eventId"] == "DET-2"

    assert len(res["incidents"]) == 1
    assert res["incidents"][0]["type"] == "incident_open"
    assert res["incidents"][0]["payload"]["sourceEventId"] == "DET-1"
