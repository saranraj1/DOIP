import { useEffect, useState, type ReactNode } from "react";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { LoginScreen } from "./LoginScreen";
import { AiDrawer } from "./AiDrawer";
import { DisconnectBanner } from "@/components/doip/DisconnectBanner";
import { ShortcutSheet } from "@/components/doip/ShortcutSheet";
import { simStore, useSim } from "@/sim/store";
import { useKeyboard } from "@/hooks/useKeyboard";

export function AppShell({ children }: { children: ReactNode }) {
  const role = useSim((s) => s.role);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Emit custom events so deeply nested route components can react
  // without prop drilling (follow-mode on S3 map, feed focus on any screen).
  const emitFollow = () =>
    window.dispatchEvent(new CustomEvent("doip:follow-toggle"));
  const emitFocusFeed = () =>
    window.dispatchEvent(new CustomEvent("doip:focus-feed"));

  // §18.8 global keyboard shortcuts.
  useKeyboard({
    " ": () => {
      if (role === "analyst") return;
      const s = simStore.getState();
      if (s.status === "RUNNING") simStore.pause();
      else if (s.status === "PAUSED") simStore.resume();
    },
    F: emitFollow,
    f: emitFollow,
    E: emitFocusFeed,
    e: emitFocusFeed,
    "?": () => setShortcutsOpen((o) => !o),
  });

  useEffect(() => {
    simStore.hydrateSession();
  }, []);

  if (!role) return <LoginScreen />;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <SideNav collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="doip-exercise-banner shrink-0" aria-hidden>
          {Array.from({ length: 24 }).map((_, i) => (
            <span key={i} className="px-2">EXERCISE — SYNTHETIC DATA</span>
          ))}
        </div>
        {/* §18.8 disconnect banner */}
        <DisconnectBanner />
        <TopBar
          onOpenPalette={() => setPaletteOpen(true)}
          onToggleAi={() => setAiOpen((o) => !o)}
          aiOpen={aiOpen}
        />
        <div className="flex min-h-0 flex-1">
          <main className="doip-ground min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
          {aiOpen && <AiDrawer onClose={() => setAiOpen(false)} />}
        </div>
        <footer className="shrink-0 border-t border-border bg-surface px-2 py-1.5 text-[10px] text-muted-foreground">
          Training &amp; simulation platform. All data is synthetic. Not for operational military use.
        </footer>
      </div>
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
      {/* §18.8 shortcut sheet — toggled with ? key */}
      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
