import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MapView } from "@/components/map/MapView";
import { EmptyState, Panel, SeverityTag, Mono } from "@/components/doip/primitives";
import { formatSimClock, SEVERITY_META } from "@/lib/doip";
import { useSim } from "@/sim/store";
import { foldEvents } from "@/sim/reducer";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Play, Pause, Download, FileText } from "lucide-react";
import type { Severity } from "@/sim/types";

export const Route = createFileRoute("/replay")({
  validateSearch: (s: Record<string, unknown>): { run?: string } =>
    typeof s["run"] === "string" ? { run: s["run"] } : {},
  head: () => ({
    meta: [
      { title: "Replay — DOIP" },
      {
        name: "description",
        content:
          "Scrub any finished exercise tick by tick, rendered purely from the immutable event log.",
      },
      { property: "og:title", content: "Replay — DOIP" },
      {
        property: "og:description",
        content:
          "Per-run replay with event-density heatstrip, 1-8x playback and after-action export.",
      },
    ],
  }),
  component: ReplayScreen,
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

function ReplayScreen() {
  const liveEvents = useSim((s) => s.events);
  const liveTick = useSim((s) => s.world.tick);
  const runs = useSim((s) => s.runs);
  const { run: runParam } = Route.useSearch();

  const [source, setSource] = useState<string>(runParam ?? "LIVE");
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [aarDownloading, setAarDownloading] = useState(false);

  useEffect(() => {
    if (runParam) setSource(runParam);
  }, [runParam]);

  const selectedRun = runs.find((r) => r.id === source);
  const events = selectedRun ? selectedRun.log : liveEvents;
  const maxTick = selectedRun ? selectedRun.ticks : liveTick;

  useEffect(() => {
    setTick(0);
    setPlaying(false);
    setSelectedEvent(null);
  }, [source]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setTick((v) => (v >= maxTick ? 0 : v + 1));
    }, 1000 / speed);
    return () => clearInterval(t);
  }, [playing, speed, maxTick]);

  const snapshot = useMemo(() => foldEvents(events, tick), [events, tick]);
  const density = useMemo(() => {
    const buckets = new Array(80).fill(0) as number[];
    if (!maxTick) return buckets;
    for (const e of events) buckets[Math.min(79, Math.floor((e.tick / maxTick) * 79))]! += 1;
    return buckets;
  }, [events, maxTick]);
  const maxDensity = Math.max(...density, 1);

  const notable = useMemo(
    () =>
      events
        .filter(
          (e) => e.severity === "high" || e.severity === "critical" || e.type === "incident_open",
        )
        .slice(-200)
        .reverse(),
    [events],
  );

  const pulseAt = useMemo(() => {
    const e = events.find((x) => x.id === selectedEvent);
    const p = e?.payload as { lat?: number; lon?: number } | undefined;
    return p?.lat && p?.lon ? ([p.lat, p.lon] as [number, number]) : null;
  }, [events, selectedEvent]);

  const milestones = useMemo(() => {
    const list: Array<{ label: string; tick: number; severity: Severity; type: string }> = [];
    const seen = new Set<string>();
    for (const e of events) {
      if (e.type === "incident_open" && !seen.has("incident_open")) {
        seen.add("incident_open");
        list.push({ label: "First Incident", tick: e.tick, severity: e.severity, type: e.type });
      } else if (e.type === "alert_raise" && e.severity === "critical" && !seen.has("crit_alert")) {
        seen.add("crit_alert");
        list.push({ label: "Critical Alert", tick: e.tick, severity: "critical", type: e.type });
      } else if (e.type === "weather_spawn" && !seen.has("weather_spawn")) {
        seen.add("weather_spawn");
        list.push({ label: "Storm Front", tick: e.tick, severity: "high", type: e.type });
      }
    }
    return list;
  }, [events]);

  const doctrineCompliance = useMemo(() => {
    const incidentOpens = events.filter((e) => e.type === "incident_open");
    const incidentCloses = events.filter((e) => e.type === "incident_close");
    if (!incidentOpens.length)
      return { score: 100, label: "NOMINAL", detail: "No incidents triggered" };
    const closeRatio = incidentCloses.length / incidentOpens.length;
    const score = Math.round(closeRatio * 100);
    return {
      score,
      label: score >= 80 ? "SOP-01 / POL-02 COMPLIANT" : "NON-CONFORMING AUDIT",
      detail: `${incidentCloses.length}/${incidentOpens.length} incidents neutralized`,
    };
  }, [events]);

  const exportAar = () => {
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const e of events) {
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    downloadJson(`doip-${source.toLowerCase()}-after-action.json`, {
      source,
      scenarioId: selectedRun?.scenarioId ?? "LIVE",
      seed: selectedRun?.seed ?? null,
      ticks: maxTick,
      totalEvents: events.length,
      bySeverity,
      byType,
      notableEvents: notable.slice(0, 100),
    });
  };

  // P2-4: Backend-generated Markdown AAR for saved runs
  const downloadMarkdownAar = async () => {
    if (source === "LIVE") {
      toast.warning("Select a saved run to export a backend AAR.");
      return;
    }
    setAarDownloading(true);
    const res = await api.downloadAar(source);
    setAarDownloading(false);
    if (!res) {
      toast.error("AAR export failed — backend offline.");
      return;
    }
    const blob = new Blob([res.report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `doip-${source.toLowerCase()}-aar.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("AAR downloaded.");
  };

  if (!events.length) {
    return (
      <div className="p-2">
        <EmptyState
          label="No event log"
          hint="Run a scenario first — replay renders entirely from the log."
        />
      </div>
    );
  }

  return (
    <div className="grid h-full gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col gap-2">
        <Panel
          title={`Replay · T+${tick} / ${maxTick}`}
          actions={
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-foreground"
              aria-label="Replay source"
            >
              <option value="LIVE">LIVE LOG</option>
              {runs
                .slice()
                .reverse()
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} · {r.scenarioId} · seed {r.seed}
                  </option>
                ))}
            </select>
          }
          bodyClassName="p-0 h-[440px]"
        >
          <MapView
            units={Object.values(snapshot.units)}
            incidents={Object.values(snapshot.incidents).filter((i) => i.open)}
            weather={Object.values(snapshot.weather)}
            zones={snapshot.zones}
            tick={tick}
            pulseAt={pulseAt}
            focus={pulseAt}
          />
        </Panel>

        <Panel title="Timeline">
          {milestones.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Milestones:
              </span>
              {milestones.map((m) => (
                <button
                  key={m.label}
                  onClick={() => {
                    setTick(m.tick);
                    setPlaying(false);
                    toast.info(`Scrubbed to ${m.label} (T+${m.tick})`);
                  }}
                  className="flex items-center gap-1 border border-border bg-base px-1.5 py-0.5 font-mono text-[9px] hover:border-primary/60"
                >
                  <SeverityTag severity={m.severity} showLabel={false} />
                  <span>{m.label}</span>
                  <span className="text-muted-foreground">T+{m.tick}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex h-8 items-end gap-px">
            {density.map((d, i) => (
              <div
                key={i}
                className="flex-1 "
                style={{
                  height: `${Math.max(6, (d / maxDensity) * 100)}%`,
                  backgroundColor: `rgba(242,242,242,${0.2 + (d / maxDensity) * 0.8})`,
                }}
                title={`${d} events`}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, maxTick)}
            value={tick}
            onChange={(e) => setTick(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
            aria-label="Replay position"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="flex items-center gap-1.5 bg-primary px-2 py-1.5 font-mono text-xs uppercase tracking-widest text-primary-foreground"
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {playing ? "Pause" : "Play"}
            </button>
            {[1, 2, 4, 8].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={cn(
                  "h-8 w-10  border font-mono text-xs",
                  speed === s
                    ? "border-primary/60 bg-raised text-primary"
                    : "border-border hover:bg-raised doip-btn-primary",
                )}
              >
                {s}x
              </button>
            ))}
            <button
              onClick={exportAar}
              className="flex items-center gap-1.5 border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest hover:bg-raised"
              title="Export an after-action summary of this log as JSON"
            >
              <Download className="size-3" /> Export JSON
            </button>
            {source !== "LIVE" && (
              <button
                id="export-aar-md-btn"
                onClick={downloadMarkdownAar}
                disabled={aarDownloading}
                className="flex items-center gap-1.5 border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest hover:bg-raised disabled:opacity-50"
                title="Download a structured Markdown After-Action Report from the backend"
              >
                <FileText className="size-3" />
                {aarDownloading ? "Generating…" : "AAR (MD)"}
              </button>
            )}
            <Mono className="ml-auto text-xs">{formatSimClock(tick)}</Mono>
          </div>
        </Panel>

        <Panel
          title={`Synchronized telemetry · T+${tick}`}
          actions={
            <span
              className={cn(
                "font-mono text-[10px] font-bold uppercase",
                doctrineCompliance.score >= 80 ? "text-success" : "text-sev-medium",
              )}
            >
              {doctrineCompliance.label} ({doctrineCompliance.score}%)
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.values(snapshot.units)
              .slice(0, 4)
              .map((u) => (
                <div key={u.id} className="border border-border p-1.5 font-mono text-[10px]">
                  <div className="flex justify-between font-bold text-foreground">
                    <span>{u.callsign}</span>
                    <span className={cn(u.fuel < 30 ? "text-sev-critical" : "text-primary")}>
                      {u.fuel.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-muted-foreground">
                    <span>{u.speedKph.toFixed(0)} km/h</span>
                    <span className="uppercase">{u.status}</span>
                  </div>
                </div>
              ))}
            {!Object.keys(snapshot.units).length && (
              <EmptyState label="No telemetry" hint="Scrub to a tick with active units." />
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Jump to event" bodyClassName="p-2">
        <ul className="max-h-[560px] space-y-0.5 overflow-y-auto">
          {notable.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => {
                  setTick(e.tick);
                  setSelectedEvent(e.id);
                  setPlaying(false);
                }}
                className={cn(
                  "flex w-full items-center gap-1.5  px-1 py-1 text-left font-mono text-[10px] hover:bg-raised doip-btn-primary",
                  selectedEvent === e.id && "bg-raised",
                )}
              >
                <span className="text-muted-foreground">T+{e.tick}</span>
                <SeverityTag severity={e.severity} showLabel={false} />
                <span className="truncate text-mono">{e.type}</span>
                <span className="ml-auto text-muted-foreground/70">
                  {SEVERITY_META[e.severity].label.slice(0, 4)}
                </span>
              </button>
            </li>
          ))}
          {!notable.length && <EmptyState label="No notable events" />}
        </ul>
      </Panel>
    </div>
  );
}
