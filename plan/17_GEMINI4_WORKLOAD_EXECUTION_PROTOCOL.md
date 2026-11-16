# 17 — Multi-Agent & Automated Workload Execution Protocol (`M00`–`M10`)

**Document ID:** `PATRONER-R2.2-17`  
**Revision Layer:** `Blueprint R2.2` (`docs/r2.2-unified-execution-blueprint` consolidated in `fix/m00-integrated-consolidation`)  
**Scope:** Engineering execution governance, branch isolation, deterministic CI, fail-closed numerical assurance, outward binary64 serialization, and Owner Gate sign-off across `M00`–`M10`.

---

## 1. Non-Negotiable Execution & Branch Isolation Rules

1. **Immutable Baselines & Protected Branches:**
   - **`main`** and **`origin/main`** (`1221eb05497a59e52c4af851614085748c92a2d1`) must **never** be force-pushed, amended, or modified directly by autonomous execution workstreams.
   - Documentation reconciliation (`docs/r2.2-unified-execution-blueprint` = `68f7d2d`) and bounded implementation packages (`feat/m00-p00-qualification` = `d1a7940`, `feat/m00-production-dxf-verification` = `d5a7075`) remain preserved untouched; integrated review executes on `integration/m00-r2.2-review` (`d2977ccc868c7c8152282477c597044e3ca07556`) and consolidation remediation executes on **`fix/m00-integrated-consolidation`** (`PKG-M00-02`).
   - Protected historical archives (`plan/00`–`14` and `artifacts/m00/checkpoint_13a_audit/*`) must never be overwritten or rewritten.
2. **Gate Enforcement Discipline (`Gate Auth-1`..`Gate Auth-4`):**
   - No workload branch may implement production code for a gated milestone (`M01`–`M03`/`M05`–`M06` prior to `Gate Auth-2`; `M04`/`M07`/`M08` prior to `Gate Auth-3`; `M09` prior to `Gate Auth-4`).
   - Only `M00` verification, oracle, schema lock, and blueprint reconciliation packages are authorized under `Checkpoint 12` (`Gate Auth-1`).

---

## 2. Deterministic Environment & CI Gate Protocol

Every verification package targeting `services/geometry-engine/` or `packages/contracts/` MUST enforce:

1. **Pinned Python 3.12 Lockfile (`uv --locked`):**
   - Python runtime: **3.12.16** provisioned via `uv` with committed `services/geometry-engine/uv.lock` (`mpmath==1.4.1`, `python-flint==0.9.0`, `pydantic==2.14.3`, `jsonschema==4.26.0`, `numpy==2.2.6`, `scipy==1.15.3`, `pytest==9.2.0`).
   - CI checks run with `uv run --locked` so unpinned dependency drift fails the build.
2. **Bit-Identical Replay & Wall-Clock / Host-Metadata Separation:**
   - All deterministic verification runners execute with `PYTHONHASHSEED=0`.
   - Two consecutive runs MUST emit **byte-for-byte identical SHA-256 digests** across all canonical mathematical/evidence JSON reports and root deliverables (verified via `M00_REPRODUCIBILITY_REPORT.json` and `M00_ARTIFACT_HASH_VERIFICATION.json`).
   - Non-deterministic performance timings (`time.perf_counter()` latencies) and per-host OS kernel strings (`platform.platform()`) **MUST be strictly isolated** into `artifacts/m00/IntervalCandidateBenchmarks.json` and `artifacts/m00/RuntimeBenchmarkObservation.json` and **excluded** from deterministic manifests (`ReproducibleEnvironmentManifest.json`, `SchemasLockReport.json` using repo-relative `schemaPath`).
   - CI enforcement (`.github/workflows/m00-verification.yml`) MUST provision Node 20 (`npm ci`) + Python `3.12.16` (`uv lock --check --python 3.12.16` and `uv sync --locked`), run `pytest -v`, execute standalone Workstream B (`scripts/m00_verify_production_dxf_and_seams.py`), run `scripts/m00_execute_all.py` **twice**, and enforce a strict `git diff --exit-code` with **no `|| true`** masking, excluding only `':!artifacts/m00/IntervalCandidateBenchmarks.json'` and `':!artifacts/m00/RuntimeBenchmarkObservation.json'`.
3. **Full Cross-Runtime Test Gate:**
   - TypeScript type-check (`npx tsc --noEmit`), production Vite build (`npm run build`), and full Node test runner suite (`npm test`, executing `tsx scripts/test-runner.ts` built on `node:test`) must pass cleanly alongside Python `pytest -v` before committing.

---

## 3. Fail-Closed Numerical & Geometric Assurance Protocol

