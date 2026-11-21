# PATRONER — PKG-M00-04 Owner Adjudication Dossier (`I-08`)

- **Document Role:** Non-Decisional Project Owner Governance Adjudication Dossier (`PKG-M00-04`, Finding `I-08`)
- **Authoritative Source Register Preserved Verbatim:** `docs/evidence/M00_GOVERNANCE_AND_SPEC_CONFLICT_REGISTER.md` (`CONFLICT-D1` through `CONFLICT-D10`)
- **Prepared Date (UTC):** `2026-11-21`
- **Governance Status Preserved Unchanged:**
  - `M00`: **NOT ACCEPTED**
  - `Gate Auth-2`: **CLOSED**
  - `Gate Auth-3`: **CLOSED**
  - `Gate Auth-4`: **CLOSED**
  - `DEC-13 Stage 2`: **CLOSED**
  - `AC-09` Physical Toile Validation: **PENDING**
  - `M01` / `M02` / `M03` / `P1-3`: **NOT STARTED / NOT AUTHORIZED**
  - `externalCadInteroperabilityVerified`: **`false`** (deferred to `M05`)
  - `isProductionReady`: **`false`** wherever production readiness is unestablished

> **NON-DECISIONAL AUTHORITY NOTICE:** This dossier does **NOT** decide, waive, rewrite, or close any governance conflict, does **NOT** modify any ADR or `plan/` file, and does **NOT** open `Gate Auth-2` or `DEC-13 Stage 2`. Every conflict below remains **`PENDING OWNER ADJUDICATION`** until the Project Owner records an explicit signed disposition.

---

## Summary Matrix (`CONFLICT-D1` – `CONFLICT-D10`)

| Conflict ID | Domain | Severity | Technical Pre-Work in `PKG-M00-04` | Governance Status | Blocks | Controlled Docs Potentially Amended |
| :--- | :--- | :---: | :--- | :---: | :--- | :--- |
| **`CONFLICT-D1`** | `DEC-13 Stage 2` Numerical Stack | **CRITICAL** | Symmetric 10k + 63 canonical garment contour benchmark implemented & isolated (`I-04`) | **PENDING OWNER ADJUDICATION** | `M00` acceptance, `DEC-13 Stage 2`, `Gate Auth-2` | `ADR-009 §7.2`, `plan/15` (if amended) |
| **`CONFLICT-D2`** | `M06` Benchmarks `B1`–`B4` Tolerances | **MEDIUM** | None (governance-only spec reconciliation) | **PENDING OWNER ADJUDICATION** | `DEC-02 Stage 1`, `M06` (`AC-08`) | `plan/00:69`, `plan/07`, `plan/16:62` |
| **`CONFLICT-D3`** | Skirt Grading Ownership (`M02d` / `M02g` / `P1-3`) | **HIGH** | `P1-3` preserved `NOT STARTED`; TS `src/engine/` audited by `check_oracle_independence.py` (`I-02`) | **PENDING OWNER ADJUDICATION** | Roadmap alignment, `DEC-06` | `docs/evidence/P1_2_*` errata or `ADR-001` |
| **`CONFLICT-D4`** | Python Engine Directory (`fashion-engine` vs `geometry-engine`) | **HIGH** | Existing `services/geometry-engine/` preserved untouched | **PENDING OWNER ADJUDICATION** | `M00.3` / `M01` / `M02` layout | `ADR-001`, `ADR-002`, `ADR-009`, `M01`–`M06` OR `plan/00`, `plan/15`, `plan/16` |
| **`CONFLICT-D5`** | `M00.3` Monorepo Root Configuration Files | **HIGH** | Absence of `pnpm-workspace.yaml`/`turbo.json` reported honestly (no fabricated `M00.3 PASS`) | **PENDING OWNER ADJUDICATION** | `M00.3` exit verification | `plan/workloads/M00_MIGRATION_PREPARATION.md` (`M00.3`) or `DEC-01` |
| **`CONFLICT-D6`** | Stale M00 Reports, Stale TS Test Counts & Prototype Gate Labels | **MEDIUM** | Historical Checkpoint 13A/15 root `.md` reports segregated under `historicalPreservedReports` in manifest (`I-07`) | **PENDING OWNER ADJUDICATION** | Audit trail hygiene | `plan/03`, historical closeout errata |
| **`CONFLICT-D7`** | `ADR-009 §2.5 & §5.3` vs Implemented Schemas | **HIGH** | Full `ADR-009 §2.5` & `§5.3` parity + 8 contradictory-state validators implemented in `contracts.py` & JSON Schema (`I-06`) | **PENDING OWNER ADJUDICATION** | `M00.1`, `M00.4`, `M02f` contracts | `ADR-009 §§2.5 & 5.3` (confirm alignment) |
| **`CONFLICT-D8`** | `ADR-003 §2.2(4)` vs `ADR-009 §4.4` Six-Category Taxonomy | **MEDIUM** | Code enforces `ADR-009 §4.4` 7-enum taxonomy (`I-06`); `ADR-003` untouched | **PENDING OWNER ADJUDICATION** | `ADR-003`/`ADR-009` parity | `plan/decisions/ADR-003`, `plan/00:40–41` |
| **`CONFLICT-D9`** | Missing AST Oracle-Independence Linter (`ADR-009 §7.1`) | **HIGH** | Hardened `scripts/check_oracle_independence.py` implemented, blocking all 4 dynamic bypasses + auditing TS `src/engine/` (`I-02`) | **PENDING OWNER ADJUDICATION** | `M00.4`, `AC-04`, `M02` entry | None (conforms to `ADR-009 §7.1`) |
| **`CONFLICT-D10`** | Conflation of Pre-Gate Verification vs Formal Acceptance | **HIGH** | All hardcoded pass flags removed; `M00: NOT ACCEPTED` and `Gate Auth-2: CLOSED` enforced across all active manifests (`I-01`, `I-07`) | **PENDING OWNER ADJUDICATION** | `M00` acceptance & `Gate Auth-2` governance | `plan/15`–`plan/17` framing alignment |

