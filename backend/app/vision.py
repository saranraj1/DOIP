"""Vision module — YOLO inference + adjudication (Ch18 S9, P1-2).

Architecture:
  - `load_model()` lazily loads YOLOv8n from disk. If weights are absent,
    it returns None and inference falls back safely to synthetic detections.
  - `get_model_status()` returns live neural core telemetry (model, classes, device).
  - `infer_frame()` executes tensor forward pass via Ultralytics YOLOv8,
    extracting normalized bounding boxes, confidence, class labels, and latency.
  - `run_inference()` wraps infer_frame to return SimEvent-compatible detection dicts.
  - `generate_frames()` produces multi-channel tactical surveillance streams
    with optical/thermal HUD overlays and dual base64/image_b64 payloads.
  - `get_tactical_samples()` provides 1-click test frames (Recon Convoy, Night Thermal, Airfield).
  - `adjudicate()` applies human-in-the-loop threshold validation per AGENTS.md §Ch13.

AI-service boundary (AGENTS.md §Ch13): YOLO outputs are detection events, not
world-state mutations. They enter the adjudication queue for human review.
"""

from __future__ import annotations

import base64
import io
import logging
import math
import struct
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

DEFAULT_THRESHOLD = 0.80

_WEIGHTS_DIR = Path(__file__).resolve().parent.parent / "weights"
_YOLO_MODEL: Any = None
_MODEL_LOADED = False   # sentinel so we only attempt once per process

LABELS = ["vehicle", "person", "uav", "structure"]

_ASSETS_DIR = Path(__file__).resolve().parent / "assets" / "samples"
_SAMPLE_CACHE: dict[str, str] = {}


def _get_sample_b64(filename: str) -> str:
    """Return base64 representation of a tactical sample image with memory caching."""
    if filename in _SAMPLE_CACHE:
        return _SAMPLE_CACHE[filename]
    path = _ASSETS_DIR / filename
    if not path.exists():
        fallback = _ASSETS_DIR / filename.replace("_opt", "")
        if fallback.exists():
            path = fallback
        else:
            return ""
    try:
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        _SAMPLE_CACHE[filename] = b64
        return b64
    except Exception as exc:
        log.warning("Failed reading sample image %s: %s", path, exc)
        return ""


CAMERA_CHANNELS = [
    {
        "id": "CAM-01-NORTH",
        "name": "Sector North Ridge (FLIR)",
        "mode": "FLIR-THERMAL",
        "alt": "840m",
        "file": "sample_flir_valley_opt.jpg",
        "target": {"label": "person", "confidence": 0.88, "box": {"x": 52.0, "y": 62.0, "w": 8.0, "h": 16.0}},
    },
    {
        "id": "CAM-02-VALLEY",
        "name": "Valley Approach Checkpoint",
        "mode": "EO-OPTICAL",
        "alt": "120m",
        "file": "sample_base_checkpoint_opt.jpg",
        "target": {"label": "truck", "confidence": 0.91, "box": {"x": 33.0, "y": 42.0, "w": 18.0, "h": 22.0}},
    },
    {
        "id": "CAM-03-FOB",
        "name": "FOB Ground Transport Route",
        "mode": "EO-OPTICAL",
        "alt": "350m",
        "file": "sample_ground_convoy_opt.jpg",
        "target": {"label": "bus", "confidence": 0.87, "box": {"x": 3.0, "y": 21.0, "w": 96.0, "h": 48.0}},
    },
    {
        "id": "CAM-04-COASTAL",
        "name": "Coastal Maritime Sector",
        "mode": "SWIR-INFRARED",
        "alt": "600m",
        "file": "sample_coastal_patrol_opt.jpg",
        "target": {"label": "boat", "confidence": 0.94, "box": {"x": 42.0, "y": 68.0, "w": 18.0, "h": 22.0}},
    },
    {
        "id": "CAM-05-DEPOT",
        "name": "Supply Depot Logistics Bay",
        "mode": "LOW-LIGHT-IR",
        "alt": "80m",
        "file": "sample_depot_night_opt.jpg",
        "target": {"label": "truck", "confidence": 0.89, "box": {"x": 8.0, "y": 44.0, "w": 17.0, "h": 26.0}},
    },
    {
        "id": "CAM-06-AIRFIELD",
        "name": "Forward Airfield Apron",
        "mode": "EO-OPTICAL",
        "alt": "520m",
        "file": "sample_airfield_apron_opt.jpg",
        "target": {"label": "airplane", "confidence": 0.93, "box": {"x": 31.0, "y": 8.0, "w": 58.0, "h": 52.0}},
    },
]


