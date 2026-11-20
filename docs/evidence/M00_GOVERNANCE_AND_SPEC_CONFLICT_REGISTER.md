# PATRONER — M00 Governance & Specification Conflict Register

- **Document Role:** Independent Adversarial Audit Companion Register (Documentation-Only Recording)
- **Workspace:** `/app/applet`
- **Audit Date (UTC):** `2026-11-20`
- **Authority Boundary:** This register records concrete, source-cited contradictions across `plan/`, `plan/decisions/`, `plan/workloads/`, `services/geometry-engine/`, `packages/contracts/`, `M00_*.md`, and `docs/evidence/`. **It does NOT resolve governance conflicts on the Project Owner's behalf, does NOT alter any ADR or `plan/` document, and does NOT open any gate.**

---

## Summary Index of Active Conflicts

| Conflict ID | Domain | Severity | Summary | Blocks |
| :--- | :--- | :---: | :--- | :--- |
| **`CONFLICT-D1`** | `DEC-13 Stage 2` Numerical Stack | **CRITICAL** | Asymmetric benchmark (`qualification.py:1511–1556`) invalidates the cited `~65.0x` `python-flint` vs `mpmath.iv` latency comparison used to brief `DEC-13 Stage 2`. | `M00` acceptance, `DEC-13 Stage 2`, `Gate Auth-2` |
| **`CONFLICT-D2`** | `M06` Benchmarks `B1`–`B4` Tolerances | **MEDIUM** | `plan/00:69` & `plan/07` state generic `<= 5%` error, whereas `ADR-005:25` & `M06:63–67` specify exact tolerances (`B1 <= 0.1%`, `B2 <= 1.5%`, `B3 <= 0.5 mm`, `B4 < 2.0%`). | `DEC-02 Stage 1`, `M06` (`AC-08`) |
| **`CONFLICT-D3`** | Skirt Grading Ownership (`M02d` / `M02g` / `P1-3`) | **HIGH** | `P1_2_CONSOLIDATION_AND_INTEGRITY_EVIDENCE.md:163` states `P1-3` (TypeScript skirt grading) is next, contradicting `ADR-001`, `plan/04`, and `M02` (`M02d`/`M02g` Python authority post-`Gate Auth-2`). | Roadmap alignment, `DEC-06` |
| **`CONFLICT-D4`** | Python Engine Directory (`fashion-engine` vs `geometry-engine`) | **HIGH** | `ADR-001`, `ADR-002`, `ADR-009`, `M01`, `M02`, `M03`, `M05`, `M06` mandate `services/fashion-engine/`; `plan/00:53`, `plan/15`, and M00 code use `services/geometry-engine/`. | `M00.3` / `M01` / `M02` layout |
| **`CONFLICT-D5`** | `M00.3` Monorepo Root Configuration Files | **HIGH** | `M00.3` (`DEC-01`) specifies root `pnpm-workspace.yaml` and `turbo.json`, which do **not** exist on disk, yet M00 reports claim `M00.3` `PASS`/`VERIFIED`. | `M00.3` exit verification |
| **`CONFLICT-D6`** | Stale M00 Reports, Stale TS Test Counts & Prototype Gate Labels | **MEDIUM** | Root Checkpoint 15 M00 summaries cite obsolete SHA-256 digests/`124` checks; `plan/03` & `M00_REMEDIATION_CHANGELOG.md` cite stale TS counts (`795`/`688` vs `892`); `LIVE_PRODUCT_AUDIT_AND_P0_REMEDIATION_EVIDENCE.md:6–9` uses non-canonical gate names. | Audit trail hygiene |
| **`CONFLICT-D7`** | `ADR-009 §2.5 & §5.3` vs Implemented Schemas | **HIGH** | `contracts.py` & `canonical_contracts.schema.json` omit mandatory `ADR-009 §2.5` (`NumericalVerificationRecord`) and `§5.3` (`OffsetValidationRecord`) fields, duplicate 4 `OffsetFailureCategory` aliases, and omit fail-closed validation on `OffsetClassificationReport`. | `M00.1`, `M00.4`, `M02f` contracts |
| **`CONFLICT-D8`** | `ADR-003 §2.2(4)` vs `ADR-009 §4.4` Six-Category Taxonomy | **MEDIUM** | `ADR-003:67–74` retains legacy `R2.1.2` category labels (`Category 1`..`Category 4`, `ACTUAL_CURVATURE_CUSP`, `TANGENTIAL_CUSP_DEGENERACY`) while `ADR-009 §4.4` defines the revised 6 failure categories (`REGULARITY_MARGIN_VIOLATION`..`INCONCLUSIVE`). | `ADR-003`/`ADR-009` parity |
| **`CONFLICT-D9`** | Missing AST Oracle-Independence Linter (`ADR-009 §7.1`) | **HIGH** | `ADR-009:131,165` mandates `scripts/check_oracle_independence.py` to enforce source-code independence (`AC-04`), but the script does not exist in `/app/applet`. | `M00.4`, `AC-04`, `M02` entry |
| **`CONFLICT-D10`** | Conflation of Pre-Gate Verification vs Formal Acceptance | **HIGH** | `M00_GATE_AUTH2_READINESS_REPORT.md:7`, `M00_REPRODUCIBILITY_REPORT.json`, and `plan/15`–`plan/17` portray `PKG-M00-02` as fully verified and ready for `Gate Auth-2` despite hardcoded status flags and reproduced numerical/provenance defects. | `M00` acceptance & `Gate Auth-2` governance |

