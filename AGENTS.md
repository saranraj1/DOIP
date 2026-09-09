# AGENTS.md — Instructions for AI coding agents working on DOIP

You are working on DOIP, a deterministic military training simulation platform. These rules override any general habits you have.

## The one rule that matters most

**Determinism is the product.** The engine must produce byte-identical event sequences from the same scenario + seed.

- Use ONLY the injected seeded RNG (`engine/rng.py`). Never call `random`, `numpy.random`, `uuid4`, or wall-clock time (`time.time()`, `datetime.now()`) inside engine code. Sim-time comes from the tick counter.
- Never iterate over unordered collections (`set`, dict pre-3.7 semantics assumptions) where order affects emitted events. Sort explicitly.
- Floating-point accumulation order matters. Do not “refactor” arithmetic in movement/consumption code without checking the golden run.

## Golden-run CI

- `tests/golden/sc2_seed8841.hash` is the frozen event-sequence hash for scenario SC-2.
- If your change breaks it: STOP. Either your change is a bug, or it is an intentional engine-behavior change that requires a human decision to re-freeze. **Never regenerate the fixture yourself to make CI pass.**

## AI-service boundaries (Ch. 13 golden rule)

- AI authors **scenarios**, the engine computes **outcomes**. Never let LLM output mutate world state directly.
- LLM-generated actions must pass the whitelisted DSL validation gate (`engine/dsl/validator.py`) and human approval. Do not add actions to the whitelist to “unblock” a feature.
- Every AI claim shown to users must cite an event id or corpus doc id. Unverifiable claims are flagged, not displayed as fact.

## Architecture discipline

- Modular monolith. Do NOT introduce microservices, Kafka, or Kubernetes; Redis pub/sub and Docker Compose are the ceiling until Phase 7.
- Events are append-only. New event types require: schema in `engine/events/`, migration, replay-reader support, and a docs update — all in one PR.
- Roles are `admin / planner / operator / viewer`. Every new endpoint declares its role requirement explicitly.

## Dependencies

- Free and open source only. Add a row to `THIRD_PARTY_LICENSES.md` in the same PR. AGPL (YOLO) stays isolated in the vision service.

## Before large changes

Read the relevant engine/event/auth code fully before editing it. Do not guess interfaces. Do not create parallel implementations of existing modules.

## Scope guard

This platform simulates **defensive and support operations only** — never offensive strike planning. Do not add features, prompts, or scenario actions that violate this.
