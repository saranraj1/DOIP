import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, AiBadge, SeverityTag } from "@/components/doip/primitives";
import { simStore, useSim } from "@/sim/store";
import { mulberry32 } from "@/sim/prng";
import { cn } from "@/lib/utils";
import { formatSimClock } from "@/lib/doip";
import { toast } from "sonner";
import {
  api,
  type VisionModelStatus,
  type TacticalSample,
  type VisionDetection,
  type VisionInferenceResult,
  type SurveillanceCameraFrame,
} from "@/lib/api";
import {
  Camera,
  Cpu,
  CheckCircle2,
  XCircle,
  Upload,
  Play,
  Sliders,
  ShieldCheck,
  Eye,
  RefreshCw,
  Crosshair,
  Layers,
  Radio,
  Sparkles,
  ArrowRight,
  Maximize2,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/vision")({
  head: () => ({
    meta: [
      { title: "Surveillance & Computer Vision (YOLOv8) — DOIP" },
      {
        name: "description",
        content:
          "Real-time YOLOv8n neural object detection, multi-camera surveillance wall, and deterministic human-in-the-loop adjudication.",
      },
      { property: "og:title", content: "Surveillance & Computer Vision (YOLOv8) — DOIP" },
      {
        property: "og:description",
        content:
          "Operational UAV surveillance feeds, neural tensor inference, and human adjudication gates.",
      },
    ],
  }),
  component: VisionScreen,
});

const DEFAULT_CLASSES = ["vehicle", "person", "structure", "uav"] as const;

const THERMAL_PALETTES = {
  default: { label: "RGB Optical", filter: "none" },
  white_hot: { label: "White Hot", filter: "grayscale(1) contrast(1.3) brightness(1.1)" },
  black_hot: { label: "Black Hot", filter: "grayscale(1) invert(1) contrast(1.3)" },
  ironbow: { label: "Ironbow FLIR", filter: "contrast(1.4) hue-rotate(190deg) saturate(2.2)" },
} as const;

type ThermalPalette = keyof typeof THERMAL_PALETTES;

const SENSITIVITY_PROFILES = [
  { label: "Standard", conf: 35 },
  { label: "High Recall", conf: 20 },
  { label: "High Precision", conf: 65 },
  { label: "Maritime", conf: 25 },
];

interface AdjudicationItem {
  id: string | number;
  tick: number;
  entityId: string;
  label: string;
  confidence: number;
  model: string;
  source: "sim" | "camera" | "neural_lab";
  box: { x: number; y: number; w: number; h: number };
  imageB64?: string | undefined;
}