---

## Detailed Conflict Entries

### `CONFLICT-D1` — `DEC-13 Stage 2` Numerical Library Selection (`mpmath.iv` vs `python-flint`)
- **Conflicting Sources:**
  - `plan/15_M00_EXECUTION_AND_READINESS.md` (lines 57, 64) & `artifacts/m00/IntervalCandidateBenchmarks.json` (lines 12–73): Report `mpmath.iv` median `0.9883 ms` (`p95 = 1.2243 ms`) vs `python-flint` median `0.0152 ms` (`p95 = 0.0181 ms`, cited as `~65.0x` speedup) and `DecimalInterval` median `0.1139 ms` (`p95 = 0.1259 ms`).
  - `M00_REPRODUCIBILITY_REPORT.json` (lines 82–87): Claims `deterministicOperationCountsPerBenchmarkIteration` executes `1` power-to-Bernstein, `2` De Casteljau subdivisions, `2` Descartes scans, and `13` Horner evaluations.
  - `services/geometry-engine/patroner_geometry/qualification.py` (lines 1511–1556): Executes `power_to_bernstein_exact` + `1` `de_casteljau_subdivide_exact` + `2` `descartes_sign_variations_exact` + monomial power eval (`t_iv**k`) **ONLY inside the `mpmath.iv` timing loop** (`:1519–1528`), while `python-flint` (`:1535–1540`) and `DecimalInterval` (`:1547–1555`) time **only** a degree-12 monomial evaluation.
  - `plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md` (`§7.2`, line 152): Requires `< 5 ms` per-contour benchmark across **63 canonical garment contours** (not 20 iterations of one synthetic polynomial) for `DEC-13 Stage 2`.
- **Governance Impact:** The Project Owner cannot make an informed `DEC-13 Stage 2` choice based on `IntervalCandidateBenchmarks.json` because the `~65.0x` comparison is invalid and the 63-contour benchmark has not been executed.
- **Non-Binding Disposition Options (Owner Decision Required):**
  1. Require a symmetric benchmark harness executing the exact same complete-interval verification workload across all 3 candidates (and across canonical garment contours) inside a bounded `PKG-M00-03` remediation before `DEC-13 Stage 2`.
  2. Formally amend `ADR-009 §7.2` if the Owner wishes to defer the 63-contour production benchmark until `M02f` while qualifying only oracle primitives in `M00`.