---

## Detailed Owner Adjudication Briefs (`CONFLICT-D1` – `CONFLICT-D10`)

### `CONFLICT-D1` — `DEC-13 Stage 2` Numerical Library Selection (`mpmath.iv` vs `python-flint`)
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **CRITICAL**
- **Original Register Summary (Verbatim):** Asymmetric benchmark (`qualification.py:1511–1556`) invalidates the cited `~65.0x` `python-flint` vs `mpmath.iv` latency comparison used to brief `DEC-13 Stage 2`.
- **Original Conflicting Sources (Verbatim):**
  - `plan/15_M00_EXECUTION_AND_READINESS.md` (lines 57, 64) & `artifacts/m00/IntervalCandidateBenchmarks.json` (lines 12–73): Report `mpmath.iv` median `0.9883 ms` (`p95 = 1.2243 ms`) vs `python-flint` median `0.0152 ms` (`p95 = 0.0181 ms`, cited as `~65.0x` speedup) and `DecimalInterval` median `0.1139 ms` (`p95 = 0.1259 ms`).
  - `M00_REPRODUCIBILITY_REPORT.json` (lines 82–87): Claims `deterministicOperationCountsPerBenchmarkIteration` executes `1` power-to-Bernstein, `2` De Casteljau subdivisions, `2` Descartes scans, and `13` Horner evaluations.
  - `services/geometry-engine/patroner_geometry/qualification.py` (lines 1511–1556): Executes `power_to_bernstein_exact` + `1` `de_casteljau_subdivide_exact` + `2` `descartes_sign_variations_exact` + monomial power eval (`t_iv**k`) **ONLY inside the `mpmath.iv` timing loop** (`:1519–1528`), while `python-flint` (`:1535–1540`) and `DecimalInterval` (`:1547–1555`) time **only** a degree-12 monomial evaluation.
  - `plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md` (`§7.2`, line 152): Requires `< 5 ms` per-contour benchmark across **63 canonical garment contours** (not 20 iterations of one synthetic polynomial) for `DEC-13 Stage 2`.
