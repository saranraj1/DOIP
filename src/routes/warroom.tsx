import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MapView } from "@/components/map/MapView";
import { EmptyState, Panel, Mono, SeverityTag } from "@/components/doip/primitives";
import { useSim } from "@/sim/store";
import { formatSimClock, canOperate } from "@/lib/doip";
import { mulberry32 } from "@/sim/prng";
import { taskStore, useTasks, type TaskStatus } from "@/sim/tasks";
import { cn } from "@/lib/utils";
import { Send, Pin, Plus, AlertTriangle, CheckCircle2, ShieldAlert, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/warroom")({
  head: () => ({
    meta: [
      { title: "War-Room — DOIP" },
      {
        name: "description",
        content:
          "Shared tactical picture with live participant cursors, a sector-scoped task board, pinned items and a decision log.",
      },
      { property: "og:title", content: "War-Room — DOIP" },
      {
        property: "og:description",
        content: "Collaborative command surface for the exercise staff.",
      },
    ],
  }),
  component: WarRoomScreen,
});

const PARTICIPANTS = [
  { id: "p1", name: "Col. A. Verma", color: "#FFFFFF", role: "admin" },
  { id: "p2", name: "Maj. R. Sethi", color: "#8A8A8A", role: "planner" },
  { id: "p3", name: "Sgt. P. Kulkarni", color: "#FBBF24", role: "operator" },
  { id: "p4", name: "Obs. L. Fernandes", color: "#A78BFA", role: "viewer" },
];

const TASK_PRESETS = [
  { text: "Sector Recon Patrol", assignee: "Maj. R. Sethi" },
  { text: "Fuel Depot Resupply", assignee: "Sgt. P. Kulkarni" },
  { text: "Air Defense Radar Check", assignee: "Col. A. Verma" },
];

interface Msg {
  id: number;
  author: string;
  color: string;
  text: string;
  tick: number;
}

// Ch18 S14: task board state is shared (src/sim/tasks.ts) so Personnel Health (S11)
// can create rotation tasks that land on this board.
const STATUS_STYLE: Record<TaskStatus, string> = {
  open: "border-border text-muted-foreground",
  doing: "border-sev-medium/60 text-sev-medium",
  done: "border-success/60 text-success line-through",
};

