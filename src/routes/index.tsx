import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MapView } from "@/components/map/MapView";
import { AnimatedFeedItem, EmptyState, Mono, SeverityTag } from "@/components/doip/primitives";
import { SEVERITY_META, formatCoord, formatSimClock, canOperate, unitDesignator } from "@/lib/doip";
import { simStore, useSim } from "@/sim/store";
import { isStale } from "@/sim/reducer";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live Map — DOIP Command Center" },
      {
        name: "description",
        content:
          "Real-time synthetic tactical picture: unit tracks, incidents, weather cells and restricted zones on a dark operations map.",
      },
      { property: "og:title", content: "Live Map — DOIP Command Center" },
      {
        property: "og:description",
        content: "Real-time synthetic tactical picture with unit tracks, incidents and weather overlays.",
      },
    ],
  }),
  component: LiveMapScreen,
});

function LiveMapScreen() {
  const world = useSim((s) => s.world);
  const events = useSim((s) => s.events);
  const role = useSim((s) => s.role);
  const userName = useSim((s) => s.userName);
  const [selected, setSelected] = useState<string | null>(null);
  const [tickerOpen, setTickerOpen] = useState(true);
  // Ch18 S3: layer toggle stack — keys 1-4 toggle map layers.
  const [layers, setLayers] = useState({ units: true, incidents: true, weather: true, zones: true });
  // §18.8 follow-mode: when ON, the map re-centers on the selected unit each tick.
  const [followMode, setFollowMode] = useState(false);
  // Ref to the event-feed list so the E key can focus it.
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const key = ({ "1": "units", "2": "incidents", "3": "weather", "4": "zones" } as const)[e.key];
      if (key) setLayers((l) => ({ ...l, [key]: !l[key] }));
    };
    // §18.8 F key — follow-mode toggle (dispatched from AppShell useKeyboard).
    const onFollow = () => setFollowMode((m) => !m);
    // §18.8 E key — focus the event feed.
    const onFocusFeed = () => feedRef.current?.focus();
    window.addEventListener("keydown", onKey);
    window.addEventListener("doip:follow-toggle", onFollow);
    window.addEventListener("doip:focus-feed", onFocusFeed);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("doip:follow-toggle", onFollow);
      window.removeEventListener("doip:focus-feed", onFocusFeed);
    };
  }, []);

  const units = useMemo(() => Object.values(world.units), [world.units]);
  const incidents = useMemo(() => Object.values(world.incidents).filter((i) => i.open), [world.incidents]);
  const weather = useMemo(() => Object.values(world.weather), [world.weather]);
  const recent = useMemo(() => events.slice(-120).reverse(), [events]);

  const selectedUnit = selected ? world.units[selected] : undefined;
  const selectedIncident = selected ? world.incidents[selected] : undefined;
  const selectedEvents = useMemo(
    () => (selected ? events.filter((e) => e.entityId === selected).slice(-8).reverse() : []),
    [events, selected],
  );

  const alertsFor = useMemo(
    () => Object.values(world.alerts).filter((a) => a.entityId === selected && !a.acked),
    [world.alerts, selected],
  );

  const ack = (id: string) => {
    if (!canOperate(role)) {
      toast.error("Read-only role", { description: "Acknowledging alerts requires operator access." });
      return;
    }
    simStore.ackAlert(id, userName);
    toast.success("Alert acknowledged");
  };

  if (!units.length) {
    return (
      <div className="p-2">
        <EmptyState
          label="No active run"
          hint="Start a scenario from Run Control (S4) to populate the tactical picture."
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0">
      <div className="min-w-0 flex-1 p-2">
        <MapView
          units={layers.units ? units : []}
          incidents={layers.incidents ? incidents : []}
          weather={layers.weather ? weather : []}
          zones={layers.zones ? world.zones : []}
          radar
          tick={world.tick}
          selectedId={selected}
          onSelectUnit={setSelected}
          onSelectIncident={setSelected}
          focus={
            followMode && selectedUnit
              ? [selectedUnit.lat, selectedUnit.lon]
              : null
          }
        />
      </div>

      <div className="doip-panel doip-float absolute bottom-3 left-3 z-[500] w-40 p-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Layers</div>
        <ul className="mt-1 space-y-0.5">
          {(
            [
              ["units", "Units", "1"],
              ["incidents", "Incidents", "2"],
              ["weather", "Weather", "3"],
              ["zones", "Zones", "4"],
            ] as const
          ).map(([key, label, hotkey]) => (
            <li key={key}>
              <button
                onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
                aria-pressed={layers[key]}
                className={cn(
                  "flex w-full items-center gap-1.5 px-1 py-0.5 font-mono text-[10px] uppercase tracking-widest hover:bg-raised",
                  layers[key] ? "text-primary" : "text-muted-foreground line-through",
                )}
              >
                <span>{layers[key] ? "☑" : "☐"}</span>
                {label}
                <span className="ml-auto text-muted-foreground/60">[{hotkey}]</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected && (selectedUnit || selectedIncident) && (
        <aside className="doip-panel doip-float absolute left-3 top-3 z-[500] w-72 p-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-sm text-primary">
                {selectedUnit ? unitDesignator(selectedUnit, world.personnel) : selectedIncident?.id}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {selectedUnit ? selectedUnit.kind : selectedIncident?.kind}
              </div>
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
          </div>

          <dl className="mt-2 space-y-1 font-mono text-[11px]">
            {selectedUnit && (
              <>
                <Row k="POSITION" v={formatCoord(selectedUnit.lat, selectedUnit.lon)} />
                <Row k="SECTOR" v={selectedUnit.sector} />
                <Row k="STATUS" v={isStale(selectedUnit, world.tick) ? "STALE (no comms)" : selectedUnit.status.toUpperCase()} />
                <Row k="FUEL" v={`${selectedUnit.fuel.toFixed(0)}%`} />
                <Row k="BATTERY" v={`${selectedUnit.battery.toFixed(0)}%`} />
                <Row k="LAST SEEN" v={`T+${selectedUnit.lastSeenTick}`} />
              </>
            )}
            {selectedIncident && (
              <>
                <Row k="OPENED" v={`T+${selectedIncident.tick}`} />
                <Row k="POSITION" v={formatCoord(selectedIncident.lat, selectedIncident.lon)} />
                <Row k="SEVERITY" v={SEVERITY_META[selectedIncident.severity].label} />
              </>
            )}
          </dl>

          <div className="mt-2 space-y-1">
            {alertsFor.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No open alerts for this entity.</p>
            ) : (
              alertsFor.map((a) => (
                <div key={a.id} className="flex items-center gap-2 border border-border p-1.5">
                  <SeverityTag severity={a.severity} showLabel={false} pulse />
                  <span className="min-w-0 flex-1 truncate text-[11px]">{a.message}</span>
                  <button
                    onClick={() => ack(a.id)}
                    className="border border-border px-1.5 py-0.5 font-mono text-[10px] hover:bg-raised doip-btn-primary"
                  >
                    ACK <span className="text-muted-foreground">[A]</span>
                  </button>
                </div>
              ))
            )}
          </div>

          {selectedIncident?.open && (
            <button
              onClick={() => {
                if (!canOperate(role)) {
                  toast.error("Read-only role");
                  return;
                }
                simStore.closeIncident(selectedIncident.id);
                toast.success(`${selectedIncident.id} closed`);
              }}
              className="mt-2 w-full border border-border py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-raised doip-btn-primary"
            >
              Close incident
            </button>
          )}

          <div className="mt-2 border-t border-border pt-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Recent events
            </div>
            <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
              {selectedEvents.map((e) => (
                <li key={e.id} className="truncate font-mono text-[10px] text-mono">
                  [e:{e.id}] T+{e.tick} {e.type}
                </li>
              ))}
              {!selectedEvents.length && (
                <li className="text-[10px] text-muted-foreground">No events yet.</li>
              )}
            </ul>
          </div>
        </aside>
      )}

      <div
        className={cn(
          "doip-panel doip-float absolute bottom-3 right-3 top-3 z-[500] flex flex-col transition-[width]",
          tickerOpen ? "w-80" : "w-8",
        )}
      >
        <button
          onClick={() => setTickerOpen((o) => !o)}
          className="flex h-8 items-center gap-1 border-b border-border px-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          {tickerOpen ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
          {tickerOpen && "Event ticker"}
        </button>
        {tickerOpen && (
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {recent.map((e) => (
              <li
                key={e.id}
                className="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 font-mono text-[10px] hover:bg-raised doip-btn-primary"
                onClick={() => setSelected(e.entityId)}
              >
                <span className="text-muted-foreground">{formatSimClock(e.tick)}</span>
                <SeverityTag severity={e.severity} showLabel={false} />
                <span className="truncate text-mono">{e.type}</span>
                <span className="ml-auto shrink-0 text-muted-foreground/70">
                  {e.entityId.slice(0, 12)}
                </span>
              </li>
            ))}
            {!recent.length && <EmptyState label="No events yet" />}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>
        <Mono>{v}</Mono>
      </dd>
    </div>
  );
}