- **`PKG-M00-04` Technical Context:** `PKG-M00-04` (`I-04`) implemented a deterministic 63-contour corpus exporter (`scripts/m00_export_canonical_63_contours.ts`, disclosing missing trouser-block coverage explicitly) and symmetric per-contour benchmarking across all 3 candidates (`mpmath.iv`, `python-flint`, `DecimalInterval`) isolated inside `artifacts/m00/IntervalCandidateBenchmarks.json` and `RuntimeBenchmarkObservation.json`.
- **Owner Decision Options & Consequences:**
  - **Option A:** Base `DEC-13 Stage 2` exclusively on the newly generated symmetric 63-contour benchmark measurements in `RuntimeBenchmarkObservation.json`, selecting the fastest qualified candidate meeting `< 5 ms` P95 (or dual-tier `python-flint` primary / `mpmath.iv` high-precision reference) and noting the trouser-block corpus gap until `M02`. *Consequence:* Scientifically valid `DEC-13 Stage 2` decision; requires Owner explicit acknowledgment of trouser-block absence from the 63-contour corpus.
  - **Option B:** Defer `DEC-13 Stage 2` binding selection for trouser contours until `M02` drafts `trouser-block`, while authorizing `ADR-009 §7.2` amendment clarifying corpus composition (5 drafted piece families x 6 sizes = 63 contours vs trouser inclusion). *Consequence:* Requires formal `ADR-009 §7.2` amendment; avoids any unacknowledged spec deviation.
  - **Option C:** Block `DEC-13 Stage 2` until `trouser-block` is implemented and benchmarked. *Consequence:* Creates circular dependency unless `trouser-block` is explicitly carved out of `Gate Auth-2`.
- **Non-Decisional Technical Recommendation:** Option A paired with an explicit `ADR-009 §7.2` clarification note recording the measured 63-contour latencies and trouser-block deferral to `M02`.
- **Dependency Links:** `M00.4`, `M00` acceptance, `DEC-13 Stage 2`, `Gate Auth-2`, `M02c`/`M02e`/`M02f`.
- **ADR / Plan Amendment Flag:** **MAY REQUIRE AMENDMENT** (`ADR-009 §7.2` regarding trouser-block inclusion & any candidate exceeding 5 ms P95; `plan/15` historical speedup figures).

---

### `CONFLICT-D2` — `M06` Cloth Solver Analytical Benchmarks `B1`–`B4` Tolerance Authority
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **MEDIUM**
- **Original Register Summary (Verbatim):** `plan/00:69` & `plan/07` state generic `<= 5%` error, whereas `ADR-005:25` & `M06:63–67` specify exact tolerances (`B1 <= 0.1%`, `B2 <= 1.5%`, `B3 <= 0.5 mm`, `B4 < 2.0%`).
- **Original Conflicting Sources (Verbatim):**
  - `plan/00_BLUEPRINT_REVISION_2.md` (line 69): `"cloth drape solver qualified against Benchmarks B1–B4 (<= 5% error)"`.
  - `plan/decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md` (line 25) & `plan/workloads/M06_SIMULATION_FIT_AND_OPTIMIZATION.md` (lines 63–67): Specify distinct exact thresholds — `B1` Uniaxial Membrane Patch `<= 0.1%`, `B2` Cantilever Elastica `<= 1.5%`, `B3` Catenary Suspension `<= 0.5 mm`, `B4` Mesh Refinement Convergence `< 2.0%`.
  - *(Also echoed in `plan/16_UNIFIED_EXECUTION_SCHEDULE.md` line 62: `"Benchmarks B1–B4 (<= 5% error)"`.)*
- **Owner Decision Options & Consequences:**
  - **Option A:** Affirm `ADR-005:25` & `M06:63–67` per-benchmark strict tolerances (`B1 <= 0.1%`, `B2 <= 1.5%`, `B3 <= 0.5 mm`, `B4 < 2.0%`) as sole governing authority for `AC-08` and `DEC-02 Stage 2`, updating `plan/00:69`, `plan/07`, and `plan/16:62` in the next documentation revision. *Consequence:* Higher physics fidelity; stricter solver convergence requirement in `M06`.
  - **Option B:** Relax `ADR-005` & `M06` to a uniform `<= 5%` ceiling. *Consequence:* Weakens membrane/cantilever/catenary validation rigor.
- **Non-Decisional Technical Recommendation:** Option A (strict per-benchmark tolerances in `ADR-005` / `M06`).
- **Dependency Links:** `DEC-02 Stage 1` (`Gate Auth-2`), `DEC-02 Stage 2` (`Gate Auth-3`), `M06`, `AC-08`.
- **ADR / Plan Amendment Flag:** **REQUIRES PLAN AMENDMENT** (`plan/00`, `plan/07`, `plan/16` under Option A; `ADR-005` & `M06` under Option B).

---

