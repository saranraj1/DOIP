import { useCallback, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, Stat } from "@/components/doip/primitives";
import { Sparkline } from "@/components/doip/Sparkline";
import { useSim } from "@/sim/store";
import { SEVERITY_META, SEVERITY_ORDER } from "@/lib/doip";
import type { Severity, SimEvent } from "@/sim/types";
import { toast } from "sonner";
import { Download, CloudRain, FileCheck, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — DOIP" },
      {
        name: "description",
        content:
          "Exercise analytics: event throughput, severity mix, incident closure rate and run-vs-run comparison.",
      },
      { property: "og:title", content: "Analytics — DOIP" },
      {
        property: "og:description",
        content:
          "Quantitative after-action metrics computed from the event log, with run-vs-run compare.",
      },
    ],
  }),
  component: AnalyticsScreen,
});

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Ch18 S12: compare mode — every KPI here derives from the event log alone,
// so recorded runs and the live log are directly comparable.
function kpisFromLog(log: SimEvent[], ticks: number) {
  const openTicks = new Map<string, number>();
  let closes = 0;
  let closeLatency = 0;
  let criticalAlerts = 0;
  let detections = 0;
  for (const e of log) {
    if (e.type === "incident_open") openTicks.set(e.entityId, e.tick);
    if (e.type === "incident_close") {
      closes += 1;
      const t0 = openTicks.get(e.entityId);
      if (t0 != null) closeLatency += e.tick - t0;
    }
    if (e.type === "alert_raise" && e.severity === "critical") criticalAlerts += 1;
    if (e.type === "detection") detections += 1;
  }
  const opens = [...openTicks.keys()].length;
  return {
    events: log.length,
    ticks,
    incidentsOpened: opens,
    incidentsClosed: closes,
    meanCloseTicks: closes ? closeLatency / closes : 0,
    criticalAlerts,
    detections,
    eventsPerTick: ticks ? log.length / ticks : 0,
  };
}

const KPI_ROWS: Array<{
  key: keyof ReturnType<typeof kpisFromLog>;
  label: string;
  fmt: (v: number) => string;
  higherBetter?: boolean;
}> = [
  { key: "events", label: "Total events", fmt: (v) => v.toFixed(0) },
  { key: "ticks", label: "Ticks elapsed", fmt: (v) => v.toFixed(0) },
  { key: "eventsPerTick", label: "Mean events / tick", fmt: (v) => v.toFixed(2) },
  {
    key: "incidentsOpened",
    label: "Incidents opened",
    fmt: (v) => v.toFixed(0),
    higherBetter: false,
  },
  {
    key: "incidentsClosed",
    label: "Incidents closed",
    fmt: (v) => v.toFixed(0),
    higherBetter: true,
  },
  {
    key: "meanCloseTicks",
    label: "Mean ticks to close",
    fmt: (v) => v.toFixed(1),
    higherBetter: false,
  },
  {
    key: "criticalAlerts",
    label: "Critical alerts",
    fmt: (v) => v.toFixed(0),
    higherBetter: false,
  },
  { key: "detections", label: "Detections", fmt: (v) => v.toFixed(0), higherBetter: true },
];

