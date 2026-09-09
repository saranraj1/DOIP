"""Vision adjudication logic (Ch18 S9).

MVP: deterministic post-processing of detections from the event log.
Accepts a list of detection events (already emitted by the engine), applies a
confidence threshold, and returns verdicts with model lineage. When detections
are accepted, they produce incident_open events that feed back into the world.
"""

from __future__ import annotations


DEFAULT_THRESHOLD = 0.80


def adjudicate(
    detection_events: list[dict],
    min_confidence: float = DEFAULT_THRESHOLD,
    auto_accept_above: float | None = None,
) -> dict:
    """Process a batch of detection events and return adjudication results.

    Args:
        detection_events: list of SimEvent dicts where type == "detection"
        min_confidence: only process detections at or above this threshold
        auto_accept_above: if set, auto-confirm detections above this level
            (S9 Ch18 spec: operator presses 'Accept all >= 0.80')

    Returns:
        dict with keys:
            pending   - list of detections needing human review
            confirmed - list of auto-accepted detections
            rejected  - always empty in this call (rejections are operator-side)
            incidents - synthetic incident_open events for confirmed detections
    """
    above = [e for e in detection_events if e.get("payload", {}).get("confidence", 0) >= min_confidence]

    pending: list[dict] = []
    confirmed: list[dict] = []
    incidents: list[dict] = []

    for e in above:
        payload = e.get("payload", {})
        conf = payload.get("confidence", 0)
        auto = auto_accept_above is not None and conf >= auto_accept_above
        if auto:
            confirmed.append({
                "eventId": e["id"],
                "entityId": e["entityId"],
                "label": payload.get("label"),
                "confidence": conf,
                "model": payload.get("model", "yolov8n-doip-v1.4"),
                "frame": payload.get("frame"),
                "lat": payload.get("lat"),
                "lon": payload.get("lon"),
                "tick": e["tick"],
            })
            # Accepted detection becomes a map event with model lineage.
            incidents.append({
                "type": "incident_open",
                "severity": "medium",
                "entityId": f"DET-{e['id']}",
                "payload": {
                    "kind": f"detection:{payload.get('label', 'unknown')}",
                    "lat": payload.get("lat"), "lon": payload.get("lon"),
                    "reportedBy": e["entityId"],
                    "confidence": conf,
                    "model": payload.get("model", "yolov8n-doip-v1.4"),
                    "frame": payload.get("frame"),
                    "sourceEventId": e["id"],   # model lineage
                },
            })
        else:
            pending.append({
                "eventId": e["id"],
                "entityId": e["entityId"],
                "label": payload.get("label"),
                "confidence": conf,
                "model": payload.get("model"),
                "frame": payload.get("frame"),
                "tick": e["tick"],
            })

    return {
        "pending": pending,
        "confirmed": confirmed,
        "rejected": [],
        "incidents": incidents,
        "stats": {
            "total": len(detection_events),
            "above_threshold": len(above),
            "auto_confirmed": len(confirmed),
            "awaiting_review": len(pending),
        },
    }
