import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, SeverityTag } from "@/components/doip/primitives";
import { Sparkline } from "@/components/doip/Sparkline";
import { useSim } from "@/sim/store";
import type { Depot } from "@/sim/types";
import { formatSimClock } from "@/lib/doip";
import { CloudRain, Truck, ArrowRight, ShieldCheck, Filter } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/logistics")({
  head: () => ({
    meta: [
      { title: "Logistics — DOIP" },
      {
        name: "description",
        content:
          "Depot stock burn-down, projected time-to-empty and auto-generated resupply tasking.",
      },
      { property: "og:title", content: "Logistics — DOIP" },
      {
        property: "og:description",
        content: "Fuel, medkits, rations and batteries tracked across every depot.",
      },
    ],
  }),
  component: LogisticsScreen,
});

const KEYS = ["fuel", "medkit", "rations", "battery"] as const;
type StockKey = (typeof KEYS)[number];
const LABEL: Record<StockKey, string> = {
  fuel: "Fuel (L)",
  medkit: "Medkits",
  rations: "Rations",
  battery: "Batteries",
};

function LogisticsScreen() {
  const navigate = useNavigate();
  const world = useSim((s) => s.world);
  const events = useSim((s) => s.events);
  const depots = useMemo(() => Object.values(world.depots), [world.depots]);
  const [selectedCommodity, setSelectedCommodity] = useState<StockKey | "ALL">("ALL");

  // Environmental impact on consumption and resupply transit times
  const weatherCells = useMemo(() => Object.values(world.weather), [world.weather]);
  const primaryWeather = weatherCells[0] ?? null;
  const maxWeatherIntensity = useMemo(
    () => weatherCells.reduce((max, w) => Math.max(max, w.intensity ?? 0), 0),
    [weatherCells],
  );
  const weatherImpactFactor = useMemo(() => {
    if (maxWeatherIntensity <= 0.1) return 1.0;
    return 1.0 + maxWeatherIntensity * 0.45;
  }, [maxWeatherIntensity]);

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
    const out: Array<{
      id: string;
      depot: Depot;
      key: StockKey;
      pct: number;
      ttEmpty: number | null;
      adjustedTTE: number | null;
    }> = [];
    for (const d of depots) {
      for (const k of KEYS) {
        if (selectedCommodity !== "ALL" && k !== selectedCommodity) continue;
        const pct = (d.stock[k] / d.capacity[k]) * 100;
        const r = rate(history[d.id]?.[k]);
        const nominalTT = r > 0 ? Math.round(d.stock[k] / r) : null;
        const adjustedTT = r > 0 ? Math.round(d.stock[k] / (r * weatherImpactFactor)) : null;

        if (pct < 45) {
          out.push({
            id: `${d.id}-${k}`,
            depot: d,
            key: k,
            pct,
            ttEmpty: nominalTT,
            adjustedTTE: adjustedTT,
          });
        }
      }
    }
    return out.sort((a, b) => a.pct - b.pct);
  }, [depots, history, selectedCommodity, weatherImpactFactor]);

  const handleDispatchResupply = (task: { depot: Depot; key: StockKey }) => {
    toast.success("Resupply Convoy Task Initiated", {
      description: `Tasking support transport for ${task.depot.name} (${LABEL[task.key]}). Redirecting to Mission Planner...`,
    });
    void navigate({
      to: "/planner",
    });
  };

  if (!depots.length) {
    return (
      <div className="p-2">
        <EmptyState label="No depots online" hint="Start a scenario in Run Control (S4)." />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      {/* Environmental Weather Friction Alert */}
      {primaryWeather && maxWeatherIntensity > 0.15 && (
        <div className="border border-warning/40 bg-warning/10 px-3 py-2 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
          <div className="flex items-center gap-2 text-warning">
            <CloudRain className="size-4 animate-pulse" />
            <span className="font-semibold uppercase tracking-wider">
              Environmental Degradation:{" "}
              {primaryWeather.kind ? primaryWeather.kind.toUpperCase() : "STORM"} (
              {(maxWeatherIntensity * 100).toFixed(0)}% INTENSITY)
            </span>
          </div>
          <span className="text-muted-foreground text-[11px]">
            Terrain transit friction modifier:{" "}
            <span className="text-warning font-semibold">
              +{((weatherImpactFactor - 1) * 100).toFixed(0)}%
            </span>{" "}
            · Time-to-Empty (TTE) accelerated
          </span>
        </div>
      )}

      {/* Commodity Category Filters */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2">
        <div className="flex items-center gap-1 font-mono text-xs">
          <span className="text-muted-foreground uppercase tracking-wider flex items-center gap-1 mr-1">
            <Filter className="size-3" /> COMMODITY:
          </span>
          {(["ALL", "fuel", "medkit", "rations", "battery"] as const).map((key) => {
            const label = key === "ALL" ? "ALL COMMODITIES" : LABEL[key];
            const isSelected = selectedCommodity === key;
            return (
              <button
                key={key}
                onClick={() => setSelectedCommodity(key)}
                className={cn(
                  "border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors",
                  isSelected
                    ? "border-primary bg-primary/20 text-primary font-semibold"
                    : "border-border bg-base text-muted-foreground hover:bg-raised hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <Mono className="text-[10px] text-muted-foreground">
          {depots.length} DEPOTS ACTIVE · SIM T+{world.tick}
        </Mono>
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        {depots.map((d) => (
          <Panel key={d.id} title={d.name} actions={<Mono className="text-[10px]">{d.id}</Mono>}>
            <div className="grid gap-2 sm:grid-cols-2">
              {KEYS.map((k) => {
                if (selectedCommodity !== "ALL" && k !== selectedCommodity) return null;
                const pct = (d.stock[k] / d.capacity[k]) * 100;
                const series = history[d.id]?.[k] ?? [d.stock[k]];
                const r = rate(series);
                const nominalTT = r > 0 ? Math.round(d.stock[k] / r) : null;
                const adjustedTT =
                  r > 0 ? Math.round(d.stock[k] / (r * weatherImpactFactor)) : null;
                const color = pct < 20 ? "#F87171" : pct < 45 ? "#FBBF24" : "#4ADE80";

                return (
                  <div key={k} className="border border-border p-2 bg-base">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {LABEL[k]}
                      </span>
                      <span className="font-mono text-sm font-semibold" style={{ color }}>
                        {Math.round(d.stock[k])}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-raised">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(0, pct))}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                    <div className="mt-1.5">
                      <Sparkline data={series.slice(-60)} color={color} height={26} />
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
                      <span className="text-muted-foreground">{pct.toFixed(0)}% CAPACITY</span>
                      <span className="text-muted-foreground">
                        {adjustedTT
                          ? `empty ~${formatSimClock(adjustedTT)}`
                          : nominalTT
                            ? `empty ~${formatSimClock(nominalTT)}`
                            : "burn stable"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>

      <Panel
        title="Resupply tasking queue"
        actions={<Mono className="text-[10px]">{tasks.length} OPEN TASKS</Mono>}
      >
        {tasks.length === 0 ? (
          <EmptyState
            label="All depots above replenishment threshold"
            hint="Tasks appear automatically below 45% stock."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/80">
                <tr>
                  <th className="pb-1.5">Priority</th>
                  <th className="pb-1.5">Depot</th>
                  <th className="pb-1.5">Commodity</th>
                  <th className="pb-1.5">Stock Level</th>
                  <th className="pb-1.5">Nominal TTE</th>
                  <th className="pb-1.5">Weather-Adjusted TTE</th>
                  <th className="pb-1.5 text-right">Support Action</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-border/60 hover:bg-raised/40 transition-colors"
                  >
                    <td className="py-2">
                      <SeverityTag
                        severity={t.pct < 20 ? "critical" : t.pct < 35 ? "high" : "medium"}
                      />
                    </td>
                    <td className="py-2 font-semibold text-foreground">{t.depot.name}</td>
                    <td className="py-2">{LABEL[t.key]}</td>
                    <td className="py-2 font-mono">{t.pct.toFixed(0)}%</td>
                    <td className="py-2 text-muted-foreground font-mono">
                      {t.ttEmpty ? formatSimClock(t.ttEmpty) : "—"}
                    </td>
                    <td className="py-2 text-warning font-mono">
                      {t.adjustedTTE ? formatSimClock(t.adjustedTTE) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleDispatchResupply(t)}
                        className="inline-flex items-center gap-1 border border-primary/50 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20 hover:border-primary transition-colors"
                        title="Route resupply mission in Tactical Planner"
                      >
                        <Truck className="size-3" />
                        <span>DISPATCH CONVOY</span>
                        <ArrowRight className="size-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
