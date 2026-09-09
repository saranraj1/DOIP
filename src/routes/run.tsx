import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState, Panel, Stat, Mono } from "@/components/doip/primitives";
import { Sparkline } from "@/components/doip/Sparkline";
import { SCENARIOS } from "@/sim/scenarios";
import { simStore, useSim } from "@/sim/store";
import { canOperate } from "@/lib/doip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Play, Pause, Square, RotateCcw, Copy, History, Download } from "lucide-react";

export const Route = createFileRoute("/run")({
  head: () => ({
    meta: [
      { title: "Run Control — DOIP" },
      {
        name: "description",
        content: "Start, pause and replay deterministic training scenarios with seed control and speed 1-8x.",
      },
      { property: "og:title", content: "Run Control — DOIP" },
      {
        property: "og:description",
        content: "Deterministic scenario control: seed, speed, run history and clone-with-same-seed.",
      },
    ],
  }),
  component: RunControlScreen,
});

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function RunControlScreen() {
  const status = useSim((s) => s.status);
  const speed = useSim((s) => s.speed);
  const tick = useSim((s) => s.world.tick);
  const seed = useSim((s) => s.seed);
  const scenarioId = useSim((s) => s.scenarioId);
  const rate = useSim((s) => s.eventRate);
  const eventCount = useSim((s) => s.events.length);
  const role = useSim((s) => s.role);
  const runs = useSim((s) => s.runs);

  const [seedInput, setSeedInput] = useState(String(seed));
  const [picked, setPicked] = useState(scenarioId);
  const allowed = canOperate(role);

  const guard = (fn: () => void, label: string) => () => {
    if (!allowed) {
      toast.error("Read-only role", { description: `${label} requires operator access or above.` });
      return;
    }
    fn();
    toast.success(label);
  };

  return (
    <div className="grid gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-2">
        <Panel title="Scenario library">
          <ul className="grid gap-2 sm:grid-cols-2">
            {SCENARIOS.map((sc) => (
              <li key={sc.id}>
                <button
                  onClick={() => setPicked(sc.id)}
                  className={cn(
                    "h-full w-full  border p-2 text-left transition-colors",
                    picked === sc.id ? "border-primary/60 bg-raised" : "border-border hover:bg-raised doip-btn-primary",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-primary">{sc.id}</span>
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase",
                        sc.validation === "valid" ? "text-success" : "text-sev-medium",
                      )}
                    >
                      {sc.validation}
                    </span>
                  </div>
                  <div className="mt-1 text-sm">{sc.name}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{sc.description}</p>
                  <div className="mt-2 font-mono text-[10px] text-muted-foreground">
                    patrols {sc.patrolCount} · uav {sc.uavCount} · convoy {sc.convoyCount}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Run controls">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Seed
              </span>
              <input
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value.replace(/\D/g, ""))}
                className="w-40 border border-border bg-background px-2 py-1 font-mono text-sm outline-none focus:border-primary"
              />
            </label>
            <button
              onClick={guard(
                () => simStore.startRun(Number(seedInput) || 1, picked),
                `Run started · ${picked} · seed ${seedInput}`,
              )}
              className="flex items-center gap-1.5 bg-primary px-2 py-1.5 font-mono text-xs uppercase tracking-widest text-primary-foreground hover:opacity-90"
            >
              <Play className="size-3.5" /> Start <span className="opacity-60">[SPACE]</span>
            </button>
            <button
              onClick={guard(() => simStore.pause(), "Run paused")}
              className="flex items-center gap-1.5 border border-border px-2 py-1.5 font-mono text-xs uppercase tracking-widest doip-btn-solid"
            >
              <Pause className="size-3.5" /> Pause <span className="opacity-60">[SPACE]</span>
            </button>
            <button
              onClick={guard(() => simStore.resume(), "Run resumed")}
              className="flex items-center gap-1.5 border border-border px-2 py-1.5 font-mono text-xs uppercase tracking-widest hover:bg-raised doip-btn-primary"
            >
              <RotateCcw className="size-3.5" /> Resume <span className="opacity-60">[R]</span>
            </button>
            <button
              onClick={guard(() => simStore.stop(), "Run stopped")}
              className="flex items-center gap-1.5 border border-border px-2 py-1.5 font-mono text-xs uppercase tracking-widest text-sev-critical hover:bg-raised doip-btn-primary"
            >
              <Square className="size-3.5" /> Stop <span className="opacity-60">[X]</span>
            </button>
          </div>

          <div className="mt-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Speed · {speed}x
            </div>
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <button
                  key={s}
                  onClick={guard(() => simStore.setSpeed(s), `Speed set to ${s}x`)}
                  className={cn(
                    "h-8 w-10  border font-mono text-xs",
                    speed === s ? "border-primary/60 bg-raised text-primary" : "border-border hover:bg-raised doip-btn-primary",
                  )}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
          {!allowed && (
            <p className="mt-2 font-mono text-[10px] text-sev-medium">
              ■ Viewer role is read-only — run controls are disabled.
            </p>
          )}
        </Panel>

        <Panel
          title="Run history"
          actions={<Mono className="text-[10px] text-muted-foreground">LAST {runs.length} / 8</Mono>}
        >
          {!runs.length ? (
            <EmptyState
              label="No recorded runs"
              hint="Stop the current run (or start a new one) to log it here with its full event record."
            />
          ) : (
            <ul className="space-y-1">
              {runs
                .slice()
                .reverse()
                .map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 border border-border p-1.5"
                  >
                    <span className="font-mono text-xs text-primary">{r.id}</span>
                    <Mono className="text-[10px] text-muted-foreground">
                      {r.scenarioId} · seed {r.seed} · {r.ticks} ticks · {r.events} events
                    </Mono>
                    <div className="ml-auto flex gap-1">
                      <button
                        onClick={guard(
                          () => {
                            setSeedInput(String(r.seed));
                            setPicked(r.scenarioId);
                            simStore.cloneRun(r);
                          },
                          `Cloned ${r.id} · ${r.scenarioId} · seed ${r.seed}`,
                        )}
                        className="flex items-center gap-1 border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest hover:bg-raised"
                        title="Re-run with the same scenario and seed — reproduces the run event-for-event"
                      >
                        <Copy className="size-3" /> Clone seed
                      </button>
                      <Link
                        to="/replay"
                        search={{ run: r.id }}
                        className="flex items-center gap-1 border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-raised"
                        title="Open this run in Replay"
                      >
                        <History className="size-3" /> Replay
                      </Link>
                      <button
                        onClick={() =>
                          downloadJson(`doip-${r.id.toLowerCase()}-log.json`, {
                            id: r.id,
                            scenarioId: r.scenarioId,
                            seed: r.seed,
                            ticks: r.ticks,
                            events: r.log,
                          })
                        }
                        className="flex items-center gap-1 border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest hover:bg-raised"
                        title="Export the full event log as JSON"
                      >
                        <Download className="size-3" /> Export
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Status" value={status} />
          <Stat label="Tick" value={tick} />
          <Stat label="Seed" value={<Mono>{seed}</Mono>} />
          <Stat label="Events" value={eventCount} />
        </div>
        <Panel title="Event rate (events / tick)">
          <Sparkline data={rate} height={60} />
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            last {rate.length} ticks · peak {rate.length ? Math.max(...rate) : 0}
          </div>
        </Panel>
        <Panel title="Determinism">
          <p className="text-xs text-muted-foreground">
            The tick engine is a seeded mulberry32 PRNG. Re-running{" "}
            <Mono>
              {picked} / {seedInput}
            </Mono>{" "}
            reproduces this run event-for-event. Clone any recorded run to prove it.
          </p>
        </Panel>
      </div>
    </div>
  );
}