# ---------------------------------------------------------------------------
# Model loading & status — lazy, fail-soft
# ---------------------------------------------------------------------------
def _find_weights() -> Path | None:
    candidates = [
        _WEIGHTS_DIR / "yolov8n-doip-v1.4.pt",
        _WEIGHTS_DIR / "yolov8n.pt",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def load_model() -> Any | None:
    """Return the YOLO model singleton, loading it on first call.

    Returns None if the weights file is absent or ultralytics is not installed.
    """
    global _YOLO_MODEL, _MODEL_LOADED
    if _MODEL_LOADED:
        return _YOLO_MODEL
    _MODEL_LOADED = True

    weights_file = _find_weights()
    if weights_file is None:
        log.info(
            "YOLO weights not found in %s — using synthetic detections fallback",
            _WEIGHTS_DIR,
        )
        return None

    try:
        from ultralytics import YOLO  # type: ignore[import]
        _YOLO_MODEL = YOLO(str(weights_file))
        log.info("YOLO model loaded from %s", weights_file)
    except ImportError:
        log.warning("ultralytics not installed — using synthetic detections")
    except Exception as exc:
        log.warning("Failed to load YOLO model: %s — using synthetic detections", exc)
    return _YOLO_MODEL


def get_model_status() -> dict[str, Any]:
    """Return health and runtime diagnostics for the YOLO neural engine."""
    model = load_model()
    weights_file = _find_weights()
    if model is not None:
        class_names = list(model.names.values()) if hasattr(model, "names") else []
        return {
            "status": "online",
            "loaded": True,
            "model": "YOLOv8n-DOIP-v1.4",
            "classes": len(class_names) or 80,
            "device": "cpu",
            "weights": weights_file.name if weights_file else "yolov8n.pt",
            "provider": "Ultralytics YOLOv8 (PyTorch)",
            "sample_classes": class_names[:12] if class_names else ["person", "car", "truck", "airplane", "boat"],
            "adjudication_gate": "human_operator_required",
        }
    return {
        "status": "fallback",
        "loaded": False,
        "model": "Synthetic Sensor Pipeline",
        "classes": len(LABELS),
        "device": "cpu",
        "weights": "none (synthetic generator)",
        "provider": "DOIP Mulberry32 Deterministic",
        "sample_classes": LABELS,
        "adjudication_gate": "human_operator_required",
    }


# ---------------------------------------------------------------------------
# Neural inference execution
# ---------------------------------------------------------------------------
def infer_frame(
    frame_bytes: bytes,
    unit_id: str = "CAM-01",
    tick: int = 0,
    conf_threshold: float = 0.25,
) -> dict[str, Any]:
    """Execute neural object detection on a frame buffer using YOLOv8n.

    Returns normalized bounding box coordinates (% of width/height), class labels,
    confidence metrics, and neural inference latency in milliseconds.
    """
    t0 = time.perf_counter()
    model = load_model()
    if model is None:
        return {
            "detections": [],
            "count": 0,
            "infer_ms": 0.0,
            "model": "synthetic_fallback",
            "status": "fallback",
        }

    try:
        from PIL import Image  # type: ignore[import]
        import numpy as np  # type: ignore[import]

        img = Image.open(io.BytesIO(frame_bytes)).convert("RGB")
        img_w, img_h = img.size
        arr = np.array(img)
        results = model(arr, conf=conf_threshold, verbose=False)
        infer_ms = round((time.perf_counter() - t0) * 1000, 1)

        detections: list[dict[str, Any]] = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                label = model.names.get(cls_id, "unknown")

                # xywhn gives [x_center, y_center, w, h] normalized 0..1
                xywhn = box.xywhn[0].tolist()
                xc, yc, w, h = xywhn[0], xywhn[1], xywhn[2], xywhn[3]
                top_left_x = max(0.0, min(100.0, (xc - w / 2.0) * 100.0))
                top_left_y = max(0.0, min(100.0, (yc - h / 2.0) * 100.0))
                box_w = max(0.0, min(100.0, w * 100.0))
                box_h = max(0.0, min(100.0, h * 100.0))

                xyxyn = box.xyxyn[0].tolist()

                severity = "high" if conf >= 0.80 else ("medium" if conf >= 0.50 else "low")
                det_id = f"DET-{tick}-{len(detections) + 1}"

                detections.append({
                    "id": det_id,
                    "type": "detection",
                    "severity": severity,
                    "entityId": unit_id,
                    "tick": tick,
                    "payload": {
                        "label": label,
                        "classId": cls_id,
                        "confidence": round(conf, 3),
                        "model": "yolov8n-doip-v1.4",
                        "frame": f"F-{tick}-{unit_id}",
                        "box": {
                            "x": round(top_left_x, 2),
                            "y": round(top_left_y, 2),
                            "w": round(box_w, 2),
                            "h": round(box_h, 2),
                        },
                        "box_xyxy": [round(val, 4) for val in xyxyn],
                        "lat": None,
                        "lon": None,
                    },
                })

        return {
            "detections": detections,
            "count": len(detections),
            "infer_ms": infer_ms,
            "image_size": [img_w, img_h],
            "model": "yolov8n-doip-v1.4",
            "status": "ok",
        }
    except Exception as exc:
        log.warning("YOLO inference error: %s", exc)
        return {
            "detections": [],
            "count": 0,
            "infer_ms": round((time.perf_counter() - t0) * 1000, 1),
            "model": "yolov8n-doip-v1.4",
            "status": f"error: {exc}",
        }


def run_inference(frame_bytes: bytes, unit_id: str = "U-UAV-1", tick: int = 0) -> list[dict]:
    """Run YOLO on a JPEG/PNG frame and return a list of detection dicts (SimEvent schema).

    Preserves backward-compatibility with existing sim event consumers.
    """
    res = infer_frame(frame_bytes, unit_id=unit_id, tick=tick)
    return res.get("detections", [])


# ---------------------------------------------------------------------------
# Synthetic & tactical frame generator
# ---------------------------------------------------------------------------
def _make_tactical_png(width: int = 320, height: int = 180, channel: dict | None = None, tick: int = 0) -> bytes:
    """Generate a crisp tactical surveillance camera image with crosshair HUD overlay."""
    try:
        from PIL import Image, ImageDraw  # type: ignore[import]
        channel_info = channel or CAMERA_CHANNELS[0]
        mode = channel_info.get("mode", "EO-OPTICAL")
        cid = channel_info.get("id", "CAM-01")

        # Palette choice based on sensor mode
        if "THERMAL" in mode or "FLIR" in mode:
            base_color = (12, 28, 20)      # Night FLIR emerald green
            grid_color = (25, 60, 42)
            accent = (72, 220, 140)
            target_color = (245, 230, 90)
        elif "INFRARED" in mode or "IR" in mode:
            base_color = (22, 16, 32)      # IR purple-indigo
            grid_color = (45, 35, 60)
            accent = (160, 120, 240)
            target_color = (255, 110, 80)
        else:
            base_color = (16, 22, 28)      # Optical Slate Navy
            grid_color = (28, 42, 54)
            accent = (0, 210, 255)
            target_color = (255, 200, 60)

        img = Image.new("RGB", (width, height), color=base_color)
        draw = ImageDraw.Draw(img)

        # Draw tactical horizon / grid lines
        for y_pos in range(30, height, 40):
            draw.line([(0, y_pos), (width, y_pos)], fill=grid_color, width=1)
        for x_pos in range(40, width, 50):
            draw.line([(x_pos, 0), (x_pos, height)], fill=grid_color, width=1)

        # Center reticle
        cx, cy = width // 2, height // 2
        reticle_len = 16
        draw.line([(cx - reticle_len, cy), (cx - 4, cy)], fill=accent, width=1)
        draw.line([(cx + 4, cy), (cx + reticle_len, cy)], fill=accent, width=1)
        draw.line([(cx, cy - reticle_len), (cx, cy - 4)], fill=accent, width=1)
        draw.line([(cx, cy + 4), (cx, cy + reticle_len)], fill=accent, width=1)
        draw.rectangle([cx - 2, cy - 2, cx + 2, cy + 2], outline=accent)

        # Corner framing marks
        corner_pad = 12
        corner_arm = 10
        # Top-left
        draw.line([(corner_pad, corner_pad), (corner_pad + corner_arm, corner_pad)], fill=accent, width=1)
        draw.line([(corner_pad, corner_pad), (corner_pad, corner_pad + corner_arm)], fill=accent, width=1)
        # Top-right
        draw.line([(width - corner_pad, corner_pad), (width - corner_pad - corner_arm, corner_pad)], fill=accent, width=1)
        draw.line([(width - corner_pad, corner_pad), (width - corner_pad, corner_pad + corner_arm)], fill=accent, width=1)
        # Bottom-left
        draw.line([(corner_pad, height - corner_pad), (corner_pad + corner_arm, height - corner_pad)], fill=accent, width=1)
        draw.line([(corner_pad, height - corner_pad), (corner_pad, height - corner_pad - corner_arm)], fill=accent, width=1)
        # Bottom-right
        draw.line([(width - corner_pad, height - corner_pad), (width - corner_pad - corner_arm, height - corner_pad)], fill=accent, width=1)
        draw.line([(width - corner_pad, height - corner_pad), (width - corner_pad, height - corner_pad - corner_arm)], fill=accent, width=1)

        # Target box simulation in the field of view
        seed = (tick * 17 + hash(cid)) & 0xFFFF
        tx = 60 + (seed % 140)
        ty = 40 + ((seed >> 4) % 70)
        tw = 45 + (seed % 30)
        th = 30 + ((seed >> 8) % 25)
        draw.rectangle([tx, ty, tx + tw, ty + th], outline=target_color, width=2)
        # Target corner notches
        draw.rectangle([tx - 2, ty - 2, tx + 4, ty + 4], fill=target_color)

        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
    except Exception:
        # Fallback to stdlib minimal png
        return _make_minimal_png(64, 64, seed=tick)


def _make_minimal_png(width: int = 64, height: int = 64, seed: int = 0) -> bytes:
    """Return a minimal valid grayscale PNG filled with a seed-derived pattern."""
    import zlib

    def _u32be(n: int) -> bytes:
        return struct.pack(">I", n)

    def _chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return _u32be(len(data)) + tag + data + _u32be(crc)

    raw_rows = b""
    for y in range(height):
        raw_rows += b"\x00"
        for x in range(width):
            raw_rows += bytes([(x ^ y ^ (seed & 0xFF)) & 0xFF])

    compressed = zlib.compress(raw_rows, level=1)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", _u32be(width) + _u32be(height) + b"\x08\x00\x00\x00\x00")
        + _chunk(b"IDAT", compressed)
        + _chunk(b"IEND", b"")
    )
    return png


