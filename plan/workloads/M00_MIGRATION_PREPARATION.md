# WORKLOAD M00 — MIGRATION PREPARATION, DEFECT REGISTER & CERTIFIED ORACLE HARNESS (`R2.1`)

## 1. Workload ID & Title
- **Workload ID:** `M00` (`M00.1` through `M00.10`)
- **Title:** Migration Preparation, Residual Defect Register, Dual-Class Fixture Extraction, High-Precision Reference Oracles & Certified Interval Enclosures
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Pre-Phase A (Pre-Migration Baseline, Certified Oracles & Contract Freeze)`

## 2. Purpose & Architectural Role
`M00` establishes the mathematically rigorous, auditable bridge between the current TypeScript single-package prototype (`commit e9d99cb4afc54057850f920dc909b23ebde86f1f`) and the target **Python Authoritative Computational System (`services/fashion-engine`) + Next.js Workspace (`apps/web`)** mandated by `Addendum v4.1`. It prevents the mechanical port of known TypeScript defects (`DEF-M00-01` through `DEF-M00-06`) by partitioning existing tests into **Class A Legacy Reference Fixtures** and **Class B Normative Specification Fixtures**, while enforcing the **Four-Tier Numerical Assurance Framework (`Correction 04`)** and **Complete-Interval ($t \in [0, 1]$) Offset Verification (`Correction 05`, `ADR-009`)**.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 04`, `Ch. 10`, `Ch. 11`, `Ch. 15`, `App. A`, `App. B`, `App. F`
- `Patroner_Architecture_Correction_Addendum_v4.1.pdf` (Python / Next.js System-of-Systems Boundary)
- `Dossier 01 v4.9`, `Dossier 02 v5.0`, `Dossier 03 v5.1`, `Dossier 06 v5.4`

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-ARCH-01`**, **`REQ-ARCH-02`** (Authoritative Python / Next.js Boundary & Versioned Contracts)
- **`REQ-GEO-01`** (Full IEEE 754 `float64` Internal Precision & 4-Tier Certified Error Bounds)
- **`REQ-GEO-02`** (Complete-Interval $t \in [0, 1]$ Offset Regularity, Cusp & Tangent-Reversal Verification)
- **`REQ-MFG-01`** (Hard `isProductionReady: false` Default Invariant)

## 5. Current Repository Baseline & Classification
- **`src/engine/geometry/*`**: `I2` (Partial) / `R` (Risk) — Contains Gauss–Legendre quadrature and Green's theorem integration, but marred by `.toFixed(2)` / `.toFixed(3)` truncation (`DEF-M00-01`, `DEF-M00-06`).
- **`src/engine/production/piece-production-sheet.ts`**: `I2` (Partial) / `R` (Risk) — Enforces many topological invariants and keeps `isProductionReady: false`, but contains 3-point offset cusp blind spots (`DEF-M00-02`), quantity-map validation gaps (`DEF-M00-03`), and optional tenant enforcement in builders (`DEF-M00-04`).
- **`src/engine/grading/pattern-grader.ts`**: `P` (Prototype) / `X` (Contradicts Spec) — Ignores `garmentCategory: 'skirt'` and unconditionally grades a bodice (`DEF-M00-05`).
- **`services/fashion-engine/` & `packages/contracts/`**: `M` (Missing — created in `M00.5` / `M00.6`).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
1. **`DEF-M00-01` (`src/engine/geometry/curve-projection.ts:46-59, 140-144, 160` & `src/engine/assembly/assembly-validator.ts:182, 754-784`)**:
   - `arcLengthCm` is rounded via `Number(totalLength.toFixed(3))` (`0.0005 cm` max rounding error) while `arcLengthErrorBoundCm` reports unrounded quadrature residual (`0.0000257 cm`), violating `|L_returned - L_true| <= bound` by **17.1×**.
   - Invalid tolerances (`NaN`, `<= 0`, `Infinity`) bypass validation and return `toleranceAchieved: true`.
   - `assembly-validator.ts` recomputes `totalErrorBound = (upper - lower) / 2` and downgrades `toleranceAchieved: false` to a non-blocking `'warning'`.
2. **`DEF-M00-02` (`src/engine/production/piece-production-sheet.ts:878, 946-954`)**:
   - `verifyContinuousOffsetForMappedSegment` samples `stSub` only at `u in {0, 0.5, 1}`, missing interior cusps/self-reversals at $t=0.25$ on cubic sub-segments and permitting `2%`-span straight line-to-line segments on primary cutting contours.
3. **`DEF-M00-03` (`src/engine/production/piece-production-sheet.ts:3515-3531, 4369-4398`)**:
   - Builder and verifier iterate only over `includedSizes`/`declaredSizes`, silently ignoring extraneous size keys in quantity maps and ignoring contradictions between scalar `expectedGarmentUnitQuantity` and `expectedGarmentUnitQuantitiesBySize`.
4. **`DEF-M00-04` (`src/engine/production/piece-production-sheet.ts:3069-3078, 3306-3315`)**:
   - Builders allow `gradingArtifact.tenantId` to be missing or unverified when `expectedTenantId` is omitted.
5. **`DEF-M00-05` (`src/engine/grading/pattern-grader.ts:44-217`)**:
   - `gradePattern(baseSpec, ruleSet)` ignores `baseSpec.garmentCategory` and unconditionally drafts/grades a bodice.
6. **`DEF-M00-06` (`src/engine/geometry/math.ts:12-16, 85-104` & `src/engine/geometry/primitives.ts:125`)**:
   - `roundCoord` (`toFixed(2)`) truncates intermediate coordinates inside `cubicBezierPoint`, `splitCubicBezier`, and `midPoint`.

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
│           ├── oracles/              # mpmath (80-dps) reference + mpmath.iv / Bernstein certified enclosures
│           └── fixtures/
│               ├── class_a_legacy/   # Historical TS outputs (non-normative)
│               └── class_b_normative/# Certified mathematical & domain reference outputs
├── packages/
│   └── contracts/                    # OpenAPI 3.1 + JSON Schema Draft 2020-12 + codegen
└── src/                              # Frozen legacy TypeScript prototype (read-only reference)
```

## 9. Domain Entities, State Machines & Data Contracts
- **`FixtureManifestRecord`**: `{ fixture_id, fixture_class: "CLASS_A_LEGACY" | "CLASS_B_NORMATIVE", domain, defect_refs: string[], reference_oracle_method, certified_bound_method: "METHOD_C1_CHORD_POLYGON" | "METHOD_C2_HIGHAM_INNER_PRODUCT" | "METHOD_C3_BERNSTEIN_INTERVAL", precision_dps: 80, sha256_digest }`
- **`BuildProvenanceDescriptor`**: `{ git_commit_sha, contract_schema_version, monograph_baseline: "v5.16-R2.1", python_engine_version, is_production_ready_global_default: false }`

## 10. Mathematical, Algorithmic & Domain Specifications (`Corrections 04 & 05`)
1. **Separation of Reference Oracles ($X_{\text{ref}}$) and Certified Bounds ($B_{\text{cert}}$) (`Correction 04`):**
   - **High-Precision Reference Oracle ($X_{\text{ref}}$):** Uses `mpmath` (`mp.dps = 80`) adaptive quadrature and exact `fractions.Fraction` polynomial arithmetic for independent CI cross-checking.
   - **Certified Runtime & Oracle Enclosure ($B_{\text{cert}}$):**
     - **Arc Length (`Method C1`):** Uses De Casteljau subdivision chord-length lower bound $\sum L_{\text{chord}, i}$ and control-polygon upper bound $\sum L_{\text{poly}, i}$ with outward ULP rounding $\delta_{\text{fp64}}$ to guarantee $L_{\text{exact}} \in [L_{\text{chord}} - \delta_{\text{fp64}}, L_{\text{poly}} + \delta_{\text{fp64}}]$ without relying on heuristic quadrature step differences.
     - **Green's Area (`Method C2`):** Evaluates the exact degree-5 polynomial cross-integral on centroid-shifted coordinates $\mathbf{p} - \mathbf{c}$ and bounds IEEE 754 `float64` inner-product roundoff via Higham's $\gamma_{24}$ bound.
2. **Complete-Interval ($t \in [0, 1]$) Bernstein & Interval Offset Verifier (`Correction 05`, `Method C3`):**
   - Expresses base speed squared $V(t) = x'(t)^2 + y'(t)^2$ (degree 4), signed curvature numerator $N(t) = x'(t)y''(t) - y'(t)x''(t)$ (degree 2), rational-free cusp polynomial $Q_{\text{cusp}}(t) = V(t)^3 - d^2 N(t)^2$ (degree 6), and mapped tangent dot product $D(u) = \tilde{\mathbf{O}}'(u)\cdot \mathbf{B}'(t(u))$ (degree 4) in the **Bernstein basis on $[0, 1]$** with interval coefficients (`mpmath.iv`).
   - Proves over the **entire continuous interval $t \in [0, 1]$** (not merely a finite point grid) that $V(t) \ge v_{\min}^2 > 0$, $Q_{\text{cusp}}(t) > 0$ (where $s d N(t) < 0$), and $D(u) > 0$.

## 11. API Endpoints, Async Jobs & Event Contracts
- `GET /api/v1/system/health` → Returns `BuildProvenanceDescriptor`.
- `POST /api/v1/internal/parity-check` (Dev/CI only) → Evaluates candidate payloads against Class B Normative Oracles and Certified Enclosures.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Formalizes `tenant_id` as a required, non-nullable UUIDv7 field on every contract and builder call (closing `DEF-M00-04`).
- Establishes RFC 8785 (JCS) as the cross-language SHA-256 canonicalization standard (`M00.9`).

## 13. User Experience & Workspace Surfaces (`apps/web`)
- Non-intrusive build-provenance diagnostic badge in workspace footer displaying active `git_commit_sha`, `contract_schema_version`, and engine authority status (`RSK-11`).

## 14. Detailed Work Packages & Implementation Sequence
- **`M00.1` — Source & Contract Inventory:** Catalog all TypeScript files in `src/` and map DTOs to `packages/contracts/`.
- **`M00.2` — Residual Defect Register Lock:** Encode `DEF-M00-01` through `DEF-M00-06` as formal regression tests.
- **`M00.3` — Dual-Class Fixture Extraction:** Extract deterministic JSON snapshots into `fixtures/class_a_legacy/` and annotate defective fields.
- **`M00.4` — Independent Python Reference & Certified Interval Oracles:** Implement `mpmath` (`mp.dps = 80`) reference oracles AND `Method C1/C2/C3` (`mpmath.iv` + Bernstein polynomial) certified bound verifiers; generate `fixtures/class_b_normative/`.
- **`M00.5` — Monorepo Workspace Scaffolding:** Initialize `services/fashion-engine` and `apps/web` alongside `packages/contracts`.
- **`M00.6` — Contract Codegen Pipeline:** Configure OpenAPI 3.1 + JSON Schema Draft 2020-12 codegen.
- **`M00.7` — Legacy TS Freeze & Deprecation Boundary:** Freeze `src/engine/*` with AST lint rules blocking new domain logic in TypeScript.
- **`M00.8` — CI/CD Dual-Runtime Verification Harness:** Configure CI for Python, TypeScript, contract drift, and `AC-04` boundary checks.
- **`M00.9` — Deterministic Seed & RFC 8785 Hash Canonicalization:** Verify 100% SHA-256 parity across Python and TypeScript on 100 test vectors.
- **`M00.10` — M00 Exit Audit & Freeze Gate:** Verify all Class A/B fixtures, certified interval enclosures, and CI gates pass.

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Follows `/plan/04_MIGRATION_AND_PARITY_POLICY.md`. Python modules in `M02` and `M05` must match Class B Normative fixtures and satisfy `actual_error <= certified_bound <= domain_tolerance`.

## 16. Unit, Property & Adversarial Test Plan
- **Adversarial Geometry & Offset Cases:** Interior cusp at $t=0.25$ and arbitrary $t^* \in (0, 1)$ between grid nodes (`DEF-M00-02`, `RSK-13`); `2%` straight-line substitution; translated contours ($+10^6\text{ cm}$); `NaN`/`Infinity`/`<=0` tolerances (`DEF-M00-01`).
- **Adversarial Quantity, Tenant & Grading Cases:** Extra size keys `XXXL: 99`, conflicting scalar vs. map quantities (`DEF-M00-03`), omitted `expectedTenantId` with blank `tenantId` (`DEF-M00-04`), and skirt grading (`DEF-M00-05`).

## 17. Independent Verification Oracles
- `services/fashion-engine/tests/oracles/oracle_geometry_mpmath.py` (`mp.dps = 80` reference + `mpmath.iv` / Bernstein certified interval enclosures).
- `services/fashion-engine/tests/oracles/oracle_jcs_sha256.py` (RFC 8785 canonical digest verifier).

## 18. Physical, Manufacturing or Financial Validation Protocol
- Digital calibration vector check: verify that the reference $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square fixture has exact `float64` perimeter $40.0\text{ cm}$ and area $100.0\text{ cm}^2$ with certified error bound $< 10^{-14}$.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-03`** (4-tier numerical assurance & complete-interval $[0, 1]$ Bernstein/interval offset proof), **`AC-04`** (AST boundary linter active). Required for **Release Level A**.

## 20. Failure Modes, Rollback & Recovery Procedures
- CI fails closed on any contract drift (`git diff --exit-code packages/contracts/`) or any test vector where `actual_error > certified_bound`.

## 21. Observability, Audit Logging & Telemetry
- Emits `artifacts/m00-oracle-report.json` recording `reference_value`, `fp64_value`, `implementation_error`, `certified_bound`, `domain_tolerance`, and `bound_ratio` for every test vector.

## 22. Explicit Non-Goals & Scope Guardrails
- `M00` does not modify `src/engine/*` application files; it builds the normative Class B oracle harness and contract scaffolding for `M01`–`M10`.

## 23. Downstream Unlocks
- Unlocks **`M01`** (Canonical Foundation, Contracts & Security) and **`M02a`** (Planar Geometry Kernel in Python).

## 24. Definition of Done Checklist
- [ ] `M00.1`–`M00.10` work packages completed.
- [ ] All 6 residual defects (`DEF-M00-01`–`DEF-M00-06`) captured in Class B normative test suites.
- [ ] `mpmath` (`mp.dps = 80`) reference oracles AND `Method C1/C2/C3` certified bound verifiers operational in CI.
- [ ] RFC 8785 cross-language SHA-256 digest parity verified on 100 test vectors.
- [ ] `isProductionReady: false` global invariant verified.
