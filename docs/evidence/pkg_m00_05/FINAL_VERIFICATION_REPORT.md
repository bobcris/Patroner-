# PATRONER — `PKG-M00-05` FINAL VERIFICATION & ACCEPTANCE READINESS REPORT

**Package:** `PKG-M00-05` — Checkpoint K Remediation (`K-01` through `K-07`)  
**Workspace:** `/app/applet` (existing authoritative workspace; `.git` absent — Git not initialized)  
**Governing Baseline:** `R2.1.2-R1` (`R2.2` Documentation Overlay), `ADR-001`, `ADR-003`, `ADR-009`  
**Execution Environment:** Locked `Python 3.12.16` via `uv 0.13.9` (`services/geometry-engine/uv.lock`), `PYTHONHASHSEED=0`, `Linux-4.19.0-gvisor-x86_64-with-glibc2.36` (`8` CPUs)  
**Supersedes:** `docs/evidence/pkg_m00_04/FINAL_VERIFICATION_REPORT.md` (preserved verbatim with dated supersession notice)

---

## 1. Immutable Governance Baseline (Preserved Unchanged)

| Governance Control | Preserved State |
| :--- | :--- |
| `M00` Formal Acceptance | **`NOT ACCEPTED`** |
| `Gate Auth-2` / `Gate Auth-3` / `Gate Auth-4` | **`CLOSED`** |
| `DEC-13 Stage 2` | **`CLOSED`** |
| `AC-09` Physical Validation | **`PENDING`** |
| `M01` / `M02` / `M03` Production Implementation | **`NOT STARTED`** |
| `P1-3` Legacy TypeScript Skirt Grading | **`NOT AUTHORIZED`** |
| `isProductionReady` | **`false`** |
| `externalCadInteroperabilityVerified` | **`false`** |
| Trouser Block (`src/engine/drafting/trouser-block.ts`) | **`BLOCKED_MISSING_TROUSER_BLOCK`** |
| `CONFLICT-D1` through `CONFLICT-D10` (`I-08`) | **`OPEN / PENDING OWNER ADJUDICATION`** |
| `plan/` and `plan/decisions/ADR-*` | **UNMODIFIED** |

---

## 2. Executive Verdict & Honest Acceptance Recommendation

- **Technical Closure (`K-01`–`K-07` & `L-01`–`L-03`):** **ALL 7 CHECKPOINT K TECHNICAL FINDINGS AND ALL 3 CHECKPOINT L TRACK-A FINDINGS ARE CLOSED AND INDEPENDENTLY VERIFIED.**
  - **118/118 Python pytest tests PASS** (including all 48 `PKG-M00-05` + `L-01`/`L-02`/`L-03` adversarial tests, 15 Checkpoint J performance/equivalence tests, and 55 prior M00/PKG-M00-03/PKG-M00-04 tests).
  - **897+ TypeScript tests PASS** (`0` failed, `0` skipped — including 5 new `L-03` runtime cross-field contract invariant tests) and `npx tsc --noEmit` exits `0`.
  - **0 oracle-independence violations** across Python Tier-2/Tier-1/contracts and all `59` TypeScript `src/engine/` files under hardened `L-01` AST rules.
  - **11/11 deterministic artifacts bit-exact** across two independent OS subprocess replays with **zero workspace writes** under `--single-run --output-dir`.
  - **44/44 audited manifest files verified byte-for-byte** (`0` duplicates, `0` self-hashes, `0` missing, `0` mismatches, `0` volatile leaks).
  - **All 3 interval candidates (`mpmath.iv`, `python-flint`, `DecimalInterval`) beat the `5.0 ms` P95 target** on the genuine 63-contour garment corpus under the hardened single outer end-to-end `perf_counter` timer with full `K-01` local self-intersection certification enabled.
