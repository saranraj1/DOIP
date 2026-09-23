"""Doctrine RAG Engine & AI Claim Grounding Verifier.

Indexes the 15 canonical training corpus documents (POL-01..03, REF-01..04, SOP-01..08),
performs TF-IDF / term-overlap retrieval, synthesizes answers, and verifies citations
according to AGENTS.md Chapter 13 AI safety invariants.
"""

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any

CORPUS_ROOT = Path(__file__).resolve().parent.parent.parent / "corpus"


@dataclass
class CorpusDoc:
    doc_id: str
    category: str
    title: str
    tags: list[str]
    version: str
    content: str
    sections: list[tuple[str, str]]  # (heading, text)


class CorpusIndex:
    """In-memory index of doctrine and standard operating procedure documents."""

    def __init__(self, corpus_dir: Path | None = None) -> None:
        self.corpus_dir = corpus_dir or CORPUS_ROOT
        self.docs: dict[str, CorpusDoc] = {}
        self.load()

    def load(self) -> None:
        """Scan corpus directory for markdown files and parse frontmatter."""
        self.docs.clear()
        if not self.corpus_dir.exists():
            return

        for path in self.corpus_dir.rglob("*.md"):
            try:
                text = path.read_text(encoding="utf-8")
                doc = self._parse_doc(path, text)
                if doc:
                    self.docs[doc.doc_id] = doc
            except Exception:
                continue

    def _parse_doc(self, path: Path, text: str) -> CorpusDoc | None:
        category = path.parent.name.upper()
        doc_id = path.stem.upper()
        title = doc_id
        tags: list[str] = []
        version = "1.0"
        body = text

        # Parse YAML frontmatter if present
        if text.startswith("---"):
            parts = text.split("---", 2)
            if len(parts) >= 3:
                header = parts[1]
                body = parts[2]
                for line in header.strip().splitlines():
                    if line.startswith("id:"):
                        doc_id = line.split(":", 1)[1].strip().upper()
                    elif line.startswith("title:"):
                        title = line.split(":", 1)[1].strip()
                    elif line.startswith("version:"):
                        version = line.split(":", 1)[1].strip()
                    elif line.startswith("tags:"):
                        tag_str = line.split(":", 1)[1].strip()
                        tags = [t.strip().strip("[]'\"") for t in tag_str.split(",") if t.strip()]

        # Split body into sections by markdown heading
        sections: list[tuple[str, str]] = []
        current_heading = "Overview"
        current_lines: list[str] = []

        for line in body.splitlines():
            if line.startswith("#"):
                if current_lines:
                    sections.append((current_heading, "\n".join(current_lines).strip()))
                    current_lines = []
                current_heading = line.lstrip("#").strip()
            else:
                current_lines.append(line)

        if current_lines:
            sections.append((current_heading, "\n".join(current_lines).strip()))

        return CorpusDoc(
            doc_id=doc_id,
            category=category,
            title=title,
            tags=tags,
            version=version,
            content=body.strip(),
            sections=sections,
        )

    def search(self, query: str, top_k: int = 3) -> list[dict[str, Any]]:
        """Score documents against the query terms."""
        tokens = set(re.findall(r"\w+", query.lower()))
        if not tokens:
            return []

        scored = []
        for doc in self.docs.values():
            score = 0.0
            doc_text_lower = doc.content.lower()

            # Exact doc_id match gives high priority
            if doc.doc_id.lower() in tokens or doc.doc_id.lower() in query.lower():
                score += 10.0

            # Tag matches
            for tag in doc.tags:
                if tag.lower() in tokens:
                    score += 4.0

            # Title matches
            for token in tokens:
                if token in doc.title.lower():
                    score += 3.0
                # Content frequency
                cnt = doc_text_lower.count(token)
                if cnt > 0:
                    score += min(cnt * 0.5, 4.0)

            if score > 0:
                # Find best matching section excerpt
                best_sec_title = "Reference"
                best_excerpt = doc.content[:300]
                max_sec_score = 0
                for heading, sec_text in doc.sections:
                    sec_lower = sec_text.lower()
                    sec_matches = sum(1 for t in tokens if t in sec_lower)
                    if sec_matches > max_sec_score:
                        max_sec_score = sec_matches
                        best_sec_title = heading
                        best_excerpt = sec_text[:350]

                scored.append({
                    "doc_id": doc.doc_id,
                    "title": doc.title,
                    "category": doc.category,
                    "score": round(score, 2),
                    "section": best_sec_title,
                    "excerpt": best_excerpt,
                })

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:top_k]


