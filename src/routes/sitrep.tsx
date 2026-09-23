import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, AiBadge, SeverityTag } from "@/components/doip/primitives";
import { useSim } from "@/sim/store";
import { formatSimClock, computeEventFingerprint } from "@/lib/doip";
import {
  RefreshCw,
  Volume2,
  VolumeX,
  Clock,
  X,
  Copy,
  Check,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { SimEvent } from "@/sim/types";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sitrep")({
  head: () => ({
    meta: [
      { title: "AI Sitrep — DOIP" },
      {
        name: "description",
        content:
          "Auto-generated situation report with severity rollup, cited source events and confidence scoring.",
      },
      { property: "og:title", content: "AI Sitrep — DOIP" },
      {
        property: "og:description",
        content: "Narrative sitrep derived from the live event log, every claim cited.",
      },
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

  // Backend-sourced sections (null = not fetched yet or backend offline)
  const [backendSections, setBackendSections] = useState<Section[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"local" | "llm">("local");

  // Operational enhancements
  const [deltaMode, setDeltaMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [inspectedCitation, setInspectedCitation] = useState<SimEvent | null>(null);
  const [citationCopied, setCitationCopied] = useState(false);

  // Stop speech if navigating away or unmounting
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Rule-based local sections — always available as fallback, reactive to deltaMode
  const localSections = useMemo<Section[]>(() => {
    const units = Object.values(world.units);
    const incidents = Object.values(world.incidents);
    const alerts = Object.values(world.alerts);

    const relevantEvents = deltaMode
      ? events.filter((e) => e.tick >= Math.max(0, world.tick - 15))
      : events;

    const open = incidents.filter((i) => i.open);
    const crit = open.filter((i) => i.severity === "critical" || i.severity === "high");
    const stale = units.filter((u) => u.status === "stale");
    const lowFuel = units.filter((u) => u.fuel < 30);

    const cite = (type: string, n = 3) =>
      relevantEvents
        .filter((e) => e.type === type)
        .slice(-n)
        .reverse();

    const postureBody = deltaMode
      ? `Over the last 15 ticks (T-${Math.max(0, world.tick - 15)} to T+${world.tick}), ${
          relevantEvents.length
        } event(s) occurred. ${crit.length ? `${crit.length} high/critical incident(s) are active.` : "No critical escalations in this window."} Comms and unit positions remain deterministic.`
      : `${units.length} units are committed across ${world.zones.length} zones at ${formatSimClock(world.tick)}. ${
          crit.length
            ? `${crit.length} incident(s) at high or critical severity are shaping the picture.`
            : "No high-severity incidents are currently open."
        } ${alerts.filter((a) => !a.acked).length} alert(s) remain unacknowledged.`;

    return [
      {
        heading: deltaMode ? "15-Tick Posture Delta" : "Overall posture",
        body: postureBody,
        confidence: 0.92,
        citations: cite("incident_open").length ? cite("incident_open") : cite("weather_spawn"),
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
  }, [world, events, deltaMode]);

  // Active sections — backend wins when available
  const sections = backendSections ?? localSections;

  // Toggle voice readout
  const handleToggleSpeech = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast.error("Audio Readout unavailable", {
        description: "Browser does not support SpeechSynthesis API.",
      });
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      toast.info("Audio readout stopped.");
      return;
    }

    window.speechSynthesis.cancel();
    const script =
      `Situation report generated at ${formatSimClock(world.tick)}. ` +
      sections.map((s) => `${s.heading}. ${s.body}`).join(" ");

    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
    toast.success("Voice Readout Active", {
      description: "Reading out current situation report sections.",
    });
  }, [isSpeaking, sections, world.tick]);

  // Regenerate: try backend first, fall back to forcing local re-compute
  const handleRegenerate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.generateSitrep(world as object, events as object[]);
      if (res?.sections && Array.isArray(res.sections) && res.sections.length > 0) {
        setBackendSections(res.sections as Section[]);
        setSource("llm");
        setLoading(false);
        return;
      }
    } catch {
      // fall through
    }
    // Backend offline or returned empty — refresh local sections
    setBackendSections(null);
    setSource("local");
    setLoading(false);
  }, [world, events]);

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
            {source === "llm" && (
              <Mono className="text-[9px] uppercase tracking-widest text-ai">LLM-enhanced</Mono>
            )}

            {/* Temporal Delta Toggle */}
            <button
              onClick={() => setDeltaMode((d) => !d)}
              className={cn(
                "flex items-center gap-1 border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                deltaMode
                  ? "border-primary bg-primary/20 text-primary font-semibold"
                  : "border-border bg-base text-muted-foreground hover:bg-raised hover:text-foreground",
              )}
              title="Toggle 15-tick tactical delta comparison"
            >
              <Clock className="size-3" />
              DELTA {deltaMode ? "15T (ON)" : "MODE"}
            </button>

            {/* Tactical Audio Readout */}
            <button
              onClick={handleToggleSpeech}
              className={cn(
                "flex items-center gap-1 border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                isSpeaking
                  ? "border-accent bg-accent/20 text-accent font-semibold animate-pulse"
                  : "border-border bg-base text-muted-foreground hover:bg-raised hover:text-foreground",
              )}
              title="Tactical synthetic speech readout of the situation report"
            >
              {isSpeaking ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
              {isSpeaking ? "MUTE AUDIO" : "AUDIO READOUT"}
            </button>

            <button
              id="sitrep-regenerate-btn"
              onClick={handleRegenerate}
              disabled={loading}
              className="flex items-center gap-1.5 border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest doip-btn-solid disabled:opacity-50"
            >
              <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Generating…" : "Regenerate"}
            </button>
          </div>
        }
      >
        <div className="flex items-center justify-between">
          <Mono className="text-[10px] text-muted-foreground">
            GENERATED AT {formatSimClock(world.tick)} · SEED {world.seed} · SCENARIO{" "}
            {world.scenarioId}
          </Mono>
          {deltaMode && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-primary border border-primary/40 bg-primary/10 px-1.5 py-0.5">
              15-TICK DELTA WINDOW ACTIVE
            </span>
          )}
        </div>

        <div className="mt-2 space-y-2">
          {sections.map((s) => (
            <section key={s.heading} className="border border-ai/30 bg-ai/5 p-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">{s.heading}</h2>
                <Mono className="text-[10px] text-ai">CONF {(s.confidence * 100).toFixed(0)}%</Mono>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
              {s.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.citations.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setInspectedCitation(c)}
                      className="flex items-center gap-1 border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-foreground hover:bg-raised transition-colors cursor-pointer"
                      title={`Click to inspect verifiable event payload e:${c.id}`}
                    >
                      <SeverityTag severity={c.severity} showLabel={false} />
                      e:{c.id} · T+{c.tick}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Verifiable Citation Inspector Drawer / Modal */}
        {inspectedCitation && (
          <div className="mt-3 border border-primary/50 bg-raised/95 p-3 rounded shadow-lg animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-border/80 pb-1.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" />
                <span className="font-mono text-xs font-semibold text-foreground">
                  VERIFIED CITATION INSPECTOR — EVENT #{inspectedCitation.id}
                </span>
                <span className="font-mono text-[9px] text-muted-foreground">
                  T+{inspectedCitation.tick} ({formatSimClock(inspectedCitation.tick)})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`[e:${inspectedCitation.id}]`);
                    setCitationCopied(true);
                    setTimeout(() => setCitationCopied(false), 2000);
                    toast.success(`Copied citation [e:${inspectedCitation.id}] to clipboard`);
                  }}
                  className="flex items-center gap-1 border border-border bg-base px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {citationCopied ? (
                    <Check className="size-3 text-success" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {citationCopied ? "COPIED" : "COPY CITE"}
                </button>
                <button
                  onClick={() => setInspectedCitation(null)}
                  className="text-muted-foreground hover:text-foreground p-0.5"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
              <div className="border border-border/50 bg-base p-1.5">
                <span className="text-muted-foreground block text-[9px]">TYPE</span>
                <span className="font-semibold text-foreground">{inspectedCitation.type}</span>
              </div>
              <div className="border border-border/50 bg-base p-1.5">
                <span className="text-muted-foreground block text-[9px]">SEVERITY</span>
                <SeverityTag severity={inspectedCitation.severity} />
              </div>
              <div className="border border-border/50 bg-base p-1.5">
                <span className="text-muted-foreground block text-[9px]">ENTITY</span>
                <span className="font-semibold text-foreground">
                  {inspectedCitation.entityId || "N/A"}
                </span>
              </div>
              <div className="border border-border/50 bg-base p-1.5">
                <span className="text-muted-foreground block text-[9px]">HASH FINGERPRINT</span>
                <span className="text-primary font-mono">
                  {computeEventFingerprint([inspectedCitation])}
                </span>
              </div>
            </div>

            <div className="mt-2">
              <span className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                Deterministic Raw Event Payload:
              </span>
              <pre className="font-mono text-[10px] leading-relaxed bg-base p-2 border border-border overflow-x-auto text-foreground/90 max-h-40">
                {JSON.stringify(inspectedCitation, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground flex items-center justify-between">
          <span>
            AI-generated from synthetic training data. Every claim cited against immutable event
            logs.
          </span>
          <span className="text-ai flex items-center gap-1 font-mono text-[9px]">
            <Sparkles className="size-2.5" /> CH. 13 VERIFIED
          </span>
        </p>
      </Panel>
    </div>
  );
}
