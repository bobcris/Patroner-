> **SUPERSESSION NOTICE (`2026-11-22` — `PKG-M00-05` / Finding `K-07`)**
>
> This historical `PKG-M00-04` report is preserved verbatim below as the pre-Checkpoint-J / pre-Checkpoint-K record (in which `I-04` reported 63-contour P95 latencies of `49.25 ms` for `mpmath.iv`, `7.73 ms` for `python-flint`, and `14.59 ms` for `DecimalInterval`).
>
> It has been **SUPERSEDED** by:
> 1. **Checkpoint J (`I-04` Bernstein Screening Remediation):** Implemented certified Bernstein convex-hull and de Casteljau subdivision screening across all three interval candidates while preserving exact differential equivalence on all 63 canonical garment contours and all adversarial curves.
> 2. **Checkpoint K (`PKG-M00-05` Remediation of `K-01` through `K-07`):** Closed all seven Checkpoint K technical findings (local self-intersection certification soundness, exact-boundary completeness & termination, outer-timer benchmark integrity, strict AST/dynamic oracle-independence enforcement, single-run output isolation, 16-state Pydantic/JSON Schema certification parity, and evidence/report accuracy).
>
> **Authoritative Current Report:** See `docs/evidence/pkg_m00_05/FINAL_VERIFICATION_REPORT.md` and `docs/evidence/pkg_m00_05/K01_THROUGH_K07_REMEDIATION_DOSSIER.md`.  
> **Governance Baseline Preserved Unchanged:** `M00: NOT ACCEPTED`, `Gate Auth-2/3/4: CLOSED`, `DEC-13 Stage 2: CLOSED`, `AC-09: PENDING`, `isProductionReady: false`, `externalCadInteroperabilityVerified: false`, `BLOCKED_MISSING_TROUSER_BLOCK`, `CONFLICT-D1`–`CONFLICT-D10: OPEN`.

---

# PATRONER — `PKG-M00-04` FINAL VERIFICATION REPORT

**Package:** `PKG-M00-04` — Final M00 Closure Remediation (Checkpoint I Findings `I-01` through `I-08`)  
**Workspace:** `/app/applet`  
**Governing Baseline:** `R2.1.2-R1` (`R2.2` Documentation Overlay), `ADR-001`, `ADR-003`, `ADR-009`  
**Execution Environment:** Locked `Python 3.12.16` via `uv 0.13.9` (`services/geometry-engine/.venv/bin/python`), `PYTHONHASHSEED=0`, `Linux x86_64`  
**Governance Status (Preserved Unchanged):**
- `M00`: **`NOT_ACCEPTED`**
- `Gate Auth-2`: **`CLOSED`**
- `Gate Auth-3`: **`CLOSED`**
- `Gate Auth-4`: **`CLOSED`**
- `DEC-13 Stage 2`: **`CLOSED`**
- `AC-09 Physical Validation`: **`PENDING`**
- `externalCadInteroperabilityVerified`: **`false`**
- `M01` / `M02` / `M03` / `P1-3`: **`NOT STARTED`**

---

## 1. Executive Verdict & Honest Technical Recommendation

**Technical Recommendation:** **`ACCEPTANCE NOT RECOMMENDED`** *(for immediate unconditional M00 acceptance; Engineering Remediation `I-01`, `I-02`, `I-03`, `I-05`, `I-06`, `I-07` are CLOSED, `I-04` honest 63-contour measurement surfaced a real latency exceedance, and `I-08` requires Project Owner adjudication).*

### Objective Grounds
1. **Technical Closure Achieved (`I-01`, `I-02`, `I-03`, `I-05`, `I-06`, `I-07`):**
   - All 6 engineering integrity/correctness findings are fully implemented, unit-tested, and verified with **55/55 Python pytest tests**, **892/892 TypeScript regression tests**, **0 AST/dynamic-bypass/TS-boundary oracle-independence violations**, **11/11 bit-exact two-subprocess OS-isolated replay**, and **100% manifest disk verification** (`0` duplicates, `0` self-hashes, `0` missing, `0` mismatches, `0` volatile leaks).
