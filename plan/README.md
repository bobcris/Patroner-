# Patroner — Implementation Blueprint Revision 2 (`plan/` Master Index)

- **Document Status:** Canonical Planning Baseline — Blueprint Revision 2
- **Prepared Date:** 15 November 2026
- **Governing Strategic Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (05 November 2026)
- **Audited Repository Commit:** `e9d99cb4afc54057850f920dc909b23ebde86f1f` (`main` branch, `https://github.com/bobcris/Patroner-`)
- **Audited Code Commit:** `84fffb1f0676dc14e192bf5106c36a469c54a448` (`feat(geometry): implement conservative error bounds for arc length`)
- **Live Product Inspected:** `https://patroner.ai.studio/` (`Last-Modified: Sat, 07 Nov 2026 22:49:33 GMT`, bundle `/assets/index-BEw1rQa1.js`)
- **Execution Mode:** Documentation and Planning Only (`isProductionReady: false` enforced across all modules)

---

## 1. Purpose of This Directory

This `plan/` directory contains **Blueprint Revision 2**, the complete, dependency-aware, independently reviewable implementation and migration programme for **Patroner**.

It translates the governing product vision and architecture—where **Python** is the authoritative computational and AI System of Systems and **Next.js** is the user-facing platform—into eleven top-level workloads (`M00`–`M10` with explicit sub-workloads), eight Architecture Decision Records (`ADR-001`–`ADR-008`), a dual-class fixture and parity governance policy, a 12-dimension acceptance and evidence framework, a narrow end-to-end vertical slice definition, and a commercial pilot specification.

### Governing Principle
> **The product vision and approved architecture govern the implementation. Existing code is evidence to evaluate, not an authority that can redefine the product.**

---

## 2. Reconciliation of Prior Planning State

Prior to Blueprint Revision 2:
1. No `plan/` directory existed in the repository at commit `e9d99cb4afc54057850f920dc909b23ebde86f1f`.
2. Engineering progress had been tracked through commit messages (`11cd45c` through `e9d99cb`), inline code comments (`Milestone 03.1`, `04.1`, `04.3.1`, `04.5`, `04.6.2.3.x`, `05.1`, `05.2.1-R1/R2`), and `v5.16 Appendix B` (`p. 36`).
3. An initial Blueprint Revision 1 assessment was produced in conversation, which treated `M00` as a golden-vector freeze and grouped too much deterministic and security work into coarse milestones.

**Key Corrections Introduced in Blueprint Revision 2 (`00_BLUEPRINT_REVISION_2.md`):**
- **Source Register Correction:** Reconciles **Dossier 02 (v5.0 — API Workflows & Orchestration)** and **Dossier 04 (v5.2 — Material & Fabric Mechanics)**, closing the gap noted in `v5.16 Appendix E (p. 39)`.
- **Dual-Class Fixture Governance:** Replaces uncritical "golden-vector freezing" of legacy TypeScript outputs with strict separation between **Class A: Legacy Reference Fixtures** (descriptive records of what commit `e9d99cb` produced) and **Class B: Normative Fixtures** (independently verified mathematical and domain truth).
- **Controlled `M00` Scope:** Redefines `M00` as a 10-package migration-preparation and reference-verification workload (`M00.1`–`M00.10`) that runs in parallel with `M01` architecture/contract design rather than blocking all Python foundation work.
- **Foundational Security in `M01`:** Moves Person/Organization/Tenant identity, RBAC+ABAC, server-side object/property authorization, background-job re-authorization, upload sandboxing, and cross-tenant isolation tests into **`M01`** so no API or database record is ever built without multi-tenant security.
- **Sub-Workload Decomposition of `M02`:** Splits deterministic fashion engineering into eight independently gated sub-workloads (`M02a`–`M02h`) scoped by capability and garment family rather than a single monolithic port.
- **Balanced Double-Entry Financial Architecture in `M08`:** Distinguishes the 8 management reporting metrics (`v5.16 Ch. 12, p. 22`) from the underlying **double-entry financial transaction engine** (chart of accounts, balanced journal postings, principal-vs-agent recognition, tax/VAT, escrow/settlements, creator payables, maker payouts, refunds, chargebacks, and reconciliation).

---

## 3. Master Document Map

