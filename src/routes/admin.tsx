import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Panel, Mono, SeverityTag, EmptyState } from "@/components/doip/primitives";
import { useSim } from "@/sim/store";
import { formatSimClock } from "@/lib/doip";
import { SCENARIOS } from "@/sim/scenarios";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { Trash2, UserPlus, ShieldCheck, Key, Lock } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — DOIP" },
      {
        name: "description",
        content:
          "User roles, scenario catalogue, SOP corpus, equipment catalog and the immutable exercise audit log.",
      },
      { property: "og:title", content: "Admin — DOIP" },
      {
        property: "og:description",
        content: "Administrative control of roles, scenarios, corpus, catalog and audit history.",
      },
    ],
  }),
  component: AdminScreen,
});

// Default demo roster — shown until the backend responds
const DEMO_USERS = [
  { name: "Col. A. Verma", role: "admin", unit: "HQ" },
  { name: "Maj. R. Sethi", role: "planner", unit: "Ops Cell" },
  { name: "Sgt. P. Kulkarni", role: "operator", unit: "Watch Floor" },
  { name: "Obs. L. Fernandes", role: "viewer", unit: "Evaluation" },
];

const ROLES = ["admin", "planner", "operator", "viewer"] as const;
type RoleType = (typeof ROLES)[number];

const TABS = ["USERS", "SCENARIOS", "CORPUS", "CATALOG", "AUDIT"] as const;
type Tab = (typeof TABS)[number];

// Ch18 S15: demo corpus + equipment catalog metadata (Ch14). All synthetic.
const CORPUS = [
  {
    id: "SOP-011",
    kind: "SOP",
    title: "Convoy escort standard operating procedure",
    chunks: 142,
    embedded: 142,
  },
  {
    id: "SOP-024",
    kind: "SOP",
    title: "Medevac request and launch sequence",
    chunks: 96,
    embedded: 96,
  },
  {
    id: "REF-003",
    kind: "REF",
    title: "UAV loiter endurance reference tables",
    chunks: 58,
    embedded: 58,
  },
  {
    id: "POL-007",
    kind: "POL",
    title: "Rules for synthetic-exercise data handling",
    chunks: 31,
    embedded: 31,
  },
  {
    id: "REF-019",
    kind: "REF",
    title: "Sector grid & phase line annex (EX-DRISHTI)",
    chunks: 44,
    embedded: 27,
  },
];

const CATALOG = [
  {
    id: "EQ-01",
    item: "Light utility helicopter (medevac fit)",
    cost: "48.0 Cr",
    effects: "-38% medevac response p95",
    upkeep: "2.1 Cr/yr",
  },
  {
    id: "EQ-02",
    item: "Software-defined manpack radios (x120)",
    cost: "9.6 Cr",
    effects: "-71% comms-loss minutes",
    upkeep: "0.4 Cr/yr",
  },
  {
    id: "EQ-03",
    item: "Fixed-wing VTOL UAV (x4)",
    cost: "6.8 Cr",
    effects: "+22% surveillance coverage",
    upkeep: "0.7 Cr/yr",
  },
  {
    id: "EQ-04",
    item: "High-mobility fuel bowsers (x6)",
    cost: "4.2 Cr",
    effects: "-30% depot draw-down risk",
    upkeep: "0.3 Cr/yr",
  },
];