function VisionScreen() {
  const events = useSim((s) => s.events);
  const tick = useSim((s) => s.world.tick);
  const [thermalPalette, setThermalPalette] = useState<ThermalPalette>("default");

  // Active view tab: 'matrix' | 'lab' | 'adjudicate'
  const [activeTab, setActiveTab] = useState<"matrix" | "lab" | "adjudicate">("lab");

  // Global confidence threshold filter (10% to 95%)
  const [minConf, setMinConf] = useState(35);
  const [verdicts, setVerdicts] = useState<Record<string | number, "confirmed" | "rejected">>({});
  const [adjudicationNotice, setAdjudicationNotice] = useState<string | null>(null);

  // Model health & telemetry
  const [modelStatus, setModelStatus] = useState<VisionModelStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Camera feeds (CAM-01 to CAM-06)
  const [liveFrames, setLiveFrames] = useState<SurveillanceCameraFrame[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedFeedCam, setSelectedFeedCam] = useState<SurveillanceCameraFrame | null>(null);

  // Interactive Neural Lab
  const [samples, setSamples] = useState<TacticalSample[]>([]);
  const [selectedSample, setSelectedSample] = useState<TacticalSample | null>(null);
  const [customImageB64, setCustomImageB64] = useState<string | null>(null);
  const [activeImageB64, setActiveImageB64] = useState<string | null>(null);
  const [activeImageLabel, setActiveImageLabel] = useState<string>("Sample Defense Imagery");
  const [inferenceResult, setInferenceResult] = useState<VisionInferenceResult | null>(null);
  const [inferring, setInferring] = useState(false);
  const [selectedBoxIndex, setSelectedBoxIndex] = useState<number | null>(null);

  // External / Lab transferred detections
  const [transferredDetections, setTransferredDetections] = useState<AdjudicationItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Filter detections by current minConf threshold interactively
  const displayedDetections = useMemo(() => {
    if (!inferenceResult?.detections) return [];
    return inferenceResult.detections.filter(
      (d) => Math.round(d.payload.confidence * 100) >= minConf,
    );
  }, [inferenceResult, minConf]);

  // 1. Initial Load: Model status, samples, and initial frames
  useEffect(() => {
    let mounted = true;

    async function initVision() {
      setStatusLoading(true);
      const [statusRes, samplesRes] = await Promise.all([api.visionStatus(), api.visionSamples()]);

      if (mounted) {
        if (statusRes) setModelStatus(statusRes);
        if (samplesRes?.samples?.length) {
          setSamples(samplesRes.samples);
          const first = samplesRes.samples[0]!;
          setSelectedSample(first);
          setActiveImageB64(first.image_b64);
          setActiveImageLabel(first.title);
        }
        setStatusLoading(false);
      }
    }

    initVision();
    return () => {
      mounted = false;
    };
  }, []);

  // 2. Fetch surveillance frames periodically
  const fetchCameraFrames = async () => {
    setFeedLoading(true);
    const [res, statusRes] = await Promise.all([
      api.visionFrames(6, tick || 0),
      !modelStatus ? api.visionStatus() : Promise.resolve(null),
    ]);
    setFeedLoading(false);
    if (res?.frames) {
      setLiveFrames(res.frames);
    }
    if (statusRes) {
      setModelStatus(statusRes);
    }
  };

  useEffect(() => {
    fetchCameraFrames();
    if (!autoRefresh) return;
    const interval = setInterval(fetchCameraFrames, 6000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, autoRefresh]);

  // 3. Run Inference on current active image
  const handleRunInference = async (imgB64Override?: string, labelOverride?: string) => {
    const targetB64 = imgB64Override || activeImageB64;
    if (!targetB64) return;

    setInferring(true);
    setInferenceResult(null);
    setSelectedBoxIndex(null);

    // Query backend with 0.25 (or minConf/100 if lower) so neural candidate detections are available for interactive slider filtering
    const confThreshold = Math.min(minConf / 100, 0.25);
    const res = await api.visionInfer(targetB64, "CAM-RECON-01", tick, confThreshold);
    setInferring(false);

    if (res) {
      setInferenceResult(res);
      if (labelOverride) setActiveImageLabel(labelOverride);
    }
  };

  // 4. Handle Custom File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result as string;
      setCustomImageB64(b64);
      setActiveImageB64(b64);
      setSelectedSample(null);
      setActiveImageLabel(`Uploaded: ${file.name}`);
      setInferenceResult(null);
      // Auto run inference on upload
      handleRunInference(b64, `Uploaded: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  // 5. Select a Pre-packaged Tactical Sample
  const handleSelectSample = (sample: TacticalSample) => {
    setSelectedSample(sample);
    setCustomImageB64(null);
    setActiveImageB64(sample.image_b64);
    setActiveImageLabel(sample.title);
    setInferenceResult(null);
    setSelectedBoxIndex(null);
  };

  // 6. Transfer Neural Lab Detections to Human Adjudication Queue
  const handleTransferToQueue = () => {
    if (!displayedDetections.length) return;

    const newItems: AdjudicationItem[] = displayedDetections.map((d, idx) => ({
      id: `LAB-${Date.now()}-${idx}`,
      tick: tick || 0,
      entityId: d.entityId || "UAV-RECON",
      label: d.payload.label,
      confidence: Math.round(d.payload.confidence * 100),
      model: d.payload.model || "yolov8n-doip-v1.4",
      source: "neural_lab",
      box: d.payload.box,
      imageB64: activeImageB64 || undefined,
    }));

    setTransferredDetections((prev) => [...newItems, ...prev]);
    setActiveTab("adjudicate");
    setAdjudicationNotice(
      `Transferred ${newItems.length} neural detections to the human adjudication queue.`,
    );
    setTimeout(() => setAdjudicationNotice(null), 5000);
  };

  // 7. Load Camera frame directly into Neural Lab
  const handleAnalyzeCameraFrame = (cam: SurveillanceCameraFrame) => {
    const b64 = cam.image_b64 || cam.base64;
    setActiveImageB64(b64);
    setSelectedSample(null);
    setCustomImageB64(null);
    setActiveImageLabel(`${cam.channel || cam.unitId}: ${cam.channelName || "Tactical Feed"}`);
    setActiveTab("lab");
    handleRunInference(b64, `${cam.channel || cam.unitId}`);
  };

  // 8. Combine Simulation Events + Transferred Neural Detections
  const allAdjudicationItems = useMemo<AdjudicationItem[]>(() => {
    const simItems: AdjudicationItem[] = events
      .filter((e) => e.type === "detection")
      .slice(-60)
      .reverse()
      .map((e) => {
        const rand = mulberry32(e.id * 7919);
        return {
          id: e.id,
          tick: e.tick,
          entityId: e.entityId,
          label: DEFAULT_CLASSES[Math.floor(rand() * DEFAULT_CLASSES.length)]!,
          confidence: Math.round(48 + rand() * 51),
          model: "yolov8n-doip-v1.4",
          source: "sim",
          box: {
            x: 12 + rand() * 40,
            y: 15 + rand() * 35,
            w: 20 + rand() * 25,
            h: 20 + rand() * 25,
          },
        };
      });

    return [...transferredDetections, ...simItems];
  }, [events, transferredDetections]);

  const filteredAdjudicationItems = allAdjudicationItems.filter((f) => f.confidence >= minConf);
  const pendingCount = filteredAdjudicationItems.filter((f) => !verdicts[f.id]).length;

  return (
    <div className="space-y-3 p-3">
      {/* ==================================================================== */}
      {/* 1. Header & Neural Engine Telemetry Bar                              */}
      {/* ==================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card/60 p-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-primary/40 bg-primary/10 text-primary">
            <Cpu className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">
                Surveillance & Computer Vision
              </h1>
              <AiBadge label="YOLOv8n" />
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              Ultralytics Neural Tensor Core · Ch.13 Deterministic Human Adjudication Gate
            </p>
          </div>
        </div>

        {/* Neural Core Diagnostics Badge */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-2 border px-2.5 py-1 font-mono text-[10px] tracking-wider",
              modelStatus?.status === "online"
                ? "border-success/40 bg-success/10 text-success"
                : "border-amber-500/40 bg-amber-500/10 text-amber-400",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                modelStatus?.status === "online" ? "animate-ping bg-success" : "bg-amber-400",
              )}
            />
            <span className="font-bold">
              {modelStatus?.status === "online"
                ? `YOLOv8n CORE: ONLINE (${modelStatus.classes} CLASSES)`
                : statusLoading
                  ? "INITIALIZING YOLO ENGINE..."
                  : "SYNTHETIC FALLBACK SENSOR"}
            </span>
            <span className="opacity-60">| {modelStatus?.device?.toUpperCase() ?? "CPU"}</span>
          </div>

          {/* Tab Navigation */}
          <div className="flex border border-border bg-background/80 p-0.5 font-mono text-[11px]">
            <button
              onClick={() => setActiveTab("lab")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 font-semibold uppercase tracking-wider transition-colors",
                activeTab === "lab"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Neural Lab & Tester
            </button>
            <button
              onClick={() => setActiveTab("matrix")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 font-semibold uppercase tracking-wider transition-colors",
                activeTab === "matrix"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Camera className="h-3.5 w-3.5" />
              Camera Wall (6-CH)
            </button>
            <button
              onClick={() => setActiveTab("adjudicate")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 font-semibold uppercase tracking-wider transition-colors",
                activeTab === "adjudicate"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Adjudication ({pendingCount})
            </button>
          </div>
        </div>
      </div>

      {/* Global Filter & Operational Threshold Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-border/80 bg-card/40 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <Sliders className="h-3 w-3 text-primary" />
            Confidence Gate: <span className="font-bold text-foreground">{minConf}%</span>
            <input
              type="range"
              min={10}
              max={95}
              value={minConf}
              onChange={(e) => setMinConf(Number(e.target.value))}
              className="h-1.5 w-28 accent-primary cursor-pointer"
              aria-label="Confidence threshold"
            />
          </label>
          <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
            Adjudication SLA: ≥80% High · ≥50% Medium · &lt;50% Flagged
          </span>
        </div>

        <div className="flex items-center gap-2">
          {adjudicationNotice && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-success animate-fade-in">
              <Check className="h-3 w-3" /> {adjudicationNotice}
            </span>
          )}
          <button
            onClick={() =>
              setVerdicts((v) => {
                const next: Record<string | number, "confirmed" | "rejected"> = { ...v };
                for (const item of filteredAdjudicationItems) {
                  if (item.confidence >= 80 && !next[item.id]) {
                    next[item.id] = "confirmed";
                  }
                }
                return next;
              })
            }
            className="border border-success/50 bg-success/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-success hover:bg-success/20 transition-colors"
          >
            Auto-Confirm All ≥ 80%
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: YOLOv8 NEURAL LAB & INTERACTIVE TESTER                        */}
      {/* ==================================================================== */}
      {activeTab === "lab" && (
        <div className="grid gap-3 lg:grid-cols-12">
          {/* Left Column: Sample selector & Image Upload (4 cols) */}
          <div className="space-y-3 lg:col-span-4">
            <Panel title="Surveillance Imagery Library">
              <div className="space-y-2">
                <p className="font-mono text-[10px] text-muted-foreground">
                  Select a pre-loaded tactical surveillance frame or upload any custom aerial
                  reconnaissance image to execute live YOLOv8n tensor inference.
                </p>

                {/* 1-Click Samples */}
                <div className="space-y-1.5 pt-1">
                  {samples.map((s) => {
                    const isSelected = selectedSample?.id === s.id && !customImageB64;
                    return (
                      <button
                        key={s.id}
                        onClick={() => handleSelectSample(s)}
                        className={cn(
                          "w-full text-left p-2 border transition-all text-xs font-mono",
                          isSelected
                            ? "border-primary bg-primary/10 shadow-[0_0_12px_rgba(0,210,255,0.15)]"
                            : "border-border bg-card/40 hover:border-border/80 hover:bg-card/70",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-foreground truncate">{s.title}</span>
                          <span className="text-[9px] uppercase px-1 border border-border text-muted-foreground">
                            {s.category}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                          {s.description}
                        </p>
                        <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground">
                          <span className="text-primary/80">{s.sensor}</span>
                          <span>Targets: {s.expected.join(", ")}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Custom File Upload Box */}
                <div className="pt-2 border-t border-border">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 border border-dashed border-primary/50 bg-primary/5 p-3 font-mono text-[11px] text-primary hover:bg-primary/10 transition-colors uppercase tracking-wider",
                      customImageB64 && "border-primary bg-primary/15 font-bold",
                    )}
                  >
                    <Upload className="h-4 w-4" />
                    {customImageB64 ? "Replace Custom Image" : "Upload Custom Image (PNG/JPG)"}
                  </button>
                </div>
              </div>
            </Panel>

            {/* Neural Telemetry Summary Panel */}
            <Panel title="Neural Engine Diagnostics">
              <div className="space-y-2 font-mono text-[11px]">
                <div className="flex items-center justify-between border-b border-border pb-1">
                  <span className="text-muted-foreground">MODEL ARCHITECTURE:</span>
                  <span className="text-foreground font-bold">Ultralytics YOLOv8n</span>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-1">
                  <span className="text-muted-foreground">WEIGHTS SOURCE:</span>
                  <span className="text-foreground">
                    {modelStatus?.weights ?? "yolov8n-doip-v1.4.pt"}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-1">
                  <span className="text-muted-foreground">COCO CLASS VOCABULARY:</span>
                  <span className="text-foreground">{modelStatus?.classes ?? 80} classes</span>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-1">
                  <span className="text-muted-foreground">INFERENCE LATENCY:</span>
                  <span
                    className={cn(
                      "font-bold",
                      inferenceResult ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {inferenceResult ? `${inferenceResult.infer_ms} ms` : "Awaiting run"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">ADJUDICATION STANDARD:</span>
                  <span className="text-primary font-bold">AGENTS.md § Ch.13</span>
                </div>
              </div>
            </Panel>
          </div>

          {/* Right Column: Visualizer Canvas & Bounding Boxes (8 cols) */}
          <div className="space-y-3 lg:col-span-8">
            <Panel
              title={
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-primary" />
                  <span>YOLOv8 Neural Detection Studio: {activeImageLabel}</span>
                </div>
              }
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={thermalPalette}
                    onChange={(e) => setThermalPalette(e.target.value as ThermalPalette)}
                    className="border border-border bg-background px-1.5 py-1 font-mono text-[10px] uppercase tracking-wider text-primary"
                    aria-label="Thermal Sensor Palette"
                  >
                    {Object.entries(THERMAL_PALETTES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>

                  <div className="hidden sm:flex items-center gap-1 border border-border bg-base p-0.5">
                    {SENSITIVITY_PROFILES.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => setMinConf(p.conf)}
                        className={cn(
                          "px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest transition-colors",
                          minConf === p.conf
                            ? "bg-primary text-primary-foreground font-bold"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => handleRunInference()}
                    disabled={inferring || !activeImageB64}
                    className="flex items-center gap-1.5 border border-primary bg-primary px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all shadow-[0_0_12px_rgba(0,210,255,0.3)]"
                  >
                    {inferring ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Running YOLOv8n...
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" />
                        Run YOLO Detection
                      </>
                    )}
                  </button>
                </div>
              }
            >
              {/* Image Frame Visualizer with Bounding Box Overlays */}
              <div className="relative aspect-video w-full overflow-hidden border border-border bg-black/90 flex items-center justify-center">
                {activeImageB64 ? (
                  <div className="relative inline-block max-h-full max-w-full">
                    <img
                      src={
                        activeImageB64.startsWith("data:")
                          ? activeImageB64
                          : `data:image/png;base64,${activeImageB64}`
                      }
                      alt="Surveillance Feed"
                      style={{ filter: THERMAL_PALETTES[thermalPalette].filter }}
                      className="max-h-[500px] w-auto object-contain block select-none transition-all duration-300"
                    />

                    {/* HUD Reticle Overlay */}
                    <div className="pointer-events-none absolute inset-0 border border-primary/20">
                      <div className="absolute top-2 left-2 font-mono text-[9px] text-primary/70 bg-black/60 px-1 border border-primary/30">
                        [RECON STREAM · 30 FPS · FOV 68°]
                      </div>
                      <div className="absolute top-2 right-2 font-mono text-[9px] text-primary/70 bg-black/60 px-1 border border-primary/30">
                        GRID: 43R XU 9921 · EL: 420M
                      </div>
                    </div>

                    {/* Neural Bounding Boxes */}
                    {displayedDetections.map((d, i) => {
                      const box = d.payload.box;
                      const confPct = Math.round(d.payload.confidence * 100);
                      const isHigh = confPct >= 80;
                      const isMed = confPct >= 50;
                      const isSelected = selectedBoxIndex === i;

                      const borderColor = isSelected
                        ? "#FFFFFF"
                        : isHigh
                          ? "#22c55e"
                          : isMed
                            ? "#eab308"
                            : "#06b6d4";

                      return (
                        <div
                          key={d.id || i}
                          onClick={() => setSelectedBoxIndex(i)}
                          className={cn(
                            "absolute cursor-pointer transition-all",
                            isSelected && "ring-2 ring-white ring-offset-1 ring-offset-black z-20",
                          )}
                          style={{
                            left: `${box.x}%`,
                            top: `${box.y}%`,
                            width: `${box.w}%`,
                            height: `${box.h}%`,
                            border: `2px solid ${borderColor}`,
                            boxShadow: `0 0 10px ${borderColor}66`,
                          }}
                        >
                          {/* Corner Markers */}
                          <div className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-white" />
                          <div className="absolute -top-1 -right-1 w-2 h-2 border-t-2 border-r-2 border-white" />
                          <div className="absolute -bottom-1 -left-1 w-2 h-2 border-b-2 border-l-2 border-white" />
                          <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-white" />

                          {/* Classification Tag Chip */}
                          <div
                            className="absolute -top-5 left-0 flex items-center gap-1 px-1.5 py-0.2 font-mono text-[9px] font-bold text-black uppercase shadow"
                            style={{ backgroundColor: borderColor }}
                          >
                            <span>{d.payload.label}</span>
                            <span>{confPct}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    label="No image loaded"
                    hint="Select a tactical sample or upload an image from the left panel."
                  />
                )}
              </div>

              {/* Inference Results Bar & Adjudication Action */}
              {inferenceResult && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card/60 p-2.5">
                    <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-success" />
                        <span className="font-bold text-foreground">
                          {displayedDetections.length} TARGET
                          {displayedDetections.length !== 1 ? "S" : ""} DETECTED
                        </span>
                      </div>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">
                        LATENCY:{" "}
                        <strong className="text-foreground">{inferenceResult.infer_ms} ms</strong>
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <div className="flex flex-wrap gap-1">
                        {Array.from(new Set(displayedDetections.map((d) => d.payload.label))).map(
                          (lbl) => {
                            const count = displayedDetections.filter(
                              (d) => d.payload.label === lbl,
                            ).length;
                            return (
                              <span
                                key={lbl}
                                className="border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary uppercase font-bold"
                              >
                                {count}x {lbl}
                              </span>
                            );
                          },
                        )}
                      </div>
                    </div>

                    <button
                      onClick={handleTransferToQueue}
                      className="flex items-center gap-1.5 border border-success bg-success/15 px-3 py-1 font-mono text-[11px] font-bold text-success uppercase tracking-wider hover:bg-success/25 transition-colors"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Transfer to Adjudication Queue
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* List of Detected Bounding Boxes */}
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {displayedDetections.map((d, idx) => {
                      const confPct = Math.round(d.payload.confidence * 100);
                      const isSelected = selectedBoxIndex === idx;
                      return (
                        <div
                          key={d.id || idx}
                          onClick={() => setSelectedBoxIndex(idx)}
                          className={cn(
                            "p-2 border font-mono text-[10px] cursor-pointer transition-all flex items-center justify-between",
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-card/30 hover:border-border/80",
                          )}
                        >
                          <div>
                            <span className="font-bold uppercase text-foreground">
                              {d.payload.label}
                            </span>
                            <span className="text-muted-foreground ml-1.5">ID: {d.id}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "font-bold",
                                confPct >= 80
                                  ? "text-success"
                                  : confPct >= 50
                                    ? "text-amber-400"
                                    : "text-cyan-400",
                              )}
                            >
                              {confPct}%
                            </span>
                            <SeverityTag severity={d.severity} showLabel={false} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: SURVEILLANCE CAMERA MATRIX (6-CH FEED)                        */}
      {/* ==================================================================== */}
      {activeTab === "matrix" && (
        <Panel
          title="Multi-Channel Tactical Surveillance Wall"
          actions={
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground uppercase cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="accent-primary"
                />
                Auto-Refresh (6s)
              </label>
              <button
                onClick={fetchCameraFrames}
                disabled={feedLoading}
                className="flex items-center gap-1 border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className={cn("h-3 w-3", feedLoading && "animate-spin")} />
                Refresh
              </button>
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {liveFrames.map((cam, i) => {
              const b64 = cam.image_b64 || cam.base64;
              const det = cam.detections?.[0];
              const confPct = det ? Math.round(det.confidence * 100) : 0;
              return (
                <div
                  key={cam.frameId || i}
                  className="overflow-hidden border border-border bg-card/40 transition-all hover:border-primary/50 group"
                >
                  {/* Camera Header Banner */}
                  <div className="flex items-center justify-between border-b border-border bg-background/80 px-2 py-1 font-mono text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <Radio className="h-3 w-3 text-red-500 animate-pulse" />
                      <span className="font-bold text-foreground">{cam.channel || cam.unitId}</span>
                      <span className="text-muted-foreground">
                        · {cam.sensorMode || "EO-OPTICAL"}
                      </span>
                    </div>
                    <span className="text-primary">{cam.alt || "350m"}</span>
                  </div>

                  {/* Camera Image Frame with HUD overlay */}
                  <div className="relative aspect-video w-full bg-black/95 overflow-hidden">
                    {b64 ? (
                      <img
                        src={`data:image/png;base64,${b64}`}
                        alt={cam.channelName || `Camera ${i + 1}`}
                        style={{ filter: THERMAL_PALETTES[thermalPalette].filter }}
                        className="h-full w-full object-cover transition-all duration-300"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-muted-foreground font-mono text-xs">
                        NO FEED SIGNAL
                      </div>
                    )}

                    {/* HUD reticle & coordinates */}
                    <div className="pointer-events-none absolute inset-0 p-1.5 flex flex-col justify-between">
                      <div className="flex justify-between font-mono text-[8px] text-primary/80">
                        <span>LIVE 30FPS</span>
                        <span>{formatSimClock(cam.timestamp || tick)}</span>
                      </div>
                      <div className="flex justify-between font-mono text-[8px] text-muted-foreground">
                        <span>
                          LAT {cam.telemetry?.lat ?? 32.74} LON {cam.telemetry?.lon ?? 74.88}
                        </span>
                        <span className="text-success uppercase">
                          {cam.telemetry?.status ?? "TRACK"}
                        </span>
                      </div>
                    </div>

                    {/* Simulated Detection Box */}
                    {det?.box && (
                      <div
                        className="absolute border border-amber-400 bg-amber-400/10"
                        style={{
                          left: `${det.box.x}%`,
                          top: `${det.box.y}%`,
                          width: `${det.box.w}%`,
                          height: `${det.box.h}%`,
                        }}
                      >
                        <span className="absolute -top-3.5 left-0 bg-amber-400 px-1 font-mono text-[8px] font-bold text-black uppercase">
                          {det.label} {confPct}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="flex items-center justify-between border-t border-border px-2 py-1.5 bg-background/60 font-mono text-[10px]">
                    <div className="truncate text-muted-foreground">
                      {cam.channelName || "Perimeter Sector"}
                    </div>
                    <button
                      onClick={() => handleAnalyzeCameraFrame(cam)}
                      className="flex items-center gap-1 border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/20 uppercase tracking-wider font-semibold transition-colors"
                    >
                      <Crosshair className="h-3 w-3" />
                      Analyze in Lab
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: HUMAN ADJUDICATION QUEUE (AGENTS.MD § CH.13)                  */}
      {/* ==================================================================== */}
      {activeTab === "adjudicate" && (
        <Panel
          title={
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Human-in-the-Loop Detection Adjudication Gate</span>
            </div>
          }
          actions={
            <div className="flex items-center gap-2">
              <Mono className="text-[10px] text-primary">{pendingCount} AWAITING REVIEW</Mono>
            </div>
          }
        >
          {filteredAdjudicationItems.length === 0 ? (
            <div className="p-6 text-center space-y-3">
              <EmptyState
                label="No detections in adjudication queue"
                hint="Detections stream in from active scenario runs or can be transferred directly from the Neural Lab."
              />
              <button
                onClick={() => setActiveTab("lab")}
                className="inline-flex items-center gap-1.5 border border-primary bg-primary/10 px-3 py-1 font-mono text-xs font-bold text-primary uppercase tracking-wider hover:bg-primary/20 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Go to Neural Lab & Run Test Detection
              </button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {filteredAdjudicationItems.map((item) => {
                const verdict = verdicts[item.id];
                return (
                  <figure
                    key={item.id}
                    className={cn(
                      "overflow-hidden border bg-card/40 transition-all",
                      verdict === "confirmed"
                        ? "border-success/60 bg-success/5"
                        : verdict === "rejected"
                          ? "border-red-500/40 opacity-60 bg-red-500/5"
                          : "border-border hover:border-primary/50",
                    )}
                  >
                    {/* Frame Snapshot */}
                    <div className="relative aspect-video w-full bg-black/90 overflow-hidden">
                      {item.imageB64 ? (
                        <img
                          src={
                            item.imageB64.startsWith("data:")
                              ? item.imageB64
                              : `data:image/png;base64,${item.imageB64}`
                          }
                          alt="Detection Crop"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div
                          className="h-full w-full"
                          style={{
                            background: `repeating-linear-gradient(115deg, hsl(200 30% 9%) 0px, hsl(200 25% 12%) 3px, hsl(200 35% 7%) 6px)`,
                          }}
                        />
                      )}

                      {/* Bounding Box Marker */}
                      <div
                        className="absolute border-2"
                        style={{
                          left: `${item.box.x}%`,
                          top: `${item.box.y}%`,
                          width: `${item.box.w}%`,
                          height: `${item.box.h}%`,
                          borderColor: item.confidence >= 80 ? "#22c55e" : "#eab308",
                        }}
                      >
                        <span className="absolute -top-4 left-0 bg-black/80 px-1 font-mono text-[9px] text-primary">
                          {item.label} {item.confidence}%
                        </span>
                      </div>

                      <div className="absolute bottom-1 left-1 font-mono text-[9px] text-muted-foreground bg-black/60 px-1">
                        {item.entityId} · {formatSimClock(item.tick)}
                      </div>
                    </div>

                    {/* Verdict Controls */}
                    <figcaption className="flex items-center gap-1.5 border-t border-border p-2">
                      <div className="flex flex-col">
                        <span className="font-mono text-[10px] font-bold text-foreground uppercase">
                          {item.label} ({item.confidence}%)
                        </span>
                        <span className="font-mono text-[8px] text-muted-foreground">
                          SRC: {item.source.toUpperCase()} · ID: {item.id}
                        </span>
                      </div>

                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={() => {
                            setVerdicts((v) => ({ ...v, [item.id]: "confirmed" as const }));
                            simStore.injectRaw([
                              {
                                type: "incident_open",
                                severity: item.confidence >= 80 ? "high" : "medium",
                                entityId: item.entityId || `DET-${item.id}`,
                                payload: {
                                  kind: `visual_track_${item.label}`,
                                  label: item.label,
                                  confidence: item.confidence,
                                  adjudicatedBy: "Operator",
                                },
                              },
                            ]);
                            toast.success(
                              `Promoted to Incident: ${item.label} (${item.confidence}%)`,
                              {
                                description: `Entity ${item.entityId || item.id} injected into scenario incident registry.`,
                              },
                            );
                          }}
                          className="border border-primary/60 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase font-bold text-primary hover:bg-primary/20 transition-colors"
                          title="Promote confirmed detection into engine incident state"
                        >
                          ⚡ Incident
                        </button>
                        <button
                          onClick={() =>
                            setVerdicts((v) => ({ ...v, [item.id]: "confirmed" as const }))
                          }
                          className={cn(
                            "border px-2 py-0.5 font-mono text-[9px] uppercase font-bold transition-colors",
                            verdict === "confirmed"
                              ? "border-success bg-success text-success-foreground"
                              : "border-success/40 text-success hover:bg-success/15",
                          )}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() =>
                            setVerdicts((v) => ({ ...v, [item.id]: "rejected" as const }))
                          }
                          className={cn(
                            "border px-2 py-0.5 font-mono text-[9px] uppercase font-bold transition-colors",
                            verdict === "rejected"
                              ? "border-red-500 bg-red-500 text-white"
                              : "border-red-500/40 text-red-400 hover:bg-red-500/15",
                          )}
                        >
                          Reject
                        </button>
                      </div>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}

          {/* Adjudication Compliance Audit Trail Footer */}
          <div className="mt-3 border-t border-border pt-2 flex flex-wrap items-center justify-between text-[10px] font-mono text-muted-foreground">
            <div>
              QUEUE TOTAL: {allAdjudicationItems.length} · SHOWN: {filteredAdjudicationItems.length}{" "}
              · CONFIRMED: {Object.values(verdicts).filter((v) => v === "confirmed").length} ·
              REJECTED: {Object.values(verdicts).filter((v) => v === "rejected").length}
            </div>
            <div className="text-primary/80">
              AGENTS.md Ch.13: Confirmed detections enter simulation world state as verified
              incidents.
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
