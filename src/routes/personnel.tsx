import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, SeverityTag, AiBadge } from "@/components/doip/primitives";
import { Sparkline } from "@/components/doip/Sparkline";
import { useSim } from "@/sim/store";
import { cn } from "@/lib/utils";
import { canOperate } from "@/lib/doip";
import { taskStore } from "@/sim/tasks";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/personnel")({
  head: () => ({
    meta: [
      { title: "Personnel — DOIP" },
      {
        name: "description",
        content: "Biometric readiness board: heart-rate bands, fatigue trends and suggested crew rotations.",
      },
      { property: "og:title", content: "Personnel — DOIP" },
      { property: "og:description", content: "Live vitals per soldier with rotation recommendations." },
    ],
  }),
  component: PersonnelScreen,
});

const band = (hr: number, fatigue: number) => {
  if (hr > 150 || fatigue > 80) return { label: "CRITICAL", severity: "critical" as const, color: "#F87171" };
  if (hr > 130 || fatigue > 60) return { label: "ELEVATED", severity: "high" as const, color: "#FB923C" };
  if (hr > 110 || fatigue > 40) return { label: "WATCH", severity: "medium" as const, color: "#FBBF24" };
  return { label: "NOMINAL", severity: "low" as const, color: "#4ADE80" };
};

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

  if (!people.length) {
    return (
      <div className="p-2">
        <EmptyState label="No personnel telemetry" hint="Start a scenario in Run Control (S4)." />
      </div>
    );
  }

  return (
    <div className="grid gap-2 p-2 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel
        title="Readiness board"
        actions={
          <div className="flex gap-1">
            {(["all", "attention"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  " border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
                  filter === f ? "border-primary/60 bg-raised text-primary" : "border-border text-muted-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map(({ p, b }) => (
            <div key={p.id} className=" border border-border p-2">
              <div className="flex items-center gap-2">
                <SeverityTag severity={b.severity} showLabel={false} pulse={b.severity === "critical"} />
                <span className="truncate text-xs font-semibold text-foreground">
                  {p.rank} {p.name}
                </span>
                <Mono className="ml-auto text-[10px] text-muted-foreground">{p.unitId}</Mono>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div>
                  <div className="font-mono text-lg leading-none" style={{ color: b.color }}>
                    {Math.round(p.heartRate)}
                  </div>
                  <Mono className="text-[10px] text-muted-foreground">BPM</Mono>
                </div>
                <div>
                  <div className="font-mono text-lg leading-none text-foreground">{Math.round(p.fatigue)}</div>
                  <Mono className="text-[10px] text-muted-foreground">FATIGUE</Mono>
                </div>
                <div className="min-w-0 flex-1">
                  <Sparkline data={p.history.slice(-60)} color={b.color} height={30} />
                </div>
              </div>
              <span className="mt-1 block font-mono text-[10px]" style={{ color: b.color }}>
                {b.label}
              </span>
            </div>
          ))}
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
              <li key={p.id} className=" border border-border p-2">
                <div className="text-xs text-foreground">
                  {p.rank} {p.name}
                </div>
                <Mono className="text-[10px] text-muted-foreground">
                  {p.unitId} · fatigue {Math.round(p.fatigue)} · HR {Math.round(p.heartRate)}
                </Mono>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Recommend stand-down at next waypoint; rotate a nominal crew member into {p.unitId}.
                </p>
                <button
                  onClick={() => {
                    if (!canOperate(role)) {
                      toast.error("Read-only role", { description: "Creating tasks requires operator access." });
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
  );
}