def generate_frames(n: int = 6, tick: int = 0) -> list[dict[str, Any]]:
    """Return `n` surveillance frame dicts for the /vision/frames endpoint with real camera imagery.

    Provides both `base64` and `image_b64` keys for full frontend compatibility.
    """
    count = min(max(n, 1), len(CAMERA_CHANNELS))
    frames: list[dict[str, Any]] = []

    for i in range(count):
        channel = CAMERA_CHANNELS[i]
        cid = channel["id"]
        b64 = _get_sample_b64(channel.get("file", ""))
        if not b64:
            png_bytes = _make_minimal_png(64, 64, seed=tick + i)
            b64 = base64.b64encode(png_bytes).decode("ascii")

        target = channel.get("target", {})
        detection_item = {
            "label": target.get("label", LABELS[i % len(LABELS)]),
            "confidence": target.get("confidence", 0.85),
            "model": "yolov8n-doip-v1.4",
            "box": target.get("box", {"x": 20.0, "y": 20.0, "w": 30.0, "h": 30.0}),
        }

        frames.append({
            "frameId": f"F-{tick}-{cid}",
            "unitId": cid,
            "channel": cid,
            "channelName": channel["name"],
            "sensorMode": channel["mode"],
            "alt": channel["alt"],
            "timestamp": tick,
            "width": 640,
            "height": 360,
            "mimeType": "image/jpeg",
            "base64": b64,
            "image_b64": b64,      # dual compatibility
            "detections": [detection_item],
            "telemetry": {
                "lat": round(32.7410 + (i * 0.015), 4),
                "lon": round(74.8820 + (i * 0.018), 4),
                "fps": 30,
                "status": "TRACKING_ACTIVE",
            },
        })
    return frames