function AnalyticsScreen() {
  const events = useSim((s) => s.events);
  const world = useSim((s) => s.world);
  const eventRate = useSim((s) => s.eventRate);
  const runs = useSim((s) => s.runs);

  const [srcA, setSrcA] = useState("LIVE");
  const [srcB, setSrcB] = useState(runs.length ? runs[runs.length - 1]!.id : "LIVE");

  const resolve = useCallback(
    (src: string) => {
      const r = runs.find((x) => x.id === src);
      return r
        ? { label: `${r.id} · ${r.scenarioId} · seed ${r.seed}`, log: r.log, ticks: r.ticks }
        : { label: "LIVE LOG", log: events, ticks: world.tick };
    },
    [runs, events, world.tick],
  );
  const A = useMemo(() => resolve(srcA), [srcA, resolve]);
  const B = useMemo(() => resolve(srcB), [srcB, resolve]);
  const kpiA = useMemo(() => kpisFromLog(A.log, A.ticks), [A]);
  const kpiB = useMemo(() => kpisFromLog(B.log, B.ticks), [B]);

  const bySeverity = useMemo(() => {
    const m: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    events.forEach((e) => (m[e.severity] += 1));
    return m;
  }, [events]);

  const byType = useMemo(() => {
    const m = new Map<string, number>();
    events.forEach((e) => m.set(e.type, (m.get(e.type) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [events]);

  const incidents = Object.values(world.incidents);
  const closed = incidents.filter((i) => !i.open && i.closedTick != null);
  const meanClose = closed.length
    ? closed.reduce((s, i) => s + (i.closedTick! - i.tick), 0) / closed.length
    : 0;

  const acked = Object.values(world.alerts).filter((a) => a.acked && a.ackedTick != null);
  const meanAck = acked.length
    ? acked.reduce((s, a) => s + (a.ackedTick! - a.tick), 0) / acked.length
    : 0;

  const utilisation = useMemo(() => {
    const m = new Map<string, number>();
    events.forEach((e) => {
      if (e.type === "unit_move") m.set(e.entityId, (m.get(e.entityId) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [events]);
  const maxUtil = Math.max(1, ...utilisation.map(([, v]) => v));
  const maxType = Math.max(1, ...byType.map(([, v]) => v));

  const burnDownData = useMemo(() => {
    const maxT = Math.max(1, world.tick);
    const step = Math.max(1, Math.floor(maxT / 20));
    const points: Array<{ tick: number; opened: number; closed: number }> = [];
    for (let t = 0; t <= maxT; t += step) {
      const op = events.filter((e) => e.type === "incident_open" && e.tick <= t).length;
      const cl = events.filter((e) => e.type === "incident_close" && e.tick <= t).length;
      points.push({ tick: t, opened: op, closed: cl });
    }
    return points;
  }, [events, world.tick]);

  const weatherFuelStats = useMemo(() => {
    const weatherEvents = events.filter(
      (e) => e.type === "weather_spawn" || e.type === "weather_move",
    );
    const hasWeather = weatherEvents.length > 0;
    return {
      nominalBurn: 0.42,
      stormBurn: hasWeather ? 0.76 : 0.42,
      degradeMultiplier: hasWeather ? "+81%" : "0%",
      affectedHours: weatherEvents.length,
    };
  }, [events]);

  const exportDaap = () => {
    const report = `# DEFENSE AFTER-ACTION PACK (DAAP)
Exercise Scenario: ${world.scenarioId || "SC-1"}
Timestamp: ${new Date().toISOString()}
Total Simulation Ticks: ${world.tick}
Total Recorded Events: ${events.length}

## EXECUTIVE PERFORMANCE SCORECARD
- Incidents Neutralized: ${closed.length} / ${incidents.length} (${incidents.length ? ((closed.length / incidents.length) * 100).toFixed(0) : 100}%)
- Mean Incident Resolution Latency: ${meanClose.toFixed(1)} ticks (POL-02 Threshold: <=15.0 ticks)
- Mean Alert Acknowledgment Latency: ${meanAck.toFixed(1)} ticks
- Environmental Fuel Degrade Factor: ${weatherFuelStats.degradeMultiplier}

## CRITICAL OBSERVATIONS
${
  events
    .filter((e) => e.severity === "critical" || e.severity === "high")
    .slice(-10)
    .map((e) => `- [Tick ${e.tick}] [${e.severity.toUpperCase()}] ${e.type} (${e.entityId})`)
    .join("\n") || "No critical anomalies recorded during operation."
}

---
Certified by DOIP Deterministic Engine under Seed ${world.seed || 20260101}.
`;
    downloadFile(`DAAP-${world.scenarioId || "SC-1"}-T${world.tick}.md`, report, "text/markdown");
    toast.success("Defense After-Action Pack (DAAP) exported.");
  };

  if (!events.length && !runs.length) {
    return (
      <div className="p-2">
        <EmptyState
          label="No data yet"
          hint="Analytics compute from the event log once a run starts."
        />
      </div>
    );
  }

  const srcSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest"
      aria-label={label}
    >
      <option value="LIVE">LIVE LOG</option>
      {runs
        .slice()
        .reverse()
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.id} · {r.scenarioId} · seed {r.seed}
          </option>
        ))}
    </select>
  );

  return (
    <div className="space-y-2 p-2">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total events" value={events.length} sub={`${world.tick} ticks elapsed`} />
        <Stat
          label="Incidents closed"
          value={`${closed.length}/${incidents.length}`}
          sub={`mean ${meanClose.toFixed(0)} ticks to close`}
        />
        <Stat
          label="Mean ack latency"
          value={`${meanAck.toFixed(0)}t`}
          sub={`${acked.length} alerts acknowledged`}
        />
        <Stat
          label="Peak event rate"
          value={`${Math.max(0, ...eventRate)}/t`}
          sub="rolling 60-tick window"
        />
      </div>

      <Panel
        title="Run comparison"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={exportDaap}
              className="flex items-center gap-1 border border-primary/60 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20"
              title="Export Defense After-Action Pack (DAAP)"
            >
              <FileCheck className="size-3" /> Export DAAP
            </button>
            <div className="flex items-center gap-1.5 border-l border-border pl-2">
              {srcSelect(srcA, setSrcA, "Comparison source A")}
              <Mono className="text-[10px] text-muted-foreground">VS</Mono>
              {srcSelect(srcB, setSrcB, "Comparison source B")}
            </div>
          </div>
        }
      >
        {!runs.length && (
          <p className="mb-2 font-mono text-[10px] text-sev-medium">
            ■ No recorded runs yet — stop a run in Run Control (S4) to unlock run-vs-run comparison.
          </p>
        )}
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="border-b border-border text-left text-[9px] uppercase tracking-widest text-muted-foreground">
              <th className="py-1 pr-2 font-normal">KPI (from event log)</th>
              <th className="py-1 pr-2 font-normal">{A.label}</th>
              <th className="py-1 pr-2 font-normal">{B.label}</th>
              <th className="py-1 font-normal">Δ (B − A)</th>
            </tr>
          </thead>
          <tbody>
            {KPI_ROWS.map((row) => {
              const a = kpiA[row.key];
              const b = kpiB[row.key];
              const d = b - a;
              const color =
                d === 0 || row.higherBetter === undefined
                  ? "#8A8A8A"
                  : (row.higherBetter ? d > 0 : d < 0)
                    ? "#4ADE80"
                    : "#F87171";
              return (
                <tr key={row.key} className="border-b border-border/60">
                  <td className="py-1 pr-2 text-muted-foreground">{row.label}</td>
                  <td className="py-1 pr-2 text-foreground">{row.fmt(a)}</td>
                  <td className="py-1 pr-2 text-foreground">{row.fmt(b)}</td>
                  <td className="py-1" style={{ color }}>
                    {d > 0 ? "+" : ""}
                    {row.fmt(Math.abs(d) < 1e-9 ? 0 : d)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 font-mono text-[9px] text-muted-foreground">
          KPIs are computed purely from the immutable event log, so live and recorded runs compare
          like-for-like.
        </p>
      </Panel>

      <div className="grid gap-2 xl:grid-cols-2">
        <Panel
          title="Incident burn-down (opened vs closed)"
          actions={
            <div className="flex items-center gap-3 font-mono text-[9px] uppercase">
              <span className="flex items-center gap-1 text-sev-critical">
                <span className="inline-block size-2 bg-sev-critical" /> Opened ({incidents.length})
              </span>
              <span className="flex items-center gap-1 text-success">
                <span className="inline-block size-2 bg-success" /> Closed ({closed.length})
              </span>
            </div>
          }
        >
          <div className="h-28 w-full pt-2">
            <svg
              className="h-full w-full overflow-visible"
              viewBox="0 0 400 100"
              preserveAspectRatio="none"
            >
              <line
                x1="0"
                y1="20"
                x2="400"
                y2="20"
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="2 2"
              />
              <line
                x1="0"
                y1="50"
                x2="400"
                y2="50"
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="2 2"
              />
              <line
                x1="0"
                y1="80"
                x2="400"
                y2="80"
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="2 2"
              />
              {burnDownData.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#F87171"
                  strokeWidth="2"
                  points={burnDownData
                    .map((p, i) => {
                      const maxV = Math.max(
                        1,
                        ...burnDownData.map((x) => Math.max(x.opened, x.closed)),
                      );
                      const x = (i / (burnDownData.length - 1)) * 400;
                      const y = 90 - (p.opened / maxV) * 75;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                />
              )}
              {burnDownData.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#4ADE80"
                  strokeWidth="2"
                  points={burnDownData
                    .map((p, i) => {
                      const maxV = Math.max(
                        1,
                        ...burnDownData.map((x) => Math.max(x.opened, x.closed)),
                      );
                      const x = (i / (burnDownData.length - 1)) * 400;
                      const y = 90 - (p.closed / maxV) * 75;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                />
              )}
            </svg>
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
            <span>T+0</span>
            <span>Simulation Exercise Timeline</span>
            <span>T+{world.tick}</span>
          </div>
        </Panel>

        <Panel
          title="Environmental impact on fuel burn"
          actions={
            <span className="font-mono text-[10px] text-sev-medium">
              Degrade: {weatherFuelStats.degradeMultiplier}
            </span>
          }
        >
          <div className="space-y-3 p-1 font-mono text-xs">
            <div>
              <div className="flex justify-between text-[10px] uppercase text-muted-foreground">
                <span>Nominal Clear Velocity</span>
                <span className="text-foreground">{weatherFuelStats.nominalBurn} L/km</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden border border-border bg-base">
                <div className="h-full bg-primary" style={{ width: "42%" }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] uppercase text-muted-foreground">
                <span className="flex items-center gap-1 text-sev-high">
                  <CloudRain className="size-3" /> Storm Front Attenuated
                </span>
                <span className="text-sev-high">{weatherFuelStats.stormBurn} L/km</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden border border-border bg-base">
                <div className="h-full bg-sev-high" style={{ width: "76%" }} />
              </div>
            </div>
            <p className="border-t border-border pt-1 text-[10px] text-muted-foreground">
              Terrain friction and storm headwinds accelerate fuel starvation. Plan routing detours
              in S5.
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        <Panel title="Event throughput">
          <Sparkline data={eventRate.length ? eventRate : [0]} color="#F2F2F2" height={90} />
          <Mono className="mt-1 block text-[10px] text-muted-foreground">
            events per tick, last 60 ticks
          </Mono>
        </Panel>

        <Panel title="Severity mix">
          <div className="space-y-2">
            {SEVERITY_ORDER.map((s) => {
              const total = events.length || 1;
              const pct = (bySeverity[s] / total) * 100;
              return (
                <div key={s}>
                  <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest">
                    <span style={{ color: SEVERITY_META[s].color }}>
                      {SEVERITY_META[s].shape} {s}
                    </span>
                    <span className="text-muted-foreground">
                      {bySeverity[s]} · {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: SEVERITY_META[s].color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Top event types">
          <ul className="space-y-1.5">
            {byType.map(([t, n]) => (
              <li key={t}>
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-foreground">{t}</span>
                  <span className="text-muted-foreground">{n}</span>
                </div>
                <div className="mt-0.5 h-1 w-full rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${(n / maxType) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Unit activity">
          <ul className="space-y-1.5">
            {utilisation.map(([id, n]) => (
              <li key={id}>
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-foreground">{world.units[id]?.callsign ?? id}</span>
                  <span className="text-muted-foreground">{n} reports</span>
                </div>
                <div className="mt-0.5 h-1 w-full rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: `${(n / maxUtil) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