### `CONFLICT-D3` — Skirt Grading Authority (`M02d` / `M02g` vs `P1-3`)
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **HIGH**
- **Original Register Summary (Verbatim):** `P1_2_CONSOLIDATION_AND_INTEGRITY_EVIDENCE.md:163` states `P1-3` (TypeScript skirt grading) is next, contradicting `ADR-001`, `plan/04`, and `M02` (`M02d`/`M02g` Python authority post-`Gate Auth-2`).
- **Original Conflicting Sources (Verbatim):**
  - `docs/evidence/P1_2_CONSOLIDATION_AND_INTEGRITY_EVIDENCE.md` (line 163): Refers to `P1-3` (TypeScript skirt grading in `src/engine/`) as the next milestone.
  - `plan/decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md`, `plan/04_MIGRATION_AND_PARITY_POLICY.md`, `plan/workloads/M02_DETERMINISTIC_FASHION_ENGINE.md`: Prohibit adding new authoritative pattern-engineering features to browser TypeScript (`C0-Legacy`); assign multi-size pattern blocks (`M02d`) and grading (`M02g`) exclusively to the Python backend post-`Gate Auth-2`.
- **Owner Decision Options & Consequences:**
  - **Option A:** Formally retire/close `P1-3` as superseded by `ADR-001`, keeping `src/engine/` frozen as `C0-Legacy` and executing skirt multi-size grading strictly in Python `M02d`/`M02g` after `Gate Auth-2`. *Consequence:* Enforces single authoritative geometry/grading kernel; zero dual-engine drift.
  - **Option B:** Issue an explicit `ADR-001` exception authorizing legacy TypeScript `P1-3`. *Consequence:* Expands deprecated browser prototype surface and increases `M02` parity migration cost.
- **Non-Decisional Technical Recommendation:** Option A (keep `P1-3` retired/unauthorized; deliver skirt grading in Python `M02d`/`M02g`).
- **Dependency Links:** `ADR-001`, `plan/04`, `Gate Auth-2`, `M02d`, `M02g`, `DEC-06`.
- **ADR / Plan Amendment Flag:** **NO ADR AMENDMENT UNDER OPTION A** (append closeout errata to `P1_2_CONSOLIDATION_AND_INTEGRITY_EVIDENCE.md` if Owner approves); **REQUIRES `ADR-001` EXCEPTION UNDER OPTION B**.

---

### `CONFLICT-D4` — Authoritative Python Service Directory Name (`services/fashion-engine/` vs `services/geometry-engine/`)
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **HIGH**
- **Original Register Summary (Verbatim):** `ADR-001`, `ADR-002`, `ADR-009`, `M01`, `M02`, `M03`, `M05`, `M06` mandate `services/fashion-engine/`; `plan/00:53`, `plan/15`, and M00 code use `services/geometry-engine/`.
- **Original Conflicting Sources (Verbatim):**
  - `ADR-001`, `ADR-002`, `ADR-009` (lines 99, 128, 131, 150), `M01`, `M02`, `M03`, `M05`, `M06`: Specify **`services/fashion-engine/`** as the single Python computational backend directory.
  - `plan/00_BLUEPRINT_REVISION_2.md` (line 53), `plan/15`, and actual M00 implementation: Created **`services/geometry-engine/`** (`services/fashion-engine/` does not exist).
- **Owner Decision Options & Consequences:**
  - **Option A:** Designate `services/fashion-engine/` as the unified production backend for `M01`–`M06` (either migrating `services/geometry-engine/` or scoping `services/geometry-engine/` exclusively as the isolated Tier-2 M00 verification oracle package). *Consequence:* Naturally reinforces `ADR-009 §5.4` Tier-1 (`services/fashion-engine/`) vs Tier-2 (`services/geometry-engine/`) physical isolation; requires `plan/00:53` & `plan/16:58` clarification.
  - **Option B:** Designate `services/geometry-engine/` as the canonical single Python service directory and amend `ADR-001`, `ADR-002`, `ADR-009`, and `M01`–`M06`. *Consequence:* Zero directory rename needed; requires multi-ADR text amendment.
- **Non-Decisional Technical Recommendation:** Option A (keep `services/geometry-engine/` as Tier-2 oracle or migrate cleanly at `M01` entry under `services/fashion-engine/`) to align with all ADRs and strengthen Tier-1/Tier-2 separation.
- **Dependency Links:** `M00.3`, `M01.1`, `M02`, `M03`, `M05`, `M06`, `ADR-001`, `ADR-002`, `ADR-009`.
- **ADR / Plan Amendment Flag:** **REQUIRES PLAN/ADR ALIGNMENT** (`plan/00`, `plan/15`, `plan/16` under Option A; `ADR-001`, `ADR-002`, `ADR-009`, `M01`–`M06` under Option B).