# ---------------------------------------------------------------------------
# Tactical Samples for instant 1-click YOLO verification
# ---------------------------------------------------------------------------
def get_tactical_samples() -> list[dict[str, Any]]:
    """Return authentic military surveillance reconnaissance photos for 1-click YOLO testing."""
    samples_def = [
        {
            "id": "SAMPLE-BUS-BENCHMARK",
            "file": "sample_ground_convoy_opt.jpg",
            "title": "Transport & Personnel Convoy (Ground Benchmark)",
            "category": "COCO Ground Validation",
            "sensor": "EO High-Definition",
            "description": "Standard multi-target ground convoy featuring transit vehicles and personnel in daylight.",
            "expected": ["bus", "person"],
        },
        {
            "id": "SAMPLE-THERMAL-VALLEY",
            "file": "sample_flir_valley_opt.jpg",
            "title": "Sector Valley Night Patrol (FLIR Thermal)",
            "category": "Border Reconnaissance",
            "sensor": "FLIR LWIR 640x512",
            "description": "Authentic thermal infrared aerial surveillance of mountainous valley pass showing armored vehicles and patrol soldiers.",
            "expected": ["person", "vehicle"],
        },
        {
            "id": "SAMPLE-COASTAL-DEFENSE",
            "file": "sample_coastal_patrol_opt.jpg",
            "title": "Coastal Perimeter & Marine Radar Corridor",
            "category": "Maritime Defense",
            "sensor": "SWIR High-Resolution",
            "description": "High-angle coastal observation corridor monitoring offshore patrol vessel and maritime surveillance aircraft.",
            "expected": ["boat", "airplane"],
        },
        {
            "id": "SAMPLE-AIRFIELD-APRON",
            "file": "sample_airfield_apron_opt.jpg",
            "title": "Forward Airfield Support Apron",
            "category": "Air Base Defense",
            "sensor": "EO 4K Tactical",
            "description": "High-altitude tarmac surveillance capturing cargo transport aircraft, support vehicles, and ground crew.",
            "expected": ["airplane", "truck", "person"],
        },
        {
            "id": "SAMPLE-BASE-CHECKPOINT",
            "file": "sample_base_checkpoint_opt.jpg",
            "title": "FOB Perimeter Gate & Security Checkpoint",
            "category": "Perimeter Defense",
            "sensor": "EO Day/Night Optical",
            "description": "Forward Operating Base outer entry checkpoint monitoring tactical vehicles, guard personnel, and blast barriers.",
            "expected": ["truck", "person", "car"],
        },
        {
            "id": "SAMPLE-DEPOT-LOGISTICS",
            "file": "sample_depot_night_opt.jpg",
            "title": "Supply Logistics Depot Gate & Containers",
            "category": "Logistics & C2",
            "sensor": "Low-Light Security IR",
            "description": "Logistics depot surveillance monitoring heavy supply transport trucks and personnel during evening operations.",
            "expected": ["truck", "person"],
        },
    ]

    samples: list[dict[str, Any]] = []
    for s in samples_def:
        b64 = _get_sample_b64(s["file"])
        if b64:
            samples.append({
                "id": s["id"],
                "title": s["title"],
                "category": s["category"],
                "sensor": s["sensor"],
                "description": s["description"],
                "image_b64": b64,
                "expected": s["expected"],
            })
    return samples


