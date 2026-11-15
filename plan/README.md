# Patroner — Implementation Blueprint Revision 2.1 (`plan/` Master Index)

- **Document ID:** `PATRONER-BP-R2.1-INDEX`
- **Document Status:** Controlled Architecture, Dependency, Numerical Assurance & Release-Governance Correction — **Blueprint Revision 2.1 (`R2.1`)**
- **Prepared Date:** 15 November 2026
- **Governing Strategic Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (05 November 2026)
- **Audited Repository Commit:** `e9d99cb4afc54057850f920dc909b23ebde86f1f` (`main` branch, `https://github.com/bobcris/Patroner-`)
- **Audited Code Commit:** `84fffb1f0676dc14e192bf5106c36a469c54a448` (`feat(geometry): implement conservative error bounds for arc length`)
- **Live Product Inspected:** `https://patroner.ai.studio/` (`Last-Modified: Sat, 07 Nov 2026 22:49:33 GMT`, bundle `/assets/index-BEw1rQa1.js`)
- **Execution Mode:** Documentation and Planning Only (`isProductionReady: false` enforced across all modules; zero application code changes)

---

## 1. Purpose of This Directory

This `plan/` directory contains **Blueprint Revision 2.1 (`R2.1`)**, the controlled correction of Blueprint Revision 2 (`R2`) for **Patroner**.

It preserves the approved strategic vision, governing source hierarchy, **Python / Next.js** authority boundary (`Addendum v4.1`), **Fashion World Model** (`Dossier 01`), closed-loop fit prediction and bounded optimization workflow (`Revision v4.5`), material mechanics (`Dossiers 04 & 09`), manufacturing lifecycle (`Dossiers 14 & 15`), commercial ecosystem (`v5.15` / `v5.16 Ch. 02, 08, 12`), and the `M00`–`M10` roadmap while resolving seven architectural, dependency, numerical-assurance, financial, and release-governance contradictions identified during independent technical review.

### Governing Principle
> **The product vision and approved architecture govern the implementation. Existing code is evidence to evaluate, not an authority that can redefine the product.**

---

## 2. Summary of Controlled Corrections in Blueprint Revision 2.1 (`11_BLUEPRINT_R2_TO_R2_1_CHANGELOG.md`)

1. **Correction 01 — `M04` Dependency Circularity Repaired (`M04a` vs `M04b`):** Separates **`M04a` (Multimodal Perception and Design Intent)**—which depends only on `M01` and executes *before* deterministic drafting—from **`M04b` (Controlled Recipe Compilation and Engine Integration)**, which compiles confirmed `GarmentIntentSpecification` into `GarmentRecipe` / `RecipeOperatorAST` / `DraftPlan` and depends on `M04a`, `M02c`, `M02d`, `M02e`, and `M03`.
2. **Correction 02 — `M02h` and Vertical Slice Reconciled:** Explicitly connects **`M02h` (Deterministic Marker Nesting, Validation & Utilization Reporting)** into the Mermaid dependency graph, concurrency matrix, Critical Path 1, and Vertical Slice Step 12 via an explicit 8-stage geometry-to-tech-pack sequence, distinguishing authoritative digital marker computation from physical plotter/cutter qualification (`AC-10`).
3. **Correction 03 — `M09` / `M10` Release-Gate Circularity Resolved:** Partitions release governance and `v5.16 Appendix F` into three non-circular stages: **Level A (Engineering & Controlled Pilot Entry Release for `M09`)**, **Level B (`M09` Pilot Exit Acceptance from real physical/commercial/financial evidence)**, and **Level C (`M10` Enterprise & Institutional Scale Release)**.
4. **Correction 04 — Numerical Certification Strengthened (`ADR-009`):** Strictly separates (1) **High-Precision Reference Value (`mpmath` `mp.dps=80`)**, (2) **Floating-Point Implementation Error**, (3) **Certified / Rigorously Justified Numerical Error Bound** (derived via interval arithmetic / Bernstein convex-hull / validated remainder enclosure rather than heuristic quadrature step differences), and (4) **Domain Acceptance Tolerance** across all 8 mathematical domains.
5. **Correction 05 — Proof-Quality Continuous Offset Cusp & Reversal Verification (`ADR-009`):** Replaces reliance on a 65-point finite sampling grid alone with a two-tier architecture separating fast detection heuristics from **complete parameter-interval ($t \in [0, 1]$) verification** using Bernstein-basis polynomial positivity bounds, interval arithmetic (`mpmath.iv`), certified subdivision, and validated offset-envelope trimming.
6. **Correction 06 — Multi-Currency & Jurisdiction-Aware Financial Architecture (`M08`, `ADR-008`):** Eliminates fixed 2-decimal currency assumptions by enforcing ISO 4217 currency identity, currency-specific `minor_unit_exponent` (`0`, `2`, `3`, `4`), integer minor-unit storage, explicit rounding policy, immutable FX rate snapshots with provenance, transaction vs. functional/reporting currency dual balances, realized/unrealized FX gain/loss accounts, and explicit separation of the `M09` pilot jurisdiction from future multi-jurisdiction capability.
7. **Correction 07 — Explicit Dossier 02 & Dossier 04 Precedence Reconciliation Matrices:** Preserves 100% of the domain requirements of **Dossier 02 v5.0 (API Workflows & Orchestration)** and **Dossier 04 v5.2 (Material & Fabric Mechanics)** in structured 6-column reconciliation matrices while superseding only incompatible historical runtime assumptions per `Addendum v4.1`.

