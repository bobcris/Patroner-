# 14 — Blueprint Revision R2.1.2 to R2.1.2-R1 Changelog & Audit Record

**Document ID:** `PATRONER-R2.1.2-R1-14`  
**Revision:** Blueprint Revision 2.1.2-R1 (`R2.1.2-R1` — Targeted Offset Geometry, Base-Curve Singularity Classification, Numerical Assurance & Governance Alignment)  
**Date:** 2026-04-20  
**Target Branch:** `docs/blueprint-revision-2.1.2-r1`  
**Status:** **DOCUMENTATION REVISION COMPLETE — M00 REMAINS BLOCKED PENDING EXPLICIT OWNER APPROVAL**

> **Mandatory Governance Rule (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Authoritative Git Lineage & Recovery Record

Following the Project Owner's explicit approval of **Option 1** (using the published GitHub `R2.1.2-R1` recovery commit as the authoritative base), the repository lineage is anchored as follows:

| Lineage Stage | Branch / Ref | Commit SHA | Tree SHA | Parent Commit SHA | Description & Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Blueprint R2.1** | `main` (historical) | `617cc7f5d9e41b8cd55ed96b64d2363cdb29557b` | `a2d1b299272b850eb1f07aa3bd380cb172fc980a` | R2 baseline | Published R2.1 baseline on GitHub |
| **Blueprint R2.1.1** | `docs/blueprint-revision-2.1.1` | `8805140b1e6e7799922348369d7e29881102a75e` | `e408256f7b92ffdb947fa469b4e5a23e906db096` | `617cc7f5d9e41b8cd55ed96b64d2363cdb29557b` | Published R2.1.1 baseline on GitHub |
| **Blueprint R2.1.2 (Published)** | `docs/blueprint-revision-2.1.2` | `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3` | `5707cecd61b582c275ca58bb0f6b45433541861b` | `8805140b1e6e7799922348369d7e29881102a75e` | Published 18-file R2.1.2 revision on GitHub |
| *Pre-Restart Local R2.1.2 (Historical Note Only)* | *(ephemeral pre-restart local commit)* | `724fc09b621b1fc623967f5228e5c0f1108c9422` | `5707cecd61b582c275ca58bb0f6b45433541861b` | `8805140b1e6e7799922348369d7e29881102a75e` | Unavailable pre-restart local commit SHA recorded for historical audit traceability; its content was published to GitHub as `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3` |
| **Blueprint R2.1.2-R1 Approved Recovery Base** | `origin/main` / `main` | `282a303ea1126fb3b1da368e4e8e4ddbeb59c552` | `16ebb94c7f02af88a5a3b82a2f31d560f89d6615` | `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3` | Owner-approved Option 1 recovery base containing the completed `R2.1.2-R1` update to `plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md` |
| **Blueprint R2.1.2-R1 Completed Branch** | `docs/blueprint-revision-2.1.2-r1` | *(Recorded on commit)* | *(Recorded on commit)* | `282a303ea1126fb3b1da368e4e8e4ddbeb59c552` | Completes all 14 cross-referenced `plan/` documents and adds this `14_BLUEPRINT_R2_1_2_TO_R2_1_2_R1_CHANGELOG.md` |

---

## 2. Summary of Mathematical & Governance Corrections in `R2.1.2-R1`

### 2.1 Canonical Normal Convention & First-Principles Offset Derivative (`ADR-009 §1`)
* **Exterior Contour Orientation:** Counter-clockwise (**CCW**) in the right-handed $(x, y)$ plane; internal cutouts are clockwise (**CW**).
* **Unit Tangent & Left Unit Normal ($Q(t) = x'(t)^2 + y'(t)^2 > 0$):**
  $$\mathbf{T}(t) = \frac{(x'(t),\, y'(t))}{\sqrt{Q(t)}}, \qquad \mathbf{N}_+(t) = R_{+\pi/2}\mathbf{T}(t) = \frac{(-y'(t),\, x'(t))}{\sqrt{Q(t)}}$$
  On a **CCW exterior boundary**, $\mathbf{N}_+(t)$ points **inward** (into the piece interior) and $-\mathbf{N}_+(t)$ points **outward** (into the seam allowance margin).
* **Signed Curvature & Frenet-Serret Derivative:**
  $$\kappa(t) = \frac{C(t)}{Q(t)^{3/2}}, \qquad C(t) = x'(t)y''(t) - y'(t)x''(t), \qquad \mathbf{N}_+'(t) = -\kappa(t)\,\mathbf{B}'(t)$$
* **Signed Offset Curve & Exact Derivative ($d > 0, s \in \{+1, -1\}$):**
  $$\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t) \implies \mathbf{O}'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t) = f(t)\,\mathbf{B}'(t)$$
  where $f(t) = 1 - s\,d\,\kappa(t)$ is the dimensionless offset speed factor.

