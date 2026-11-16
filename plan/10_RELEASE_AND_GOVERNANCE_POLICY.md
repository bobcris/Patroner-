# 10 — Release, Branch Lineage, and Architecture Governance Policy

**Document ID:** `PATRONER-R2.1.2-R1-10`  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Governance Alignment)  
**Governing Authority:** Monograph v5.16; Addendum v4.1; Revision v4.5; `ADR-001`–`ADR-009` (`R2.1.2-R1`); `05_WORKLOAD_DEPENDENCY_GRAPH.md`; `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`  
**Status:** **GATE AUTH-1 APPROVED (CHECKPOINT 12, 2026-11-16) — M00 AUTHORIZED; M02 BLOCKED PENDING GATE AUTH-2 / DEC-13 STAGE 2**

> **Owner Authorization Record (`Checkpoint 12` — 16 November 2026):**
> * **`DEC-13 Stage 1` (APPROVED):** Approves the candidate library evaluation order specified in Blueprint `R2.1.2-R1` (`mpmath.iv` + `fractions.Fraction` primary; `python-flint` secondary; pure-Python `Fraction`+`Decimal` tertiary). Candidate selection only, not library qualification or production adoption.
> * **`DEC-01` (APPROVED):** Approves the pnpm + Turborepo + uv monorepo architecture (`apps/web`, `services/geometry-engine`, `packages/contracts`) and Strangler-Fig migration policy.
> * **`Gate Auth-1` (APPROVED):** Accepts Blueprint `R2.1.2-R1` as the governing baseline and authorizes commencement of `M00` (`M00.1`–`M00.10`), subject to producing `IntervalLibraryQualificationReport`, verifying the 17 adversarial geometry test families (`AG-01`–`AG-17`) with recorded evidence, and holding `M02` production implementation pending `DEC-13 Stage 2` / `Gate Auth-2`.

---

## 1. Purpose and Authority Boundary

This policy defines the release engineering, Git branch lineage, authorization gates (`Gate Auth-1` through `Gate Auth-4`), and mathematical verification governance for the Patroner platform.

### 1.1 Strict Gate Enforcement (`Gate Auth-1` Approved $\to$ `M00` Execution $\to$ `Gate Auth-2` Mandatory Before `M02`)
* Following explicit Project Owner authorization at **`Gate Auth-1`** (`Checkpoint 12`, `16 November 2026`), **`M00` (`M00.1`–`M00.10`) is authorized to execute in its defined sequence**.
* **`M02` production implementation remains strictly blocked pending `DEC-13 Stage 2` and `Gate Auth-2` sign-off**, and no production-readiness claim may be made without the required recorded evidence.

---

## 2. Authoritative Git Lineage & Recovery Record (`R2` $\to$ `R2.1.2-R1` $\to$ `M00`)

All planning revisions maintain a verifiable, non-destructive Git commit lineage anchored to `https://github.com/bobcris/Patroner-.git`:

| Revision Baseline | Branch Name | Commit SHA | Parent Commit SHA | Role & Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **Blueprint R2.1** | `main` (historical) | `617cc7f5d9e41b8cd55ed96b64d2363cdb29557b` | R2 baseline | Published R2.1 baseline on GitHub |
| **Blueprint R2.1.1** | `docs/blueprint-revision-2.1.1` | `8805140b1e6e7799922348369d7e29881102a75e` | `617cc7f5d9e41b8cd55ed96b64d2363cdb29557b` | Published R2.1.1 baseline on GitHub |
| **Blueprint R2.1.2 (Published)** | `docs/blueprint-revision-2.1.2` | `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3` | `8805140b1e6e7799922348369d7e29881102a75e` | Published R2.1.2 18-file commit on GitHub (`Tree: 5707cecd61b582c275ca58bb0f6b45433541861b`) |
| *Pre-Restart Local R2.1.2 (Historical Note)* | *(ephemeral pre-restart local commit)* | `724fc09b621b1fc623967f5228e5c0f1108c9422` | `8805140b1e6e7799922348369d7e29881102a75e` | Historical pre-restart local commit SHA recorded for audit traceability; content published to GitHub as `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3` |
| **Blueprint R2.1.2-R1 Recovery Anchor** | `main` / `origin/main` | `282a303ea1126fb3b1da368e4e8e4ddbeb59c552` | `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3` | Owner-approved Option 1 recovery base containing the completed `R2.1.2-R1` update to `ADR-009` (`Tree: 16ebb94c7f02af88a5a3b82a2f31d560f89d6615`) |
| **Blueprint R2.1.2-R1 Complete** | `docs/blueprint-revision-2.1.2-r1` | `6938f808629276fd1b0860fba407b42f5cb40aaf` | `282a303ea1126fb3b1da368e4e8e4ddbeb59c552` | Completed all 16 `R2.1.2-R1` `plan/` documents (`Tree: 651d5fc152b7c248e184a7f208812797cec40d13`); accepted at `Gate Auth-1` (Checkpoint 12) |

### 2.1 Branch Protection & Non-Destructive History Rules
1. **No Force-Pushes or History Rewriting:** Historical commits (`617cc7f`, `8805140`, `95eb441`, `282a303`, `6938f80`) must never be amended, rebased, or overwritten.
2. **Dedicated Revision & Execution Branches:** Every blueprint revision and milestone execution is audited with deterministic commit/tree SHAs.

---

## 3. Four-Gate Release & Decision Governance Protocol

