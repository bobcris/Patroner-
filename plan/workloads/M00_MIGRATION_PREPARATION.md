# WORKLOAD M00 — MIGRATION PREPARATION, DEFECT REGISTER & PARITY HARNESS

## 1. Workload ID & Title
- **Workload ID:** `M00` (`M00.1` through `M00.10`)
- **Title:** Migration Preparation, Residual Defect Register, Dual-Class Fixture Extraction & Python Reference Oracles
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase A (Pre-Migration Baseline & Contract Freeze)`

## 2. Purpose & Architectural Role
`M00` establishes the mathematically sound, auditable bridge between the current TypeScript single-package prototype (`commit e9d99cb4afc54057850f920dc909b23ebde86f1f`) and the target **Python Authoritative Computational System (`services/fashion-engine`) + Next.js Workspace (`apps/web`)** mandated by `Addendum v4.1`. It prevents the mechanical port of known TypeScript defects (`DEF-M00-01` through `DEF-M00-06`) by partitioning existing tests into **Class A Legacy Reference Fixtures** (historical regression record only) and **Class B Normative Specification Fixtures** (computed via independent arbitrary-precision Python `mpmath` oracles).

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 04`, `Ch. 10`, `Ch. 11`, `Ch. 15 (Phase A)`, `App. A`, `App. B`, `App. F`
- `Patroner_Architecture_Correction_Addendum_v4.1.pdf` (Python / Next.js System-of-Systems Boundary)
- `Dossier 01 v4.9` (Domain System of Record), `Dossier 02 v5.0` (API Workflows — corrected to Python FastAPI), `Dossier 03 v5.1` (Deterministic Pattern Geometry), `Dossier 06 v5.4` (Validation & Model Credibility)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-ARCH-01`**: Authoritative Python / Next.js Boundary
- **`REQ-ARCH-02`**: Modular Monolith First, Versioned Contracts
- **`REQ-GEO-01`**: Full IEEE 754 `float64` Internal Precision & Guaranteed Error Bounds
- **`REQ-GEO-02`**: Exact Continuous Offset & Interior Cusp Detection
- **`REQ-MFG-01`**: Hard `isProductionReady: false` Default Invariant

## 5. Current Repository Baseline & Classification
- **`src/engine/geometry/*`**: `I2` (Partial) / `R` (Risk) — Contains working Gauss–Legendre quadrature and Green's theorem integration, but marred by `.toFixed(2)` / `.toFixed(3)` truncation (`DEF-M00-01`, `DEF-M00-06`).
- **`src/engine/production/piece-production-sheet.ts`**: `I2` (Partial) / `R` (Risk) — 4,845 LOC; enforces many topological invariants and keeps `isProductionReady: false`, but contains interior cusp blind spots (`DEF-M00-02`), quantity-map validation gaps (`DEF-M00-03`), and optional tenant enforcement in builders (`DEF-M00-04`).
- **`src/engine/grading/pattern-grader.ts`**: `P` (Prototype) / `X` (Contradicts Spec) — Ignores `garmentCategory: 'skirt'` and unconditionally grades a bodice (`DEF-M00-05`).
- **`services/fashion-engine/` & `packages/contracts/`**: `M` (Missing — created in `M00.5` / `M00.6`).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
1. **`DEF-M00-01` (`src/engine/geometry/curve-projection.ts:46-59, 140-144, 160` & `src/engine/assembly/assembly-validator.ts:182, 754-784`)**:
   - `arcLengthCm` is rounded via `Number(totalLength.toFixed(3))` (`0.0005 cm` max rounding error) while `arcLengthErrorBoundCm` reports unrounded quadrature residual (`0.0000257 cm`), violating `|L_returned - L_true| <= bound` by **17.1×**.
   - Invalid tolerances (`NaN`, `<= 0`) bypass validation and return `toleranceAchieved: true`.
   - `assembly-validator.ts` recomputes `totalErrorBound = (upper - lower) / 2` and downgrades `toleranceAchieved: false` to a non-blocking `'warning'`.
2. **`DEF-M00-02` (`src/engine/production/piece-production-sheet.ts:878, 946-954`)**:
   - `verifyContinuousOffsetForMappedSegment` samples `stSub` only at `u in {0, 0.5, 1}`, missing interior cusps/self-reversals at $t=0.25$ on cubic sub-segments and permitting `2%`-span straight line-to-line segments on primary cutting contours.
3. **`DEF-M00-03` (`src/engine/production/piece-production-sheet.ts:3515-3531, 4369-4398`)**:
   - `resolveTargetSizeQuantities` and `verifyPieceProductionSheetPackage` iterate only over `gradedSizeSet.supportedSizes`, silently ignoring extraneous or misspelled size keys in `quantityBySize` and ignoring contradictions when both scalar `expectedQuantityPerPiece` and `expectedQuantitiesBySize` are supplied.
4. **`DEF-M00-04` (`src/engine/production/piece-production-sheet.ts:3069-3078, 3306-3315`)**:
   - `buildPieceProductionSheet` and `buildPieceProductionSheetPackage` allow `gradingArtifact.tenantId` to be missing or unverified when `options.expectedTenantId` is omitted.
5. **`DEF-M00-05` (`src/engine/grading/pattern-grader.ts:44-217`)**:
   - `gradePattern(baseSpec, ruleSet)` ignores `baseSpec.garmentCategory` and unconditionally calls `draftBodice(baseProfile)` and `draftBodice(targetProfile)`.
6. **`DEF-M00-06` (`src/engine/geometry/math.ts:12-16, 85-104` & `src/engine/geometry/primitives.ts:125`)**:
   - `roundCoord` (`toFixed(2)`) truncates intermediate coordinates inside `cubicBezierPoint`, `splitCubicBezier`, `lineSegmentIntersection`, and `createLine`.

## 7. Prerequisites & Upstream Dependencies
- Starts directly from repository baseline commit `e9d99cb4afc54057850f920dc909b23ebde86f1f`. No prior workload required.

## 8. Target Architecture & Module Ownership
```text
/
├── apps/
│   └── web/                          # Next.js 15 App Router UI & BFF (Presentation only)
├── services/
│   └── fashion-engine/               # Authoritative Python 3.12+ Computational System
│       ├── pyproject.toml
│       ├── app/
│       └── tests/
│           ├── oracles/              # mpmath 80-digit reference oracles (M00.4)
│           └── fixtures/
│               ├── class_a_legacy/   # Historical TS outputs (non-normative)
│               └── class_b_normative/# True mathematical/domain reference outputs
├── packages/
│   └── contracts/                    # OpenAPI 3.1 + JSON Schema Draft 2020-12 + codegen
└── src/                              # Frozen legacy TypeScript prototype (read-only reference)
```

## 9. Domain Entities, State Machines & Data Contracts
- **`FixtureManifestRecord`**: `{ fixture_id, fixture_class: "CLASS_A_LEGACY" | "CLASS_B_NORMATIVE", domain, defect_refs: string[], oracle_method, precision_dps: 80, sha256_digest }`
- **`BuildProvenanceDescriptor`**: `{ git_commit_sha, contract_schema_version, monograph_baseline: "v5.16", python_engine_version, is_production_ready_global_default: false }`

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Arbitrary-Precision Arc-Length Oracle (`M00.4`):**
   - Uses Python `mpmath` with `mp.dps = 80` adaptive Gauss–Kronrod / Gauss–Legendre quadrature on $\int_{t_0}^{t_1} \sqrt{x'(t)^2 + y'(t)^2}\,dt$ until consecutive refinements satisfy $|\mathcal{I}_{2n} - \mathcal{I}_n| < 10^{-50}\text{ cm}$.
   - Normative invariant for `M02a`: returned `float64` `arc_length_cm` (unrounded) and `arc_length_error_bound_cm` must satisfy $|L_{\text{returned}} - L_{\text{mpmath}}| \le \text{bound} \le 10^{-5}\text{ cm}$.
2. **Arbitrary-Precision Green's Theorem Area Oracle (`M00.4`):**
   - Evaluates exact rational/polynomial degree-5 integral $\frac{1}{2}\oint (x\,dy - y\,dx)$ in `mpmath` (`mp.dps = 80`) across $\ge 50$ contours (including the 34 repository contours + 16 adversarial translation/cancellation contours).
   - Normative invariant: $|A_{\text{returned}} - A_{\text{mpmath}}| \le \text{reported\_area\_upper\_bound}$.
3. **Dense & Algebraic Offset Cusp Oracle (`M00.4`):**
   - Evaluates cubic curve curvature $\kappa(t) = \frac{x'(t)y''(t) - y'(t)x''(t)}{(x'(t)^2 + y'(t)^2)^{3/2}}$ across dense 65-point Gauss–Lobatto nodes per sub-segment plus analytical extrema of $\kappa(t)$ to detect any interior point where $1 \pm d\cdot \kappa(t) \le 0$ or tangent reversal $\hat{\mathbf{t}}_{\text{offset}}(t) \cdot \hat{\mathbf{t}}_{\text{base}}(t) \le 0$.

## 11. API Endpoints, Async Jobs & Event Contracts
- `GET /api/v1/system/health` → Returns `BuildProvenanceDescriptor` (`git_commit_sha`, `contract_schema_version`, `is_production_ready_default: false`).
- `POST /api/v1/internal/parity-check` (Dev/CI only) → Evaluates a candidate geometry/grading payload against Class B Normative Oracles.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Formalizes the mandatory schema rule that `tenant_id` is a required, non-nullable UUIDv7 field on every request, artifact, and builder call (closing `DEF-M00-04` in `Class B` contracts).
- Establishes RFC 8785 (JSON Canonicalization Scheme — JCS) as the cross-language SHA-256 canonicalization standard between Python and TypeScript (`M00.9`).

## 13. User Experience & Workspace Surfaces (`apps/web`)
- Adds a non-intrusive build-provenance diagnostic badge in the workspace footer displaying the active `git_commit_sha`, `contract_schema_version`, and `Engine: Python FastAPI (Authoritative)` vs. `Legacy Preview` status (`RSK-11`).

## 14. Detailed Work Packages & Implementation Sequence
- **`M00.1` — Source & Contract Inventory:** Catalog all 42 TypeScript files in `src/` and map their types to `packages/contracts/`.
- **`M00.2` — Residual Defect Register Lock:** Encode `DEF-M00-01` through `DEF-M00-06` as formal failing regression tests against the legacy TS code and passing normative specs for Python.
- **`M00.3` — Dual-Class Fixture Extraction:** Extract deterministic JSON snapshots from the 217 existing Vitest assertions into `fixtures/class_a_legacy/` and annotate defective fields.
- **`M00.4` — Independent Python Numerical Oracles:** Implement `mpmath` (`mp.dps = 80`) reference oracles for Bézier arc length, Green's area, continuous offset envelope/cusp detection, cross-size grading seam mating, and quantity-map set equality; generate `fixtures/class_b_normative/`.
- **`M00.5` — Monorepo Workspace Scaffolding:** Initialize `services/fashion-engine` (Python 3.12+, FastAPI, Pydantic v2, pytest, Hypothesis, mypy) and `apps/web` (Next.js 15 App Router) alongside `packages/contracts`.
- **`M00.6` — Contract Codegen Pipeline:** Configure OpenAPI 3.1 + JSON Schema Draft 2020-12 generation from Pydantic v2 models to TypeScript strict interfaces.
- **`M00.7` — Legacy TS Freeze & Deprecation Boundary:** Mark `src/engine/*` deprecated with an ESLint/AST rule blocking new domain features in TypeScript.
- **`M00.8` — CI/CD Dual-Runtime Verification Harness:** Configure GitHub Actions to run Python `pytest`/`mypy`/`ruff`, TypeScript `tsc`/`vitest`, contract drift checks, and `AC-04` boundary enforcement.
- **`M00.9` — Deterministic Seed & RFC 8785 Hash Canonicalization:** Unify SHA-256 canonical digest computation across Python and TypeScript on 100 test vectors.
- **`M00.10` — M00 Exit Audit & Freeze Gate:** Verify all Class A and Class B fixtures, oracle scripts, and CI gates pass.

## 15. Migration & Parity Strategy (Class A vs Class B Fixtures)
- Follows `/plan/04_MIGRATION_AND_PARITY_POLICY.md`. Python modules in `M02` and `M05` are **forbidden** from matching Class A outputs where `DEF-M00-01`–`DEF-M00-06` apply, and **required** to match Class B Normative fixtures within IEEE 754 `float64` tolerances.

## 16. Unit, Property & Adversarial Test Plan
- **Adversarial Geometry Cases:** High-curvature cubic Béziers with interior inflection/cusp at $t=0.25$ (`DEF-M00-02`); large-coordinate translated contours ($+10^5\text{ cm}$) testing catastrophic cancellation; `NaN`/`Infinity`/`<=0` tolerances (`DEF-M00-01`).
- **Adversarial Quantity & Tenant Cases:** Extra size keys `{"S": 5, "M": 5, "XXL_TYPO": 3}`, contradictory scalar `expectedQuantityPerPiece: 10` vs map `{"S": 5}` (`DEF-M00-03`), omitted `expectedTenantId` with blank `tenantId` (`DEF-M00-04`).
- **Cross-Category Grading Cases:** Skirt specification passed to grader verifying skirt pieces (`skirt-front`, `skirt-back`) are produced rather than bodice pieces (`DEF-M00-05`).

## 17. Independent Verification Oracles
- `services/fashion-engine/tests/oracles/oracle_geometry_mpmath.py` (`mp.dps = 80` independent adaptive quadrature & algebraic cusp finder).
- `services/fashion-engine/tests/oracles/oracle_jcs_sha256.py` (RFC 8785 canonical digest verifier).

## 18. Physical, Manufacturing or Financial Validation Protocol
- Digital calibration vector check: verify that the reference $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square fixture has exact `float64` perimeter $40.0\text{ cm}$ and area $100.0\text{ cm}^2$ with error $< 10^{-14}$.

## 19. Acceptance Criteria (`AC-01`–`AC-12` Mapping)
- **`AC-01`**: Zero schema/type drift between `services/fashion-engine` and `packages/contracts`.
- **`AC-02`**: 100% pass on Class B oracle self-tests and `DEF-M00-01`–`DEF-M00-06` reproduction suite.
- **`AC-03`**: `mpmath` 80-digit oracles verified across $\ge 50$ contours and $\ge 100$ Bézier offset segments.
- **`AC-04`**: AST linter active blocking new domain logic in `src/engine/*`.

## 20. Failure Modes, Rollback & Recovery Procedures
- **Failure Mode:** Contract codegen mismatch between Python Pydantic v2 and TypeScript types.
- **Recovery:** CI fails closed on `git diff --exit-code packages/contracts/`; developer runs `make generate-contracts` from single source of truth in Python schema definitions.

## 21. Observability, Audit Logging & Telemetry
- Structured JSON test-oracle execution reports emitted to `artifacts/m00-oracle-report.json` recording max absolute error, bound ratio, and fixture SHA-256 digests.

## 22. Explicit Non-Goals & Scope Guardrails
- `M00` does **not** rewrite the legacy TypeScript files in `src/engine/*` to fix `DEF-M00-01`–`DEF-M00-06` in place; instead, it locks their diagnosis and builds the normative Class B test harness so `M01`, `M02`, and `M05` implement the corrected algorithms directly in Python.

## 23. Downstream Unlocks
- Unlocks **`M01`** (Canonical Foundation, Contracts & Security) and **`M02a`** (Planar Geometry Kernel in Python).

## 24. Definition of Done Checklist
- [ ] `M00.1`–`M00.10` work packages completed.
- [ ] All 6 residual defects (`DEF-M00-01`–`DEF-M00-06`) captured in automated Class B normative test suites.
- [ ] `mpmath` (`mp.dps = 80`) reference oracles operational in CI.
- [ ] RFC 8785 cross-language SHA-256 digest parity verified on 100 test vectors.
- [ ] `isProductionReady: false` global invariant verified.