1. **Interval Arithmetic Guardrails (`ADR-009` + `15 §3.1–3.2`):**
   - Inputs from canonical CAD geometry must enter interval evaluators via integers or `fractions.Fraction` converted through outward-rounded rational bounds—never raw Python binary64 float literals.
   - All squared terms (`||B'||^2`, circle radial norm `x^2 + y^2`, `dt^2`) MUST use power semantics (`u ** 2`), never `u * u`.
   - Wrappers must check divisor intervals for $0 \in D$ and square-root radicands for $\inf R < 0$ explicitly rather than relying on silent interval context widening (`[-inf, +inf]`).
   - `mpmath.iv` (`1.4.1`) must never be mislabeled IEEE 1788-2015 compliant; `mpmath.iv + Fraction` serves as the `M00` reference oracle while C-backed `python-flint` (`0.9.0`) serves as qualified high-throughput reserve pending `DEC-13 Stage 2`.
2. **Directed Outward IEEE-754 Binary64 Serialization Standard (`qualification.py` helpers):**
   - Any boundary, bound, error upper limit, or interval endpoint written to JSON for certification (`tLower`, `tUpper`, `deltaT`, `lowerChordBoundCm`, `upperControlPolygonBoundCm`, `maxGeometricDeviationBoundCm`, `certifiedIntervalErrorCm`, `minBaseSpeedSquaredInterval`, `minOffsetSpeedFactorInterval`, `validatedIntervalAabbs`, `localSpeedUpperBoundCmPerT`, `edgeAC1CertIntervalCm`, `edgeBC1CertIntervalCm`, etc.) MUST use directed outward IEEE-754 binary64 conversion (`fraction_to_outward_lower_f64`, `fraction_to_outward_upper_f64`, `mpf_to_outward_lower_f64`, `mpf_to_outward_upper_f64`, `iv_to_outward_f64_pair` verified against `Fraction(f)` via `math.nextafter`) with **zero shrinking `round()` calls**.
   - Multi-segment totals (such as closed piece perimeters) accumulate exact `Fraction` interval endpoints before a single outward binary64 conversion; human-readable rounded display values, if included, are restricted to explicitly separated `diagnosticFields` while exact rational strings and outward binary64 bounds occupy `certificationFields` (`serializationAssuranceMetadata`).
3. **`AG-15` Global Self-Intersection Proof & MVT Injectivity Standard:**
   - Bounding overlap pruning MUST use validated interval AABBs (`validatedIntervalAabbs`), using conservative `B(I) ± |d|` bounds if `0 in Q(I)` on a coarse panel, and must never skip boxes solely on parametric distance (`|t1 - t2|`) or tree-depth heuristics.
   - Same-segment diagonal/near-diagonal candidate boxes $i_1 \times i_2$ may be excluded **only** via the Mean Value / Rolle Injectivity Criterion on $H = i_1 \cup i_2$: proving $0 \notin O'_x(H)$ or $0 \notin O'_y(H)$.
   - Root existence/uniqueness certification MUST prove **Krawczyk contraction**: $K(X) \subseteq \operatorname{int}(X)$ and $\|I_2 - Y J(X)\|_\infty < 1$.
   - Any box or tangential boundary failing contraction at subdivision/precision limits (`depth >= max_depth` or `0 in Q`) **MUST fail closed with `UNRESOLVED` / `verification_outcome = "INCONCLUSIVE"` and `failure_category = "INCONCLUSIVE_VERIFICATION"`**—never coerce `INCONCLUSIVE` to valid.
4. **Epistemic Honesty on Prototype & Interop Boundaries:**
   - Synthetic DXF-AAMA round-trip passes keep `externalCadInteroperabilityVerified: false` until actual external commercial CAM parsers (`M05`) pass.
   - Missing drafting blocks (`src/engine/drafting/trouser-block.ts`) or `C0-Legacy` target-ease divergences (`sleeve-block.ts` `totalEaseCm` above classic `1.80 cm` target) must be surfaced explicitly in reports and tracked as `BLOCKED_MISSING_*` or `Class B` `M02b` upgrades.

---

## 4. Verification Honesty & Escalation Protocol

1. **Zero Fabricated Metrics or SHAs:** Every commit SHA, tree SHA, artifact SHA-256 digest, pass/fail count, and runtime figure reported in evidence bundles or handover summaries MUST be directly observed from executed tool output on that exact branch state.
2. **Remote Push & Credential Failure Handling:** If git push or external API access lacks credentials, report the exact exit status and leave local commits clean on their dedicated branches; never fabricate push completion.
3. **Owner Escalation Format (`Gate Auth-2`–`Gate Auth-4`):** Present (a) reconciled status of every workload acceptance criterion (`VERIFIED`, `IMPLEMENTED_UNVERIFIED`, `BLOCKED`, `ACCEPTED`), (b) exact artifact SHA-256 digests and test counts, (c) explicit open defects/blockers, and (d) explicit statement that the gate remains **CLOSED** pending Project Owner sign-off.
