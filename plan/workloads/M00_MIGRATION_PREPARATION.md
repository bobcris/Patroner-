# WORKLOAD M00 — MIGRATION PREPARATION, DEFECT REPRODUCTION & INDEPENDENT REFERENCE-ORACLE FOUNDATION (`R2.1.2`)

## 1. Workload ID & Title
- **Workload ID:** `M00` (`M00.1` through `M00.10`)
- **Title:** Migration Preparation, Source & Contract Inventory, Residual Defect Reproduction, Dual-Class Fixture Extraction, Interval Library Qualification & Independent Reference-Oracle Foundation
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Pre-Phase A (Pre-Migration Baseline, Independent Reference Oracles & Contract Freeze)`
- **Current Authorization Status (`Section 9`, `Critical Correction D`):** **`UNAUTHORIZED / BLOCKED AT GATE AUTH-1`**.
  > **Explicit Governance Rule (`Section 9`):** **`R2.1.2 publication does not authorize M00. M00 remains blocked pending explicit owner approval.`** Commencement requires independent acceptance of Blueprint `R2.1.2`, formal approval of `ADR-009` (`R2.1.2`), `DEC-01`, and `DEC-13 Stage 1` (or optional pre-`M00` spike `SPIKE-DEC13-01` if requested by the Project Owner before `Gate Auth-1`), and explicit Project-Owner commencement sign-off (`AUTH-M00-START`).

## 2. Purpose & Strict Architectural Scope Boundary (`Section 9`)
`M00` establishes the controlled migration and independent verification foundation between the current TypeScript single-package prototype (`commit e9d99cb4afc54057850f920dc909b23ebde86f1f`) and the target **Python Authoritative Computational System (`services/fashion-engine`) + Next.js Workspace (`apps/web`)** mandated by `Addendum v4.1`.

### Strict `M00` vs. `M02` Scope Boundary (`Section 9`)
1. **What `M00` Owns (Migration Preparation & Independent Reference Foundation Only):**
   - Repository and source inventory (`M00.1`),
   - Requirements traceability and contract inventory (`M00.1`, `M00.6`),
   - Reproduction and regression locking of existing TypeScript defects (`DEF-M00-01` through `DEF-M00-06` in `M00.2`),
   - Legacy behavior classification and explicit freeze/preservation policy for `src/engine/*` (`M00.7`),
   - **Class A Legacy Reference Fixtures** (`M00.3` — immutable recordings of `e9d99cb4`),
   - **Class B Normative Reference Fixtures** (`M00.3` — generated from analytical/rational/`mpmath.iv` reference calculations),
   - **Independent Reference-Oracle Harness & Interval Library Qualification (`M00.4` in `services/fashion-engine/tests/oracles/`)** implementing:
     - the **Five-Concept Numerical Assurance Framework & Parameter-to-Output Error Propagation (`Method B1/B2`, `Critical Correction B`)**,
     - the **Four-Layer `Method C1-Cert` Assurance & 8-Point `IntervalLibraryQualificationReport` (`Critical Correction C`)**,
     - the **Corrected Offset Derivative $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, Separate $Q(t)=0$ Check, Concave Sign Condition $s\,d\,C(t) > 0$, Six-Category Offset Failure Taxonomy & 14 Adversarial Geometry Test Families (`Critical Correction A`)**,
     - **Tri-State Verification Outcomes (`CERTIFIED_VALID`, `CERTIFIED_INVALID`, `INCONCLUSIVE`)**, and
     - **Five-Dimensional Oracle Independence Qualification (`Critical Correction F`, `ADR-009`)**,
   - Canonical RFC 8785 (JCS) SHA-256 serialization parity baseline (`M00.9`),
   - Contract compatibility, versioning baseline, and CI boundary lint harness (`M00.5`–`M00.8`), and
   - Migration risk register and `M00.10` readiness audit gate (producing the `IntervalLibraryQualificationReport` and `< 5 ms` per-contour benchmark required to unlock **`DEC-13 Stage 2` at `Gate Auth-2`**).
2. **What `M00` Explicitly Does NOT Own (Assigned Exclusively to `M02` and `M05`):**
   - `M00` **must not** implement authoritative production geometry algorithms (`M02a`), production topology/seam validators (`M02b`), production parametric blocks (`M02d`), production style operators (`M02e`), production offset curve construction/miter/trimming algorithms (`M02f`), production multi-size grading (`M02g`), production marker nesting (`M02h`), or production piece sheets (`M05.1`).
   - All production domain modules under `services/fashion-engine/app/pattern_engine/` are owned and implemented by **`M02`** after **`Gate Auth-2`**.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 04`, `Ch. 10`, `Ch. 11`, `Ch. 15`, `App. A`, `App. B`, `App. F`
- `Patroner_Architecture_Correction_Addendum_v4.1.pdf` (Python / Next.js System-of-Systems Boundary)
- `Dossier 01 v4.9`, `Dossier 02 v5.0`, `Dossier 03 v5.1`, `Dossier 06 v5.4`, `ADR-003`, `ADR-009` (`R2.1.2`)

## 4. Canonical Requirements Supported (`REQ-*`)
- **`REQ-ARCH-01`**, **`REQ-ARCH-02`** (Monorepo contract scaffolding, legacy TS freeze & CI boundary enforcement)
- **Independent Reference-Oracle Support for `REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`** (`M00.4` builds the independent reference oracle harness and `IntervalLibraryQualificationReport` in `tests/oracles/`; `M02a`, `M02f`, and `M05` implement the authoritative production requirements).

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

## 7. Prerequisites, Governance Decisions & Authorization Gate (`Critical Corrections D & E`)
- **Technical Baseline:** Audited repository commit `e9d99cb4afc54057850f920dc909b23ebde86f1f` (and published `R2.1.1` blueprint baseline `8805140b1e6e7799922348369d7e29881102a75e`).
- **Mandatory Governance Prerequisites (`Gate Auth-1` in `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`):**
  1. Formal approval of **`ADR-009` (`R2.1.2`)** and **`DEC-13 Stage 1` (Oracle Library Selection)** via static specification review (requiring **zero `M00` execution** prior to `Gate Auth-1`; or optional bounded non-production `SPIKE-DEC13-01` if explicitly requested by the Owner before `Gate Auth-1`),
  2. Formal approval of **`DEC-01`** (monorepo scaffolding & legacy TS freeze strategy for `M00.5`–`M00.7`), and
  3. **Explicit Project-Owner Commencement Authorization (`AUTH-M00-START`)** following independent acceptance of Blueprint `R2.1.2`.
  - *Stage 2 Hand-off (`Critical Correction D`):* During `M00.4`, the engineering team executes the 8-point `IntervalLibraryQualificationReport` (`ADR-009 §3.2`) and measures the `< 5 ms` per-contour benchmark across the 63 contours. That evidence is submitted at **`Gate Auth-2`** to approve **`DEC-13 Stage 2`** before `M02a`/`M02f` production implementation begins.
  - *Note:* Downstream `Gate Auth-2`/`Gate Auth-3` decisions (`DEC-02`–`DEC-06`, `DEC-09`, `DEC-11`, `DEC-13 Stage 2`) and `Gate Auth-4` commercial/legal decisions (`ADR-008 Schema`, `DEC-07`, `DEC-08`, `DEC-10`, `DEC-12`) do **not** block `Gate Auth-1`.

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
- **`NumericalVerificationRecord` (`ADR-009 §2.5`)**: Records `x_float64`, `x_ref`, `observed_discrepancy_e_obs`, `reference_enclosure_b_ref`, `implementation_to_exact_bound_b_cert`, `parameter_enclosure: { t_lower, t_upper, t_mid, r_param, residual_interval_lower, residual_interval_upper } | null`, `output_propagation: { propagation_method: "NONE_DIRECT_ENCLOSURE" | "METHOD_B1_VALIDATED_DERIVATIVE" | "METHOD_B2_DIRECT_INTERVAL_IMAGE", derivative_upper_bound_m, point_evaluation_rounding_bound_delta_eval, output_enclosure_radius_b_ref_x } | null`, `acceptance_tolerance_tau`, `verification_outcome: "CERTIFIED_VALID" | "CERTIFIED_INVALID" | "INCONCLUSIVE"`, and `reproducibility_manifest`.
- **`IntervalLibraryQualificationReport` (`ADR-009 §3.2`)**: Records the 8-point qualification of `mpmath.iv` against exact rational (`fractions.Fraction`) arithmetic.
- **`OffsetValidationRecord` (`ADR-009 §5.3`)**: Records tri-state `verification_outcome` and the 6-category `failure_category`.

## 10. Mathematical & Reference-Oracle Specifications (`Critical Corrections A, B, C, F`)
1. **Explicit Reference Enclosure, Triangle Inequality & Parameter-to-Output Propagation (`Critical Correction B`, `ADR-009 §2`):**
   - The `M00.4` oracle harness enforces:
     $$|X_{\mathrm{float64}} - X_{\mathrm{exact}}| \le |X_{\mathrm{float64}} - X_{\mathrm{ref}}| + |X_{\mathrm{ref}} - X_{\mathrm{exact}}| = E_{\mathrm{obs}} + B_{\mathrm{ref}}(X)$$
   - **Parameter Uncertainty Is Not Output Error (`ADR-009 §2.3`):** Whenever an operation isolates a root $t^* \in I = [\underline{t}, \overline{t}]$, $r_{\mathrm{param}} = \frac{\overline{t} - \underline{t}}{2}$ bounds only $|t^* - t_{\mathrm{mid}}|$ and **never** substitutes for $B_{\mathrm{ref}}(X)$. Geometric output error is bounded via **`Method B1` (Validated Derivative Bound)**:
     $$|X(t^*) - X(t_{\mathrm{mid}})| \le M_X(I)\,r_{\mathrm{param}} + \delta_{\mathrm{eval}}, \qquad M_X(I) = \overline{\sup_{t \in I} \|X'(t)\|}$$
     or **`Method B2` (Direct Interval Image Enclosure)** $X(I) = [\underline{X}(I), \overline{X}(I)]$.
   - For Green's area (`Method C2`), $X_{\mathrm{ref}}$ is evaluated in exact rational arithmetic (`fractions.Fraction`), establishing $B_{\mathrm{ref}} = 0$.
2. **Four-Layer `Method C1-Cert` Assurance & 8-Point `IntervalLibraryQualificationReport` (`Critical Correction C`, `ADR-009 §3`):**
   - Separates Layer 1 (Mathematical theorem: non-strict inequality $L_{\mathrm{chord}}(\mathbf{B}_k) \le L_{\mathrm{exact}}(\mathbf{B}_k) \le L_{\mathrm{control\ polygon}}(\mathbf{B}_k)$, with equality on degenerate/collinear segments), Layer 2 (De Casteljau leaf summation), Layer 3 (8-point `IntervalLibraryQualificationReport` qualifying `mpmath.iv` against `fractions.Fraction`), and Layer 4 (Empirical verification).
   - Prohibits unconditioned absolute mathematical-certification claims for interval library outputs.
3. **Corrected Offset Derivative Sign, Separate $Q(t)=0$ Handling, Six-Category Offset Failure Taxonomy & 14 Adversarial Test Families (`Critical Correction A`, `ADR-009 §4–§5`):**
   - Under $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\hat{\mathbf{n}}_+(t)$ ($d > 0$, $s \in \{-1, +1\}$) and $\hat{\mathbf{n}}_+'(t) = -\kappa(t)\,\mathbf{B}'(t)$, the exact offset derivative is:
     $$\mathbf{O}'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t), \qquad f(t) = 1 - \frac{s\,d\,C(t)}{Q(t)^{3/2}} \quad (Q(t) > 0)$$
   - Base-curve stationary points ($Q(t) = 0$) are checked **first** via exact rational (`fractions.Fraction`) + Bernstein interval root isolation before dividing by $Q(t)^{3/2}$ or evaluating $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2$.
   - All evolute-cusp ($f(t^*)=0$), tangent-reversal ($f(t)<0$), and regularity-margin ($0 < f(t) < \varepsilon_{\mathrm{margin}}$) predicates enforce the mandatory sign gate $s\,d\,C(t) > 0$.
4. **Five-Dimensional Oracle Independence (`Critical Correction F`, `ADR-009 §6`):**
   - Enforces algorithmic, source-code, arithmetic/library (`fractions.Fraction` verification of `mpmath.iv`), input/fixture, and reviewer/verification independence.

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
- **`M00.4` — Independent Python Reference-Oracle Harness & Interval Library Qualification (`tests/oracles/`):** Implement the standalone `mpmath.iv` / `fractions.Fraction` / Bernstein reference-oracle harness enforcing the 5-concept numerical assurance model with parameter-to-output propagation (`Method B1/B2`), the 8-point `IntervalLibraryQualificationReport`, the corrected offset derivative $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, the 14 adversarial geometry test families (`ADR-009 §4.4`), and 5-dimensional oracle independence (`ADR-009 §6`).
- **`M00.5` — Monorepo Workspace Scaffolding:** Initialize directory skeletons for `services/fashion-engine`, `apps/web`, and `packages/contracts`.
- **`M00.6` — Contract Compatibility & Versioning Baseline:** Configure OpenAPI 3.1 + JSON Schema Draft 2020-12 validation and codegen.
- **`M00.7` — Legacy TypeScript Freeze & Preservation Policy:** Mark `src/engine/*` frozen via CI hash/AST check (no new domain features in TS; legacy code preserved read-only for Class A differential comparison until `M02`/`M05` parity sign-off).
- **`M00.8` — CI/CD Verification & Boundary Lint Harness:** Configure CI checks enforcing `AC-01`, `AC-04`, and zero shared imports between `tests/oracles/` and `app/pattern_engine/`.
- **`M00.9` — Canonical RFC 8785 (JCS) Serialization & SHA-256 Parity Baseline:** Verify 100% digest parity across Python and TypeScript on 100 canonical JSON vectors.
- **`M00.10` — Migration Readiness Audit Gate:** Verify all `M00.1`–`M00.9` deliverables pass and deliver the `IntervalLibraryQualificationReport` + `< 5 ms` benchmark for `DEC-13 Stage 2` at `Gate Auth-2`.

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Follows `/plan/04_MIGRATION_AND_PARITY_POLICY.md`. `M00` produces the independent oracle harness, `IntervalLibraryQualificationReport`, and Class A/B fixtures; `M02` and `M05` subsequently implement the production Python modules tested against them.

## 16. Unit, Property & Adversarial Test Plan (Oracle Self-Verification — 14 Families)
- Verify the `M00.4` oracle harness against all **14 mandatory adversarial geometry test families (`ADR-009 §4.4`)**:
  1. Convex vs. concave offset with identical $|\kappa(t)|$ and opposite curvature sign ($s\,d\,C(t) < 0$ vs. $s\,d\,C(t) > 0$),
  2. Exact evolute cusp $1 - s\,d\,\kappa(t^*) = 0$ ($Q(t^*) > 0, s\,d\,C(t^*) > 0, P_{\mathrm{exact}}(t^*) = 0$),
  3. Over-offset tangent reversal $1 - s\,d\,\kappa(t) < 0$ ($Q(t) > 0, s\,d\,C(t) > Q(t)^{3/2}$),
  4. Near-cusp inside regularity margin $0 < 1 - s\,d\,\kappa(t) < \varepsilon_{\mathrm{margin}}$,
  5. Base-curve stationary point $Q(t^*) = 0$ at $t^* = 0.25$ and non-dyadic $t^* = 1/3$,
  6. Inflection point $C(t^*) = 0$ inside segment,
  7. High-curvature tight armhole / crotch curve,
  8. Nearly flat cubic segment (verifying non-strict inequality $L_{\mathrm{chord}} \le L_{\mathrm{exact}} \le L_{\mathrm{control\ polygon}}$),
  9. Steep parameterization / large $\|X'(t)\|$ where tiny parameter bracket $r_{\mathrm{param}}$ causes large geometric output error (`Method B1/B2`),
  10. Local self-intersection without cusp,
  11. Global self-intersection between non-adjacent segments,
  12. Short-span `2%` segment on curved contour (`DEF-M00-02`),
  13. Extraneous size keys (`XXXL: 99`) and conflicting quantity basis (`DEF-M00-03`),
  14. Missing `expectedTenantId` with blank artifact `tenantId` (`DEF-M00-04`).

## 17. Independent Verification Boundary (`Critical Correction F`)
- Enforces the 5-dimensional oracle independence model (`ADR-009 §6`) and 7-point separation table in `04_MIGRATION_AND_PARITY_POLICY.md §2.3`: `services/fashion-engine/tests/oracles/` has zero shared code with `services/fashion-engine/app/pattern_engine/` and cross-checks `mpmath.iv` against exact rational arithmetic (`fractions.Fraction`).

## 18. Physical, Manufacturing or Financial Validation Protocol
- Digital calibration vector check: verify that the normative $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square Class B fixture has exact rational perimeter $40.0\text{ cm}$ and area $100.0\text{ cm}^2$ with $B_{\mathrm{ref}} = 0$ and equality $L_{\mathrm{chord}} = L_{\mathrm{exact}} = L_{\mathrm{control\ polygon}}$.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`** (Contract & schema validity), **`AC-02`** (Defect reproduction & 14-family oracle self-tests), **`AC-03`** (5-concept reference enclosure, parameter-to-output bounds, 8-point `IntervalLibraryQualificationReport` & tri-state oracle verification), **`AC-04`** (AST boundary linter, 5-dimensional oracle independence & legacy TS freeze active). Completes migration readiness for **`Gate Auth-2`**.

## 20. Failure Modes, Rollback & Recovery Procedures
- CI fails closed on any unapproved modification to frozen `src/engine/*`, any import from `app/pattern_engine/` inside `tests/oracles/`, any root-isolated quantity missing `output_propagation`, or any Class B fixture lacking an explicit `assurance_classification`.

## 21. Observability, Audit Logging & Telemetry
- Emits `artifacts/m00-oracle-report.json` containing serialized `IntervalLibraryQualificationReport`, `NumericalVerificationRecord`, and `OffsetValidationRecord` entries for all Class A and Class B fixtures.

## 22. Explicit Non-Goals & Scope Guardrails (`Section 9`)
- **`R2.1.2 publication does not authorize M00. M00 remains blocked pending explicit owner approval.`**
- `M00` does **not** modify `src/engine/*` application files.
- `M00` does **not** implement production geometry, production offset generation/trimming, production grading, or production piece sheets (all owned by `M02` and `M05`).

## 23. Downstream Unlocks
- Passing `M00.10` (together with `Gate Auth-2` decision approvals including `DEC-13 Stage 2` in `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`) unlocks **`M01`** (Canonical Foundation, Contracts & Security) and **`M02a`** (Authoritative Production Geometry Kernel in Python).

## 24. Definition of Done Checklist
- [ ] `Gate Auth-1` approvals (`ADR-009` (`R2.1.2`), `DEC-01`, `DEC-13 Stage 1` + Project-Owner `AUTH-M00-START` authorization) recorded before starting `M00`.
- [ ] `M00.1`–`M00.10` migration-preparation work packages completed with zero production geometry implementation contamination.
- [ ] All 6 residual defects (`DEF-M00-01`–`DEF-M00-06`) reproduced against Class A snapshots and encoded in Class B normative fixtures.
- [ ] Independent `M00.4` oracle harness operational with 5-concept error enclosures, parameter-to-output propagation (`Method B1/B2`), 8-point `IntervalLibraryQualificationReport`, corrected offset derivative $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, 6-category offset failure taxonomy, 14 adversarial geometry test families, and tri-state outcomes (`CERTIFIED_VALID`, `CERTIFIED_INVALID`, `INCONCLUSIVE`).
- [ ] RFC 8785 cross-language SHA-256 digest parity verified on 100 test vectors and `isProductionReady: false` global invariant verified.
