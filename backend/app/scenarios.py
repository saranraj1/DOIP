"""Scenario catalogue — mirror of src/sim/scenarios.ts (SC-1..SC-4).

The browser engine remains the source of truth for simulation behaviour in the
MVP; this catalogue exists so API clients and future headless runners can list
the same scenarios the frontend runs.
"""

SCENARIOS = [
    {
        "id": "SC-1",
        "name": "Sector Patrol",
        "description": "Routine multi-sector patrol with UAV overwatch.",
        "validation": "valid",
    },
    {
        "id": "SC-2",
        "name": "Border Surveillance",
        "description": "Persistent surveillance along a contested boundary.",
        "validation": "valid",
    },
    {
        "id": "SC-3",
        "name": "Disaster Response",
        "description": "HADR tasking with degraded comms and weather pressure.",
        "validation": "valid",
    },
    {
        "id": "SC-4",
        "name": "Convoy Escort",
        "description": "Escorted logistics movement through incident-prone terrain.",
        "validation": "warning",
    },
]
