// §18.8 — disconnect / stale-data banner.
// Shown when a run was active and the engine goes IDLE or STOPPED unexpectedly,
// or when the WS source drops mid-run. Matches the §18.5 shell layout spec:
// amber-pulsing status dot + banner "Reconnecting — you may be seeing stale data".
import { useSim } from "@/sim/store";
import { cn } from "@/lib/utils";

export function DisconnectBanner() {
  const status = useSim((s) => s.status);
  // Only show during STOPPED — not during normal IDLE (before first run).
  const show = status === "STOPPED";

  return (
    <div
      aria-live="assertive"
      className={cn(
        "overflow-hidden transition-all duration-300",
        show ? "max-h-8" : "max-h-0",
      )}
    >
      {show && (
        <div className="flex items-center gap-2 bg-sev-medium/10 px-3 py-1 font-mono text-[10px] text-sev-medium">
          <span className="size-1.5 animate-pulse rounded-full bg-sev-medium" aria-hidden />
          Run stopped — event log is frozen. Start a new run from Run Control.
        </div>
      )}
    </div>
  );
}