---

### `CONFLICT-D5` — Missing `M00.3` Monorepo Root Configurations (`pnpm-workspace.yaml`, `turbo.json`)
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **HIGH**
- **Original Register Summary (Verbatim):** `M00.3` (`DEC-01`) specifies root `pnpm-workspace.yaml` and `turbo.json`, which do **not** exist on disk, yet M00 reports claim `M00.3` `PASS`/`VERIFIED`.
- **Original Conflicting Sources (Verbatim):**
  - `plan/workloads/M00_MIGRATION_PREPARATION.md` (`M00.3`) & `DEC-01`: Require a monorepo workspace skeleton with root `pnpm-workspace.yaml` and `turbo.json`.
  - Actual workspace `/app/applet`: Neither `pnpm-workspace.yaml` nor `turbo.json` exists (`os.path.exists == False`).
  - `ReproducibleEnvironmentManifest.json` & `M00_GATE_AUTH2_READINESS_REPORT.md` (line 17): Claim `M00.3` `PASS` / `VERIFIED`.
- **Owner Decision Options & Consequences:**
  - **Option A:** Require creation and CI validation of root `pnpm-workspace.yaml` and `turbo.json` (plus `apps/web` / `packages/contracts` workspace wiring) before `M00` formal acceptance. *Consequence:* Strictly satisfies `M00.3` as written; requires a small bounded follow-up workspace-config step (taking care not to break existing Vite/npm runtime in `/app/applet`).
  - **Option B:** Formally amend `M00.3` to defer `pnpm-workspace.yaml` and `turbo.json` orchestration to `M01.1` (monorepo scaffolding) while preserving existing single-package Vite/npm scripts during `M00`. *Consequence:* Allows `M00` acceptance without disturbing the live `npm` preview environment; requires explicit Owner waiver/amendment of `M00.3`.
- **Non-Decisional Technical Recommendation:** Option B (defer `pnpm`/`turbo` cutover to `M01.1` via explicit `M00.3` amendment) to avoid disrupting the existing `npm`-based Vite runtime prior to `Gate Auth-2`.
- **Dependency Links:** `M00.3`, `DEC-01`, `M00` acceptance, `Gate Auth-2`, `M01.1`.
- **ADR / Plan Amendment Flag:** **REQUIRES `M00.3` AMENDMENT UNDER OPTION B**; **NO AMENDMENT UNDER OPTION A**.

---

### `CONFLICT-D6` — Stale Root M00 Summaries, Stale TS Test Counts & Prototype Evidence Gate Labels
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **MEDIUM**
- **Original Register Summary (Verbatim):** Root Checkpoint 15 M00 summaries cite obsolete SHA-256 digests/`124` checks; `plan/03` & `M00_REMEDIATION_CHANGELOG.md` cite stale TS counts (`795`/`688` vs `892`); `LIVE_PRODUCT_AUDIT_AND_P0_REMEDIATION_EVIDENCE.md:6–9` uses non-canonical gate names.
- **Original Conflicting Sources (Verbatim):**
  - `M00_GATE_AUTH2_READINESS_REPORT.md` (pre-reconciliation) & `M00_GATE_AUTH2_READINESS_MATRIX.md`: Cite obsolete Checkpoint 15 SHA-256 digests, `124/124` and `62/62` qualification counts, and `1.92 ms` / `0.02 ms` / `0.14 ms` timings rather than Checkpoint 16 (`PKG-M00-02`) artifacts.
  - `plan/03_REPOSITORY_BASELINE_AND_AUDIT.md` & `M00_REMEDIATION_CHANGELOG.md`: Cite historical TS prototype counts (`795` / `688` tests) rather than the independently verified P1-2 Final Closeout baseline (`892/892` across `184` suites).
  - `docs/evidence/LIVE_PRODUCT_AUDIT_AND_P0_REMEDIATION_EVIDENCE.md` (lines 6–9): Uses non-canonical gate identifiers inconsistent with `plan/10_RELEASE_AND_GOVERNANCE_POLICY.md` (`Gate Auth-1`..`Gate Auth-4`).
