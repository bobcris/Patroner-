# PATRONER — `PKG-M00-04` Checkpoint A: Baseline & Change-Impact Traceability Matrix

**Package:** `PKG-M00-04` — Final M00 Closure Remediation (Checkpoint I Findings `I-01`–`I-07` + Non-Decisional Owner Adjudication Dossier `I-08`)  
**Workspace:** `/app/applet` (Git repository absent — zero Git operations permitted or performed)  
**Pre-Edit State:** Verified clean before any source, test, schema, script, or artifact modification.

---

## 1. Immutable Governance Baseline (Strictly Preserved Throughout `PKG-M00-04`)

| Governance Gate / Flag | Required Preserved State |
| :--- | :--- |
| `M00` Acceptance Status | **`NOT ACCEPTED`** |
| `Gate Auth-2` | **`CLOSED`** |
| `Gate Auth-3` | **`CLOSED`** |
| `Gate Auth-4` | **`CLOSED`** |
| `DEC-13 Stage 2` | **`CLOSED`** |
| `AC-09` Physical Validation | **`PENDING`** |
| `M01` / `M02` / `M03` Production Implementation | **`NOT STARTED`** |
| `P1-3` (Legacy TS Skirt Grading) | **`NOT STARTED / NOT AUTHORIZED`** |
| `isProductionReady` (unverified domains) | **`false`** |
| `externalCadInteroperabilityVerified` | **`false`** |

---

## 2. Verified Baseline Runtime, Tooling & Test Results (Pre-Edit)

| Component | Baseline Observation |
| :--- | :--- |
| Python runtime (locked venv) | `CPython 3.12.16` (`/app/applet/services/geometry-engine/.venv/bin/python`) restored from `services/geometry-engine/uv.lock` via `uv 0.13.9` (`uv sync --locked --all-extras --python 3.12.16`) |
| Pinned Python packages (`pyproject.toml` == `uv.lock` == live) | `mpmath==1.4.1`, `python-flint==0.9.0`, `pydantic==2.14.3`, `jsonschema==4.26.0`, `numpy==2.2.6`, `scipy==1.15.3`, `pytest==9.2.0` (20 total locked distributions) |
| Node.js / npm | `Node v22.23.2`, `npm 10.9.8` |
| Baseline Python `pytest -v` (`PYTHONHASHSEED=0`) | **29 / 29 PASSED** (`69.06s`) |
| Baseline TypeScript `npx tsc --noEmit` | **0 errors** |
| Baseline TypeScript `npm test` | **892 / 892 PASSED** across **184 suites** (`98.98s`) |
| Baseline `scripts/check_oracle_independence.py` | **0 violations reported** (before closing the 4 Checkpoint I bypasses) |

---

## 3. Verbatim Pre-Fix Defect Reproductions (Captured Before Any Edits)

### 3.1 `I-02` — 4 Oracle-Independence AST Bypasses Reproduced
1. `importlib.import_module("patroner_geometry.solvers.offset_solver")` inside `tier2_oracle` (`c1_cert_oracle.py`): **`0` violations reported** (bypassed).
2. `__import__("patroner_geometry.solvers.offset_solver")` inside `tier2_oracle`: **`0` violations reported** (bypassed).
3. `from patroner_geometry.offset_kernel import run_fast` (dynamic Tier-1 file name not in static prefix list): **`0` violations reported** (bypassed).
4. `services/geometry-engine/patroner_geometry/__init__.py` and `services/geometry-engine/patroner_geometry/contracts.py`: unconditionally skipped under `sharedContractFiles` without AST import/re-export inspection.

### 3.2 `I-03` — Adjacent-Segment 90° Global Self-Intersection Bypass Reproduced
- Input: Two adjacent CCW segments meeting at `(10, 0)`: `seg0: (0,0) -> (10,0)` and `seg1: (10,0) -> (10,10)`, inward offset `s_sign = +1`, `d = 2.0`.
- Exact geometric crossing of the two inward offset lines (`y = 2` and `x = 8`) is at `(8.0, 2.0)` (`t0 = 0.8`, `t1 = 0.2`).
- Pre-fix `detect_global_contour_self_intersections([seg0, seg1], s_sign=+1, d=2.0)` output:
  `krawczykStatus = "CERTIFIED_DISJOINT"`, `canonicalOffsetClassification = "CERTIFIED_VALID"`, `len(globalIntersections) = 0`.

