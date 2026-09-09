import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, AiBadge, SeverityTag } from "@/components/doip/primitives";
import { useSim } from "@/sim/store";
import { formatSimClock } from "@/lib/doip";
import { RefreshCw } from "lucide-react";
import type { SimEvent } from "@/sim/types";

export const Route = createFileRoute("/sitrep")({
  head: () => ({
    meta: [
      { title: "AI Sitrep — DOIP" },
      {
        name: "description",
        content: "Auto-generated situation report with severity rollup, cited source events and confidence scoring.",
      },
      { property: "og:title", content: "AI Sitrep — DOIP" },
      { property: "og:description", content: "Narrative sitrep derived from the live event log, every claim cited." },
    ],
  }),
  component: SitrepScreen,
});

interface Section {
  heading: string;
  body: string;
  confidence: number;
  citations: SimEvent[];
}

function SitrepScreen() {
  const world = useSim((s) => s.world);
  const events = useSim((s) => s.events);
  const [nonce, setNonce] = useState(0);

  const sections = useMemo<Section[]>(() => {
    const units = Object.values(world.units);
    const incidents = Object.values(world.incidents);
    const alerts = Object.values(world.alerts);
    const open = incidents.filter((i) => i.open);
    const crit = open.filter((i) => i.severity === "critical" || i.severity === "high");
    const stale = units.filter((u) => u.status === "stale");
    const lowFuel = units.filter((u) => u.fuel < 30);
    const cite = (type: string, n = 3) => events.filter((e) => e.type === type).slice(-n).reverse();

    return [
      {
        heading: "Overall posture",
        body: `${units.length} units are committed across ${world.zones.length} zones at ${formatSimClock(world.tick)}. ${
          crit.length
            ? `${crit.length} incident(s) at high or critical severity are shaping the picture.`
            : "No high-severity incidents are currently open."
        } ${alerts.filter((a) => !a.acked).length} alert(s) remain unacknowledged.`,
        confidence: 0.92,
        citations: cite("incident_open"),
      },
      {
        heading: "Communications",
        body: stale.length
          ? `${stale.length} unit(s) have exceeded the 3-minute reporting threshold and are rendered stale on the tactical picture. Recommend a comms check on ${stale
              .map((u) => u.callsign)
              .join(", ")}.`
          : "All units are reporting inside the 3-minute threshold; no comms gaps detected.",
        confidence: stale.length ? 0.78 : 0.95,
        citations: cite("comms_loss"),
      },
      {
        heading: "Sustainment",
        body: lowFuel.length
          ? `${lowFuel.length} unit(s) are below 30% fuel — ${lowFuel.map((u) => u.callsign).join(", ")}. Depot draw-down is tracking ahead of plan; consider tasking resupply now rather than at the next halt.`
          : "Fuel and battery states are nominal across all committed units.",
        confidence: 0.71,
        citations: cite("resource_level"),
      },
      {
        heading: "Recommended actions",
        body: [
          crit.length ? `Prioritise closure of ${crit.length} high/critical incident(s).` : null,
          stale.length ? "Re-establish comms with stale units before the next phase line." : null,
          lowFuel.length ? "Issue resupply tasking from the nearest depot." : null,
          "Maintain current patrol density; no re-tasking required at this time.",
        ]
          .filter(Boolean)
          .join(" "),
        confidence: 0.64,
        citations: cite("alert_raise"),
      },
    ];
  }, [world, events, nonce]);

  if (!events.length) {
    return (
      <div className="p-2">
        <EmptyState label="Nothing to report" hint="Start a scenario in Run Control (S4)." />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-2 p-2">
      <Panel
        title="Situation report"
        actions={
          <div className="flex items-center gap-2">
            <AiBadge />
            <button
              onClick={() => setNonce((n) => n + 1)}
              className="flex items-center gap-1.5 border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest doip-btn-solid"
            >
              <RefreshCw className="size-3" /> Regenerate
            </button>
          </div>
        }
      >
        <Mono className="text-[10px] text-muted-foreground">
          GENERATED AT {formatSimClock(world.tick)} · SEED {world.seed} · SCENARIO {world.scenarioId}
        </Mono>
        <div className="mt-2 space-y-2">
          {sections.map((s) => (
            <section key={s.heading} className=" border border-ai/30 bg-ai/5 p-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">{s.heading}</h2>
                <Mono className="text-[10px] text-ai">CONF {(s.confidence * 100).toFixed(0)}%</Mono>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
              {s.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.citations.map((c) => (
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
              )}
            </section>
          ))}
        </div>
        <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
          AI-generated from synthetic training data. Verify every claim against the cited events before acting.
        </p>
      </Panel>
    </div>
  );
}