---

## 3. Master Document Map (`plan/`)

### 3.1 Core Blueprint Documents
| Document Path | Status | Title & Scope |
| :--- | :---: | :--- |
| [`00_BLUEPRINT_REVISION_2.md`](./00_BLUEPRINT_REVISION_2.md) | **Updated (`R2.1`)** | Executive synthesis of Blueprint Revision 2.1, architectural posture, `v5.16` phase mapping (`A`–`G` to `M00`–`M10`), and governing non-negotiables. |
| [`01_SOURCE_REGISTER_AND_REQUIREMENTS.md`](./01_SOURCE_REGISTER_AND_REQUIREMENTS.md) | **Updated (`R2.1`)** | Authoritative source hierarchy, explicit 6-column Dossier 02 & Dossier 04 reconciliation matrices, conflict records (`CNF-001`–`CNF-006`), and canonical requirements register (`REQ-*`). |
| [`02_ARCHITECTURE_DECISIONS.md`](./02_ARCHITECTURE_DECISIONS.md) | **Updated (`R2.1`)** | System-of-systems overview, 9-layer control boundary matrix, and unified index of `ADR-001` through `ADR-009`. |
| [`03_REPOSITORY_BASELINE_AND_AUDIT.md`](./03_REPOSITORY_BASELINE_AND_AUDIT.md) | **Verified (`R2.1`)** | Verified audit of commit `e9d99cb4afc54057850f920dc909b23ebde86f1f` vs. live deployment `https://patroner.ai.studio/` (`07 Nov 2026`), residual defect register (`DEF-M00-01`–`DEF-M00-06`), and capability classifications (`I1`, `I2`, `P`, `D`, `M`, `X`, `R`, `H`). |
| [`04_MIGRATION_AND_PARITY_POLICY.md`](./04_MIGRATION_AND_PARITY_POLICY.md) | **Updated (`R2.1`)** | Non-mechanical migration rule, Dual-Class Fixture Governance (Class A vs. Class B), 4-tier numerical assurance separation, 10-column Mathematical Assurance Matrix across 8 domains, and 13-subsystem disposition matrix. |
| [`05_WORKLOAD_DEPENDENCY_GRAPH.md`](./05_WORKLOAD_DEPENDENCY_GRAPH.md) | **Updated (`R2.1`)** | Corrected Mermaid dependency graph (`M04a`/`M04b` split, `M02h` in Vertical Slice, non-circular `M09`→`M10`), concurrency matrix, critical paths, and deferred capabilities. |
| [`06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`](./06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md) | **Updated (`R2.1`)** | The 12 orthogonal acceptance dimensions (`AC-01`–`AC-12`), 3-level release governance mapping (`Level A`, `Level B`, `Level C`), certified numerical bound rules, and 24-section workload standard. |
| [`07_RISK_AND_OPEN_DECISIONS_REGISTER.md`](./07_RISK_AND_OPEN_DECISIONS_REGISTER.md) | **Updated (`R2.1`)** | Program risk register (`RSK-01`–`RSK-14`) and open architecture/product decisions (`DEC-01`–`DEC-13`) requiring human approval. |
| [`08_VERTICAL_SLICE_DEFINITION.md`](./08_VERTICAL_SLICE_DEFINITION.md) | **Updated (`R2.1`)** | Corrected 14-step end-to-end Vertical Slice specification separating `M04a` (Steps 02–03) and `M04b` (Step 06) and integrating `M02h` 8-stage marker nesting into Step 12. |
| [`09_COMMERCIAL_PILOT_DEFINITION.md`](./09_COMMERCIAL_PILOT_DEFINITION.md) | **Updated (`R2.1`)** | Operational, workshop, multi-currency financial, and Level A/Level B governance plan for the `M09` Commercial Pilot across Tracks P1, P2, and P3. |
| [`10_RELEASE_AND_GOVERNANCE_POLICY.md`](./10_RELEASE_AND_GOVERNANCE_POLICY.md) | **Updated (`R2.1`)** | Canonical 8-state realization lifecycle (`v5.16 Ch. 09`), `isProductionReady: false` invariant, 3-level release governance (`Level A`, `Level B`, `Level C`), and `Appendix F` stage applicability matrix. |
| [`11_BLUEPRINT_R2_TO_R2_1_CHANGELOG.md`](./11_BLUEPRINT_R2_TO_R2_1_CHANGELOG.md) | **Added (`R2.1`)** | Complete traceability changelog from R2 to R2.1 covering all 7 mandatory corrections, cross-document consistency fixes, dependency/acceptance impacts, and unresolved human decisions. |