No engineering workload may bypass its governing Owner Authorization Gate. All 13 open decisions (`DEC-01` through `DEC-13`) are bound to specific gates as established in `05_WORKLOAD_DEPENDENCY_GRAPH.md` and `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`:

### 3.1 `Gate Auth-1` — Pre-`M00` Architecture, Mathematical Baseline & Candidate Selection Sign-Off (**APPROVED — CHECKPOINT 12, 2026-11-16**)
* **Scope:** Authorizes the start of `M00` (Pre-Migration Verification, Contracts & Reference Oracle).
* **Completed Prerequisites (Signed Off 2026-11-16):**
  1. Completion and acceptance of Blueprint `R2.1.2-R1` (`ADR-001` through `ADR-009`, commit `6938f808629276fd1b0860fba407b42f5cb40aaf`).
  2. Owner sign-off on **`DEC-01`** (pnpm + Turborepo + uv monorepo layout `apps/web`, `services/geometry-engine`, `packages/contracts` & Strangler-Fig cutover policy).
  3. Owner sign-off on **`DEC-13 Stage 1`** (Candidate Selection of `mpmath.iv` + `fractions.Fraction` primary candidate, `python-flint` secondary, pure-Python `Fraction`+`Decimal` tertiary for evaluation in `M00.4`).

### 3.2 `Gate Auth-2` — Post-`M00` Verification Audit & Core Platform Entry Sign-Off
* **Scope:** Authorizes the start of `M01` (Platform Shell), `M02` (Deterministic Fashion Engine), `M03` (Material Physics), `M05` (Manufacturing Gatekeeper entry), and `M06.1`–`M06.2` (3D Simulation entry).
* **Mandatory Prerequisites:**
  1. Completion of all `M00.1`–`M00.10` deliverables, including the executed **`IntervalLibraryQualificationReport`** (`M00.4`) and 100% pass of the **`C1-Cert` Reference Oracle** across all **17 Adversarial Geometry Test Families (`AG-01`–`AG-17`)** and all 6 offset categories (`Category 1`, `2a`, `2b`, `2c`, `3`, `4`).
  2. Owner sign-off on **`DEC-13 Stage 2`** (Production Interval Library Adoption based on the `M00.4` qualification report).
  3. Owner sign-off on **`DEC-02 Stage 1`** (3D Cloth Solver Kernel Selection for `M06.2`), **`DEC-03 Stage 1`** (Material Testing Hardware & Tier Policy), **`DEC-04`** (PostgreSQL 16 + S3/GCS), **`DEC-05`** (Task Queue / Orchestrator), **`DEC-06`** (2D Nesting Engine), **`DEC-09`** (`Ed25519` / RFC 8785 JCS Signing Standard), and **`DEC-11`** (Two-Tier Paired Seam Tolerance Reconciliation: `0.05 cm` CAD vs. `0.20 cm` Sewn).

### 3.3 `Gate Auth-3` — Vertical Slice 1 & 3D Physics Qualification Sign-Off
* **Scope:** Certifies Vertical Slice 1 (`M01` + `M02` + `M05` E2E for Bodice & Trouser) and 3D Physics (`M03` + `M06`), authorizing `M04` (AI Copilot), `M07` (Fit Calibration), and `M08` (Commercial Sub-Ledger).
* **Mandatory Prerequisites:**
  1. Vertical Slice 1 passes all geometric, topological, and DXF-AAMA round-trip gates (`06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`).
  2. Owner sign-off on **`DEC-02 Stage 2`** (3D Simulation Kernel passes Benchmarks `B1`–`B4` within $\le 5\%$ error) and **`DEC-03 Stage 2`** (Empirical Fabric Correlation Study).

### 3.4 `Gate Auth-4` — Commercial Pilot & Financial Compliance Sign-Off
* **Scope:** Authorizes live commercial transactions and physical manufacturing in `M09` (Micro-Factory Pilot).
* **Mandatory Prerequisites:**
  1. Verified double-entry sub-ledger reconciliation (`M08`) and signed `TechPackManifest` handoff (`M05.5`).
  2. Owner sign-off on **`DEC-07`** (Customer Body Acquisition Mode), **`DEC-08`** (Live PSP & Escrow Integration), **`DEC-10`** (Pilot Capsule Garment Mix), and **`DEC-12`** (Operating Jurisdiction & Tax Compliance).

---

## 4. Verification Honesty & Audit Reproducibility Rules

1. **No Fabricated Test Execution Claims:** Planning documents must distinguish strictly between:
   * **Specification-Time Analytical Derivations & Sanity Checks:** The 4 circle offset cases (`Case 1`–`Case 4`) and the analytical proof that $\mathbf{B}(t) = (t^3, 0)$ is a `Category 2c` removable parameterization degeneracy (`ADR-009 §1.4`, `§2.2`, `§6.1`).
   * **Future Milestone Execution Deliverables:** The `IntervalLibraryQualificationReport`, the executable `C1-Cert` Python oracle, and the 17-family adversarial test suite (`AG-01`–`AG-17`), which will be implemented and executed in `M00.4` and `M00.10`.
2. **Non-Bypass Rule for Exploratory Spikes:** Any pre-`M00` spike (`SPIKE-DEC13-01`) is non-binding and cannot waive `Gate Auth-1` (`DEC-13 Stage 1`), the `M00.4` `IntervalLibraryQualificationReport`, or `Gate Auth-2` (`DEC-13 Stage 2`).
3. **Deterministic Audit Bundles:** At the close of every milestone, CI must emit a signed, content-addressed bundle containing exact Git commit/tree SHAs, lockfile digests, and JSON verification reports.