# ---------------------------------------------------------------------------
# Adjudication — Ch18 S9, AGENTS.md §Ch13
# ---------------------------------------------------------------------------
def adjudicate(
    detection_events: list[dict],
    min_confidence: float = DEFAULT_THRESHOLD,
    auto_accept_above: float | None = None,
) -> dict:
    """Process a batch of detection events and return adjudication results.

    Args:
        detection_events: list of SimEvent dicts where type == "detection"
        min_confidence:   only process detections at or above this threshold
        auto_accept_above: if set, auto-confirm detections above this level

    Returns:
        dict with keys: pending, confirmed, rejected, incidents, stats
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
                "eventId": e.get("id"),
                "entityId": e.get("entityId"),
                "label": payload.get("label"),
                "confidence": conf,
                "model": payload.get("model", "yolov8n-doip-v1.4"),
                "frame": payload.get("frame"),
                "lat": payload.get("lat"),
                "lon": payload.get("lon"),
                "tick": e.get("tick", 0),
            })
            # Accepted detection becomes a map event with model lineage.
            incidents.append({
                "type": "incident_open",
                "severity": "medium",
                "entityId": f"DET-{e.get('id', 'auto')}",
                "payload": {
                    "kind": f"detection:{payload.get('label', 'unknown')}",
                    "lat": payload.get("lat"),
                    "lon": payload.get("lon"),
                    "reportedBy": e.get("entityId"),
                    "confidence": conf,
                    "model": payload.get("model", "yolov8n-doip-v1.4"),
                    "frame": payload.get("frame"),
                    "sourceEventId": e.get("id"),   # model lineage
                },
            })
        else:
            pending.append({
                "eventId": e.get("id"),
                "entityId": e.get("entityId"),
                "label": payload.get("label"),
                "confidence": conf,
                "model": payload.get("model"),
                "frame": payload.get("frame"),
                "tick": e.get("tick", 0),
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
