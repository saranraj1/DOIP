import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Panel, Mono, SeverityTag, EmptyState } from "@/components/doip/primitives";
import { useSim } from "@/sim/store";
import { formatSimClock } from "@/lib/doip";
import { SCENARIOS } from "@/sim/scenarios";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — DOIP" },
      {
        name: "description",
        content: "User roles, scenario catalogue, SOP corpus, equipment catalog and the immutable exercise audit log.",
      },
      { property: "og:title", content: "Admin — DOIP" },
      { property: "og:description", content: "Administrative control of roles, scenarios, corpus, catalog and audit history." },
    ],
  }),
  component: AdminScreen,
});

const USERS = [
  { name: "Col. A. Verma", role: "admin", unit: "HQ" },
  { name: "Maj. R. Sethi", role: "planner", unit: "Ops Cell" },
  { name: "Sgt. P. Kulkarni", role: "operator", unit: "Watch Floor" },
  { name: "Obs. L. Fernandes", role: "viewer", unit: "Evaluation" },
];

const ROLES = ["admin", "planner", "operator", "viewer"];

// Ch18 S15: demo corpus + equipment catalog metadata (Ch14). All synthetic.
const CORPUS = [
  { id: "SOP-011", kind: "SOP", title: "Convoy escort standard operating procedure", chunks: 142, embedded: 142 },
  { id: "SOP-024", kind: "SOP", title: "Medevac request and launch sequence", chunks: 96, embedded: 96 },
  { id: "REF-003", kind: "REF", title: "UAV loiter endurance reference tables", chunks: 58, embedded: 58 },
  { id: "POL-007", kind: "POL", title: "Rules for synthetic-exercise data handling", chunks: 31, embedded: 31 },
  { id: "REF-019", kind: "REF", title: "Sector grid & phase line annex (EX-DRISHTI)", chunks: 44, embedded: 27 },
];

const CATALOG = [
  { id: "EQ-01", item: "Light utility helicopter (medevac fit)", cost: "48.0 Cr", effects: "-38% medevac response p95", upkeep: "2.1 Cr/yr" },
  { id: "EQ-02", item: "Software-defined manpack radios (x120)", cost: "9.6 Cr", effects: "-71% comms-loss minutes", upkeep: "0.4 Cr/yr" },
  { id: "EQ-03", item: "Fixed-wing VTOL UAV (x4)", cost: "6.8 Cr", effects: "+22% surveillance coverage", upkeep: "0.7 Cr/yr" },
  { id: "EQ-04", item: "High-mobility fuel bowsers (x6)", cost: "4.2 Cr", effects: "-30% depot draw-down risk", upkeep: "0.3 Cr/yr" },
];

const TABS = ["USERS", "SCENARIOS", "CORPUS", "CATALOG", "AUDIT"] as const;
type Tab = (typeof TABS)[number];

