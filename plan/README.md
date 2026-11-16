# Patroner — Blueprint Revision 2.2 (`plan/`) Master Index

**Current Planning Baseline:** `Blueprint Revision 2.2` (`docs/r2.2-unified-execution-blueprint`, layered cleanly above immutable `R2.1.2-R1`)  
**Repository Baseline Anchor:** `origin/main` `1221eb05497a59e52c4af851614085748c92a2d1` (`R2.1.2-R1` Complete: `6938f808629276fd1b0860fba407b42f5cb40aaf`; Recovery Anchor: `282a303ea1126fb3b1da368e4e8e4ddbeb59c552`; `R2.1.2`: `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3`; `R2.1.1`: `8805140b1e6e7799922348369d7e29881102a75e`; `R2.1`: `617cc7f5d9e41b8cd55ed96b64d2363cdb29557b`)  
**Scope Envelope:** Strictly **`M00`–`M10`** (Full Patroner Vision through **31 March 2027**; zero `M11` scope)  
**Governance Status:** **`GATE AUTH-1` APPROVED (`Checkpoint 12`, `2026-11-16`) — `M00` AUTHORIZED & VERIFIED ON WORKSTREAM BRANCHES (`d1a7940`, `d5a7075`); `GATE AUTH-2`, `DEC-13 STAGE 2`, AND `M01`–`M10` PRODUCTION CUTOVER REMAIN CLOSED PENDING OWNER SIGN-OFF**

> **Mandatory Governance Boundary (`R2.2`):** Documents `00`–`14` and `ADR-001`–`ADR-009` preserve immutable `R2.1.2-R1` history; Document `15` (`15_R2.2_CROSS_DOCUMENT_RECONCILIATION_MATRIX.md`) governs all cross-document harmonization (`M00`–`M10` scope, `services/geometry-engine/` layout, `AG-15` Krawczyk & `mpmath.iv` assurance bounds, and `M00.7`/`M00.8` blockers).

---

## 1. Core Blueprint Architecture, Governance & Execution Documents (`00` – `18`)

