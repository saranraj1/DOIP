"""Golden Run CI Test — Determinism Contract (AGENTS.md & docs/golden-run.md).

Never regenerate the hash fixture just to make CI pass.
If this fails, an unintended change broke determinism or sim math.
"""

import hashlib
import json
from pathlib import Path
import sys

# Ensure backend is in sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.engine import SimEngine

GOLDEN_HASH_PATH = Path(__file__).resolve().parent / "golden" / "sc2_seed8841.hash"


def test_golden_run_sc2_seed8841():
    """Verify SC-2 seed 8841 produces the exact frozen event sequence hash."""
    assert GOLDEN_HASH_PATH.exists(), f"Golden hash file missing: {GOLDEN_HASH_PATH}"
    expected_hash = GOLDEN_HASH_PATH.read_text(encoding="utf-8").strip()

    engine = SimEngine()
    events = engine.start(seed=8841, scenario_id="SC-2")
    for _ in range(100):
        events.extend(engine.step())

    # Deterministic canonical serialization
    serialized = json.dumps([e.to_dict() for e in events], sort_keys=True)
    actual_hash = hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    assert actual_hash == expected_hash, (
        f"Golden run hash mismatch!\n"
        f"Expected: {expected_hash}\n"
        f"Actual:   {actual_hash}\n"
        f"AGENTS.md rule: STOP. Either your change is a bug or intentional engine change."
    )