### 2.2 Four Analytical CCW Circle Sanity Cases (`ADR-009 §1.4`)
For a CCW circle of radius $R > 0$, $\mathbf{B}(t) = (R\cos t, R\sin t)$ has $Q(t) = R^2$, $C(t) = R^2$, $\kappa(t) = +1/R > 0$, inward unit normal $\mathbf{N}_+(t) = (-\cos t, -\sin t)$, and $\mathbf{O}(t) = (R - s\,d)(\cos t, \sin t)$ with $\mathbf{O}'(t) = (1 - s\,d/R)\,\mathbf{B}'(t)$:
1. **Case 1 — Inward Sub-Critical Offset ($s = +1, 0 < d < R$, e.g., $R=10, d=1.5\text{ cm}$):** $f(t) = 1 - d/R = 0.85 > 0$; regular concentric circle of radius $R - d = 8.5\text{ cm}$ (`Category 1: CERTIFIED_REGULAR`).
2. **Case 2 — Inward Critical Offset at Focal Center ($s = +1, d = R = 10\text{ cm}$):** $f(t) = 1 - R/R = 0$ identically; entire circle collapses to the origin $\mathbf{O}(t) \equiv (0, 0)$ with $\mathbf{O}'(t) \equiv \mathbf{0}$ (`Category 3: TANGENTIAL_CUSP_DEGENERACY`).
3. **Case 3 — Inward Super-Critical Offset ($s = +1, d > R$, e.g., $R=10, d=12\text{ cm}$):** $f(t) = 1 - d/R = -0.20 < 0$; orientation reverses ($\hat{\mathbf{T}}_{\mathbf{O}}(t) = -\mathbf{T}(t)$) after crossing the evolute (`Category 2b` / `Category 4` trimmed/rejected).
4. **Case 4 — Outward Seam Allowance Offset ($s = -1, d > 0$, e.g., $R=10, d=1.5\text{ cm}$):** $f(t) = 1 + d/R = 1.15 > 1$; unconditionally regular concentric circle of radius $R + d = 11.5\text{ cm}$ for every $d > 0$ (`Category 1: CERTIFIED_REGULAR`).