### 3.2 Executable Workload Specifications (`workloads/`)
| Workload ID | Document Path | `v5.16` Phase | Scope Summary |
| :--- | :--- | :---: | :--- |
| **`M00`** | [`workloads/M00_MIGRATION_PREPARATION.md`](./workloads/M00_MIGRATION_PREPARATION.md) | Pre-Phase A | `M00.1`–`M00.10`: Source inventory, `DEF-M00-01`–`06` regression lock, Class A vs. Class B fixtures, `mpmath` + interval arithmetic (`mpmath.iv`) reference oracles, and contract pipeline. |
| **`M01`** | [`workloads/M01_CANONICAL_FOUNDATION_AND_SECURITY.md`](./workloads/M01_CANONICAL_FOUNDATION_AND_SECURITY.md) | Phase A & D | Canonical Fashion World Model, Dossier 02 orchestration (`EnginePlan`, job state machine, 3-point re-auth), Person/Org/Tenant IAM, RBAC+ABAC, append-only revisions, and signed media. |
| **`M02`** | [`workloads/M02_DETERMINISTIC_FASHION_ENGINE.md`](./workloads/M02_DETERMINISTIC_FASHION_ENGINE.md) | Phase B & C | `M02a` Geometry, `M02b` Topology/Assembly, `M02c` Anthropometry, `M02d` Parametric Blocks, `M02e` Style Operators, `M02f` Certified Seam/Offset/Notch Engine, `M02g` Multi-Size Grading, `M02h` Deterministic Marker Nesting & Validation. |
| **`M03`** | [`workloads/M03_MATERIAL_AND_FABRIC_MECHANICS.md`](./workloads/M03_MATERIAL_AND_FABRIC_MECHANICS.md) | Phase B / C | Reconciled Dossier 04 & Dossier 09: `RawFabricObservation`, `CalibratedMaterialSpec`, orthotropic stiffness/bending, shrinkage/seam take-up, fabric width/grain/nap rules, and positive/negative ease policies. |
| **`M04`** | [`workloads/M04_AI_VISION_AND_WORLD_MODEL.md`](./workloads/M04_AI_VISION_AND_WORLD_MODEL.md) | Phase A / B / C | Split into **`M04a` (Multimodal Perception & Design Intent — pre-drafting)** and **`M04b` (Controlled Recipe Compilation & Engine Integration — post-`M02d`/`M02e`)**, plus Dossier 06 benchmarks. |
| **`M05`** | [`workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md`](./workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md) | Phase B / D | Remediated piece production sheets (`DEF-M00-02`–`05` closed), ISO 4915/4916 seam schedules, sewing `OperationDAG`, `M02h`-linked BOM, graded POM/QC tables, and calibrated DXF-AAMA/PDF exports. |
| **`M06`** | [`workloads/M06_SIMULATION_FIT_AND_OPTIMIZATION.md`](./workloads/M06_SIMULATION_FIT_AND_OPTIMIZATION.md) | Phase C | Parametric avatar vs. 3D scan (`Dossier 11`), orthotropic cloth solver & analytical benchmarks B1–B4 (`Dossier 10`), regional fit evaluation (`Dossier 05`), and bounded Pareto optimization (`Dossier 12`). |
| **`M07`** | [`workloads/M07_MAKER_NETWORK_AND_TRACEABILITY.md`](./workloads/M07_MAKER_NETWORK_AND_TRACEABILITY.md) | Phase D / E | Maker capability qualification, RFQ/quotes/MOQ/capacity, physical sample approval (`Gate G5/G6`), fabric lot traceability, append-only work orders, POM inspections, and closed-loop quality. |
| **`M08`** | [`workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md`](./workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md) | Phase E / F | Platform vs. Own-Label vs. Brand Studio separation, 8-role `ProductOfferContract`, ISO 4217 multi-currency double-entry ledger, FX gain/loss, VAT/tax policy, settlements, and 8 management metrics. |
| **`M09`** | [`workloads/M09_COMMERCIAL_PILOT.md`](./workloads/M09_COMMERCIAL_PILOT.md) | Phase E | Controlled Commercial Pilot execution ($\le 50$ units across Tracks P1, P2, P3) governed by **Level A Entry Gates** and measured by **Level B Pilot Exit Criteria**. |
| **`M10`** | [`workloads/M10_ADVANCED_GOVERNANCE_AND_SCALE.md`](./workloads/M10_ADVANCED_GOVERNANCE_AND_SCALE.md) | Phase F / G | Post-pilot (`Level C`) enterprise scale: repeatable Brand Studio & celebrity recoupment waterfalls, partner APIs, automated GDPR crypto-shredding, BYOK KMS, and multi-region DR drills. |