### 3.3 `I-06` — 8 Contradictory Certification States Reproduced (Pydantic vs. JSON Schema)
| # | Contradictory `OffsetValidationRecord` Payload | Pre-Fix Pydantic Accepted? | Pre-Fix JSON Schema Accepted? |
| :-: | :--- | :-: | :-: |
| 1 | `CERTIFIED_VALID` with `failure_category="TANGENT_REVERSAL"` | `False` (rejected) | **`True` (FALSE ACCEPT)** |
| 2 | `CERTIFIED_VALID` with `has_zero_speed_cusp_on_domain=True` | **`True` (FALSE ACCEPT)** | **`True` (FALSE ACCEPT)** |
| 3 | `CERTIFIED_VALID` with `has_tangent_reversal_on_domain=True` | **`True` (FALSE ACCEPT)** | **`True` (FALSE ACCEPT)** |
| 4 | `CERTIFIED_VALID` with `min_offset_speed_factor_interval=[0.01, 0.02] < eps=0.05` | **`True` (FALSE ACCEPT)** | **`True` (FALSE ACCEPT)** |
| 5 | `CERTIFIED_INVALID` with `failure_category="NONE"` | **`True` (FALSE ACCEPT)** | **`True` (FALSE ACCEPT)** |
| 6 | `CERTIFIED_INVALID` with `is_production_ready=True` | `False` (rejected) | **`True` (FALSE ACCEPT)** |
| 7 | `INCONCLUSIVE` with `failure_category="NONE"` | **`True` (FALSE ACCEPT)** | **`True` (FALSE ACCEPT)** |
| 8 | `INCONCLUSIVE` with `is_production_ready=True` | `False` (rejected) | **`True` (FALSE ACCEPT)** |

---

## 4. Pre-Change SHA-256 Baseline Hashes

```text
6621d0f25228565a36a14c2855d68408ee0c22e0f06ed838dce19639b05e0f8a  .github/workflows/m00-verification.yml
912f2add293e12036f80f81f7b29aa8b5d286c6d1171c1723896f489595a67b4  package.json
35952f090564f3916e48896d0f11154ffd9ba061539826a8480636b0627834a6  packages/contracts/schemas/canonical_contracts.schema.json
2b9f396e920ddb24fe80e691fbeb34f1131788bf8aa62df24eda5952eab7c878  services/geometry-engine/pyproject.toml
0dfa5181eb2075c10ce5649a63555643e0dd7e429bd2c1f6cc2e355691936908  services/geometry-engine/uv.lock
43ed3e732cb816854b5bb5c3b64af1d45acecd77a8d3ddabefb1897af12a2b41  services/geometry-engine/patroner_geometry/__init__.py
d9fe509effca0a79444d56211e55d610faffeace47037ea38f5973c0c3643496  services/geometry-engine/patroner_geometry/c1_cert_oracle.py
510e0fc52d08c770fdf2a85b90a1353bc6a858f7b4e2c2d11ceffe79526a9a2a  services/geometry-engine/patroner_geometry/contracts.py
54746c8972dfa5d41d61c23d594f1d5ddd142ddaf82135fe15c4cebd1cc2120d  services/geometry-engine/patroner_geometry/provenance.py
8159c61d8ab2ce555c3498fca0d45289cb43014d1dc1aa2f2fea9c75eaedd93e  services/geometry-engine/patroner_geometry/qualification.py
ea25091ea979054a82d1788caa8ad03a319ab8ea2f70d6fd7104c0e2d907456d  services/geometry-engine/patroner_geometry/sub_oracles.py
2bc0baf875c67351bec71204b954f3b6096b23a25295b259b1f6a77b62c33ef7  services/geometry-engine/tests/test_m00_verification_suite.py
300356b870a366b2da7be4ae8f634cea77487e48ebd6d89b2f57bce1f35a84c8  services/geometry-engine/tests/test_m00_production_dxf_and_seams.py
c5b6a8ce704ebbf59e671f1cf71b63a32fed05dcb130f56f18b10f667820b3a8  services/geometry-engine/tests/test_pkg_m00_03_remediation.py
6e77889b740fba87bd2fe8ccf58be65a04e7711f95a4c1a943f895a2eaa4b372  scripts/check_oracle_independence.py
425df2943d185a58cd8ab7020d83cb0d934e36ec70c29f30458761797157ecf4  scripts/m00_execute_all.py
cc54b39402105a9ae31a1cb026754308035f6b087f8b464311cb9e208ed985c2  scripts/m00_verify_production_dxf_and_seams.py
be9de620e3c38fdeffe46f31ab5273b84e64d50ca915730083c7c84a7088af5a  scripts/m00_export_canonical_pieces.ts
85c0c7e77a85e8e373f80bef58f6eeb1e57cef5a4bc0f52d9e52e816f6785055  scripts/m00_capture_c0_legacy.ts
c96b3b7488b21127a27bdf7aeb763b7951eaf32650113baec8b3484ada703609  docs/evidence/M00_GOVERNANCE_AND_SPEC_CONFLICT_REGISTER.md
1bc62e3376fc5b6c81b06a7e08e839121019a723629669c99d079631022a1eaf  docs/prep/TRACK_B_ORIGINAL_ROADMAP_READINESS.md
```

