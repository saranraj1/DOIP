import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, SeverityTag } from "@/components/doip/primitives";
import { Sparkline } from "@/components/doip/Sparkline";
import { useSim } from "@/sim/store";
import type { Depot } from "@/sim/types";
import { formatSimClock } from "@/lib/doip";

export const Route = createFileRoute("/logistics")({
  head: () => ({
    meta: [
      { title: "Logistics — DOIP" },
      {
        name: "description",
        content: "Depot stock burn-down, projected time-to-empty and auto-generated resupply tasking.",
      },
      { property: "og:title", content: "Logistics — DOIP" },
      { property: "og:description", content: "Fuel, medkits, rations and batteries tracked across every depot." },
    ],
  }),
  component: LogisticsScreen,
});

const KEYS = ["fuel", "medkit", "rations", "battery"] as const;
type StockKey = (typeof KEYS)[number];
const LABEL: Record<StockKey, string> = { fuel: "Fuel (L)", medkit: "Medkits", rations: "Rations", battery: "Batteries" };

function LogisticsScreen() {
  const world = useSim((s) => s.world);
  const events = useSim((s) => s.events);
  const depots = useMemo(() => Object.values(world.depots), [world.depots]);

  // Burn-down history reconstructed from resource_level events in the log.
  const history = useMemo(() => {
    const h: Record<string, Record<StockKey, number[]>> = {};
    for (const e of events) {
      if (e.type !== "resource_level") continue;
      const p = e.payload as { stock?: Record<StockKey, number> };
      if (!p.stock) continue;
      h[e.entityId] ??= { fuel: [], medkit: [], rations: [], battery: [] };
      KEYS.forEach((k) => h[e.entityId]![k].push(p.stock![k]));
    }
    return h;
  }, [events]);

  const rate = (series: number[] | undefined) => {
    if (!series || series.length < 2) return 0;
    const window = series.slice(-30);
    const delta = window[0]! - window[window.length - 1]!;
    return delta / Math.max(1, window.length - 1); // units per sample
  };

  const tasks = useMemo(() => {
    const out: Array<{ id: string; depot: Depot; key: StockKey; pct: number; ttEmpty: number | null }> = [];
    for (const d of depots) {
      for (const k of KEYS) {
        const pct = (d.stock[k] / d.capacity[k]) * 100;
        const r = rate(history[d.id]?.[k]);
        const tt = r > 0 ? Math.round(d.stock[k] / r) : null;
        if (pct < 45) out.push({ id: `${d.id}-${k}`, depot: d, key: k, pct, ttEmpty: tt });
      }
    }
    return out.sort((a, b) => a.pct - b.pct);
  }, [depots, history]);

  if (!depots.length) {
    return (
      <div className="p-2">
        <EmptyState label="No depots online" hint="Start a scenario in Run Control (S4)." />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <div className="grid gap-2 xl:grid-cols-2">
        {depots.map((d) => (
          <Panel
            key={d.id}
            title={d.name}
            actions={<Mono className="text-[10px]">{d.id}</Mono>}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {KEYS.map((k) => {
                const pct = (d.stock[k] / d.capacity[k]) * 100;
                const series = history[d.id]?.[k] ?? [d.stock[k]];
                const r = rate(series);
                const tt = r > 0 ? Math.round(d.stock[k] / r) : null;
                const color = pct < 20 ? "#F87171" : pct < 45 ? "#FBBF24" : "#4ADE80";
                return (
                  <div key={k} className=" border border-border p-2">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {LABEL[k]}
                      </span>
                      <span className="font-mono text-sm" style={{ color }}>
                        {Math.round(d.stock[k])}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-raised">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                    <div className="mt-1.5">
                      <Sparkline data={series.slice(-60)} color={color} height={26} />
                    </div>
                    <Mono className="mt-1 block text-[10px] text-muted-foreground">
                      {tt ? `empty in ~${formatSimClock(tt)}` : "stable"}
                    </Mono>
                  </div>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>

      <Panel title="Resupply tasking" actions={<Mono className="text-[10px]">{tasks.length} OPEN</Mono>}>
        {tasks.length === 0 ? (
          <EmptyState label="All depots above threshold" hint="Tasks appear automatically below 45% stock." />
        ) : (
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="pb-1">Priority</th>
                <th className="pb-1">Depot</th>
                <th className="pb-1">Commodity</th>
                <th className="pb-1">Level</th>
                <th className="pb-1">Time to empty</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-t border-border/60">
                  <td className="py-1">
                    <SeverityTag severity={t.pct < 20 ? "critical" : t.pct < 35 ? "high" : "medium"} />
                  </td>
                  <td className="py-1">{t.depot.name}</td>
                  <td className="py-1">{LABEL[t.key]}</td>
                  <td className="py-1">{t.pct.toFixed(0)}%</td>
                  <td className="py-1 text-muted-foreground">
                    {t.ttEmpty ? formatSimClock(t.ttEmpty) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
