"""Test Scenario DSL Parser and Whitelist Validator."""

from pathlib import Path
import pytest
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.dsl_parser import DSLValidationError, load_yaml_scenario, validate_scenario_dict

SCENARIOS_DIR = Path(__file__).resolve().parent.parent / "scenarios"


def test_all_canonical_scenarios_valid():
    """All 8 canonical YAML scenarios in scenarios/ must pass validation."""
    yaml_files = list(SCENARIOS_DIR.glob("*.yaml"))
    assert len(yaml_files) == 8, f"Expected 8 scenario YAMLs, found {len(yaml_files)}"

    for f in yaml_files:
        sc = load_yaml_scenario(f)
        assert sc["name"], f"Scenario {f.name} missing name"
        assert sc["seed"] > 0, f"Scenario {f.name} invalid seed"
        assert sc["entity_count"] > 0, f"Scenario {f.name} has no entities"


def test_reject_offensive_strike_action():
    """Defensive scope guard: offensive strike actions must be rejected."""
    bad_scenario = {
        "name": "Unauthorized Offensive Action",
        "seed": 1234,
        "duration_minutes": 60,
        "entities": [{"id": "g1", "callsign": "ALPHA-1"}],
        "timeline": [
            {
                "at": "+00:10",
                "action": "offensive_missile_strike",  # VIOLATION
                "params": {"target": "ENEMY_BVR"},
            }
        ],
    }

    with pytest.raises(DSLValidationError) as exc:
        validate_scenario_dict(bad_scenario)
    assert "NOT in the whitelisted DSL grammar" in str(exc.value)


def test_reject_unknown_condition():
    """Reject unwhitelisted condition functions."""
    bad_rule_scenario = {
        "name": "Invalid Condition Scenario",
        "seed": 1234,
        "duration_minutes": 60,
        "entities": [{"id": "g1", "callsign": "ALPHA-1"}],
        "rules": [
            {
                "when": "unapproved_sensor_flag(g1)",
                "then": {"action": "modify_speed", "params": {"unit": "g1", "multiplier": 0.5}},
            }
        ],
    }

    with pytest.raises(DSLValidationError) as exc:
        validate_scenario_dict(bad_rule_scenario)
    assert "not whitelisted" in str(exc.value)


def test_entity_group_expansion():
    """Test group expansion generates unique sequential IDs and correct counts."""
    spec = {
        "name": "Group Expansion Test",
        "seed": 99,
        "duration_minutes": 60,
        "entities": [{"id": "hq", "callsign": "HQ-1"}],
        "entity_groups": [
            {
                "count": 5,
                "id_prefix": "patrol",
                "start_index": 1,
                "template": {"type": "ground_team", "personnel": 4},
            }
        ],
    }

    res = validate_scenario_dict(spec)
    assert res["entity_count"] == 6  # 1 explicit + 5 expanded
    eids = [e["id"] for e in res["entities"]]
    assert eids == ["hq", "patrol1", "patrol2", "patrol3", "patrol4", "patrol5"]
