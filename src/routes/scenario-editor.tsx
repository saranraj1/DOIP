import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { EmptyState, Panel, Mono, AiBadge, SeverityTag } from "@/components/doip/primitives";
import { useSim } from "@/sim/store";
import { canOperate } from "@/lib/doip";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pencil,
  Play,
  Plus,
  Save,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  X,
  Clock,
  Zap,
  FlaskConical,
} from "lucide-react";

export const Route = createFileRoute("/scenario-editor")({
  head: () => ({
    meta: [
      { title: "Scenario Editor — DOIP" },
      {
        name: "description",
        content: "Visual DSL editor for authoring custom training scenarios.",
      },
      { property: "og:title", content: "Scenario Editor — DOIP" },
    ],
  }),
  component: ScenarioEditorScreen,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type DslVerb = "spawn_weather" | "create_incident" | "raise_alert" | "modify_speed";

const VERBS: { value: DslVerb; label: string; color: string; description: string }[] = [
  {
    value: "spawn_weather",
    label: "Spawn Weather",
    color: "text-blue-400",
    description: "Introduce a weather cell at a given intensity",
  },
  {
    value: "create_incident",
    label: "Create Incident",
    color: "text-red-400",
    description: "Open a synthetic tactical incident",
  },
  {
    value: "raise_alert",
    label: "Raise Alert",
    color: "text-yellow-400",
    description: "Trigger an alert on target elements",
  },
  {
    value: "modify_speed",
    label: "Modify Speed",
    color: "text-green-400",
    description: "Change movement speed of target units",
  },
];

interface DslAction {
  id: number;
  verb: DslVerb;
  target: string;
  magnitude: number;
  tick: number;
  rationale: string;
}

interface ValidationResult {
  id: number;
  verb: string;
  valid: boolean;
  error: string | null;
}

interface SavedScenario {
  id: number;
  scenarioId: string;
  name: string;
  description: string;
  config: Record<string, number>;
  actions: DslAction[];
  status: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let _nextId = 1;
const newId = () => _nextId++;

function makeAction(verb: DslVerb = "spawn_weather"): DslAction {
  return { id: newId(), verb, target: "", magnitude: 50, tick: 0, rationale: "" };
}

const VERB_META: Record<DslVerb, { targets: string[]; magnitudeLabel: string }> = {
  spawn_weather: {
    targets: ["northern sector", "southern sector", "area of operations", "patrol zone"],
    magnitudeLabel: "Intensity (0-100)",
  },
  create_incident: {
    targets: ["patrol units", "convoy units", "UAV element", "forward depot"],
    magnitudeLabel: "Severity weight (0-100)",
  },
  raise_alert: {
    targets: ["all stations", "patrol echelon", "logistics net", "UAV element"],
    magnitudeLabel: "Alert priority (0-100)",
  },
  modify_speed: {
    targets: ["patrol units", "convoy units", "all units"],
    magnitudeLabel: "Speed modifier %",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function VerbPill({ verb }: { verb: DslVerb }) {
  const meta = VERBS.find((v) => v.value === verb);
  return (
    <span className={cn("font-mono text-[10px] uppercase tracking-wider", meta?.color)}>
      {meta?.label ?? verb}
    </span>
  );
}

function ActionCard({
  action,
  index,
  total,
  validResult,
  readOnly,
  onChange,
  onDelete,
  onMove,
}: {
  action: DslAction;
  index: number;
  total: number;
  validResult?: ValidationResult | undefined;
  readOnly: boolean;
  onChange: (a: DslAction) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const meta = VERB_META[action.verb];

  return (
    <div
      className={cn(
        "border bg-background/60 p-2 transition-colors",
        validResult
          ? validResult.valid
            ? "border-green-600/40"
            : "border-red-500/60"
          : "border-border",
      )}
      id={`action-card-${action.id}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        <GripVertical className="size-3 shrink-0 text-muted-foreground/40" />
        <Mono className="text-[9px] text-muted-foreground">#{index + 1}</Mono>

        {/* Verb selector */}
        <select
          disabled={readOnly}
          value={action.verb}
          onChange={(e) => onChange({ ...action, verb: e.target.value as DslVerb })}
          className="flex-1 border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] focus:outline-none"
          aria-label={`Action ${index + 1} verb`}
        >
          {VERBS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>

        {/* Validation chip */}
        {validResult &&
          (validResult.valid ? (
            <Check className="size-3 shrink-0 text-green-500" aria-label="valid" />
          ) : (
            <X className="size-3 shrink-0 text-red-500" aria-label="invalid" />
          ))}

        {/* Move / delete */}
        {!readOnly && (
          <div className="flex shrink-0 gap-1">
            <button
              onClick={() => onMove(-1)}
              disabled={index === 0}
              className="border border-border p-0.5 disabled:opacity-30"
              title="Move up"
              aria-label="Move action up"
            >
              <ChevronUp className="size-3" />
            </button>
            <button
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              className="border border-border p-0.5 disabled:opacity-30"
              title="Move down"
              aria-label="Move action down"
            >
              <ChevronDown className="size-3" />
            </button>
            <button
              onClick={onDelete}
              className="border border-red-800/40 p-0.5 text-red-400"
              title="Delete action"
              aria-label="Delete action"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {/* Target */}
        <label className="flex flex-col gap-0.5">
          <Mono className="text-[9px] text-muted-foreground">TARGET</Mono>
          <input
            type="text"
            disabled={readOnly}
            list={`targets-${action.id}`}
            value={action.target}
            onChange={(e) => onChange({ ...action, target: e.target.value })}
            placeholder="e.g. patrol units"
            className="border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] focus:outline-none disabled:opacity-60"
            aria-label={`Action ${index + 1} target`}
          />
          <datalist id={`targets-${action.id}`}>
            {meta.targets.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>

        {/* Tick */}
        <label className="flex flex-col gap-0.5">
          <Mono className="text-[9px] text-muted-foreground">
            <Clock className="inline size-2.5 mr-0.5" />
            INJECT AT TICK
          </Mono>
          <input
            type="number"
            disabled={readOnly}
            min={0}
            max={1000}
            value={action.tick}
            onChange={(e) => onChange({ ...action, tick: Math.max(0, +e.target.value) })}
            className="border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] focus:outline-none disabled:opacity-60"
            aria-label={`Action ${index + 1} tick`}
          />
        </label>

        {/* Magnitude */}
        <label className="col-span-full flex flex-col gap-0.5">
          <Mono className="text-[9px] text-muted-foreground">
            <Zap className="inline size-2.5 mr-0.5" />
            {meta.magnitudeLabel.toUpperCase()}
            <span className="ml-1 text-foreground">{action.magnitude}</span>
          </Mono>
          <input
            type="range"
            disabled={readOnly}
            min={0}
            max={100}
            step={5}
            value={action.magnitude}
            onChange={(e) => onChange({ ...action, magnitude: +e.target.value })}
            className="w-full accent-primary disabled:opacity-60"
            aria-label={`Action ${index + 1} magnitude`}
          />
        </label>

        {/* Rationale */}
        <label className="col-span-full flex flex-col gap-0.5">
          <Mono className="text-[9px] text-muted-foreground">RATIONALE (optional)</Mono>
          <textarea
            disabled={readOnly}
            rows={2}
            value={action.rationale}
            onChange={(e) => onChange({ ...action, rationale: e.target.value })}
            placeholder="Why is this action included?"
            className="border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] focus:outline-none disabled:opacity-60 resize-none"
            aria-label={`Action ${index + 1} rationale`}
          />
        </label>
      </div>

      {/* Validation error */}
      {validResult && !validResult.valid && (
        <p className="mt-1 font-mono text-[9px] text-red-400">{validResult.error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------
const PROHIBITED_WORDS = [
  "airstrike",
  "missile strike",
  "bombardment",
  "preemptive strike",
  "kill chain",
  "offensive assault",
  "carpet bomb",
  "strike package",
];

const checkDefensiveScope = (title: string, desc: string, acts: DslAction[]): string | null => {
  const combined = (
    title +
    " " +
    desc +
    " " +
    acts.map((a) => a.rationale + " " + a.target).join(" ")
  ).toLowerCase();
  for (const word of PROHIBITED_WORDS) {
    if (combined.includes(word)) {
      return word;
    }
  }
  return null;
};

function ScenarioEditorScreen() {
  const navigate = useNavigate();
  const role = useSim((s) => s.role);
  const readOnly = !canOperate(role);

  // --- form state ---
  const [scenarioId, setScenarioId] = useState(`SC-C-${Date.now().toString(36).toUpperCase()}`);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [incidentRate, setIncidentRate] = useState(0.08);
  const [weatherRate, setWeatherRate] = useState(0.03);
  const [patrolCount, setPatrolCount] = useState(6);
  const [uavCount, setUavCount] = useState(4);
  const [convoyCount, setConvoyCount] = useState(3);
  const [actions, setActions] = useState<DslAction[]>([]);

  // --- UI state ---
  const [validResults, setValidResults] = useState<ValidationResult[]>([]);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedList, setSavedList] = useState<SavedScenario[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"editor" | "library">("editor");

  // Load saved scenarios
  const loadList = useCallback(async () => {
    setLoadingList(true);
    const res = await api.listCustomScenarios();
    setLoadingList(false);
    if (res?.scenarios) setSavedList(res.scenarios as SavedScenario[]);
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // --- action manipulation ---
  const addAction = () => {
    if (readOnly) return;
    setActions((prev) => [...prev, makeAction()]);
    setValidResults([]);
  };

  const updateAction = (updated: DslAction) => {
    setActions((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setValidResults([]);
  };

  const deleteAction = (id: number) => {
    setActions((prev) => prev.filter((a) => a.id !== id));
    setValidResults([]);
  };

  const moveAction = (index: number, dir: -1 | 1) => {
    setActions((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(index + dir, 0, item!);
      return next;
    });
  };

  // --- DSL validation (calls backend) ---
  const handleValidate = async () => {
    if (!actions.length) {
      toast.warning("Add at least one action to validate.");
      return;
    }
    setValidating(true);
    const payload = buildPayload("draft");
    try {
      const res = await api.validateScenario(payload);
      if (res) {
        setValidResults(res.results as ValidationResult[]);
        if (res.valid) {
          toast.success("All actions passed DSL validation.");
        } else {
          const failed = (res.results as ValidationResult[]).filter((r) => !r.valid).length;
          toast.error(`${failed} action(s) failed validation.`);
        }
      } else {
        // Backend offline — run local check
        setValidResults(localValidate(actions));
        toast.warning("Backend offline — using local validation.");
      }
    } catch {
      setValidResults(localValidate(actions));
      toast.warning("Backend offline — using local validation.");
    }
    setValidating(false);
  };

  // Local fallback validation (same whitelist)
  const _DSL_WHITELIST = new Set([
    "spawn_weather",
    "create_incident",
    "raise_alert",
    "modify_speed",
  ]);
  const localValidate = (acts: DslAction[]): ValidationResult[] =>
    acts.map((a) => ({
      id: a.id,
      verb: a.verb,
      valid: _DSL_WHITELIST.has(a.verb),
      error: _DSL_WHITELIST.has(a.verb)
        ? null
        : `Verb '${a.verb}' is not in the approved whitelist.`,
    }));

  // --- build payload ---
  const buildPayload = (status: string) => ({
    scenarioId,
    name,
    description,
    config: { incidentRate, weatherRate, patrolCount, uavCount, convoyCount },
    actions: actions.map((a) => ({
      id: a.id,
      verb: a.verb,
      target: a.target,
      magnitude: a.magnitude,
      tick: a.tick,
      rationale: a.rationale,
    })),
    status,
  });

  // --- save ---
  const handleSave = async (status: "draft" | "approved") => {
    if (!name.trim()) {
      toast.error("Scenario name is required.");
      return;
    }
    if (!actions.length) {
      toast.error("Add at least one action.");
      return;
    }
    const scopeViolation = checkDefensiveScope(name, description, actions);
    if (scopeViolation) {
      toast.error("Defensive Scope Violation", {
        description: `Prohibited offensive term "${scopeViolation}" detected. DOIP simulates defensive and support operations only (AGENTS.md Scope Guard).`,
      });
      return;
    }
    // Must pass validation before saving
    const localCheck = localValidate(actions);
    if (localCheck.some((r) => !r.valid)) {
      toast.error("Resolve validation errors before saving.");
      setValidResults(localCheck);
      return;
    }
    setSaving(true);
    const res = await api.saveScenario(buildPayload(status));
    setSaving(false);
    if (res) {
      toast.success(`Scenario "${name}" saved as ${status}.`);
      loadList();
      setTab("library");
    } else {
      toast.error("Failed to save scenario — backend offline.");
    }
  };

  // --- delete ---
  const handleDelete = async (sid: string) => {
    const res = await api.deleteScenario(sid);
    if (res) {
      toast.success("Scenario deleted.");
      setSavedList((prev) => prev.filter((s) => s.scenarioId !== sid));
    } else {
      toast.error("Delete failed — backend offline.");
    }
  };

  // --- load a saved scenario into the editor ---
  const handleLoadIntoEditor = (sc: SavedScenario) => {
    setScenarioId(sc.scenarioId);
    setName(sc.name);
    setDescription(sc.description);
    setIncidentRate(sc.config["incidentRate"] ?? 0.08);
    setWeatherRate(sc.config["weatherRate"] ?? 0.03);
    setPatrolCount(sc.config["patrolCount"] ?? 6);
    setUavCount(sc.config["uavCount"] ?? 4);
    setConvoyCount(sc.config["convoyCount"] ?? 3);
    setActions(sc.actions.map((a) => ({ ...a, id: newId() })));
    setValidResults([]);
    setTab("editor");
    toast.info(`Loaded "${sc.name}" into editor.`);
  };

  const allValid = validResults.length > 0 && validResults.every((r) => r.valid);

  return (
    <div className="p-2">
      {/* Page header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Scenario DSL Editor</h1>
          <Mono className="text-[10px] text-muted-foreground">
            Author custom training scenarios · 4 whitelisted DSL verbs · human approval required
          </Mono>
        </div>
        <div className="flex items-center gap-1">
          <AiBadge label="DSL GATE" />
          {readOnly && (
            <Mono className="border border-yellow-700/40 bg-yellow-900/20 px-1.5 py-0.5 text-[9px] text-yellow-400">
              VIEW ONLY
            </Mono>
          )}
        </div>
      </div>

      {/* Tab strip */}
      <div className="mb-2 flex gap-0 border-b border-border">
        {(["editor", "library"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors",
              tab === t
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            id={`tab-${t}`}
          >
            {t === "editor" ? "Editor" : `Library (${savedList.length})`}
          </button>
        ))}
      </div>

      {/* ---- EDITOR TAB ---- */}
      {tab === "editor" && (
        <div className="grid gap-2 lg:grid-cols-[320px_1fr]">
          {/* Left: scenario metadata */}
          <div className="space-y-2">
            <Panel title="Scenario metadata">
              <div className="space-y-2 p-1">
                <label className="flex flex-col gap-0.5">
                  <Mono className="text-[9px] text-muted-foreground">
                    ID (auto-generated, editable)
                  </Mono>
                  <input
                    type="text"
                    disabled={readOnly}
                    value={scenarioId}
                    onChange={(e) =>
                      setScenarioId(e.target.value.toUpperCase().replace(/\s+/g, "-"))
                    }
                    className="border border-border bg-card px-1.5 py-1 font-mono text-[10px] focus:outline-none"
                    id="scenario-id-input"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <Mono className="text-[9px] text-muted-foreground">NAME *</Mono>
                  <input
                    type="text"
                    disabled={readOnly}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Monsoon Strike Exercise"
                    className="border border-border bg-card px-1.5 py-1 font-mono text-[10px] focus:outline-none"
                    id="scenario-name-input"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <Mono className="text-[9px] text-muted-foreground">DESCRIPTION</Mono>
                  <textarea
                    disabled={readOnly}
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="border border-border bg-card px-1.5 py-1 font-mono text-[10px] focus:outline-none resize-none"
                    id="scenario-desc-input"
                  />
                </label>
              </div>
            </Panel>

            <Panel title="Engine parameters">
              <div className="space-y-2 p-1">
                {[
                  {
                    label: "Incident rate",
                    value: incidentRate,
                    set: setIncidentRate,
                    min: 0,
                    max: 0.3,
                    step: 0.01,
                  },
                  {
                    label: "Weather rate",
                    value: weatherRate,
                    set: setWeatherRate,
                    min: 0,
                    max: 0.2,
                    step: 0.01,
                  },
                ].map(({ label, value, set, min, max, step }) => (
                  <label key={label} className="flex flex-col gap-0.5">
                    <Mono className="text-[9px] text-muted-foreground">
                      {label.toUpperCase()} —{" "}
                      <span className="text-foreground">{value.toFixed(2)}</span>
                    </Mono>
                    <input
                      type="range"
                      disabled={readOnly}
                      min={min}
                      max={max}
                      step={step}
                      value={value}
                      onChange={(e) => set(+e.target.value)}
                      className="w-full accent-primary"
                    />
                  </label>
                ))}
                {[
                  { label: "Patrol count", value: patrolCount, set: setPatrolCount, max: 12 },
                  { label: "UAV count", value: uavCount, set: setUavCount, max: 10 },
                  { label: "Convoy count", value: convoyCount, set: setConvoyCount, max: 8 },
                ].map(({ label, value, set, max }) => (
                  <label key={label} className="flex flex-col gap-0.5">
                    <Mono className="text-[9px] text-muted-foreground">
                      {label.toUpperCase()} — <span className="text-foreground">{value}</span>
                    </Mono>
                    <input
                      type="range"
                      disabled={readOnly}
                      min={1}
                      max={max}
                      step={1}
                      value={value}
                      onChange={(e) => set(+e.target.value)}
                      className="w-full accent-primary"
                    />
                  </label>
                ))}
              </div>
            </Panel>

            {/* DSL verb reference */}
            <Panel title="DSL whitelist">
              <ul className="space-y-1 p-1">
                {VERBS.map((v) => (
                  <li key={v.value} className="flex flex-col gap-0">
                    <span className={cn("font-mono text-[10px]", v.color)}>{v.label}</span>
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {v.description}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          {/* Right: action list */}
          <div className="space-y-2">
            <Panel
              title={`DSL actions (${actions.length})`}
              actions={
                <div className="flex items-center gap-1.5">
                  {/* Validate */}
                  <button
                    id="validate-btn"
                    onClick={handleValidate}
                    disabled={validating || !actions.length}
                    className="flex items-center gap-1 border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest doip-btn-solid disabled:opacity-50"
                  >
                    <ShieldCheck className={cn("size-3", validating && "animate-pulse")} />
                    {validating ? "Validating…" : "Validate"}
                  </button>
                  {/* Add action */}
                  {!readOnly && (
                    <button
                      id="add-action-btn"
                      onClick={addAction}
                      className="flex items-center gap-1 border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest doip-btn-solid"
                    >
                      <Plus className="size-3" /> Add action
                    </button>
                  )}
                </div>
              }
            >
              {actions.length === 0 ? (
                <EmptyState
                  label="No actions yet"
                  {...(!readOnly ? { hint: 'Click "Add action" to build the DSL sequence.' } : {})}
                />
              ) : (
                <div className="space-y-1.5 p-1">
                  {actions.map((action, index) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      index={index}
                      total={actions.length}
                      validResult={validResults.find((r) => r.id === action.id)}
                      readOnly={readOnly}
                      onChange={updateAction}
                      onDelete={() => deleteAction(action.id)}
                      onMove={(dir) => moveAction(index, dir)}
                    />
                  ))}
                </div>
              )}
            </Panel>

            {/* Save bar */}
            {!readOnly && (
              <div className="flex items-center gap-2 border border-border bg-card/40 p-2">
                <Mono className="flex-1 text-[10px] text-muted-foreground">
                  {allValid
                    ? "✓ All actions validated — ready to save."
                    : "Validate all actions before submitting for approval."}
                </Mono>
                <button
                  id="send-to-whatif-btn"
                  onClick={() => {
                    toast.info(`Deep-linking ${scenarioId} to What-If Theater`);
                    navigate({
                      to: "/whatif",
                      search: { scenario: scenarioId },
                    });
                  }}
                  className="flex items-center gap-1 border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20 transition-colors"
                  title="Test this scenario in the What-If Theater"
                >
                  <FlaskConical className="size-3" /> Test in What-If
                </button>
                <button
                  id="save-draft-btn"
                  onClick={() => handleSave("draft")}
                  disabled={saving}
                  className="flex items-center gap-1 border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest doip-btn-solid disabled:opacity-50"
                >
                  <Save className="size-3" /> Save draft
                </button>
                <button
                  id="save-approved-btn"
                  onClick={() => handleSave("approved")}
                  disabled={saving || !allValid}
                  title={allValid ? "Save and mark as approved" : "Validate first"}
                  className="flex items-center gap-1 border border-green-700/50 bg-green-900/20 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-green-400 disabled:opacity-40"
                >
                  <Check className="size-3" /> Approve &amp; save
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- LIBRARY TAB ---- */}
      {tab === "library" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Mono className="text-[10px] text-muted-foreground">
              {loadingList ? "Loading…" : `${savedList.length} custom scenario(s) in the library`}
            </Mono>
            <button
              onClick={loadList}
              className="border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest doip-btn-solid"
            >
              Refresh
            </button>
          </div>

          {savedList.length === 0 && !loadingList ? (
            <EmptyState
              label="No custom scenarios saved"
              hint="Switch to the Editor tab and create one."
            />
          ) : (
            <div className="space-y-1.5">
              {savedList.map((sc) => (
                <div
                  key={sc.scenarioId}
                  className="border border-border bg-card/40 p-2"
                  id={`scenario-row-${sc.scenarioId}`}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[11px] font-semibold text-foreground">
                          {sc.name}
                        </span>
                        <Mono className="text-[9px] text-muted-foreground">{sc.scenarioId}</Mono>
                        <span
                          className={cn(
                            "border px-1 font-mono text-[9px] uppercase",
                            sc.status === "approved"
                              ? "border-green-700/40 text-green-400"
                              : "border-yellow-700/40 text-yellow-400",
                          )}
                        >
                          {sc.status}
                        </span>
                      </div>
                      {sc.description && (
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground truncate">
                          {sc.description}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {sc.actions.map((a) => (
                          <VerbPill key={a.id} verb={a.verb} />
                        ))}
                      </div>
                      <Mono className="mt-1 text-[9px] text-muted-foreground">
                        {sc.actions.length} action(s) · by {sc.author} · {sc.updatedAt.slice(0, 10)}
                      </Mono>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {!readOnly && (
                        <button
                          onClick={() => handleLoadIntoEditor(sc)}
                          title="Load into editor"
                          className="border border-border p-1 font-mono text-[10px] doip-btn-solid"
                          aria-label={`Edit ${sc.name}`}
                        >
                          <Pencil className="size-3" />
                        </button>
                      )}
                      {/* Send to What-If */}
                      <Link
                        to="/whatif"
                        title="Send to What-If runner"
                        className="flex items-center border border-border p-1 font-mono text-[10px] doip-btn-solid"
                        aria-label={`Send ${sc.name} to What-If`}
                      >
                        <Play className="size-3" />
                      </Link>
                      {!readOnly && (
                        <button
                          onClick={() => handleDelete(sc.scenarioId)}
                          title="Delete scenario"
                          className="border border-red-800/40 p-1 text-red-400"
                          aria-label={`Delete ${sc.name}`}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
