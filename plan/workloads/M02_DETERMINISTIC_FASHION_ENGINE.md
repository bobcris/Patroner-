# Workload M02 — Deterministic 2D Fashion & Computational Geometry Engine

**Document ID:** `PATRONER-R2.1.2-R1-M02`  
**Workload ID:** `M02` (`M02a` through `M02h`)  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Numerical Assurance Alignment)  
**Governing Authority:** Monograph v5.16 (Part II §4–§6); Addendum v4.1 (§3–§4); `ADR-001`, `ADR-003`, `ADR-009` (`R2.1.2-R1`); `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`  
**Status:** **SPECIFICATION COMPLETE — BLOCKED PENDING M00 COMPLETION & GATE AUTH-2 SIGN-OFF**

> **Mandatory Governance Boundary (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval, and `M02` is blocked pending `M00` completion and `Gate Auth-2` sign-off (including `DEC-13 Stage 2`).

---

## 1. Mission and Entry Prerequisites

`M02` implements the authoritative **Python 3.12 Deterministic 2D Fashion & Computational Geometry Engine** (`services/geometry-engine/`). It replaces all client-side TypeScript geometry drafting, offsetting, and grading with mathematically certified algorithms governed by `ADR-003` and `ADR-009` (`R2.1.2-R1`).

### 1.1 Hard Entry Prerequisites (`Gate Auth-2`)
`M02` cannot start until:
1. `M00` (`M00.1`–`M00.10`) is 100% complete, including the executed `IntervalLibraryQualificationReport` and 100% pass of the `C1-Cert` oracle across the **17-Family Adversarial Geometry Test Matrix (`AG-01`–`AG-17`)**.
2. The Project Owner signs off at **`Gate Auth-2`**, including **`DEC-13 Stage 2`** (Production Interval Library Adoption), **`DEC-06`** (`M02h` 2D Nesting Engine), and **`DEC-11`** (Two-Tier Paired Seam Tolerance Reconciliation: `0.05 cm` CAD vs. `0.20 cm` Sewn).

---

## 2. Sub-Workload Architecture (`M02a` through `M02h`)

### `M02a` — Anthropometric Intake, Plausibility Bounds & Body Manifold (`BodyProfile`)
* Validates 14+ core anthropometric measurements (bust, waist, hip, neck circumference, across back, front/back waist length, shoulder slope, armscye depth, crotch depth, inseam, outseam) against anatomical ratio invariants and covariance bounds.
* Rejects physically impossible combinations with structured diagnostic codes before drafting begins.

### `M02b` — Parametric Block Construction (`Bodice`, `Sleeve`, `Skirt`, `Trouser`)
* Synthesizes canonical 2D sloper blocks in the right-handed $(x, y)$ plane (`cm`), enforcing **CCW** winding on exterior piece contours and **CW** winding on internal cutouts (`ADR-009 §1.1`).
* Eliminates all legacy chord-length approximations in favor of exact cubic Bezier curve primitives $\mathbf{B}(t) = (x(t), y(t))$ ($t \in [0, 1]$).

### `M02c` — Adaptive Gauss-Legendre Arc-Length & Monotone Brent Inversion Kernel
* **Forward Arc-Length:** Recursive dyadic 5-point Gauss-Legendre quadrature achieving $|L_{\mathrm{fast}}(t) - L_{\mathrm{cert}}(t)| \le 10^{-6}\text{ cm}$ (`10 nm`).
* **Inverse Arc-Length ($s \mapsto t$):** Monotone Newton-Raphson with bracketed Brent fallback achieving $|L(t^*) - s_{\mathrm{target}}| \le 10^{-7}\text{ cm}$ (`1 nm`) and enforcing the dual parameter/physical stopping criterion ($\delta_t \le 10^{-12}$ AND $\Delta_{\mathrm{pos}}([t]) = \sup_{\tau \in [t]} \|\mathbf{B}'(\tau)\|\,\delta_t \le 10^{-7}\text{ cm}$, `ADR-009 §4.1`).

### `M02d` — Continuous Anthropometric Grading & Dart Manipulation Engine
* Executes continuous vector grading across size manifolds and topological dart rotation/transfer (slash-and-spread equivalence) while preserving boundary arc lengths and re-walking mated seams.

### `M02e` — Certified Offset Curve Synthesis, Singularity Classification & Seam Allowance Trimming (`ADR-009`)
`M02e` implements the dual-tier `C1-Fast` + `C1-Cert` offset architecture specified in `ADR-009` (`R2.1.2-R1`):
1. **First-Principles Signed Normal Offset Equation (`ADR-009 §1.1–§1.3`):**
   * On a **CCW exterior boundary**, the left-hand unit normal $\mathbf{N}_+(t) = \frac{(-y'(t), x'(t))}{\sqrt{Q(t)}}$ points **inward** and $-\mathbf{N}_+(t)$ points **outward**.
   * By Frenet-Serret differentiation, $\mathbf{N}_+'(t) = -\kappa(t)\mathbf{B}'(t)$, so the signed offset curve $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$ ($d > 0$, $s = +1$ inward, $s = -1$ outward) has exact derivative:
     $$\mathbf{O}'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t) = f(t)\,\mathbf{B}'(t), \qquad \kappa(t) = \frac{C(t)}{Q(t)^{3/2}}$$
2. **5-Way $Q(t^*)=0$ Base-Curve Singularity Classification (`ADR-009 §2.2`):**
   * Before solving $P_{\mathrm{cusp}}(t) = Q(t)^3 - d^2 C(t)^2 = 0$, `M02e` checks whether $Q(t) = x'(t)^2 + y'(t)^2$ vanishes or approaches zero ($\min Q \le 10^{-8} \max Q$).
   * If $Q(t^*) = 0$, `M02e` escalates to `C1-Cert` and inspects the Taylor/Puiseux expansion orders $(m, n)$:
     * **Odd multiplicity $m$ with continuous tangent (e.g., $\mathbf{B}(t) = (t^3, 0)$ at $t = 0$, `AG-11`):** Classified as **`Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY`**, reparameterized into an arc-length-regular curve ($Q(u) > 0$), and offset smoothly **without false-positive cusp rejection**.
     * **Even multiplicity $m$ with tangent reversal $\mathbf{T}(t^{*+}) = -\mathbf{T}(t^{*-})$ (e.g., $\mathbf{B}(t) = (t^2, t^3)$ at $t = 0$, `AG-09`):** Classified as **`Category 2a: ACTUAL_ZERO_SPEED_CUSP`**.
3. **6-Category Offset Classification & Trimming (`ADR-009 §3`):**
   * Classifies every segment into `Category 1` (`CERTIFIED_REGULAR`), `Category 2a` (`ACTUAL_ZERO_SPEED_CUSP`), `Category 2b` (`ACTUAL_CURVATURE_CUSP`), `Category 2c` (`REMOVABLE_PARAMETERIZATION_DEGENERACY`), `Category 3` (`TANGENTIAL_CUSP_DEGENERACY`), or `Category 4` (`SELF_INTERSECTING_NON_LOCAL`).
   * Fits piecewise cubic Bezier segments to `Category 1` (and reparameterized `Category 2c`) curves with dense-grid error $E_{\mathrm{grid}} \le 0.005\text{ cm}$ (`0.05 mm`), certified interval bound $E_{\mathrm{cert}} \le 0.010\text{ cm}$ (`0.10 mm` over $N_{\mathrm{cert}} \ge 256$ sub-intervals), and $G^1$ join continuity $\le 0.05^\circ$.
   * Trims local cusp swallowtails (`Category 2b`) and global self-intersection loops (`Category 4`) and synthesizes exact miter, bevel, or round corner joins.

### `M02f` — Paired Seam Walking, Ease Distribution & Notch Anchoring
* Walks mated seam edges $(e_A, e_B)$ using `M02c` arc-length integrals and enforces **Tier 1 CAD Seam Length Parity (`DEC-11`)**:
  $$\bigl|L_{\mathrm{CAD}}(e_A) - L_{\mathrm{CAD}}(e_B) - \Delta_{\mathrm{ease}}\bigr| \le 0.05\text{ cm} \quad (0.5\text{ mm})$$
* Anchors orthogonal V-notches, T-notches, and slit notches at exact arc-length coordinates ($\le 10^{-7}\text{ cm}$ error).

### `M02g` — Grainline, Drill-Hole & Internal Cutout Topology Validator
* Enforces exact polygon boolean predicates (`ADR-003 §2.4`), guaranteeing closed exterior rings ($\le 10^{-6}\text{ cm}$), zero self-intersections, and strict interior containment of grainlines (`Layer 7`) and drill holes (`Layer 2`).

### `M02h` — Deterministic 2D Marker Nesting Engine (`DEC-06`)
* Nests approved cut-boundary polygons (`Layer 1`) onto fabric roll widths using the `DEC-06` NFP solver, enforcing strict grainline tilt bounds ($\pm 0.5^\circ$ for wovens), nap direction rules, and minimum CNC cutter buffer spacing ($0.20\text{ cm}$).
