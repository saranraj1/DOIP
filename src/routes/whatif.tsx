import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, AiBadge } from "@/components/doip/primitives";
import { Sparkline } from "@/components/doip/Sparkline";
import { mulberry32 } from "@/sim/prng";
import { useSim } from "@/sim/store";
import { canOperate } from "@/lib/doip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Check, Pencil, Play, Trash2, X } from "lucide-react";

export const Route = createFileRoute("/whatif")({
  head: () => ({
    meta: [
      { title: "What-If Theater — DOIP" },
      {
        name: "description",
        content: "Describe a hypothetical, review the AI-drafted scenario actions, approve, and watch the branch play out.",
      },
      { property: "og:title", content: "What-If Theater — DOIP" },
      { property: "og:description", content: "AI-drafted branch scenarios behind an approve gate, with animated deterministic playback." },
    ],
  }),
  component: WhatIfScreen,
});

// ---------------------------------------------------------------------------
// AI DSL draft (Ch7 §7.3 action verbs). Deterministic keyword parser — the
// seam an LLM scenario-author replaces later. AI authors, never decides:
// nothing runs until a human approves the draft.
// ---------------------------------------------------------------------------

type DslVerb = "spawn_weather" | "create_incident" | "raise_alert" | "modify_speed";

interface DslAction {
  id: number;
  action: DslVerb;
  target: string;
  magnitude: number; // 0–100
  rationale: string;
}

const VERBS: DslVerb[] = ["spawn_weather", "create_incident", "raise_alert", "modify_speed"];

const PRESETS = [
  "Severe storm over the northern sector",
  "Convoy ambushed on the supply route",
  "Comms jamming across patrol echelon",
  "Fuel shortage at forward depot",
];

