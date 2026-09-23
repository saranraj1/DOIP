import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, SeverityTag, AiBadge } from "@/components/doip/primitives";
import { Sparkline } from "@/components/doip/Sparkline";
import { useSim } from "@/sim/store";
import { cn } from "@/lib/utils";
import { canOperate, formatSimClock } from "@/lib/doip";
import { taskStore } from "@/sim/tasks";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { HeartPulse, ShieldAlert, Clock, ArrowRight, UserCheck, Activity } from "lucide-react";
import type { Person } from "@/sim/types";

export const Route = createFileRoute("/personnel")({
  head: () => ({
    meta: [
      { title: "Personnel — DOIP" },
      {
        name: "description",
        content:
          "Biometric readiness board: heart-rate bands, fatigue trends and suggested crew rotations.",
      },
      { property: "og:title", content: "Personnel — DOIP" },
      {
        property: "og:description",
        content: "Live vitals per soldier with rotation recommendations.",
      },
    ],
  }),
  component: PersonnelScreen,
});

const band = (hr: number, fatigue: number) => {
  if (hr > 150 || fatigue > 80)
    return { label: "CRITICAL", severity: "critical" as const, color: "#F87171" };
  if (hr > 130 || fatigue > 60)
    return { label: "ELEVATED", severity: "high" as const, color: "#FB923C" };
  if (hr > 110 || fatigue > 40)
    return { label: "WATCH", severity: "medium" as const, color: "#FBBF24" };
  return { label: "NOMINAL", severity: "low" as const, color: "#4ADE80" };
};

const WATCH_SHIFTS = [
  { name: "WATCH ALPHA", hours: "0000 - 0600Z", status: "STANDBY / REST", active: false },
  { name: "WATCH BRAVO", hours: "0600 - 1200Z", status: "ON PATROL / ACTIVE", active: true },
  { name: "WATCH CHARLIE", hours: "1200 - 1800Z", status: "READY RESERVE", active: false },
  { name: "WATCH DELTA", hours: "1800 - 2400Z", status: "ROTATION PREP", active: false },
];