2. **Objective Technical Blocker Surfaced Honestly Under `I-04` (`ADR-009 §7.2` 63-Contour Latency):**
   - While all 3 candidates (`mpmath.iv`, `python-flint`, `DecimalInterval`) pass **100% of 600,000 exact-Fraction outward-rounding checks** (200,000 per candidate across 10,000 pairs × 4 ops + 10,000 sqrts × 4 precision tiers `{53, 113, 170, 336}` bits), `>=1,000` Bernstein checks across degrees `{5, 9, 12}`, domain traps, candidate-library-driven unsplit root isolation (Wilkinson `1e-7` & `1e-9` + grazing double roots), AND pass the single-curve degree-12 Horner microbenchmark (`0.1886 ms`, `0.0138 ms`, `0.0501 ms` P95 `<= 5.0 ms`),
   - On the genuine **63-contour real garment corpus** (`artifacts/m00/CanonicalGarmentContours63.json`, 495 segments / 129 cubic Béziers across sizes `XS`–`XXL`), **NONE of the 3 candidates currently achieves end-to-end contour P95 `<= 5.0 ms`**:
     - `mpmath.iv` (Primary): median **`30.7884 ms`**, P95 **`49.2475 ms`**, max **`54.6284 ms`** (**FAILS** `<= 5.0 ms` target)
     - `python-flint` (`arb` C-extension Secondary Reserve): median **`5.8672 ms`**, P95 **`7.7284 ms`**, max **`8.1793 ms`** (**FAILS** `<= 5.0 ms` target; **6.4× faster** than `mpmath.iv`)
     - `DecimalInterval` (Tertiary): median **`9.9360 ms`**, P95 **`14.5944 ms`**, max **`16.5725 ms`** (**FAILS** `<= 5.0 ms` target)
   - Furthermore, the Trouser block (`src/engine/drafting/trouser-block.ts`) does not exist in the repository (`BLOCKED_MISSING_TROUSER_BLOCK`); zero synthetic trouser contours were fabricated.
3. **Governance Blockers Pending Project Owner Decision (`I-08`):**
   - Ten documented governance/roadmap conflicts (`CONFLICT-D1`–`CONFLICT-D10`) remain open and are compiled without unilateral resolution in `docs/evidence/pkg_m00_04/I08_GOVERNANCE_ADJUDICATION_DOSSIER.md`.

---

## 2. Finding-by-Finding Closure Matrix (`I-01` – `I-08`)

