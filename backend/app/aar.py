"""After-Action Report (AAR) generator (P2-4).

Composes a structured plain-text / markdown report from a persisted run event log
and world snapshot. No external dependencies - stdlib only.
"""

from __future__ import annotations
from datetime import datetime, timezone


def generate(run_id: str, log: list[dict], world_snapshot: dict | None) -> str:
    lines: list[str] = []
    _header(lines, run_id, log, world_snapshot)
    _executive_summary(lines, log)
    _timeline(lines, log)
    _sustainment(lines, log)
    _communications(lines, log)
    _incidents(lines, log)
    _kpis(lines, log)
    _footer(lines)
    return "\n".join(lines)


generate_aar = generate


def _header(lines, run_id, log, world):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    seed = world.get("seed", "?") if world else "?"
    scenario = (world.get("scenarioId") or world.get("scenario_id") or "?") if world else "?"
    total_ticks = max((e["tick"] for e in log), default=0)
    lines += [
        "# AFTER-ACTION REPORT",
        f"**Run ID:** `{run_id}`",
        f"**Scenario:** {scenario}  |  **Seed:** {seed}",
        f"**Duration:** {total_ticks} ticks  |  **Generated:** {now}",
        "",
        "> This report is derived entirely from the immutable event log.",
        "",
        "---", "",
    ]


def _executive_summary(lines, log):
    opened  = [e for e in log if e["type"] == "incident_open"]
    closed  = [e for e in log if e["type"] == "incident_close"]
    crits   = [e for e in opened if e["severity"] in ("critical", "high")]
    alerts  = [e for e in log if e["type"] == "alert_raise"]
    detects = [e for e in log if e["type"] == "detection"]
    comms   = [e for e in log if e["type"] == "comms_loss"]
    lines += [
        "## 1. Executive Summary", "",
        f"- **{len(opened)}** incident(s) opened, **{len(closed)}** closed.",
        f"- **{len(crits)}** reached high or critical severity.",
        f"- **{len(alerts)}** alerts raised; **{len(detects)}** UAV detections.",
        f"- **{len(comms)}** comms-loss events.", "",
    ]


def _timeline(lines, log):
    lines += ["## 2. Key Events Timeline", ""]
    NOTABLE = {"incident_open","incident_close","alert_raise","comms_loss",
               "comms_restore","weather_spawn","weather_clear","detection"}
    notable = sorted([e for e in log if e.get("type") in NOTABLE],
                     key=lambda e: (e.get("tick", 0), e.get("id", 0)))[:40]
    if not notable:
        lines.append("_No notable events._")
    else:
        lines += ["| T+ | Event ID | Type | Entity | Severity |",
                  "|----|----------|------|--------|----------|"]
        for e in notable:
            eid_num = e.get('id', '-')
            lines.append(
                f"| {e.get('tick', 0):>4} | {eid_num:>8} | {e.get('type', ''):<20} "
                f"| {e.get('entityId', ''):<20} | {e.get('severity', '')} |")
    lines.append("")


def _sustainment(lines, log):
    fuel = [e for e in log if e["type"] == "resource_level"
            and e.get("payload", {}).get("fuel") is not None]
    low  = [e for e in fuel if e["payload"]["fuel"] < 30]
    lines += ["## 3. Sustainment", "",
              f"- **{len(fuel)}** resource events; **{len(low)}** below 30% fuel."]
    for e in sorted(low, key=lambda x: x["tick"])[:5]:
        lines.append(f"  - T+{e['tick']}: {e['entityId']} at {round(e['payload']['fuel'],1)}%")
    lines.append("")


def _communications(lines, log):
    losses   = [e for e in log if e["type"] == "comms_loss"]
    restores = [e for e in log if e["type"] == "comms_restore"]
    lines += ["## 4. Communications", "",
              f"- **{len(losses)}** comms losses; **{len(restores)}** restorations."]
    for e in sorted(losses, key=lambda x: x["tick"])[:8]:
        lines.append(f"  - T+{e['tick']}: {e['entityId']} (event #{e['id']})")
    lines.append("")


def _incidents(lines, log):
    opened     = [e for e in log if e["type"] == "incident_open"]
    closed_ids = {e["entityId"] for e in log if e["type"] == "incident_close"}
    lines += ["## 5. Incident Register", ""]
    if not opened:
        lines += ["_No incidents._", ""]
        return
    lines += ["| T+ | Entity | Severity | Closed? | Kind |",
              "|----|--------|----------|---------|------|"]
    for e in sorted(opened, key=lambda x: x["tick"]):
        kind   = e.get("payload", {}).get("kind", "-")
        closed = "Yes" if e["entityId"] in closed_ids else "No"
        lines.append(
            f"| {e['tick']:>4} | {e['entityId']:<22} | {e['severity']:<8} "
            f"| {closed:<3} | {kind} |")
    lines.append("")


def _kpis(lines, log):
    opened = sum(1 for e in log if e["type"] == "incident_open")
    closed = sum(1 for e in log if e["type"] == "incident_close")
    open_at: dict[str, int] = {}
    rtts: list[int] = []
    for e in log:
        if e["type"] == "incident_open":
            open_at[e["entityId"]] = e["tick"]
        elif e["type"] == "incident_close" and e["entityId"] in open_at:
            rtts.append(e["tick"] - open_at.pop(e["entityId"]))
    mean_rtt = round(sum(rtts) / len(rtts), 1) if rtts else "N/A"
    lines += [
        "## 6. KPI Summary", "",
        "| KPI | Value |", "|-----|-------|",
        f"| Incidents opened | {opened} |",
        f"| Incidents closed | {closed} |",
        f"| Still open at end | {opened - closed} |",
        f"| Mean response (ticks) | {mean_rtt} |",
        f"| Comms losses | {sum(1 for e in log if e['type']=='comms_loss')} |",
        f"| Detections | {sum(1 for e in log if e['type']=='detection')} |",
        f"| Alerts raised | {sum(1 for e in log if e['type']=='alert_raise')} |",
        f"| Total events | {len(log)} |", "",
    ]


def _footer(lines):
    lines += [
        "---", "",
        "_Synthetic training data. Generated by the DOIP AAR module._",
    ]
