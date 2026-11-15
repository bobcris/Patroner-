# ADR-001 — AUTHORITATIVE SYSTEM BOUNDARY (PYTHON SYSTEM OF SYSTEMS + NEXT.JS PLATFORM)

- **ADR ID:** `ADR-001`
- **Status:** Accepted & Mandatory (`Supersedes Dossier 02 v5.0 & Dossier 04 v5.2 TS/Node.js Assumptions`)
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Architecture_Correction_Addendum_v4.1.pdf`, `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 04`, `Ch. 10`), `REQ-ARCH-01`, `REQ-ARCH-02`

---

## 1. Context & Problem Statement
The current Patroner repository (`commit e9d99cb4afc54057850f920dc909b23ebde86f1f`) is implemented as a client-side React/Vite TypeScript single-package prototype (`src/engine/*`) where 2D pattern drafting, Gauss–Legendre arc-length quadrature, Green's theorem area integration, multi-size grading, piece-production-sheet construction, and SHA-256 provenance hashing execute in TypeScript. Furthermore, earlier drafts of `Dossier 02 v5.0` and `Dossier 04 v5.2` referenced TypeScript/Node.js/Prisma/Wasm execution.

However, `Patroner_Architecture_Correction_Addendum_v4.1.pdf` and `v5.16 Ch. 10` explicitly establish that **Python is Patroner's authoritative AI and computational System of Systems**, while **Next.js is the user-facing platform**.

## 2. Decision
1. **Python (`services/fashion-engine`, Python 3.12+ / FastAPI) is the sole authoritative computational system.** It owns:
   - The Fashion World Model, append-only revision DAG, and RFC 8785 SHA-256 + Ed25519 provenance (`M01`),
   - All deterministic computational geometry, parametric blocks, style operators, seam allowances, multi-size grading, and marker nesting (`M02a`–`M02h`),
   - Material characterization and constitutive calibration (`M03`),
   - Multimodal AI design interpretation and controlled recipe compilation (`M04`),
   - Piece production sheets, industrial tech packs, and calibrated DXF-AAMA / PDF exports (`M05`),
   - 3D cloth simulation, avatar fit evaluation, and bounded pattern optimization (`M06`),
   - Maker qualification, sample approval, shop-floor traceability (`M07`), and double-entry financial ledgering (`M08`).
2. **Next.js (`apps/web`, Next.js 15 App Router) is the user-facing platform and presentation layer.** It owns:
   - User interaction, workspace layout, 2D SVG / 3D `glTF` viewport rendering, disambiguation drawers, and authenticated BFF proxy routing.
   - **Prohibition:** `apps/web` is strictly forbidden from executing authoritative pattern math, grading, offset generation, simulation physics, or provenance digest calculation.
3. **Modular Monolith First:** Begin with one modular Python service (`services/fashion-engine`) and one Next.js application (`apps/web`) communicating over explicit OpenAPI 3.1 / JSON Schema contracts (`packages/contracts`). Do not split into distributed microservices until operational metrics in `M10` demonstrate a concrete compute bottleneck.

## 3. Consequences & Enforcement
- **Positive:** Eliminates JavaScript/TypeScript floating-point formatting anti-patterns (`DEF-M00-01`, `DEF-M00-06`), unifies numerical computing (`SciPy`/`mpmath`/FEM solvers) and AI (`google-genai`) in Python, and guarantees a single server-authoritative security and provenance boundary.
- **Enforcement (`AC-04`):** CI AST static analysis fails any build that introduces computational geometry, grading, or provenance exports inside `apps/web`.