### 3.1 Core Blueprint Documents
| Document Path | Title & Scope |
|---|---|
| [`00_BLUEPRINT_REVISION_2.md`](./00_BLUEPRINT_REVISION_2.md) | Executive synthesis of Blueprint Revision 2, architectural posture, v5.16 phase mapping (`A`–`G` to `M00`–`M10`), and governing non-negotiables. |
| [`01_SOURCE_REGISTER_AND_REQUIREMENTS.md`](./01_SOURCE_REGISTER_AND_REQUIREMENTS.md) | Authoritative source hierarchy, Dossier 02 & 04 register reconciliation, conflict records (`CNF-001`–`CNF-005`), 12 conceptual separations, and canonical requirements register (`REQ-*`). |
| [`02_ARCHITECTURE_DECISIONS.md`](./02_ARCHITECTURE_DECISIONS.md) | Summary of approved vs proposed architectural decisions, system-of-systems layer boundaries, and index of `ADR-001` through `ADR-008`. |
| [`03_REPOSITORY_BASELINE_AND_AUDIT.md`](./03_REPOSITORY_BASELINE_AND_AUDIT.md) | Verified audit of commit `e9d99cb4afc54057850f920dc909b23ebde86f1f` vs live deployment `https://patroner.ai.studio/` (`07 Nov 2026`), module call-graph analysis, residual defect register (`DEF-M00-01`–`DEF-M00-06`), and capability classifications (`I1`, `I2`, `P`, `D`, `M`, `X`, `R`, `H`). |
| [`04_MIGRATION_AND_PARITY_POLICY.md`](./04_MIGRATION_AND_PARITY_POLICY.md) | Subsystem migration disposition matrix, Legacy Reference vs Normative fixture governance, and 7-domain parity rules. |
| [`05_WORKLOAD_DEPENDENCY_GRAPH.md`](./05_WORKLOAD_DEPENDENCY_GRAPH.md) | Mermaid dependency graph across `M00`–`M10` and sub-workloads, parallelization rules, mandatory security gates, and critical path analysis. |
| [`06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`](./06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md) | The 12 orthogonal acceptance dimensions, non-promotion rules, independent verification requirements, and standard 24-section workload gate template. |
| [`07_RISK_AND_OPEN_DECISIONS_REGISTER.md`](./07_RISK_AND_OPEN_DECISIONS_REGISTER.md) | Technical, architectural, physical, security, and commercial risks (`RSK-01`–`RSK-12`) and open decisions (`DEC-01`–`DEC-10`) with required closing evidence. |
| [`08_VERTICAL_SLICE_DEFINITION.md`](./08_VERTICAL_SLICE_DEFINITION.md) | Complete 14-step specification of the Minimum End-to-End Vertical Slice, entry-wedge garment justification, and explicit inclusions/exclusions. |
| [`09_COMMERCIAL_PILOT_DEFINITION.md`](./09_COMMERCIAL_PILOT_DEFINITION.md) | Operational, technical, financial, maker, and governance plan for the `v5.16 Phase E` Commercial Pilot (`M09`), separating Patroner Platform, Patroner Own Label, and Managed Brand Studio. |
| [`10_RELEASE_AND_GOVERNANCE_POLICY.md`](./10_RELEASE_AND_GOVERNANCE_POLICY.md) | Enforcement of `v5.16 Chapter 09` 8-state realization lifecycle, `Appendix F` Master Release Checklist, `isProductionReady: false` invariant, and living-document update protocol. |

### 3.2 Executable Workload Specifications (`workloads/`)
| Workload ID | Document Path | v5.16 Phase | Summary |
|---|---|---|---|
| **M00** | [`workloads/M00_MIGRATION_PREPARATION.md`](./workloads/M00_MIGRATION_PREPARATION.md) | Pre-Phase A / B | 10 work packages (`M00.1`–`M00.10`): commit baseline, residual defect closure/disposition, Python mathematical oracles, Class A & Class B fixtures, and migration ADRs. |
| **M01** | [`workloads/M01_CANONICAL_FOUNDATION_AND_SECURITY.md`](./workloads/M01_CANONICAL_FOUNDATION_AND_SECURITY.md) | Phase A & D | Canonical World Model schemas, units/frames, Person/Org/Tenant IAM, RBAC+ABAC, append-only revisions, 13-stage invalidation DAG, secure uploads/artifacts, and Next.js ↔ Python boundary. |
| **M02** | [`workloads/M02_DETERMINISTIC_FASHION_ENGINE.md`](./workloads/M02_DETERMINISTIC_FASHION_ENGINE.md) | Phase B & C | 8 sub-workloads (`M02a` Geometry, `M02b` Anthropometry, `M02c` Garment Recipes, `M02d` Drafting, `M02e` Topology/Seams, `M02f` Assembly, `M02g` Grading, `M02h` Independent Validation). |
| **M03** | [`workloads/M03_MATERIAL_AND_FABRIC_MECHANICS.md`](./workloads/M03_MATERIAL_AND_FABRIC_MECHANICS.md) | Phase C | Raw textile observations, normalized anisotropic properties, shrinkage/seam take-up, construction-aware ease, negative-ease policies, and solver calibration adapters (`Dossiers 04 & 09`). |
| **M04** | [`workloads/M04_AI_VISION_AND_WORLD_MODEL.md`](./workloads/M04_AI_VISION_AND_WORLD_MODEL.md) | Phase A / B / D | Multimodal design interpretation (`Dossier 07`), visible-vs-hidden separation, epistemic uncertainty, `GarmentIntentSpecification`, recipe compilation (`Dossier 08`), and credibility benchmarks (`Dossier 06`). |
| **M05** | [`workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md`](./workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md) | Phase B / D | Canonical piece production sheets, construction specs, ISO 4915/4916 seam schedules, sewing operation DAG, structured BOM, POM/QC tolerance plans, and `AuthoritativeProductionPackage`. |
| **M06** | [`workloads/M06_SIMULATION_FIT_AND_OPTIMIZATION.md`](./workloads/M06_SIMULATION_FIT_AND_OPTIMIZATION.md) | Phase C | Parametric 3D body vs measured 3D scan (`Dossier 11`), pose semantics, cloth drape/contact solver & numerical credibility (`Dossier 10`), regional fit prediction, and bounded Pareto optimization (`Dossiers 05 & 12`). |
| **M07** | [`workloads/M07_MAKER_NETWORK_AND_TRACEABILITY.md`](./workloads/M07_MAKER_NETWORK_AND_TRACEABILITY.md) | Phase D / E | Workshop capability qualification, RFQ/quotes, capacity/MOQ/lead-time gates, physical sample review protocol (`Dossier 14`), append-only work orders, inspections, defects/rework, and closed-loop quality (`Dossier 15`). |
| **M08** | [`workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md`](./workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md) | Phase E / F | Platform vs Own-Label vs Brand Studio separation, 8-role `ProductOffer` contract, double-entry general ledger & journal engine, principal-vs-agent recognition, settlements, and 8-metric reporting (`v5.16 Ch. 02, 08, 12`). |
| **M09** | [`workloads/M09_COMMERCIAL_PILOT.md`](./workloads/M09_COMMERCIAL_PILOT.md) | Phase E | End-to-end execution of the narrow wedge pilot (Own-Label pilot capsule + Managed Brand Studio creator pilot + Personalized DTC offer) with real workshop sampling, fulfillment, and ledger reconciliation. |
| **M10** | [`workloads/M10_ADVANCED_GOVERNANCE_AND_SCALE.md`](./workloads/M10_ADVANCED_GOVERNANCE_AND_SCALE.md) | Phase F / G | Repeatable self-serve Brand Studio, celebrity/licensed venture controls, enterprise/API white-label isolation, automated retention/deletion, backup restoration drills, and multi-region scale. |

