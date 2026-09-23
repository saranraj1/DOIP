import { mulberry32, pick, between, type Rand } from "./prng";
import { getScenario } from "./scenarios";
import type {
  Depot,
  Person,
  SimEvent,
  SimSource,
  Severity,
  Unit,
  WeatherCell,
  Zone,
} from "./types";

export const BASE_LAT = 12.9716;
export const BASE_LON = 77.5946;

const PATROL_NAMES = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL"];
const UAV_NAMES = ["RAVEN", "KITE", "FALCON", "OSPREY", "SHRIKE", "HARRIER", "MERLIN", "CONDOR"];
const CONVOY_NAMES = ["MULE", "CARAVAN", "IRONHORSE", "PACKHORSE", "OXCART", "DRAY"];
const SECTORS = ["A", "B", "C", "D"];
const FIRST = [
  "A. Rao",
  "S. Menon",
  "K. Iyer",
  "P. Singh",
  "N. Das",
  "R. Kapoor",
  "V. Nair",
  "M. Bose",
];
const RANKS = ["SGT", "CPL", "LT", "PVT", "SSG"];

const INCIDENT_KINDS = [
  "unauthorized-entry",
  "signal-jamming",
  "vehicle-breakdown",
  "unidentified-contact",
  "perimeter-breach",
  "medical",
  "supply-shortfall",
];

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

function ring(rand: Rand, cx: number, cy: number, r: number, n: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const phase = rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const rr = r * (0.7 + rand() * 0.6);
    pts.push([cx + Math.sin(a) * rr, cy + Math.cos(a) * rr]);
  }
  return pts;
}

export interface InitWorld {
  units: Unit[];
  depots: Depot[];
  personnel: Person[];
  zones: Zone[];
}

export function buildInitialWorld(seed: number, scenarioId: string): InitWorld {
  const rand = mulberry32(seed);
  const sc = getScenario(scenarioId);
  const units: Unit[] = [];
  const personnel: Person[] = [];

  const mk = (kind: Unit["kind"], callsign: string, i: number): Unit => {
    const cx = BASE_LAT + between(rand, -0.05, 0.05);
    const cy = BASE_LON + between(rand, -0.05, 0.05);
    const route = ring(rand, cx, cy, kind === "uav" ? 0.03 : 0.018, 6);
    return {
      id: `U-${kind.toUpperCase()}-${i}`,
      callsign,
      kind,
      lat: route[0]![0],
      lon: route[0]![1],
      heading: 0,
      speedKph: kind === "uav" ? 68 : kind === "convoy" ? 34 : 6,
      status: "active",
      fuel: between(rand, 55, 100),
      battery: between(rand, 60, 100),
      lastSeenTick: 0,
      sector: pick(rand, SECTORS),
      route,
    };
  };

  for (let i = 0; i < sc.patrolCount; i++) {
    const u = mk("patrol", `${PATROL_NAMES[i % PATROL_NAMES.length]}-${1 + (i % 3)}`, i + 1);
    units.push(u);
    const teamSize = 2 + Math.floor(rand() * 2);
    for (let p = 0; p < teamSize; p++) {
      personnel.push({
        id: `P-${u.id}-${p}`,
        name: pick(rand, FIRST),
        rank: pick(rand, RANKS),
        unitId: u.id,
        heartRate: Math.round(between(rand, 62, 92)),
        fatigue: Number(between(rand, 0.1, 0.55).toFixed(2)),
        history: [],
      });
    }
  }
  for (let i = 0; i < sc.uavCount; i++)
    units.push(mk("uav", `${UAV_NAMES[i % UAV_NAMES.length]}-${1 + (i % 3)}`, i + 1));
  for (let i = 0; i < sc.convoyCount; i++)
    units.push(mk("convoy", `${CONVOY_NAMES[i % CONVOY_NAMES.length]}-${1 + (i % 3)}`, i + 1));

  const depots: Depot[] = ["NORTH", "CENTRAL", "SOUTH"].map((n, i) => ({
    id: `D-${i + 1}`,
    name: `${n} DEPOT`,
    lat: BASE_LAT + between(rand, -0.04, 0.04),
    lon: BASE_LON + between(rand, -0.04, 0.04),
    stock: {
      fuel: Math.round(between(rand, 2200, 4000)),
      medkit: Math.round(between(rand, 60, 140)),
      rations: Math.round(between(rand, 300, 700)),
      battery: Math.round(between(rand, 80, 200)),
    },
    capacity: { fuel: 4000, medkit: 150, rations: 700, battery: 200 },
  }));

  const zones: Zone[] = [
    {
      id: "Z-1",
      name: "PATROL GRID NORTH",
      kind: "patrol",
      points: ring(rand, BASE_LAT + 0.03, BASE_LON - 0.02, 0.035, 7),
    },
    {
      id: "Z-2",
      name: "PATROL GRID SOUTH",
      kind: "patrol",
      points: ring(rand, BASE_LAT - 0.035, BASE_LON + 0.02, 0.03, 6),
    },
    {
      id: "Z-3",
      name: "RESTRICTED AIRSPACE R-12",
      kind: "restricted",
      points: ring(rand, BASE_LAT + 0.01, BASE_LON + 0.045, 0.022, 5),
    },
    {
      id: "Z-4",
      name: "THREAT SECTOR C",
      kind: "threat",
      points: ring(rand, BASE_LAT - 0.02, BASE_LON - 0.045, 0.026, 6),
    },
  ];

  return { units, depots, personnel, zones };
}

