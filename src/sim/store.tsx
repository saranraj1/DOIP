import { useCallback, useSyncExternalStore } from "react";
import { simSource as localSource } from "./engine";
import { WsSimSource } from "./wsSource";
import { api } from "@/lib/api";
import type { SimSource } from "./types";

// Active source: starts as local engine, silently upgraded to WS on login.
let activeSource: SimSource = localSource;
import { applyEvent, emptyWorld } from "./reducer";
import type { Role, RunStatus, SimEvent, WorldState } from "./types";

export interface RunRecord {
  id: string;
  seed: number;
  scenarioId: string;
  ticks: number;
  events: number;
  /** Event-log snapshot for this run — powers per-run replay, export and run-vs-run compare. */
  log: SimEvent[];
}

export interface SimStoreState {
  world: WorldState;
  events: SimEvent[];
  status: RunStatus;
  speed: number;
  seed: number;
  scenarioId: string;
  role: Role | null;
  userName: string;
  eventRate: number[];
  runs: RunRecord[];
}

const initial: SimStoreState = {
  world: emptyWorld(),
  events: [],
  status: "IDLE",
  speed: 1,
  seed: 20260101,
  scenarioId: "SC-1",
  role: null,
  userName: "",
  eventRate: [],
  runs: [],
};

class SimStore {
  private state: SimStoreState = initial;
  private listeners = new Set<() => void>();
  private lastTick = 0;
  private tickCount = 0;
  private started = false;
  private runCounter = 0;

  getState = () => this.state;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    if (!this.started) this.bind();
    return () => this.listeners.delete(cb);
  };

  private set(patch: Partial<SimStoreState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private bind() {
    this.started = true;
    activeSource.subscribe((batch) => this.ingest(batch));
  }

  /** Try to upgrade to the backend WS engine; fall back silently if offline. */
  private async tryUpgradeToWs() {
    if (typeof window === "undefined") return;
    const backendUp = await api.available();
    if (!backendUp) return; // backend absent — keep local engine
    const wsSource = new WsSimSource();
    wsSource.setOnFail(() => {
      // WS failed after token — stay on local engine, no UI disruption
    });
    activeSource = wsSource;
    // Rebind listener to the new source
    wsSource.subscribe((batch) => this.ingest(batch));
  }

  /** Single adapter seam: swap simSource for a WebSocket feed, this stays. */
  ingest(batch: SimEvent[]) {
    let world = this.state.world;
    for (const e of batch) world = applyEvent(world, e);
    const events = [...this.state.events, ...batch].slice(-20000);
    const tick = batch[batch.length - 1]?.tick ?? this.state.world.tick;
    let rate = this.state.eventRate;
    if (tick !== this.lastTick) {
      rate = [...rate, this.tickCount].slice(-60);
      this.tickCount = batch.length;
      this.lastTick = tick;
    } else {
      this.tickCount += batch.length;
    }
    const statusEvent = batch.find((e) => e.type === "system" && (e.payload as { status?: string }).status);
    const status = statusEvent
      ? ((statusEvent.payload as { status: string }).status as RunStatus)
      : this.state.status;
    this.set({ world, events, eventRate: rate, status });
  }

  /** Restores the demo session after a page reload (client-only). */
  hydrateSession() {
    if (typeof window === "undefined" || this.state.role) return;
    try {
      const raw = window.localStorage.getItem("doip.session");
      if (!raw) return;
      const s = JSON.parse(raw) as { role: Role; userName: string };
      if (s?.role) this.login(s.role, s.userName);
    } catch {
      /* ignore corrupt session */
    }
  }

  login(role: Role, userName: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("doip.session", JSON.stringify({ role, userName }));
    }
    this.set({ role, userName });
    // MVP backend: get token, upgrade to WS engine, hydrate runs. All fail-soft.
    void (async () => {
      await api.login(role, userName);
      await this.tryUpgradeToWs();
      await this.hydrateRuns();
    })();
    if (this.state.status === "IDLE") this.startRun(this.state.seed, this.state.scenarioId);
  }

  logout() {
    if (typeof window !== "undefined") window.localStorage.removeItem("doip.session");
    this.set({ role: null, userName: "" });
  }

  /** Pulls previously persisted runs from the MVP backend (no-op offline). */
  private async hydrateRuns() {
    const serverRuns = await api.listRuns();
    if (!serverRuns?.length) return;
    const known = new Set(this.state.runs.map((r) => r.id));
    const merged = [...serverRuns.filter((r) => !known.has(r.id)), ...this.state.runs].slice(-8);
    for (const r of merged) {
      const n = Number(r.id.replace("RUN-", ""));
      if (Number.isFinite(n) && n > this.runCounter) this.runCounter = n;
    }
    this.set({ runs: merged });
  }

  /** Archives the in-flight run (if any) into the run list. */
  private recordRun(): RunRecord[] {
    const { seed, scenarioId, world, events } = this.state;
    if (!world.tick || !events.length) return this.state.runs;
    this.runCounter += 1;
    const record: RunRecord = {
      id: `RUN-${this.runCounter}`,
      seed,
      scenarioId,
      ticks: world.tick,
      events: events.length,
      log: events,
    };
    // MVP backend: persist fire-and-forget; the UI never blocks on the server.
    void api.saveRun(record);
    return [...this.state.runs, record].slice(-8);
  }

  startRun(seed: number, scenarioId: string) {
    const runs =
      this.state.status === "RUNNING" || this.state.status === "PAUSED"
        ? this.recordRun()
        : this.state.runs;
    this.lastTick = 0;
    this.tickCount = 0;
    this.set({ events: [], world: emptyWorld(), eventRate: [], seed, scenarioId, status: "RUNNING", runs });
    activeSource.start({ seed, scenarioId });
  }

  /** Re-runs a recorded run with the same scenario and seed — reproduces it event-for-event. */
  cloneRun(run: RunRecord) {
    this.startRun(run.seed, run.scenarioId);
  }

  pause() {
    activeSource.pause();
    this.set({ status: "PAUSED" });
  }

  resume() {
    activeSource.resume();
    this.set({ status: "RUNNING" });
  }

  stop() {
    activeSource.stop();
    this.set({ status: "STOPPED", runs: this.recordRun() });
  }

  setSpeed(speed: number) {
    activeSource.setSpeed(speed);
    this.set({ speed });
  }

  setStatus(status: RunStatus) {
    this.set({ status });
  }

  ackAlert(alertId: string, by: string) {
    activeSource.inject([
      { type: "alert_ack", severity: "low", entityId: alertId, payload: { alertId, by } },
    ]);
  }

  closeIncident(id: string) {
    activeSource.inject([{ type: "incident_close", severity: "low", entityId: id, payload: {} }]);
  }

  launchMission(opts: { unitId: string; waypoints: Array<[number, number]>; by: string }) {
    activeSource.inject([
      {
        type: "system",
        severity: "medium",
        entityId: opts.unitId,
        payload: { mission: true, route: opts.waypoints, by: opts.by },
      },
    ]);
  }

  injectRaw(events: Omit<SimEvent, "id" | "tick" | "simTime">[]) {
    activeSource.inject(events);
  }
}

export const simStore = new SimStore();

export function useSim<T>(selector: (s: SimStoreState) => T): T {
  const getSnapshot = useCallback(() => selector(simStore.getState()), [selector]);
  return useSyncExternalStore(simStore.subscribe, getSnapshot, getSnapshot);
}

export const useSimState = () => useSim((s) => s);
