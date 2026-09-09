import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Send, X } from "lucide-react";
import { AiBadge, EmptyState, Mono, SeverityTag } from "@/components/doip/primitives";
import { formatSimClock } from "@/lib/doip";
import { useSim } from "@/sim/store";
import { cn } from "@/lib/utils";
import type { SimEvent, WorldState } from "@/sim/types";

type Tab = "SITREPS" | "ASK" | "WHAT-IF";

interface Answer {
  id: number;
  q: string;
  a: string;
  cites: SimEvent[];
}

/** Deterministic, log-grounded answers — the seam a RAG backend replaces later. */
function answerQuestion(q: string, world: WorldState, events: SimEvent[]): { a: string; cites: SimEvent[] } {
  const t = q.toLowerCase();
  const units = Object.values(world.units);
  const cite = (type: string, n = 3) => events.filter((e) => e.type === type).slice(-n).reverse();

  if (/fuel|resupply|logisti|supply/.test(t)) {
    const low = units.filter((u) => u.fuel < 40).sort((a, b) => a.fuel - b.fuel).slice(0, 4);
    return {
      a: low.length
        ? `${low.length} unit(s) under 40% fuel: ${low.map((u) => `${u.callsign} (${u.fuel.toFixed(0)}%)`).join(", ")}. Recommend depot tasking before the next phase.`
        : "Fuel states are nominal — no unit is below 40%.",
      cites: cite("resource_level"),
    };
  }
  if (/comms|stale|radio|contact/.test(t)) {
    const stale = units.filter((u) => u.status === "stale");
    return {
      a: stale.length
        ? `${stale.length} unit(s) past the reporting threshold: ${stale.map((u) => u.callsign).join(", ")}. They render stale on the tactical picture.`
        : "All units are reporting inside the 3-minute threshold.",
      cites: cite("comms_loss"),
    };
  }
  if (/incident|threat|attack|contact/.test(t)) {
    const open = Object.values(world.incidents).filter((i) => i.open);
    const worst = open.some((i) => i.severity === "critical")
      ? "CRITICAL"
      : open.some((i) => i.severity === "high")
        ? "HIGH"
        : "MEDIUM/LOW";
    return {
      a: open.length ? `${open.length} incident(s) open; worst severity ${worst}.` : "No incidents are currently open.",
      cites: cite("incident_open"),
    };
  }
  if (/alert|ack/.test(t)) {
    const unacked = Object.values(world.alerts).filter((a) => !a.acked);
    return {
      a: unacked.length
        ? `${unacked.length} alert(s) unacknowledged, ${unacked.filter((a) => a.severity === "critical").length} critical.`
        : "All alerts acknowledged.",
      cites: cite("alert_raise"),
    };
  }
  if (/weather|storm|rain|wind/.test(t)) {
    const w = Object.values(world.weather);
    return {
      a: w.length
        ? `${w.length} active weather cell(s); peak intensity ${(Math.max(...w.map((x) => x.intensity)) * 100).toFixed(0)}%.`
        : "No active weather cells.",
      cites: cite("weather_spawn"),
    };
  }
  return {
    a: `${units.length} units committed, ${Object.values(world.incidents).filter((i) => i.open).length} incident(s) open, ${
      Object.values(world.alerts).filter((a) => !a.acked).length
    } alert(s) unacknowledged at ${formatSimClock(world.tick)}. Ask about fuel, comms, incidents, alerts or weather.`,
    cites: events.slice(-3).reverse(),
  };
}

function CiteChips({ cites }: { cites: SimEvent[] }) {
  if (!cites.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {cites.map((c) => (
        <span
          key={c.id}
          className="flex items-center gap-1 border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          title={`${c.type} · ${c.entityId}`}
        >
          <SeverityTag severity={c.severity} showLabel={false} />
          e:{c.id} · T+{c.tick}
        </span>
      ))}
    </div>
  );
}

