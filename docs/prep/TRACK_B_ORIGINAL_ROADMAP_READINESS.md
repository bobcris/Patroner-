# Track B — Original Roadmap Readiness & Dependency Matrix

> **STATUS: PREPARATION ONLY — BLOCKED PENDING GATE AUTH-2 / DEC-13 STAGE 2**
>
> This document is a non-authoritative preparation artifact produced under `PKG-M00-03` Stage 2 Track B.
> It does **not** modify any file in `plan/`, does **not** authorize `M01`, `M02`, or `P1-3`, and does **not** change any governance gate state.

---

## 1. Governance Baseline (Preserved Unchanged)

| Governance Control | Current Status |
|---|---|
| `M00` Formal Acceptance | **NOT ACCEPTED** (awaiting independent re-verification + Owner acceptance) |
| `Gate Auth-2` | **CLOSED** |
| `Gate Auth-3` | **CLOSED** |
| `Gate Auth-4` | **CLOSED** |
| `DEC-13 Stage 2` | **CLOSED** |
| `AC-09` Physical Toile Validation | **PENDING** |
| `isProductionReady` | **`false`** wherever production readiness is unestablished |
| `externalCadInteroperabilityVerified` | **`false`** (deferred to `M05`) |
| `P1-3` (Legacy TS Skirt Grading) | **NOT STARTED / NOT AUTHORIZED** |
| `M11` | **DOES NOT EXIST** |
| `P01` Workstream | **DOES NOT EXIST** in authoritative `plan/` (reconciled against `plan/05_WORKLOAD_DEPENDENCY_GRAPH.md` & `plan/16_UNIFIED_EXECUTION_SCHEDULE.md`) |

---

## 2. Original Roadmap Reconciliation (Authoritative `plan/` Sequence)

Per `plan/05_WORKLOAD_DEPENDENCY_GRAPH.md`, `plan/16_UNIFIED_EXECUTION_SCHEDULE.md`, and `plan/decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md`:

1. **`M00` (Foundational Contracts, Numerical Qualification & Reference Verification Oracles)** — *Active remediation (`PKG-M00-03` Stage 2); NOT ACCEPTED until formal Owner acceptance.*
2. **`Gate Auth-2` & `DEC-13 Stage 2`** — *Mandatory hard gate between `M00` and `M01`/`M02` production implementation.*
3. **`M01` (Authoritative Python Geometry Kernel — Tier-1 Production Solvers)** — *Blocked pending `M00` acceptance and `Gate Auth-2`.*
4. **`M02` (`M02a` Bodice, `M02b` Sleeve, `M02c` Skirt, `M02d` Grading, `M02e` Trouser, Vertical Slice 1)** — *Blocked pending `Gate Auth-2` / `DEC-13 Stage 2` and `M01`.*
5. **`M03`–`M10` (3D Simulation, Fitting/Optimizer, Industrial CAD Export `M05`, Pilot Validation `AC-09`, Commercial Readiness)** — *Blocked behind upstream gates (`Gate Auth-3`, `Gate Auth-4`, `AC-09`).*

---

## 3. Four-Category Dependency Matrix

### Category 1 — Allowed Now (Executed in `PKG-M00-03` Stage 2 Track A)
- `REM-01`: Reproducible Python `3.12.16` + `uv.lock` environment, live `importlib.metadata` provenance, deterministic source-input digests, hardened CI workflow.
- `REM-02`: Exact algebraic polynomial root isolation in $\mathbb{Q}[t]$ (square-free decomposition, Sturm/Bernstein isolation, endpoint/midpoint deflation, monic scale invariance, outward binary64 enclosure).
- `REM-03`: `C1-CERT` exact $\mathbb{Q}[t]$ GCD stationary-point detection, fail-closed Step 3 `INCONCLUSIVE`, removal of silent speed clamp, static AST oracle-independence check (`ADR-009 §5.4 / §7.1`).
- `REM-04`: Fair identical degree-12 Horner benchmark across all 3 interval candidates, $\ge 1,000$ Bernstein containment checks across degrees `{5, 9, 12}`, canonical 113-bit binary hex-float endpoints, adversarial stress strata, strict conjunctive qualification gate.
- `REM-05`: Hardened `M00.5` quadrature convergence & Method B1 outward bounds, `M00.6` adjacent-edge fold-back & exact closure/area predicates, `M00.7` strict DXF polyline/vertex count parity, `M00.8` distinct side-seam curves across `STD-XS`/`STD-M`/`PLUS-XXL`.
- `REM-06`: Exact 7-value `OffsetFailureCategory` Pydantic/JSON Schema parity, fail-closed `OffsetClassificationReport` model validator, complete `PROV-04` SHA-256 manifest.

