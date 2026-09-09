// §18.8 — keyboard shortcut reference sheet, toggled with the `?` key.
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

const SHORTCUTS: Array<{ key: string; label: string; scope?: string }> = [
  { key: "Space",  label: "Pause / Resume run",      scope: "planner+" },
  { key: "F",      label: "Toggle follow-mode on map" },
  { key: "E",      label: "Focus event feed" },
  { key: "1",      label: "Toggle Units layer",        scope: "S3 map" },
  { key: "2",      label: "Toggle Incidents layer",    scope: "S3 map" },
  { key: "3",      label: "Toggle Weather layer",      scope: "S3 map" },
  { key: "4",      label: "Toggle Zones layer",        scope: "S3 map" },
  { key: "?",      label: "Show / hide this sheet" },
];

export function ShortcutSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="doip-fade-in fixed inset-0 z-[900] flex items-center justify-center bg-black/70"
      onClick={onClose}
      aria-modal
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="doip-panel doip-slide-in-up w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <ul className="mt-3 space-y-1">
          {SHORTCUTS.map(({ key, label, scope }) => (
            <li key={key} className="flex items-center gap-3">
              <kbd
                className={cn(
                  "min-w-[2rem] border border-border bg-raised px-1.5 py-0.5",
                  "text-center font-mono text-[11px] text-primary",
                )}
              >
                {key}
              </kbd>
              <span className="flex-1 font-mono text-[11px] text-muted-foreground">
                {label}
              </span>
              {scope && (
                <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
                  {scope}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
          Shortcuts are disabled when an input field is focused.
        </p>
      </div>
    </div>
  );
}
