# ADR-0001: Modular Monolith First

**Status:** Accepted · **Date:** 2026-07 · **Owner:** project lead

## Context

The original DOIP sketch proposed microservices (API gateway, mission service, map service, AI service, CV service), Kafka, and Kubernetes from day one — for a solo/small-team project whose core risk is the simulation engine, not scale.

## Decision

Build one deployable FastAPI process with strict internal module boundaries (`engine/`, `mission/`, `ai/`, `session/`). Redis pub/sub for events. Docker Compose for deployment.

Planned splits, and nothing before them:
- Phase 4: vision service (AGPL isolation + GPU/CPU independence)
- Phase 6: analytics workers
- Phase 7: Redis→Kafka, Compose→k3s — only if load demands it

## Consequences

**Pro:** one debuggable process; deterministic tick loop is trivially testable; no distributed-clock problems inside the engine; a student laptop runs the whole platform.

**Con:** module discipline is enforced by review, not process boundaries — import-linting guards the seams; a later split requires real work (accepted).

## Revisit when

NFR breach at 200 entities/50 events·s, or a second team needs independent deploy cadence.
