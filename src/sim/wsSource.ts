// WsSimSource — SimSource implementation backed by the MVP backend WebSocket.
// Implements the exact same SimSource interface as MockSimSource, so simStore
// needs zero changes when swapping between local and server engines.
//
// Auth (P0-1): appends the stored JWT as ?token= so the backend WS auth gate
// can verify the connection before accepting it.
//
// Fail-soft contract (§18.8 disconnect pattern, P0-2):
//   - Connection attempts time out in 2 s; on failure the store falls back to
//     the local MockSimSource automatically via switchToLocal().
//   - A Sonner toast is shown so operators know which engine is active.
//   - If the socket drops mid-run, the store reverts to the local engine and
//     continues from where it left off using the last known world state.
import { toast } from "sonner";
import type { SimEvent, SimSource } from "./types";
import { wsUrl } from "@/lib/api";

type Listener = (events: SimEvent[]) => void;

const WS_CONNECT_TIMEOUT_MS = 2000;

export class WsSimSource implements SimSource {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private runId = "";
  private _connected = false;
  private _onFail: (() => void) | null = null;

  /** onFail is called if the backend is unreachable on start(). */
  setOnFail(cb: () => void) {
    this._onFail = cb;
  }

  subscribe(cb: Listener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start({ seed, scenarioId }: { seed: number; scenarioId: string }): void {
    this.runId = `run-${seed}-${scenarioId}-${Date.now()}`;
    // Append the stored JWT so the backend WS auth gate can verify the request.
    const storedToken =
      typeof window !== "undefined" ? (window.localStorage.getItem("doip.token") ?? "") : "";
    const url =
      wsUrl(`/ws/sim/${encodeURIComponent(this.runId)}`) +
      `?token=${encodeURIComponent(storedToken)}&seed=${seed}&scenarioId=${encodeURIComponent(scenarioId)}&speed=1`;

    // timeout guard: if WS doesn’t open within 2 s, fall back with a toast
    const timer = setTimeout(() => {
      if (!this._connected) {
        this.ws?.close();
        toast.warning("Backend unreachable — running local simulation", {
          description:
            "Events are generated client-side. Connect the backend to stream from the server engine.",
          duration: 6000,
        });
        this._onFail?.();
      }
    }, WS_CONNECT_TIMEOUT_MS);

    try {
      this.ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      this._onFail?.();
      return;
    }

    this.ws.onopen = () => {
      clearTimeout(timer);
      this._connected = true;
    };

    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as
          { type: "events"; events: SimEvent[] } | { type: "log_replay"; events: SimEvent[] };
        if (data.events?.length) {
          this.listeners.forEach((l) => l(data.events));
        }
      } catch {
        // malformed frame — ignore
      }
    };

    this.ws.onerror = () => {
      clearTimeout(timer);
      if (!this._connected) this._onFail?.();
    };

    this.ws.onclose = () => {
      this._connected = false;
    };
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  pause() {
    this.send({ cmd: "pause" });
  }
  resume() {
    this.send({ cmd: "resume" });
  }
  stop() {
    this.send({ cmd: "stop" });
    this.ws?.close();
  }
  setSpeed(speed: number) {
    this.send({ cmd: "speed", value: speed });
  }
  inject(events: Omit<SimEvent, "id" | "tick" | "simTime">[]) {
    for (const e of events) this.send({ cmd: "inject", event: e });
  }

  get connected() {
    return this._connected;
  }
}