---

## 5. Finding-to-Change Traceability Matrix (`I-01`–`I-08`)

| Finding | Checkpoint | Root Cause Confirmed | Target Files to Edit / Add | Verification Proof Required |
| :--- | :---: | :--- | :--- | :--- |
| **`I-01`** | **B** | Hardcoded pass booleans (`m00_execute_all.py:495,530,554`), single-process replay reusing `_CACHED_POPULATION`, live `perf_counter()` boolean leaked into `M00_REPRODUCIBILITY_REPORT.json`, narrow 15-file `sourceInputsProvenance`, naive CI substring checks, single-run CI workflow. | `patroner_geometry/provenance.py`, `scripts/m00_execute_all.py`, `scripts/verify_m00_manifest.py` (new), `scripts/verify_m00_reproducibility.py` (new), `.github/workflows/m00-verification.yml`, `tests/test_pkg_m00_04_closure.py` (new) | Independent 2-subprocess replay + negative mismatch test; zero volatile timing booleans in deterministic manifests; expanded `sourceInputsProvenance`; structural CI workflow parser tests. |
| **`I-02`** | **C** | `check_oracle_independence.py` misses `importlib`, `__import__`, `exec`/`eval`/`runpy`, skips `__init__.py` & `contracts.py`, lacks dynamic Tier-1 module discovery, and lacks independent TypeScript `src/engine/` audit (`ADR-001`). | `scripts/check_oracle_independence.py`, `tests/test_pkg_m00_04_closure.py` | Regression tests proving all 4 Checkpoint I bypasses + variants are blocked; TS `src/engine/` boundary audit report. |
| **`I-03`** | **D** | Adjacent segments skipped in `detect_global_contour_self_intersections`; fixed 113-bit precision without `113->170->336` escalation & Bernstein hull (`ADR-009 §5.1–§5.2`); float `norm_inf` & `[0,1]` clamping in Krawczyk; hand-built `OffsetValidationRecord` in `AG-01..04` and `AG-08`; missing `ADR-009 §6 #11b/#15`. | `patroner_geometry/c1_cert_oracle.py`, `tests/test_pkg_m00_04_closure.py` | 90° adjacent crossing certified at `(8.0, 2.0)`; escalation `113->170->336` + Bernstein hull test; Krawczyk exact/outward norm & no clamping; real oracle paths for `AG-01..04`, `AG-08`, `#11b`, `#15`. |
| **`I-04`** | **E** | Single synthetic degree-12 polynomial benchmark instead of `ADR-009 §7.2` 63 canonical garment contours; unsplit root isolation relied on pure `Fraction` rather than exercising candidate interval libraries directly; incomplete-population gate test needed. | `scripts/m00_export_canonical_63_contours.ts` (new), `patroner_geometry/qualification.py`, `tests/test_pkg_m00_04_closure.py` | 63 real deterministic drafted contours exported with full provenance & SHA-256; all 3 candidates benchmarked directly across all 63 contours with phase breakdown; direct interval-library unsplit isolation; incomplete-population rejection test; 53/113-bit hex tests. |
| **`I-05`** | **F** | `M00.5` used quadrature diff instead of `ADR-009 §2.5` $B_{\mathrm{cert}} = E_{\mathrm{obs}} + B_{\mathrm{ref}}$ and omitted $\delta_{\mathrm{eval}}$ in Method B1; `m00_verify_production_dxf_and_seams.py` used a separate weaker DXF parser with unpinned `iv.mpf(str(...))` and fixed `subdivision_depth=8`; `M00.8` shoulders were rigid `+0.2 cm` x-translations instead of real anthropometric front (`4.6 cm` drop) vs back (`3.8 cm` drop) slopes (`bodice-block.ts:125–145`). | `patroner_geometry/sub_oracles.py`, `scripts/m00_verify_production_dxf_and_seams.py`, `tests/test_pkg_m00_04_closure.py` | `ADR-009 §2.5` $B_{\mathrm{cert}}$ & $\delta_{\mathrm{eval}}$ tests; unified hardened DXF parser negative tests (truncated, missing `SEQEND`, malformed); adaptive tolerance-driven subdivision; real distinct-slope shoulders in `M00.8`. |
| **`I-06`** | **G** | Schema/Pydantic drift vs `ADR-009 §§2.5 & 5.3`; JSON Schema allowed 8/8 contradictory states and Pydantic allowed 5/8. | `patroner_geometry/contracts.py`, `packages/contracts/schemas/canonical_contracts.schema.json`, `tests/test_pkg_m00_04_closure.py` | Complete `ADR-009 §§2.5 & 5.3` field reconciliation; shared-fixture parity test proving BOTH validators reject all 8 contradictory states + malformed inputs identically. |
| **`I-07`** | **G** | Active manifest mixed 5 stale Checkpoint 13A/15 Markdown reports, double-counted 2 duplicate pairs, omitted 11 M00 files, and retained stale `PKG-M00-02`/`PKG-M00-03` labels on active outputs. | `scripts/m00_execute_all.py`, `scripts/verify_m00_manifest.py`, `M00_ARTIFACT_HASH_VERIFICATION.json`, `docs/evidence/pkg_m00_04/` | Complete workspace M00 file inventory separating active/generated/historical/authoritative; zero double-counting; zero self-hashing; independent manifest verifier pass + tamper-detection negative test. |
| **`I-08`** | **G** | 10 unresolved governance/spec conflicts (`CONFLICT-D1`–`CONFLICT-D10`) + misstatements in `docs/prep/TRACK_B_ORIGINAL_ROADMAP_READINESS.md` regarding `M01`/`M02`/`M03`/`M11`. | `docs/evidence/pkg_m00_04/I08_GOVERNANCE_ADJUDICATION_DOSSIER.md` (new), `docs/prep/TRACK_B_ORIGINAL_ROADMAP_READINESS.md` (dated errata appended — historical text preserved) | Non-decisional Owner dossier preserving original `CONFLICT-D1`–`CONFLICT-D10` IDs & wording verbatim; Track B errata aligned with `plan/05`, `M01`, `M02`, `M03`. |

