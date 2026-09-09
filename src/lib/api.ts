// Fail-soft HTTP + WS client for the DOIP MVP backend.
// Design rule: every call resolves null when the server is absent —
// the app must work fully offline, unchanged.
import type { RunRecord } from "@/sim/store";
import type { Role } from "@/sim/types";

const BASE = (
  (import.meta.env.VITE_DOIP_API_URL as string | undefined) ?? "http://localhost:8000"
).replace(/\/$/, "");

export function wsUrl(path: string): string {
  return BASE.replace(/^http/, "ws") + path;
}

let token: string | null =
  typeof window === "undefined" ? null : window.localStorage.getItem("doip.token");

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (typeof window === "undefined") return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
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
  ): Promise<object | null> {
    return request<object>("/whatif", {
      method: "POST",
      body: JSON.stringify({ seed, scenarioId, actions, ticks }),
    });
  },

  // --- check whether backend is available (no auth) --------------------
  async available(): Promise<boolean> {
    const h = await this.health();
    return h?.ok === true;
  },
};
