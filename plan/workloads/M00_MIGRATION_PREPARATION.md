# WORKLOAD M00 — MIGRATION PREPARATION, DEFECT REPRODUCTION & INDEPENDENT REFERENCE-ORACLE FOUNDATION (`R2.1.1`)

## 1. Workload ID & Title
- **Workload ID:** `M00` (`M00.1` through `M00.10`)
- **Title:** Migration Preparation, Source & Contract Inventory, Residual Defect Reproduction, Dual-Class Fixture Extraction & Independent Reference-Oracle Foundation
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Pre-Phase A (Pre-Migration Baseline, Independent Reference Oracles & Contract Freeze)`
- **Current Authorization Status (`Correction F`):** **`UNAUTHORIZED / BLOCKED AT GATE AUTH-1`** (Awaiting independent review of Blueprint `R2.1.1`, formal approval of `ADR-009`, `DEC-01`, and `DEC-13`, and explicit Project-Owner commencement authorization).

## 2. Purpose & Strict Architectural Scope Boundary (`Correction E`)
`M00` establishes the controlled migration and independent verification foundation between the current TypeScript single-package prototype (`commit e9d99cb4afc54057850f920dc909b23ebde86f1f`) and the target **Python Authoritative Computational System (`services/fashion-engine`) + Next.js Workspace (`apps/web`)** mandated by `Addendum v4.1`.

### Strict `M00` vs. `M02` Scope Boundary (`Correction E`)
1. **What `M00` Owns (Migration Preparation & Independent Reference Foundation Only):**
   - Repository and source inventory (`M00.1`),
   - Requirements traceability and contract inventory (`M00.1`, `M00.6`),
   - Reproduction and regression locking of existing TypeScript defects (`DEF-M00-01` through `DEF-M00-06` in `M00.2`),
   - Legacy behavior classification and explicit freeze/preservation policy for `src/engine/*` (`M00.7`),
   - **Class A Legacy Reference Fixtures** (`M00.3` — immutable recordings of `e9d99cb4`),
   - **Class B Normative Reference Fixtures** (`M00.3` — generated from analytical/rational/`mpmath.iv` reference calculations),
   - **Independent Reference-Oracle Harness (`M00.4` in `services/fashion-engine/tests/oracles/`)** implementing the **Five-Concept Numerical Assurance Framework (`Correction A`)**, **`Method C1-Cert`/`Method C2`/`Method C3` reference enclosures (`Correction B`)**, **Six-Category Offset Failure Taxonomy (`Correction C`)**, and **Tri-State Verification Outcomes (`Correction D`, `ADR-009`)**,
   - Canonical RFC 8785 (JCS) SHA-256 serialization parity baseline (`M00.9`),
   - Contract compatibility, versioning baseline, and CI boundary lint harness (`M00.5`–`M00.8`), and
   - Migration risk register and `M00.10` readiness audit gate.
2. **What `M00` Explicitly Does NOT Own (Assigned Exclusively to `M02`):**
   - `M00` **must not** implement authoritative production geometry algorithms (`M02a`), production topology/seam validators (`M02b`), production parametric blocks (`M02d`), production style operators (`M02e`), production offset curve construction/miter/trimming algorithms (`M02f`), production multi-size grading (`M02g`), production marker nesting (`M02h`), or production piece sheets (`M05.1`).
   - All production domain modules under `services/fashion-engine/app/pattern_engine/` are owned and implemented by **`M02`** after **`Gate Auth-2`**.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 04`, `Ch. 10`, `Ch. 11`, `Ch. 15`, `App. A`, `App. B`, `App. F`
- `Patroner_Architecture_Correction_Addendum_v4.1.pdf` (Python / Next.js System-of-Systems Boundary)
- `Dossier 01 v4.9`, `Dossier 02 v5.0`, `Dossier 03 v5.1`, `Dossier 06 v5.4`, `ADR-003`, `ADR-009` (`R2.1.1`)

## 4. Canonical Requirements Supported (`REQ-*`)
- **`REQ-ARCH-01`**, **`REQ-ARCH-02`** (Monorepo contract scaffolding, legacy TS freeze & CI boundary enforcement)
- **Independent Reference-Oracle Support for `REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`** (`M00.4` builds the independent reference oracle harness in `tests/oracles/`; `M02a`, `M02f`, and `M05` implement the authoritative production requirements).

## 5. Current Repository Baseline & Classification
- **`src/engine/geometry/*`**: `I2` (Partial) / `R` (Risk) — Contains Gauss–Legendre quadrature and Green's theorem integration, but marred by `.toFixed(2)` / `.toFixed(3)` truncation (`DEF-M00-01`, `DEF-M00-06`).
- **`src/engine/production/piece-production-sheet.ts`**: `P + X` / `R` — Enforces `isProductionReady: false`, but contains 3-point offset cusp blind spots (`DEF-M00-02`), quantity-map validation gaps (`DEF-M00-03`), and optional tenant enforcement in builders (`DEF-M00-04`).
- **`src/engine/grading/pattern-grader.ts`**: `P + X` — Ignores `garmentCategory: 'skirt'` and unconditionally grades a bodice (`DEF-M00-05`).
- **`services/fashion-engine/tests/oracles/` & `packages/contracts/`**: `M` (Missing — scaffolded in `M00.4`–`M00.6` once `Gate Auth-1` is approved).

## 6. Residual Defects Reproduced & Locked in `M00.2` (`DEF-*`)
`M00.2` reproduces and locks all 6 defects as adversarial regression vectors (while production remediation occurs in `M01`, `M02`, and `M05`):
1. **`DEF-M00-01` (`curve-projection.ts:46-59, 140-144, 160` & `assembly-validator.ts:182, 754-784`)**: `.toFixed(3)` rounding on `arcLengthCm` violates `arcLengthErrorBoundCm` by **17.1×**; invalid tolerances (`NaN`, `<= 0`, `Infinity`) return `toleranceAchieved: true`; `assembly-validator.ts` downgrades `toleranceAchieved: false` to `'warning'` (Fixed in production by **`M02a` / `M02b`**).
2. **`DEF-M00-02` (`piece-production-sheet.ts:878, 946-954`)**: 3-point (`0, 0.5, 1`) offset sampling misses interior cusps at $t=0.25$ and permits `2%`-span straight lines on curved contours (Fixed in production by **`M02f` / `M05.1`**).
3. **`DEF-M00-03` (`piece-production-sheet.ts:3515-3531, 4369-4398`)**: Extraneous size keys (`XXXL: 99`) and conflicting scalar vs. per-size quantities are silently ignored (Fixed in production by **`M05.1`**).
4. **`DEF-M00-04` (`piece-production-sheet.ts:3069-3078, 3306-3315`)**: Builders allow blank/missing `gradingArtifact.tenantId` when `expectedTenantId` is omitted (Fixed in production by **`M01.2` / `M05.1`**).
5. **`DEF-M00-05` (`pattern-grader.ts:44-217`)**: `gradePattern` ignores `'skirt'` and unconditionally grades a bodice (Fixed in production by **`M02g`**).
6. **`DEF-M00-06` (`math.ts:12-16, 85-104` & `primitives.ts:125`)**: `roundCoord` (`.toFixed(2)`) quantizes intermediate coordinates (Fixed in production by **`M02a`**).

## 7. Prerequisites, Governance Decisions & Authorization Gate (`Correction F`)
- **Technical Baseline:** Audited repository commit `e9d99cb4afc54057850f920dc909b23ebde86f1f` (and published blueprint baseline `617cc7f5d9e41b8cd55ed96b64d2363cdb29557b`).
- **Mandatory Governance Prerequisites (`Gate Auth-1` in `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`):**
  1. Formal approval of **`ADR-009` (`R2.1.1`)** and **`DEC-13`** (numerical reference-enclosure & tri-state interval verification architecture for `M00.4`),
  2. Formal approval of **`DEC-01`** (monorepo scaffolding & legacy TS freeze strategy for `M00.5`–`M00.7`), and
  3. **Explicit Project-Owner Commencement Authorization (`AUTH-M00-START`)** following independent acceptance of Blueprint `R2.1.1`.
  - *Note:* Downstream commercial/legal decisions (`DEC-07`, `DEC-08`, `DEC-10`, `DEC-12`) and simulation/material hardware decisions (`DEC-02`, `DEC-03`) do **not** block `Gate Auth-1`.

## 8. Target Directory Structure Created in `M00` (`No Production Engine Code`)
```text
/
├── apps/
│   └── web/                          # Empty Next.js 15 scaffold & contract client stub (M00.5)
├── services/
│   └── fashion-engine/               # Python 3.12+ package root, health route & test harness only (M00.5)
│       ├── pyproject.toml
│       ├── app/
│       │   └── system_health.py      # BuildProvenanceDescriptor only (zero M02 production geometry in M00)
│       └── tests/
│           ├── oracles/              # Independent mpmath.iv / Fraction / Bernstein reference oracle harness (M00.4)
│           └── fixtures/
│               ├── class_a_legacy/   # Frozen TS recordings at e9d99cb4 (M00.3)
│               └── class_b_normative/# Independent oracle-generated normative fixtures (M00.3 / M00.4)
├── packages/
│   └── contracts/                    # OpenAPI 3.1 + JSON Schema Draft 2020-12 baseline (M00.6)
└── src/                              # Frozen legacy TypeScript prototype (read-only preservation policy, M00.7)
```

## 9. Domain Entities, State Machines & Verification Schemas
- **`FixtureManifestRecord`**: `{ fixture_id, fixture_class: "CLASS_A_LEGACY" | "CLASS_B_NORMATIVE", domain, defect_refs: string[], reference_method_and_version, assurance_classification: "CERTIFIED_ENCLOSURE" | "HIGH_PRECISION_NUMERICAL_REFERENCE" | "CONSERVATIVE_ENGINEERING_ESTIMATE", sha256_digest }`
- **`NumericalVerificationRecord` (`ADR-009 §2.4`)**: Records `x_float64`, `x_ref`, `observed_discrepancy_e_obs`, `reference_enclosure_b_ref`, `implementation_to_exact_bound_b_cert`, `acceptance_tolerance_tau`, `verification_outcome: "CERTIFIED_VALID" | "CERTIFIED_INVALID" | "INCONCLUSIVE"`, and `reproducibility_manifest`.
- **`OffsetValidationRecord` (`ADR-009 §5.3`)**: Records tri-state `verification_outcome` and the 6-category `failure_category`.

## 10. Mathematical & Reference-Oracle Specifications (`Corrections A, B, C, D`)
1. **Explicit Reference Enclosure & Triangle Inequality (`Correction A`, `ADR-009 §2`):**
   - The `M00.4` oracle harness enforces:
     $$|X_{\mathrm{float64}} - X_{\mathrm{exact}}| \le |X_{\mathrm{float64}} - X_{\mathrm{ref}}| + |X_{\mathrm{ref}} - X_{\mathrm{exact}}| = E_{\mathrm{obs}} + B_{\mathrm{ref}}$$
   - For Green's area (`Method C2`), $X_{\mathrm{ref}}$ is evaluated in exact rational arithmetic (`fractions.Fraction`), establishing $B_{\mathrm{ref}} = 0$.
   - For cubic Bézier arc length (`Method C1-Cert`), $X_{\mathrm{exact}}$ is enclosed in outward-rounded interval arithmetic (`mpmath.iv` at `mp.dps = 80`) via the De Casteljau chord/control-polygon convex-hull inequality $\underline{L}_{\mathrm{chord}} \le L_{\mathrm{exact}} \le \overline{L}_{\mathrm{poly}}$, establishing $X_{\mathrm{ref}} = \mathrm{mid}([\underline{L}_{\mathrm{chord}}, \overline{L}_{\mathrm{poly}}])$ and $B_{\mathrm{ref}} = \frac{1}{2}(\overline{L}_{\mathrm{poly}} - \underline{L}_{\mathrm{chord}})$.
   - Whenever an unenclosed `mpmath.quad` (`mp.dps = 80`) adaptive integral is computed for cross-checking, `B_ref` is recorded as `null` (`UNESTABLISHED`) and the result is labeled `HIGH_PRECISION_NUMERICAL_REFERENCE` (`EMPIRICAL_ESTIMATE`), **never** `CERTIFIED_ENCLOSURE`.
2. **Treatment of `Method C1-Est` vs. `Method C1-Cert` (`Correction B`, `ADR-009 §3`):**
   - The `M00.4` oracle classifies the $S_{\mathrm{safety}} = 16.0$ adaptive Gauss–Legendre discrepancy formula (`Method C1-Est`) strictly as a `CONSERVATIVE_ENGINEERING_ESTIMATE` and never accepts it as a mathematical proof of enclosure.
3. **Six-Category Offset Failure Taxonomy & Tri-State Oracle Verification (`Corrections C & D`, `ADR-009 §4–§5`):**
   - The `M00.4` reference offset oracle evaluates base speed $Q(t)$, signed curvature numerator $C(t)$, exact cusp polynomial $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2$, and margin polynomial $P_{\mathrm{margin}}(t) = (1 - \varepsilon_{\mathrm{margin}})^2 Q(t)^3 - d^2 C(t)^2$ in `mpmath.iv` + `fractions.Fraction` Sturm/Bernstein basis over $t \in [0, 1]$.
   - Emits tri-state outcomes (`CERTIFIED_VALID`, `CERTIFIED_INVALID`, `INCONCLUSIVE`) and maps proven failures to the 6 independent categories (`REGULARITY_MARGIN_VIOLATION`, `ACTUAL_ZERO_SPEED_CUSP`, `TANGENT_REVERSAL`, `LOCAL_OFFSET_SELF_INTERSECTION`, `GLOBAL_CONTOUR_SELF_INTERSECTION`, `INCONCLUSIVE_VERIFICATION`).

## 11. API Endpoints, Async Jobs & Event Contracts
- `GET /api/v1/system/health` → Returns `BuildProvenanceDescriptor` (`is_production_ready_global_default: false`).

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Formalizes `tenant_id` as a required, non-nullable field in the `packages/contracts` baseline schema (so `M01` and `M05` close `DEF-M00-04`) and verifies RFC 8785 (JCS) SHA-256 canonicalization parity (`M00.9`).

## 13. User Experience & Workspace Surfaces (`apps/web`)
- Non-intrusive build-provenance diagnostic badge in workspace footer displaying active `git_commit_sha`, `contract_schema_version`, and `isProductionReady: false` invariant (`RSK-11`).

## 14. Detailed Work Packages & Implementation Sequence (`Preparation & Oracle Scope Only`)
- **`M00.1` — Repository, Source & Requirement Traceability Inventory:** Catalog all 76 TypeScript files in `src/` and map DTOs to `packages/contracts/`.
- **`M00.2` — Residual Defect Reproduction Suite:** Encode `DEF-M00-01` through `DEF-M00-06` as deterministic reproduction tests against frozen `src/engine/*` snapshots.
- **`M00.3` — Dual-Class Fixture Extraction:** Extract frozen legacy TS outputs into `fixtures/class_a_legacy/` and generate independent oracle reference vectors in `fixtures/class_b_normative/`.
- **`M00.4` — Independent Python Reference-Oracle Harness (`tests/oracles/`):** Implement the standalone `mpmath.iv` / `fractions.Fraction` / Bernstein reference-oracle harness enforcing the 5-concept numerical assurance model (`ADR-009`) and 7-point separation from `M02`.
- **`M00.5` — Monorepo Workspace Scaffolding:** Initialize directory skeletons for `services/fashion-engine`, `apps/web`, and `packages/contracts`.
- **`M00.6` — Contract Compatibility & Versioning Baseline:** Configure OpenAPI 3.1 + JSON Schema Draft 2020-12 validation and codegen.
- **`M00.7` — Legacy TypeScript Freeze & Preservation Policy:** Mark `src/engine/*` frozen via CI hash/AST check (no new domain features in TS; legacy code preserved read-only for Class A differential comparison until `M02`/`M05` parity sign-off).
- **`M00.8` — CI/CD Verification & Boundary Lint Harness:** Configure CI checks enforcing `AC-01`, `AC-04`, and zero shared imports between `tests/oracles/` and `app/pattern_engine/`.
- **`M00.9` — Canonical RFC 8785 (JCS) Serialization & SHA-256 Parity Baseline:** Verify 100% digest parity across Python and TypeScript on 100 canonical JSON vectors.
- **`M00.10` — Migration Readiness Audit Gate:** Verify all `M00.1`–`M00.9` deliverables pass before unlocking `Gate Auth-2` (`M01`/`M02`).

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Follows `/plan/04_MIGRATION_AND_PARITY_POLICY.md`. `M00` produces the independent oracle harness and Class A/B fixtures; `M02` and `M05` subsequently implement the production Python modules tested against them.

## 16. Unit, Property & Adversarial Test Plan (Oracle Self-Verification)
- Verify the `M00.4` oracle harness against analytical closed-form shapes (straight lines where arc length is exact Euclidean distance, exact circles/polygons for Green's area, synthetic cubic Béziers with exact rational stationary cusps at $t=0.25$ and $t=1/3$, and synthetic figure-8 self-intersecting contours).
- Verify that forcing subdivision cutoff at $d=4$ on a grazing near-cusp curve produces `verification_outcome == "INCONCLUSIVE"` and `failure_category == "INCONCLUSIVE_VERIFICATION"` (never `ACTUAL_ZERO_SPEED_CUSP`).

## 17. Independent Verification Boundary
- Enforces the 7-point separation table in `04_MIGRATION_AND_PARITY_POLICY.md §2.3`: `services/fashion-engine/tests/oracles/` is 100% independent of `services/fashion-engine/app/pattern_engine/`.

## 18. Physical, Manufacturing or Financial Validation Protocol
- Digital calibration vector check: verify that the normative $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square Class B fixture has exact rational perimeter $40.0\text{ cm}$ and area $100.0\text{ cm}^2$ with $B_{\mathrm{ref}} = 0$.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`** (Contract & schema validity), **`AC-02`** (Defect reproduction & oracle self-tests), **`AC-03`** (5-concept reference enclosure & tri-state oracle verification), **`AC-04`** (AST boundary linter & legacy TS freeze active). Completes migration readiness for **`Gate Auth-2`**.

## 20. Failure Modes, Rollback & Recovery Procedures
- CI fails closed on any unapproved modification to frozen `src/engine/*`, any import from `app/pattern_engine/` inside `tests/oracles/`, or any Class B fixture lacking an explicit `assurance_classification`.

## 21. Observability, Audit Logging & Telemetry
- Emits `artifacts/m00-oracle-report.json` containing serialized `NumericalVerificationRecord` and `OffsetValidationRecord` entries for all Class A and Class B fixtures.

## 22. Explicit Non-Goals & Scope Guardrails (`Correction E`)
- `M00` does **not** modify `src/engine/*` application files.
- `M00` does **not** implement production geometry, production offset generation/trimming, production grading, or production piece sheets (all owned by `M02` and `M05`).

## 23. Downstream Unlocks
- Passing `M00.10` (together with `Gate Auth-2` decision approvals in `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`) unlocks **`M01`** (Canonical Foundation, Contracts & Security) and **`M02a`** (Authoritative Production Geometry Kernel in Python).

## 24. Definition of Done Checklist
- [ ] `Gate Auth-1` approvals (`ADR-009`, `DEC-01`, `DEC-13` + Project-Owner authorization) recorded before starting `M00`.
- [ ] `M00.1`–`M00.10` migration-preparation work packages completed with zero production geometry implementation contamination.
- [ ] All 6 residual defects (`DEF-M00-01`–`DEF-M00-06`) reproduced against Class A snapshots and encoded in Class B normative fixtures.
- [ ] Independent `M00.4` oracle harness operational with 5-concept error enclosures (`X_ref`, `E_obs`, `B_ref`, `B_cert`, `tau_domain`), 6-category offset failure taxonomy, and tri-state outcomes (`CERTIFIED_VALID`, `CERTIFIED_INVALID`, `INCONCLUSIVE`).
- [ ] RFC 8785 cross-language SHA-256 digest parity verified on 100 test vectors and `isProductionReady: false` global invariant verified.
