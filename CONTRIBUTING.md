# Contributing to DOIP

## Before you touch anything

1. Read `AGENTS.md` — the rules there apply to humans too.
2. Read `docs/golden-run.md` **before touching `engine/`**. If your change alters the golden-run hash, you must explain why in the PR — “tests were updated” is not an explanation.
3. Read `docs/scenario-dsl.md` before editing anything in `scenarios/`.

## Workflow

- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
- One logical change per PR. Small PRs get reviewed; 2,000-line PRs get stale.
- Fill in the PR template. The determinism checklist is not optional.
- CI must be green: lint, tests, golden-run hash, license-check.

## Non-negotiable rules

| Rule | Why |
|---|---|
| One seeded RNG, injected — never `random.random()` or `time.time()` inside the tick loop | Deterministic replay is the product |
| Events are append-only; never mutate or delete emitted events | Replay + audit integrity |
| AI output enters the engine only through the DSL validation gate | Ch. 13 golden rule |
| New dependencies require a `THIRD_PARTY_LICENSES.md` row in the same PR | CI-enforced |
| No new infrastructure (Kafka, K8s) before Phase 7 | Phase discipline |

## Commit style

`<area>: <imperative summary>` — e.g. `engine: add weather drift to tick loop`.

## Reporting issues

Use the issue templates. A bug report without a **seed + scenario file + tick number** will be closed as unreproducible — determinism means every bug is reproducible, so prove it.