### 3.3 Architecture Decision Records (`decisions/`)
| ADR ID | Document Path | Governance Status | Title |
| :--- | :--- | :---: | :--- |
| **`ADR-001`** | [`decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md`](./decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md) | **APPROVED** (`Addendum v4.1`, `v5.16 Ch. 10`) | Authoritative System Boundary (Python System of Systems + Next.js Platform) |
| **`ADR-002`** | [`decisions/ADR-002_CANONICAL_WORLD_MODEL_AND_REVISIONS.md`](./decisions/ADR-002_CANONICAL_WORLD_MODEL_AND_REVISIONS.md) | **APPROVED** (`Dossier 01`, `v5.16 Ch. 04, 09`) | Canonical Fashion World Model & Append-Only Revision Graph |
| **`ADR-003`** | [`decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md`](./decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md) | **APPROVED** (`Dossier 03`, `Dossier 14`, `v5.16`) | Deterministic Geometry, Exact Numerical Precision & Manufacturing Safety |
| **`ADR-004`** | [`decisions/ADR-004_AI_EPISTEMIC_DISCIPLINE_AND_RECIPE_COMPILATION.md`](./decisions/ADR-004_AI_EPISTEMIC_DISCIPLINE_AND_RECIPE_COMPILATION.md) | **APPROVED** (`Revision v4.5`, `Dossiers 07 & 08`) | Multimodal AI Epistemic Discipline (`M04a`) & Controlled Recipe Compilation (`M04b`) |
| **`ADR-005`** | [`decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md`](./decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md) | **APPROVED** (`Dossiers 04, 06, 09, 10`) | Material Characterization, Constitutive Calibration & Numerical Credibility |
| **`ADR-006`** | [`decisions/ADR-006_BOUNDED_OPTIMIZATION_AND_INDEPENDENT_VALIDATION.md`](./decisions/ADR-006_BOUNDED_OPTIMIZATION_AND_INDEPENDENT_VALIDATION.md) | **APPROVED** (`Revision v4.5`, `Dossiers 05 & 12`) | Bounded Pattern Optimization & Independent Re-Validation |
| **`ADR-007`** | [`decisions/ADR-007_COMMERCIAL_ECOSYSTEM_AND_OFFER_GOVERNANCE.md`](./decisions/ADR-007_COMMERCIAL_ECOSYSTEM_AND_OFFER_GOVERNANCE.md) | **APPROVED** (`v5.15`, `v5.16 Ch. 02, 08`) | Commercial Ecosystem Separation & 8-Role Offer Governance |
| **`ADR-008`** | [`decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md`](./decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md) | **APPROVED (Policy) / PROPOSED (Multi-Currency Ledger Schema)** | ISO 4217 Multi-Currency Double-Entry Financial Ledger & Multi-Party Settlement Architecture |
| **`ADR-009`** | [`decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md`](./decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md) | **PROPOSED** (Requires Engineering Governance Approval) | Four-Tier Numerical Certification, Interval/Bernstein Bounds & Complete-Interval Offset Verification |
