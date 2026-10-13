import { useSim } from "@/sim/store";
import { cn } from "@/lib/utils";

export function DisconnectBanner() {
  const status = useSim((s) => s.status);
  const show = status === "STOPPED";

  return (
    <div
      aria-live="assertive"
      className={cn("overflow-hidden transition-all duration-300", show ? "max-h-8" : "max-h-0")}
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
