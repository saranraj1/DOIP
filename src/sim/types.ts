export type Severity = "low" | "medium" | "high" | "critical";

export type Role = "admin" | "planner" | "operator" | "viewer";

export type RunStatus = "IDLE" | "RUNNING" | "PAUSED" | "REPLAY" | "STOPPED";

export type UnitKind = "patrol" | "uav" | "convoy" | "depot";

export type EventType =
  | "world_init"
  | "unit_move"
  | "unit_status"
  | "comms_loss"
  | "comms_restore"
  | "incident_open"
  | "incident_close"
  | "alert_raise"
  | "alert_ack"
  | "resource_level"
  | "vitals"
  | "weather_spawn"
  | "weather_move"
  | "weather_clear"
  | "detection"
  | "system";

export interface SimEvent {
  id: number;
  tick: number;
  simTime: number;
  type: EventType;
  severity: Severity;
  entityId: string;
  payload: Record<string, unknown>;
}

export interface Unit {
  id: string;
  callsign: string;
  kind: UnitKind;
  lat: number;
  lon: number;
  heading: number;
  speedKph: number;
  status: "active" | "slowed" | "halted" | "stale";
  fuel: number;
  battery: number;
  lastSeenTick: number;
  sector: string;
  route: Array<[number, number]>;
}

export interface Incident {
  id: string;
  tick: number;
  severity: Severity;
  kind: string;
  lat: number;
  lon: number;
  entityId: string;
  open: boolean;
  closedTick?: number;
}

export interface AlertItem {
  id: string;
  tick: number;
  severity: Severity;
  message: string;
  entityId: string;
  acked: boolean;
  ackedTick?: number;
  ackedBy?: string;
}

export interface Depot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  stock: { fuel: number; medkit: number; rations: number; battery: number };
  capacity: { fuel: number; medkit: number; rations: number; battery: number };
}

export interface Person {
  id: string;
  name: string;
  rank: string;
  unitId: string;
  heartRate: number;
  fatigue: number;
  history: number[];
}

export interface WeatherCell {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  intensity: number;
  kind: string;
}

export interface Zone {
  id: string;
  name: string;
  kind: "patrol" | "restricted" | "threat";
  points: Array<[number, number]>;
}

export interface WorldState {
  seed: number;
  scenarioId: string;
  tick: number;
  simTime: number;
  units: Record<string, Unit>;
  incidents: Record<string, Incident>;
  alerts: Record<string, AlertItem>;
  depots: Record<string, Depot>;
  personnel: Record<string, Person>;
  weather: Record<string, WeatherCell>;
  zones: Zone[];
}

/**
 * Backend seam. The mock tick engine implements this; a FastAPI WebSocket
 * feed can implement the same interface later with zero UI changes.
 */
export interface SimSource {
  start(opts: { seed: number; scenarioId: string }): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setSpeed(speed: number): void;
  inject(events: Omit<SimEvent, "id" | "tick" | "simTime">[]): void;
  subscribe(cb: (events: SimEvent[]) => void): () => void;
}
