"""Test Doctrine RAG Engine and Grounding Verifier."""

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.rag import corpus_index, query_rag, verify_grounding


def test_corpus_loaded():
    """All 15 doctrine documents must be loaded into the index."""
    assert len(corpus_index.docs) == 15
    for expected in ["SOP-01", "SOP-06", "POL-01", "REF-02"]:
        assert expected in corpus_index.docs, f"Missing expected doc {expected}"


def test_query_retrieval():
    """Querying specific topics must retrieve the appropriate doctrine document."""
    res_comms = query_rag("comms loss and silence escalation")
    assert any(c["doc_id"] == "SOP-06" for c in res_comms["citations"])

    res_casevac = query_rag("casualty evacuation golden hour medical triage")
    assert any(c["doc_id"] == "SOP-03" for c in res_casevac["citations"])


def test_grounding_verifier_valid():
    """Claims properly citing verified docs or events pass grounding."""
    valid_text = "According to [SOP-01] patrol units conduct routine checks. Verified via [INC-10]."
    v = verify_grounding(valid_text, known_events={"INC-10"})
    assert v["grounded"] is True
    assert "SOP-01" in v["valid_doc_citations"]
    assert "INC-10" in v["valid_event_citations"]
    assert not v["invalid_citations"]


def test_grounding_verifier_invalid():
    """Claims making doctrine assertions without citation or citing fake IDs fail."""
    # Fake unverified document ID
    fake_doc_text = "Protocol mandates immediate ceasefire under [SOP-99]."
    v = verify_grounding(fake_doc_text)
    assert v["grounded"] is False
    assert "SOP-99" in v["invalid_citations"]

    # Factual assertion with zero citations
    uncited_claim = "The commanding officer protocol mandates immediate evacuation of all personnel."
    v2 = verify_grounding(uncited_claim)
    assert v2["grounded"] is False
    assert v2["warning"] is not None