# Global singleton corpus
corpus_index = CorpusIndex()


# ===========================================================================
# AI Grounding Verifier (AGENTS.md Chapter 13 Rule)
# ===========================================================================
# Every claim shown to users must cite an event id (e.g. INC-10, AL-5, EV-22)
# or a corpus doc id (SOP-01..08, POL-01..03, REF-01..04).
# Unverifiable claims are flagged, not displayed as unquestioned fact.
# ===========================================================================

def verify_grounding(
    text: str,
    known_events: set[str] | None = None,
    known_docs: set[str] | None = None,
) -> dict[str, Any]:
    """Verify citations in generated text against known events and corpus docs."""
    known_events = known_events or set()
    known_docs = known_docs or set(corpus_index.docs.keys())

    # Detect cited doc tokens: e.g. SOP-01, POL-02, REF-03
    doc_cites = set(re.findall(r"\b(SOP-\d+|POL-\d+|REF-\d+)\b", text, re.IGNORECASE))
    doc_cites = {d.upper() for d in doc_cites}

    # Detect cited event tokens: e.g. INC-10, AL-5, RUN-1, EV-12
    event_cites = set(re.findall(r"\b(INC-\w+|AL-\w+|RUN-\w+)\b", text, re.IGNORECASE))
    event_cites = {e.upper() for e in event_cites}

    valid_docs = [d for d in doc_cites if d in known_docs]
    invalid_docs = [d for d in doc_cites if d not in known_docs]

    # If events are passed, check validity; if no active events exist, allow format-valid events
    valid_events = [e for e in event_cites if (not known_events or e in known_events)]
    invalid_events = [e for e in event_cites if known_events and e not in known_events]

    total_citations = len(valid_docs) + len(valid_events)
    has_unverified = bool(invalid_docs or invalid_events)
    
    # Text with assertions but zero citations has unverified status
    needs_citation = any(keyword in text.lower() for keyword in ["mandates", "requires", "protocol", "violation", "incident", "casualty"])
    if needs_citation and total_citations == 0:
        grounded = False
        warning = "Claim makes doctrine or event assertions without citing an authorized event ID or corpus doc ID."
    elif has_unverified:
        grounded = False
        warning = f"References unverified identifiers: {invalid_docs + invalid_events}"
    else:
        grounded = True
        warning = None

    return {
        "grounded": grounded,
        "warning": warning,
        "valid_doc_citations": valid_docs,
        "valid_event_citations": valid_events,
        "invalid_citations": invalid_docs + invalid_events,
    }


def query_rag(
    query: str,
    recent_events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Execute grounded RAG query across doctrine corpus and event stream."""
    recent_events = recent_events or []
    known_events = {
        e.get("entityId", "") for e in recent_events if e.get("entityId")
    } | {
        e.get("payload", {}).get("alertId", "") for e in recent_events if e.get("payload", {}).get("alertId")
    }

    results = corpus_index.search(query, top_k=3)
    if not results:
        return {
            "query": query,
            "answer": "No relevant doctrine or SOP reference found for this query.",
            "citations": [],
            "grounding": {"grounded": True, "warning": None},
        }

    top_doc = results[0]
    doc_id = top_doc["doc_id"]
    title = top_doc["title"]
    excerpt = top_doc["excerpt"]

    # Synthesize grounded answer citing doc
    answer = f"According to [{doc_id}] ({title}): {excerpt}"
    grounding = verify_grounding(answer, known_events=known_events)

    return {
        "query": query,
        "answer": answer,
        "citations": results,
        "grounding": grounding,
    }