### `CONFLICT-D2` — `M06` Cloth Solver Analytical Benchmarks `B1`–`B4` Tolerance Authority
- **Conflicting Sources:**
  - `plan/00_BLUEPRINT_REVISION_2.md` (line 69): `"cloth drape solver qualified against Benchmarks B1–B4 (<= 5% error)"`.
  - `plan/decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md` (line 25) & `plan/workloads/M06_SIMULATION_FIT_AND_OPTIMIZATION.md` (lines 63–67): Specify distinct exact thresholds — `B1` Uniaxial Membrane Patch `<= 0.1%`, `B2` Cantilever Elastica `<= 1.5%`, `B3` Catenary Suspension `<= 0.5 mm`, `B4` Mesh Refinement Convergence `< 2.0%`.
- **Governance Impact:** Ambiguous pass/fail criteria for `AC-08` and `DEC-02 Stage 1` solver selection.
- **Non-Binding Disposition Options:** Confirm whether the stricter `ADR-005`/`M06` per-benchmark tolerances govern `AC-08` and update `plan/00:69` in the next blueprint documentation revision.

### `CONFLICT-D3` — Skirt Grading Authority (`M02d` / `M02g` vs `P1-3`)
- **Conflicting Sources:**
  - `docs/evidence/P1_2_CONSOLIDATION_AND_INTEGRITY_EVIDENCE.md` (line 163): Refers to `P1-3` (TypeScript skirt grading in `src/engine/`) as the next milestone.
  - `plan/decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md`, `plan/04_MIGRATION_AND_PARITY_POLICY.md`, `plan/workloads/M02_DETERMINISTIC_FASHION_ENGINE.md`: Prohibit adding new authoritative pattern-engineering features to browser TypeScript (`C0-Legacy`); assign multi-size pattern blocks (`M02d`) and grading (`M02g`) exclusively to the Python backend post-`Gate Auth-2`.
- **Governance Impact:** Risk of unauthorized `C0-Legacy` feature expansion violating `ADR-001`.
- **Non-Binding Disposition Options:** Maintain `P1-3` as `NOT STARTED` and `NOT AUTHORIZED` unless the Owner explicitly issues an exception; implement multi-size skirt grading strictly in Python `M02d`/`M02g` after `M00` acceptance and `Gate Auth-2`.

### `CONFLICT-D4` — Authoritative Python Service Directory Name (`services/fashion-engine/` vs `services/geometry-engine/`)
- **Conflicting Sources:**
  - `ADR-001`, `ADR-002`, `ADR-009` (lines 99, 128, 131, 150), `M01`, `M02`, `M03`, `M05`, `M06`: Specify **`services/fashion-engine/`** as the single Python computational backend directory.
  - `plan/00_BLUEPRINT_REVISION_2.md` (line 53), `plan/15`, and actual M00 implementation: Created **`services/geometry-engine/`** (`services/fashion-engine/` does not exist).
- **Governance Impact:** Creates immediate path conflict for `M01`–`M06` scaffolding, CI import-boundary scripts, and Merkle provenance metadata (`ADR-002:22` references `services/fashion-engine`).
- **Non-Binding Disposition Options:** Owner designates either (a) `services/fashion-engine/` as the unified backend (migrating or scoping `services/geometry-engine/` as an internal sub-package/oracle), or (b) `services/geometry-engine/` as the canonical directory and updates `ADR-001`/`M01`–`M06` accordingly.