function draftFromPrompt(prompt: string): DslAction[] {
  const t = prompt.toLowerCase();
  const out: DslAction[] = [];
  let id = 1;
  const convoyTarget = /convoy|supply|logisti/.test(t) ? "convoy units" : "patrol units";
  if (/storm|weather|rain|monsoon|wind|fog/.test(t)) {
    out.push({
      id: id++,
      action: "spawn_weather",
      target: /north/.test(t) ? "northern sector" : "area of operations",
      magnitude: /severe|heavy|extreme/.test(t) ? 80 : 60,
      rationale: "Prompt implies a weather-driven branch; spawning a moving cell at the stated intensity.",
    });
  }
  if (/ambush|attack|ied|contact|incident|hostile/.test(t)) {
    out.push({
      id: id++,
      action: "create_incident",
      target: convoyTarget,
      magnitude: 80,
      rationale: "Hostile-contact language maps to a high-severity incident on the named element.",
    });
    out.push({
      id: id++,
      action: "raise_alert",
      target: "all stations",
      magnitude: 70,
      rationale: "A contact of this severity would trip the alert chain immediately.",
    });
  }
  if (/comms|jam|radio|silence/.test(t)) {
    out.push({
      id: id++,
      action: "raise_alert",
      target: "patrol echelon",
      magnitude: 60,
      rationale: "Comms degradation surfaces as alerts and stale tracks rather than kinetic events.",
    });
    out.push({
      id: id++,
      action: "modify_speed",
      target: "patrol units",
      magnitude: 40,
      rationale: "Degraded comms slows movement while units re-establish contact procedures.",
    });
  }
  if (/fuel|shortage|resupply|supply/.test(t)) {
    out.push({
      id: id++,
      action: "modify_speed",
      target: convoyTarget,
      magnitude: 50,
      rationale: "Fuel constraint forces economy speed on the affected element.",
    });
    out.push({
      id: id++,
      action: "raise_alert",
      target: "logistics net",
      magnitude: 55,
      rationale: "Depot draw-down below threshold raises a sustainment alert.",
    });
  }
  if (!out.length) {
    out.push(
      {
        id: id++,
        action: "spawn_weather",
        target: "area of operations",
        magnitude: 50,
        rationale: "No specific stressor recognised — defaulting to a moderate weather branch.",
      },
      {
        id: id++,
        action: "create_incident",
        target: "patrol units",
        magnitude: 55,
        rationale: "Adding one medium incident so the branch diverges measurably from baseline.",
      },
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic branch projection driven by the approved actions.
// ---------------------------------------------------------------------------

function actionsHash(actions: DslAction[]) {
  return actions.reduce((h, a) => h + VERBS.indexOf(a.action) * 97 + a.magnitude * 13 + a.target.length * 7, 0);
}

function project(seed: number, actions: DslAction[], horizon = 60) {
  const weather = Math.max(0, ...actions.filter((a) => a.action === "spawn_weather").map((a) => a.magnitude));
  const incidents = actions.filter((a) => a.action === "create_incident").reduce((s, a) => s + a.magnitude, 0);
  const alerts = actions.filter((a) => a.action === "raise_alert").reduce((s, a) => s + a.magnitude, 0);
  const slow = Math.max(0, ...actions.filter((a) => a.action === "modify_speed").map((a) => a.magnitude));
  const rand = mulberry32(seed + actionsHash(actions));
  const base = 10 + weather * 0.35 + incidents * 0.25 + alerts * 0.1;
  const series: number[] = [];
  let v = 10;
  for (let i = 0; i < horizon; i++) {
    const ramp = Math.min(1, i / 15); // stressors take hold over the first 15 ticks
    v = Math.max(1, v + (base * ramp - v) * 0.15 + (rand() - 0.5) * 4);
    series.push(v);
  }
  return {
    riskSeries: series,
    coverage: Math.max(20, Math.round(90 - weather * 0.25 - slow * 0.2)),
    expectedIncidents: Math.round(1 + incidents / 40 + weather / 50),
    sustainmentHours: Math.round(46 - slow * 0.15 - weather * 0.1),
    meanResponseMin: Math.round(12 + slow * 0.25 + weather * 0.15),
  };
}

function narration(actions: DslAction[]): Array<{ atTick: number; text: string }> {
  const steps = actions.map((a, i) => ({
    atTick: 4 + i * 12,
    text:
      a.action === "spawn_weather"
        ? `T+${4 + i * 12} — weather cell forms over ${a.target} at ${a.magnitude}% intensity; movement rates begin to drop.`
        : a.action === "create_incident"
          ? `T+${4 + i * 12} — incident opens against ${a.target}; severity tracks the ${a.magnitude}% draft magnitude.`
          : a.action === "raise_alert"
            ? `T+${4 + i * 12} — alert raised on ${a.target}; acknowledgement load increases on the operator.`
            : `T+${4 + i * 12} — ${a.target} drop to economy speed (${a.magnitude}% modifier); schedules stretch.`,
  }));
  steps.push({ atTick: 56, text: "T+56 — branch stabilises; compare the outcome envelope against baseline below." });
  return steps;
}

// ---------------------------------------------------------------------------

type Phase = "draft" | "review" | "playing" | "done";

const HORIZON = 60;

function WhatIfScreen() {
  const seed = useSim((s) => s.world.seed);
  const tick = useSim((s) => s.world.tick);
  const role = useSim((s) => s.role);

  const [prompt, setPrompt] = useState("");
  const [actions, setActions] = useState<DslAction[]>([]);
  const [phase, setPhase] = useState<Phase>("draft");
  const [playTick, setPlayTick] = useState(0);

  const baseline = useMemo(() => project(seed || 1, []), [seed]);
  const branch = useMemo(() => project(seed || 1, actions), [seed, actions]);
  const steps = useMemo(() => narration(actions), [actions]);

  // Animated playback: advance the branch clock ~10 ticks/sec after approval.
  useEffect(() => {
    if (phase !== "playing") return;
    const t = setInterval(() => {
      setPlayTick((v) => {
        if (v >= HORIZON) {
          setPhase("done");
          return v;
        }
        return v + 1;
      });
    }, 100);
    return () => clearInterval(t);
  }, [phase]);

  if (!tick) {
    return (
      <div className="p-2">
        <EmptyState label="No live state to branch" hint="Start a scenario in Run Control (S4)." />
      </div>
    );
  }

  const generate = () => {
    const p = prompt.trim();
    if (!p) {
      toast.error("Describe the hypothetical first");
      return;
    }
    setActions(draftFromPrompt(p));
    setPhase("review");
  };

  const approve = () => {
    if (!canOperate(role)) {
      toast.error("Read-only role", { description: "Approving a branch requires operator access or above." });
      return;
    }
    if (!actions.length) {
      toast.error("Draft is empty", { description: "Add at least one action before approving." });
      return;
    }
    setPlayTick(0);
    setPhase("playing");
    toast.success("Branch approved — playing", { description: "Sandboxed. The live run is untouched." });
  };

  const discard = () => {
    setActions([]);
    setPhase("draft");
  };

  const updateAction = (id: number, patch: Partial<DslAction>) =>
    setActions((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const metrics = [
    { label: "Area coverage", b: baseline.coverage, x: branch.coverage, unit: "%", higherBetter: true },
    { label: "Expected incidents", b: baseline.expectedIncidents, x: branch.expectedIncidents, unit: "", higherBetter: false },
    { label: "Sustainment window", b: baseline.sustainmentHours, x: branch.sustainmentHours, unit: "h", higherBetter: true },
    { label: "Mean response", b: baseline.meanResponseMin, x: branch.meanResponseMin, unit: "min", higherBetter: false },
  ];

  return (
    <div className="grid gap-2 p-2 xl:grid-cols-[380px_minmax(0,1fr)]">
      {/* ------------------------------------------------ draft + approve gate */}
      <div className="space-y-2">
        <Panel variant="ai" title="Hypothetical" actions={<Mono className="text-[10px]">FORK @ T+{tick}</Mono>}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder='Describe the branch, e.g. "severe storm over the northern sector while a convoy is ambushed"'
            className="w-full resize-none border border-border bg-background p-2 text-xs leading-relaxed outline-none focus:border-ai/60"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-raised hover:text-foreground"
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={generate}
            className="mt-2 flex w-full items-center justify-center gap-2 border border-ai/40 bg-ai/10 px-2 py-1.5 font-mono text-xs uppercase tracking-widest text-ai hover:bg-ai/20"
          >
            <Pencil className="size-3.5" /> Draft scenario actions
          </button>
        </Panel>

        {(phase === "review" || phase === "playing" || phase === "done") && (
          <Panel
            variant="ai"
            title="Drafted actions — scenario DSL"
            actions={<AiBadge label="AI DRAFT · NOT EXECUTED" />}
          >
            <ul className="space-y-1.5">
              {actions.map((a) => (
                <li key={a.id} className="border border-ai/30 bg-ai/5 p-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={a.action}
                      onChange={(e) => updateAction(a.id, { action: e.target.value as DslVerb })}
                      disabled={phase !== "review"}
                      className="border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-ai"
                    >
                      {VERBS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <input
                      value={a.target}
                      onChange={(e) => updateAction(a.id, { target: e.target.value })}
                      disabled={phase !== "review"}
                      className="min-w-0 flex-1 border border-border bg-background px-1 py-0.5 font-mono text-[10px]"
                      aria-label="Action target"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={a.magnitude}
                      onChange={(e) => updateAction(a.id, { magnitude: Math.max(0, Math.min(100, Number(e.target.value))) })}
                      disabled={phase !== "review"}
                      className="w-14 border border-border bg-background px-1 py-0.5 font-mono text-[10px]"
                      aria-label="Magnitude"
                    />
                    {phase === "review" && (
                      <button
                        onClick={() => setActions((x) => x.filter((y) => y.id !== a.id))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Remove action"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{a.rationale}</p>
                </li>
              ))}
              {!actions.length && <EmptyState label="Draft is empty" hint="Generate a draft or discard." />}
            </ul>

            {phase === "review" && (
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={approve}
                  className="flex flex-1 items-center justify-center gap-1.5 bg-primary px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest text-primary-foreground hover:opacity-90"
                >
                  <Check className="size-3" /> Approve &amp; run branch
                </button>
                <button
                  onClick={discard}
                  className="flex flex-1 items-center justify-center gap-1.5 border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-raised"
                >
                  <X className="size-3" /> Discard
                </button>
              </div>
            )}
            {(phase === "playing" || phase === "done") && (
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => setPhase("review")}
                  className="flex flex-1 items-center justify-center gap-1.5 border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest hover:bg-raised"
                >
                  <Pencil className="size-3" /> Back to draft
                </button>
                <button
                  onClick={discard}
                  className="flex flex-1 items-center justify-center gap-1.5 border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-raised"
                >
                  <Trash2 className="size-3" /> Discard branch
                </button>
              </div>
            )}
            <p className="mt-2 border-t border-border pt-1.5 font-mono text-[9px] leading-relaxed text-muted-foreground">
              AI authors, never decides: no action executes until approved. Branches are sandboxed — the live run is untouched.
            </p>
          </Panel>
        )}
      </div>

      {/* ------------------------------------------------ playback + outcomes */}
      <div className="space-y-2">
        {phase === "draft" || phase === "review" ? (
          <Panel title="Branch playback">
            <EmptyState
              label={phase === "draft" ? "No branch drafted" : "Awaiting approval"}
              hint={
                phase === "draft"
                  ? "Describe a hypothetical and draft its scenario actions."
                  : "Review or edit the drafted actions, then approve to watch the branch play out."
              }
            />
          </Panel>
        ) : (
          <>
            <Panel
              variant="ai"
              title={`Branch playback · T+${playTick} / ${HORIZON}`}
              actions={
                phase === "playing" ? (
                  <Mono className="flex items-center gap-1.5 text-[10px] text-ai">
                    <Play className="size-3" /> PLAYING
                  </Mono>
                ) : (
                  <Mono className="text-[10px] text-success">COMPLETE</Mono>
                )
              }
            >
              <div className="h-1 w-full bg-raised">
                <div
                  className="h-full bg-ai/70 transition-[width] duration-100"
                  style={{ width: `${(playTick / HORIZON) * 100}%` }}
                />
              </div>
              <div className="mt-2 space-y-2">
                <div>
                  <Mono className="text-[10px] text-muted-foreground">BASELINE RISK</Mono>
                  <Sparkline data={baseline.riskSeries.slice(0, Math.max(2, playTick))} color="#8A8A8A" height={54} />
                </div>
                <div>
                  <Mono className="text-[10px] text-ai">BRANCH RISK</Mono>
                  <Sparkline data={branch.riskSeries.slice(0, Math.max(2, playTick))} color="#A78BFA" height={54} />
                </div>
              </div>
              <ul className="mt-2 space-y-1" aria-live="polite">
                {steps
                  .filter((s) => s.atTick <= playTick)
                  .map((s) => (
                    <li key={s.atTick} className="border-l-2 border-ai/50 pl-2 text-[11px] leading-relaxed text-muted-foreground">
                      {s.text}
                    </li>
                  ))}
              </ul>
            </Panel>

            {phase === "done" && (
              <Panel variant="ai" title="Outcome envelope — branch vs baseline" actions={<AiBadge label="SIMULATED" />}>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {metrics.map((m) => {
                    const delta = m.x - m.b;
                    const good = m.higherBetter ? delta >= 0 : delta <= 0;
                    return (
                      <div key={m.label} className=" border border-border p-2">
                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{m.label}</div>
                        <div className="mt-1 font-mono text-xl text-foreground">
                          {m.x.toFixed(0)}
                          <span className="text-xs text-muted-foreground">{m.unit}</span>
                        </div>
                        <div
                          className="font-mono text-[10px]"
                          style={{ color: delta === 0 ? "#8A8A8A" : good ? "#4ADE80" : "#F87171" }}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta.toFixed(0)}
                          {m.unit} vs baseline {m.b.toFixed(0)}
                          {m.unit}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  Branches are deterministic for a given seed and approved action set — re-approving the same draft reproduces the
                  same trace exactly.
                </p>
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}