export function AiDrawer({ onClose }: { onClose: () => void }) {
  const world = useSim((s) => s.world);
  const events = useSim((s) => s.events);
  const [tab, setTab] = useState<Tab>("SITREPS");
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Answer[]>([]);

  const sections = useMemo(() => {
    const units = Object.values(world.units);
    const open = Object.values(world.incidents).filter((i) => i.open);
    const crit = open.filter((i) => i.severity === "critical" || i.severity === "high");
    const stale = units.filter((u) => u.status === "stale");
    const lowFuel = units.filter((u) => u.fuel < 30);
    const cite = (type: string, n = 2) => events.filter((e) => e.type === type).slice(-n).reverse();
    return [
      {
        heading: "Posture",
        body: `${units.length} units committed · ${open.length} incident(s) open${
          crit.length ? ` · ${crit.length} high/critical` : ""
        } · ${Object.values(world.alerts).filter((a) => !a.acked).length} unacked alert(s).`,
        cites: cite("incident_open"),
      },
      {
        heading: "Comms",
        body: stale.length
          ? `${stale.length} stale: ${stale.map((u) => u.callsign).join(", ")}.`
          : "All units reporting inside threshold.",
        cites: cite("comms_loss"),
      },
      {
        heading: "Sustainment",
        body: lowFuel.length
          ? `${lowFuel.length} unit(s) below 30% fuel: ${lowFuel.map((u) => u.callsign).join(", ")}.`
          : "Fuel and battery states nominal.",
        cites: cite("resource_level"),
      },
    ];
  }, [world, events]);

  const ask = () => {
    const query = q.trim();
    if (!query) return;
    const { a, cites } = answerQuestion(query, world, events);
    setMsgs((m) => [...m, { id: m.length + 1, q: query, a, cites }]);
    setQ("");
  };

  return (
    <aside
      className="doip-ai-edge flex w-[340px] shrink-0 flex-col border-l border-border bg-surface"
      aria-label="AI drawer"
    >
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="font-mono text-[11px] tracking-widest text-ai">✦ AI</span>
        <div className="ml-2 flex gap-1">
          {(
            ["SITREPS", "ASK", "WHAT-IF"] as Tab[]
          ).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "border px-1.5 py-0.5 font-mono text-[10px] tracking-widest",
                tab === t ? "border-ai/50 bg-raised text-ai" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Close AI drawer">
          <X className="size-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!events.length ? (
          <EmptyState label="No live state" hint="Start a scenario in Run Control (S4) first." />
        ) : tab === "SITREPS" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <AiBadge />
              <Mono className="text-[10px] text-muted-foreground">T+{world.tick}</Mono>
            </div>
            {sections.map((s) => (
              <section key={s.heading} className="border border-ai/30 bg-ai/5 p-2">
                <h3 className="text-xs font-semibold text-foreground">{s.heading}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{s.body}</p>
                <CiteChips cites={s.cites} />
              </section>
            ))}
            <Link to="/sitrep" className="block border border-border px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-raised">
              Full situation report →
            </Link>
          </div>
        ) : tab === "ASK" ? (
          <div className="space-y-2">
            {msgs.map((m) => (
              <div key={m.id}>
                <div className="border border-border bg-raised/40 p-1.5 text-[12px] text-foreground">{m.q}</div>
                <div className="mt-1 border border-ai/30 bg-ai/5 p-1.5">
                  <p className="text-[12px] leading-relaxed text-muted-foreground">{m.a}</p>
                  <CiteChips cites={m.cites} />
                </div>
              </div>
            ))}
            {!msgs.length && (
              <p className="text-[11px] text-muted-foreground">
                Ask about the live exercise — fuel, comms, incidents, alerts, weather. Every answer cites the events behind it.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Branch the current state, review the AI-drafted scenario actions, approve, and watch the branch play out. Branches are sandboxed — the live run is untouched.
            </p>
            <Link to="/whatif" className="block border border-ai/40 bg-ai/5 px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-widest text-ai hover:bg-raised">
              Open What-If Theater →
            </Link>
          </div>
        )}
      </div>

      {tab === "ASK" && (
        <div className="flex shrink-0 gap-1.5 border-t border-border p-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Ask the exercise…"
            className="min-w-0 flex-1 border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-ai/60"
          />
          <button onClick={ask} className="border border-ai/40 bg-ai/10 px-2 text-ai" aria-label="Ask">
            <Send className="size-3.5" />
          </button>
        </div>
      )}

      <footer className="shrink-0 border-t border-border px-2 py-1.5 font-mono text-[9px] leading-relaxed text-muted-foreground">
        AI output generated from synthetic data. Verify claims against cited events.
      </footer>
    </aside>
  );
}