### `CONFLICT-D5` — Missing `M00.3` Monorepo Root Configurations (`pnpm-workspace.yaml`, `turbo.json`)
- **Conflicting Sources:**
  - `plan/workloads/M00_MIGRATION_PREPARATION.md` (`M00.3`) & `DEC-01`: Require a monorepo workspace skeleton with root `pnpm-workspace.yaml` and `turbo.json`.
  - Actual workspace `/app/applet`: Neither `pnpm-workspace.yaml` nor `turbo.json` exists (`os.path.exists == False`).
  - `ReproducibleEnvironmentManifest.json` & `M00_GATE_AUTH2_READINESS_REPORT.md` (line 17): Claim `M00.3` `PASS` / `VERIFIED`.
- **Governance Impact:** `M00.3` exit criterion is inaccurately reported as complete.
- **Non-Binding Disposition Options:** Either add the missing root workspace configs in `PKG-M00-03` before M00 acceptance, or formally amend `M00.3` to defer monorepo build orchestration (`pnpm`/`turbo`) to `M01`.

### `CONFLICT-D6` — Stale Root M00 Summaries, Stale TS Test Counts & Prototype Evidence Gate Labels
- **Conflicting Sources:**
  - `M00_GATE_AUTH2_READINESS_REPORT.md` (pre-reconciliation) & `M00_GATE_AUTH2_READINESS_MATRIX.md`: Cite obsolete Checkpoint 15 SHA-256 digests, `124/124` and `62/62` qualification counts, and `1.92 ms` / `0.02 ms` / `0.14 ms` timings rather than Checkpoint 16 (`PKG-M00-02`) artifacts.
  - `plan/03_REPOSITORY_BASELINE_AND_AUDIT.md` & `M00_REMEDIATION_CHANGELOG.md`: Cite historical TS prototype counts (`795` / `688` tests) rather than the independently verified P1-2 Final Closeout baseline (`892/892` across `184` suites).
  - `docs/evidence/LIVE_PRODUCT_AUDIT_AND_P0_REMEDIATION_EVIDENCE.md` (lines 6–9): Uses non-canonical gate identifiers inconsistent with `plan/10_RELEASE_AND_GOVERNANCE_POLICY.md` (`Gate Auth-1`..`Gate Auth-4`).
- **Governance Impact:** Causes conflicting status figures when briefing the Project Owner.
- **Non-Binding Disposition Options:** Root `M00_GATE_AUTH2_READINESS_REPORT.md` has been reconciled (preserving Checkpoint 15 verbatim) under this audit's limited documentation authority; historical read-only files (`plan/03`, `M00_GATE_AUTH2_READINESS_MATRIX.md`, `M00_REMEDIATION_CHANGELOG.md`, P0/P1-2 evidence) remain intentionally preserved as historical snapshots and should be superseded only via authorized closeout/plan updates.

### `CONFLICT-D7` — `ADR-009 §2.5 & §5.3` Schema Specification vs Implemented `contracts.py` / `canonical_contracts.schema.json`
- **Conflicting Sources:**
  - `ADR-009 §2.5`: Mandates `NumericalVerificationRecord` fields including `assurance_classification`, `error_components` (`x_float64`, `x_ref`, `observed_discrepancy_e_obs`, `reference_enclosure_b_ref`, `implementation_to_exact_bound_b_cert`), and `reproducibility_manifest`.
  - `ADR-009 §5.3` (lines 70–91): Mandates `OffsetValidationRecord` fields including `detected_failure_categories`, `coordinate_convention`, `offset_sign_s`, `offset_distance_d_cm`, `max_subdivision_depth_reached`, `primary_span_coverage_ratio`, `local_self_intersection_status`, `global_contour_self_intersection_status`, `unresolved_intervals`, `escalation_trace`.
  - `services/geometry-engine/patroner_geometry/contracts.py` (lines 68–81, 168–278) & `packages/contracts/schemas/canonical_contracts.schema.json` (lines 88–104, 187–381): Implement divergent flat schemas omitting those fields, include 4 duplicate alias strings in `OffsetFailureCategory`, and omit the fail-closed `INCONCLUSIVE -> isProductionReady == False` validator on `OffsetClassificationReport`.
