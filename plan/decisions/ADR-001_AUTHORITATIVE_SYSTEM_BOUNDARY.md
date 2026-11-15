# ADR-001 — AUTHORITATIVE SYSTEM BOUNDARY & DOSSIER RECONCILIATION (PYTHON SYSTEM OF SYSTEMS + NEXT.JS PLATFORM)

- **ADR ID:** `ADR-001`
- **Revision:** `2.1` (Controlled Architecture, Dependency, Numerical Assurance & Release-Governance Correction)
- **Status:** Accepted & Mandatory (`Supersedes Only Incompatible Historical TS/Node.js/Prisma/Wasm Implementation Assumptions in Dossier 02 v5.0 & Dossier 04 v5.2 While Preserving All Normative Domain Requirements`)
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Architecture_Correction_Addendum_v4.1.pdf`, `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 04`, `Ch. 10`), `Dossier 02 v5.0`, `Dossier 04 v5.2`, `REQ-ARCH-01`, `REQ-ARCH-02`, `CNF-001`, `CNF-005`

---

## 1. Context & Problem Statement
The current Patroner repository (`commit e9d99cb4afc54057850f920dc909b23ebde86f1f`) is implemented as a client-side React/Vite TypeScript single-package prototype (`src/engine/*`) where 2D pattern drafting, Gauss–Legendre arc-length quadrature, Green's theorem area integration, multi-size grading, piece-production-sheet construction, and SHA-256 provenance hashing execute in TypeScript. Furthermore, earlier drafts of `Dossier 02 v5.0` (API Workflows & Orchestration) and `Dossier 04 v5.2` (Material & Fabric Mechanics) referenced historical TypeScript/Node.js/Prisma/Wasm implementation assumptions.

However, `Patroner_Architecture_Correction_Addendum_v4.1.pdf` and `v5.16 Ch. 10` explicitly establish that **Python is Patroner's authoritative AI and computational System of Systems**, while **Next.js is the user-facing platform**. At the same time, per Non-Negotiable Governance (`§2.4`) and Correction 07 (`§9`), `Addendum v4.1` **does not discard the normative engineering requirements** of `Dossier 02 v5.0` or `Dossier 04 v5.2`.

---

## 2. Decision
1. **Python (`services/fashion-engine`, Python 3.12+ / FastAPI) is the sole authoritative computational system.** It owns:
   - The Fashion World Model, append-only revision DAG, async job state machine, and RFC 8785 SHA-256 + Ed25519 provenance (`M01`),
   - All deterministic computational geometry, parametric blocks, style operators, seam allowances, multi-size grading, and deterministic marker nesting (`M02a`–`M02h`),
   - Material characterization, constitutive calibration, and conditioning-aware geometry compensation (`M03`),
   - Multimodal AI design interpretation and intent disambiguation (`M04a`) plus controlled recipe compilation and engine integration (`M04b`),
   - Piece production sheets, industrial tech packs, and calibrated DXF-AAMA / PDF exports (`M05`),
   - 3D cloth simulation, avatar fit evaluation, and bounded pattern optimization (`M06`),
   - Maker qualification, sample approval, shop-floor traceability (`M07`), and ISO 4217 multi-currency double-entry financial ledgering (`M08`).
2. **Next.js (`apps/web`, Next.js 15 App Router) is the user-facing platform and presentation layer.** It owns:
   - User interaction, workspace layout, 2D SVG / 3D `glTF` viewport rendering, disambiguation drawers, and authenticated BFF proxy routing.
   - **Prohibition:** `apps/web` is strictly forbidden from executing authoritative pattern math, grading, offset generation, marker nesting, simulation physics, or provenance digest calculation.
3. **Explicit Dossier 02 v5.0 & Dossier 04 v5.2 Reconciliation (`Correction 07`, `01_SOURCE_REGISTER_AND_REQUIREMENTS.md §2.3`):**
   - `Addendum v4.1` supersedes **only** the historical language/framework assumptions (`Node.js`/`Express`/`tRPC`/`Prisma`/`BullMQ`/client-side `Wasm`) in `Dossier 02 v5.0` and `Dossier 04 v5.2`.
   - **100% of the normative engineering requirements** of `Dossier 02 v5.0` (`DOS-02-R1`–`R7`: `Idempotency-Key` SHA-256 payload binding, optimistic concurrency via `expected_head_revision_id`, async job state machine `QUEUED`→`RUNNING`→`SUCCEEDED`|`FAILED`|`CANCELLED`|`SUPERSEDED`, automatic staleness propagation, RFC 9457 Problem Details, and tenant RBAC) and `Dossier 04 v5.2` (`DOS-04-R1`–`R6`: separation of `RawFabricObservation` vs. `CalibratedMaterialSpec`, warp/weft/bias orthotropic symmetry + positive-definiteness `det(C_2D) > 0`, `TIER_1_LAB`/`TIER_2_BENCHTOP`/`TIER_3_PRIOR` evidence gating, directional relaxation shrinkage `shrinkage_warp_pct`/`shrinkage_weft_pct`, and grainline feasibility constraints) remain **mandatory** and are implemented in `services/fashion-engine` (`M01` and `M03`).
4. **Modular Monolith First:** Begin with one modular Python service (`services/fashion-engine`) and one Next.js application (`apps/web`) communicating over explicit OpenAPI 3.1 / JSON Schema contracts (`packages/contracts`). Do not split into distributed microservices until operational metrics in `M10` demonstrate a concrete compute bottleneck.

---

## 3. Consequences & Enforcement
- **Positive:** Eliminates JavaScript/TypeScript floating-point formatting anti-patterns (`DEF-M00-01`, `DEF-M00-06`), unifies numerical computing (`SciPy`/`mpmath`/FEM solvers) and AI (`google-genai`) in Python, preserves every normative API orchestration (`Dossier 02`) and fabric mechanics (`Dossier 04`) safeguard, and guarantees a single server-authoritative security and provenance boundary.
- **Enforcement (`AC-01`, `AC-04`, `AC-07`):** CI AST static analysis fails any build that introduces computational geometry, grading, or provenance exports inside `apps/web`; `M01` and `M03` test suites verify `DOS-02-R1`–`R7` and `DOS-04-R1`–`R6`.