### Category 2 — Preparation Only (Non-Executable Planning & Spec Readiness — No Production Code)
- **M01 Production Kernel Interface Design Notes (Pre-Gate Draft Only):** Define clean boundary between future Tier-1 production solvers (`services/geometry-engine/patroner_geometry/solvers/`) and Tier-2 verification oracles (`c1_cert_oracle.py`, `qualification.py`, `sub_oracles.py`), enforced statically by `scripts/check_oracle_independence.py`.
- **M02 Vertical Slice 1 Gap Inventory (Pre-Gate Only):** Track remaining missing `trouser-block` dependency (`M02e`) and Class B sleeve ease tracking (`M02b`) for execution strictly *after* `Gate Auth-2` opens.
- **Independent Audit Handover Pack:** Deterministic `M00_ARTIFACT_HASH_VERIFICATION.json`, `ReproducibleEnvironmentManifest.json`, and `M00_REPRODUCIBILITY_REPORT.json` ready for independent verification prior to Owner `M00` acceptance review.

### Category 3 — Blocked (Strictly Prohibited Until Upstream Gates Open)
- **`M01` Tier-1 Production Geometry Kernel implementation** — *Blocked pending `M00` formal acceptance & `Gate Auth-2`.*
- **`M02` (`M02a`–`M02e`) Authoritative Python Fashion Engine & Vertical Slice 1** — *Blocked pending `Gate Auth-2`, `DEC-13 Stage 2`, and `M01`.*
- **`P1-3` Legacy TypeScript Skirt Grading** — *NOT AUTHORIZED; conflicts with `ADR-001` Python-authoritative geometry/grading boundary.*
- **`M03`–`M10` (3D cloth sim, optimizer, external CAD interoperability under `M05`, commercial pilot)** — *Blocked pending `Gate Auth-3`, `Gate Auth-4`, and `AC-09`.*
- **Physical toile validation (`AC-09`) & external third-party CAD interoperability claims** — *Blocked / Deferred to `M05` & `AC-09`.*

### Category 4 — Owner Decision Required
1. **Formal `M00` Acceptance Sign-Off:** Following independent verification of `PKG-M00-03` Stage 2 outputs.
2. **`Gate Auth-2` & `DEC-13 Stage 2` Opening:** Required to authorize `M01` and `M02` production implementation.
3. **Governance Conflicts `C-01`–`C-10` Resolution** (e.g., `B1`–`B4` benchmark authority clarification, `M02` vs legacy `P1-3` retirement policy, `M00.8` Class B sleeve ease resolution timing under `M02b`, and external CAD verification scope under `M05`).
4. **Repository Git / Release Governance:** All Git commits, merges, tags, and deployments remain exclusively Owner-directed.

---

## 4. PKG-M00-04 Errata & Authoritative Roadmap Reconciliation (Appended `2026-11-21`)

> **Preservation Notice:** Sections 1–3 above are preserved verbatim as the historical `PKG-M00-03` Stage 2 preparation artifact. The following errata correct inaccuracies identified during Checkpoint I (`Finding I-08`) against the authoritative `plan/05_WORKLOAD_DEPENDENCY_GRAPH.md` and `plan/16_UNIFIED_EXECUTION_SCHEDULE.md`. This errata section does **not** alter any governance gate state or authorize any blocked workload.

