# PATRONER — `PKG-M00-05` BASELINE & TRACEABILITY MATRIX

**Package:** `PKG-M00-05` — Checkpoint K Remediation (`K-01` through `K-07`)  
**Workspace:** `/app/applet` (existing authoritative workspace; `.git` absent — Git not initialized)  
**Authority:** Explicit Project Owner implementation authorization for Checkpoint K findings `K-01`–`K-07`  
**Execution Runtime:** Locked `Python 3.12.16` via `uv 0.13.9` (`services/geometry-engine/uv.lock`), `PYTHONHASHSEED=0`, `Linux x86_64`

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

## 2. Pre-Change SHA-256 Baseline (Checkpoint A — Captured Before Any `PKG-M00-05` Edits)

| File Path | Pre-Change SHA-256 | Target Findings |
| :--- | :--- | :--- |
| `services/geometry-engine/patroner_geometry/c1_cert_oracle.py` | `71e219e40ec40e084d7803808d70a55a1f5740113f855dbfac0a9adf4949ab56` | `K-01`, `K-02` |
| `services/geometry-engine/patroner_geometry/qualification.py` | `63b3b08971c6c2b31744b81009758f1cce6db3e30ac8bd05a8211ae55122e4f9` | `K-01`, `K-02`, `K-03` |
| `services/geometry-engine/patroner_geometry/contracts.py` | `71061bf14351b4b7d247f3fbb389884f0f2ee12170edb62c294267a9e8e754a0` | `K-06` |
| `packages/contracts/schemas/canonical_contracts.schema.json` | `ce150c21338472cb5fb4e597e05cb3fde23c90da3868ed5b010be1a37b2a3af9` | `K-06` |
| `scripts/check_oracle_independence.py` | `b667ce1548258e94205c0b6173eeceecb0ce55cdf01aaeedd1fe16226cd9d454` | `K-04` |
| `scripts/m00_execute_all.py` | `0202676dd01e189ed304cfa2bf925fc1f96625796071fe8ced910b9b5b6c1da1` | `K-05`, `K-07` |
| `scripts/m00_capture_c0_legacy.ts` | `85c0c7e77a85e8e373f80bef58f6eeb1e57cef5a4bc0f52d9e52e816f6785055` | `K-05` |
| `scripts/m00_export_canonical_63_contours.ts` | `3effd2d8f9aed24fdad41bb911c17eb2ec1adc4b9c7b47c1eec940558b4516cc` | `K-05` (verified `--out`) |
| `scripts/verify_m00_manifest.py` | `592972523c1fca291078f0a5f40803db0aa969c45158e327f8f81e34a6a36828` | Verification |
| `scripts/verify_m00_reproducibility.py` | `e6e692738a89a28acf7b45074c2216b38fd006f795b97ea4ed1dbee3c116b0bf` | Verification |
| `docs/evidence/pkg_m00_04/FINAL_VERIFICATION_REPORT.md` | `d36908a775c3c1d5c9a142b47bbe275bf92afae5f38f6393644d976bed7be404` | `K-07` |
| `docs/prep/TRACK_B_ORIGINAL_ROADMAP_READINESS.md` | `51ef4dce09fdd447045949466248df7fe29c2174a15bdc6f7fe2f4fd5af7c475` | `K-07` |
| `services/geometry-engine/tests/test_checkpoint_j_performance_and_equivalence.py` | `7451e84779784239ef1e90245d7fa5421903527e3038afe99ed732ce3699778e` | `K-03` |
| `services/geometry-engine/tests/test_pkg_m00_04_closure.py` | `175c9b5f9c227a76442c0d9e2c402e95feafb1f7cb83fd0e88c038909c5fcf5e` | Regression baseline |

---

## 3. Finding-to-Artifact Traceability Matrix (`K-01` – `K-07`)

| Finding | Severity | Primary Source Changes | Adversarial Regression Coverage |
| :--- | :--- | :--- | :--- |
| **`K-01`** | **HIGH** | `c1_cert_oracle.py` (`certify_intra_segment_local_self_intersection`, `exact_offset_endpoints_coincide`, Step 2.5); `qualification.py` (`_certify_local_self_intersection_candidate`, `_exact_linear_radical_zero`, `_finalize_regular_valid`) | `test_pkg_m00_05_checkpoint_k_remediation.py::test_k01_*` (pinched crossing, non-crossing, exact closed-endpoint loop, grazing endpoint across oracle + all 3 candidates) |
| **`K-02`** | **HIGH** | `qualification.py` (`certify_regular_offset_exact_rational`, `max_nodes_per_tier=1024` budgets); `c1_cert_oracle.py` (bounded iterative stack, exact micro-reversal check on isolated cusp roots, exact rational fallback at 336-bit ceiling) | `test_pkg_m00_05_checkpoint_k_remediation.py::test_k02_*` (`K1`–`K5` exact-boundary & near-boundary curves + node-budget fail-closed `INCONCLUSIVE` across oracle + all 3 candidates) |
| **`K-03`** | **MEDIUM** | `qualification.py` (`benchmark_63_canonical_garment_contours` single outer end-to-end `perf_counter` timer, `phaseSumMs`, `unaccountedWrapperOverheadMs`, `environmentMetadata`); `test_checkpoint_j_performance_and_equivalence.py` (jitter-robust assertions) | `test_pkg_m00_05_checkpoint_k_remediation.py::test_k03_*` + `test_checkpoint_j_performance_and_equivalence.py` |
| **`K-04`** | **HIGH** | `scripts/check_oracle_independence.py` (exact-module allowlist removing bare `patroner_geometry`, constant-folding string analyzer, dynamic/obfuscated `__builtins__`/`getattr`/`vars`/`globals`/`sys.modules`/`__subclasses__` & `importlib` blocking) | `test_pkg_m00_05_checkpoint_k_remediation.py::test_k04_*` (12+ Checkpoint K bypass vectors + 4 benign patterns + live repository audit) |
| **`K-05`** | **MEDIUM** | `scripts/m00_capture_c0_legacy.ts` (`--out` support, removed top-level `mkdirSync`); `scripts/m00_verify_production_dxf_and_seams.py` (removed import-time `mkdir`, local `tsx` resolution); `scripts/m00_execute_all.py` (strict isolated `--single-run --output-dir`) | `test_pkg_m00_05_checkpoint_k_remediation.py::test_k05_*` (SHA-256 + `st_mtime_ns` zero-write proof on `artifacts/m00/` and repo root) |
| **`K-06`** | **HIGH** | `services/geometry-engine/patroner_geometry/contracts.py` & `packages/contracts/schemas/canonical_contracts.schema.json` (16-case dual Pydantic v2 + JSON Schema Draft 2020-12 parity on `OffsetValidationRecord` & `OffsetClassificationReport`) | `test_pkg_m00_05_checkpoint_k_remediation.py::test_k06_*` (`CONTRA-01`..`CONTRA-16` + `OffsetClassificationReport` contradictions) |
| **`K-07`** | **LOW** | `docs/evidence/pkg_m00_04/FINAL_VERIFICATION_REPORT.md` (dated supersession notice), `docs/prep/TRACK_B_ORIGINAL_ROADMAP_READINESS.md` (Section 5 `M02a`–`M02h` reconciliation), `docs/evidence/pkg_m00_05/*` evidence pack, `scripts/m00_execute_all.py` (manifest discovery) | `test_pkg_m00_05_checkpoint_k_remediation.py::test_k07_*` (doc presence, supersession notice, `M02a`–`M02h` table, manifest inclusion) |
