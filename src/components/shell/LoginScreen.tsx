import { useState } from "react";
import { simStore } from "@/sim/store";
import type { Role } from "@/sim/types";
import { cn } from "@/lib/utils";
import {
  FlaskConical,
  History,
  Map as MapIcon,
  Route as RouteIcon,
  Sparkles,
  Users,
} from "lucide-react";

const ROLES: Array<{ role: Role; name: string; blurb: string }> = [
  { role: "admin", name: "Col. A. Verma", blurb: "Full access · users, audit log, scenarios" },
  { role: "planner", name: "Maj. R. Sethi", blurb: "Mission planning, run control, acknowledgements" },
  { role: "operator", name: "Sgt. P. Kulkarni", blurb: "Run control and alert acknowledgement" },
  { role: "viewer", name: "Obs. L. Fernandes", blurb: "Read-only across every screen" },
];

const INVARIANTS = [
  {
    k: "DETERMINISTIC",
    v: "Same scenario + same seed reproduces the same battle, event for event. Every claim is re-checkable.",
  },
  {
    k: "EVENTS ARE THE SPINE",
    v: "Every screen renders from one immutable event log. Nothing appears on the map that was not logged.",
  },
  {
    k: "AI AUTHORS, NEVER DECIDES",
    v: "AI drafts scenarios and reports behind an approve gate. Outcomes come only from the engine.",
  },
];

const CAPABILITIES = [
  {
    icon: MapIcon,
    code: "S3",
    name: "Live tactical map",
    blurb: "Every unit, incident, zone and weather cell on a satellite basemap, updated each tick.",
  },
  {
    icon: History,
    code: "S6",
    name: "Total replay",
    blurb: "Scrub any second of any recorded run and export the after-action record as data.",
  },
  {
    icon: Sparkles,
    code: "S7",
    name: "Grounded AI sitreps",
    blurb: "AI-written situation reports where every claim cites the exact events behind it.",
  },
  {
    icon: FlaskConical,
    code: "S8",
    name: "What-If Theater",
    blurb: "Describe a hypothetical, review the AI-drafted actions, approve, and watch the branch play out.",
  },
  {
    icon: RouteIcon,
    code: "S5",
    name: "Mission planning",
    blurb: "Waypoint routes with terrain, threat and weather cost breakdowns behind a feasibility gate.",
  },
  {
    icon: Users,
    code: "S14",
    name: "War-room",
    blurb: "Shared tactical picture with task board, decision log and per-sector scoping for staff.",
  },
];

export function LoginScreen() {
  const [selected, setSelected] = useState<Role>("operator");
  const chosen = ROLES.find((r) => r.role === selected)!;

  return (
    <div className="min-h-screen overflow-y-auto bg-background text-foreground">
      <div className="border-b border-border bg-surface px-4 py-1 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        Exercise environment — all data is synthetic
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 pt-8">
        <div className="font-mono text-xl font-bold tracking-[0.3em] text-foreground">DOIP</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Defense Operations Intelligence Platform · training build
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            See the whole battle.
            <br />
            <span className="text-muted-foreground">Rewind any second of it.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            DOIP is a command center for military training and simulation. A deterministic engine drives a
            synthetic battlespace — patrols, convoys, UAVs, weather, incidents — while AI handles the
            paperwork: situation reports with citations, scenario drafts behind an approve gate, and
            what-if branches you can watch play out. Because the world is an event log, every run can be
            replayed, compared and audited down to the tick.
          </p>

          <div className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-3">
            {INVARIANTS.map((i) => (
              <div key={i.k} className="bg-surface p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground">{i.k}</div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{i.v}</p>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              What's inside
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CAPABILITIES.map((c) => {
                const Icon = c.icon;
                return (
                  <div key={c.code} className="border border-border bg-surface p-3">
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">{c.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">{c.code}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.blurb}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-10 flex flex-wrap gap-px border border-border bg-border">
            {[
              { k: "15", v: "operational screens" },
              { k: "4", v: "access roles" },
              { k: "1", v: "immutable event log" },
              { k: "8×", v: "max sim speed" },
            ].map((s) => (
              <div key={s.v} className="min-w-[130px] flex-1 bg-surface px-3 py-2">
                <div className="font-mono text-lg text-foreground">{s.k}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        <aside className="self-start xl:sticky xl:top-6">
          <div className="border border-border bg-surface p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Enter the exercise · demo role
            </div>
            <ul className="mt-2 space-y-1.5">
              {ROLES.map((r) => (
                <li key={r.role}>
                  <button
                    onClick={() => setSelected(r.role)}
                    className={cn(
                      "w-full border px-3 py-2 text-left transition-colors",
                      selected === r.role
                        ? "border-primary/60 bg-raised"
                        : "border-border bg-background hover:bg-raised",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs uppercase tracking-widest text-primary">
                        {r.role}
                      </span>
                      <span className="font-mono text-[11px] text-mono">{r.name}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{r.blurb}</div>
                  </button>
                </li>
              ))}
            </ul>

            <button
              onClick={() => simStore.login(selected, chosen.name)}
              className="mt-4 w-full bg-primary px-3 py-2 font-mono text-xs uppercase tracking-[0.16em] text-primary-foreground transition-opacity hover:opacity-90"
            >
              Enter command center
            </button>
            <p className="mt-3 font-mono text-[10px] text-muted-foreground">
              Mock authentication. No credentials are transmitted or stored.
            </p>
          </div>
        </aside>
      </main>

      <footer className="border-t border-border px-4 py-4 text-center">
        <p className="text-[11px] text-muted-foreground">
          Training &amp; simulation platform. All data is synthetic. Not for operational military use.
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
          Basemap © OpenStreetMap contributors · Imagery © Esri &amp; partners · Labels © CARTO
        </p>
      </footer>
    </div>
  );
}