### 2.3 Five-Way $Q(t^*) = 0$ Singularity Distinction & $\mathbf{B}(t) = (t^3, 0)$ Counterexample (`ADR-009 §2.2`)
* **Correction of `R2.1.2` Error:** In `R2.1.2`, any root $Q(t^*) = x'(t^*)^2 + y'(t^*)^2 = 0$ was automatically labeled `ACTUAL_ZERO_SPEED_CUSP` (`Category 2a`). However, $Q(t^*) = 0 \implies \mathbf{B}'(t^*) = \mathbf{0} \implies C(t^*) = 0 \implies P_{\mathrm{cusp}}(t^*) = Q(t^*)^3 - d^2 C(t^*)^2 = 0$ identically for all $d$, and $\mathbf{T}(t), \mathbf{N}_+(t), \kappa(t)$ have $0/0$ indeterminate forms.
* **Concrete Counterexample (`ADR-009 §2.2`):** Let $\mathbf{B}(t) = (t^3, 0)$ on $t \in [-1, 1]$ (or $\mathbf{B}(u) = ((2u-1)^3, 0)$ on $u \in [0, 1]$ at $u^* = 0.5$). At $t^* = 0$, $\mathbf{B}'(0) = (0, 0)$ so $Q(0) = 0$. Yet for all $t \ne 0$, $\mathbf{T}(t) = \frac{(3t^2, 0)}{3t^2} = (1, 0)$, $\mathbf{N}_+(t) = (0, 1)$, and $\kappa(t) = 0$. The curve is a smooth straight line segment whose exact offset $\mathbf{O}(t) = (t^3, s\,d)$ has **no geometric cusp**.
* **Five-Way Singularity Classification (`ADR-009 §2.2`):**
  1. **Case I (`Q(t) > 0`):** Regular base curve; cusps governed strictly by $f(t) = 1 - s\,d\,\kappa(t) = 0 \iff P_{\mathrm{cusp}}(t) = 0$ with $s \cdot C(t) > 0$.
  2. **Case II-A (`Q(t*) = 0`, odd Taylor order $m$, e.g., $m = 3$ with continuous tangent $\mathbf{T}(t^{*-}) = \mathbf{T}(t^{*+})$ and $1 - s\,d\,\kappa_{\lim} > 0$):** **Removable Parameterization Degeneracy** (`Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY`), reparameterized to an arc-length-regular curve.
  3. **Case II-B (`Q(t*) = 0`, even Taylor order $m$, e.g., $m = 2, n = 3$, $\mathbf{B}(t) = (t^2, t^3)$):** **True Geometric Base-Curve Cusp / Fold** where $\mathbf{T}(t^{*+}) = -\mathbf{T}(t^{*-})$ (`Category 2a: ACTUAL_ZERO_SPEED_CUSP`).
  4. **Case II-C (`Q(t*) = 0` at endpoint $t^* \in \{0, 1\}$, e.g., $\mathbf{P}_1 = \mathbf{P}_0$):** One-sided Taylor limit evaluated via first non-vanishing derivative $\mathbf{a}_m / \|\mathbf{a}_m\|$ and limiting curvature $\kappa_{\lim}$.
  5. **Case II-D ($\mathbf{B}'(t) \equiv \mathbf{0}$ on $[0, 1]$):** Degenerate zero-length collapsed segment; rejected at input validation.

### 2.4 Six Offset Curve Classifications & 17-Family Future Test Suite (`ADR-009 §3, §6.2`)
* Formalizes the 6 offset classifications across `ADR-003`, `ADR-009`, `04`, `06`, `08`, `M00`, `M02`, and `M05`:
  1. `Category 1: CERTIFIED_REGULAR`
  2. `Category 2a: ACTUAL_ZERO_SPEED_CUSP`
  3. `Category 2b: ACTUAL_CURVATURE_CUSP`
  4. `Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY`
  5. `Category 3: TANGENTIAL_CUSP_DEGENERACY`
  6. `Category 4: SELF_INTERSECTING_NON_LOCAL`
* Synchronizes all references from the older 14-family list to the **17-Family Adversarial Geometry Test Matrix (`AG-01` through `AG-17`)**, explicitly distinguishing specification-time analytical checks from future `M00.4`/`M00.10` code execution deliverables.

### 2.5 Candidate Status of `mpmath.iv` & 4-Decision Governance Lifecycle (`ADR-009 §5, §7.2`)
* Resolves the `DEC-13` lifecycle across 4 distinct stages:
  1. **Candidate Selection (`DEC-13 Stage 1` at `Gate Auth-1`):** Approves `mpmath.iv` + `fractions.Fraction` as primary candidate (`python-flint` secondary; `Fraction`+`Decimal` tertiary) for evaluation in `M00.4`.
  2. **Library Qualification (`IntervalLibraryQualificationReport` in `M00.4`):** Future deliverable verifying outward rounding, polynomial enclosure, and runtime budget in `M00.4`.
  3. **Oracle Implementation Verification (`M00.4` & `M00.10`):** Future deliverable verifying the `C1-Cert` oracle across all 6 categories and all 17 adversarial families (`AG-01`–`AG-17`).
  4. **Production Adoption (`DEC-13 Stage 2` at `Gate Auth-2`):** Owner sign-off adopting the qualified library for `M02`.
* Establishes an explicit non-bypass rule that `SPIKE-DEC13-01` cannot substitute for any of the 4 stages.

---

## 3. Exact Inventory of Files Updated in `R2.1.2-R1`

| # | File Path | Role in `R2.1.2-R1` Revision |
| :--- | :--- | :--- |
| 1 | `plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md` | **Preserved from Recovery Anchor `282a303`:** Authoritative `R2.1.2-R1` mathematical & numerical assurance specification. |
| 2 | `plan/decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md` | Updated to match `ADR-009` notation ($\mathbf{T}, \mathbf{N}_+$, 5-way $Q(t^*)=0$ distinction, 6 offset categories, 17-family matrix, 4-decision lifecycle). |
| 3 | `plan/04_MIGRATION_AND_PARITY_POLICY.md` | Updated `C0-Legacy` / `C1-Fast` / `C1-Cert` escalation triggers, tolerance table, and 17-family future test suite (`AG-01`–`AG-17`). |
| 4 | `plan/05_WORKLOAD_DEPENDENCY_GRAPH.md` | Updated 4-gate topology and reconciled `DEC-01`–`DEC-13` gate mappings with the 4-decision lifecycle for `DEC-13`. |
| 5 | `plan/06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md` | Updated acceptance thresholds, 6 offset categories, `AG-01`–`AG-17` table, and verification honesty rules. |
| 6 | `plan/07_RISK_AND_OPEN_DECISIONS_REGISTER.md` | Updated `DEC-01`–`DEC-13` register, 4-stage `DEC-13` lifecycle, `SPIKE-DEC13-01` non-bypass rule, and `RISK-01`–`RISK-12`. |
| 7 | `plan/10_RELEASE_AND_GOVERNANCE_POLICY.md` | Updated Git lineage table (`617cc7f` $\to$ `8805140` $\to$ `95eb441` $\to$ `282a303`), 4-gate protocol, and verification honesty rules. |
| 8 | `plan/workloads/M00_MIGRATION_PREPARATION.md` | Updated `M00.1`–`M00.10` with future `IntervalLibraryQualificationReport`, 5-way $Q(t^*)=0$ classifier, and `AG-01`–`AG-17` deliverables. |
| 9 | `plan/workloads/M02_DETERMINISTIC_FASHION_ENGINE.md` | Updated `M02a`–`M02h` with `ADR-009` offset equations, `Category 2c` reparameterization, and `DEC-13 Stage 2` prerequisite. |
| 10 | `plan/workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md` | Updated `M05.3` Pre-Flight Gatekeeper with 6-category offset audit and two-tier seam tolerance check (`DEC-11`). |
| 11 | `plan/00_BLUEPRINT_REVISION_2.md` | Updated executive summary, Git lineage, mathematical invariants, and master roadmap to `R2.1.2-R1`. |
| 12 | `plan/01_SOURCE_REGISTER_AND_REQUIREMENTS.md` | Updated precedence rank 1 to `R2.1.2-R1` (`ADR-009`), reconciled Dossiers 03–06, and updated `REQ-MATH` / `REQ-GOV`. |
| 13 | `plan/02_ARCHITECTURE_DECISIONS.md` | Updated master ADR index (`ADR-001`–`ADR-009`) to `R2.1.2-R1`. |
| 14 | `plan/08_VERTICAL_SLICE_DEFINITION.md` | Updated Vertical Slice 1 pipeline stages and exit criteria with 6-category offset classification and `AG-01`–`AG-17`. |
| 15 | `plan/14_BLUEPRINT_R2_1_2_TO_R2_1_2_R1_CHANGELOG.md` | Added this comprehensive `R2.1.2` $\to$ `R2.1.2-R1` changelog and lineage audit record. |
| 16 | `plan/README.md` | Updated navigation index to include `14_BLUEPRINT_R2_1_2_TO_R2_1_2_R1_CHANGELOG.md` and `R2.1.2-R1` status. |

---

## 4. Open Owner Decisions Blocking `M00` (`Gate Auth-1`)

`R2.1.2-R1` is a documentation correction only. **`M00` remains blocked pending explicit Project Owner sign-off at `Gate Auth-1` on:**
1. **`DEC-01`:** Monorepo layout (`apps/web`, `services/geometry-engine`, `packages/contracts`) and Strangler-Fig cutover policy.
2. **`DEC-13 Stage 1`:** Approval of the candidate evaluation order (`mpmath.iv` + `fractions.Fraction` primary; `python-flint` secondary; pure-Python `Fraction`+`Decimal` tertiary) for execution of the `IntervalLibraryQualificationReport` in `M00.4`.
3. **Approval of Blueprint `R2.1.2-R1` (`ADR-001`–`ADR-009`)** as the governing baseline for `M00`.
