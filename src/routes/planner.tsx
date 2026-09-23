import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MapView } from "@/components/map/MapView";
import { EmptyState, Panel, Mono } from "@/components/doip/primitives";
import { canPlan, formatCoord } from "@/lib/doip";
import { simStore, useSim } from "@/sim/store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Check,
  X,
  Undo2,
  Trash2,
  Rocket,
  Copy,
  FileCode,
  ShieldCheck,
  AlertOctagon,
  Fuel,
  Compass,
} from "lucide-react";

export const Route = createFileRoute("/planner")({
  head: () => ({
    meta: [
      { title: "Mission Planner — DOIP" },
      {
        name: "description",
        content:
          "Draw waypoints on the tactical map and compare a naive route against an optimized one before launch.",
      },
      { property: "og:title", content: "Mission Planner — DOIP" },
      {
        property: "og:description",
        content:
          "Waypoint planning with terrain, threat and weather cost breakdown and a feasibility checklist.",
      },
    ],
  }),
  component: PlannerScreen,
});

const haversineKm = (a: [number, number], b: [number, number]) => {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const pathKm = (pts: Array<[number, number]>) =>
  pts.slice(1).reduce((sum, p, i) => sum + haversineKm(pts[i]!, p), 0);

/** Nearest-neighbour tour from the first waypoint — the "optimized" route ordering. */
function optimize(points: Array<[number, number]>) {
  if (points.length < 3) return points;
  const remaining = points.slice(1);
  const out: Array<[number, number]> = [points[0]!];
  while (remaining.length) {
    const last = out[out.length - 1]!;
    let bi = 0;
    let bd = Infinity;
    remaining.forEach((p, i) => {
      const d = haversineKm(last, p);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    out.push(remaining.splice(bi, 1)[0]!);
  }
  return out;
}

function PlannerScreen() {
  const world = useSim((s) => s.world);
  const role = useSim((s) => s.role);
  const userName = useSim((s) => s.userName);
  const [waypoints, setWaypoints] = useState<Array<[number, number]>>([]);
  const [unitId, setUnitId] = useState<string>("");

  const units = useMemo(
    () => Object.values(world.units).filter((u) => u.kind !== "depot"),
    [world.units],
  );
  const unit = units.find((u) => u.id === unitId) ?? units[0];
  const editable = canPlan(role);

  const naive = waypoints;
  const optimized = useMemo(() => optimize(waypoints), [waypoints]);
  const naiveKm = pathKm(naive);
  const optKm = pathKm(optimized);
  const saved = naiveKm - optKm;
  const speed = unit?.speedKph || 30;
  const fuelPerKm = 0.42;

  const threatZones = useMemo(() => world.zones.filter((z) => z.kind !== "patrol"), [world.zones]);
  const weatherCells = useMemo(() => Object.values(world.weather), [world.weather]);

  const inZone = useMemo(
    () => (pt: [number, number]) =>
      threatZones.some((z) => {
        const lats = z.points.map((p) => p[0]);
        const lons = z.points.map((p) => p[1]);
        return (
          pt[0] > Math.min(...lats) &&
          pt[0] < Math.max(...lats) &&
          pt[1] > Math.min(...lons) &&
          pt[1] < Math.max(...lons)
        );
      }),
    [threatZones],
  );
  const nearWeather = useMemo(
    () => (pt: [number, number]) =>
      weatherCells.some((w) => haversineKm(pt, [w.lat, w.lon]) * 1000 < w.radiusM + 500),
    [weatherCells],
  );

  // Ch18 S5: route cost split — distance + terrain friction + threat exposure + weather exposure.
  const cost = useMemo(() => {
    const segments = optimized
      .slice(1)
      .map((p, i) => [optimized[i]!, p] as [[number, number], [number, number]]);
    const threatKm = segments
      .filter(([a, b]) => inZone(a) || inZone(b))
      .reduce((s, [a, b]) => s + haversineKm(a, b), 0);
    const weatherKm = segments
      .filter(([a, b]) => nearWeather(a) || nearWeather(b))
      .reduce((s, [a, b]) => s + haversineKm(a, b), 0);
    const terrainKm = optKm * 0.12; // synthetic terrain-friction surcharge
    return {
      base: optKm,
      terrain: terrainKm,
      threat: threatKm * 1.5,
      threatKm,
      weather: weatherKm * 0.8,
      weatherKm,
      total: optKm + terrainKm + threatKm * 1.5 + weatherKm * 0.8,
    };
  }, [optimized, optKm, inZone, nearWeather]);

  const inThreatZone = useMemo(() => waypoints.some((w) => inZone(w)), [waypoints, inZone]);

  const checks = [
    { label: "At least 2 waypoints", ok: waypoints.length >= 2 },
    { label: "Assigned unit selected", ok: Boolean(unit) },
    {
      label: `Fuel sufficient (${(optKm * fuelPerKm).toFixed(0)}L needed)`,
      ok: (unit?.fuel ?? 0) >= optKm * fuelPerKm,
    },
    { label: "No waypoint inside a restricted/threat zone", ok: !inThreatZone },
    { label: "Weather clear along route", ok: cost.weatherKm === 0 },
  ];
  const feasible = checks.every((c) => c.ok);

  const maxRangeKm = unit ? unit.fuel / fuelPerKm : 0;
  const pnrKm = maxRangeKm / 2;
  const isPnrExceeded = optKm > pnrKm;
  const fuelNeededL = optKm * fuelPerKm;

  const autoDetour = () => {
    if (waypoints.length < 2) return;
    const adjusted = waypoints.map((pt) => {
      let lat = pt[0];
      const lon = pt[1];
      threatZones.forEach((z) => {
        const lats = z.points.map((p) => p[0]);
        const lons = z.points.map((p) => p[1]);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) {
          lat = maxLat + 0.02;
        }
      });
      weatherCells.forEach((w) => {
        const distKm = haversineKm([lat, lon], [w.lat, w.lon]);
        if (distKm * 1000 < w.radiusM + 500) {
          lat += 0.03;
        }
      });
      return [Number(lat.toFixed(4)), Number(lon.toFixed(4))] as [number, number];
    });
    setWaypoints(adjusted);
    toast.success("Detour calculated", {
      description: "Waypoints adjusted outside threat perimeter and weather cells.",
    });
  };

  const exportDsl = () => {
    const yaml = `# DOIP Defensive Waypoint Tasking
- tick: ${world.tick + 5}
  action: assign_route
  unit_id: "${unit?.id || "UN-01"}"
  defensive_posture: "hold_and_monitor"
  waypoints:
${optimized.map((p) => `    - [${p[0]}, ${p[1]}]`).join("\n")}
`;
    void navigator.clipboard.writeText(yaml);
    toast.success("Mission DSL copied to clipboard", {
      description: "Ready to paste into Scenario Editor (S8).",
    });
  };

  if (!units.length) {
    return (
      <div className="p-2">
        <EmptyState label="No units to task" hint="Start a scenario in Run Control (S4) first." />
      </div>
    );
  }

  return (
    <div className="grid h-full gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel
        title="Plan surface"
        actions={
          <Mono className="text-[10px]">
            {editable ? "CLICK MAP TO ADD WAYPOINT" : "READ-ONLY ROLE"}
          </Mono>
        }
        bodyClassName="p-0 h-[620px]"
      >
        <MapView
          units={units}
          zones={world.zones}
          weather={Object.values(world.weather)}
          tick={world.tick}
          waypoints={waypoints}
          routes={[
            { points: naive, color: "#8A8A8A", dashed: true },
            { points: optimized, color: "#FFFFFF" },
          ]}
          {...(editable
            ? { onMapClick: (p: [number, number]) => setWaypoints((w) => [...w, p]) }
            : {})}
        />
      </Panel>

      <div className="space-y-2 overflow-y-auto">
        <Panel title="Tasking">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Assigned unit
          </label>
          <select
            value={unit?.id ?? ""}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={!editable}
            className="w-full border border-border bg-base px-2 py-1.5 font-mono text-xs"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.callsign} · {u.kind} · fuel {u.fuel.toFixed(0)}
              </option>
            ))}
          </select>

          <div className="mt-2 flex gap-1.5">
            <button
              onClick={() => setWaypoints((w) => w.slice(0, -1))}
              disabled={!editable || !waypoints.length}
              className="flex flex-1 items-center justify-center gap-1 border border-border px-1.5 py-1.5 font-mono text-[10px] uppercase tracking-widest hover:bg-raised disabled:opacity-40"
            >
              <Undo2 className="size-3" /> Undo
            </button>
            <button
              onClick={() => setWaypoints([])}
              disabled={!editable || !waypoints.length}
              className="flex flex-1 items-center justify-center gap-1 border border-border px-1.5 py-1.5 font-mono text-[10px] uppercase tracking-widest hover:bg-raised disabled:opacity-40"
            >
              <Trash2 className="size-3" /> Clear
            </button>
            <button
              onClick={autoDetour}
              disabled={!editable || waypoints.length < 2}
              className="flex flex-1 items-center justify-center gap-1 border border-primary/60 bg-primary/10 px-1.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20 disabled:opacity-40"
              title="Auto-adjust waypoints to steer clear of active threat zones and storm cells"
            >
              <ShieldCheck className="size-3" /> Detour
            </button>
          </div>

          <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
            {waypoints.map((w, i) => (
              <li
                key={i}
                className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground"
              >
                <span className="text-primary">WP{String(i + 1).padStart(2, "0")}</span>
                {formatCoord(w[0], w[1])}
              </li>
            ))}
            {!waypoints.length && (
              <EmptyState label="No waypoints" hint="Click the map to start planning." />
            )}
          </ul>
        </Panel>

        <Panel title="Route comparison">
          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className=" border border-border p-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Naive
              </div>
              <div className="mt-1 text-lg text-foreground">{naiveKm.toFixed(1)} km</div>
              <div className="text-[10px] text-muted-foreground">
                {((naiveKm / speed) * 60).toFixed(0)} min
              </div>
            </div>
            <div className=" border border-primary/40 bg-primary/5 p-2">
              <div className="text-[10px] uppercase tracking-widest text-primary">Optimized</div>
              <div className="mt-1 text-lg text-primary">{optKm.toFixed(1)} km</div>
              <div className="text-[10px] text-muted-foreground">
                {((optKm / speed) * 60).toFixed(0)} min
              </div>
            </div>
          </div>
          <dl className="mt-2 space-y-1 font-mono text-[11px]">
            <Row k="Distance saved" v={`${saved.toFixed(1)} km`} />
            <Row k="Fuel (optimized)" v={`${(optKm * fuelPerKm).toFixed(1)} L`} />
            <Row k="Fuel saved" v={`${(saved * fuelPerKm).toFixed(1)} L`} />
            <Row k="Time saved" v={`${((saved / speed) * 60).toFixed(0)} min`} />
          </dl>

          <div className="mt-3 border-t border-border pt-2">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Fuel className="size-3" /> Point of No Return (PNR)
              </span>
              <span
                className={cn("font-bold", isPnrExceeded ? "text-sev-critical" : "text-success")}
              >
                {pnrKm.toFixed(1)} km
              </span>
            </div>
            <div className="mt-1.5 flex h-2 w-full overflow-hidden border border-border bg-base">
              <div
                className={cn(
                  "h-full transition-all",
                  isPnrExceeded ? "bg-sev-critical" : "bg-primary",
                )}
                style={{
                  width: `${Math.min(100, (optKm / (maxRangeKm || 1)) * 100)}%`,
                }}
                title={`Route consumption: ${fuelNeededL.toFixed(0)}L`}
              />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
              <span>0 km</span>
              <span className="font-bold text-primary">PNR: {pnrKm.toFixed(1)} km</span>
              <span>Max: {maxRangeKm.toFixed(1)} km</span>
            </div>
            {isPnrExceeded && (
              <div className="mt-2 flex items-center gap-1.5 border border-sev-critical/60 bg-sev-critical/10 p-1.5 font-mono text-[10px] text-sev-critical">
                <AlertOctagon className="size-3.5 shrink-0" />
                <span>PNR Exceeded: Forward refueling required for safe egress.</span>
              </div>
            )}
          </div>

          <p className="mt-2 font-mono text-[9px] text-muted-foreground">
            Ordering: nearest-neighbour tour from WP01.
          </p>
        </Panel>

        <Panel title="Route cost breakdown">
          <dl className="space-y-1 font-mono text-[11px]">
            <Row k="Base distance" v={`${cost.base.toFixed(1)} km`} />
            <Row k="Terrain friction (+12%)" v={`+${cost.terrain.toFixed(1)} km-eq`} />
            <Row
              k={`Threat exposure (${cost.threatKm.toFixed(1)} km × 1.5)`}
              v={`+${cost.threat.toFixed(1)} km-eq`}
            />
            <Row
              k={`Weather exposure (${cost.weatherKm.toFixed(1)} km × 0.8)`}
              v={`+${cost.weather.toFixed(1)} km-eq`}
            />
            <div className="flex justify-between border-t border-border pt-1">
              <dt className="text-foreground">Total route cost</dt>
              <dd className="text-primary">{cost.total.toFixed(1)} km-eq</dd>
            </div>
          </dl>
          <p className="mt-2 font-mono text-[9px] text-muted-foreground">
            Synthetic cost model: km-equivalent penalties over segments crossing threat zones and
            weather cells.
          </p>
        </Panel>

        <Panel title="Feasibility">
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[11px]">
                {c.ok ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <X className="size-3.5 text-red-400" />
                )}
                <span className={c.ok ? "text-muted-foreground" : "text-foreground"}>
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
          <button
            disabled={!editable || !feasible}
            onClick={() => {
              simStore.launchMission({ unitId: unit!.id, waypoints: optimized, by: userName });
              toast.success(`Mission launched · ${unit!.callsign}`, {
                description: `${optimized.length} waypoints · ${optKm.toFixed(1)} km`,
              });
            }}
            className="mt-2 flex w-full items-center justify-center gap-2 bg-primary px-2 py-2 font-mono text-xs uppercase tracking-widest text-primary-foreground disabled:opacity-40"
          >
            <Rocket className="size-3.5" /> Launch mission
          </button>
          <button
            onClick={exportDsl}
            disabled={!optimized.length}
            className="mt-1.5 flex w-full items-center justify-center gap-1.5 border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest hover:bg-raised disabled:opacity-40"
          >
            <FileCode className="size-3" /> Export to Scenario DSL
          </button>
        </Panel>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-border/60 pb-0.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-foreground">{v}</dd>
    </div>
  );
}
