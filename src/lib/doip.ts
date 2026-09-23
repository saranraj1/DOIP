import type { Severity } from "@/sim/types";

export const SEVERITY_META: Record<
  Severity,
  { label: string; shape: string; color: string; className: string; order: number }
> = {
  critical: {
    label: "CRITICAL",
    shape: "◈",
    color: "#F87171",
    className: "text-sev-critical",
    order: 0,
  },
  high: { label: "HIGH", shape: "△", color: "#FB923C", className: "text-sev-high", order: 1 },
  medium: { label: "MEDIUM", shape: "■", color: "#FBBF24", className: "text-sev-medium", order: 2 },
  low: { label: "LOW", shape: "●", color: "#6E6E6E", className: "text-sev-low", order: 3 },
};

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export function formatSimClock(tick: number) {
  const total = Math.max(0, Math.floor(tick));
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatCoord(lat: number, lon: number) {
  return `${lat.toFixed(4)}°N ${lon.toFixed(4)}°E`;
}

const RANK: Record<string, number> = { viewer: 0, operator: 1, planner: 2, admin: 3 };

export function roleAtLeast(role: string | null, min: "viewer" | "operator" | "planner" | "admin") {
  if (!role) return false;
  return (RANK[role] ?? -1) >= RANK[min]!;
}

/** planner+ may plan missions; operator+ may control runs and ack alerts. */
export function canPlan(role: string | null) {
  return role === "planner" || role === "admin";
}
export function canOperate(role: string | null) {
  return role === "operator" || role === "planner" || role === "admin";
}

/** "00:01:05Z" — Zulu-styled sim clock for the status bar. */
export function formatSimClockZ(tick: number) {
  return `${formatSimClock(tick)}Z`;
}

/**
 * Synthetic MGRS-style grid reference for a lat/lon, e.g. "NK 4512 9078".
 * Training data only — not a real grid projection.
 */
export function gridRef(lat: number, lon: number) {
  const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXZ";
  const a = LETTERS[Math.abs(Math.floor(lat)) % LETTERS.length] ?? "N";
  const b = LETTERS[Math.abs(Math.floor(lon)) % LETTERS.length] ?? "K";
  const e = Math.floor((((lon % 1) + 1) % 1) * 10000);
  const n = Math.floor((((lat % 1) + 1) % 1) * 10000);
  const pad = (v: number) => String(v).padStart(4, "0");
  return `${a}${b} ${pad(e)} ${pad(n)}`;
}

/** "PATROL-8 [4/5]" — callsign plus present/assigned personnel. */
export function unitDesignator(
  unit: { id: string; callsign: string },
  personnel?: Record<string, { unitId: string; heartRate: number; fatigue: number }>,
) {
  const cs = unit.callsign.toUpperCase();
  if (!personnel) return cs;
  const team = Object.values(personnel).filter((p) => p.unitId === unit.id);
  if (!team.length) return cs;
  const present = team.filter((p) => p.fatigue < 0.85 && p.heartRate < 150).length;
  return `${cs} [${present}/${team.length}]`;
}

/**
 * Fast deterministic rolling hash formatted as 8 hex characters.
 * Computes deterministic fingerprint from event IDs and ticks.
 */
export function computeEventFingerprint(events: { id: string | number; tick: number }[]): string {
  if (!events.length) return "00000000";
  let hash = 0x811c9dc5;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const str = `${e.id}:${e.tick};`;
    for (let j = 0; j < str.length; j++) {
      hash ^= str.charCodeAt(j);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