### 3.3 Architecture Decision Records (`decisions/`)
| ADR ID | Document Path | Status | Title |
|---|---|---|---|
| **ADR-001** | [`decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md`](./decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md) | **APPROVED** (by Addendum v4.1 & v5.16) | Python Authoritative Computational/AI System & Next.js Platform Boundary |
| **ADR-002** | [`decisions/ADR-002_RUNTIME_AND_DEPLOYMENT_TOPOLOGY.md`](./decisions/ADR-002_RUNTIME_AND_DEPLOYMENT_TOPOLOGY.md) | **APPROVED (Modular Monolith) / PROVISIONAL (Infra Topology)** | Modular Application Topology & Evidence-Driven Infrastructure Selection |
| **ADR-003** | [`decisions/ADR-003_DOMAIN_SYSTEM_OF_RECORD.md`](./decisions/ADR-003_DOMAIN_SYSTEM_OF_RECORD.md) | **APPROVED** (by Dossier 01 & v5.16) | Canonical Fashion World Model, Immutable Revisions & Selective Invalidation DAG |
| **ADR-004** | [`decisions/ADR-004_API_AND_CONTRACT_VERSIONING.md`](./decisions/ADR-004_API_AND_CONTRACT_VERSIONING.md) | **APPROVED (Principle) / PROPOSED (Wire Schema)** | Typed Versioned Contracts, `EnginePlan` Orchestration & Canonical Serialization |
| **ADR-005** | [`decisions/ADR-005_LEGACY_ENGINE_MIGRATION_POLICY.md`](./decisions/ADR-005_LEGACY_ENGINE_MIGRATION_POLICY.md) | **PROPOSED FOR APPROVAL** | Non-Mechanical Migration & Dual-Class Fixture Governance (Legacy vs Normative) |
| **ADR-006** | [`decisions/ADR-006_SECURITY_AND_TENANT_MODEL.md`](./decisions/ADR-006_SECURITY_AND_TENANT_MODEL.md) | **APPROVED** (by Dossier 16 & v5.16) | Foundational Multi-Tenant IAM, RBAC+ABAC, Job Re-Authorization & Artifact Security |
| **ADR-007** | [`decisions/ADR-007_EVIDENCE_AND_RELEASE_GOVERNANCE.md`](./decisions/ADR-007_EVIDENCE_AND_RELEASE_GOVERNANCE.md) | **APPROVED** (by Revision v4.5 & v5.16) | Orthogonal Evidence Classes, 8-State Realization Lifecycle & `isProductionReady` Gate |
| **ADR-008** | [`decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md`](./decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md) | **APPROVED (Policy) / PROPOSED (Chart of Accounts)** | Double-Entry Financial Transaction Architecture & Principal-vs-Agent Separation |
