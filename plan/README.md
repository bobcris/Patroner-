# Patroner — Blueprint Revision 2.1.2-R1 (`plan/`) Master Index

**Current Planning Baseline:** `Blueprint Revision 2.1.2-R1` (`docs/blueprint-revision-2.1.2-r1`)  
**Authoritative Recovery Base Commit:** `282a303ea1126fb3b1da368e4e8e4ddbeb59c552` (Parent `R2.1.2` Commit: `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3`; `R2.1.1` Commit: `8805140b1e6e7799922348369d7e29881102a75e`; `R2.1` Commit: `617cc7f5d9e41b8cd55ed96b64d2363cdb29557b`)  
**Governance Status:** **DOCUMENTATION CORRECTION COMPLETE — M00 REMAINS BLOCKED PENDING EXPLICIT OWNER APPROVAL AT GATE AUTH-1**

> **Mandatory Governance Boundary (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Core Blueprint Architecture & Governance Documents (`00` – `14`)

| Doc # | Document Path | Title & Scope | Revision Status |
| :--- | :--- | :--- | :--- |
| **`00`** | [`00_BLUEPRINT_REVISION_2.md`](./00_BLUEPRINT_REVISION_2.md) | Master Architecture, Mathematical Invariants & Execution Roadmap (`M00`–`M11`) | Updated in `R2.1.2-R1` |
| **`01`** | [`01_SOURCE_REGISTER_AND_REQUIREMENTS.md`](./01_SOURCE_REGISTER_AND_REQUIREMENTS.md) | Governing Source Register, Precedence Hierarchy & Dossiers 01–16 Reconciliation | Updated in `R2.1.2-R1` |
| **`02`** | [`02_ARCHITECTURE_DECISIONS.md`](./02_ARCHITECTURE_DECISIONS.md) | Master Index & Summary of Architecture Decision Records (`ADR-001`–`ADR-009`) | Updated in `R2.1.2-R1` |
| **`03`** | [`03_REPOSITORY_BASELINE_AND_AUDIT.md`](./03_REPOSITORY_BASELINE_AND_AUDIT.md) | Repository Baseline Inventory, Prototype Audit & Technical Debt Register | Baseline `R2.1` |
| **`04`** | [`04_MIGRATION_AND_PARITY_POLICY.md`](./04_MIGRATION_AND_PARITY_POLICY.md) | Prototype Disposition, `C0-Legacy`/`C1-Fast`/`C1-Cert` Hierarchy & 17-Family Parity Suite | Updated in `R2.1.2-R1` |
| **`05`** | [`05_WORKLOAD_DEPENDENCY_GRAPH.md`](./05_WORKLOAD_DEPENDENCY_GRAPH.md) | 4-Gate Topology, 4-Stage `DEC-13` Lifecycle & Reconciled `DEC-01`–`DEC-13` Matrix | Updated in `R2.1.2-R1` |
| **`06`** | [`06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`](./06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md) | Quantitative Acceptance Thresholds, 6 Offset Categories & `AG-01`–`AG-17` Matrix | Updated in `R2.1.2-R1` |
| **`07`** | [`07_RISK_AND_OPEN_DECISIONS_REGISTER.md`](./07_RISK_AND_OPEN_DECISIONS_REGISTER.md) | Risk Register (`RISK-01`–`RISK-12`) & Open Owner Decisions (`DEC-01`–`DEC-13`) | Updated in `R2.1.2-R1` |
| **`08`** | [`08_VERTICAL_SLICE_DEFINITION.md`](./08_VERTICAL_SLICE_DEFINITION.md) | Vertical Slice 1 Specification (Bodice + Trouser E2E CAD to Signed DXF-AAMA) | Updated in `R2.1.2-R1` |
| **`09`** | [`09_COMMERCIAL_PILOT_DEFINITION.md`](./09_COMMERCIAL_PILOT_DEFINITION.md) | Commercial Capsule Pilot Definition, Micro-Factory Execution & Escrow Flow | Baseline `R2.1` |
| **`10`** | [`10_RELEASE_AND_GOVERNANCE_POLICY.md`](./10_RELEASE_AND_GOVERNANCE_POLICY.md) | Release Governance, Git Lineage (`617cc7f` $\to$ `282a303`) & Verification Honesty Policy | Updated in `R2.1.2-R1` |
| **`11`** | [`11_BLUEPRINT_R2_TO_R2_1_CHANGELOG.md`](./11_BLUEPRINT_R2_TO_R2_1_CHANGELOG.md) | Historical Changelog: Blueprint `R2` $\to$ `R2.1` | Historical Record (Immutable) |
| **`12`** | [`12_BLUEPRINT_R2_1_TO_R2_1_1_CHANGELOG.md`](./12_BLUEPRINT_R2_1_TO_R2_1_1_CHANGELOG.md) | Historical Changelog: Blueprint `R2.1` $\to$ `R2.1.1` | Historical Record (Immutable) |
| **`13`** | [`13_BLUEPRINT_R2_1_1_TO_R2_1_2_CHANGELOG.md`](./13_BLUEPRINT_R2_1_1_TO_R2_1_2_CHANGELOG.md) | Historical Changelog: Blueprint `R2.1.1` $\to$ `R2.1.2` | Historical Record (Immutable) |
| **`14`** | [`14_BLUEPRINT_R2_1_2_TO_R2_1_2_R1_CHANGELOG.md`](./14_BLUEPRINT_R2_1_2_TO_R2_1_2_R1_CHANGELOG.md) | **Authoritative Changelog: Blueprint `R2.1.2` $\to$ `R2.1.2-R1`** | **New in `R2.1.2-R1`** |

---

## 2. Architecture Decision Records (`plan/decisions/`)

* [`ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md`](./decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md) — Python 3.12 Computational Authority vs. Next.js 15 Presentation Shell
* [`ADR-002_CANONICAL_WORLD_MODEL_AND_REVISIONS.md`](./decisions/ADR-002_CANONICAL_WORLD_MODEL_AND_REVISIONS.md) — Canonical Fashion World Model, Coordinate Frame & Immutable Revisions
* [`ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md`](./decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md) — Deterministic Geometry, Exact Topology & Manufacturing Safety Gates (`R2.1.2-R1`)
* [`ADR-004_AI_EPISTEMIC_DISCIPLINE_AND_RECIPE_COMPILATION.md`](./decisions/ADR-004_AI_EPISTEMIC_DISCIPLINE_AND_RECIPE_COMPILATION.md) — AI Epistemic Discipline & Constrained Recipe Compilation
* [`ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md`](./decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md) — 3-Tier Material Physics & Benchmarks `B1`–`B4` 3D Drape Qualification
* [`ADR-006_BOUNDED_OPTIMIZATION_AND_INDEPENDENT_VALIDATION.md`](./decisions/ADR-006_BOUNDED_OPTIMIZATION_AND_INDEPENDENT_VALIDATION.md) — Bounded Optimization, Marker Nesting & Independent Validation
* [`ADR-007_COMMERCIAL_ECOSYSTEM_AND_OFFER_GOVERNANCE.md`](./decisions/ADR-007_COMMERCIAL_ECOSYSTEM_AND_OFFER_GOVERNANCE.md) — Commercial Ecosystem, Maker Network & Offer Governance
* [`ADR-008_FINANCIAL_TRANSACTION_MODEL.md`](./decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md) — Financial Transaction Model & Double-Entry Escrow Sub-Ledger
* [`ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md`](./decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md) — **Numerical Certification, Offset Differential Geometry, 5-Way $Q(t^*)=0$ Singularity Classification, 6 Offset Categories & 17-Family Adversarial Suite (`R2.1.2-R1`)**

---

## 3. Engineering Workload Specifications (`plan/workloads/M00` – `M10`)

* [`M00_MIGRATION_PREPARATION.md`](./workloads/M00_MIGRATION_PREPARATION.md) — Pre-Migration Verification, Contracts, `IntervalLibraryQualificationReport` & `C1-Cert` Reference Oracle (`Updated in R2.1.2-R1`)
* [`M01_CANONICAL_FOUNDATION_AND_SECURITY.md`](./workloads/M01_CANONICAL_FOUNDATION_AND_SECURITY.md) — Monorepo, FastAPI + Next.js 15 Strangler Proxy & Security/Persistence Foundation
* [`M02_DETERMINISTIC_FASHION_ENGINE.md`](./workloads/M02_DETERMINISTIC_FASHION_ENGINE.md) — Deterministic 2D Fashion & Computational Geometry Engine (`M02a`–`M02h`, `Updated in R2.1.2-R1`)
* [`M03_MATERIAL_AND_FABRIC_MECHANICS.md`](./workloads/M03_MATERIAL_AND_FABRIC_MECHANICS.md) — Material Physics Characterization & Fabric Digital Twin Library
* [`M04_AI_VISION_AND_WORLD_MODEL.md`](./workloads/M04_AI_VISION_AND_WORLD_MODEL.md) — Constrained Generative Design Copilot & Fashion World Model Integration
* [`M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md`](./workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md) — DXF-AAMA Export, `M05.3` Pre-Flight Gatekeeper & `Ed25519`-Signed Tech Packs (`Updated in R2.1.2-R1`)
* [`M06_SIMULATION_FIT_AND_OPTIMIZATION.md`](./workloads/M06_SIMULATION_FIT_AND_OPTIMIZATION.md) — 3D Digital Assembly, Drape Solver (`B1`–`B4`) & Strain/Fit Optimization
* [`M07_MAKER_NETWORK_AND_TRACEABILITY.md`](./workloads/M07_MAKER_NETWORK_AND_TRACEABILITY.md) — Maker Network Routing, Fit Intelligence & Traceability
* [`M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md`](./workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md) — E-Commerce, Order State Machine & Double-Entry Escrow Sub-Ledger
* [`M09_COMMERCIAL_PILOT.md`](./workloads/M09_COMMERCIAL_PILOT.md) — Micro-Factory Manufacturing Execution & Commercial Capsule Pilot
* [`M10_ADVANCED_GOVERNANCE_AND_SCALE.md`](./workloads/M10_ADVANCED_GOVERNANCE_AND_SCALE.md) — Observability, Deterministic Replay, Multi-Tenant Governance & Scale (`M10`/`M11`)
