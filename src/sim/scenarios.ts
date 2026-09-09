export interface Scenario {
  id: string;
  name: string;
  description: string;
  incidentRate: number;
  weatherRate: number;
  uavCount: number;
  patrolCount: number;
  convoyCount: number;
  validation: "valid" | "warning";
}

export const SCENARIOS: Scenario[] = [
  {
    id: "SC-1",
    name: "Night Patrol Baseline",
    description: "Routine night patrol grid over the northern sectors. Low threat baseline.",
    incidentRate: 0.05,
    weatherRate: 0.02,
    uavCount: 4,
    patrolCount: 8,
    convoyCount: 3,
    validation: "valid",
  },
  {
    id: "SC-2",
    name: "Border Surveillance",
    description: "Extended perimeter watch with elevated sensor tasking and comms strain.",
    incidentRate: 0.09,
    weatherRate: 0.04,
    uavCount: 6,
    patrolCount: 7,
    convoyCount: 2,
    validation: "valid",
  },
  {
    id: "SC-3",
    name: "Counter-UAV Airspace Watch",
    description: "Dense hostile-UAV activity, high detection load, frequent critical alerts.",
    incidentRate: 0.14,
    weatherRate: 0.03,
    uavCount: 8,
    patrolCount: 5,
    convoyCount: 2,
    validation: "valid",
  },
  {
    id: "SC-4",
    name: "Convoy Escort",
    description: "Logistics convoy movement under escort with weather interference.",
    incidentRate: 0.1,
    weatherRate: 0.08,
    uavCount: 3,
    patrolCount: 6,
    convoyCount: 6,
    validation: "warning",
  },
];

export const getScenario = (id: string) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