| Doc # | Document Path | Title & Scope | Revision Status |
| :--- | :--- | :--- | :--- |
| **`00`** | [`00_BLUEPRINT_REVISION_2.md`](./00_BLUEPRINT_REVISION_2.md) | Master Architecture, Mathematical Invariants & Execution Roadmap (`M00`–`M10` under `R2.2` overlay) | Historical `R2.1.2-R1` (Reconciled via Doc `15`) |
| **`01`** | [`01_SOURCE_REGISTER_AND_REQUIREMENTS.md`](./01_SOURCE_REGISTER_AND_REQUIREMENTS.md) | Governing Source Register, Precedence Hierarchy & Dossiers 01–16 Reconciliation | Historical `R2.1.2-R1` (Reconciled via Doc `15`) |
| **`02`** | [`02_ARCHITECTURE_DECISIONS.md`](./02_ARCHITECTURE_DECISIONS.md) | Master Index & Summary of Architecture Decision Records (`ADR-001`–`ADR-009`) | Historical `R2.1.2-R1` (Reconciled via Doc `15`) |
| **`03`** | [`03_REPOSITORY_BASELINE_AND_AUDIT.md`](./03_REPOSITORY_BASELINE_AND_AUDIT.md) | Repository Baseline Inventory, Prototype Audit & Technical Debt Register | Baseline `R2.1` |
| **`04`** | [`04_MIGRATION_AND_PARITY_POLICY.md`](./04_MIGRATION_AND_PARITY_POLICY.md) | Prototype Disposition, `C0-Legacy`/`C1-Fast`/`C1-Cert` Hierarchy & 17-Family Parity Suite | Historical `R2.1.2-R1` (Reconciled via Doc `15`) |
| **`05`** | [`05_WORKLOAD_DEPENDENCY_GRAPH.md`](./05_WORKLOAD_DEPENDENCY_GRAPH.md) | 4-Gate Topology, 4-Stage `DEC-13` Lifecycle & Reconciled `DEC-01`–`DEC-13` Matrix | Historical `R2.1.2-R1` (Reconciled via Doc `15`) |
| **`06`** | [`06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`](./06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md) | Quantitative Acceptance Thresholds, 6 Canonical Offset Categories & `AG-01`–`AG-17` Matrix | Historical `R2.1.2-R1` (Reconciled via Doc `15`) |
| **`07`** | [`07_RISK_AND_OPEN_DECISIONS_REGISTER.md`](./07_RISK_AND_OPEN_DECISIONS_REGISTER.md) | Risk Register (`RISK-01`–`RISK-12`), Checkpoint 12 `Gate Auth-1` Record & Open Decisions (`DEC-02`–`DEC-13 Stage 2`) | Updated in `R2.1.2-R1` (`Checkpoint 12`) |
| **`08`** | [`08_VERTICAL_SLICE_DEFINITION.md`](./08_VERTICAL_SLICE_DEFINITION.md) | Vertical Slice 1 Specification (Bodice + Trouser + Sleeve + Skirt E2E CAD to Signed DXF-AAMA; `trouser-block.ts` gap tracked in Doc `15`/`18`) | Historical `R2.1.2-R1` (Reconciled via Doc `15`) |
| **`09`** | [`09_COMMERCIAL_PILOT_DEFINITION.md`](./09_COMMERCIAL_PILOT_DEFINITION.md) | Commercial Capsule Pilot Definition, Micro-Factory Execution & Escrow Flow | Baseline `R2.1` |
| **`10`** | [`10_RELEASE_AND_GOVERNANCE_POLICY.md`](./10_RELEASE_AND_GOVERNANCE_POLICY.md) | Release Governance, Git Lineage (`617cc7f` $\to$ `6938f80`) & Verification Honesty Policy | Updated in `R2.1.2-R1` (`Checkpoint 12`) |
| **`11`** | [`11_BLUEPRINT_R2_TO_R2_1_CHANGELOG.md`](./11_BLUEPRINT_R2_TO_R2_1_CHANGELOG.md) | Historical Changelog: Blueprint `R2` $\to$ `R2.1` | Historical Record (Immutable) |
| **`12`** | [`12_BLUEPRINT_R2_1_TO_R2_1_1_CHANGELOG.md`](./12_BLUEPRINT_R2_1_TO_R2_1_1_CHANGELOG.md) | Historical Changelog: Blueprint `R2.1` $\to$ `R2.1.1` | Historical Record (Immutable) |
| **`13`** | [`13_BLUEPRINT_R2_1_1_TO_R2_1_2_CHANGELOG.md`](./13_BLUEPRINT_R2_1_1_TO_R2_1_2_CHANGELOG.md) | Historical Changelog: Blueprint `R2.1.1` $\to$ `R2.1.2` | Historical Record (Immutable) |
| **`14`** | [`14_BLUEPRINT_R2_1_2_TO_R2_1_2_R1_CHANGELOG.md`](./14_BLUEPRINT_R2_1_2_TO_R2_1_2_R1_CHANGELOG.md) | Historical Changelog: Blueprint `R2.1.2` $\to$ `R2.1.2-R1` | Historical Record (Immutable) |
| **`15`** | [`15_R2.2_CROSS_DOCUMENT_RECONCILIATION_MATRIX.md`](./15_R2.2_CROSS_DOCUMENT_RECONCILIATION_MATRIX.md) | **`R2.2` Governing Cross-Document Reconciliation Matrix & Audit Remediation Overlay** | **New in `R2.2` (Authoritative)** |
| **`16`** | [`16_UNIFIED_EXECUTION_SCHEDULE.md`](./16_UNIFIED_EXECUTION_SCHEDULE.md) | **Resource-Loaded `M00`–`M10` Schedule Through `2027-03-31` (Target, Risk-Adjusted & Recovery)** | **New in `R2.2` (Authoritative)** |
| **`17`** | [`17_GEMINI4_WORKLOAD_EXECUTION_PROTOCOL.md`](./17_GEMINI4_WORKLOAD_EXECUTION_PROTOCOL.md) | **Automated Workload Execution, Branch Isolation, `uv --locked` Deterministic CI & Fail-Closed Assurance Protocol** | **New in `R2.2` (Authoritative)** |
| **`18`** | [`18_REQUIREMENT_IMPLEMENTATION_EVIDENCE_TRACEABILITY.md`](./18_REQUIREMENT_IMPLEMENTATION_EVIDENCE_TRACEABILITY.md) | **Requirement-to-Implementation-to-Evidence Traceability & Shared `R2.2` Execution Register** | **New in `R2.2` (Authoritative)** |

---

## 2. Architecture Decision Records (`plan/decisions/`)

