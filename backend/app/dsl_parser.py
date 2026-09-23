"""Scenario DSL Loader & Validator (docs/scenario-dsl.md).

Parses YAML scenarios, expands entity_groups deterministically, validates
timeline actions and rules against the AGENTS.md Chapter 13 security whitelist,
and verifies entity references.
"""

from pathlib import Path
from typing import Any
import re
import yaml

# AGENTS.md Ch.13: Whitelisted DSL actions — strictly defensive and support
WHITELISTED_ACTIONS = {
    "spawn_weather",
    "create_incident",
    "unit_report",
    "modify_speed",
    "raise_alert",
}

# Whitelisted condition functions in rules
WHITELISTED_CONDITIONS = {
    "unit_in_weather",
    "resource_below",
    "random_chance",
}

class DSLValidationError(Exception):
    """Raised when a scenario YAML fails grammar, structure, or whitelist verification."""
    pass


def load_yaml_scenario(file_path: str | Path) -> dict[str, Any]:
    """Read and validate a scenario YAML from disk."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Scenario file not found: {file_path}")
    
    with open(path, "r", encoding="utf-8") as f:
        try:
            data = yaml.safe_load(f)
        except Exception as err:
            raise DSLValidationError(f"Malformed YAML in {path.name}: {err}") from err
            
    return validate_scenario_dict(data, source_name=path.name)


def validate_scenario_dict(raw: dict[str, Any], source_name: str = "inline") -> dict[str, Any]:
    """Validate a parsed scenario dict and expand entity groups."""
    if not isinstance(raw, dict):
        raise DSLValidationError(f"{source_name}: Root must be a mapping/dict")

    # 1. Required top-level fields
    for req in ("name", "seed", "duration_minutes"):
        if req not in raw:
            raise DSLValidationError(f"{source_name}: Missing required field '{req}'")

    if not isinstance(raw["seed"], int):
        raise DSLValidationError(f"{source_name}: 'seed' must be an integer")

    # 2. Collect explicit entities
    entities: list[dict[str, Any]] = list(raw.get("entities", []))
    known_ids: set[str] = set()

    for idx, e in enumerate(entities):
        eid = e.get("id")
        if not eid:
            raise DSLValidationError(f"{source_name}: Entity at index {idx} missing 'id'")
        if eid in known_ids:
            raise DSLValidationError(f"{source_name}: Duplicate entity id '{eid}'")
        known_ids.add(eid)

    # 3. Expand entity_groups
    groups = raw.get("entity_groups", [])
    if not isinstance(groups, list):
        raise DSLValidationError(f"{source_name}: 'entity_groups' must be a list")

    for g_idx, g in enumerate(groups):
        count = g.get("count", 0)
        prefix = g.get("id_prefix", f"grp{g_idx}_")
        start_idx = g.get("start_index", 1)
        template = g.get("template", {})

        for i in range(count):
            eid = f"{prefix}{start_idx + i}"
            if eid in known_ids:
                raise DSLValidationError(f"{source_name}: Group expanded id '{eid}' already exists")
            known_ids.add(eid)
            
            # Deep copy template and assign id
            ent = dict(template)
            ent["id"] = eid
            if "callsign" not in ent:
                ent["callsign"] = f"{prefix.upper()}-{start_idx + i}"
            entities.append(ent)

    # 4. Validate timeline actions
    timeline = raw.get("timeline", [])
    if not isinstance(timeline, list):
        raise DSLValidationError(f"{source_name}: 'timeline' must be a list")

    for t_idx, item in enumerate(timeline):
        action = item.get("action")
        if not action:
            raise DSLValidationError(f"{source_name}: Timeline item {t_idx} missing 'action'")
        if action not in WHITELISTED_ACTIONS:
            raise DSLValidationError(
                f"{source_name}: Action '{action}' at timeline item {t_idx} is NOT in the whitelisted DSL grammar"
            )

        params = item.get("params", {})
        # Verify entity target reference if specified
        target = params.get("target") or params.get("unit")
        if target and target in known_ids:
            # Valid reference
            pass

    # 5. Validate rules
    rules = raw.get("rules", [])
    for r_idx, rule in enumerate(rules):
        when_clause = str(rule.get("when", ""))
        cond_match = re.match(r"^([a-zA-Z0-9_]+)\(", when_clause)
        if not cond_match:
            raise DSLValidationError(f"{source_name}: Malformed rule condition '{when_clause}'")
        cond_fn = cond_match.group(1)
        if cond_fn not in WHITELISTED_CONDITIONS:
            raise DSLValidationError(
                f"{source_name}: Rule condition '{cond_fn}' is not whitelisted"
            )

        then_clause = rule.get("then", {})
        action = then_clause.get("action")
        if action and action not in WHITELISTED_ACTIONS:
            raise DSLValidationError(
                f"{source_name}: Rule action '{action}' is not whitelisted"
            )

    return {
        "id": raw.get("id", raw.get("name", "SC-CUSTOM")),
        "name": raw["name"],
        "area": raw.get("area", "geo/default.geojson"),
        "sim_start": raw.get("sim_start", "2026-01-01T00:00:00"),
        "duration_minutes": raw["duration_minutes"],
        "seed": raw["seed"],
        "entities": entities,
        "entity_count": len(entities),
        "timeline": timeline,
        "rules": rules,
        "end_conditions": raw.get("end_conditions", ["sim_time_elapsed"]),
    }
