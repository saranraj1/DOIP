// Ch18 S11/S14: shared war-room task store. Personnel Health (S11) creates
// rotation tasks that appear on the War-Room (S14) task board.
// When the MVP backend is running, the board syncs live across browsers over
// WS /ws/warroom; offline it behaves exactly as a local store.
import { useSyncExternalStore } from "react";
import { wsUrl } from "@/lib/api";

export type TaskStatus = "open" | "doing" | "done";

export interface WarTask {
  id: number;
  text: string;
  assignee: string;
  sector: string;
  status: TaskStatus;
  tick: number;
}

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = { open: "doing", doing: "done", done: "open" };

let tasks: WarTask[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

// --- optional backend sync (fail-soft) -------------------------------------
// The server broadcasts operations to every client EXCEPT the sender, so
// local ops are applied once locally and once remotely everywhere else.
let ws: WebSocket | null = null;
let wsTried = false;

type WireOp =
  | { type: "snapshot"; tasks: WarTask[] }
  | { type: "add"; task: WarTask }
  | { type: "advance"; id: number };

function ensureSocket() {
  if (wsTried || typeof window === "undefined") return;
  wsTried = true;
  try {
    ws = new WebSocket(wsUrl("/ws/warroom"));
    ws.onmessage = (msg) => {
      try {
        const op = JSON.parse(String(msg.data)) as WireOp;
        if (op.type === "snapshot") {
          if (op.tasks.length) tasks = op.tasks;
          nextId = Math.max(nextId, ...op.tasks.map((t) => t.id), 0);
        } else if (op.type === "add") {
          if (!tasks.some((t) => t.id === op.task.id)) tasks = [...tasks, op.task];
          nextId = Math.max(nextId, op.task.id);
        } else if (op.type === "advance") {
          tasks = tasks.map((t) => (t.id === op.id ? { ...t, status: NEXT_STATUS[t.status] } : t));
        }
        emit();
      } catch {
        /* malformed frame — ignore */
      }
    };
    ws.onerror = () => {
      ws = null; // backend absent — stay local
    };
    ws.onclose = () => {
      ws = null;
    };
  } catch {
    ws = null;
  }
}

const send = (op: WireOp) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(op));
};

export const taskStore = {
  add(input: Omit<WarTask, "id" | "status">): WarTask {
    const task: WarTask = { ...input, id: ++nextId, status: "open" };
    tasks = [...tasks, task];
    emit();
    send({ type: "add", task });
    return task;
  },
  advance(id: number) {
    tasks = tasks.map((t) => (t.id === id ? { ...t, status: NEXT_STATUS[t.status] } : t));
    emit();
    send({ type: "advance", id });
  },
  subscribe(listener: () => void) {
    ensureSocket();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useTasks(): WarTask[] {
  return useSyncExternalStore(taskStore.subscribe, () => tasks, () => tasks);
}
