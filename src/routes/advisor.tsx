import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Panel, Mono, AiBadge, SeverityTag } from "@/components/doip/primitives";
import { useSim } from "@/sim/store";
import { cn } from "@/lib/utils";
import { formatSimClock } from "@/lib/doip";
import type { EventType, SimEvent } from "@/sim/types";
import { Download, Sliders, CheckSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/advisor")({
  head: () => ({
    meta: [
      { title: "Investment Advisor — DOIP" },
      {
        name: "description",
        content:
          "Capability investment options ranked by modelled readiness gain, cost and payback — with live exercise evidence.",
      },
      { property: "og:title", content: "Investment Advisor — DOIP" },
      {
        property: "og:description",
        content:
          "Cost-benefit modelling for capability procurement, separating live facts from projections.",
      },
    ],
  }),
  component: AdvisorScreen,
});

interface Option {
  id: string;
  name: string;
  category: "ISR" | "Sustainment" | "C2" | "Personnel" | "Mobility";
  costCr: number;
  readinessGain: number;
  riskReduction: number;
  paybackMonths: number;
  rationale: string;
}

// Ch18 S13: every recommendation must separate FACT (events from the live
// log) from PROJECTION (modelled numbers). Evidence chips cite event ids.
const EVIDENCE_TYPE: Record<Option["category"], EventType> = {
  ISR: "detection",
  Sustainment: "resource_level",
  C2: "comms_loss",
  Personnel: "vitals",
  Mobility: "weather_spawn",
};

const OPTIONS: Option[] = [
  {
    id: "INV-01",
    name: "Additional UAV flight (4 airframes)",
    category: "ISR",
    costCr: 42,
    readinessGain: 18,
    riskReduction: 22,
    paybackMonths: 14,
    rationale:
      "Detection latency is the dominant driver of high-severity incident escalation in current runs.",
  },
  {
    id: "INV-02",
    name: "Forward fuel bladders at Depot Bravo",
    category: "Sustainment",
    costCr: 9,
    readinessGain: 11,
    riskReduction: 7,
    paybackMonths: 6,
    rationale:
      "Depot draw-down repeatedly crosses the 45% resupply threshold before the exercise midpoint.",
  },
  {
    id: "INV-03",
    name: "Mesh radio upgrade — patrol echelon",
    category: "C2",
    costCr: 27,
    readinessGain: 21,
    riskReduction: 26,
    paybackMonths: 11,
    rationale:
      "Comms-loss events account for the largest share of stale units on the tactical picture.",
  },
  {
    id: "INV-04",
    name: "Biometric wearables refresh",
    category: "Personnel",
    costCr: 14,
    readinessGain: 8,
    riskReduction: 9,
    paybackMonths: 18,
    rationale:
      "Improves fatigue-driven rotation timing but does not address current incident drivers.",
  },
  {
    id: "INV-05",
    name: "All-weather convoy sensors",
    category: "Mobility",
    costCr: 33,
    readinessGain: 13,
    riskReduction: 17,
    paybackMonths: 20,
    rationale:
      "Weather-slowed convoys extend sustainment windows under high-severity weather cells.",
  },
];

function EvidenceChips({ events }: { events: SimEvent[] }) {
  if (!events.length) {
    return (
      <span className="border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        No live evidence yet
      </span>
    );
  }
  return (
    <>
      <span className="border border-success/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-success">
        Fact · {events.length} recent
      </span>
      {events.map((e) => (
        <span
          key={e.id}
          className="border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
          title={`${e.type} · severity ${e.severity}`}
        >
          e:{e.id} · T+{e.tick}
        </span>
      ))}
    </>
  );
}

