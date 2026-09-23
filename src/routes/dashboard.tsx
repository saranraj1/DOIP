import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MapView } from "@/components/map/MapView";
import { EmptyState, Panel, SeverityTag, StatStrip, Mono } from "@/components/doip/primitives";
import { SEVERITY_META, SEVERITY_ORDER, canOperate, formatSimClock } from "@/lib/doip";
import { simStore, useSim } from "@/sim/store";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — DOIP" },
      {
        name: "description",
        content:
          "Exercise overview: active units, open incidents by severity, unacknowledged alerts and stock warnings.",
      },
      { property: "og:title", content: "Dashboard — DOIP" },
      {
        property: "og:description",
        content: "Exercise KPIs, module tiles, mini tactical map and the live event feed.",
      },
    ],
  }),
  component: DashboardScreen,
});

function ModuleTile({
  to,
  label,
  value,
  sub,
  warn,
}: {
  to: string;
  label: string;
  value: React.ReactNode;
  sub: string;
  warn?: boolean;
}) {
  return (
    <Link to={to} className="doip-panel block p-2 transition-colors hover:bg-raised">
      <div className="flex items-center justify-between">
        <span className="doip-strip">{label}</span>
        <span className="font-mono text-[10px] text-primary">OPEN →</span>
      </div>
      <div className="doip-key mt-1" style={warn ? { color: "#FBBF24" } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </Link>
  );
}

function DashboardScreen() {
  const world = useSim((s) => s.world);
  const events = useSim((s) => s.events);
  const role = useSim((s) => s.role);
  const userName = useSim((s) => s.userName);

  const units = useMemo(() => Object.values(world.units), [world.units]);
  const incidents = useMemo(() => Object.values(world.incidents), [world.incidents]);
  const alerts = useMemo(() => Object.values(world.alerts), [world.alerts]);
  const depots = useMemo(() => Object.values(world.depots), [world.depots]);
  const openBySeverity = useMemo(() => {
    const m: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    incidents.filter((i) => i.open).forEach((i) => (m[i.severity] = (m[i.severity] ?? 0) + 1));
    return m;
  }, [incidents]);
  const unacked = alerts.filter((a) => !a.acked);
  const stockWarnings = depots.filter(
    (d) =>
      d.stock.fuel < 900 || d.stock.medkit < 25 || d.stock.rations < 120 || d.stock.battery < 40,
  );
  const recent = useMemo(() => events.slice(-40).reverse(), [events]);

  // Module tiles (Ch18 S2): logistics / personnel / weather roll-ups.
  const worstDepotPct = useMemo(() => {
    if (!depots.length) return 100;
    return (
      Math.min(
        ...depots.flatMap((d) => [
          d.stock.fuel / d.capacity.fuel,
          d.stock.medkit / d.capacity.medkit,
          d.stock.rations / d.capacity.rations,
          d.stock.battery / d.capacity.battery,
        ]),
      ) * 100
    );
  }, [depots]);
  const personnel = useMemo(() => Object.values(world.personnel), [world.personnel]);
  const strained = personnel.filter((p) => p.heartRate > 150 || p.fatigue > 0.8).length;
  const weatherCells = useMemo(() => Object.values(world.weather), [world.weather]);
  const peakIntensity = weatherCells.length
    ? Math.max(...weatherCells.map((w) => w.intensity)) * 100
    : 0;

  // Composite Readiness Health Index (CRHI) [0..100%]
  const crhi = useMemo(() => {
    let score = 100;
    const openIncs = incidents.filter((i) => i.open);
    const critIncs = openIncs.filter((i) => i.severity === "critical").length;
    const highIncs = openIncs.filter((i) => i.severity === "high").length;
    score -= critIncs * 15 + highIncs * 8 + (openIncs.length - critIncs - highIncs) * 3;
    score -= Math.min(25, strained * 6);
    score -= stockWarnings.length * 8;
    const staleUnits = units.filter((u) => u.status === "stale").length;
    score -= staleUnits * 10;
    return Math.max(5, Math.min(100, Math.round(score)));
  }, [incidents, strained, stockWarnings, units]);

  if (!units.length) {
    return (
      <div className="p-2">
        <EmptyState label="No active run" hint="Start a scenario in Run Control (S4)." />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <StatStrip
        items={[
          {
            label: "CRHI Index",
            value: `${crhi}%`,
            sub: crhi > 75 ? "Optimal readiness" : crhi > 50 ? "Degraded" : "Critical stress",
            accent: crhi > 75 ? "#4ADE80" : crhi > 50 ? "#FBBF24" : "#F87171",
          },
          {
            label: "Active units",
            value: units.length,
            sub: `${units.filter((u) => u.status === "slowed").length} slowed`,
          },
          {
            label: "Open incidents",
            value: incidents.filter((i) => i.open).length,
            sub: (
              <span className="flex gap-1">
                {SEVERITY_ORDER.map((sv) => (
                  <span
                    key={sv}
                    className="font-mono text-[11px]"
                    style={{ color: SEVERITY_META[sv].color }}
                  >
                    {SEVERITY_META[sv].shape}
                    {openBySeverity[sv] ?? 0}
                  </span>
                ))}
              </span>
            ),
          },
          {
            label: "Unacked",
            value: unacked.length,
            ...(unacked.some((a) => a.severity === "critical") ? { accent: "#F87171" } : {}),
            sub: `${unacked.filter((a) => a.severity === "critical").length} crit`,
          },
          { label: "Stock warn", value: stockWarnings.length, sub: `${depots.length} depots` },
          { label: "Sim tick", value: world.tick, sub: formatSimClock(world.tick) },
        ]}
      />

      <div className="grid gap-2 sm:grid-cols-3">
        <ModuleTile
          to="/logistics"
          label="Logistics"
          value={`${worstDepotPct.toFixed(0)}%`}
          sub={`lowest depot stock line · ${stockWarnings.length} warning(s)`}
          warn={worstDepotPct < 45}
        />
        <ModuleTile
          to="/personnel"
          label="Personnel"
          value={`${strained}/${personnel.length}`}
          sub="strained (HR > 150 or fatigue > 80%)"
          warn={strained > 0}
        />
        <ModuleTile
          to="/"
          label="Weather"
          value={weatherCells.length}
          sub={
            weatherCells.length
              ? `active cell(s) · peak intensity ${peakIntensity.toFixed(0)}%`
              : "no active cells · view on live map"
          }
          warn={peakIntensity > 70}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[70fr_30fr]">
        <Panel title="Tactical overview" bodyClassName="p-0" className="min-h-[420px]">
          <MapView
            units={units}
            incidents={incidents.filter((i) => i.open)}
            weather={Object.values(world.weather)}
            zones={world.zones}
            tick={world.tick}
            zoom={11}
          />
        </Panel>

        <div className="doip-panel flex min-h-0 flex-col">
          <header className="flex h-6 shrink-0 items-center justify-between border-b border-border bg-raised/30 px-2">
            <span className="doip-strip">Unacknowledged alerts</span>
            <span className="doip-strip">{unacked.length}</span>
          </header>
          <div
            className={
              unacked.length ? "min-h-0 flex-[0_0_45%] overflow-y-auto" : "shrink-0 overflow-hidden"
            }
          >
            {unacked.length === 0 ? (
              <div className="p-2 doip-strip">All alerts acknowledged</div>
            ) : (
              <ul>
                {unacked
                  .slice()
                  .sort((a, b) => SEVERITY_META[a.severity].order - SEVERITY_META[b.severity].order)
                  .map((a) => {
                    const elapsed = world.tick - a.tick;
                    const isAging = elapsed >= 10;
                    return (
                      <li
                        key={a.id}
                        className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1"
                      >
                        <SeverityTag severity={a.severity} showLabel={false} pulse />
                        <span className="min-w-0 flex-1 truncate text-[11px]">{a.message}</span>
                        {isAging && (
                          <span className="font-mono text-[9px] px-1 bg-amber-950/40 border border-amber-500/40 text-amber-400 shrink-0">
                            +{elapsed}t
                          </span>
                        )}
                        <Mono className="text-[11px]">T+{a.tick}</Mono>
                        <button
                          onClick={() => {
                            if (!canOperate(role)) {
                              toast.error("Read-only role");
                              return;
                            }
                            simStore.ackAlert(a.id, userName);
                            toast.success("Acknowledged");
                          }}
                          className="border border-border px-1 font-mono text-[11px] hover:bg-raised doip-btn-primary"
                        >
                          ACK <span className="text-muted-foreground">[A]</span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>

          <header className="flex h-6 shrink-0 items-center justify-between border-y border-border bg-raised/30 px-2">
            <span className="doip-strip">Recent events</span>
            <Link to="/replay" className="doip-strip text-primary">
              Replay →
            </Link>
          </header>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {recent.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-1.5 px-2 py-0.5 font-mono text-[11px]"
              >
                <span className="text-muted-foreground">{formatSimClock(e.tick)}</span>
                <SeverityTag severity={e.severity} showLabel={false} />
                <span className="text-mono truncate">{e.type}</span>
                <span className="ml-auto text-muted-foreground/60">[e:{e.id}]</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