function PersonnelScreen() {
  const world = useSim((s) => s.world);
  const role = useSim((s) => s.role);
  const [filter, setFilter] = useState<"all" | "attention">("all");

  const people = useMemo(() => Object.values(world.personnel), [world.personnel]);
  const rows = useMemo(() => {
    const list = people.map((p) => ({ p, b: band(p.heartRate, p.fatigue) }));
    return filter === "attention"
      ? list.filter((r) => r.b.severity === "high" || r.b.severity === "critical")
      : list;
  }, [people, filter]);

  const rotations = useMemo(
    () =>
      people
        .filter((p) => p.fatigue > 62)
        .sort((a, b) => b.fatigue - a.fatigue)
        .slice(0, 5),
    [people],
  );

  const stats = useMemo(() => {
    const total = people.length;
    if (!total) return { total: 0, nominalPct: 100, criticalCount: 0 };
    const nominal = people.filter((p) => p.heartRate <= 110 && p.fatigue <= 40).length;
    const critical = people.filter((p) => p.heartRate > 150 || p.fatigue > 80).length;
    return {
      total,
      nominalPct: Math.round((nominal / total) * 100),
      criticalCount: critical,
    };
  }, [people]);

  const handleDispatchMedevac = (p: Person) => {
    if (!canOperate(role)) {
      toast.error("Read-only role", {
        description: "Dispatching casualty evacuation requires operator access.",
      });
      return;
    }
    const sector = world.units[p.unitId]?.sector ?? "Alpha";
    taskStore.add({
      text: `[MEDEVAC SOP-02] Urgent casualty evacuation for ${p.rank} ${p.name} from ${p.unitId}. Heart Rate: ${Math.round(p.heartRate)} BPM.`,
      assignee: "Medevac Team 1",
      sector,
      tick: world.tick,
    });
    toast.success("SOP-02 Casualty Evacuation Protocol Dispatched", {
      description: `Task created on War-Room Task Board for ${p.rank} ${p.name}. Cited § SOP-02.`,
    });
  };

  if (!people.length) {
    return (
      <div className="p-2">
        <EmptyState label="No personnel telemetry" hint="Start a scenario in Run Control (S4)." />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      {/* Top Shift Schedule Timeline & Biometrics Summary */}
      <div className="grid gap-2 lg:grid-cols-3">
        <div className="lg:col-span-2 border border-border bg-base p-2.5 space-y-2">
          <div className="flex items-center justify-between border-b border-border/70 pb-1.5 font-mono text-xs">
            <span className="font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="size-3.5 text-primary" /> Shift Schedule Timeline (24H Watch Cycle)
            </span>
            <span className="text-[10px] text-muted-foreground">
              CURRENT SIM TIME: {formatSimClock(world.tick)}Z
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono text-[10px]">
            {WATCH_SHIFTS.map((w) => (
              <div
                key={w.name}
                className={cn(
                  "border p-1.5 rounded transition-all",
                  w.active
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border/60 bg-raised/40 text-muted-foreground",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("font-semibold", w.active && "text-primary")}>{w.name}</span>
                  {w.active && (
                    <span className="text-[9px] bg-primary text-primary-foreground px-1 py-0.2 rounded font-semibold uppercase">
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{w.hours}</div>
                <div className="text-[9px] font-semibold mt-1 truncate">{w.status}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-border bg-base p-2.5 space-y-2 font-mono">
          <div className="flex items-center justify-between border-b border-border/70 pb-1.5 text-xs">
            <span className="font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="size-3.5 text-primary" /> Biometric Health Index
            </span>
            <span className="text-primary font-semibold">{stats.nominalPct}% NOMINAL</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center pt-1">
            <div className="border border-border/60 bg-raised/40 p-1.5">
              <span className="block text-[9px] text-muted-foreground">TOTAL CADRE</span>
              <span className="text-sm font-semibold text-foreground">{stats.total}</span>
            </div>
            <div className="border border-border/60 bg-raised/40 p-1.5">
              <span className="block text-[9px] text-muted-foreground">NOMINAL</span>
              <span className="text-sm font-semibold text-success">{stats.nominalPct}%</span>
            </div>
            <div className="border border-border/60 bg-raised/40 p-1.5">
              <span className="block text-[9px] text-muted-foreground">CRITICAL</span>
              <span
                className={cn(
                  "text-sm font-semibold",
                  stats.criticalCount > 0 ? "text-destructive animate-pulse" : "text-foreground",
                )}
              >
                {stats.criticalCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Readiness Board + Rotation Suggestions */}
      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Biometric readiness board"
          actions={
            <div className="flex gap-1">
              {(["all", "attention"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest transition-colors",
                    filter === f
                      ? "border-primary/60 bg-raised text-primary font-semibold"
                      : "border-border text-muted-foreground hover:bg-raised",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map(({ p, b }) => {
              const isCrit = b.severity === "critical" || p.fatigue > 78 || p.heartRate > 148;
              return (
                <div key={p.id} className="border border-border p-2 bg-base">
                  <div className="flex items-center gap-2">
                    <SeverityTag
                      severity={b.severity}
                      showLabel={false}
                      pulse={b.severity === "critical"}
                    />
                    <span className="truncate text-xs font-semibold text-foreground">
                      {p.rank} {p.name}
                    </span>
                    <Mono className="ml-auto text-[10px] text-muted-foreground">{p.unitId}</Mono>
                  </div>
                  <div className="mt-2 flex items-end gap-2">
                    <div>
                      <div
                        className="font-mono text-lg leading-none font-semibold"
                        style={{ color: b.color }}
                      >
                        {Math.round(p.heartRate)}
                      </div>
                      <Mono className="text-[10px] text-muted-foreground">BPM</Mono>
                    </div>
                    <div>
                      <div className="font-mono text-lg leading-none font-semibold text-foreground">
                        {Math.round(p.fatigue)}
                      </div>
                      <Mono className="text-[10px] text-muted-foreground">FATIGUE</Mono>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Sparkline data={p.history.slice(-60)} color={b.color} height={30} />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-1.5 font-mono text-[10px]">
                    <span style={{ color: b.color }} className="font-semibold">
                      {b.label}
                    </span>
                    {isCrit && (
                      <button
                        onClick={() => handleDispatchMedevac(p)}
                        className="flex items-center gap-1 border border-destructive/60 bg-destructive/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-destructive font-semibold hover:bg-destructive/20 transition-colors"
                        title="Dispatch immediate casualty evacuation task citing § SOP-02"
                      >
                        <HeartPulse className="size-3 animate-pulse" />
                        <span>SOP-02 MEDEVAC</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {!rows.length && <EmptyState label="No personnel need attention" />}
          </div>
        </Panel>

        <Panel
          variant="ai"
          title="Rotation suggestions"
          actions={
            <div className="flex items-center gap-2">
              <Link
                to="/warroom"
                className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
              >
                Task board →
              </Link>
              <AiBadge label="HEURISTIC" />
            </div>
          }
        >
          {rotations.length === 0 ? (
            <EmptyState label="No rotations required" hint="Suggested above 62% fatigue." />
          ) : (
            <ul className="space-y-2">
              {rotations.map((p) => (
                <li key={p.id} className="border border-border p-2 bg-base">
                  <div className="text-xs font-semibold text-foreground">
                    {p.rank} {p.name}
                  </div>
                  <Mono className="text-[10px] text-muted-foreground">
                    {p.unitId} · fatigue {Math.round(p.fatigue)} · HR {Math.round(p.heartRate)}
                  </Mono>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                    Recommend stand-down at next waypoint; rotate a nominal crew member into{" "}
                    {p.unitId}.
                  </p>
                  <button
                    onClick={() => {
                      if (!canOperate(role)) {
                        toast.error("Read-only role", {
                          description: "Creating tasks requires operator access.",
                        });
                        return;
                      }
                      taskStore.add({
                        text: `Rotate ${p.rank} ${p.name} out of ${p.unitId} (fatigue ${Math.round(p.fatigue)}%)`,
                        assignee: "Sgt. P. Kulkarni",
                        sector: world.units[p.unitId]?.sector ?? "—",
                        tick: world.tick,
                      });
                      toast.success("Task created on the war-room board (S14)");
                    }}
                    className="mt-1.5 w-full border border-border py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-raised doip-btn-primary"
                  >
                    Create task → S14
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