function WarRoomScreen() {
  const world = useSim((s) => s.world);
  const role = useSim((s) => s.role);
  const userName = useSim((s) => s.userName);
  const [draft, setDraft] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [phase, setPhase] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const decisionRef = useRef<HTMLInputElement>(null);

  const sectors = useMemo(() => {
    const s = new Set<string>();
    Object.values(world.units).forEach((u) => u.sector && s.add(u.sector));
    return [...s].sort();
  }, [world.units]);

  const tasks = useTasks();
  const [taskDraft, setTaskDraft] = useState("");
  const [taskAssignee, setTaskAssignee] = useState(PARTICIPANTS[2]!.name);
  const [taskSector, setTaskSector] = useState("");
  const [sectorFilter, setSectorFilter] = useState("ALL");

  // Keep taskSector aligned with valid sectors
  useEffect(() => {
    if (sectors.length > 0 && (!taskSector || !sectors.includes(taskSector))) {
      setTaskSector(sectorFilter !== "ALL" && sectors.includes(sectorFilter) ? sectorFilter : sectors[0]!);
    }
  }, [sectors, taskSector, sectorFilter]);

  useEffect(() => {
    const t = setInterval(() => setPhase((p) => p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const cursors = useMemo(() => {
    const center = Object.values(world.units)[0];
    if (!center) return [];
    return PARTICIPANTS.slice(0, 3).map((p, i) => {
      const rand = mulberry32(i + 1);
      const a = (phase / 12) * (i + 1) + rand() * 6;
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        lat: center.lat + Math.sin(a) * 0.05,
        lon: center.lon + Math.cos(a) * 0.06,
      };
    });
  }, [world.units, phase]);

  const openIncidents = useMemo(
    () => Object.values(world.incidents).filter((i) => i.open),
    [world.incidents],
  );

  const incidentSector = useCallback(
    (entityId: string) => world.units[entityId]?.sector ?? "—",
    [world.units],
  );

  const visibleIncidents = useMemo(
    () =>
      sectorFilter === "ALL"
        ? openIncidents
        : openIncidents.filter((i) => incidentSector(i.entityId) === sectorFilter),
    [openIncidents, sectorFilter, incidentSector],
  );
  const visibleTasks =
    sectorFilter === "ALL" ? tasks : tasks.filter((t) => t.sector === sectorFilter);

  const ccirItems = useMemo(() => {
    const units = Object.values(world.units);
    const minFuel = units.length > 0 ? Math.min(...units.map((u) => u.fuel)) : 100;
    const staleUnits = units.filter((u) => u.status === "stale" || world.tick - u.lastSeenTick > 6);
    const weatherList = Object.values(world.weather);
    const maxWeather =
      weatherList.length > 0 ? Math.max(...weatherList.map((w) => w.intensity)) : 0;

    return [
      {
        id: "ccir-1",
        code: "CCIR-1",
        title: "Fleet Fuel Reserve > 30%",
        status:
          minFuel < 30
            ? ("UNMET" as const)
            : minFuel < 50
              ? ("MONITORED" as const)
              : ("SATISFIED" as const),
        metric: `Min Fuel: ${minFuel.toFixed(0)}%`,
      },
      {
        id: "ccir-2",
        code: "CCIR-2",
        title: "Positive C2 Link (Active)",
        status:
          staleUnits.length > 0
            ? ("UNMET" as const)
            : units.some((u) => u.status === "slowed")
              ? ("MONITORED" as const)
              : ("SATISFIED" as const),
        metric:
          staleUnits.length === 0
            ? "100% C2 Active"
            : `${staleUnits.length} Link Drop${staleUnits.length > 1 ? "s" : ""}`,
      },
      {
        id: "ccir-3",
        code: "CCIR-3",
        title: "Severe Weather Clearance",
        status:
          maxWeather >= 0.6
            ? ("UNMET" as const)
            : maxWeather >= 0.2
              ? ("MONITORED" as const)
              : ("SATISFIED" as const),
        metric: `Peak Cell: ${(maxWeather * 100).toFixed(0)}%`,
      },
    ];
  }, [world.units, world.weather, world.tick]);

  if (!Object.keys(world.units).length) {
    return (
      <div className="p-2">
        <EmptyState label="War-room idle" hint="Start a scenario in Run Control (S4) to convene." />
      </div>
    );
  }

  const handleSectorFilterChange = (filter: string) => {
    setSectorFilter(filter);
    if (filter !== "ALL" && sectors.includes(filter)) {
      setTaskSector(filter);
    }
  };

  const send = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canOperate(role)) {
      toast.error("Read-only role", {
        description: "Recording decisions requires Operator, Planner, or Admin role.",
      });
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.warning("Empty decision", {
        description: "Please enter decision text to log.",
      });
      decisionRef.current?.focus();
      return;
    }
    setMsgs((m) => [
      ...m,
      {
        id: m.length + 1,
        author: userName || "You",
        color: "#FFFFFF",
        text: trimmed,
        tick: world.tick,
      },
    ]);
    setDraft("");
    toast.success("Decision recorded to AAR audit log");
  };

  const handleTaskDraftChange = (text: string) => {
    setTaskDraft(text);
    const lower = text.toLowerCase();
    if (lower.includes("fuel") || lower.includes("supply") || lower.includes("medevac")) {
      setTaskAssignee(PARTICIPANTS[2]!.name); // Operator
    } else if (lower.includes("route") || lower.includes("plan") || lower.includes("corridor")) {
      setTaskAssignee(PARTICIPANTS[1]!.name); // Planner
    }
  };

  const applyPreset = (preset: { text: string; assignee: string }) => {
    if (!canOperate(role)) {
      toast.error("Read-only role", {
        description: "Task assignment requires Operator, Planner, or Admin access.",
      });
      return;
    }
    setTaskDraft(preset.text);
    setTaskAssignee(preset.assignee);
    inputRef.current?.focus();
    toast.info(`Template loaded: "${preset.text}"`);
  };

  const addTask = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canOperate(role)) {
      toast.error("Read-only role", {
        description: "Task assignment requires Operator, Planner, or Admin role.",
      });
      return;
    }
    const trimmed = taskDraft.trim();
    if (!trimmed) {
      toast.warning("Task description required", {
        description: "Please enter a task description in the box or select a quick template.",
      });
      inputRef.current?.focus();
      return;
    }

    const chosenSector = taskSector || (sectorFilter !== "ALL" ? sectorFilter : sectors[0]) || "ALPHA";
    const created = taskStore.add({
      text: trimmed,
      assignee: taskAssignee || PARTICIPANTS[2]!.name,
      sector: chosenSector,
      tick: world.tick,
    });
    setTaskDraft("");

    if (sectorFilter !== "ALL" && sectorFilter !== chosenSector) {
      setSectorFilter("ALL");
      toast.success(`Task created: "${created.text}"`, {
        description: `Sector filter changed to ALL to display task in Sector ${chosenSector}.`,
      });
    } else {
      toast.success(`Task created: "${created.text}"`, {
        description: `Assigned to ${created.assignee} · Sector ${chosenSector}`,
      });
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      {/* CCIR Priority Board */}
      <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-3">
        {ccirItems.map((c) => (
          <div
            key={c.id}
            className={cn(
              "flex items-center justify-between border px-3 py-1.5 transition-colors",
              c.status === "UNMET"
                ? "border-sev-critical/60 bg-sev-critical/10 text-sev-critical"
                : c.status === "MONITORED"
                  ? "border-sev-medium/60 bg-sev-medium/10 text-sev-medium"
                  : "border-success/60 bg-success/10 text-success",
            )}
          >
            <div className="flex items-center gap-2">
              {c.status === "UNMET" ? (
                <AlertTriangle className="size-3.5" />
              ) : c.status === "MONITORED" ? (
                <ShieldAlert className="size-3.5" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              <div>
                <span className="font-mono text-[9px] uppercase tracking-wider opacity-75">
                  {c.code}
                </span>
                <p className="text-[11px] font-medium leading-tight text-foreground">{c.title}</p>
              </div>
            </div>
            <div className="text-right">
              <span
                className={cn(
                  "font-mono text-[9px] font-bold uppercase tracking-widest",
                  c.status === "UNMET"
                    ? "text-sev-critical"
                    : c.status === "MONITORED"
                      ? "text-sev-medium"
                      : "text-success",
                )}
              >
                {c.status}
              </span>
              <p className="font-mono text-[10px] text-muted-foreground">{c.metric}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-h-0 flex-col gap-2">
          <Panel
            title="Shared tactical picture"
            actions={
              <div className="flex items-center gap-2">
                <select
                  value={sectorFilter}
                  onChange={(e) => handleSectorFilterChange(e.target.value)}
                  className="border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest"
                  aria-label="Sector filter"
                >
                  <option value="ALL">ALL SECTORS</option>
                  {sectors.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <div className="flex -space-x-1.5">
                  {PARTICIPANTS.map((p) => (
                    <span
                      key={p.id}
                      title={`${p.name} · ${p.role}`}
                      className="flex size-5 items-center justify-center rounded-full border border-border font-mono text-[9px] text-background"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.name.split(" ").pop()!.slice(0, 1)}
                    </span>
                  ))}
                </div>
              </div>
            }
            bodyClassName="p-0 h-[420px]"
          >
            <MapView
              units={Object.values(world.units)}
              incidents={openIncidents}
              weather={Object.values(world.weather)}
              zones={world.zones}
              tick={world.tick}
              cursors={cursors}
            />
          </Panel>

          <Panel
            title={`Task board · ${sectorFilter === "ALL" ? "all sectors" : sectorFilter}`}
            actions={
              <Mono className="text-[10px] text-muted-foreground">
                {visibleTasks.filter((t) => t.status !== "done").length} OPEN ·{" "}
                {visibleTasks.length} TOTAL
              </Mono>
            }
          >
            <form onSubmit={addTask} className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                <input
                  ref={inputRef}
                  value={taskDraft}
                  onChange={(e) => handleTaskDraftChange(e.target.value)}
                  placeholder={canOperate(role) ? "Enter new tactical task (e.g. Recon patrol)…" : "Read-only role (viewing only)"}
                  className="min-w-0 flex-1 border border-border bg-base px-2 py-1 text-xs outline-none focus:border-primary/60"
                />
                <select
                  value={taskAssignee}
                  onChange={(e) => setTaskAssignee(e.target.value)}
                  disabled={!canOperate(role)}
                  className="border border-border bg-background px-1.5 py-1 font-mono text-[10px]"
                  aria-label="Assignee"
                >
                  {PARTICIPANTS.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={taskSector || (sectors[0] ?? "")}
                  onChange={(e) => setTaskSector(e.target.value)}
                  disabled={!canOperate(role)}
                  className="border border-border bg-background px-1.5 py-1 font-mono text-[10px]"
                  aria-label="Sector"
                >
                  {sectors.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="flex items-center gap-1 bg-primary px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all cursor-pointer shadow-sm"
                  title={canOperate(role) ? "Add tactical task (Enter)" : "Read-only role"}
                >
                  <Plus className="size-3" /> Add
                </button>
              </div>

              {/* Quick Template Chips */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="size-2.5 text-primary" /> Quick:
                </span>
                {TASK_PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="border border-border bg-surface hover:bg-accent/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    + {p.text.split(" ")[0]} {p.text.split(" ")[1] ?? ""}
                  </button>
                ))}
              </div>
            </form>

            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {visibleTasks
                .slice()
                .reverse()
                .map((t) => (
                  <li key={t.id} className="flex items-center gap-2 border border-border p-1.5 bg-surface/30">
                    <button
                      type="button"
                      onClick={() => {
                        if (!canOperate(role)) {
                          toast.error("Read-only role", { description: "Cannot change task status." });
                          return;
                        }
                        taskStore.advance(t.id);
                        toast.info(`Task status updated: "${t.text}"`);
                      }}
                      className={cn(
                        "border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest cursor-pointer transition-colors",
                        STATUS_STYLE[t.status],
                      )}
                      title="Click to advance status (open → doing → done)"
                    >
                      {t.status}
                    </button>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[11px]",
                        t.status === "done" && "text-muted-foreground line-through opacity-70",
                      )}
                    >
                      {t.text}
                    </span>
                    <Mono className="text-[9px] text-muted-foreground">
                      {t.assignee.split(" ").pop()} · {t.sector}
                    </Mono>
                    {canOperate(role) && (
                      <button
                        type="button"
                        onClick={() => {
                          taskStore.delete(t.id);
                          toast.info(`Task removed from board`);
                        }}
                        className="text-muted-foreground/50 hover:text-sev-critical p-0.5 transition-colors cursor-pointer"
                        title="Delete task"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
              {!visibleTasks.length && (
                <EmptyState
                  label="No tasks"
                  hint={
                    sectorFilter === "ALL"
                      ? "Add the first task above or select a quick template."
                      : "No tasks in this sector."
                  }
                />
              )}
            </ul>
          </Panel>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <Panel
            title={`Pinned items · ${sectorFilter === "ALL" ? "all sectors" : sectorFilter}`}
            bodyClassName="p-2"
          >
            {visibleIncidents.length === 0 ? (
              <EmptyState
                label="Nothing to pin"
                {...(sectorFilter !== "ALL" ? { hint: "No open incidents in this sector." } : {})}
              />
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {visibleIncidents.slice(0, 8).map((i) => (
                  <li key={i.id} className="flex items-center gap-2 border border-border p-1.5">
                    <SeverityTag severity={i.severity} showLabel={false} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                      {i.kind} · {i.entityId} · {incidentSector(i.entityId)}
                    </span>
                    <button
                      onClick={() =>
                        setPins((p) =>
                          p.includes(i.id) ? p.filter((x) => x !== i.id) : [...p, i.id],
                        )
                      }
                      className=" border border-border px-1.5 py-0.5"
                      aria-label="Pin incident"
                    >
                      <Pin
                        className="size-3"
                        style={{ color: pins.includes(i.id) ? "#FFFFFF" : undefined }}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Decision log" bodyClassName="flex min-h-0 flex-1 flex-col p-2">
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {msgs.map((m) => (
                <li key={m.id} className=" border border-border p-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px]" style={{ color: m.color }}>
                      {m.author}
                    </span>
                    <Mono className="ml-auto text-[10px] text-muted-foreground">
                      {formatSimClock(m.tick)}
                    </Mono>
                  </div>
                  <p className="mt-0.5 text-[12px] text-foreground">{m.text}</p>
                </li>
              ))}
              {!msgs.length && (
                <EmptyState label="No entries" hint="Log decisions so the AAR has context." />
              )}
            </ul>
            <form onSubmit={send} className="mt-2 flex gap-1.5">
              <input
                ref={decisionRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={canOperate(role) ? "Record a decision…" : "Read-only role"}
                className="min-w-0 flex-1 border border-border bg-base px-2 py-1.5 text-xs outline-none focus:border-primary/60"
              />
              <button
                type="submit"
                className="bg-primary px-2.5 text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all cursor-pointer shadow-sm disabled:opacity-40"
                aria-label="Send"
                title="Log decision"
              >
                <Send className="size-3.5" />
              </button>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}
