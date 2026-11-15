# 02 — Architecture Decisions & System-of-Systems Boundary

- **Governing Authorities:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 09–11`, `App. A`), `Patroner_Architecture_Correction_Addendum_v4.1.pdf`, `Patroner_Architecture_Revision_v4.5.pdf`, Dossiers 01–16
- **Purpose:** Define the macro-architecture of Patroner, separate **Approved** architecture decisions from **Proposed** implementation decisions requiring sign-off, and index `ADR-001` through `ADR-008`.

---

## 1. System-of-Systems Architecture Overview

Patroner is architected as a **two-application modular system** (`Addendum v4.1`, `v5.16 Ch. 10, p. 17–18`):

1. **Authoritative Computational & AI System (`apps/patroner-core` — Python):**
   - Owns the canonical **Fashion World Model** (`Dossier 01`), identity/tenant/resource policy enforcement (`Dossier 16`), workflow orchestration and `EnginePlan` execution (`Dossier 02`), multimodal AI perception and `GarmentIntentSpecification` compilation (`Dossiers 07 & 08`), deterministic geometry/drafting/assembly/grading (`Dossiers 03, 08, 13`), material mechanics and ease (`Dossiers 04 & 09`), 3D body/avatar representation, cloth simulation, fit evaluation, and bounded Pareto optimization (`Revision v4.5`, `Dossiers 05, 10, 11, 12`), production documentation and shop-floor traceability (`Dossiers 14 & 15`), and the commercial offer and double-entry financial transaction engine (`v5.16 Ch. 12`).
2. **User-Facing Experience Platform (`apps/patroner-web` — Next.js):**
   - Owns the Consumer Fashion Studio, Professional Pattern/Engineering Workspace, Brand Studio, Marketplace Storefront, Workshop Portal, and Admin/Finance surfaces (`v5.16 Ch. 10, p. 17`).
   - Renders 2D SVG CAD geometry, 3D diagnostic viewports, measurement intake forms, diff/lineage graphs, and production tech packs exclusively from versioned DTOs returned by `patroner-core`.
   - Performs local viewport interaction calculations (zoom, pan, hover hit-testing, client-side form syntax pre-checks) **without ever acting as an authority for pattern geometry, grading, validation, fit qualification, authorization, or production approval**.

---

## 2. Nine-Layer Control Boundary Matrix (`v5.16 Ch. 10, p. 17`)

| Layer | Owning Runtime | Primary Responsibilities | Non-Negotiable Control Boundary |
|---|---|---|---|
| **1. Experience Layer** | **Next.js (`patroner-web`)** | Consumer studio, professional CAD workspace, Brand Studio, storefront, workshop portal, admin views. | UI never decides authorization, technical validity, fit qualification, or release readiness. |
| **2. Identity, Tenant & Policy** | **Python (`patroner-core/security`)** + Next.js Session BFF | Principals (`Person`), `Organizations`, `Tenants`, `Memberships`, RBAC+ABAC grants, workshop time-bounded grants, consent, audit logs. | Deny by default; enforce object-level and property-level access server-side on every request and background job. |
| **3. Canonical World Model** | **Python (`patroner-core/world_model`)** + PostgreSQL | `FashionProject`, `BrandProject`, revisions, current heads, 13-stage dependency DAG, provenance manifests. | Single source of record; append-only immutable revisions; stale descendants automatically flagged and blocked from reuse. |
| **4. AI & Vision Services** | **Python (`patroner-core/ai`)** | Reference image & brief interpretation, visible attribute extraction, `GarmentIntentSpecification`, model routing, capability registry. | Outputs are strictly candidate proposals with calibrated uncertainty and source trace; never auto-promoted to geometry or measurements. |
| **5. Deterministic Engines** | **Python (`patroner-core/{geometry,measurements,recipes,drafting,assembly,grading,materials,manufacturing}`)** | Anthropometrics, 2D curves/topology, garment recipes, drafting, darts, seam/assembly layout, grading (`XS`–`XXL`), material ease, piece production sheets, BOM. | Typed contracts, deterministic execution, conservative numerical error bounds, and garment-specific rules; operates without AI. |
| **6. Simulation, Fit & Optimization** | **Python (`patroner-core/{body_avatar,simulation,fit_optimization}`)** | Parametric body/scan representation, 3D cloth/contact solver adapters, regional fit evaluation, bounded Pareto optimization. | Solvers execute only within calibrated material/pose domains; non-convergence fails closed; optimizer obeys hard constraints and requires human approval. |
| **7. Independent Evaluation & Evidence** | **Python (`patroner-core/validation`)** | Independent geometry, topology, continuous offset, seam, grading, simulation credibility, physical sample, and release-gate evaluators. | Strictly separated from generators/optimizers; scoped validation reports what was tested and what remains unassessed; no automatic cross-level promotion. |
| **8. Orchestration & APIs** | **Python (`patroner-core/orchestrator`)** | Intake validation, `EnginePlan` compilation, job state machines, idempotency, bounded retries, cancellation, artifact publication. | Re-verifies principal & tenant permissions at job execution start and before output publication. |
| **9. Commerce, Operations & Learning** | **Python (`patroner-core/{maker_network,shop_floor,commerce,ledger,learning}`)** | Maker qualification, quotes, samples, `ProductOffer`, work orders, inspections, double-entry financial ledger, permissioned quality/demand learning. | Explicit 8-role offer responsibility; Patroner Own Label isolated as a separate tenant/P&L; purpose-limited, opt-in learning safeguards. |

---

## 3. Register of Architecture Decision Records (`decisions/ADR-001` – `ADR-008`)

Per `Blueprint Revision 2 §11 & §14`, every ADR explicitly distinguishes **APPROVED** architectural mandates (established by `v5.16`, `Addendum v4.1`, `Revision v4.5`, and `Dossiers 01–16`) from **PROPOSED** technology/implementation selections requiring engineering governance sign-off:

| ADR ID | Title | Governance Status | Summary of Decision & Open Choices |
|---|---|---|---|
| [**ADR-001**](./decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md) | Authoritative System Boundary (Python System of Systems & Next.js Platform) | **APPROVED** (`Addendum v4.1`, `v5.16 Ch. 10`) | Python owns all authoritative domain computation, AI reasoning, validation, and artifact generation; Next.js owns presentation and user interaction. |
| [**ADR-002**](./decisions/ADR-002_RUNTIME_AND_DEPLOYMENT_TOPOLOGY.md) | Runtime and Deployment Topology | **APPROVED** (Modular Monolith First) / **PROPOSED** (Specific Framework & Queue Selection) | Deploy one modular Python service and one Next.js service backed by relational DB and private object storage. Recommends Python 3.12 + FastAPI + Pydantic v2 + SQLAlchemy 2.0 + PostgreSQL 16 + S3-compatible storage, subject to M01/M04 vertical-slice validation. |
| [**ADR-003**](./decisions/ADR-003_DOMAIN_SYSTEM_OF_RECORD.md) | Domain System of Record, Immutable Revisions & Dependency Invalidation | **APPROVED** (`Dossier 01`, `v5.16 App. A1`) | Separate current-head pointers from immutable append-only revision snapshots; bind SHA-256 content & dependency fingerprints; propagate `stale` status across the dependency DAG on any upstream change. |
| [**ADR-004**](./decisions/ADR-004_API_AND_CONTRACT_VERSIONING.md) | API, Contract Versioning, Canonical Serialization & `EnginePlan` Orchestration | **APPROVED** (Contract Boundary & `EnginePlan`) / **PROPOSED** (RFC 8785 JCS Wire Standard) | Explicit versioned DTO contracts (`extra='forbid'`), idempotency keys on all mutating/job requests, deterministic RFC 8785 JCS JSON canonicalization for cross-language SHA-256 parity. |
| [**ADR-005**](./decisions/ADR-005_LEGACY_ENGINE_MIGRATION_POLICY.md) | Legacy TypeScript Engine Migration & Dual-Class Fixture Policy | **PROPOSED FOR APPROVAL** | Prohibits mechanical TS-to-Python translation; defines **Class A (Legacy Reference)** vs **Class B (Normative)** fixtures; requires independent mathematical/domain verification and explicit `engineVersion` increments when fixing legacy defects. |
| [**ADR-006**](./decisions/ADR-006_SECURITY_AND_TENANT_MODEL.md) | Multi-Tenant Security, Identity, RBAC+ABAC & Artifact Governance | **APPROVED** (`Dossier 16`, `v5.16 Ch. 16, App. A13–A14`) | Foundational in `M01`: single `Person` identity with multi-org/tenant `Memberships`, deny-by-default RBAC+ABAC (`8` action verbs), PostgreSQL RLS + application policy enforcement, job re-authorization, and sandboxed uploads. |
| [**ADR-007**](./decisions/ADR-007_EVIDENCE_AND_RELEASE_GOVERNANCE.md) | Technical Trust, Orthogonal Evidence Classes & Production Release Governance | **APPROVED** (`Revision v4.5`, `v5.16 Ch. 09, App. B, App. F`) | Enforces the 8-state realization lifecycle, 12 orthogonal acceptance dimensions, non-promotion between evidence tiers, and `isProductionReady: false` until physical sample, maker feasibility, security, and commercial gates pass. |
| [**ADR-008**](./decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md) | Double-Entry Financial Transaction Architecture & Commercial Role Separation | **APPROVED** (Role & Metric Separation) / **PROPOSED** (Double-Entry Ledger Schema) | Implements an immutable double-entry general ledger with balanced journal postings supporting Principal, Marketplace, Managed Agent, and JV models, strictly separating GMV, Net Sales, Platform Revenue, Maker Payouts, Creator Earnings, Contribution, and Operating Profit. |
