# ADR-003: Deterministic Geometry, Exact Topology & Manufacturing Safety Gates

| Metadata | Value |
| :--- | :--- |
| **ADR ID** | `ADR-003` |
| **Title** | Deterministic Geometry, Exact Topology, and Manufacturing Safety Gates |
| **Status** | **PROPOSED — REQUIRES OWNER SIGN-OFF AT GATE AUTH-1** (Updated in Blueprint Revision 2.1.2-R1) |
| **Date** | 2026-04-20 |
| **Governing Sources** | Monograph v5.16 (Part I §2–§3, Part II §4–§7); Addendum v4.1 (§3–§4, §6); Specialist Dossiers 01, 03, 04, 06, 07, 15; `ADR-009` (Numerical Certification & Offset Verification) |
| **Impacted Workloads** | `M00` (`M00.2`, `M00.4`, `M00.10`), `M02` (`M02a`–`M02h`), `M05` (`M05.1`–`M05.5`) |
| **Supersedes / Corrects** | Naive Bezier control-polygon offsetting; unverified arc-length quadrature; floating-point tolerance clipping (`epsilon`-hacking); conflation of curve parameter uncertainty with Euclidean geometric error; unseparated `Q(t*)=0` base-curve singularities (`R2.1.2`) |

---

## 1. Context and Problem Statement

Apparel pattern engineering is a physical manufacturing discipline where geometric errors translate directly into spoiled fabric, jammed CNC cutting heads, mismatched seams on the sewing floor, and ill-fitting garments. Across the legacy prototype (`src/services/patternEngine.ts`, `seamAllowance.ts`, `dxfExporter.ts`) and earlier planning drafts, five systemic geometric vulnerabilities exist:

1. **Inexact Arc-Length Parameterization:** Parametric cubic Bezier curves $\mathbf{B}(t) = (x(t), y(t))$ for $t \in [0, 1]$ do not have closed-form algebraic arc-length functions $s(t) = \int_0^t \|\mathbf{B}'(u)\|\,du$. Fixed-step polygonal sampling or unverified Gaussian quadrature introduces cumulative drift in seam matching, notch placement, and ease distribution.
2. **Naive Offset Approximation & Sign Ambiguity:** The exact offset of a cubic Bezier curve at distance $d > 0$ along the signed unit normal $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$ is generally a 10th-degree algebraic curve that cannot be represented exactly as a single cubic Bezier segment. Simply offsetting the four control points $\mathbf{P}_0, \mathbf{P}_1, \mathbf{P}_2, \mathbf{P}_3$ fails catastrophically in regions of high curvature, and reversing the Frenet-Serret normal derivative sign ($\mathbf{N}_+'(t) = -\kappa(t)\mathbf{B}'(t)$) inverts inward vs. outward cusp detection on convex vs. concave contours.
3. **Conflation of Parameter Uncertainty with Geometric Error:** Using a raw parameter interval width $\mathrm{wid}([t]) \le 10^{-12}$ as a proxy for geometric accuracy fails near high-speed segments ($\|\mathbf{B}'(t)\| \gg 1$) and near base-curve speed degeneracies ($Q(t) = \|\mathbf{B}'(t)\|^2 \to 0$). Moreover, treating every point with $Q(t^*) = 0$ as a geometric cusp misclassifies removable parameterization degeneracies (such as $\mathbf{B}(t) = (t^3, 0)$ at $t = 0$, which traces a smooth straight line with regular tangent $\hat{\mathbf{T}} = (1, 0)$ and $\kappa = 0$) as hard manufacturing failures.
4. **Topological Fragility in Boolean Operations:** Floating-point polygon clipping without exact orient2d/intersection predicates produces micro-slivers, self-intersecting loops, and open boundary contours when trimming seam allowances or cutting darts.
5. **Uncertified DXF-AAMA / ASTM Export:** Emitting CAD files without an independent round-trip geometric and topological validator risks delivering malformed patterns to industrial plotters and automated cutters.

