import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SEVERITY_META } from "@/lib/doip";
import { useCountUp } from "@/hooks/useCountUp";
import type { Severity } from "@/sim/types";

// ---------------------------------------------------------------------------
// SeverityTag
// ---------------------------------------------------------------------------
export function SeverityTag({
  severity,
  className,
  showLabel = true,
  pulse,
}: {
  severity: Severity;
  className?: string;
  showLabel?: boolean;
  pulse?: boolean;
}) {
  const m = SEVERITY_META[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-wider",
        m.className,
        severity === "critical" && pulse && "pulse-critical",
        className,
      )}
      style={{ borderColor: `${m.color}55`, backgroundColor: `${m.color}14` }}
      title={m.label}
    >
      <span aria-hidden>{m.shape}</span>
      {showLabel && <span>{m.label}</span>}
      <span className="sr-only">severity {m.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  variant,
  float,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  variant?: "default" | "ai" | "critical";
  float?: boolean;
}) {
  return (
    <section
      className={cn(
        "doip-panel flex min-h-0 flex-col",
        float && "doip-float",
        variant === "ai" && "doip-ai-edge",
        variant === "critical" && "doip-critical-edge",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex h-6 items-center justify-between gap-2 border-b border-border bg-raised/30 px-2">
          <h2 className="doip-strip truncate">{title}</h2>
          {actions}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 p-2", bodyClassName)}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stat  —  §18.8: numeric values count-up on change; non-numeric renders as-is.
// ---------------------------------------------------------------------------
function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const animated = useCountUp(value, { decimals });
  // flash the key frame when value changes
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 420);
      return () => clearTimeout(t);
    }
  }, [value]);
  return (
    <span key={flash ? "flash" : "still"}
          className={flash ? "doip-count-flash inline-block" : "inline-block"}>
      {decimals > 0 ? animated.toFixed(decimals) : Math.round(animated)}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="doip-panel p-2">
      <div className="doip-strip">{label}</div>
      <div className="doip-key mt-1" style={accent ? { color: accent } : undefined}>
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
export function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-16 flex-col items-start justify-center gap-1 border border-dashed border-border p-2 text-left">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoadingState  —  §18.8: skeleton shimmer instead of a bare spinner.
// ---------------------------------------------------------------------------
export function LoadingState({ label = "Awaiting telemetry", rows = 3 }: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-2 p-1" aria-busy aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="doip-shimmer h-6 w-full"
          style={{ width: `${65 + (i % 3) * 12}%` }}
        />
      ))}
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnimatedFeedItem  —  §18.8: new event rows slide in from below.
// Use as a wrapper around <li> / any event row.
// ---------------------------------------------------------------------------
export function AnimatedFeedItem({
  id,
  children,
  className,
}: {
  id: string | number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div key={id} className={cn("doip-slide-in-up", className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mono
// ---------------------------------------------------------------------------
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-mono", className)}>{children}</span>;
}

// ---------------------------------------------------------------------------
// AiBadge
// ---------------------------------------------------------------------------
export function AiBadge({ label = "AI GENERATED" }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-ai"
      style={{ borderColor: "#a78bfa55", backgroundColor: "#a78bfa14" }}
    >
      ✦ {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatStrip  —  horizontal KPI strip; numeric values auto-animate.
// ---------------------------------------------------------------------------
export function StatStrip({
  items,
  className,
}: {
  items: Array<{ label: string; value: React.ReactNode; accent?: string; sub?: React.ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cn("doip-panel flex flex-wrap items-stretch", className)}>
      {items.map((it) => (
        <div
          key={it.label}
          className="flex min-w-[120px] flex-1 items-baseline gap-2 border-r border-border px-2 py-1 last:border-r-0"
        >
          <span className="doip-strip whitespace-nowrap">{it.label}</span>
          <span className="doip-key ml-auto" style={it.accent ? { color: it.accent } : undefined}>
            {typeof it.value === "number" ? <AnimatedNumber value={it.value} /> : it.value}
          </span>
          {it.sub && <span className="text-[11px] text-muted-foreground">{it.sub}</span>}
        </div>
      ))}
    </div>
  );
}