- **Formal M00 Acceptance Recommendation:** **`ACCEPTANCE NOT RECOMMENDED`** *solely because governance finding `I-08` (`CONFLICT-D1` through `CONFLICT-D10`) remains `OPEN / PENDING OWNER ADJUDICATION` (see `docs/evidence/pkg_m00_04/I08_GOVERNANCE_ADJUDICATION_DOSSIER.md`).* No engineering or mathematical defects from Checkpoints I, J, K, or L Track A remain open.

---

## 3. Finding-by-Finding Closure Summary (`K-01` – `K-07` & `L-01` – `L-03`)

| Finding | Severity | Remediation Summary | Verification Proof | Closure Status |
| :--- | :--- | :--- | :--- | :--- |
| **`K-01`** | **HIGH** | Unconditional intra-segment local self-intersection certification (exact directional MVT + exact $\mathbb{Q}(\sqrt{q_0},\sqrt{q_1})$ endpoint coincidence + bounded 2D Krawczyk subdivision) wired into `c1_cert_oracle.py` and all 3 `qualification.py` candidates | `test_k01_*` (3/3 PASS); 100% 4-engine agreement on pinched crossing, non-crossing, exact closed-endpoint loop, and fail-closed unresolved budget | **CLOSED** |
| **`K-02`** | **HIGH** | Exact $\mathbb{Q}[t]$ Sturm/Bernstein algebraic decision (`certify_regular_offset_exact_rational`) at 336-bit ceiling + bounded iterative work stacks (`max_nodes_per_tier=1024`) + exact micro-reversal check on isolated cusp roots | `test_k02_*` (6/6 PASS); 20/20 exact verdicts across `K1`–`K5` × 4 engines (`< 5.0 s` each) + fail-closed node-budget `INCONCLUSIVE` | **CLOSED** |
| **`K-03`** | **MEDIUM** | Single outer end-to-end `time.perf_counter()` timer (`outerEndToEndMs`) wrapping full per-contour execution, separate `phaseSumMs` & `unaccountedWrapperOverheadMs`, complete `environmentMetadata`, jitter-robust test assertions | `test_k03_*` (PASS) + `test_checkpoint_j_*` (15/15 PASS); outer-timer monotonicity verified across all 63 contours × 3 candidates | **CLOSED** |
| **`K-04`** | **HIGH** | Exact-module Tier-2 allowlist (removed bare `patroner_geometry`), constant-folding string evaluation, and dynamic/reflective import blocking (`__builtins__`, `vars`, `globals`, `getattr`, `sys.modules`, `__subclasses__`, `importlib`) | `test_k04_*` (14/14 PASS); 12/12 Checkpoint K bypasses blocked, 0 false positives, live repo audit exit 0 (`0` violations) | **CLOSED** |
| **`K-05`** | **MEDIUM** | Strict single-run output isolation (`--out` added to `m00_capture_c0_legacy.ts`, removed import-time workspace `mkdir`, local `tsx` resolution) | `test_k05_*` (PASS); SHA-256 + `st_mtime_ns` workspace snapshot 100% invariant while emitting all 11 artifacts to `<tmp>` | **CLOSED** |
| **`K-06`** | **HIGH** | 16-case dual Pydantic v2 + JSON Schema Draft 2020-12 discrete/structural certification-state parity (`CONTRA-01`..`CONTRA-16`) plus `OffsetClassificationReport` discrete enforcement (cross-field numeric boundary documented & enforced in `L-03`) | `test_k06_*` (2/2 PASS); `verify_schemas_lock` `allPassed=true` (`16/16` dual-rejected) + `6/6` report contradictions dual-rejected | **CLOSED** |
| **`K-07`** | **LOW** | Dated supersession notice on `pkg_m00_04/FINAL_VERIFICATION_REPORT.md`, authoritative `M02a`–`M02h` reconciliation in `TRACK_B_ORIGINAL_ROADMAP_READINESS.md` Section 5, and `docs/evidence/pkg_m00_05/` pack included in manifest | `test_k07_*` (PASS) + `verify_m00_manifest.py` exit 0 | **CLOSED** |
| **`L-01`** | **MEDIUM** | Hardened `scripts/check_oracle_independence.py` against `pydoc.locate`/`safeimport`/`importfile`, `inspect.getmodule`/`currentframe`/`stack`/frame attrs, `sys.meta_path`/`path_hooks`/`path_importer_cache`, `types.FunctionType`/`CodeType` (direct, aliased, folded/dynamic) while preserving benign stdlib (`importlib.metadata`, `re.compile`, `Path.resolve`, `inspect.signature`, `sys.version_info`, `types.SimpleNamespace`, bare `types.ModuleType`) | `test_l01_*` (18/18 PASS) + `test_k04_allows_exact_allowlist_and_benign_stdlib_patterns` (PASS) + live repo audit exit 0 (`0` violations) | **CLOSED** |
| **`L-02`** | **LOW** | Reconciled §4 verbatim to exact on-disk `IntervalCandidateBenchmarks.json` & `RuntimeBenchmarkObservation.json` SHA-256 snapshots and explicitly separated deterministic artifacts from host-dependent non-deterministic runtime observations | `test_l02_benchmark_report_snapshot_and_separation_documented` (PASS) + `verify_m00_manifest.py` exit 0 | **CLOSED** |
| **`L-03`** | **LOW** | Explicitly documented the 4 cross-field numeric inequalities beyond JSON Schema Draft 2020-12 native expressiveness (`f_lo >= eps`, `q_hi >= q_lo`, `f_hi >= f_lo`, `gridErrorCm <= certifiedIntervalErrorCm`) in `contracts.py`, `canonical_contracts.schema.json`, and `SchemasLockReport.json`, and added TypeScript runtime validation in `packages/contracts/src/cross-field-validators.ts` | `test_l03_cross_field_numeric_inequalities_enforced_and_boundary_documented` (PASS) + `src/contracts/__tests__/cross-field-validators.test.ts` (5/5 PASS) | **CLOSED** |

