import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { NAV_ITEMS } from "./SideNav";
import { simStore, useSim } from "@/sim/store";
import { canOperate } from "@/lib/doip";
import { toast } from "sonner";

export function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const navigate = useNavigate();
  const role = useSim((s) => s.role);
  const userName = useSim((s) => s.userName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const go = (to: string) => {
    setOpen(false);
    void navigate({ to });
  };

  const act = (label: string, fn: () => void, needsOperator = true) => {
    setOpen(false);
    if (needsOperator && !canOperate(role)) {
      toast.error("Read-only role", { description: `${label} requires operator access or above.` });
      return;
    }
    fn();
    toast.success(label);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a screen or run a command…" />
      <CommandList>
        <CommandEmpty>No matching command.</CommandEmpty>
        <CommandGroup heading="Screens">
          {NAV_ITEMS.filter((i) => !i.adminOnly || role === "admin").map((i) => (
            <CommandItem key={i.to} value={`${i.label} ${i.code}`} onSelect={() => go(i.to)}>
              <i.icon className="size-4" />
              <span>{i.label}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{i.code}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Run control">
          <CommandItem value="pause run" onSelect={() => act("Run paused", () => simStore.pause())}>
            Pause run
          </CommandItem>
          <CommandItem value="resume run" onSelect={() => act("Run resumed", () => simStore.resume())}>
            Resume run
          </CommandItem>
          <CommandItem value="stop run" onSelect={() => act("Run stopped", () => simStore.stop())}>
            Stop run
          </CommandItem>
          <CommandItem
            value="acknowledge all alerts"
            onSelect={() =>
              act("All alerts acknowledged", () => {
                const st = simStore.getState();
                Object.values(st.world.alerts)
                  .filter((a) => !a.acked)
                  .forEach((a) => simStore.ackAlert(a.id, userName || "operator"));
              })
            }
          >
            Acknowledge all alerts
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
