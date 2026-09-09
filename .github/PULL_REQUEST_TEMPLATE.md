## What & why

<!-- One paragraph. Link the master-doc chapter or issue this implements. -->

## Phase

<!-- Which roadmap phase does this belong to? Out-of-phase work needs justification. -->

## Determinism checklist (mandatory for engine/ changes)

- [ ] No wall-clock time, `random`, or `uuid4` in engine code — only the injected seeded RNG and tick counter
- [ ] No iteration over unordered collections where order affects events
- [ ] Golden-run hash unchanged, **or** an intentional re-freeze is explained below and approved

## Checklist

- [ ] Tests added/updated
- [ ] New dependencies recorded in `THIRD_PARTY_LICENSES.md`
- [ ] New event types documented and replay-reader updated
- [ ] Endpoints declare RBAC role requirements
- [ ] Docs touched if behavior changed (`docs/`, `scenarios/README.md`, `footage/README.md`)

## Golden-run impact

<!-- "None" or explain the intentional behavior change requiring re-freeze. -->