| Finding | Checkpoint I Defect Summary | Implemented Remediation (`PKG-M00-04`) | Verification Proof | Closure Status |
| :--- | :--- | :--- | :--- | :--- |
| **`I-01`** | Fake in-process replay, misleading `PYTHONHASHSEED` default, substring CI audit, static hardcoded source-input list | True 2-subprocess OS-isolated replay (`verify_m00_reproducibility.py` + `m00_execute_all.py --single-run --output-dir`), honest `"UNSET"` reporting + strict fail-closed `PYTHONHASHSEED=="0"`, dynamic `requires-python` parsing, structural YAML CI step parser rejecting comments & `\|\| true`/`continue-on-error`, dynamic `discover_m00_source_inputs()` covering all Python modules, tests, scripts, TS drafting/geometry/export modules, schemas, and ADRs | `test_i01_*` (4/4 PASS); live 2-subprocess replay verified 11/11 deterministic artifacts bit-exact across distinct OS PIDs | **CLOSED (Technical)** |
| **`I-02`** | AST oracle-independence check bypassed by `importlib`, `__import__`, `getattr(builtins, ...)`, `sys.modules`, `exec`/`compile`/`runpy`, relative imports, and omitted TS `src/engine/` ADR-001 audit | Hardened `scripts/check_oracle_independence.py` blocking all static, relative, alias, and dynamic bypass vectors (while allowing benign `importlib.metadata` and `re.compile`) + auditing all 59 non-test TypeScript files under `src/engine/` for ADR-001 boundary compliance | `check_oracle_independence.py` exit 0 (`0` violations across Python Tier-2/Tier-1/contracts + 59 TS files); `test_i02_*` (11/11 PASS) | **CLOSED (Technical)** |
| **`I-03`** | Missing Bernstein convex-hull checks, missing `113 -> 170 -> 336` escalation ladder, adjacent inward corners skipped (`range(i+2, n)`), hand-constructed AG-01..04 & AG-08, missing ADR-009 §6 `#11b` and `#15` | Exact `_fraction_to_mpf`/`_fraction_to_iv`/`_bernstein_restrict_exact` (no decimal `str()` loss), Bernstein convex-hull checks, 3-tier `113 -> 170 -> 336` escalation with clean final-leaf bound aggregation, adjacent-pair loop `range(i+1, n_seg)` with G1-only monotonicity exclusion, genuine `certify_analytic_circle_offset_iv` & `certify_cubic_offset_with_local_self_intersection`, full ADR-009 §6 `#11b` & `#15` (`8` extra cases + `17` AG families, all `7/7` canonical classifications covered) | `test_i03_*` (4/4 PASS), `test_m00_4_*` (all PASS), `test_rem03_*` (all PASS) | **CLOSED (Technical)** |
| **`I-04`** | Qualification conjunction allowed incomplete populations, unsplit root isolation relied on pure `Fraction` Sturm instead of candidate interval libraries, and 63 real canonical garment contours (`ADR-009 §7.2`) were never benchmarked | Fail-closed `evaluate_qualification_conjunction` requiring `>=200,000` checks, 4 exact tiers `{53,113,170,336}`, `>=10,000` pairs/sqrts, `>=1,000` Bernstein checks on `{5,9,12}`, 53/113-bit hex endpoints, and candidate-library-driven bisection with centered mean-value interval enclosure (`P(m) + P'(I)*(I-m)`). Exported 63 real contours (`CanonicalGarmentContours63.json`) via `scripts/m00_export_canonical_63_contours.ts` and benchmarked all 3 candidates with full phase breakdown | `test_i04_*` (2/2 PASS), `test_rem04_*` (2/2 PASS); **HONEST GAP SURFACED:** all 3 candidates exceed `5.0 ms` P95 on 63 full contours (`49.25 ms`, `7.73 ms`, `14.59 ms`) + Trouser block absent (`BLOCKED_MISSING_TROUSER_BLOCK`) | **REMEDIATED & MEASURED — LATENCY EXCEEDS 5 ms P95 (OWNER DISPOSITION REQUIRED)** |
| **`I-05`** | M00.5 omitted full ADR-009 §2.5 fields and had `delta_eval=0`, DXF parser split between synthetic & production with weak error checks, M00.8 used identical bodice shoulder slopes | M00.5 emits complete `NumericalVerificationRecord` with strictly positive 113-bit outward `delta_eval_cm > 0`, 4-row traceability table, and Method C1-Cert depth 12 (`B_ref ~= 1.06e-7 cm << 1e-6 cm`). Unified hardened `parse_dxf_aama_strict` shared by synthetic M00.7 and production verifier (`m00_verify_production_dxf_and_seams.py`, using exact `Fraction` 113-bit line lengths & adaptive C1-Cert cubic lengths). M00.8 updated to distinct anthropometric shoulder drops (`4.6 cm` front vs `3.8 cm` back) | `test_i05_*` (3/3 PASS), `test_m00_5`–`test_m00_8` (all PASS), `test_m00_production_dxf_and_seams` (all PASS) | **CLOSED (Technical)** |
| **`I-06`** | Missing ADR-009 §2.5 / §5.3 contract fields, missing `UNRESOLVED` stationary status, incomplete Pydantic/JSON Schema parity on contradictory states | Added full ADR-009 §2.5 & §5.3 fields (`NumericalErrorComponents`, `ParameterEnclosureRecord`, `OutputPropagationRecord`, `NumericalReproducibilityManifest`, `max_certified_radial_error_cm`, `max_subdivision_depth_reached`, `primary_span_coverage_ratio`, `local/global_self_intersection_status`, `unresolved_intervals`, `escalation_trace`, `detected_failure_categories`), `UNRESOLVED` enum value, and strict enforcement of all 8 contradictory states in BOTH Pydantic v2 (`contracts.py`) and JSON Schema Draft 2020-12 (`canonical_contracts.schema.json`) | `test_i06_all_eight_contradictory_states_rejected_by_pydantic_and_json_schema` (PASS), `test_m00_1` (PASS), `test_rem06` (PASS) | **CLOSED (Technical)** |
| **`I-07`** | Manifest contained duplicates, self-hashing risk, unsegregated historical vs active files, volatile timing/PID leakage, and no independent verifier | Created independent `scripts/verify_m00_manifest.py` verifying every entry against disk SHA-256 & byte size, rejecting duplicates, self-hashes, missing/mismatched files, and volatile timing/PID leaks; segregated `activePrimaryArtifacts`, `compatibilityMirrorFiles`, `configAndSchemaFiles`, `historicalPreservedReports`, and `evidenceAndPrepDocumentation`; isolated wall-clock timings & PIDs strictly into `IntervalCandidateBenchmarks.json` and `RuntimeBenchmarkObservation.json` | `verify_m00_manifest.py` exit 0 (`0` duplicates, `0` self-hashes, `0` missing, `0` mismatches, `0` volatile leaks); `test_i07_*` (PASS) | **CLOSED (Technical)** |
| **`I-08`** | Unresolved Owner governance/roadmap conflicts (`CONFLICT-D1`–`CONFLICT-D10`) and stale claims in `TRACK_B_ORIGINAL_ROADMAP_READINESS.md` | Compiled strictly non-decisional Owner Adjudication Dossier (`docs/evidence/pkg_m00_04/I08_GOVERNANCE_ADJUDICATION_DOSSIER.md`) preserving `CONFLICT-D1`–`CONFLICT-D10` verbatim with concrete Owner decision options; appended dated Section 4 errata to `docs/prep/TRACK_B_ORIGINAL_ROADMAP_READINESS.md` preserving Sections 1–3 verbatim | Dossier & errata present, hashed in manifest; zero governance gates or `plan/` files altered | **DOSSIER READY — PENDING OWNER ADJUDICATION** |