- **`PKG-M00-04` Technical Context:** Root Checkpoint 13A/15 Markdown files remain preserved untouched on disk and are now explicitly segregated under `historicalPreservedReports` (not active `PKG-M00-04` outputs) in `M00_ARTIFACT_HASH_VERIFICATION.json`.
- **Owner Decision Options & Consequences:**
  - **Option A:** Formally archive the 5 root Checkpoint 13A/15 `.md` reports as superseded historical snapshots and designate `docs/evidence/pkg_m00_04/FINAL_VERIFICATION_REPORT.md` + `M00_ARTIFACT_HASH_VERIFICATION.json` (`PKG-M00-04`) as the active Owner briefing baseline. *Consequence:* Eliminates report confusion while preserving full historical audit lineage.
  - **Option B:** Authorize updating `plan/03` and appending supersession headers to the 5 root `.md` reports. *Consequence:* Slightly cleaner root directory; modifies historical files under explicit Owner direction.
- **Non-Decisional Technical Recommendation:** Option A (preserve historical files untouched, segregate in manifest, brief from `PKG-M00-04` reports).
- **Dependency Links:** Audit trail hygiene, `Gate Auth-2` review package.
- **ADR / Plan Amendment Flag:** **OPTIONAL `plan/03` BASELINE REFRESH** (not blocking).

---

### `CONFLICT-D7` — `ADR-009 §2.5 & §5.3` Schema Specification vs Implemented `contracts.py` / `canonical_contracts.schema.json`
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **HIGH**
- **Original Register Summary (Verbatim):** `contracts.py` & `canonical_contracts.schema.json` omit mandatory `ADR-009 §2.5` (`NumericalVerificationRecord`) and `§5.3` (`OffsetValidationRecord`) fields, duplicate 4 `OffsetFailureCategory` aliases, and omit fail-closed validation on `OffsetClassificationReport`.
- **Original Conflicting Sources (Verbatim):**
  - `ADR-009 §2.5`: Mandates `NumericalVerificationRecord` fields including `assurance_classification`, `error_components` (`x_float64`, `x_ref`, `observed_discrepancy_e_obs`, `reference_enclosure_b_ref`, `implementation_to_exact_bound_b_cert`), and `reproducibility_manifest`.
  - `ADR-009 §5.3` (lines 70–91): Mandates `OffsetValidationRecord` fields including `detected_failure_categories`, `coordinate_convention`, `offset_sign_s`, `offset_distance_d_cm`, `max_subdivision_depth_reached`, `primary_span_coverage_ratio`, `local_self_intersection_status`, `global_contour_self_intersection_status`, `unresolved_intervals`, `escalation_trace`.
  - `services/geometry-engine/patroner_geometry/contracts.py` (lines 68–81, 168–278) & `packages/contracts/schemas/canonical_contracts.schema.json` (lines 88–104, 187–381): Implement divergent flat schemas omitting those fields, include 4 duplicate alias strings in `OffsetFailureCategory`, and omit the fail-closed `INCONCLUSIVE -> isProductionReady == False` validator on `OffsetClassificationReport`.
- **`PKG-M00-04` Technical Context:** Fully remediated technically under `I-06`: `contracts.py` and `canonical_contracts.schema.json` now achieve strict Pydantic + JSON Schema Draft 2020-12 parity with all `ADR-009 §2.5` and `§5.3` fields, `UNRESOLVED` stationary status, exact 7-value `OffsetFailureCategory`, and all 8 fail-closed contradictory-state validators.
- **Owner Decision Options & Consequences:**
  - **Option A:** Confirm `PKG-M00-04` `contracts.py` and `canonical_contracts.schema.json` as conforming to `ADR-009 §§2.5 & 5.3` and close `CONFLICT-D7` upon independent verification. *Consequence:* Downstream `M01`/`M02`/`M05` receive strict `ADR-009`-compliant schemas with zero ADR edits needed.
  - **Option B:** Request further field-naming normalization (e.g., camelCase vs snake_case canonicalization across `OffsetValidationRecord` vs `OffsetClassificationReport`) prior to `M01.2` TypeScript codegen. *Consequence:* Improves API ergonomic uniformity at minor contract bump cost.
