import { Link } from "@tanstack/react-router";
import { Bell, LogOut, Search } from "lucide-react";
import { formatSimClockZ, gridRef } from "@/lib/doip";
import { simStore, useSim } from "@/sim/store";
import { cn } from "@/lib/utils";

export function TopBar({
  onOpenPalette,
  onToggleAi,
  aiOpen,
}: {
  onOpenPalette: () => void;
  onToggleAi: () => void;
  aiOpen: boolean;
}) {
  const tick = useSim((s) => s.world.tick);
  const units = useSim((s) => s.world.units);
  const status = useSim((s) => s.status);
  const speed = useSim((s) => s.speed);
  const role = useSim((s) => s.role);
  const userName = useSim((s) => s.userName);
  const unacked = useSim((s) => Object.values(s.world.alerts).filter((a) => !a.acked).length);
  const critical = useSim(
    (s) => Object.values(s.world.alerts).filter((a) => !a.acked && a.severity === "critical").length,
  );

  const statusColor =
    status === "RUNNING"
      ? "text-success"
      : status === "PAUSED"
        ? "text-sev-medium"
        : status === "REPLAY"
          ? "text-primary"
          : "text-muted-foreground";

  const list = Object.values(units);
  const center = list.length
    ? {
        lat: list.reduce((a, u) => a + u.lat, 0) / list.length,
        lon: list.reduce((a, u) => a + u.lon, 0) / list.length,
      }
    : null;

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="text-muted-foreground">SIM</span>
        <span className="text-mono tabular-nums">{formatSimClockZ(tick)}</span>
      </div>
      <div className="hidden items-center gap-2 font-mono text-xs md:flex" title="Grid reference of map centre">
        <span className="text-muted-foreground">GRID</span>
        <span className="text-mono tabular-nums">{center ? gridRef(center.lat, center.lon) : "—— ———— ————"}</span>
      </div>
      <div className={cn("flex items-center gap-1.5 font-mono text-xs", statusColor)}>
        <span className={cn("size-1.5 rounded-full bg-current", status === "RUNNING" && "animate-pulse")} />
        {status}
      </div>
      <div className="hidden font-mono text-xs text-muted-foreground sm:block">
        TICK <span className="text-mono">{tick}</span> · {speed}x
      </div>

      <button
        onClick={onOpenPalette}
        className="ml-auto hidden items-center gap-2 border border-border bg-raised px-2 py-1 text-xs text-muted-foreground hover:text-foreground md:flex"
      >
        <Search className="size-3.5" />
        Command
        <kbd className=" border border-border px-1 font-mono text-[10px]">/</kbd>
      </button>

      <button
        onClick={onToggleAi}
        className={cn(
          "ml-auto flex items-center gap-1.5 border px-2 py-1 font-mono text-xs md:ml-0",
          aiOpen
            ? "border-ai/60 bg-raised text-ai"
            : "border-border bg-raised text-muted-foreground hover:text-foreground",
        )}
        title="Toggle AI drawer — sitreps, ask, what-if"
        aria-pressed={aiOpen}
      >
        ✦ AI
      </button>

      <Link
        to="/dashboard"
        className={cn(
          "flex items-center gap-1.5  border border-border px-2 py-1 font-mono text-xs",
          critical > 0 ? "text-sev-critical pulse-critical" : unacked > 0 ? "text-sev-medium" : "text-muted-foreground",
        )}
        title={`${unacked} unacknowledged alerts`}
      >
        <Bell className="size-3.5" />
        {unacked}
        <kbd className="border border-border px-1 text-[10px] text-muted-foreground">A</kbd>
        <span className="sr-only">unacknowledged alerts</span>
      </Link>

      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="text-muted-foreground">{userName || "—"}</span>
        <span className=" border border-border bg-raised px-1.5 py-0.5 uppercase tracking-wider text-primary">
          {role ?? "guest"}
        </span>
        <button
          onClick={() => simStore.logout()}
          className="text-muted-foreground hover:text-foreground"
          title="Sign out"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
    </header>
  );
}