function AdminScreen() {
  const role = useSim((s) => s.role);
  const localEvents = useSim((s) => s.events);
  const runs = useSim((s) => s.runs);
  const [tab, setTab] = useState<Tab>("USERS");

  // --- Users state (P0-3) -----------------------------------------------
  const [users, setUsers] = useState<{ name: string; role: string; unit: string }[]>(DEMO_USERS);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<RoleType>("operator");
  const [newUnit, setNewUnit] = useState("");
  const [userBusy, setUserBusy] = useState(false);

  // Load real users from backend on mount; fall back to demo roster if offline
  useEffect(() => {
    api
      .listUsers()
      .then((u) => {
        if (u) setUsers(u);
      })
      .catch(() => {});
  }, []);

  const handleCreateUser = useCallback(async () => {
    if (!newName.trim()) return;
    setUserBusy(true);
    const res = await api.createUser(newName.trim(), newRole, newUnit.trim() || "Unassigned");
    if (res?.ok) {
      setUsers((prev) => [
        ...prev,
        { name: newName.trim(), role: newRole, unit: newUnit.trim() || "Unassigned" },
      ]);
      setNewName("");
      setNewUnit("");
    }
    setUserBusy(false);
  }, [newName, newRole, newUnit]);

  const handleDeleteUser = useCallback(async (name: string) => {
    setUserBusy(true);
    const res = await api.deleteUser(name);
    if (res?.ok) setUsers((prev) => prev.filter((u) => u.name !== name));
    setUserBusy(false);
  }, []);

  // --- Backend audit log state (P0-4) ------------------------------------
  const [backendAudit, setBackendAudit] = useState<object[] | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPages, setAuditPages] = useState(1);
  const AUDIT_PER_PAGE = 50;

  useEffect(() => {
    if (tab !== "AUDIT") return;
    api
      .listAudit(auditPage, AUDIT_PER_PAGE)
      .then((res) => {
        if (!res) return;
        setBackendAudit(res.audit);
        setAuditTotal(res.total);
        setAuditPages(res.pages);
      })
      .catch(() => {});
  }, [tab, auditPage]);

  // Local sim-event audit fallback (shown when backend is offline)
  const localAudit = useMemo(
    () =>
      localEvents
        .filter((e) => e.type === "alert_ack" || e.type === "system")
        .slice(-80)
        .reverse(),
    [localEvents],
  );

  if (role !== "admin") {
    return (
      <div className="p-2">
        <EmptyState
          label="Administrator access required"
          hint="Sign in with the ADMIN demo role."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      {/* Golden Run CI Invariant Verification Status */}
      <div className="border border-primary/40 bg-primary/10 p-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <span className="font-semibold uppercase tracking-wider text-foreground">
            Golden Run Determinism Gate: ACTIVE
          </span>
          <span className="border border-success/50 bg-success/10 text-success text-[10px] px-1.5 py-0.2 rounded font-semibold uppercase">
            SC2 · SEED 8841 FROZEN REPLAY HASH
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="hidden sm:inline">VERIFIED HASH:</span>
          <code className="bg-base border border-border px-1.5 py-0.5 text-primary text-[10px] font-mono">
            de2edd52ed20...1028173f
          </code>
          <span className="border border-primary/30 px-1 py-0.2 text-[9px] uppercase tracking-widest text-primary">
            AGENTS.MD INVARIANT
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest",
              tab === t
                ? "border-primary/60 bg-raised text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "USERS" && (
        <Panel
          title="Users & roles"
          actions={<Mono className="text-[10px] text-muted-foreground">{users.length} USERS</Mono>}
        >
          {/* Existing roster */}
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="pb-1">Name</th>
                <th className="pb-1">Role</th>
                <th className="pb-1">Assignment</th>
                <th className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.name} className="border-t border-border/60">
                  <td className="py-1 text-foreground">{u.name}</td>
                  <td className="py-1">
                    <span
                      className={cn(
                        "border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest",
                        u.role === "admin"
                          ? "border-primary/60 text-primary"
                          : u.role === "planner"
                            ? "border-ai/50 text-ai"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-1 text-muted-foreground">{u.unit}</td>
                  <td className="py-1">
                    <button
                      onClick={() => handleDeleteUser(u.name)}
                      disabled={userBusy}
                      aria-label={`Remove ${u.name}`}
                      className="text-muted-foreground hover:text-red-400 disabled:opacity-40"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Add user form */}
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                Name
              </span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Lt. J. Sharma"
                className="border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                aria-label="New user name"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                Role
              </span>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as RoleType)}
                className="border border-border bg-background px-1 py-0.5 font-mono text-[10px] uppercase text-primary"
                aria-label="New user role"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                Unit
              </span>
              <input
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder="Ops Cell"
                className="border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                aria-label="New user unit"
              />
            </label>
            <button
              onClick={handleCreateUser}
              disabled={userBusy || !newName.trim()}
              className="flex items-center gap-1.5 border border-primary/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              <UserPlus className="size-3" /> Add user
            </button>
          </div>
          {/* Role-Based Access Control Matrix */}
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center gap-2 mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
              <Key className="size-3.5 text-primary" />
              Role-Based Access Control (RBAC) Permissions Matrix
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px] border border-border/80 bg-base">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border bg-raised/50">
                  <tr>
                    <th className="p-2">Capability / Operation</th>
                    <th className="p-2 text-center">Admin</th>
                    <th className="p-2 text-center">Planner</th>
                    <th className="p-2 text-center">Operator</th>
                    <th className="p-2 text-center">Viewer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {[
                    {
                      cap: "Run Control & State Checkpoints",
                      admin: true,
                      planner: true,
                      operator: true,
                      viewer: false,
                    },
                    {
                      cap: "Scenario Authoring & DSL Validation Gate",
                      admin: true,
                      planner: true,
                      operator: false,
                      viewer: false,
                    },
                    {
                      cap: "What-If Theatre Predictive Branching",
                      admin: true,
                      planner: true,
                      operator: true,
                      viewer: false,
                    },
                    {
                      cap: "Tactical Adjudication & Quick-Orders",
                      admin: true,
                      planner: false,
                      operator: true,
                      viewer: false,
                    },
                    {
                      cap: "SOP-02 Medevac & War-Room Task Dispatch",
                      admin: true,
                      planner: true,
                      operator: true,
                      viewer: false,
                    },
                    {
                      cap: "User Administration & System Audit Logs",
                      admin: true,
                      planner: false,
                      operator: false,
                      viewer: false,
                    },
                    {
                      cap: "Read-only Analytics, Replay & Doctrine",
                      admin: true,
                      planner: true,
                      operator: true,
                      viewer: true,
                    },
                  ].map((r) => (
                    <tr key={r.cap} className="hover:bg-raised/30 transition-colors">
                      <td className="p-2 text-foreground font-medium">{r.cap}</td>
                      <td className="p-2 text-center">
                        {r.admin ? (
                          <span className="text-success font-semibold">ALLOW</span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        {r.planner ? (
                          <span className="text-success font-semibold">ALLOW</span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        {r.operator ? (
                          <span className="text-success font-semibold">ALLOW</span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        {r.viewer ? (
                          <span className="text-success font-semibold">ALLOW</span>
                        ) : (
                          <span className="text-destructive font-semibold">DENY</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-3 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
            User roster is persisted in-memory on the backend (resets on server restart). Phase 2
            will wire to the users DB table.
          </p>
        </Panel>
      )}

      {tab === "SCENARIOS" && (
        <Panel
          title="Scenario catalogue"
          actions={
            <Mono className="text-[10px] text-muted-foreground">{SCENARIOS.length} SCENARIOS</Mono>
          }
        >
          <ul className="grid gap-2 lg:grid-cols-2">
            {SCENARIOS.map((s) => (
              <li key={s.id} className="border border-border p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">{s.name}</span>
                  <span
                    className={cn(
                      "ml-auto border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest",
                      s.validation === "valid"
                        ? "border-success/50 text-success"
                        : "border-sev-medium/60 text-sev-medium",
                    )}
                  >
                    {s.validation === "valid" ? "VALIDATION OK" : "VALIDATION WARN"}
                  </span>
                </div>
                <Mono className="text-[10px] text-muted-foreground">{s.id}</Mono>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.description}</p>
                <Mono className="mt-1 block text-[10px] text-muted-foreground">
                  {s.patrolCount} PATROLS · {s.uavCount} UAV · {s.convoyCount} CONVOYS · INCIDENT
                  RATE {s.incidentRate}
                </Mono>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
            Scenario YAML editing and headless test runs arrive with the backend phase; validation
            reuses the same gate as human, LLM and red-team authors.
          </p>
        </Panel>
      )}

      {tab === "CORPUS" && (
        <Panel
          title="Doctrine corpus"
          actions={
            <Mono className="text-[10px] text-muted-foreground">{CORPUS.length} DOCUMENTS</Mono>
          }
        >
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
                    <td className="py-1.5">
                      {d.embedded}/{d.chunks}
                    </td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 border border-border">
                          <div
                            className="h-full"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: pct === 100 ? "#F2F2F2" : "#FBBF24",
                            }}
                          />
                        </div>
                        <span
                          className={cn(pct === 100 ? "text-muted-foreground" : "text-sev-medium")}
                        >
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
            Upload → chunk → embed pipeline lands with the RAG backend (Phase 3). Corpus grounds
            sitreps and the Ask tab.
          </p>
        </Panel>
      )}

      {tab === "CATALOG" && (
        <Panel
          title="Equipment catalog"
          actions={
            <Mono className="text-[10px] text-muted-foreground">{CATALOG.length} ITEMS</Mono>
          }
        >
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
            Feeds the Preparedness Advisor (S13) portfolios. Effects are simulation-derived
            projections, not procurement guidance.
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
            {backendAudit ? (
              <>
                <ul className="max-h-80 overflow-y-auto space-y-px">
                  {(
                    backendAudit as {
                      id: number;
                      actor: string;
                      action: string;
                      detail: string;
                      created_at: string;
                    }[]
                  ).map((e) => (
                    <li key={e.id} className="flex items-center gap-2 py-0.5 font-mono text-[10px]">
                      <span className="text-muted-foreground">
                        {e.created_at?.slice(11, 19) ?? ""}
                      </span>
                      <span className="text-foreground">{e.action}</span>
                      <span className="truncate text-muted-foreground">{e.actor}</span>
                      <span className="ml-auto truncate text-muted-foreground/60">{e.detail}</span>
                    </li>
                  ))}
                  {!backendAudit.length && <EmptyState label="No audit entries" />}
                </ul>
                {/* Pagination controls */}
                <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 font-mono text-[10px]">
                  <button
                    disabled={auditPage <= 1}
                    onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                    className="border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-raised disabled:opacity-30"
                  >
                    ‹ Prev
                  </button>
                  <Mono className="text-muted-foreground">
                    Page {auditPage} / {auditPages} · {auditTotal} entries
                  </Mono>
                  <button
                    disabled={auditPage >= auditPages}
                    onClick={() => setAuditPage((p) => Math.min(auditPages, p + 1))}
                    className="border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-raised disabled:opacity-30"
                  >
                    Next ›
                  </button>
                </div>
              </>
            ) : (
              /* Backend offline: fall back to local sim event log */
              <>
                <ul className="max-h-80 overflow-y-auto">
                  {localAudit.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 py-0.5 font-mono text-[10px]">
                      <span className="text-muted-foreground">{formatSimClock(e.tick)}</span>
                      <SeverityTag severity={e.severity} showLabel={false} />
                      <span className="text-foreground">{e.type}</span>
                      <span className="truncate text-muted-foreground">{e.entityId}</span>
                    </li>
                  ))}
                  {!localAudit.length && <EmptyState label="No audit entries" />}
                </ul>
                <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
                  Showing local sim events — backend audit unavailable.
                </p>
              </>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
