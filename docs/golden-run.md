# Golden Run — Determinism Contract

## What it is

The golden run is CI's proof that the engine is deterministic: scenario **SC-2 (Border Surveillance & Infiltration Response)**, seed **8841**, run for a fixed tick count. The resulting event sequence is hashed; the frozen hash lives in `tests/golden/sc2_seed8841.hash`.

A quick variant (SC-1, seed 42, 100 ticks) runs on every push; the full SC-2 run runs on PRs touching `engine/`.

## The contract

Same scenario + same seed → byte-identical event sequence, on every machine, forever — until an _intentional, reviewed_ engine-behavior change re-freezes the fixture.

## If your PR breaks the hash

1. **Assume your change is a bug.** The usual suspects: wall-clock time, an unseeded RNG, unordered iteration, or reordered floating-point arithmetic.
2. If it is a genuinely intended behavior change (e.g., a new weather effect), state that in the PR's “Golden-run impact” section, get a second reviewer, and re-freeze in the same PR: `make golden-freeze`.
3. **Never** regenerate the fixture just to make CI pass. A silent re-freeze converts every future regression into “expected behavior”.

## Why SC-2

It exercises the widest engine surface: 35 entities, weather, incidents, rules, comms-loss, and QRF response over 6 sim-hours — a change that survives SC-2 unchanged is very unlikely to have touched determinism.

## Re-freezing legitimately

```bash
make golden-freeze        # regenerates hash + a human-readable event digest
git diff tests/golden/    # REVIEW the digest diff — explain it in the PR
```