---

## 6. Risk Register & ADR Conflict Check

1. **`ADR-009 §5.3` vs `contracts.py` `StationaryParameterizationStatus` Enum Reconciliation:** `ADR-009 §5.3` lists `UNRESOLVED` alongside `NONE_REGULAR_SPEED`, `REMOVABLE_PARAMETERIZATION_DEGENERACY`, and `GENUINE_BASE_GEOMETRIC_SINGULARITY`, whereas `contracts.py` also includes `ENDPOINT_TANGENTIAL_DEGENERACY` and `COLLAPSED_ZERO_LENGTH_CURVE` (derived from `ADR-009 §4.2` 5-way taxonomy). **Mitigation:** Include `UNRESOLVED` in BOTH `contracts.py` and `canonical_contracts.schema.json` while preserving `ENDPOINT_TANGENTIAL_DEGENERACY` and `COLLAPSED_ZERO_LENGTH_CURVE` and explicitly documenting this reconciliation in the contract traceability report (no silent dropping of values).
2. **`ADR-009 §7.2` 63 Canonical Garment Contours & Missing `trouser-block.ts`:** `src/engine/drafting/` provides `bodice-block.ts`, `sleeve-block.ts`, and `skirt-block.ts`, while `trouser-block.ts` is absent (`BLOCKED_MISSING_TROUSER_BLOCK`). **Mitigation:** Construct the 63 canonical garment contours exclusively from real deterministic drafted outputs of `bodice-block.ts`, `sleeve-block.ts`, and `skirt-block.ts` across all 6 standard sizes (`XS`–`XXL`) and drafting variants (`waist`/`side-bust`/`french` bodice darts, `classic`/`tailored`/`fitted` sleeve strategies, `classic`/`fitted` ease profiles), with full per-contour provenance and explicit disclosure of the `trouser-block.ts` absence (zero fabricated trouser contours).
3. **Runtime Latency Budget (`< 5 ms` per contour on 63 contours):** Pure Python `mpmath.iv` may or may not meet `< 5 ms` per contour depending on contour segment count and interval subdivision depth. **Mitigation:** Measure and report raw honest timings per candidate across all 63 contours (`mpmath.iv`, `python-flint`, `DecimalInterval`) without cherry-picking or fabricating thresholds — noting `ADR-009 §7.2` explicitly anticipates `python-flint` or `PyO3` selection if `mpmath.iv` exceeds `5 ms` per contour.
4. **Backward Compatibility of Existing 29 Python & 892 TypeScript Tests:** Every contract schema enrichment must ensure all valid existing records and newly required `ADR-009 §§2.5 & 5.3` fields remain completely consistent across `c1_cert_oracle.py`, `sub_oracles.py`, `contracts.py`, and `canonical_contracts.schema.json`.