1. **Correction to `M01` Scope (Lines 34, 51, 56):**
   - *Prior text:* Described `M01` as `"Authoritative Python Geometry Kernel — Tier-1 Production Solvers"`.
   - *Authoritative `plan/05` (§3, line 122) & `plan/16` (§2, line 58):* **`M01`** is **Platform Foundation, Contracts & Dual-Engine Proxy (`M01.1`–`M01.5`)** — covering monorepo scaffolding, Next.js 15 BFF/Strangler proxy, FastAPI service shell, PostgreSQL 16 + S3/GCS content store (`DEC-04`), async task queue/workflow orchestrator (`DEC-05`), and RBAC/Auth. The Tier-1 production deterministic 2D geometry & pattern engine belongs to **`M02`**, not `M01`.
2. **Correction to `M02` Sub-Workload Scope (Lines 35, 57):**
   - *Prior text:* Listed `M02` only as `M02a`–`M02e`.
   - *Authoritative `plan/05` (§1, §3, line 123) & `plan/16` (§2, line 59):* **`M02`** spans **`M02a`–`M02h`** (Deterministic 2D Fashion & Geometry Engine: `C1-Fast` + `C1-Cert` escalation, Bodice/Sleeve `M02b`/Skirt/Trouser blocks, `M02c` offsets, `M02d` grading, `M02e`–`M02g` geometry/seam certification & grading completeness, and `M02h` 2D NFP nesting/marker engine governed by `DEC-06`).
3. **Correction to `M03` Gate Topology (Lines 36, 59):**
   - *Prior text:* Grouped `M03` with `M04`–`M10` as blocked behind `Gate Auth-3` / `Gate Auth-4`.
   - *Authoritative `plan/05` (§1 diagram, §3 line 124) & `plan/16` (§1 diagram, §2 line 60):* **`M03` (Material Physics & Fabric Digital Twin Library, `M03.1`–`M03.4`)** unlocks in parallel with `M01` and `M02` at **`Gate Auth-2`** (requiring `DEC-03 Stage 1` and `M00.1` contracts), feeding `M06` prior to `Gate Auth-3`. (`M03` remains **BLOCKED / NOT STARTED** while `Gate Auth-2` is CLOSED.)
4. **Reconciliation of `M11` Status (Line 23):**
   - *Prior text:* Declared unconditionally `"M11 | DOES NOT EXIST"`.
   - *Authoritative Reconciliation:* `plan/05_WORKLOAD_DEPENDENCY_GRAPH.md` (§1 line 96, §3 line 132) explicitly defines **`M11` (Commercial Ecosystem & Multi-Tenant Scale, `M11.1`–`M11.4`)** as a post-`Gate Auth-4` expansion workload, whereas `plan/16_UNIFIED_EXECUTION_SCHEDULE.md` (line 6) scopes the `2026-11-16`–`2027-03-31` delivery window strictly to **`M00`–`M10`** (`"strictly NO M11"`). Thus `M11` exists in the `R2.1.2-R1` dependency graph (`plan/05`) as post-pilot expansion and is excluded from the `2027-03-31` execution schedule (`plan/16`).
5. **Canonical Conflict ID Reference (Line 65):**
   - *Prior text:* Referred informally to `"Governance Conflicts C-01–C-10"`.
   - *Authoritative Reference:* The canonical conflict IDs are **`CONFLICT-D1` through `CONFLICT-D10`** as recorded verbatim in `docs/evidence/M00_GOVERNANCE_AND_SPEC_CONFLICT_REGISTER.md` and compiled for Owner decision in `docs/evidence/pkg_m00_04/I08_GOVERNANCE_ADJUDICATION_DOSSIER.md`. All ten remain **`PENDING OWNER ADJUDICATION`**.

