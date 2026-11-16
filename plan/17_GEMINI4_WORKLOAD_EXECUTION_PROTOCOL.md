# 17 — Multi-Agent & Automated Workload Execution Protocol (`M00`–`M10`)

**Document ID:** `PATRONER-R2.2-17`  
**Revision Layer:** `Blueprint R2.2` (`docs/r2.2-unified-execution-blueprint`)  
**Scope:** Engineering execution governance, branch isolation, deterministic CI, fail-closed numerical assurance, and Owner Gate sign-off across `M00`–`M10`.

---

## 1. Non-Negotiable Execution & Branch Isolation Rules

1. **Immutable Baselines & Protected Branches:**
   - **`main`** and **`origin/main`** (`1221eb05497a59e52c4af851614085748c92a2d1`) must **never** be force-pushed, amended, or modified directly by autonomous execution workstreams.
   - Documentation reconciliation (`docs/r2.2-unified-execution-blueprint`) executes strictly separate from bounded implementation packages (`feat/m00-p00-qualification`, `feat/m00-production-dxf-verification`, and post-`Gate Auth-2` workload branches).
   - No parallel workstream may merge another active workstream into itself before verification & explicit merge authorization.
2. **Gate Enforcement Discipline (`Gate Auth-1`..`Gate Auth-4`):**
   - No workload branch may implement production code for a gated milestone (`M01`–`M03`/`M05`–`M06` prior to `Gate Auth-2`; `M04`/`M07`/`M08` prior to `Gate Auth-3`; `M09` prior to `Gate Auth-4`).
   - Only `M00` verification, oracle, schema lock, and blueprint reconciliation packages are authorized under `Checkpoint 12` (`Gate Auth-1`).

---

## 2. Deterministic Environment & CI Gate Protocol

Every verification package targeting `services/geometry-engine/` or `packages/contracts/` MUST enforce:

1. **Pinned Python 3.12 Lockfile (`uv --locked`):**
   - Python runtime: **3.12.16** provisioned via `uv` with committed `services/geometry-engine/uv.lock` (`mpmath==1.4.1`, `python-flint==0.9.0`, `pydantic==2.14.3`, `jsonschema==4.26.0`, `numpy==2.2.6`, `scipy==1.15.3`, `pytest==9.2.0`).
   - CI checks run with `uv run --locked` so unpinned dependency drift fails the build.
2. **Bit-Identical Replay & Wall-Clock Separation:**
   - All deterministic verification runners execute with `PYTHONHASHSEED=0`.
   - Two consecutive runs MUST emit **byte-for-byte identical SHA-256 digests** across all canonical mathematical/evidence JSON reports (verified via `M00_REPRODUCIBILITY_REPORT.json`).
   - Non-deterministic performance timings (`time.perf_counter()` latencies) **MUST be strictly isolated** into separate wall-clock benchmark files (e.g., `artifacts/m00/IntervalCandidateBenchmarks.json`) and excluded from deterministic report payloads.
3. **Full Cross-Runtime Test Gate:**
   - TypeScript type-check (`npx tsc --noEmit`), full TypeScript unit/integration suite (`npm test` via `tsx --test`), and production build (`npm run build`) must pass alongside Python `pytest` checks before committing.

---

## 3. Fail-Closed Numerical & Geometric Assurance Protocol

1. **Interval Arithmetic Guardrails (`ADR-009` + `15 §3.1–3.2`):**
   - Inputs from canonical CAD geometry must enter interval evaluators via integers or `fractions.Fraction` converted through outward-rounded rational bounds—never raw Python binary64 float literals.
   - Wrappers must check divisor intervals for $0 \in D$ and square-root radicands for $\inf R < 0$ explicitly rather than relying on silent interval context widening (`[-inf, +inf]`).
   - `mpmath.iv` (`1.4.1`) must never be mislabeled IEEE 1788-2015 compliant; C-backed `python-flint` (`0.9.0`) remains qualified as the reserve library for production speed.
2. **`AG-15` Global Self-Intersection Proof Standard:**
   - Bounding overlap pruning MUST use validated interval AABBs (`validatedIntervalAabbs`).
   - Root existence/uniqueness certification MUST prove **Krawczyk contraction**: $K(X) \subseteq \operatorname{int}(X)$ and $\|I_2 - Y J(X)\|_\infty < 1$.
   - Any box or tangential boundary failing contraction at subdivision/precision limits **MUST return `verification_outcome = "INCONCLUSIVE"` and `failure_category = "INCONCLUSIVE_VERIFICATION"`**—never coerce `INCONCLUSIVE` to valid.
3. **Epistemic Honesty on Prototype & Interop Boundaries:**
   - Synthetic DXF-AAMA round-trip passes keep `externalCadInteroperabilityVerified: false` until actual external commercial CAM parsers (`M05`) pass.
   - Missing drafting blocks (`src/engine/drafting/trouser-block.ts`) or `C0-Legacy` target-ease divergences (`sleeve-block.ts` `totalEaseCm` above classic `1.80 cm` target) must be surfaced explicitly in reports and tracked as `BLOCKED_MISSING_*` or `Class B` `M02b` upgrades.

---

## 4. Verification Honesty & Escalation Protocol

1. **Zero Fabricated Metrics or SHAs:** Every commit SHA, tree SHA, artifact SHA-256 digest, pass/fail count, and runtime figure reported in evidence bundles or handover summaries MUST be directly observed from executed tool output on that exact branch state.
2. **Remote Push & Credential Failure Handling:** If git push or external API access lacks credentials, report the exact exit status and leave local commits clean on their dedicated branches; never fabricate push completion.
3. **Owner Escalation Format (`Gate Auth-2`–`Gate Auth-4`):** Present (a) reconciled status of every workload acceptance criterion (`VERIFIED`, `IMPLEMENTED_UNVERIFIED`, `BLOCKED`, `ACCEPTED`), (b) exact artifact SHA-256 digests and test counts, (c) explicit open defects/blockers, and (d) explicit statement that the gate remains **CLOSED** pending Project Owner sign-off.