---

## 3. Benchmark Measurements (`ADR-009 §7.2` — Isolated Non-Deterministic Observation)

Measured on `Linux-4.19.0-gvisor-x86_64-with-glibc2.36`, `Python 3.12.16`, `PYTHONHASHSEED=0` (recorded in `artifacts/m00/IntervalCandidateBenchmarks.json` and `artifacts/m00/RuntimeBenchmarkObservation.json`, strictly excluded from deterministic SHA-256 manifests):

### 3.1 Full 200,000-Check Qualification Population Runtime (Per Candidate)
- `mpmath.iv` + `Fraction`: **`4651.77 ms`** (`200,000 / 200,000` passed)
- `python-flint` (`arb` + `fmpq`): **`1944.34 ms`** (`200,000 / 200,000` passed)
- `DecimalInterval` + `Fraction`: **`2678.33 ms`** (`200,000 / 200,000` passed)
- Total 600,000-check qualification suite wall-clock: **`9287.79 ms`**

### 3.2 Synthetic Single-Curve Degree-12 Horner Microbenchmark (20 Iterations, Identical Kernel)
- Shared exact rational preprocessing (separated): median `0.2763 ms`, P95 `0.3273 ms`, max `0.3864 ms`
- `mpmath.iv` + `Fraction`: median `0.1684 ms`, P95 **`0.1886 ms`** (`<= 5.0 ms` PASS)
- `python-flint` (`arb` + `fmpq`): median `0.0091 ms`, P95 **`0.0138 ms`** (`<= 5.0 ms` PASS)
- `DecimalInterval` + `Fraction`: median `0.0427 ms`, P95 **`0.0501 ms`** (`<= 5.0 ms` PASS)