- **Non-Decisional Technical Recommendation:** Option A (confirm parity closure at `M00` acceptance; schedule any OpenAPI/TS codegen casing policy cleanly in `M01.2`).
- **Dependency Links:** `M00.1`, `M00.4`, `M01.2`, `M02f`, `M05.3`.
- **ADR / Plan Amendment Flag:** **NONE REQUIRED UNDER OPTION A**.

---

### `CONFLICT-D8` — `ADR-003 §2.2(4)` vs `ADR-009 §4.4` Six-Category Offset Taxonomy Naming
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **MEDIUM**
- **Original Register Summary (Verbatim):** `ADR-003:67–74` retains legacy `R2.1.2` category labels (`Category 1`..`Category 4`, `ACTUAL_CURVATURE_CUSP`, `TANGENTIAL_CUSP_DEGENERACY`) while `ADR-009 §4.4` defines the revised 6 failure categories (`REGULARITY_MARGIN_VIOLATION`..`INCONCLUSIVE`).
- **Original Conflicting Sources (Verbatim):**
  - `plan/decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md` (lines 67–74): Defines 6 offset categories using legacy labels (`Category 1: CERTIFIED_REGULAR`, `Category 2a: ACTUAL_ZERO_SPEED_CUSP`, `Category 2b: ACTUAL_CURVATURE_CUSP`, `Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY`, `Category 3: TANGENTIAL_CUSP_DEGENERACY`, `Category 4: SELF_INTERSECTING_NON_LOCAL`).
  - `plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md` (`§4.4`, lines 1–28): Separates the 5-way base-curve singularity taxonomy from the 6 offset failure categories (`REGULARITY_MARGIN_VIOLATION`, `ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`, `TANGENT_REVERSAL`, `LOCAL_SELF_INTERSECTION`, `GLOBAL_SELF_INTERSECTION`, `INCONCLUSIVE`).
- **Owner Decision Options & Consequences:**
  - **Option A:** Declare `ADR-009 §4.4` as the sole authoritative offset & base-curve taxonomy and authorize amending `ADR-003 §2.2(4)` and `plan/00:40–41` to match. *Consequence:* Eliminates all enum-naming ambiguity across ADRs and matches implemented `M00.1`/`M00.4` schemas.
  - **Option B:** Maintain a formal crosswalk table mapping legacy `ADR-003` labels to `ADR-009 §4.4` enums without rewriting historical `ADR-003` prose. *Consequence:* Avoids editing `ADR-003` text, but leaves legacy identifiers in normative docs.
- **Non-Decisional Technical Recommendation:** Option A (declare `ADR-009 §4.4` sole authority and amend `ADR-003 §2.2(4)` + `plan/00:40–41`).
- **Dependency Links:** `ADR-003`, `ADR-009`, `M00.1`, `M02f`, `M05.3`.
- **ADR / Plan Amendment Flag:** **REQUIRES `ADR-003` & `plan/00` AMENDMENT UNDER OPTION A**.

---

### `CONFLICT-D9` — Missing Oracle-Independence AST Linter (`ADR-009 §7.1 & §8`)
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **HIGH**
- **Original Register Summary (Verbatim):** `ADR-009:131,165` mandates `scripts/check_oracle_independence.py` to enforce source-code independence (`AC-04`), but the script does not exist in `/app/applet`.
- **Original Conflicting Sources (Verbatim):**
  - `ADR-009` (lines 131, 165): Mandates `scripts/check_oracle_independence.py` to enforce source-code independence (`AC-04`) between the `M00.4` oracle and `M02` production engine.
  - Workspace `/app/applet`: `scripts/check_oracle_independence.py` does not exist *(at time of initial adversarial audit)*.
- **`PKG-M00-04` Technical Context:** Technically resolved under `I-02`: `scripts/check_oracle_independence.py` now exists, is wired into `.github/workflows/m00-verification.yml`, blocks direct/aliased/relative imports, `importlib.*`, `__import__`, `builtins.__import__`, `getattr(__builtins__, ...)`, `exec`/`eval`/`compile`, `runpy`, and `sys.modules[...]`, audits `__init__.py` & `contracts.py`, enforces strict Tier-2 internal allowlists, and audits TypeScript `src/engine/` per `ADR-001`.
- **Owner Decision Options & Consequences:**
  - **Option A:** Confirm `scripts/check_oracle_independence.py` satisfies `ADR-009 §7.1` / `AC-04` upon independent verification and close `CONFLICT-D9`. *Consequence:* Guardrail active before `M02` entry.
  - **Option B:** Require extending the linter to cover `services/fashion-engine/` explicitly once `CONFLICT-D4` is decided. *Consequence:* Zero gap when `M01`/`M02` directory layout is finalized.
