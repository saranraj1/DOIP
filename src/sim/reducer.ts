import type { AlertItem, Depot, Incident, Person, SimEvent, Unit, WorldState, Zone } from "./types";

export const STALE_TICKS = 180; // 3 minutes of sim time

export const emptyWorld = (): WorldState => ({
  seed: 0,
  scenarioId: "",
  tick: 0,
  simTime: 0,
  units: {},
  incidents: {},
  alerts: {},
  depots: {},
  personnel: {},
  weather: {},
  zones: [],
});

export function applyEvent(state: WorldState, e: SimEvent): WorldState {
  const s: WorldState = { ...state, tick: e.tick, simTime: e.simTime };

  switch (e.type) {
    case "world_init": {
      const p = e.payload as unknown as {
        seed: number;
        scenarioId: string;
        units: Unit[];
        depots: Depot[];
        personnel: Person[];
        zones: Zone[];
      };
      s.seed = p.seed;
      s.scenarioId = p.scenarioId;
      s.units = Object.fromEntries(p.units.map((u) => [u.id, { ...u }]));
      s.depots = Object.fromEntries(p.depots.map((d) => [d.id, { ...d }]));
      s.personnel = Object.fromEntries(p.personnel.map((x) => [x.id, { ...x, history: [x.heartRate] }]));
      s.zones = p.zones;
      s.incidents = {};
      s.alerts = {};
      s.weather = {};
      break;
    }
    case "unit_move": {
      const p = e.payload as unknown as { lat: number; lon: number; heading: number };
      const u = s.units[e.entityId];
      if (u) {
        s.units = {
          ...s.units,
          [u.id]: { ...u, lat: p.lat, lon: p.lon, heading: p.heading, lastSeenTick: e.tick },
        };
      }
      break;
    }
    case "unit_status": {
      const p = e.payload as unknown as { status: Unit["status"] };
      const u = s.units[e.entityId];
      if (u) s.units = { ...s.units, [u.id]: { ...u, status: p.status } };
      break;
    }
    case "comms_restore": {
      const u = s.units[e.entityId];
      if (u) s.units = { ...s.units, [u.id]: { ...u, lastSeenTick: e.tick, status: "active" } };
      break;
    }
    case "resource_level": {
      const p = e.payload as unknown as { fuel?: number; battery?: number; stock?: Depot["stock"] };
      const u = s.units[e.entityId];
      if (u && p.fuel !== undefined) {
        s.units = { ...s.units, [u.id]: { ...u, fuel: p.fuel, battery: p.battery ?? u.battery } };
      }
      const d = s.depots[e.entityId];
      if (d && p.stock) s.depots = { ...s.depots, [d.id]: { ...d, stock: p.stock } };
      break;
    }
    case "vitals": {
      const p = e.payload as unknown as { heartRate: number; fatigue: number };
      const person = s.personnel[e.entityId];
      if (person) {
        s.personnel = {
          ...s.personnel,
          [person.id]: {
            ...person,
            heartRate: p.heartRate,
            fatigue: p.fatigue,
            history: [...person.history, p.heartRate].slice(-40),
          },
        };
      }
      break;
    }
    case "weather_spawn": {
      const p = e.payload as unknown as {
        lat: number;
        lon: number;
        radiusM: number;
        intensity: number;
        kind: string;
      };
      s.weather = { ...s.weather, [e.entityId]: { id: e.entityId, ...p } };
      break;
    }
    case "weather_move": {
      const p = e.payload as unknown as { lat: number; lon: number; intensity: number };
      const w = s.weather[e.entityId];
      if (w) s.weather = { ...s.weather, [w.id]: { ...w, ...p } };
      break;
    }
    case "weather_clear": {
      const rest = { ...s.weather };
      delete rest[e.entityId];
      s.weather = rest;
      break;
    }
    case "incident_open": {
      const p = e.payload as unknown as { kind: string; lat: number; lon: number; reportedBy?: string };
      const inc: Incident = {
        id: e.entityId,
        tick: e.tick,
        severity: e.severity,
        kind: p.kind,
        lat: p.lat,
        lon: p.lon,
        entityId: p.reportedBy ?? "",
        open: true,
      };
      s.incidents = { ...s.incidents, [inc.id]: inc };
      break;
    }
    case "incident_close": {
      const inc = s.incidents[e.entityId];
      if (inc) s.incidents = { ...s.incidents, [inc.id]: { ...inc, open: false, closedTick: e.tick } };
      break;
    }
    case "alert_raise": {
      const p = e.payload as unknown as { alertId?: string; message?: string };
      const id = p.alertId ?? `AL-${e.id}`;
      const a: AlertItem = {
        id,
        tick: e.tick,
        severity: e.severity,
        message: p.message ?? e.type,
        entityId: e.entityId,
        acked: false,
      };
      s.alerts = { ...s.alerts, [id]: a };
      break;
    }
    case "alert_ack": {
      const p = e.payload as unknown as { alertId?: string; by?: string };
      const id = p.alertId ?? e.entityId;
      const a = s.alerts[id];
      if (a) s.alerts = { ...s.alerts, [id]: { ...a, acked: true, ackedTick: e.tick, ackedBy: p.by ?? "operator" } };
      break;
    }
    default:
      break;
  }
  return s;
}

export function foldEvents(events: SimEvent[], upToTick = Infinity): WorldState {
  let s = emptyWorld();
  for (const e of events) {
    if (e.tick > upToTick) break;
    s = applyEvent(s, e);
  }
  return s;
}

export const isStale = (u: Unit, tick: number) => tick - u.lastSeenTick >= STALE_TICKS;