### 3.3 Real 63 Canonical Garment Contours End-to-End Benchmark (`CanonicalGarmentContours63.json`)
- **Corpus Composition:** `63` contours (`495` total segments: `129` cubic Béziers, `366` line segments) across `6` standard sizes (`XS`–`XXL`): `18` Bodice Front, `12` Bodice Back, `18` Sleeve, `9` Skirt Front, `6` Skirt Back.
- **Missing Block Disclosure:** `src/engine/drafting/trouser-block.ts` -> **`BLOCKED_MISSING_TROUSER_BLOCK`** (zero synthetic trouser contours fabricated).
- **Corpus Internal SHA-256:** `ab2d48c89b7bfb69cf4b5ffd289e5e720b48149b8c16371d6db285c8d6f75d2f`
- **Corpus File SHA-256:** `c349969702d4b8a3072e2b821e35742a47982489abab06ae33ef83e26ff5ef04`

| Candidate | Median (ms) | **P95 (ms)** | Max (ms) | `<= 5.0 ms` Target | Mean Preproc (ms) | Mean Interval Arith (ms) | Mean Root Isolation (ms) | Mean Cert + Serial (ms) |
| :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: |
| `mpmathIvFraction` (Primary) | `30.7884` | **`49.2475`** | `54.6284` | **FAIL (`> 5.0 ms`)** | `0.9831` | `5.9739` | `24.1145` | `0.0268` |
| `pythonFlintArbFmpq` (Secondary) | `5.8672` | **`7.7284`** | `8.1793` | **FAIL (`> 5.0 ms`)** | `0.9831` | `1.0028` | `3.2587` | `0.0159` |
| `decimalIntervalFraction` (Tertiary) | `9.9360` | **`14.5944`** | `16.5725` | **FAIL (`> 5.0 ms`)** | `0.9831` | `1.6157` | `6.4957` | `0.0170` |

**Engineering Bottleneck Note:** Root isolation accounts for **78%** of `mpmath.iv` contour latency (`24.11 ms` / `30.79 ms`) and **56%** of `python-flint` contour latency (`3.26 ms` / `5.87 ms`), because the benchmark runs full candidate-library interval bisection on every Bézier segment's degree-12 cusp polynomial `P_cusp(t)` even when a single Bernstein convex-hull / sign-variation pre-screen could certify zero-freeness immediately. `python-flint` is **6.4× faster** than `mpmath.iv` at P95 (`7.73 ms` vs `49.25 ms`).

---

## 4. Verification Command Summary

All verification commands are executed against the locked `Python 3.12.16` environment (`PYTHONHASHSEED=0`) and Node/TypeScript toolchain:
1. `uv lock --directory services/geometry-engine --check --python 3.12.16` — **PASS (exit 0)**
2. `uv sync --directory services/geometry-engine --locked --all-extras --python 3.12.16` — **PASS (exit 0)**
3. `PYTHONHASHSEED=0 services/geometry-engine/.venv/bin/python scripts/check_oracle_independence.py` — **PASS (exit 0; 0 violations across Python & 59 TS `src/engine/` files)**
4. `PYTHONHASHSEED=0 services/geometry-engine/.venv/bin/pytest -v services/geometry-engine/tests` — **55/55 PASS** (`test_m00_verification_suite.py`, `test_m00_production_dxf_and_seams.py`, `test_pkg_m00_03_remediation.py`, `test_pkg_m00_04_closure.py`)
5. `PYTHONHASHSEED=0 services/geometry-engine/.venv/bin/python scripts/m00_execute_all.py` — **PASS (exit 0; 11/11 deterministic artifacts bit-exact across 2 OS subprocesses)**
6. `PYTHONHASHSEED=0 services/geometry-engine/.venv/bin/python scripts/verify_m00_reproducibility.py` — **PASS (exit 0; independent 2-subprocess replay verified)**
7. `PYTHONHASHSEED=0 services/geometry-engine/.venv/bin/python scripts/verify_m00_manifest.py` — **PASS (exit 0; all audited entries verified against disk, 0 duplicates, 0 self-hashes, 0 missing, 0 mismatches, 0 volatile leaks)**
8. `npx tsc --noEmit` — **PASS (exit 0)**
9. `npm test` — **892/892 PASS across 184 suites (0 failed, 0 skipped)**
10. `npm run build` & `npm run lint` — **PASS**