function AdminScreen() {
  const role = useSim((s) => s.role);
  const events = useSim((s) => s.events);
  const runs = useSim((s) => s.runs);
  const [tab, setTab] = useState<Tab>("USERS");

  const audit = useMemo(
    () =>
      events
        .filter((e) => e.type === "alert_ack" || e.type === "system")
        .slice(-80)
        .reverse(),
    [events],
  );

  if (role !== "admin") {
    return (
      <div className="p-2">
        <EmptyState label="Administrator access required" hint="Sign in with the ADMIN demo role." />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest",
              tab === t ? "border-primary/60 bg-raised text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "USERS" && (
        <Panel title="Users & roles">
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="pb-1">Name</th>
                <th className="pb-1">Role</th>
                <th className="pb-1">Assignment</th>
              </tr>
            </thead>
            <tbody>
              {USERS.map((u) => (
                <tr key={u.name} className="border-t border-border/60">
                  <td className="py-1 text-foreground">{u.name}</td>
                  <td className="py-1">
                    <select
                      defaultValue={u.role}
                      aria-label={`Role for ${u.name}`}
                      className="border border-border bg-background px-1 py-0.5 font-mono text-[10px] uppercase text-primary"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 text-muted-foreground">{u.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
            Demo roster — role changes apply to the local session only.
          </p>
        </Panel>
      )}

      {tab === "SCENARIOS" && (
        <Panel title="Scenario catalogue" actions={<Mono className="text-[10px] text-muted-foreground">{SCENARIOS.length} SCENARIOS</Mono>}>
          <ul className="grid gap-2 lg:grid-cols-2">
            {SCENARIOS.map((s) => (
              <li key={s.id} className="border border-border p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">{s.name}</span>
                  <span
                    className={cn(
                      "ml-auto border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest",
                      s.validation === "valid" ? "border-success/50 text-success" : "border-sev-medium/60 text-sev-medium",
                    )}
                  >
                    {s.validation === "valid" ? "VALIDATION OK" : "VALIDATION WARN"}
                  </span>
                </div>
                <Mono className="text-[10px] text-muted-foreground">{s.id}</Mono>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.description}</p>
                <Mono className="mt-1 block text-[10px] text-muted-foreground">
                  {s.patrolCount} PATROLS · {s.uavCount} UAV · {s.convoyCount} CONVOYS · INCIDENT RATE {s.incidentRate}
                </Mono>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
            Scenario YAML editing and headless test runs arrive with the backend phase; validation reuses the same gate as
            human, LLM and red-team authors.
          </p>
        </Panel>
      )}

      {tab === "CORPUS" && (
        <Panel title="Doctrine corpus" actions={<Mono className="text-[10px] text-muted-foreground">{CORPUS.length} DOCUMENTS</Mono>}>
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="pb-1">Doc</th>
                <th className="pb-1">Kind</th>
                <th className="pb-1">Title</th>
                <th className="pb-1">Chunks</th>
                <th className="pb-1">Embedding</th>
              </tr>
            </thead>
            <tbody>
              {CORPUS.map((d) => {
                const pct = Math.round((d.embedded / d.chunks) * 100);
                return (
                  <tr key={d.id} className="border-t border-border/60">
                    <td className="py-1.5 text-foreground">{d.id}</td>
                    <td className="py-1.5 uppercase text-primary">{d.kind}</td>
                    <td className="py-1.5 text-muted-foreground">{d.title}</td>
                    <td className="py-1.5">{d.embedded}/{d.chunks}</td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 border border-border">
                          <div
                            className="h-full"
                            style={{ width: `${pct}%`, backgroundColor: pct === 100 ? "#F2F2F2" : "#FBBF24" }}
                          />
                        </div>
                        <span className={cn(pct === 100 ? "text-muted-foreground" : "text-sev-medium")}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
            Upload → chunk → embed pipeline lands with the RAG backend (Phase 3). Corpus grounds sitreps and the Ask tab.
          </p>
        </Panel>
      )}

      {tab === "CATALOG" && (
        <Panel title="Equipment catalog" actions={<Mono className="text-[10px] text-muted-foreground">{CATALOG.length} ITEMS</Mono>}>
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="pb-1">Id</th>
                <th className="pb-1">Item</th>
                <th className="pb-1">Cost</th>
                <th className="pb-1">Modelled effect</th>
                <th className="pb-1">Upkeep</th>
              </tr>
            </thead>
            <tbody>
              {CATALOG.map((c) => (
                <tr key={c.id} className="border-t border-border/60">
                  <td className="py-1.5 text-muted-foreground">{c.id}</td>
                  <td className="py-1.5 text-foreground">{c.item}</td>
                  <td className="py-1.5 text-primary">{c.cost}</td>
                  <td className="py-1.5 text-muted-foreground">{c.effects}</td>
                  <td className="py-1.5 text-muted-foreground">{c.upkeep}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
            Feeds the Preparedness Advisor (S13) portfolios. Effects are simulation-derived projections, not procurement
            guidance.
          </p>
        </Panel>
      )}

      {tab === "AUDIT" && (
        <div className="grid gap-2 xl:grid-cols-2">
          <Panel title="Run history">
            {runs.length === 0 ? (
              <EmptyState label="No completed runs" />
            ) : (
              <ul className="space-y-1 font-mono text-[11px]">
                {runs.map((r) => (
                  <li key={r.id} className="flex justify-between border-b border-border/60 py-1">
                    <span>{r.id}</span>
                    <span className="text-muted-foreground">
                      {r.scenarioId} · seed {r.seed} · {r.ticks} ticks · {r.events} events
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Audit log" bodyClassName="p-2">
            <ul className="max-h-80 overflow-y-auto">
              {audit.map((e) => (
                <li key={e.id} className="flex items-center gap-2 py-0.5 font-mono text-[10px]">
                  <span className="text-muted-foreground">{formatSimClock(e.tick)}</span>
                  <SeverityTag severity={e.severity} showLabel={false} />
                  <span className="text-foreground">{e.type}</span>
                  <span className="truncate text-muted-foreground">{e.entityId}</span>
                </li>
              ))}
              {!audit.length && <EmptyState label="No audit entries" />}
            </ul>
            <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
              Append-only: acknowledgements and system events, oldest evicted after 80 entries in this demo.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}