> **Governance & Authorization Boundary (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 2. Decision

We mandate a **Deterministic Computational Geometry Architecture** enforced by five non-negotiable engineering invariants across `M00`, `M02`, and `M05`, governed mathematically by `ADR-009` (`R2.1.2-R1`):

### 2.1 Invariant 1: Adaptive Gauss-Legendre Arc-Length with Monotone Brent Inversion
* **Forward Arc-Length Integration:** All parametric curve lengths $L(t) = \int_0^t \sqrt{x'(u)^2 + y'(u)^2}\,du$ must be computed via **5-point Gauss-Legendre quadrature** with recursive dyadic subdivision on $[0, 1]$ until the local panel error satisfies $|I_{\text{coarse}} - (I_{\text{left}} + I_{\text{right}})| \le 10^{-9}\text{ cm}$ and cumulative global curve length error is strictly $\le 10^{-6}\text{ cm}$ (`10 nm`).
* **Inverse Arc-Length Mapping ($s \mapsto t$):** Finding the curve parameter $t \in [0, 1]$ corresponding to a target physical distance $s \in [0, L]$ (required for exact notch placement and seam walking) must use **monotone Newton-Raphson with Brent's method fallback** (`brentq`), guaranteed to bracket $[0, 1]$ and converge to $|L(t) - s| \le 10^{-7}\text{ cm}$.

### 2.2 Invariant 2: Exact Offset Curve Formulation, First-Principles Derivative Sign & 5-Way $Q(t^*)=0$ Singularity Distinction
Let $\mathbf{B}(t) = (x(t), y(t))$ be a planar cubic Bezier curve on $t \in [0, 1]$, with squared speed $Q(t) = x'(t)^2 + y'(t)^2$ (degree $\le 4$) and planar cross-product $C(t) = x'(t)y''(t) - y'(t)x''(t)$ (degree $\le 2$).

1. **Canonical Orientation & Normal Convention (`ADR-009 §1.1`):**
   * **Exterior piece boundaries** are oriented **counter-clockwise (CCW)** in the right-handed $(x, y)$ plane; **interior cutouts** are oriented **clockwise (CW)**.
   * For any regular point ($Q(t) > 0$), the unit tangent and left-hand unit normal are:
     $$\mathbf{T}(t) = \frac{(x'(t),\, y'(t))}{\sqrt{Q(t)}}, \qquad \mathbf{N}_+(t) = R_{+\pi/2}\mathbf{T}(t) = \frac{(-y'(t),\, x'(t))}{\sqrt{Q(t)}}$$
     On a **CCW exterior boundary**, $\mathbf{N}_+(t)$ points **inward** (into the garment piece interior) and $-\mathbf{N}_+(t)$ points **outward** (into the seam allowance margin).
   * The signed planar curvature is $\kappa(t) = \frac{C(t)}{Q(t)^{3/2}}$, where $\kappa(t) > 0$ means turning left (convex on a CCW exterior boundary) and $\kappa(t) < 0$ means turning right (concave on a CCW exterior boundary).
   * By the planar Frenet-Serret differentiation identity (`ADR-009 §1.2`), the derivative of the left unit normal is:
     $$\mathbf{N}_+'(t) = -\kappa(t)\,\|\mathbf{B}'(t)\|\,\mathbf{T}(t) = -\kappa(t)\,\mathbf{B}'(t)$$

2. **Signed Offset Curve and Exact Derivative (`ADR-009 §1.3`):**
   * For offset magnitude $d > 0$ and direction sign $s \in \{+1, -1\}$ ($s = +1$ along $+\mathbf{N}_+(t)$, i.e., **inward** on a CCW exterior contour; $s = -1$ along $-\mathbf{N}_+(t)$, i.e., **outward** on a CCW exterior contour):
     $$\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$$
   * Differentiating with respect to $t$ at any regular point ($Q(t) > 0$) yields:
     $$\mathbf{O}'(t) = \mathbf{B}'(t) + s\,d\,\mathbf{N}_+'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t) = f(t)\,\mathbf{B}'(t)$$
     where the dimensionless offset speed factor is $f(t) = 1 - s\,d\,\kappa(t)$.

3. **Distinguishing Regular Offset Cusps from Base-Curve $Q(t^*) = 0$ Singularities (`ADR-009 §2`):**
   * **Case A — Regular Base Curve ($Q(t) > 0$):** Since $\mathbf{B}'(t) \ne \mathbf{0}$, the offset derivative $\mathbf{O}'(t)$ vanishes if and only if $f(t) = 1 - s\,d\,\kappa(t) = 0 \iff \kappa(t) = \frac{1}{s\,d} = \frac{s}{d}$. Clearing the non-zero radical $Q(t)^{3/2} > 0$ yields the degree-12 polynomial equation:
     $$P_{\mathrm{cusp}}(t) := Q(t)^3 - d^2\,C(t)^2 = 0 \quad \text{subject to the sign filter} \quad s \cdot C(t) > 0$$
     * **Transverse Zero ($f(t^*) = 0, f'(t^*) \ne 0$):** As $t$ crosses $t^*$, $f(t)$ changes sign and $\hat{\mathbf{T}}_{\mathbf{O}}(t) = \operatorname{sgn}(f(t))\,\mathbf{T}(t)$ reverses direction by $\pi$ radians, forming a **true geometric offset cusp** (`Category 2b: ACTUAL_CURVATURE_CUSP`), typically an ordinary $3/2$-power semicubical parabola when $\kappa'(t^*) \ne 0$.
     * **Tangential Zero ($f(t^*) = 0, f'(t^*) = 0$):** $\kappa(t)$ reaches a local extremum equal to $s/d$ without crossing it (`Category 3: TANGENTIAL_CUSP_DEGENERACY`, $4/3$-power singularity if $\kappa''(t^*) \ne 0$, or constant-curvature focal collapse if $\kappa(t) \equiv s/d$ on an interval).
   * **Case B — Base-Curve Speed Vanishes ($Q(t^*) = 0 \implies C(t^*) = 0 \implies P_{\mathrm{cusp}}(t^*) = 0$):** When $\mathbf{B}'(t^*) = \mathbf{0}$, $P_{\mathrm{cusp}}(t^*) = 0$ holds automatically for every $d$, and the naive formulas for $\mathbf{T}(t)$, $\mathbf{N}_+(t)$, and $\kappa(t)$ have $0/0$ indeterminate forms. **A zero of $Q(t)$ is NOT automatically a geometric cusp.** By Taylor/Puiseux expansion $\mathbf{B}(t) - \mathbf{B}(t^*) = \frac{1}{m!}\mathbf{a}_m(t - t^*)^m + \frac{1}{n!}\mathbf{a}_n(t - t^*)^n + \dots$ ($1 \le m < n$, $\mathbf{a}_m \ne \mathbf{0}$), every $Q(t^*) = 0$ root must be classified via its first non-vanishing derivative orders $(m, n)$ (`ADR-009 §2.2`):
     1. **Removable Parameterization Degeneracy ($m$ odd, e.g., $m = 3$, or collinear higher derivatives):** The unit tangent $\lim_{t \to t^*} \frac{\mathbf{B}'(t)}{\|\mathbf{B}'(t)\|} = \operatorname{sgn}(t - t^*)^{m-1}\frac{\mathbf{a}_m}{\|\mathbf{a}_m\|}$ is **continuous** across $t^*$ when $m$ is odd. **Concrete Counterexample (`ADR-009 §2.2`):** $\mathbf{B}(t) = (t^3, 0)$ on $[-1, 1]$ (or $\mathbf{B}(u) = ((2u-1)^3, 0)$ on $[0, 1]$ at $u = 0.5$) has $\mathbf{B}'(0) = (0, 0) \implies Q(0) = 0$, yet traces the straight segment $[-1, 1]$ on the $x$-axis with continuous unit tangent $\mathbf{T}(t) \equiv (1, 0)$, $\mathbf{N}_+(t) \equiv (0, 1)$, and $\kappa(t) \equiv 0$. Its exact offset $\mathbf{O}(t) = (t^3, s\,d)$ is a smooth straight line with **no geometric cusp**.
     2. **True Geometric Base-Curve Cusp / Fold ($m$ even, e.g., $m = 2, n = 3$):** $\operatorname{sgn}(t - t^*)^{m-1}$ changes sign across $t^*$, reversing the unit tangent by $\pi$ radians ($\mathbf{T}(t^{*+}) = -\mathbf{T}(t^{*-})$) and flipping $\mathbf{N}_+(t)$ (`Category 2a: ACTUAL_ZERO_SPEED_CUSP`).
     3. **Endpoint Tangential Degeneracy ($t^* \in \{0, 1\}$, e.g., $\mathbf{P}_1 = \mathbf{P}_0$ or $\mathbf{P}_2 = \mathbf{P}_3$):** One-sided limit exists cleanly via $\mathbf{a}_m / \|\mathbf{a}_m\|$, though limiting curvature may be finite or infinite depending on $n$ vs. $2m$.
     4. **Degenerate Collapsed Segment ($\mathbf{B}'(t) \equiv \mathbf{0}$ on $[0, 1]$):** All four control points coincide; rejected at input validation.

4. **Six Exhaustive Offset Curve Classifications (`ADR-009 §3`):**
   Every candidate offset segment is classified into one of six mutually exclusive categories:
   * `Category 1: CERTIFIED_REGULAR`
   * `Category 2a: ACTUAL_ZERO_SPEED_CUSP` (true geometric base-curve cusp/fold where $Q(t^*)=0$ and unit tangent reverses or limiting curvature blows up)
   * `Category 2b: ACTUAL_CURVATURE_CUSP` (regular base curve $Q(t^*)>0$ with transverse root $f(t^*)=0, f'(t^*)\ne 0$)
   * `Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY` ($Q(t^*)=0$ with continuous limiting unit tangent $\mathbf{T}(t^{*-}) = \mathbf{T}(t^{*+})$ and finite limiting curvature $\kappa_{\lim}$ with $1 - s\,d\,\kappa_{\lim} > 0$; must be reparameterized to an arc-length-regular curve before production export)
   * `Category 3: TANGENTIAL_CUSP_DEGENERACY` (grazing root $f(t^*)=0, f'(t^*)=0$ or near-singular clearance below threshold)
   * `Category 4: SELF_INTERSECTING_NON_LOCAL` (locally regular offset with global loop / self-intersection)

5. **Adaptive Subdivision & Error Bounds (`ADR-009 §4`):**
   * For `Category 1` segments, adaptive de Casteljau subdivision fits cubic Bezier segments until the dense-grid Hausdorff / normal distance $E_{\mathrm{grid}} \le 0.005\text{ cm}$ (`0.05 mm`) and the certified interval bound over $N_{\mathrm{cert}} \ge 256$ sub-intervals satisfies $E_{\mathrm{cert}} \le 0.01\text{ cm}$ (`0.1 mm`), while preserving $G^1$ tangent continuity ($\le 0.05^\circ$).
   * When an outward or inward corner or trimmed cusp (`Category 2b` / `Category 4`) occurs, exact local loop trimming and miter/round join synthesis (`M02e`) are executed using certified root brackets.

### 2.3 Invariant 3: Certified Interval Arithmetic (`C1-Cert`) & Parameter vs. Geometric Error Separation
1. **Strict Separation of Parameter Uncertainty ($\delta_t$) and Geometric Error ($E_{\mathrm{geom}}$) (`ADR-009 §4`):**
   * A parameter interval $[t] = [\underline{t}, \overline{t}]$ has dimensionless width $\delta_t = \overline{t} - \underline{t}$.
   * Its physical position uncertainty is bounded by the first-order Taylor enclosure:
     $$\Delta_{\mathrm{pos}}([t]) \le \sup_{\tau \in [t]} \|\mathbf{B}'(\tau)\| \cdot \delta_t$$
   * Therefore, stopping criteria for root isolation, intersection brackets, and notch placement must enforce **both** a parameter bracket bound ($\delta_t \le 10^{-12}$) **and** a physical Euclidean bound ($\Delta_{\mathrm{pos}}([t]) \le \varepsilon_{\mathrm{pos}} = 10^{-7}\text{ cm}$).
2. **`C1-Cert` Interval Enclosure & Outward Rounding (`ADR-009 §5`):**
   * Standard IEEE-754 `binary64` point evaluation is insufficient for certifying absence of roots or bounding polynomial rounding error near grazing tangencies (`Category 3`).
   * The `C1-Cert` verification oracle uses outward-rounded interval arithmetic ($\nabla$ toward $-\infty$, $\Delta$ toward $+\infty$) together with exact rational ($\mathbb{Q}$) Bernstein-basis sign evaluation (`Fraction`) to certify root isolation and curve clearance.
   * **Candidate Status (`DEC-13`):** `mpmath.iv` (`53-bit` fast screen + `113-bit` quad-precision certification tier) + Python `fractions.Fraction` is designated as the **primary candidate** for the `M00.4` verification oracle (`DEC-13 Stage 1` at `Gate Auth-1`), subject to passing the mandatory `IntervalLibraryQualificationReport` in `M00.4` across the 17-family future adversarial test matrix before production adoption (`DEC-13 Stage 2` at `Gate Auth-2`).

### 2.4 Invariant 4: Exact Topological Predicates & Polygon Clipping
* All 2D polygon boolean operations (seam allowance union, dart cutout subtraction, grainline clipping, piece containment checks) must enforce **Shewchuk-style adaptive precision floating-point predicates** (`orient2d`, `incircle`) or exact integer-lattice coordinate scaling (`1 unit = 1 nm`, 64-bit integer coordinates) to guarantee:
  1. Zero self-intersecting output rings (`is_simple == True`).
  2. Strictly closed exterior contours ($\|\mathbf{P}_{\text{start}} - \mathbf{P}_{\text{end}}\| = 0$ in topological vertex connectivity, $\le 10^{-6}\text{ cm}$ in floating-point coordinates).
  3. Automatic removal of degenerate micro-sliver faces with area $< 10^{-4}\text{ cm}^2$.
  4. Preservation of canonical winding orientation (**CCW** for outer cut/sew boundary, **CW** for internal cutouts/drill holes).

### 2.5 Invariant 5: Independent Manufacturing Gatekeeper (`M05`)
* No pattern piece may be exported to DXF-AAMA, ASTM D6673, SVG, PDF plot, or marker nesting (`M02h`) without passing the deterministic **Pre-Flight Manufacturing Gatekeeper** (`M05.3`):
  1. **Closed-Contour & Winding Verification:** Exterior cut line (`Layer 1`) and sew line (`Layer 8`) must be closed, simple, non-self-intersecting, and canonically oriented.
  2. **Minimum Feature & Tool Clearance Check:** Minimum internal corner radius and notch spacing must exceed CNC knife blade overcut clearance ($r_{\text{min}} \ge 0.15\text{ cm}$ unless explicitly marked as a slit notch).
  3. **Paired Seam Length Parity:** Walked seam lengths between mated edges $(e_A, e_B)$ must satisfy $|L(e_A) - L(e_B) - \Delta_{\text{ease}}| \le 0.05\text{ cm}$ (`0.5 mm`) at the CAD geometry gate (`DEC-11`).
  4. **Grainline & Notch Attachment:** Every piece must contain exactly one valid grainline (`Layer 7`) strictly inside the interior polygon and all required notches (`Layer 4`) anchored orthogonally to the boundary (`|L(t_notch) - s_target| <= 1e-7 cm`).

---

## 3. Consequences and Trade-Offs

* **Positive:**
  * Eliminates silent geometry corruption, inverted outward/inward cusp detection, and false-positive cusp classification on removable parameterization degeneracies ($\mathbf{B}(t) = (t^3, 0)$).
  * Provides mathematically rigorous, machine-checkable pass/fail criteria for `M00.4` (Golden Dataset & Reference Verification Harness), `M02` (Deterministic Fashion Engine), and `M05` (Manufacturing Documentation).
  * Separates candidate selection (`DEC-13 Stage 1`), library qualification (`IntervalLibraryQualificationReport`), oracle implementation verification (`M00.4`/`M00.10`), and production adoption (`DEC-13 Stage 2`).
* **Trade-Offs & Mitigations:**
  * Exact algebraic degree-12 cusp isolation and adaptive Gauss-Legendre integration require more CPU cycles than naive control-polygon offsetting. Running inside the Python 3.12 computational engine (`ADR-001`) with `NumPy`/`SciPy` fast-path + certified interval fallback keeps total pattern draft + seam allowance execution under `< 50 ms` per bodice/trouser block.

---

## 4. Verification and Gate Mapping

* **Gate Auth-1 (Pre-`M00`):** Owner sign-off on `ADR-003`, `ADR-009` (`R2.1.2-R1`), and `DEC-13 Stage 1` candidate selection.
* **Milestone `M00.4` & `M00.10`:** Execution of the `IntervalLibraryQualificationReport` and verification of the `C1-Cert` oracle against the **17-Family Adversarial Geometry Test Matrix** (`AG-01` through `AG-17`, defined in `ADR-009 §6.2`).
* **Gate Auth-2 (Pre-`M01`/`M02`):** Audit of `M00` evidence artifacts and `DEC-13 Stage 2` production adoption sign-off.