* [`ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md`](./decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md) — Python 3.12 Computational Authority (`services/geometry-engine/`) vs. Next.js 15 Presentation Shell (`apps/web/`)
* [`ADR-002_CANONICAL_WORLD_MODEL_AND_REVISIONS.md`](./decisions/ADR-002_CANONICAL_WORLD_MODEL_AND_REVISIONS.md) — Canonical Fashion World Model, Coordinate Frame & Immutable Revisions
* [`ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md`](./decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md) — Deterministic Geometry, Exact Topology & Manufacturing Safety Gates (`R2.1.2-R1`)
* [`ADR-004_AI_EPISTEMIC_DISCIPLINE_AND_RECIPE_COMPILATION.md`](./decisions/ADR-004_AI_EPISTEMIC_DISCIPLINE_AND_RECIPE_COMPILATION.md) — AI Epistemic Discipline & Constrained Recipe Compilation
* [`ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md`](./decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md) — 3-Tier Material Physics & Benchmarks `B1`–`B4` 3D Drape Qualification
* [`ADR-006_BOUNDED_OPTIMIZATION_AND_INDEPENDENT_VALIDATION.md`](./decisions/ADR-006_BOUNDED_OPTIMIZATION_AND_INDEPENDENT_VALIDATION.md) — Bounded Optimization, Marker Nesting & Independent Validation
* [`ADR-007_COMMERCIAL_ECOSYSTEM_AND_OFFER_GOVERNANCE.md`](./decisions/ADR-007_COMMERCIAL_ECOSYSTEM_AND_OFFER_GOVERNANCE.md) — Commercial Ecosystem, Maker Network & Offer Governance
* [`ADR-008_FINANCIAL_TRANSACTION_MODEL.md`](./decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md) — Financial Transaction Model & Double-Entry Escrow Sub-Ledger
* [`ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md`](./decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md) — **Numerical Certification, Offset Differential Geometry, 5-Way $Q(t^*)=0$ Singularity Classification, Canonical 6 Offset Categories & 17-Family Adversarial Suite (`R2.1.2-R1`, Krawczyk `AG-15` & `mpmath.iv` assurance reconciled via Doc `15`)**

---

## 3. Engineering Workload Specifications (`plan/workloads/M00` – `M10` Strictly)

* [`M00_MIGRATION_PREPARATION.md`](./workloads/M00_MIGRATION_PREPARATION.md) — Pre-Migration Verification, Contracts, `IntervalLibraryQualificationReport`, `C1-Cert` Reference Oracle & `M00.7`/`M00.8` Blockers
* [`M01_CANONICAL_FOUNDATION_AND_SECURITY.md`](./workloads/M01_CANONICAL_FOUNDATION_AND_SECURITY.md) — Monorepo (`apps/web`, `services/geometry-engine`, `packages/contracts`), FastAPI + Next.js 15 Strangler Proxy & Security/Persistence Foundation
* [`M02_DETERMINISTIC_FASHION_ENGINE.md`](./workloads/M02_DETERMINISTIC_FASHION_ENGINE.md) — Deterministic 2D Fashion & Computational Geometry Engine (`M02a`–`M02h`, including `trouser-block` & `sleeve-block` `M02b` ease solve)
* [`M03_MATERIAL_AND_FABRIC_MECHANICS.md`](./workloads/M03_MATERIAL_AND_FABRIC_MECHANICS.md) — Material Physics Characterization & Fabric Digital Twin Library
* [`M04_AI_VISION_AND_WORLD_MODEL.md`](./workloads/M04_AI_VISION_AND_WORLD_MODEL.md) — Constrained Generative Design Copilot & Fashion World Model Integration
* [`M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md`](./workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md) — DXF-AAMA Export, External CAM Interoperability, `M05.3` Pre-Flight Gatekeeper & `Ed25519`-Signed Tech Packs
* [`M06_SIMULATION_FIT_AND_OPTIMIZATION.md`](./workloads/M06_SIMULATION_FIT_AND_OPTIMIZATION.md) — 3D Digital Assembly, Drape Solver (`B1`–`B4`) & Strain/Fit Optimization
* [`M07_MAKER_NETWORK_AND_TRACEABILITY.md`](./workloads/M07_MAKER_NETWORK_AND_TRACEABILITY.md) — Maker Network Routing, Fit Intelligence & Traceability
* [`M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md`](./workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md) — E-Commerce, Order State Machine & Double-Entry Escrow Sub-Ledger
* [`M09_COMMERCIAL_PILOT.md`](./workloads/M09_COMMERCIAL_PILOT.md) — Micro-Factory Manufacturing Execution & Commercial Capsule Pilot
* [`M10_ADVANCED_GOVERNANCE_AND_SCALE.md`](./workloads/M10_ADVANCED_GOVERNANCE_AND_SCALE.md) — Observability, Deterministic Replay, Multi-Tenant Governance & SRE Completion (`M10` Final Target: `2027-03-31`)