---

## 4. Measured Runtime Benchmarks (`ADR-009 §7.2` — Non-Deterministic Runtime Observation)

> **Reproducible Artifacts vs. Non-Deterministic Runtime Observations (`L-02`):**
> All `11` core M00 verification artifacts and `44` manifest-audited files are **strictly deterministic** (bit-exact across isolated OS subprocesses under `PYTHONHASHSEED=0`). By contrast, wall-clock benchmark timings (`artifacts/m00/IntervalCandidateBenchmarks.json` and `artifacts/m00/RuntimeBenchmarkObservation.json`) are **non-deterministic runtime observations** excluded from deterministic SHA-256 manifest gating because latency varies across host runs. The exact table below is bound to the specific on-disk snapshot identified by SHA-256 below so no ambiguity can arise across regenerations.
>
> - **Referenced Artifact:** `artifacts/m00/IntervalCandidateBenchmarks.json`
> - **Snapshot SHA-256:** `2b116584cda29c6bf230da90693d659562f629649cd24d3d2eca3d1ef0525382` (`141,912` bytes)
> - **Companion Observation:** `artifacts/m00/RuntimeBenchmarkObservation.json` (`SHA-256: 7465f6d722c4ed33d17439ec050409febc90ae7885bab99cb0bb3fe2378b8be5`, `2,269` bytes)
> - **Environment:** `Linux-4.19.0-gvisor-x86_64-with-glibc2.36`, `8` CPUs, `CPython 3.12.16`, `PYTHONHASHSEED=0`, `1` warmup run + `5` steady-state measured repetitions.
> - **ADR-009 §7.2 Threshold Policy (Unchanged):** `<= 50.0 ms` is the M00.4 qualification budget; `< 5.0 ms` per contour is the `DEC-13 Stage 2` (`Gate Auth-2`) production adoption / optional `PyO3` acceleration trigger.

