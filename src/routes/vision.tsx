import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, AiBadge, SeverityTag } from "@/components/doip/primitives";
import { useSim } from "@/sim/store";
import { mulberry32 } from "@/sim/prng";
import { cn } from "@/lib/utils";
import { formatSimClock } from "@/lib/doip";
import type { Severity } from "@/sim/types";

export const Route = createFileRoute("/vision")({
  head: () => ({
    meta: [
      { title: "Vision Review — DOIP" },
      {
        name: "description",
        content: "Human-in-the-loop review of synthetic detections: bounding boxes, confidence filter, confirm or reject.",
      },
      { property: "og:title", content: "Vision Review — DOIP" },
      { property: "og:description", content: "Adjudicate UAV detections before they escalate into incidents." },
    ],
  }),
  component: VisionScreen,
});

const CLASSES = ["vehicle", "person", "structure", "unknown"] as const;

interface Frame {
  id: number;
  tick: number;
  entityId: string;
  cls: string;
  confidence: number;
  severity: Severity;
  box: { x: number; y: number; w: number; h: number };
  hue: number;
}

function VisionScreen() {
  const events = useSim((s) => s.events);
  const [minConf, setMinConf] = useState(50);
  const [verdicts, setVerdicts] = useState<Record<number, "confirmed" | "rejected">>({});

  const frames = useMemo<Frame[]>(() => {
    return events
      .filter((e) => e.type === "detection")
      .slice(-60)
      .reverse()
      .map((e) => {
        const rand = mulberry32(e.id * 7919);
        return {
          id: e.id,
          tick: e.tick,
          entityId: e.entityId,
          cls: CLASSES[Math.floor(rand() * CLASSES.length)]!,
          confidence: Math.round(45 + rand() * 54),
          severity: e.severity,
          box: { x: 10 + rand() * 45, y: 10 + rand() * 40, w: 18 + rand() * 30, h: 18 + rand() * 30 },
          hue: 190 + rand() * 40,
        };
      });
  }, [events]);

  const shown = frames.filter((f) => f.confidence >= minConf);
  const pending = shown.filter((f) => !verdicts[f.id]).length;

  if (!frames.length) {
    return (
      <div className="p-2">
        <EmptyState label="No detections captured" hint="UAV detections stream in while a scenario is running." />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <Panel
        title="Detection queue"
        actions={
          <div className="flex items-center gap-2">
            <AiBadge label="CV MODEL" />
            <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Min conf {minConf}%
              <input
                type="range"
                min={0}
                max={99}
                value={minConf}
                onChange={(e) => setMinConf(Number(e.target.value))}
                className="w-32 accent-primary"
                aria-label="Minimum confidence"
              />
            </label>
            <Mono className="text-[10px]">{pending} PENDING</Mono>
            <button
              onClick={() =>
                setVerdicts((v) => {
                  const next = { ...v };
                  for (const f of shown) if (f.confidence >= 80 && !next[f.id]) next[f.id] = "confirmed";
                  return next;
                })
              }
              className="border border-success/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-success hover:bg-success/10"
            >
              Accept all ≥ 80%
            </button>
          </div>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((f) => {
            const verdict = verdicts[f.id];
            return (
              <figure
                key={f.id}
                className={cn(
                  "overflow-hidden  border",
                  verdict === "confirmed"
                    ? "border-success/50"
                    : verdict === "rejected"
                      ? "border-red-500/40 opacity-60"
                      : "border-border",
                )}
              >
                <div
                  className="relative aspect-video"
                  style={{
                    background: `repeating-linear-gradient(115deg, hsl(${f.hue} 30% 9%) 0px, hsl(${f.hue} 25% 12%) 3px, hsl(${f.hue} 35% 7%) 6px)`,
                  }}
                >
                  <div
                    className="absolute border-2"
                    style={{
                      left: `${f.box.x}%`,
                      top: `${f.box.y}%`,
                      width: `${f.box.w}%`,
                      height: `${f.box.h}%`,
                      borderColor: f.confidence > 80 ? "#FFFFFF" : "#FBBF24",
                    }}
                  >
                    <span className="absolute -top-4 left-0 bg-base/80 px-1 font-mono text-[9px] text-primary">
                      {f.cls} {f.confidence}%
                    </span>
                  </div>
                  <span className="absolute bottom-1 left-1 font-mono text-[9px] text-muted-foreground">
                    {f.entityId} · {formatSimClock(f.tick)}
                  </span>
                </div>
                <figcaption className="flex items-center gap-1.5 border-t border-border p-1.5">
                  <SeverityTag severity={f.severity} showLabel={false} />
                  <Mono className="text-[10px] text-muted-foreground">e:{f.id}</Mono>
                  <div className="ml-auto flex gap-1">
                    <button
                      onClick={() => setVerdicts((v) => ({ ...v, [f.id]: "confirmed" }))}
                      className=" border border-success/40 px-1.5 py-0.5 font-mono text-[9px] uppercase text-success hover:bg-success/10"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setVerdicts((v) => ({ ...v, [f.id]: "rejected" }))}
                      className=" border border-red-500/40 px-1.5 py-0.5 font-mono text-[9px] uppercase text-red-400 hover:bg-red-500/10"
                    >
                      Reject
                    </button>
                  </div>
                </figcaption>
              </figure>
            );
          })}
        </div>
        {!shown.length && <EmptyState label="No detections above threshold" hint="Lower the confidence filter." />}
        <div className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
          JOB uav-live-feed · {shown.length}/{frames.length} frames shown ·{" "}
          {Object.values(verdicts).filter((v) => v === "confirmed").length} confirmed ·{" "}
          {Object.values(verdicts).filter((v) => v === "rejected").length} rejected · accepted detections become map
          events with model lineage
        </div>
      </Panel>
    </div>
  );
}