---

## 5. Active vs. Preserved Historical Artifact Inventory

- **Active Deterministic Artifacts (`artifacts/m00/` — 12 files):** `SchemasLockReport.json`, `BaselineDivergenceRegistry.json`, `CanonicalGarmentContours63.json`, `IntervalLibraryQualificationReport.json`, `AdversarialGeometryVerificationReport.json`, `ArcLengthVerificationReport.json`, `TopologyVerificationReport.json`, `DxfRoundTripVerificationReport.json`, `AnthropometricVerificationReport.json`, `ProductionDxfRoundTripReport.json`, `ProductionSeamParityReport.json`, `ReproducibleEnvironmentManifest.json`.
- **Active Root Deliverables (6 files):** `M00_CANONICAL_AG01_AG17_REGISTRY.json`, `M00_ADR009_SECTION6_COVERAGE_REPORT.json`, `M00_CLASSIFICATION_CONFORMANCE_REPORT.json`, `M00_CONTRACT_PARITY_REPORT.json`, `M00_SUBORACLE_VERIFICATION_REPORT.json`, `M00_REPRODUCIBILITY_REPORT.json`.
- **Compatibility Mirrors (2 files, verified SHA-256 identical to primary):** `M00_INTERVAL_QUALIFICATION_REPORT.json`, `ReproducibleEnvironmentManifest.json`.
- **Manifest Index (excluded from self-hashing):** `M00_ARTIFACT_HASH_VERIFICATION.json`.
- **Isolated Non-Deterministic Runtime Observations (excluded from deterministic SHA-256 manifest):** `artifacts/m00/IntervalCandidateBenchmarks.json`, `artifacts/m00/RuntimeBenchmarkObservation.json`.
- **Config & Schema Lock Files (4 files):** `packages/contracts/schemas/canonical_contracts.schema.json`, `services/geometry-engine/pyproject.toml`, `services/geometry-engine/uv.lock`, `.github/workflows/m00-verification.yml`.
- **Evidence & Prep Documentation (6 files including this report):** `docs/evidence/M00_GOVERNANCE_AND_SPEC_CONFLICT_REGISTER.md`, `docs/evidence/M00_INDEPENDENT_ADVERSARIAL_AUDIT_REPORT.md`, `docs/evidence/pkg_m00_04/00_BASELINE_AND_CHANGE_IMPACT_MATRIX.md`, `docs/evidence/pkg_m00_04/I08_GOVERNANCE_ADJUDICATION_DOSSIER.md`, `docs/evidence/pkg_m00_04/FINAL_VERIFICATION_REPORT.md`, `docs/prep/TRACK_B_ORIGINAL_ROADMAP_READINESS.md`.
- **Preserved Historical Reports (10 files, untouched & segregated):** Root `M00_EVIDENCE_RECONCILIATION_REPORT.md`, `M00_GATE_AUTH2_READINESS_MATRIX.md`, `M00_GATE_AUTH2_READINESS_REPORT.md`, `M00_NUMERICAL_QUALIFICATION_AUDIT.md`, `M00_REMEDIATION_CHANGELOG.md`, plus `artifacts/m00/checkpoint_13a_audit/*` (5 files).