- **Non-Decisional Technical Recommendation:** Option A + Option B (confirm current script satisfies `M00` and extend path mapping cleanly upon `CONFLICT-D4` adjudication).
- **Dependency Links:** `M00.4`, `AC-04`, `CONFLICT-D4`, `M02` entry.
- **ADR / Plan Amendment Flag:** **NONE REQUIRED**.

---

### `CONFLICT-D10` — Pre-Gate Verification Framing vs Formal Acceptance & Unclosed Defects
- **Governance Status:** **PENDING OWNER ADJUDICATION**
- **Severity:** **HIGH**
- **Original Register Summary (Verbatim):** `M00_GATE_AUTH2_READINESS_REPORT.md:7`, `M00_REPRODUCIBILITY_REPORT.json`, and `plan/15`–`plan/17` portray `PKG-M00-02` as fully verified and ready for `Gate Auth-2` despite hardcoded status flags and reproduced numerical/provenance defects.
- **Original Conflicting Sources (Verbatim):**
  - `M00_GATE_AUTH2_READINESS_REPORT.md` (original line 7), `M00_REPRODUCIBILITY_REPORT.json`, and `plan/15`–`plan/17`: Frame M00 as fully verified and ready for `Gate Auth-2` approval.
  - Independent Adversarial Audit (`docs/evidence/M00_INDEPENDENT_ADVERSARIAL_AUDIT_REPORT.md`): Reproduces 16 technical, mathematical, benchmark, schema, and provenance defects demonstrating M00 is **`Technically defective`** and **not ready for formal acceptance**.
- **`PKG-M00-04` Technical Context:** All active `PKG-M00-04` manifests compute pass/fail flags dynamically (zero hardcoded pass booleans), isolate volatile timings from deterministic manifests, and explicitly preserve `m00AcceptanceStatus: "NOT_ACCEPTED"` and `gateAuth2Status: "CLOSED"`.
- **Owner Decision Options & Consequences:**
  - **Option A:** Require an independent read-only re-audit of `PKG-M00-04` (including measured 63-contour latency results and all `CONFLICT-D1`–`CONFLICT-D10` adjudications) prior to any Owner decision on `M00` acceptance or `Gate Auth-2`. *Consequence:* Preserves strict governance integrity.
  - **Option B:** Issue conditional `M00` acceptance paired with written Owner dispositions on `CONFLICT-D1`–`CONFLICT-D10` and explicit scope conditions for `M01`/`M02`. *Consequence:* Unblocks `Gate Auth-2` only after documented Owner sign-off on every open conflict.
- **Non-Decisional Technical Recommendation:** Option A (independent read-only verification of `PKG-M00-04` + explicit Owner sign-off on `CONFLICT-D1`–`CONFLICT-D10` before opening `Gate Auth-2`).
- **Dependency Links:** `M00` acceptance, `Gate Auth-2`, `DEC-13 Stage 2`, `M01`/`M02`/`M03` entry.
- **ADR / Plan Amendment Flag:** **OPTIONAL `plan/15`–`plan/17` STATUS HEADER ALIGNMENT AFTER OWNER DECISION**.

---

## Companion Errata Note (`TRACK_B_ORIGINAL_ROADMAP_READINESS.md`)

In addition to `CONFLICT-D1`–`CONFLICT-D10`, `PKG-M00-04` appended a dated errata section to `docs/prep/TRACK_B_ORIGINAL_ROADMAP_READINESS.md` reconciling four non-authoritative misstatements in that preparation document against `plan/05_WORKLOAD_DEPENDENCY_GRAPH.md` and `plan/16_UNIFIED_EXECUTION_SCHEDULE.md` (`M01` platform foundation scope vs `M02` solver kernel, `M02a`–`M02h` full scope, `M03` parallel unlock at `Gate Auth-2`, and the `plan/05` vs `plan/16` `M11` scope discrepancy). The Owner should note the `plan/05` vs `plan/16` `M11` scope boundary (`M11` listed as post-`Gate Auth-4` expansion in `plan/05` vs "strictly NO `M11`" in the `2027-03-31` execution schedule `plan/16`) during future roadmap maintenance.
