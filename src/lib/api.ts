// Fail-soft HTTP + WS client for the DOIP MVP backend.
// Design rule: every call resolves null when the server is absent —
// the app must work fully offline, unchanged.
import type { RunRecord } from "@/sim/store";
import type { Role } from "@/sim/types";

const BASE = (
  (import.meta.env["VITE_DOIP_API_URL"] as string | undefined) ?? "http://localhost:8000"
).replace(/\/$/, "");

export function wsUrl(path: string): string {
  return BASE.replace(/^http/, "ws") + path;
}

let token: string | null =
  typeof window === "undefined" ? null : window.localStorage.getItem("doip.token");

async function request<T>(path: string, init?: RequestInit, timeoutMs = 5000): Promise<T | null> {
  if (typeof window === "undefined") return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(BASE + path, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface VisionModelStatus {
  status: "online" | "fallback";
  loaded: boolean;
  model: string;
  classes: number;
  device: string;
  weights: string;
  provider: string;
  sample_classes: string[];
  adjudication_gate: string;
}

export interface TacticalSample {
  id: string;
  title: string;
  category: string;
  sensor: string;
  description: string;
  image_b64: string;
  expected: string[];
}

export interface VisionDetection {
  id: string;
  type: string;
  severity: "high" | "medium" | "low";
  entityId: string;
  tick: number;
  payload: {
    label: string;
    classId: number;
    confidence: number;
    model: string;
    frame: string;
    box: { x: number; y: number; w: number; h: number };
    box_xyxy?: number[];
    lat?: number | null;
    lon?: number | null;
  };
}

export interface VisionInferenceResult {
  detections: VisionDetection[];
  count: number;
  infer_ms: number;
  image_size?: [number, number];
  model: string;
  status: string;
}

export interface SurveillanceCameraFrame {
  frameId: string;
  unitId: string;
  channel?: string;
  channelName?: string;
  sensorMode?: string;
  alt?: string;
  timestamp: number;
  width: number;
  height: number;
  mimeType: string;
  base64: string;
  image_b64?: string;
  detections: Array<{
    label: string;
    confidence: number;
    model: string;
    box?: { x: number; y: number; w: number; h: number };
  }>;
  telemetry?: {
    lat: number;
    lon: number;
    fps: number;
    status: string;
  };
}

export interface CorpusDocSummary {
  id: string;
  category: "POL" | "REF" | "SOP" | string;
  title: string;
  tags: string[];
  version: string;
}

export interface CorpusDocDetail extends CorpusDocSummary {
  content: string;
  sections: Array<{ heading: string; text: string }>;
}

export interface WhatIfUnitTrajectory {
  id: string;
  callsign: string;
  kind: string;
  color: string;
}

export interface WhatIfTrackPoint {
  tick: number;
  lat: number;
  lon: number;
  heading: number;
  inWeather: boolean;
}

export interface WhatIfWeatherAnnotation {
  id: string;
  lat: number;
  lon: number;
  radiusKm: number;
  intensity: number;
  tick: number;
}

export interface WhatIfIncidentAnnotation {
  id: string;
  lat: number;
  lon: number;
  severity: string;
  kind?: string;
  tick: number;
}

export interface WhatIfEventRecord {
  id: number | string;
  tick: number;
  type: string;
  entityId?: string;
  severity?: string;
  payload?: Record<string, unknown>;
}

export interface WhatIfResponse {
  id: number;
  seed: number;
  scenarioId: string;
  ticks: number;
  deltas: Record<string, { baseline: number | null; branch: number | null; delta: number | null }>;
  baselineEvents: WhatIfEventRecord[];
  branchEvents: WhatIfEventRecord[];
  baselineRisk: number[];
  branchRisk: number[];
  p10Risk?: number[] | undefined;
  p50Risk?: number[] | undefined;
  p90Risk?: number[] | undefined;
  trajectories?:
    | {
        baseline: { units: WhatIfUnitTrajectory[]; tracks: Record<string, WhatIfTrackPoint[]> };
        branch: { units: WhatIfUnitTrajectory[]; tracks: Record<string, WhatIfTrackPoint[]> };
      }
    | undefined;
  spatialAnnotations?:
    | {
        baseline: {
          weatherCells: WhatIfWeatherAnnotation[];
          incidents: WhatIfIncidentAnnotation[];
        };
        branch: { weatherCells: WhatIfWeatherAnnotation[]; incidents: WhatIfIncidentAnnotation[] };
      }
    | undefined;
  monteCarloRuns: number;
}

export const api = {
  // --- health -----------------------------------------------------------
  health(): Promise<{ ok: boolean } | null> {
    return request<{ ok: boolean }>("/health");
  },

  // --- auth -------------------------------------------------------------
  async login(role: Role, userName: string): Promise<boolean> {
    const out = await request<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ role, userName }),
    });
    if (out?.token) {
      token = out.token;
      window.localStorage.setItem("doip.token", out.token);
      return true;
    }
    return false;
  },

  // --- runs -------------------------------------------------------------
  saveRun(run: RunRecord): Promise<{ ok: boolean } | null> {
    return request<{ ok: boolean }>("/runs", { method: "POST", body: JSON.stringify(run) });
  },

  async listRuns(): Promise<RunRecord[] | null> {
    const out = await request<{ runs: RunRecord[] }>("/runs");
    return out?.runs ?? null;
  },

  // --- sitrep -----------------------------------------------------------
  async sitrep(world: object, events: object[]): Promise<{ sections: object[] } | null> {
    return request<{ sections: object[] }>("/sitrep", {
      method: "POST",
      body: JSON.stringify({ world, events }),
    });
  },

  // --- vision adjudication ---------------------------------------------
  async adjudicate(
    detections: object[],
    opts?: { minConfidence?: number; autoAcceptAbove?: number | null },
  ): Promise<object | null> {
    return request<object>("/vision/adjudicate", {
      method: "POST",
      body: JSON.stringify({
        detections,
        minConfidence: opts?.minConfidence ?? 0.5,
        autoAcceptAbove: opts?.autoAcceptAbove ?? null,
      }),
    });
  },

  // --- what-if headless runner -----------------------------------------
  async whatif(
    seed: number,
    scenarioId: string,
    actions: object[],
    ticks = 60,
    runs = 1,
  ): Promise<WhatIfResponse | null> {
    return request<WhatIfResponse>("/whatif", {
      method: "POST",
      body: JSON.stringify({ seed, scenarioId, actions, ticks, runs }),
    });
  },

  // --- doctrine & SOP corpus semantic query ----------------------------
  async queryCorpus(
    query: string,
    top_k = 5,
  ): Promise<Array<{
    doc_id: string;
    title: string;
    category: string;
    score: number;
    section: string;
    excerpt: string;
  }> | null> {
    const out = await request<{
      results: Array<{
        doc_id: string;
        title: string;
        category: string;
        score: number;
        section: string;
        excerpt: string;
      }>;
    }>("/corpus/query", {
      method: "POST",
      body: JSON.stringify({ query, top_k }),
    });
    return out?.results ?? null;
  },

  // --- check whether backend is available (no auth) --------------------
  async available(): Promise<boolean> {
    const h = await this.health();
    return h?.ok === true;
  },

  // --- admin: user management  (P0-3) ----------------------------------
  async listUsers(): Promise<{ name: string; role: string; unit: string }[] | null> {
    const out = await request<{ users: { name: string; role: string; unit: string }[] }>(
      "/admin/users",
    );
    return out?.users ?? null;
  },

  async createUser(name: string, role: string, unit: string): Promise<{ ok: boolean } | null> {
    return request<{ ok: boolean }>("/admin/users", {
      method: "POST",
      body: JSON.stringify({ name, role, unit }),
    });
  },

  async deleteUser(name: string): Promise<{ ok: boolean } | null> {
    return request<{ ok: boolean }>(`/admin/users/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },

  // --- admin: paginated audit log  (P0-4) ------------------------------
  async listAudit(
    page = 1,
    perPage = 50,
  ): Promise<{
    audit: object[];
    page: number;
    per_page: number;
    total: number;
    pages: number;
  } | null> {
    return request(`/audit?page=${page}&per_page=${perPage}`);
  },

  // --- sitrep: LLM-enhanced generation  (P1-1) -------------------------
  async generateSitrep(
    world: object,
    events: object[],
  ): Promise<{ sections: object[]; generatedAtTick: number } | null> {
    return request("/sitrep", {
      method: "POST",
      body: JSON.stringify({ world, events }),
    });
  },

  // --- vision: YOLO status, samples, inference, and camera frames ------
  async visionStatus(): Promise<VisionModelStatus | null> {
    return request<VisionModelStatus>("/vision/status");
  },

  async visionSamples(): Promise<{ samples: TacticalSample[]; count: number } | null> {
    return request<{ samples: TacticalSample[]; count: number }>("/vision/samples");
  },

  async visionInfer(
    imageB64: string,
    unitId = "CAM-01",
    tick = 0,
    confThreshold = 0.25,
  ): Promise<VisionInferenceResult | null> {
    return request<VisionInferenceResult>(
      "/vision/infer",
      {
        method: "POST",
        body: JSON.stringify({
          image_b64: imageB64,
          unitId,
          tick,
          confThreshold,
        }),
      },
      15000,
    );
  },

  async visionFrames(
    n = 6,
    tick = 0,
  ): Promise<{ frames: SurveillanceCameraFrame[]; count: number } | null> {
    return request<{ frames: SurveillanceCameraFrame[]; count: number }>(
      `/vision/frames?n=${n}&tick=${tick}`,
    );
  },

  // --- what-if: run history  (P1-3) ------------------------------------
  async whatIfHistory(limit = 20): Promise<{ results: object[] } | null> {
    return request(`/whatif/history?limit=${limit}`);
  },

  // --- custom scenarios  (P2-1) -----------------------------------------
  async listCustomScenarios(): Promise<{ scenarios: object[] } | null> {
    return request("/scenarios/custom");
  },

  async saveScenario(body: object): Promise<object | null> {
    return request("/scenarios/custom", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async deleteScenario(scenarioId: string): Promise<object | null> {
    return request(`/scenarios/custom/${encodeURIComponent(scenarioId)}`, {
      method: "DELETE",
    });
  },

  async validateScenario(body: object): Promise<{ valid: boolean; results: object[] } | null> {
    return request("/scenarios/validate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  // --- AAR download  (P2-4) --------------------------------------------
  async downloadAar(runId: string): Promise<{ runId: string; report: string } | null> {
    return request(`/runs/${encodeURIComponent(runId)}/report`);
  },

  // --- Phase 3: YAML scenarios -----------------------------------------
  async listYamlScenarios(): Promise<{ scenarios: object[] } | null> {
    return request("/scenarios/yaml");
  },

  // --- Phase 3: Doctrine RAG & Grounding -------------------------------
  async ragQuery(
    query: string,
    recentEvents: object[] = [],
  ): Promise<{
    query: string;
    answer: string;
    citations: object[];
    grounding: {
      grounded: boolean;
      warning?: string | null;
      valid_doc_citations: string[];
      valid_event_citations: string[];
      invalid_citations: string[];
    };
  } | null> {
    return request("/rag/query", {
      method: "POST",
      body: JSON.stringify({ query, recentEvents }),
    });
  },

  async listCorpusDocs(): Promise<{ docs: CorpusDocSummary[]; total: number } | null> {
    return request<{ docs: CorpusDocSummary[]; total: number }>("/corpus/docs");
  },

  async getCorpusDoc(docId: string): Promise<CorpusDocDetail | null> {
    return request<CorpusDocDetail>(`/corpus/docs/${encodeURIComponent(docId)}`);
  },
};