export class MockSimSource implements SimSource {
  private rand: Rand = mulberry32(1);
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(e: SimEvent[]) => void>();
  private nextId = 1;
  private tick = 0;
  private speed = 1;
  private seed = 20260101;
  private scenarioId = "SC-1";
  private units: Unit[] = [];
  private weather: WeatherCell[] = [];
  private personnel: Person[] = [];
  private depots: Depot[] = [];
  private routeIdx = new Map<string, number>();
  private silence = new Map<string, number>();

  private emit(partials: Array<Pick<SimEvent, "type" | "severity" | "entityId" | "payload">>) {
    if (!partials.length) return;
    const events: SimEvent[] = partials.map((p) => ({
      id: this.nextId++,
      tick: this.tick,
      simTime: this.tick * 1000,
      ...p,
    }));
    this.listeners.forEach((l) => l(events));
  }

  subscribe(cb: (events: SimEvent[]) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start({ seed, scenarioId }: { seed: number; scenarioId: string }) {
    this.stopTimer();
    this.seed = seed;
    this.scenarioId = scenarioId;
    this.rand = mulberry32(seed);
    this.nextId = 1;
    this.tick = 0;
    this.routeIdx.clear();
    this.silence.clear();
    const world = buildInitialWorld(seed, scenarioId);
    this.units = world.units.map((u) => ({ ...u }));
    this.personnel = world.personnel.map((p) => ({ ...p }));
    this.depots = world.depots.map((d) => ({ ...d, stock: { ...d.stock } }));
    this.weather = [];
    this.emit([
      {
        type: "world_init",
        severity: "low",
        entityId: "system",
        payload: { seed, scenarioId, ...world },
      },
    ]);
    this.startTimer();
  }

  pause() {
    this.stopTimer();
    this.emit([
      { type: "system", severity: "low", entityId: "system", payload: { status: "PAUSED" } },
    ]);
  }

  resume() {
    if (this.timer) return;
    this.emit([
      { type: "system", severity: "low", entityId: "system", payload: { status: "RUNNING" } },
    ]);
    this.startTimer();
  }

  stop() {
    this.stopTimer();
    this.emit([
      { type: "system", severity: "low", entityId: "system", payload: { status: "STOPPED" } },
    ]);
  }

  setSpeed(speed: number) {
    this.speed = speed;
    this.emit([{ type: "system", severity: "low", entityId: "system", payload: { speed } }]);
    if (this.timer) {
      this.stopTimer();
      this.startTimer();
    }
  }

  inject(events: Omit<SimEvent, "id" | "tick" | "simTime">[]) {
    // Mission tasking rewrites a unit's route inside the engine so the
    // simulated unit actually follows the plan drawn in Mission Planner.
    for (const e of events) {
      const p = e.payload as { mission?: boolean; route?: Array<[number, number]> };
      if (e.type === "system" && p.mission && p.route?.length) {
        const unit = this.units.find((u) => u.id === e.entityId);
        if (unit) {
          unit.route = p.route;
          this.routeIdx.set(unit.id, 0);
        }
      }
    }
    this.emit(events);
  }

  isRunning() {
    return this.timer !== null;
  }

  private startTimer() {
    this.timer = setInterval(() => this.step(), Math.max(120, 1000 / this.speed));
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private step() {
    this.tick += 1;
    const rand = this.rand;
    const sc = getScenario(this.scenarioId);
    const out: Array<Pick<SimEvent, "type" | "severity" | "entityId" | "payload">> = [];

    // weather cells drift / spawn / clear
    if (rand() < sc.weatherRate && this.weather.length < 4) {
      const cell: WeatherCell = {
        id: `W-${this.tick}`,
        lat: BASE_LAT + between(rand, -0.05, 0.05),
        lon: BASE_LON + between(rand, -0.05, 0.05),
        radiusM: Math.round(between(rand, 900, 2600)),
        intensity: Number(between(rand, 0.3, 1).toFixed(2)),
        kind: pick(rand, ["rain", "storm", "fog", "dust"]),
      };
      this.weather.push(cell);
      out.push({
        type: "weather_spawn",
        severity: cell.intensity > 0.7 ? "high" : "medium",
        entityId: cell.id,
        payload: { ...cell },
      });
    }
    this.weather = this.weather.filter((w) => {
      w.lat += between(rand, -0.0016, 0.0016);
      w.lon += between(rand, -0.0016, 0.0016);
      w.intensity = Number(Math.max(0, w.intensity - 0.004).toFixed(3));
      if (w.intensity <= 0.05) {
        out.push({ type: "weather_clear", severity: "low", entityId: w.id, payload: {} });
        return false;
      }
      out.push({
        type: "weather_move",
        severity: "low",
        entityId: w.id,
        payload: { lat: w.lat, lon: w.lon, intensity: w.intensity },
      });
      return true;
    });

    for (const u of this.units) {
      // comms silence
      const silentUntil = this.silence.get(u.id) ?? 0;
      if (silentUntil > this.tick) continue;
      if (rand() < 0.004) {
        this.silence.set(u.id, this.tick + Math.round(between(rand, 180, 320)));
        out.push({
          type: "comms_loss",
          severity: "high",
          entityId: u.id,
          payload: { callsign: u.callsign },
        });
        out.push({
          type: "alert_raise",
          severity: "high",
          entityId: u.id,
          payload: {
            message: `${u.callsign} comms silence detected`,
            alertId: `AL-${this.tick}-${u.id}`,
          },
        });
        continue;
      }
      if (silentUntil === this.tick) {
        out.push({
          type: "comms_restore",
          severity: "low",
          entityId: u.id,
          payload: { callsign: u.callsign },
        });
      }

      const idx = this.routeIdx.get(u.id) ?? 0;
      const target = u.route[idx % u.route.length]!;
      const dLat = target[0] - u.lat;
      const dLon = target[1] - u.lon;
      const dist = Math.hypot(dLat, dLon);
      const inWeather = this.weather.some(
        (w) => Math.hypot(w.lat - u.lat, w.lon - u.lon) * 111000 < w.radiusM,
      );
      const base = (u.speedKph / 3600 / 111) * (inWeather ? 0.45 : 1) * 4;
      if (dist < base * 1.2) {
        this.routeIdx.set(u.id, idx + 1);
      } else {
        u.lat += (dLat / dist) * base;
        u.lon += (dLon / dist) * base;
        u.heading = (Math.atan2(dLon, dLat) * 180) / Math.PI;
      }
      const status = inWeather ? "slowed" : "active";
      if (status !== u.status) {
        u.status = status;
        out.push({ type: "unit_status", severity: "low", entityId: u.id, payload: { status } });
      }
      u.lastSeenTick = this.tick;
      out.push({
        type: "unit_move",
        severity: "low",
        entityId: u.id,
        payload: { lat: u.lat, lon: u.lon, heading: u.heading, inWeather },
      });

      // resources
      if (this.tick % 5 === 0) {
        u.fuel = Math.max(0, u.fuel - between(rand, 0.05, 0.35));
        u.battery = Math.max(0, u.battery - between(rand, 0.1, 0.5) * (u.kind === "uav" ? 2 : 1));
        out.push({
          type: "resource_level",
          severity: u.battery < 15 || u.fuel < 15 ? "high" : "low",
          entityId: u.id,
          payload: { fuel: Number(u.fuel.toFixed(1)), battery: Number(u.battery.toFixed(1)) },
        });
        if (u.battery < 12) {
          out.push({
            type: "alert_raise",
            severity: "critical",
            entityId: u.id,
            payload: {
              message: `${u.callsign} battery critical (${u.battery.toFixed(0)}%)`,
              alertId: `AL-${this.tick}-BAT-${u.id}`,
            },
          });
        }
      }

      // detections from UAVs
      if (u.kind === "uav" && rand() < 0.02) {
        out.push({
          type: "detection",
          severity: "medium",
          entityId: u.id,
          payload: {
            label: pick(rand, ["vehicle", "person", "uav", "structure"]),
            confidence: Number(between(rand, 0.45, 0.98).toFixed(2)),
            model: "yolov8n-doip-v1.4",
            lat: u.lat,
            lon: u.lon,
            frame: `F-${this.tick}-${u.id}`,
          },
        });
      }
    }

    // depot burn
    if (this.tick % 10 === 0) {
      for (const d of this.depots) {
        d.stock.fuel = Math.max(0, d.stock.fuel - Math.round(between(rand, 2, 14)));
        d.stock.medkit = Math.max(0, d.stock.medkit - (rand() < 0.3 ? 1 : 0));
        d.stock.rations = Math.max(0, d.stock.rations - Math.round(between(rand, 1, 5)));
        d.stock.battery = Math.max(0, d.stock.battery - (rand() < 0.5 ? 1 : 0));
        out.push({
          type: "resource_level",
          severity: d.stock.fuel < 600 ? "high" : "low",
          entityId: d.id,
          payload: { stock: { ...d.stock } },
        });
      }
    }

    // vitals
    if (this.tick % 8 === 0) {
      for (const p of this.personnel) {
        p.heartRate = Math.round(Math.min(180, Math.max(52, p.heartRate + between(rand, -5, 6))));
        p.fatigue = Number(Math.min(1, p.fatigue + between(rand, -0.004, 0.012)).toFixed(3));
        out.push({
          type: "vitals",
          severity: p.fatigue > 0.8 ? "high" : "low",
          entityId: p.id,
          payload: { heartRate: p.heartRate, fatigue: p.fatigue },
        });
      }
    }

    // incidents
    if (rand() < sc.incidentRate) {
      const u = pick(rand, this.units);
      const sev =
        SEVERITIES[Math.min(3, Math.floor(rand() * 4 + (sc.incidentRate > 0.1 ? 0.6 : 0)))]!;
      const id = `INC-${this.tick}`;
      out.push({
        type: "incident_open",
        severity: sev,
        entityId: id,
        payload: {
          kind: pick(rand, INCIDENT_KINDS),
          lat: u.lat + between(rand, -0.004, 0.004),
          lon: u.lon + between(rand, -0.004, 0.004),
          reportedBy: u.id,
          callsign: u.callsign,
        },
      });
      out.push({
        type: "alert_raise",
        severity: sev,
        entityId: id,
        payload: { message: `Incident ${id} reported by ${u.callsign}`, alertId: `AL-${id}` },
      });
    }

    this.emit(out);
  }
}

export const simSource = new MockSimSource();