### 4.1 Real 63 Canonical Garment Contours (`CanonicalGarmentContours63.json`, Single Outer `perf_counter` Timer)
- **Corpus:** `63` contours (`495` segments: `129` cubic Béziers, `366` lines) across sizes `XS`–`XXL` (`18` Bodice Front, `12` Bodice Back, `18` Sleeve, `9` Skirt Front, `6` Skirt Back); Trouser block honestly disclosed as `BLOCKED_MISSING_TROUSER_BLOCK`.
- **Method:** `SINGLE_OUTER_PERF_COUNTER_PER_CONTOUR_PER_CANDIDATE` enclosing preprocessing, full ADR-009 §5.1/§5.2 Bernstein + `K-01` Step 2.5 local self-intersection certification, and JSON serialization.

| Candidate | Steady P50 (ms) | **Steady P95 (ms)** | Steady Max (ms) | Phase-Sum P95 (ms) | Mean Wrapper Overhead (ms) | Pooled-315 P95 (ms) | Cold-Start P95 (ms) | `<= 5.0 ms` Target |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| `mpmathIvFraction` (Primary) | `2.1007` | **`2.3573`** | `2.4936` | `2.3069` | `0.0422` | `3.0601` | `2.9366` | **PASS** |
| `pythonFlintArbFmpq` (Secondary) | `0.2168` | **`0.2448`** | `0.3042` | `0.2150` | `0.0306` | `0.3121` | `0.3713` | **PASS** |
| `decimalIntervalFraction` (Tertiary) | `1.3323` | **`1.5086`** | `1.5584` | `1.4656` | `0.0331` | `1.6796` | `1.8130` | **PASS** |

### 4.2 Full 200,000-Check Qualification Population & Degree-12 Horner Microbenchmark
- **200,000-Check Qualification Population (600,000 total checks, 100% PASS):** `mpmath.iv` = `4613.63 ms`, `python-flint` = `2213.88 ms`, `DecimalInterval` = `2700.47 ms`, total suite = `9547.60 ms`.
- **Single-Curve Degree-12 Horner Microbenchmark (20 iterations):** shared rational preprocessing P95 = `0.3145 ms` (median `0.2767 ms`); `mpmath.iv` P95 = `0.4047 ms` (median `0.1796 ms`); `python-flint` P95 = `0.0231 ms` (median `0.0090 ms`); `DecimalInterval` P95 = `0.1082 ms` (median `0.0441 ms`) — all `<= 5.0 ms` PASS.

---

## 5. Independent Verification Command Ledger

1. `uv lock --directory services/geometry-engine --check --python 3.12.16` — **PASS (exit 0; 21 locked packages)**
2. `PYTHONHASHSEED=0 /tmp/patroner-m00-venv/bin/python scripts/check_oracle_independence.py` — **PASS (exit 0; 0 violations across Python & 59 TS `src/engine/` files)**
3. `PYTHONHASHSEED=0 /tmp/patroner-m00-venv/bin/pytest -v services/geometry-engine/tests` — **118/118 PASS (`0` failed, `0` skipped)**
4. `PYTHONHASHSEED=0 /tmp/patroner-m00-venv/bin/python scripts/m00_execute_all.py` (followed by `--preserve-benchmarks` manifest lock refresh after §4 snapshot sync) — **PASS (exit 0; 44 audited manifest files)**
5. `PYTHONHASHSEED=0 /tmp/patroner-m00-venv/bin/python scripts/verify_m00_reproducibility.py` — **PASS (exit 0; 11/11 deterministic artifacts bit-exact across 2 independent OS subprocesses with zero workspace writes)**
6. `PYTHONHASHSEED=0 /tmp/patroner-m00-venv/bin/python scripts/verify_m00_manifest.py` — **PASS (exit 0; 44/44 disk SHA-256 & byte-size verified, 0 duplicates, 0 self-hashes, 0 volatile leaks)**
7. `npx tsc --noEmit` — **PASS (exit 0)**
8. `npm test` — **PASS (`0` failed, `0` skipped; includes `src/contracts/__tests__/cross-field-validators.test.ts`)**
9. `npm run build` (`compile_applet`) & `npm run lint` (`lint_applet`) — **PASS**