- **Governance Impact:** Downstream `M01`/`M02`/`M05` consumers cannot rely on `M00.1` contracts matching `ADR-009`.
- **Non-Binding Disposition Options:** Align `contracts.py` + `canonical_contracts.schema.json` strictly with `ADR-009 §2.5 & §5.3` (removing duplicate enum aliases and adding the `OffsetClassificationReport` validator) in `PKG-M00-03`, or formally amend `ADR-009` if the flatter schema is preferred.

### `CONFLICT-D8` — `ADR-003 §2.2(4)` vs `ADR-009 §4.4` Six-Category Offset Taxonomy Naming
- **Conflicting Sources:**
  - `plan/decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md` (lines 67–74): Defines 6 offset categories using legacy labels (`Category 1: CERTIFIED_REGULAR`, `Category 2a: ACTUAL_ZERO_SPEED_CUSP`, `Category 2b: ACTUAL_CURVATURE_CUSP`, `Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY`, `Category 3: TANGENTIAL_CUSP_DEGENERACY`, `Category 4: SELF_INTERSECTING_NON_LOCAL`).
  - `plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md` (`§4.4`, lines 1–28): Separates the 5-way base-curve singularity taxonomy from the 6 offset failure categories (`REGULARITY_MARGIN_VIOLATION`, `ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`, `TANGENT_REVERSAL`, `LOCAL_SELF_INTERSECTION`, `GLOBAL_SELF_INTERSECTION`, `INCONCLUSIVE`).
- **Governance Impact:** Internal ADR inconsistency on canonical enum names (also echoed in `plan/00:40–41`).
- **Non-Binding Disposition Options:** Declare `ADR-009 §4.4` as the sole authoritative taxonomy and update `ADR-003 §2.2(4)` and `plan/00:40–41` in the next authorized blueprint revision.

### `CONFLICT-D9` — Missing Oracle-Independence AST Linter (`ADR-009 §7.1 & §8`)
- **Conflicting Sources:**
  - `ADR-009` (lines 131, 165): Mandates `scripts/check_oracle_independence.py` to enforce source-code independence (`AC-04`) between the `M00.4` oracle and `M02` production engine.
  - Workspace `/app/applet`: `scripts/check_oracle_independence.py` does not exist.
- **Governance Impact:** No automated CI guardrail prevents `M02` from importing `M00.4` oracle code once `M02` begins.
- **Non-Binding Disposition Options:** Implement `scripts/check_oracle_independence.py` and wire it into `.github/workflows/m00-verification.yml` in `PKG-M00-03` before `Gate Auth-2`.

### `CONFLICT-D10` — Pre-Gate Verification Framing vs Formal Acceptance & Unclosed Defects
- **Conflicting Sources:**
  - `M00_GATE_AUTH2_READINESS_REPORT.md` (original line 7), `M00_REPRODUCIBILITY_REPORT.json`, and `ReproducibleEnvironmentManifest.json` (`pkgM0002AllVerified: true`, hardcoded `"VERIFIED"` flags): Frame M00 as fully verified and ready for `Gate Auth-2` approval.
  - Independent Adversarial Audit (`docs/evidence/M00_INDEPENDENT_ADVERSARIAL_AUDIT_REPORT.md`): Reproduces 16 technical, mathematical, benchmark, schema, and provenance defects demonstrating M00 is **`Technically defective`** and **not ready for formal acceptance**.
- **Governance Impact:** Submitting `PKG-M00-02` for `Gate Auth-2` sign-off in its current state would risk approving `DEC-13 Stage 2` on an invalid benchmark and adopting an oracle with reproduced soundness bugs.
- **Non-Binding Disposition Options:** Keep `M00: NOT ACCEPTED` and `Gate Auth-2: CLOSED`; authorize a tightly scoped `PKG-M00-03` remediation + independent clean Python 3.12 CI reproduction before any formal M00 acceptance submission.