function AdvisorScreen() {
  const world = useSim((s) => s.world);
  const events = useSim((s) => s.events);
  const [budget, setBudget] = useState(70);
  const [weight, setWeight] = useState(50); // 0 = cost-first, 100 = readiness-first
  const [manualPinned, setManualPinned] = useState<Record<string, boolean>>({});

  const evidence = useMemo(() => {
    const m = new Map<string, SimEvent[]>();
    for (const o of OPTIONS) {
      const t = EVIDENCE_TYPE[o.category];
      m.set(
        o.id,
        events
          .filter((e) => e.type === t)
          .slice(-3)
          .reverse(),
      );
    }
    return m;
  }, [events]);

  const ranked = useMemo(() => {
    return OPTIONS.map((o) => {
      const benefit = (o.readinessGain * weight + o.riskReduction * (100 - weight)) / 100;
      const score = (benefit / Math.max(1, o.costCr)) * 100;
      return { ...o, benefit, score };
    }).sort((a, b) => b.score - a.score);
  }, [weight]);

  const selected = useMemo(() => {
    let left = budget;
    const out: string[] = [];

    // First, honor manually pinned items
    for (const o of ranked) {
      if (manualPinned[o.id]) {
        if (o.costCr <= left) {
          out.push(o.id);
          left -= o.costCr;
        }
      }
    }

    // Then fill remaining budget via greedy ranker
    for (const o of ranked) {
      if (!out.includes(o.id) && manualPinned[o.id] !== false) {
        if (o.costCr <= left) {
          out.push(o.id);
          left -= o.costCr;
        }
      }
    }
    return { ids: out, left };
  }, [ranked, budget, manualPinned]);

  const totalGain = ranked
    .filter((o) => selected.ids.includes(o.id))
    .reduce((s, o) => s + o.readinessGain, 0);

  const handleExportPortfolio = () => {
    const chosenOptions = ranked.filter((o) => selected.ids.includes(o.id));
    const md = `# DOIP Defensive Capability Investment Portfolio
**Simulated Exercise Basis:** Scenario ${world.scenarioId} · Seed ${world.seed} · Sim Clock ${formatSimClock(world.tick)}Z
**Budget Allocation:** ${budget} Cr (${budget - selected.left} Cr spent, ${selected.left} Cr unspent)
**Readiness Yield:** +${totalGain}% Projected Gain

## Approved Capability Packages
${chosenOptions
  .map(
    (o, idx) =>
      `### ${idx + 1}. ${o.name} (${o.category})
- **Cost:** ${o.costCr} Cr | **Payback:** ${o.paybackMonths} months
- **Projected Readiness Gain:** +${o.readinessGain}% | **Risk Reduction:** ${o.riskReduction}%
- **Operational Rationale:** ${o.rationale}
- **Exercise Event Citations:** ${(evidence.get(o.id) || []).map((e) => `[e:${e.id} at T+${e.tick}]`).join(", ") || "Baseline synthetic dataset"}
`,
  )
  .join("\n")}

---
*Grounded under DOIP Deterministic Simulation & AGENTS.md Defensive Standards.*
`;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DOIP-Defensive-Portfolio-${world.seed}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Defensive Portfolio Exported", {
      description: `Saved DOIP-Defensive-Portfolio-${world.seed}.md`,
    });
  };

  return (
    <div className="grid gap-2 p-2 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Panel variant="ai" title="Constraints & presets" actions={<AiBadge label="MODELLED" />}>
        <div className="space-y-3">
          {/* Quick Allocation Presets */}
          <div>
            <span className="block font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
              Defensive Capability Presets:
            </span>
            <div className="flex gap-1">
              {[
                { label: "CONSERVATIVE", b: 35, w: 25 },
                { label: "BALANCED", b: 70, w: 50 },
                { label: "TECH-FORWARD", b: 110, w: 85 },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    setBudget(p.b);
                    setWeight(p.w);
                    setManualPinned({});
                    toast.info(`Applied ${p.label} allocation preset`);
                  }}
                  className={cn(
                    "flex-1 border px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors",
                    budget === p.b && weight === p.w
                      ? "border-primary bg-primary/20 text-primary font-semibold"
                      : "border-border bg-base text-muted-foreground hover:bg-raised hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest">
              <span className="text-muted-foreground">Budget ceiling</span>
              <span className="text-primary font-semibold">{budget} Cr</span>
            </div>
            <input
              type="range"
              min={10}
              max={130}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="mt-1 w-full accent-primary cursor-pointer"
              aria-label="Budget"
            />
          </div>

          <div>
            <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest">
              <span className="text-muted-foreground">Cost-first ↔ Readiness-first</span>
              <span className="text-primary font-semibold">{weight}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="mt-1 w-full accent-ai cursor-pointer"
              aria-label="Optimisation weighting"
            />
          </div>

          <dl className="space-y-1.5 border-t border-border pt-3 font-mono text-[11px]">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Selected packages</dt>
              <dd className="font-semibold text-foreground">
                {selected.ids.length} of {OPTIONS.length}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Unspent capital</dt>
              <dd className="font-mono text-foreground">{selected.left} Cr</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Readiness yield</dt>
              <dd className="text-success font-semibold">+{totalGain}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Simulation basis</dt>
              <dd className="text-muted-foreground font-mono">seed {world.seed}</dd>
            </div>
          </dl>

          <div className="space-y-1 border-t border-border pt-3">
            <div className="flex items-center gap-1.5">
              <span className="border border-success/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-success font-semibold">
                Fact
              </span>
              <span className="font-mono text-[9px] text-muted-foreground">
                observed in the live event log
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="border border-ai/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-ai font-semibold">
                Projection
              </span>
              <span className="font-mono text-[9px] text-muted-foreground">
                deterministic model output
              </span>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Recommended defensive portfolio"
        actions={
          <button
            onClick={handleExportPortfolio}
            className="flex items-center gap-1.5 border border-primary/50 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20 hover:border-primary transition-colors"
          >
            <Download className="size-3" />
            <span>EXPORT PORTFOLIO MD</span>
          </button>
        }
      >
        <ul className="space-y-2">
          {ranked.map((o, i) => {
            const chosen = selected.ids.includes(o.id);
            return (
              <li
                key={o.id}
                className={cn(
                  "border p-2.5 transition-all bg-base",
                  chosen ? "border-ai/50 bg-ai/5 shadow-sm" : "border-border/70 opacity-75",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={chosen}
                    onChange={(e) => {
                      setManualPinned((prev) => ({
                        ...prev,
                        [o.id]: e.target.checked,
                      }));
                    }}
                    className="size-4 rounded border-border accent-primary cursor-pointer"
                    title="Manual package include/exclude toggle"
                  />
                  <Mono className="text-[10px] text-muted-foreground">#{i + 1}</Mono>
                  <SeverityTag
                    severity={
                      o.riskReduction > 20 ? "high" : o.riskReduction > 12 ? "medium" : "low"
                    }
                    showLabel={false}
                  />
                  <span className="text-sm font-semibold text-foreground">{o.name}</span>
                  <Mono className="text-[10px] text-muted-foreground">{o.category}</Mono>
                  {chosen && (
                    <span className="ml-auto border border-ai/50 bg-ai/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-ai font-semibold">
                      In portfolio
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
                  {o.rationale}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <EvidenceChips events={evidence.get(o.id) ?? []} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] sm:grid-cols-4">
                  <Cell k="Cost" v={`${o.costCr} Cr`} />
                  <Cell k="Readiness" v={`+${o.readinessGain}%`} />
                  <Cell k="Risk ↓" v={`${o.riskReduction}%`} />
                  <Cell k="Payback" v={`${o.paybackMonths} mo`} />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground flex items-center justify-between">
          <span>
            Cost, readiness, risk and payback figures are projections from a deterministic model.
          </span>
          <span className="text-ai font-mono text-[9px] flex items-center gap-1">
            <Sparkles className="size-2.5" /> CH. 13 GROUNDED
          </span>
        </p>
      </Panel>
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-border/80 bg-raised/30 px-2 py-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{k}</span>
        <span className="text-[8px] uppercase tracking-widest text-ai/80">Proj</span>
      </div>
      <div className="text-foreground font-semibold">{v}</div>
    </div>
  );
}
