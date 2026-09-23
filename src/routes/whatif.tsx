import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, AiBadge } from "@/components/doip/primitives";
import { mulberry32 } from "@/sim/prng";
import { useSim } from "@/sim/store";
import { canOperate } from "@/lib/doip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  api,
  type WhatIfResponse,
  type WhatIfTrackPoint,
  type WhatIfWeatherAnnotation,
  type WhatIfIncidentAnnotation,
  type WhatIfEventRecord,
} from "@/lib/api";
import {
  Check,
  Pencil,
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Trash2,
  X,
  History,
  Sparkles,
  AlertTriangle,
  CloudRain,
  Navigation,
  Compass,
  Layers,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/whatif")({
  head: () => ({
    meta: [
      { title: "What-If Theater — DOIP" },
      {
        name: "description",
        content:
          "Describe a hypothetical, review the AI-drafted scenario actions, approve, and watch the deterministic branch play out.",
      },
      { property: "og:title", content: "What-If Theater — DOIP" },
      {
        property: "og:description",
        content:
          "AI-drafted branch scenarios behind an approve gate, with Monte Carlo confidence ribbons, tactical divergence mapping, and animated deterministic playback.",
      },
    ],
  }),
  component: WhatIfScreen,
});

// ---------------------------------------------------------------------------
// Scenario DSL types and keyword parser (Ch. 13 Golden Rule)
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
      rationale:
        "Prompt implies a weather-driven branch; spawning a moving cell at the stated intensity.",
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
      rationale: "A contact of this severity trips the alert chain immediately.",
    });
  }
  if (/comms|jam|radio|silence/.test(t)) {
    out.push({
      id: id++,
      action: "raise_alert",
      target: "patrol echelon",
      magnitude: 60,
      rationale:
        "Comms degradation surfaces as alerts and stale tracks rather than kinetic events.",
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
        rationale: "No specific stressor recognized — defaulting to a moderate weather branch.",
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

function toEngineActions(actions: DslAction[]) {
  return actions.map((a, idx) => {
    const tick = Math.min(48, 4 + idx * 10);
    if (a.action === "spawn_weather") {
      return {
        tick,
        type: "weather_spawn",
        severity: a.magnitude > 70 ? "high" : "medium",
        entityId: "system",
        payload: {
          intensity: a.magnitude / 100,
          lat: 34.02,
          lon: 71.55,
          radiusKm: 3.0 + (a.magnitude / 100) * 3.5,
          target: a.target,
        },
      };
    } else if (a.action === "create_incident") {
      return {
        tick,
        type: "incident_open",
        severity: a.magnitude > 75 ? "critical" : a.magnitude > 50 ? "high" : "medium",
        entityId: `INC-${tick}`,
        payload: {
          kind: /ambush|contact/.test(a.target) ? "hostile_contact" : "breakdown",
          lat: 34.01,
          lon: 71.52,
          target: a.target,
          magnitude: a.magnitude,
        },
      };
    } else if (a.action === "raise_alert") {
      return {
        tick,
        type: "alert_raise",
        severity: a.magnitude > 70 ? "critical" : "high",
        entityId: "system",
        payload: {
          message: `Branch advisory: ${a.target}`,
          target: a.target,
        },
      };
    } else {
      return {
        tick,
        type: "system",
        severity: "medium",
        entityId: a.target.toLowerCase().includes("convoy") ? "C-1" : "P-1",
        payload: {
          action: "modify_speed",
          multiplier: Math.max(0.2, (100 - a.magnitude) / 100),
          target: a.target,
        },
      };
    }
  });
}

function actionsHash(actions: DslAction[]) {
  return actions.reduce(
    (h, a) => h + VERBS.indexOf(a.action) * 97 + a.magnitude * 13 + a.target.length * 7,
    0,
  );
}

function fallbackProject(seed: number, actions: DslAction[], horizon = 60) {
  const weather = Math.max(
    0,
    ...actions.filter((a) => a.action === "spawn_weather").map((a) => a.magnitude),
  );
  const incidents = actions
    .filter((a) => a.action === "create_incident")
    .reduce((s, a) => s + a.magnitude, 0);
  const alerts = actions
    .filter((a) => a.action === "raise_alert")
    .reduce((s, a) => s + a.magnitude, 0);
  const slow = Math.max(
    0,
    ...actions.filter((a) => a.action === "modify_speed").map((a) => a.magnitude),
  );
  const rand = mulberry32(seed + actionsHash(actions));
  const base = 10 + weather * 0.35 + incidents * 0.25 + alerts * 0.1;
  const series: number[] = [];
  let v = 10;
  for (let i = 0; i <= horizon; i++) {
    const ramp = Math.min(1, i / 15);
    v = Math.max(1, v + (base * ramp - v) * 0.15 + (rand() - 0.5) * 4);
    series.push(Math.round(v * 10) / 10);
  }
  return {
    riskSeries: series,
    coverage: Math.max(20, Math.round(90 - weather * 0.25 - slow * 0.2)),
    expectedIncidents: Math.round(1 + incidents / 40 + weather / 50),
    sustainmentHours: Math.round(46 - slow * 0.15 - weather * 0.1),
    meanResponseMin: Math.round(12 + slow * 0.25 + weather * 0.15),
  };
}

// ---------------------------------------------------------------------------
// Custom Component: Monte Carlo Risk Ribbon & Confidence Chart
// ---------------------------------------------------------------------------

function MonteCarloRiskRibbon({
  baseline,
  branch,
  p10,
  p90,
  currentTick,
  maxTick,
  onScrub,
  actionPins,
}: {
  baseline: number[];
  branch: number[];
  p10?: number[] | undefined;
  p90?: number[] | undefined;
  currentTick: number;
  maxTick: number;
  onScrub: (tick: number) => void;
  actionPins?: Array<{ tick?: number; verb: string; rationale?: string }> | undefined;
}) {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const height = 90;
  const width = 100; // viewBox scale 0..100

  const allVals = [...baseline, ...branch, ...(p10 || []), ...(p90 || [])];
  const max = Math.max(...allVals, 60);
  const min = 0;
  const span = max - min || 1;

  const getY = (val: number) => height - ((val - min) / span) * (height - 12) - 6;
  const getX = (idx: number, len: number) => (idx / Math.max(1, len - 1)) * width;

  // Build baseline points
  const baselinePts = baseline.map((v, i) => `${getX(i, baseline.length)},${getY(v)}`).join(" ");

  // Build branch (median) points
  const branchPts = branch.map((v, i) => `${getX(i, branch.length)},${getY(v)}`).join(" ");

  // Build P10..P90 confidence ribbon polygon
  let ribbonPath = "";
  if (p10 && p90 && p10.length === p90.length && p10.length > 1) {
    const topPts = p90.map((v, i) => `${getX(i, p90.length)},${getY(v)}`);
    const bottomPts = p10.map((v, i) => `${getX(i, p10.length)},${getY(v)}`).reverse();
    ribbonPath = `M ${topPts.join(" L ")} L ${bottomPts.join(" L ")} Z`;
  }

  const needleX = (currentTick / Math.max(1, maxTick)) * width;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onScrub(Math.round(ratio * maxTick));
  };

  const currBase = baseline[Math.min(baseline.length - 1, currentTick)] ?? 0;
  const currBranch = branch[Math.min(branch.length - 1, currentTick)] ?? 0;
  const currP10 = p10?.[Math.min((p10?.length || 1) - 1, currentTick)];
  const currP90 = p90?.[Math.min((p90?.length || 1) - 1, currentTick)];

  return (
    <div className="space-y-1.5">
      {/* Legend & Current Tick Readout */}
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-3 bg-[#94a3b8]" />
            Baseline: <strong className="text-foreground">{currBase.toFixed(1)}</strong>
          </span>
          <span className="flex items-center gap-1.5 text-ai">
            <span className="h-1.5 w-3 bg-[#c084fc]" />
            Branch (P50): <strong className="text-foreground">{currBranch.toFixed(1)}</strong>
          </span>
          {currP10 !== undefined && currP90 !== undefined && (
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
              (Band: {currP10.toFixed(0)}–{currP90.toFixed(0)})
            </span>
          )}
        </div>
        <div className="text-[10px] text-primary">
          T+{currentTick} / {maxTick}
        </div>
      </div>

      {/* SVG Curve Display with Interactive Scrub */}
      <div className="relative border border-border bg-black/60 p-1 cursor-crosshair select-none">
        <svg
          ref={chartRef}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-24 w-full touch-none"
          onPointerDown={handlePointerDown}
        >
          {/* Subtle Grid Lines */}
          <line
            x1="0"
            y1={height / 4}
            x2="100"
            y2={height / 4}
            stroke="#262626"
            strokeDasharray="2"
          />
          <line
            x1="0"
            y1={height / 2}
            x2="100"
            y2={height / 2}
            stroke="#262626"
            strokeDasharray="2"
          />
          <line
            x1="0"
            y1={(height * 3) / 4}
            x2="100"
            y2={(height * 3) / 4}
            stroke="#262626"
            strokeDasharray="2"
          />

          {/* Monte Carlo Confidence Band */}
          {ribbonPath && (
            <path
              d={ribbonPath}
              fill="rgba(167, 139, 250, 0.22)"
              stroke="rgba(167, 139, 250, 0.4)"
              strokeWidth="0.5"
            />
          )}

          {/* Baseline Risk Line */}
          <polyline
            points={baselinePts}
            fill="none"
            stroke="#94a3b8"
            strokeWidth="1.2"
            strokeDasharray="2 1"
            vectorEffect="non-scaling-stroke"
          />

          {/* Branch Median Risk Line */}
          <polyline
            points={branchPts}
            fill="none"
            stroke="#c084fc"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />

          {/* Tactical Action Injects (Diamonds on Timeline) */}
          {actionPins?.map((pin, i) => {
            const pTick = pin.tick ?? 0;
            const pinX = (pTick / Math.max(1, maxTick)) * width;
            return (
              <g
                key={`pin-${i}`}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onScrub(pTick);
                }}
              >
                <title>{`T+${pTick}: ${pin.verb} ${pin.rationale ? `(${pin.rationale})` : ""}`}</title>
                <polygon
                  points={`${pinX},0 ${pinX + 1.8},3.5 ${pinX},7 ${pinX - 1.8},3.5`}
                  fill="#f59e0b"
                  stroke="#fbbf24"
                  strokeWidth="0.3"
                />
              </g>
            );
          })}

          {/* Scrubber Needle Indicator */}
          <line
            x1={needleX}
            y1="0"
            x2={needleX}
            y2={height}
            stroke="#38bdf8"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={needleX} cy={getY(currBranch)} r="2" fill="#38bdf8" />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Component: Tactical Divergence Mini-Map (Vector Radar Grid)
// ---------------------------------------------------------------------------

function TacticalDivergenceMap({
  trajectories,
  spatialAnnotations,
  currentTick,
}: {
  trajectories?: WhatIfResponse["trajectories"];
  spatialAnnotations?: WhatIfResponse["spatialAnnotations"];
  currentTick: number;
}) {
  // Center: ~34.02°N, 71.55°E, Span: ~0.14°
  const minLat = 33.94;
  const maxLat = 34.08;
  const minLon = 71.46;
  const maxLon = 71.62;

  const toMapCoords = (lat: number, lon: number) => {
    const x = ((lon - minLon) / (maxLon - minLon)) * 320;
    const y = (1 - (lat - minLat) / (maxLat - minLat)) * 200;
    return { x: Math.max(5, Math.min(315, x)), y: Math.max(5, Math.min(195, y)) };
  };

  const branchTracks = trajectories?.branch?.tracks || {};
  const baselineTracks = trajectories?.baseline?.tracks || {};
  const units = trajectories?.branch?.units || [];

  const weatherCells: WhatIfWeatherAnnotation[] = spatialAnnotations?.branch?.weatherCells || [];
  const incidents: WhatIfIncidentAnnotation[] = spatialAnnotations?.branch?.incidents || [];

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden border border-border bg-black/90 p-2 font-mono">
      {/* HUD Telemetry Overlay */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 text-[9px] text-primary/80 bg-black/70 px-1.5 py-0.5 border border-primary/30">
        <Compass className="h-3 w-3 animate-spin text-primary" />
        <span>TACTICAL DIVERGENCE GRID · T+{currentTick}</span>
      </div>
      <div className="absolute top-2 right-2 z-10 text-[9px] text-muted-foreground bg-black/70 px-1 border border-border">
        FOV: 18KM · GRID 43R XU
      </div>

      <svg viewBox="0 0 320 200" className="h-full w-full">
        {/* Polar & Orthogonal Grid Lines */}
        <defs>
          <pattern id="tacGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" strokeWidth="0.8" />
          </pattern>
          <radialGradient id="weatherGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
            <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="320" height="200" fill="url(#tacGrid)" />

        {/* Center Crosshairs */}
        <line
          x1="160"
          y1="0"
          x2="160"
          y2="200"
          stroke="#374151"
          strokeWidth="0.5"
          strokeDasharray="3"
        />
        <line
          x1="0"
          y1="100"
          x2="320"
          y2="100"
          stroke="#374151"
          strokeWidth="0.5"
          strokeDasharray="3"
        />

        {/* Weather Cells Footprints */}
        {weatherCells
          .filter((w) => w.tick <= currentTick)
          .map((w, idx) => {
            const pos = toMapCoords(w.lat, w.lon);
            const radius = (w.radiusKm || 4) * 5;
            return (
              <g key={`w-${w.id || idx}`}>
                <circle cx={pos.x} cy={pos.y} r={radius} fill="url(#weatherGrad)" />
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="0.8"
                  strokeDasharray="2"
                />
                <text
                  x={pos.x}
                  y={pos.y - radius - 2}
                  fill="#38bdf8"
                  fontSize="7"
                  textAnchor="middle"
                >
                  CELL {w.id} ({(w.intensity * 100).toFixed(0)}%)
                </text>
              </g>
            );
          })}

        {/* Unit Paths: Baseline (Muted Gray Dotted) vs Branch (Neon Colored Solid) */}
        {units.map((u) => {
          const bTrack = (baselineTracks[u.id] || []).filter((p) => p.tick <= currentTick);
          const brTrack = (branchTracks[u.id] || []).filter((p) => p.tick <= currentTick);

          const bPts = bTrack
            .map((p) => {
              const c = toMapCoords(p.lat, p.lon);
              return `${c.x},${c.y}`;
            })
            .join(" ");

          const brPts = brTrack
            .map((p) => {
              const c = toMapCoords(p.lat, p.lon);
              return `${c.x},${c.y}`;
            })
            .join(" ");

          const currentPoint = brTrack[brTrack.length - 1];
          const curPos = currentPoint ? toMapCoords(currentPoint.lat, currentPoint.lon) : null;

          return (
            <g key={u.id}>
              {/* Baseline Path */}
              {bPts && (
                <polyline
                  points={bPts}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1"
                  strokeDasharray="2"
                  opacity="0.6"
                />
              )}

              {/* Branch Path */}
              {brPts && (
                <polyline
                  points={brPts}
                  fill="none"
                  stroke={u.color || "#c084fc"}
                  strokeWidth="1.8"
                  opacity="0.9"
                />
              )}

              {/* Current Unit Marker at playTick */}
              {curPos && (
                <g transform={`translate(${curPos.x}, ${curPos.y})`}>
                  {currentPoint?.inWeather && (
                    <circle
                      r="6"
                      fill="none"
                      stroke="#eab308"
                      strokeWidth="1"
                      className="animate-ping"
                    />
                  )}
                  <circle r="3.5" fill={u.color || "#c084fc"} stroke="#000" strokeWidth="1" />
                  <text
                    x="5"
                    y="3"
                    fill="#f3f4f6"
                    fontSize="7"
                    fontWeight="bold"
                    filter="drop-shadow(0 1px 2px rgba(0,0,0,0.8))"
                  >
                    {u.callsign}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Incident Hazard Markers */}
        {incidents
          .filter((inc) => inc.tick <= currentTick)
          .map((inc, i) => {
            const pos = toMapCoords(inc.lat, inc.lon);
            return (
              <g key={`inc-${inc.id || i}`} transform={`translate(${pos.x}, ${pos.y})`}>
                <circle
                  r="5"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="1"
                  className="animate-ping"
                />
                <polygon points="0,-4 4,4 -4,4" fill="#ef4444" />
                <text x="6" y="2" fill="#ef4444" fontSize="7" fontWeight="bold">
                  {inc.id}
                </text>
              </g>
            );
          })}
      </svg>

      {/* Map Legend Footer */}
      <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between text-[8px] text-muted-foreground bg-black/60 px-1 border border-border/60">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-2 border-b border-dashed border-[#64748b]" /> Baseline Track
          </span>
          <span className="flex items-center gap-1 text-ai">
            <span className="h-0.5 w-2 bg-[#c084fc]" /> Branch Trajectory
          </span>
          <span className="flex items-center gap-1 text-sky-400">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400/40 border border-sky-400" />{" "}
            Weather Cell
          </span>
          <span className="flex items-center gap-1 text-red-400">
            <span className="h-1.5 w-1.5 bg-red-400" /> Incident
          </span>
        </div>
        <span>SCALE: 1:50,000</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component: WhatIfScreen
// ---------------------------------------------------------------------------

type Phase = "draft" | "review" | "playing" | "done";
const HORIZON = 60;

interface WhatIfHistoryItem {
  id?: number;
  scenario_id?: string;
  seed?: number;
  ticks?: number;
  actions_json?: string;
  baseline_kpis?: string;
  deltas_json?: string;
  created_at?: string;
}

function WhatIfScreen() {
  const seed = useSim((s) => s.world.seed);
  const tick = useSim((s) => s.world.tick);
  const role = useSim((s) => s.role);
  const currentScenarioId = useSim((s) => s.world.scenarioId);

  const [prompt, setPrompt] = useState("");
  const [actions, setActions] = useState<DslAction[]>([]);
  const [phase, setPhase] = useState<Phase>("draft");

  // Playback & Scrubber Controls
  const [playTick, setPlayTick] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<number>(1);

  // Monte Carlo Ensemble configuration
  const [monteCarloRuns, setMonteCarloRuns] = useState<number>(1);
  const [isRunningBranch, setIsRunningBranch] = useState(false);

  // Real backend simulation response
  const [backendResult, setBackendResult] = useState<WhatIfResponse | null>(null);

  // Active view tab: "overview" | "radar" | "events" | "matrix"
  const [playbackTab, setPlaybackTab] = useState<"overview" | "radar" | "events" | "matrix">(
    "overview",
  );

  // Severity filter for event diff
  const [eventSevFilter, setEventSevFilter] = useState<string>("all");

  // What-If history panel
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyData, setHistoryData] = useState<WhatIfHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const res = await api.whatIfHistory(20);
    setHistoryLoading(false);
    if (res?.results) setHistoryData(res.results as WhatIfHistoryItem[]);
    else setHistoryData([]);
  }, []);

  // Client-side fallback projections if backend is not yet called
  const fallbackBaseline = useMemo(() => fallbackProject(seed || 1, []), [seed]);
  const fallbackBranch = useMemo(() => fallbackProject(seed || 1, actions), [seed, actions]);

  // Unified Risk Data (from real backend result if available, otherwise fallback)
  const baselineRiskSeries = backendResult?.baselineRisk || fallbackBaseline.riskSeries;
  const branchRiskSeries = backendResult?.branchRisk || fallbackBranch.riskSeries;
  const p10RiskSeries = backendResult?.p10Risk;
  const p90RiskSeries = backendResult?.p90Risk;

  // Timeline Events Diff
  const currentEvents = useMemo<{
    baseline: WhatIfEventRecord[];
    branch: WhatIfEventRecord[];
  }>(() => {
    if (!backendResult) return { baseline: [], branch: [] };
    const bEvents: WhatIfEventRecord[] = backendResult.baselineEvents.filter(
      (e) => e.tick <= playTick,
    );
    const brEvents: WhatIfEventRecord[] = backendResult.branchEvents.filter(
      (e) => e.tick <= playTick,
    );
    return { baseline: bEvents, branch: brEvents };
  }, [backendResult, playTick]);

  // Animated Playback Timer
  useEffect(() => {
    if (phase !== "playing" || !isPlaying) return;
    const intervalMs = Math.round(100 / playSpeed);
    const t = setInterval(() => {
      setPlayTick((prev) => {
        if (prev >= HORIZON) {
          setIsPlaying(false);
          setPhase("done");
          return HORIZON;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => clearInterval(t);
  }, [phase, isPlaying, playSpeed]);

  if (!tick) {
    return (
      <div className="p-3">
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

  const approve = async () => {
    if (!canOperate(role)) {
      toast.error("Read-only role", {
        description: "Approving a branch requires operator access or above.",
      });
      return;
    }
    if (!actions.length) {
      toast.error("Draft is empty", { description: "Add at least one action before approving." });
      return;
    }

    setIsRunningBranch(true);
    const toastId = toast.loading(
      monteCarloRuns > 1
        ? `Executing Monte Carlo wargame (${monteCarloRuns} ensemble runs)...`
        : "Executing deterministic SimEngine branch...",
    );

    try {
      const scenarioId = currentScenarioId || "SC-1";
      const branchSeed = seed || 42;
      const engActions = toEngineActions(actions);

      const res = await api.whatif(branchSeed, scenarioId, engActions, HORIZON, monteCarloRuns);

      if (res) {
        setBackendResult(res);
        setPlayTick(0);
        setIsPlaying(true);
        setPhase("playing");
        toast.success("Branch approved & simulated", {
          id: toastId,
          description: `SimEngine computed ${res.branchEvents.length} events across ${res.ticks} ticks (Run #${res.id}).`,
        });
        loadHistory();
      } else {
        setPlayTick(0);
        setIsPlaying(true);
        setPhase("playing");
        toast.info("Offline fallback projection active", {
          id: toastId,
          description: "Backend unavailable; using client-side deterministic PRNG.",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Simulation error", { id: toastId, description: msg });
    } finally {
      setIsRunningBranch(false);
    }
  };

  const discard = () => {
    setActions([]);
    setBackendResult(null);
    setPhase("draft");
    setPlayTick(0);
    setIsPlaying(false);
  };

  const updateAction = (id: number, patch: Partial<DslAction>) =>
    setActions((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // Outcome KPI Cards Data
  const metrics = [
    {
      label: "Area Coverage",
      b: backendResult?.deltas?.["coverage_pct"]?.baseline ?? fallbackBaseline.coverage,
      x: backendResult?.deltas?.["coverage_pct"]?.branch ?? fallbackBranch.coverage,
      unit: "%",
      higherBetter: true,
    },
    {
      label: "Expected Incidents",
      b:
        backendResult?.deltas?.["incidents_opened"]?.baseline ?? fallbackBaseline.expectedIncidents,
      x: backendResult?.deltas?.["incidents_opened"]?.branch ?? fallbackBranch.expectedIncidents,
      unit: "",
      higherBetter: false,
    },
    {
      label: "Sustainment Window",
      b:
        backendResult?.deltas?.["sustainment_hours"]?.baseline ?? fallbackBaseline.sustainmentHours,
      x: backendResult?.deltas?.["sustainment_hours"]?.branch ?? fallbackBranch.sustainmentHours,
      unit: "h",
      higherBetter: true,
    },
    {
      label: "Critical Alerts",
      b: backendResult?.deltas?.["critical_alerts"]?.baseline ?? 0,
      x: backendResult?.deltas?.["critical_alerts"]?.branch ?? 1,
      unit: "",
      higherBetter: false,
    },
  ];

  return (
    <div className="grid gap-3 p-3 xl:grid-cols-[400px_minmax(0,1fr)]">
      {/* ==================================================================== */}
      {/* LEFT COLUMN: Hypotheses & AI Scenario DSL Approval Gate              */}
      {/* ==================================================================== */}
      <div className="space-y-3">
        <Panel
          variant="ai"
          title="Hypothetical Formulation"
          actions={<Mono className="text-[10px]">FORK @ T+{tick}</Mono>}
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder='Describe the branch, e.g. "severe storm over northern sector while a convoy is ambushed"'
            className="w-full resize-none border border-border bg-background p-2 font-mono text-xs leading-relaxed outline-none focus:border-ai/60"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="border border-border bg-card/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-raised hover:text-foreground transition-colors"
              >
                {p}
              </button>
            ))}
          </div>

          {/* Monte Carlo Mode Selector */}
          <div className="mt-3 border-t border-border pt-2 flex items-center justify-between font-mono text-[10px]">
            <span className="text-muted-foreground flex items-center gap-1">
              <Layers className="h-3 w-3 text-ai" />
              Wargame Mode:
            </span>
            <div className="flex border border-border bg-background p-0.5">
              <button
                onClick={() => setMonteCarloRuns(1)}
                className={cn(
                  "px-2 py-0.5 transition-colors",
                  monteCarloRuns === 1
                    ? "bg-primary text-primary-foreground font-bold"
                    : "text-muted-foreground",
                )}
              >
                Deterministic (1x)
              </button>
              <button
                onClick={() => setMonteCarloRuns(5)}
                className={cn(
                  "px-2 py-0.5 transition-colors",
                  monteCarloRuns === 5 ? "bg-ai text-white font-bold" : "text-muted-foreground",
                )}
              >
                Monte Carlo (5x)
              </button>
              <button
                onClick={() => setMonteCarloRuns(10)}
                className={cn(
                  "px-2 py-0.5 transition-colors",
                  monteCarloRuns === 10 ? "bg-ai text-white font-bold" : "text-muted-foreground",
                )}
              >
                Deep Ensemble (10x)
              </button>
            </div>
          </div>

          <button
            onClick={generate}
            className="mt-3 flex w-full items-center justify-center gap-2 border border-ai/40 bg-ai/10 px-3 py-2 font-mono text-xs uppercase tracking-widest text-ai hover:bg-ai/20 transition-all shadow-[0_0_12px_rgba(167,139,250,0.15)]"
          >
            <Pencil className="size-3.5" /> Draft Scenario Actions
          </button>
        </Panel>

        {/* Scenario DSL Actions Review Gate */}
        {(phase === "review" || phase === "playing" || phase === "done") && (
          <Panel
            variant="ai"
            title="Drafted Actions — Scenario DSL"
            actions={<AiBadge label="AI DRAFT · AWAITING APPROVAL" />}
          >
            <ul className="space-y-2">
              {actions.map((a) => (
                <li key={a.id} className="border border-ai/30 bg-ai/5 p-2 font-mono text-[10px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={a.action}
                      onChange={(e) => updateAction(a.id, { action: e.target.value as DslVerb })}
                      disabled={phase !== "review"}
                      className="border border-border bg-background px-1 py-0.5 text-ai font-bold"
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
                      className="min-w-0 flex-1 border border-border bg-background px-1 py-0.5"
                      aria-label="Action target"
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">MAG:</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={a.magnitude}
                        onChange={(e) =>
                          updateAction(a.id, {
                            magnitude: Math.max(0, Math.min(100, Number(e.target.value))),
                          })
                        }
                        disabled={phase !== "review"}
                        className="w-12 border border-border bg-background px-1 py-0.5 text-center"
                        aria-label="Magnitude"
                      />
                    </div>
                    {phase === "review" && (
                      <button
                        onClick={() => setActions((x) => x.filter((y) => y.id !== a.id))}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        aria-label="Remove action"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground border-t border-ai/20 pt-1">
                    {a.rationale}
                  </p>
                </li>
              ))}
            </ul>

            {phase === "review" && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={approve}
                  disabled={isRunningBranch}
                  className="flex flex-1 items-center justify-center gap-1.5 bg-primary px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-primary-foreground font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Check className="size-3.5" />
                  {isRunningBranch ? "Computing..." : "Approve & Run Branch"}
                </button>
                <button
                  onClick={discard}
                  className="flex items-center justify-center gap-1 border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:bg-raised transition-colors"
                >
                  <X className="size-3.5" /> Discard
                </button>
              </div>
            )}

            {(phase === "playing" || phase === "done") && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    setIsPlaying(false);
                    setPhase("review");
                  }}
                  className="flex flex-1 items-center justify-center gap-1 border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider hover:bg-raised"
                >
                  <Pencil className="size-3" /> Re-draft Actions
                </button>
                <button
                  onClick={discard}
                  className="flex items-center justify-center gap-1 border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-raised"
                >
                  <Trash2 className="size-3" /> Discard Branch
                </button>
              </div>
            )}

            <p className="mt-2.5 border-t border-border pt-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
              AGENTS.md § Ch.13: AI authors scenarios, engine computes outcomes. Actions are
              sandboxed and never mutate live mission state.
            </p>
          </Panel>
        )}
      </div>

      {/* ==================================================================== */}
      {/* RIGHT COLUMN: Playback, Scrubber, Radar, & Event Stream Diff         */}
      {/* ==================================================================== */}
      <div className="space-y-3">
        {phase === "draft" || phase === "review" ? (
          <Panel title="Branch Wargame Theater">
            <EmptyState
              label={phase === "draft" ? "No branch drafted" : "Awaiting Human Approval"}
              hint={
                phase === "draft"
                  ? "Describe a hypothetical scenario on the left to draft whitelisted DSL injects."
                  : "Review or modify the drafted scenario actions, then click 'Approve & Run Branch'."
              }
            />
          </Panel>
        ) : (
          <>
            {/* Playback Control Bar & Scrubber */}
            <Panel
              variant="ai"
              title={
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-ai" />
                  <span>
                    Deterministic Playback · T+{playTick} / {HORIZON}
                  </span>
                </div>
              }
              actions={
                <div className="flex items-center gap-2">
                  {/* View Mode Tabs */}
                  <div className="flex border border-border bg-background/80 p-0.5 font-mono text-[10px]">
                    <button
                      onClick={() => setPlaybackTab("overview")}
                      className={cn(
                        "px-2 py-0.5 uppercase tracking-wider transition-colors",
                        playbackTab === "overview"
                          ? "bg-ai text-white font-bold"
                          : "text-muted-foreground",
                      )}
                    >
                      Overview
                    </button>
                    <button
                      onClick={() => setPlaybackTab("radar")}
                      className={cn(
                        "px-2 py-0.5 uppercase tracking-wider transition-colors",
                        playbackTab === "radar"
                          ? "bg-ai text-white font-bold"
                          : "text-muted-foreground",
                      )}
                    >
                      Divergence Radar
                    </button>
                    <button
                      onClick={() => setPlaybackTab("events")}
                      className={cn(
                        "px-2 py-0.5 uppercase tracking-wider transition-colors",
                        playbackTab === "events"
                          ? "bg-ai text-white font-bold"
                          : "text-muted-foreground",
                      )}
                    >
                      Event Diff
                    </button>
                    <button
                      onClick={() => setPlaybackTab("matrix")}
                      className={cn(
                        "px-2 py-0.5 uppercase tracking-wider transition-colors",
                        playbackTab === "matrix"
                          ? "bg-ai text-white font-bold"
                          : "text-muted-foreground",
                      )}
                    >
                      KPI Matrix
                    </button>
                  </div>
                </div>
              }
            >
              {/* Scrubber & VCR Transport Controls */}
              <div className="space-y-3 border-b border-border pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-mono text-[11px]">
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="flex items-center gap-1 border border-primary bg-primary/20 px-2.5 py-1 font-bold text-primary hover:bg-primary/30 transition-colors uppercase"
                    >
                      {isPlaying ? (
                        <Pause className="size-3.5" />
                      ) : (
                        <Play className="size-3.5 fill-current" />
                      )}
                      {isPlaying ? "Pause" : "Play"}
                    </button>
                    <button
                      onClick={() => {
                        setIsPlaying(false);
                        setPlayTick(0);
                      }}
                      className="border border-border p-1 text-muted-foreground hover:text-foreground"
                      title="Reset to T+0"
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                    <button
                      onClick={() => setPlayTick((t) => Math.max(0, t - 1))}
                      className="border border-border px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
                      title="Step -1"
                    >
                      -1
                    </button>
                    <button
                      onClick={() => setPlayTick((t) => Math.min(HORIZON, t + 1))}
                      className="border border-border px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
                      title="Step +1"
                    >
                      +1
                    </button>
                  </div>

                  {/* Playback Speed Selector */}
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    <span className="text-muted-foreground mr-1">Speed:</span>
                    {[0.5, 1, 2, 5].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => setPlaySpeed(spd)}
                        className={cn(
                          "border px-1.5 py-0.5 transition-colors",
                          playSpeed === spd
                            ? "border-primary bg-primary/20 text-primary font-bold"
                            : "border-border text-muted-foreground hover:bg-raised",
                        )}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scrubber Range Slider */}
                <div className="space-y-1">
                  <input
                    type="range"
                    min={0}
                    max={HORIZON}
                    value={playTick}
                    onChange={(e) => setPlayTick(Number(e.target.value))}
                    className="h-1.5 w-full accent-primary cursor-pointer"
                    aria-label="Simulation clock scrubber"
                  />
                  <div className="flex justify-between font-mono text-[9px] text-muted-foreground">
                    <span>T+0 (BRANCH FORK)</span>
                    <span>T+15 (STRESSORS ACTIVE)</span>
                    <span>T+30 (MIDPOINT)</span>
                    <span>T+45 (RECOVERY)</span>
                    <span>T+60 (STABILIZED)</span>
                  </div>
                </div>
              </div>

              {/* TAB 1: OVERVIEW (Monte Carlo Risk Ribbon + Narration) */}
              {playbackTab === "overview" && (
                <div className="space-y-3 pt-1">
                  <MonteCarloRiskRibbon
                    baseline={baselineRiskSeries}
                    branch={branchRiskSeries}
                    p10={p10RiskSeries}
                    p90={p90RiskSeries}
                    currentTick={playTick}
                    maxTick={HORIZON}
                    onScrub={setPlayTick}
                    actionPins={actions.map((a, i) => ({
                      tick: 4 + i * 12,
                      verb: a.action,
                      rationale: a.rationale,
                    }))}
                  />

                  {/* Narration Beats with Engine Event ID Citations */}
                  <div className="border border-border bg-card/40 p-2.5 font-mono text-[11px] space-y-1.5">
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">
                      Tactical Narration (AGENTS.md § Ch.13 Cited Stream):
                    </div>
                    {actions.map((a, i) => {
                      const atTick = 4 + i * 12;
                      const active = atTick <= playTick;
                      return (
                        <div
                          key={a.id}
                          className={cn(
                            "flex items-start gap-2 transition-opacity",
                            active
                              ? "opacity-100 text-foreground"
                              : "opacity-35 text-muted-foreground",
                          )}
                        >
                          <span className="text-ai font-bold">T+{atTick}</span>
                          <span>
                            {a.action === "spawn_weather" && (
                              <>
                                Weather cell forms over {a.target} at {a.magnitude}% intensity; unit
                                speeds drop.{" "}
                                <Mono className="text-[9px] text-primary/80">[e:W-{atTick}]</Mono>
                              </>
                            )}
                            {a.action === "create_incident" && (
                              <>
                                Hostile incident opens against {a.target} (magnitude {a.magnitude}
                                %).{" "}
                                <Mono className="text-[9px] text-primary/80">[e:INC-{atTick}]</Mono>
                              </>
                            )}
                            {a.action === "raise_alert" && (
                              <>
                                Warning alert broadcast to {a.target}; acknowledgement queue
                                increases.{" "}
                                <Mono className="text-[9px] text-primary/80">[e:AL-{atTick}]</Mono>
                              </>
                            )}
                            {a.action === "modify_speed" && (
                              <>
                                {a.target} ordered to economy speed ({a.magnitude}% modifier);
                                timeline extends.{" "}
                                <Mono className="text-[9px] text-primary/80">[e:SYS-{atTick}]</Mono>
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 2: TACTICAL DIVERGENCE RADAR MAP */}
              {playbackTab === "radar" && (
                <div className="space-y-2 pt-1">
                  <TacticalDivergenceMap
                    trajectories={backendResult?.trajectories}
                    spatialAnnotations={backendResult?.spatialAnnotations}
                    currentTick={playTick}
                  />
                </div>
              )}

              {/* TAB 3: DUAL EVENT STREAM DIFF */}
              {playbackTab === "events" && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="text-muted-foreground">
                      Events occurred up to T+{playTick}:
                    </span>
                    <div className="flex gap-1">
                      {["all", "critical", "high", "medium"].map((filter) => (
                        <button
                          key={filter}
                          onClick={() => setEventSevFilter(filter)}
                          className={cn(
                            "px-1.5 py-0.5 uppercase border",
                            eventSevFilter === filter
                              ? "border-primary bg-primary/20 text-primary font-bold"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {filter}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 max-h-[340px] overflow-y-auto">
                    {/* Baseline Events Column */}
                    <div className="border border-border bg-card/30 p-2 font-mono text-[10px]">
                      <div className="font-bold text-muted-foreground border-b border-border pb-1 mb-1">
                        BASELINE STREAM ({currentEvents.baseline.length} events)
                      </div>
                      <div className="space-y-1">
                        {currentEvents.baseline
                          .filter((e) => eventSevFilter === "all" || e.severity === eventSevFilter)
                          .slice(-15)
                          .reverse()
                          .map((e, idx) => (
                            <div
                              key={`b-${e.id || idx}`}
                              onClick={() => {
                                setPlayTick(Number(e.tick));
                                toast.info(`Scrubbed to event [e:${e.id}] at T+${e.tick}`);
                              }}
                              className="flex items-center justify-between text-muted-foreground hover:bg-white/5 cursor-pointer px-1 py-0.5 rounded transition-colors"
                              title="Click to scrub playhead to this event tick"
                            >
                              <span>
                                T+{e.tick} · {e.type}
                              </span>
                              <span className="text-[9px] text-muted-foreground/60 hover:text-primary">
                                [e:{e.id}]
                              </span>
                            </div>
                          ))}
                        {!currentEvents.baseline.length && (
                          <div className="text-muted-foreground italic">
                            No baseline events at this tick.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Branch Events Column */}
                    <div className="border border-ai/40 bg-ai/5 p-2 font-mono text-[10px]">
                      <div className="font-bold text-ai border-b border-ai/30 pb-1 mb-1">
                        BRANCH STREAM ({currentEvents.branch.length} events)
                      </div>
                      <div className="space-y-1">
                        {currentEvents.branch
                          .filter((e) => eventSevFilter === "all" || e.severity === eventSevFilter)
                          .slice(-15)
                          .reverse()
                          .map((e, idx) => {
                            const isDivergent =
                              e.type === "weather_spawn" || e.type === "incident_open";
                            return (
                              <div
                                key={`br-${e.id || idx}`}
                                onClick={() => {
                                  setPlayTick(Number(e.tick));
                                  toast.info(`Scrubbed to branch event [e:${e.id}] at T+${e.tick}`);
                                }}
                                className={cn(
                                  "flex items-center justify-between hover:bg-ai/10 cursor-pointer px-1 py-0.5 rounded transition-colors",
                                  isDivergent ? "text-ai font-bold" : "text-foreground",
                                )}
                                title="Click to scrub playhead to this event tick"
                              >
                                <span>
                                  T+{e.tick} · {e.type} {isDivergent && "★"}
                                </span>
                                <span className="text-[9px] text-ai/80 hover:underline">
                                  [e:{e.id}]
                                </span>
                              </div>
                            );
                          })}
                        {!currentEvents.branch.length && (
                          <div className="text-muted-foreground italic">
                            No branch events at this tick.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: OUTCOME KPI MATRIX */}
              {playbackTab === "matrix" && (
                <div className="space-y-3 pt-1">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {metrics.map((m) => {
                      const delta = m.x - m.b;
                      const good = m.higherBetter ? delta >= 0 : delta <= 0;
                      return (
                        <div key={m.label} className="border border-border bg-card/40 p-2.5">
                          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            {m.label}
                          </div>
                          <div className="mt-1 font-mono text-xl font-bold text-foreground">
                            {m.x.toFixed(0)}
                            <span className="text-xs font-normal text-muted-foreground ml-0.5">
                              {m.unit}
                            </span>
                          </div>
                          <div
                            className="font-mono text-[10px] mt-0.5 font-bold"
                            style={{
                              color: delta === 0 ? "#8A8A8A" : good ? "#4ADE80" : "#F87171",
                            }}
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
                  <p className="font-mono text-[10px] text-muted-foreground leading-relaxed">
                    Statistical outcome envelope computed across{" "}
                    {backendResult?.monteCarloRuns ?? 1} run(s). Re-running the same seed and action
                    set guarantees bit-for-bit reproducibility.
                  </p>
                </div>
              )}
            </Panel>

            {/* Past Runs History Panel */}
            <Panel
              title="Wargame Run Archive"
              actions={
                <button
                  id="toggle-history-btn"
                  onClick={() => {
                    const next = !historyOpen;
                    setHistoryOpen(next);
                    if (next && historyData.length === 0) loadHistory();
                  }}
                  className="flex items-center gap-1 border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest doip-btn-solid"
                >
                  <History className="size-3" />
                  {historyOpen ? "Hide History" : "Show Archive"}
                </button>
              }
            >
              {historyOpen &&
                (historyLoading ? (
                  <Mono className="p-2 text-[10px] text-muted-foreground">
                    Loading wargame history…
                  </Mono>
                ) : historyData.length === 0 ? (
                  <EmptyState
                    label="No past runs"
                    hint="Runs are archived whenever a branch executes."
                  />
                ) : (
                  <div className="space-y-1.5 p-1 max-h-60 overflow-y-auto">
                    {historyData.map((r, i) => (
                      <div
                        key={r.id ?? i}
                        className="border border-border bg-card/40 p-2 font-mono text-[10px]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-foreground">
                            Run #{r.id} · {r.scenario_id} (Seed {r.seed})
                          </span>
                          <span className="text-muted-foreground text-[9px]">
                            {(r.created_at ?? "").slice(0, 16)}
                          </span>
                        </div>
                        {r.deltas_json && (
                          <div className="mt-1 flex flex-wrap gap-2 text-[9px]">
                            {Object.entries(
                              JSON.parse(r.deltas_json ?? "{}") as Record<
                                string,
                                { delta?: number } | number
                              >,
                            ).map(([k, val]) => {
                              const d = typeof val === "object" && val !== null ? val.delta : val;
                              if (d === undefined || d === null) return null;
                              return (
                                <span
                                  key={k}
                                  className={cn(
                                    "px-1 border",
                                    d > 0
                                      ? "border-red-500/30 text-red-400 bg-red-500/10"
                                      : "border-green-500/30 text-green-400 bg-green-500/10",
                                  )}
                                >
                                  {k}: {d > 0 ? "+" : ""}
                                  {Number(d).toFixed(1)}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
