import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  Copy,
  Download,
  FileText,
  Search,
  Check,
  Tag,
  Bookmark,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Layers,
  CheckSquare,
} from "lucide-react";
import { Panel, Mono, EmptyState } from "@/components/doip/primitives";
import { api, type CorpusDocDetail } from "@/lib/api";
import { BUNDLED_CORPUS_DOCS } from "@/lib/corpusData";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/doctrine")({
  validateSearch: (s: Record<string, unknown>): { doc?: string; sec?: string } => ({
    ...(typeof s["doc"] === "string" ? { doc: s["doc"] } : {}),
    ...(typeof s["sec"] === "string" ? { sec: s["sec"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Doctrine & SOP Corpus — DOIP" },
      {
        name: "description",
        content:
          "Official defense doctrine, policies, and standard operating procedures governing simulated exercises.",
      },
      { property: "og:title", content: "Doctrine & SOP Corpus — DOIP" },
      {
        property: "og:description",
        content:
          "Full-text searchable corpus of 15 canonical defense policies (POL), references (REF), and SOPs.",
      },
    ],
  }),
  component: DoctrineScreen,
});

type CategoryFilter = "ALL" | "POL" | "REF" | "SOP";

function downloadMarkdown(name: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function DoctrineScreen() {
  const { doc: initialDoc, sec: initialSec } = Route.useSearch();
  const [docs, setDocs] = useState<CorpusDocDetail[]>(BUNDLED_CORPUS_DOCS);
  const [selectedId, setSelectedId] = useState<string>(
    initialDoc?.toUpperCase() || BUNDLED_CORPUS_DOCS[0]?.id || "POL-01",
  );
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [search, setSearch] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [checklistMode, setChecklistMode] = useState<boolean>(false);
  const [checklistCompleted, setChecklistCompleted] = useState<Record<string, boolean>>({});
  const [semanticScores, setSemanticScores] = useState<Record<string, number>>({});

  // Sync initial query search param
  useEffect(() => {
    if (initialDoc) {
      setSelectedId(initialDoc.toUpperCase());
    }
  }, [initialDoc]);

  // Semantic query effect powered by backend POST /corpus/query
  useEffect(() => {
    if (!search.trim() || search.trim().length < 3) {
      setSemanticScores({});
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.queryCorpus(search.trim(), 5);
        if (res && Array.isArray(res)) {
          const scores: Record<string, number> = {};
          res.forEach((r) => {
            scores[r.doc_id.toUpperCase()] = r.score;
          });
          setSemanticScores(scores);
        }
      } catch {
        // fail-soft
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Optionally hydrate latest docs from backend if reachable
  useEffect(() => {
    void (async () => {
      try {
        const res = await api.listCorpusDocs();
        if (res?.docs?.length) {
          // If backend returns list, fetch full details or map over
          const updated = await Promise.all(
            res.docs.map(async (d) => {
              const detail = await api.getCorpusDoc(d.id);
              return (
                detail ??
                BUNDLED_CORPUS_DOCS.find((b) => b.id === d.id) ?? {
                  id: d.id,
                  category: d.category,
                  title: d.title,
                  tags: d.tags,
                  version: d.version,
                  content: "",
                  sections: [],
                }
              );
            }),
          );
          setDocs(updated);
        }
      } catch {
        // Fall back cleanly to bundled data (fail-soft)
      }
    })();
  }, []);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (category !== "ALL" && d.category !== category) return false;
      if (!q) return true;
      return (
        d.id.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.tags.some((t) => t.toLowerCase().includes(q)) ||
        d.content.toLowerCase().includes(q)
      );
    });
  }, [docs, category, search]);

  const selectedDoc = useMemo(
    () => docs.find((d) => d.id === selectedId) || filteredDocs[0] || docs[0],
    [docs, selectedId, filteredDocs],
  );

  const copyCitation = () => {
    if (!selectedDoc) return;
    const cite = `§ ${selectedDoc.id}`;
    navigator.clipboard.writeText(cite);
    setCopied(true);
    toast.success(`Citation copied to clipboard: ${cite}`, {
      description: "Ready to paste into SITREP or scenario report.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "POL":
        return "border-amber-500/40 bg-amber-500/10 text-amber-400";
      case "REF":
        return "border-sky-500/40 bg-sky-500/10 text-sky-400";
      case "SOP":
        return "border-primary/40 bg-primary/10 text-primary";
      default:
        return "border-border bg-raised text-muted-foreground";
    }
  };

  const counts = useMemo(
    () => ({
      ALL: docs.length,
      POL: docs.filter((d) => d.category === "POL").length,
      REF: docs.filter((d) => d.category === "REF").length,
      SOP: docs.filter((d) => d.category === "SOP").length,
    }),
    [docs],
  );

  return (
    <div className="grid h-full gap-2 p-2 lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* ---------------------------------------------------- */}
      {/* Left Sidebar: Search, Categories & Document Catalog  */}
      {/* ---------------------------------------------------- */}
      <div className="flex h-full min-h-0 flex-col gap-2">
        <Panel
          title="Doctrine & SOP Corpus"
          actions={
            <div className="flex items-center gap-1">
              <Mono className="text-[10px] text-muted-foreground">{counts.ALL} DOCS</Mono>
            </div>
          }
          className="flex min-h-0 flex-1 flex-col"
          bodyClassName="flex min-h-0 flex-1 flex-col p-2 gap-2"
        >
          {/* Search bar */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, title, tags or text..."
              className="w-full border border-border bg-base py-1.5 pl-8 pr-2 font-mono text-xs placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-2 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              >
                CLEAR
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="grid grid-cols-4 gap-1">
            {(["ALL", "POL", "REF", "SOP"] as CategoryFilter[]).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "border py-1 text-center font-mono text-[10px] uppercase tracking-wider transition-colors",
                  category === c
                    ? "border-primary bg-primary text-primary-foreground font-semibold"
                    : "border-border bg-base text-muted-foreground hover:bg-raised hover:text-foreground",
                )}
              >
                {c} ({counts[c]})
              </button>
            ))}
          </div>

          {/* Document list */}
          <div className="min-h-0 flex-1 overflow-y-auto space-y-1 pr-0.5">
            {filteredDocs.map((doc) => {
              const isSelected = doc.id === selectedDoc?.id;
              return (
                <button
                  key={doc.id}
                  onClick={() => setSelectedId(doc.id)}
                  className={cn(
                    "w-full text-left border p-2 transition-all block",
                    isSelected
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/70 bg-base hover:border-border hover:bg-raised/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {doc.id}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1 py-0.2 font-mono text-[9px] uppercase tracking-wider border",
                        getCategoryColor(doc.category),
                      )}
                    >
                      {doc.category} · v{doc.version}
                    </span>
                  </div>

                  {semanticScores[doc.id] != null && (
                    <div className="mt-1 flex items-center gap-1 font-mono text-[9px] text-primary">
                      <Sparkles className="size-2.5" />
                      <span>Semantic Match: {(semanticScores[doc.id]! * 100).toFixed(0)}%</span>
                    </div>
                  )}

                  <div className="mt-1 font-sans text-xs font-medium text-foreground line-clamp-1">
                    {doc.title}
                  </div>

                  {doc.tags && doc.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {doc.tags.map((t) => (
                        <span
                          key={t}
                          className="font-mono text-[9px] text-muted-foreground bg-raised/80 px-1 border border-border/40"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}

            {!filteredDocs.length && (
              <EmptyState
                label="No matching doctrine"
                hint="Try searching for another keyword or clearing category filters."
              />
            )}
          </div>
        </Panel>
      </div>

      {/* ---------------------------------------------------- */}
      {/* Right Main Pane: Full Document Reader & Metadata     */}
      {/* ---------------------------------------------------- */}
      <div className="flex h-full min-h-0 flex-col gap-2">
        <Panel
          title={selectedDoc ? `${selectedDoc.id} — ${selectedDoc.title}` : "Document Reader"}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => setChecklistMode((m) => !m)}
                className={cn(
                  "flex items-center gap-1 border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  checklistMode
                    ? "border-primary bg-primary/20 text-primary font-semibold"
                    : "border-border bg-base text-muted-foreground hover:bg-raised hover:text-foreground",
                )}
                title="Toggle interactive procedural compliance checklist mode"
              >
                <CheckSquare className="size-3" />
                CHECKLIST {checklistMode ? "ON" : "MODE"}
              </button>

              <button
                onClick={copyCitation}
                className="flex items-center gap-1 border border-border bg-base px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-raised hover:text-foreground"
                title="Copy formal doctrine citation (§ ID)"
              >
                {copied ? (
                  <>
                    <Check className="size-3 text-success" /> COPIED
                  </>
                ) : (
                  <>
                    <Copy className="size-3" /> CITE §
                  </>
                )}
              </button>

              <button
                onClick={() =>
                  downloadMarkdown(`${selectedDoc?.id}.md`, selectedDoc?.content || "")
                }
                className="flex items-center gap-1 border border-border bg-base px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-raised hover:text-foreground"
                title="Download raw markdown document"
              >
                <Download className="size-3" /> EXPORT MD
              </button>
            </div>
          }
          className="flex min-h-0 flex-1 flex-col"
          bodyClassName="flex min-h-0 flex-1 flex-col p-0 overflow-hidden"
        >
          {selectedDoc ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {/* Classification Security Banner */}
              <div className="border-b border-border bg-raised/60 px-4 py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-primary uppercase font-semibold">
                    <BookOpen className="size-3" /> DEFENSE UNCLASSIFIED
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    EXERCISE TRAINING USE ONLY · SIMULATION DIRECTIVE
                  </span>
                </div>

                <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <span>CATEGORY: {selectedDoc.category}</span>
                  <span>·</span>
                  <span>VERSION {selectedDoc.version}</span>
                  <span>·</span>
                  <span className="text-ai">AGENTS.MD CH. 13 GROUNDED</span>
                </div>
              </div>

              {/* Procedural Checklist Progress Bar */}
              {checklistMode && selectedDoc.sections && (
                <div className="border-b border-primary/30 bg-primary/10 px-4 py-2 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="size-3.5 text-primary" />
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
                      Procedural Verification Checklist:
                    </span>
                    <span className="font-mono text-[11px] text-foreground">
                      {
                        selectedDoc.sections.filter(
                          (_, idx) => checklistCompleted[`${selectedDoc.id}-sec-${idx}`],
                        ).length
                      }{" "}
                      / {selectedDoc.sections.length} Steps Verified
                    </span>
                  </div>
                  <div className="w-44 h-2 bg-base border border-border overflow-hidden rounded-full">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{
                        width: `${(selectedDoc.sections.filter((_, idx) => checklistCompleted[`${selectedDoc.id}-sec-${idx}`]).length / Math.max(selectedDoc.sections.length, 1)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Table of contents quick navigation */}
              {selectedDoc.sections && selectedDoc.sections.length > 1 && (
                <div className="border-b border-border/70 bg-base px-4 py-1.5 flex items-center gap-1.5 overflow-x-auto text-[10px] font-mono">
                  <span className="text-muted-foreground uppercase tracking-wider shrink-0 flex items-center gap-1">
                    <Bookmark className="size-3" /> JUMP:
                  </span>
                  {selectedDoc.sections.map((sec, idx) => (
                    <a
                      key={idx}
                      href={`#sec-${idx}`}
                      className="shrink-0 border border-border/60 bg-raised/50 px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                    >
                      {sec.heading}
                    </a>
                  ))}
                </div>
              )}

              {/* Main Document Content Body */}
              <div className="p-6 max-w-4xl space-y-6">
                {selectedDoc.sections?.map((sec, idx) => {
                  const sectionKey = `${selectedDoc.id}-sec-${idx}`;
                  const isChecked = checklistCompleted[sectionKey] || false;
                  const isHighlighted = initialSec
                    ? initialSec === String(idx + 1) ||
                      sec.heading?.toLowerCase().includes(initialSec.toLowerCase())
                    : false;

                  return (
                    <section
                      key={idx}
                      id={`sec-${idx}`}
                      className={cn(
                        "scroll-mt-6 transition-all rounded p-3",
                        isHighlighted &&
                          "border border-primary bg-primary/5 ring-1 ring-primary/40",
                        isChecked && checklistMode && "opacity-60 bg-raised/30",
                      )}
                    >
                      {sec.heading && (
                        <h2 className="border-b border-border/80 pb-1.5 font-mono text-sm font-semibold tracking-wide text-foreground uppercase flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {checklistMode && (
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) =>
                                  setChecklistCompleted((prev) => ({
                                    ...prev,
                                    [sectionKey]: e.target.checked,
                                  }))
                                }
                                className="size-4 rounded border-border accent-primary cursor-pointer"
                              />
                            )}
                            <span
                              className={cn(
                                isChecked && checklistMode && "line-through text-muted-foreground",
                              )}
                            >
                              {sec.heading}
                            </span>
                          </div>
                          <span className="font-mono text-[9px] text-muted-foreground/60 font-normal">
                            § {idx + 1}
                          </span>
                        </h2>
                      )}

                      <div
                        className={cn(
                          "mt-3 font-sans text-xs leading-relaxed text-foreground/90 whitespace-pre-line space-y-2",
                          isChecked && checklistMode && "line-through text-muted-foreground/80",
                        )}
                      >
                        <DocParagraph
                          text={sec.text}
                          onNavigateDoc={(targetId) => setSelectedId(targetId)}
                        />
                      </div>
                    </section>
                  );
                })}

                {/* AI Grounding Governance Note */}
                <div className="mt-8 border border-ai/30 bg-ai/5 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-ai uppercase font-semibold">
                    <Sparkles className="size-3.5" /> AGENTS.MD Chapter 13 AI Grounding Invariant
                  </div>
                  <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                    This document is permanently indexed in the DOIP Deterministic RAG Vector
                    Engine. AI agents generating Situation Reports (SITREPs) or answering operator
                    inquiries must formally cite this document as{" "}
                    <code className="bg-base border border-border px-1 py-0.5 text-primary">
                      § {selectedDoc.id}
                    </code>
                    . Any claim lacking verifiable doc or event citations is flagged as ungrounded
                    and rejected from authoritative logs.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              label="Select a document"
              hint="Choose a policy or SOP from the catalog to view its procedures."
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Component that renders text while converting mentioned Doc IDs (e.g. SOP-02) into clickable links */
function DocParagraph({
  text,
  onNavigateDoc,
}: {
  text: string;
  onNavigateDoc: (docId: string) => void;
}) {
  if (!text) return null;

  // Split lines to detect markdown tables
  const lines = text.split("\n");
  const isTable = lines.some((l) => l.trim().startsWith("|") && l.includes("|"));

  if (isTable) {
    const tableRows = lines.filter((l) => l.trim().startsWith("|"));
    const otherLines = lines.filter((l) => !l.trim().startsWith("|"));

    return (
      <div className="space-y-2">
        {otherLines.length > 0 && <p>{otherLines.join("\n")}</p>}
        <div className="overflow-x-auto border border-border bg-base my-2">
          <table className="w-full border-collapse font-mono text-[11px]">
            <tbody>
              {tableRows.map((row, rIdx) => {
                const cells = row
                  .split("|")
                  .map((c) => c.trim())
                  .filter((_, i, arr) => i > 0 && i < arr.length - 1);
                const isHeader = rIdx === 0;
                const isDivider = row.includes("---");
                if (isDivider) return null;

                return (
                  <tr
                    key={rIdx}
                    className={
                      isHeader
                        ? "border-b border-border bg-raised/70 font-semibold text-foreground"
                        : "border-b border-border/50 hover:bg-raised/30"
                    }
                  >
                    {cells.map((cell, cIdx) => (
                      <td key={cIdx} className="p-2 border-r border-border/40 last:border-r-0">
                        {cell}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Detect tokens like SOP-01, POL-02, REF-03 and make them clickable
  const parts = text.split(/(\b(?:SOP-\d+|POL-\d+|REF-\d+)\b)/g);

  return (
    <p>
      {parts.map((part, i) => {
        if (/^(?:SOP-\d+|POL-\d+|REF-\d+)$/i.test(part)) {
          const target = part.toUpperCase();
          return (
            <button
              key={i}
              onClick={() => onNavigateDoc(target)}
              className="inline-flex items-center gap-0.5 px-1 py-0.2 mx-0.5 font-mono text-[10px] text-primary bg-primary/10 border border-primary/30 hover:bg-primary/20 hover:border-primary rounded transition-colors"
              title={`Jump to doctrine document ${target}`}
            >
              § {target}
            </button>
          );
        }
        return part;
      })}
    </p>
  );
}
