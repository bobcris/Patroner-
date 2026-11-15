# ADR-009 — NUMERICAL CERTIFICATION & COMPLETE-INTERVAL OFFSET VERIFICATION

- **ADR ID:** `ADR-009`
- **Revision:** `2.1` (Controlled Architecture, Dependency, Numerical Assurance & Release-Governance Correction)
- **Status:** `PROPOSED — Requires Engineering & Computational Geometry Governance Approval (DEC-11, DEC-13)`
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05`, `Ch. 07`, `App. F`), `Dossier 03 v5.1` (Geometry Kernel), `Dossier 13 v5.11` (Manufacturing Output), Phase E2 & E3 Mathematical Audit Reports (`DEF-M00-01`–`DEF-M00-06`), `REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`, `ADR-003`

---

## 1. Context & Problem Statement
In computational pattern engineering and automated cutting-room preparation (`M02a`–`M02h`, `M05`), two recurring mathematical vulnerabilities appeared in both the existing TypeScript prototype (`src/engine/*`) and earlier specification drafts:

1. **Conflation of Numerical Assurance Concepts (`Correction 04`, `§6`):**
   - Previous specifications and tests frequently conflated a high-precision oracle evaluation ($X_{\text{ref}}$), an observed floating-point implementation discrepancy ($E_{\text{impl}}$), an a posteriori quadrature heuristic ($|I_{16} - I_8|$), and a garment engineering acceptance tolerance ($\tau_{\text{domain}}$).
   - Specifically, $|I_{16} - I_8|$ is an *asymptotic error estimate*, not a rigorous upper bound on $|I_{16}^{\text{float64}} - I_{\text{exact}}|$ when the integrand has near-vanishing speed $\|\mathbf{B}'(t)\| \to 0$ (which breaks derivative smoothness of $\sqrt{x'(t)^2 + y'(t)^2}$) or when IEEE 754 `float64` rounding error dominates on tiny sub-segments.

2. **Insufficiency of Finite Point Sampling for Offset Curve Regularity & Self-Intersection (`Correction 05`, `§7`):**
   - Sampling an offset curve $\mathbf{O}(t) = \mathbf{B}(t) + s \cdot d \cdot \hat{\mathbf{n}}(t)$ at 3 points (`DEF-M00-02`) or even at 65 Gauss–Lobatto nodes + analytical extrema of $\kappa'(t)=0$ is a **finite point test**, not a complete-interval proof over $t \in [0, 1]$:
     - Computing roots of $\kappa'(t) = 0$ in `float64` requires solving a degree-7 rational numerator polynomial whose roots can suffer from floating-point conditioning error or miss sharp high-curvature spikes on near-degenerate cubic segments;
     - Pointwise checks do not bound the minimum regular speed or maximum curvature **between** sample nodes; and
     - Pointwise cusp absence does not prevent **global or local self-intersection** ($\mathbf{O}(t_1) = \mathbf{O}(t_2)$ for $t_1 \neq t_2$) or piece-level loop collisions after corner miter/trim transitions.

---

## 2. Decision Part I — Four-Concept Numerical Assurance Separation & Certified Error Bounds (`Correction 04`)

Every numerical operator in `services/fashion-engine` (`M02a`–`M02h`, `M05`) and its corresponding test oracle (`services/fashion-engine/tests/oracles/oracle_geometry_mpmath.py`) must explicitly distinguish and report four separate quantities:

| # | Numerical Concept | Symbol | Definition & Role |
|---|---|---|---|
| **1** | **High-Precision Reference Value** | $X_{\text{ref}}$ | Value computed independently in Python using `mpmath` arbitrary-precision arithmetic (`mp.dps = 80`, ~265-bit significand) with adaptive Gauss–Kronrod / tanh-sinh quadrature (`mpmath.quad(..., maxdegree=10)`) or exact symbolic polynomial integration (`SymPy`). Used in CI/audit verification (`oracle_geometry_mpmath.py`). |
| **2** | **Floating-Point Implementation Error** | $E_{\text{impl}}$ | The true discrepancy between the `float64` production runtime output $X_{\text{float64}}$ and the 80-digit reference value: $E_{\text{impl}} = \|X_{\text{float64}} - X_{\text{ref}}\|$. |
| **3** | **Certified / Rigorously Justified Numerical Error Bound** | $B_{\text{cert}}$ | A deterministic upper bound returned at runtime by the `float64` algorithm that is mathematically guaranteed (under explicitly verified domain regularity preconditions) to satisfy $E_{\text{impl}} \le B_{\text{cert}}$. |
| **4** | **Domain Acceptance Tolerance** | $\tau_{\text{domain}}$ | The maximum permissible error for garment engineering and cutting-room safety (`REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`). Every operation must satisfy $B_{\text{cert}} \le \tau_{\text{domain}}$. |

### 2.1 Three Certified Bound Construction Methods (`Method C1`, `Method C2`, `Method C3`)
To ensure $B_{\text{cert}}$ is never an unjustified heuristic:
1. **`Method C1` — Adaptive Gauss–Legendre Quadrature with Regularity Precondition & Higham Rounding Bound (`Arc Length`):**
   - **Precondition:** For every subdivided cubic Bézier sub-segment $\mathbf{B}_k(u)$ ($u \in [0, 1]$), the Bernstein control polygon of $\|\mathbf{B}_k'(u)\|^2$ must be strictly bounded away from zero:
     $$v_{\min, k}^2 = \min_{0 \le j \le 4} b_j^{(k)} \ge v_{\text{floor}}^2 > 0 \quad (v_{\text{floor}} = 10^{-4}\text{ cm})$$
     ensuring $f_k(u) = \|\mathbf{B}_k'(u)\|$ is $C^\infty([0, 1])$ with bounded higher derivatives. Any sub-segment violating $v_{\min, k} \ge v_{\text{floor}}$ is subdivided at its minimum-speed parameter or rejected as degenerate (`ADR-009 §3`).
   - **Certified Bound Formula:**
     $$B_{\text{cert}}(L) = \sum_{k=1}^{M} \left( S_{\text{safety}} \cdot |I_{16, k} - I_{8, k}| + 32 \cdot u_{64} \cdot I_{16, k} \right) + M \cdot u_{64} \cdot L_{\text{total}}$$
     where $S_{\text{safety}} = 16.0$ (validated against Peano kernel remainder bounds for regular cubics with aspect ratio bounded by adaptive subdivision depth $d \le 12$) and $u_{64} = 2^{-53} \approx 1.11 \times 10^{-16}$ is the IEEE 754 `float64` unit roundoff (Higham *Accuracy and Stability of Numerical Algorithms*).
2. **`Method C2` — Exact Polynomial Green's Theorem Integration with Compensated Summation Rounding Bound (`Contour Area`):**
   - For line segments and cubic Bézier segments, Green's line integral $\frac{1}{2}\oint (x\,dy - y\,dx)$ is a degree-5 polynomial in $t$ whose exact integral over $[0, 1]$ has **zero quadrature truncation error** ($E_{\text{trunc}} = 0$) and reduces to a closed-form bilinear combination of control points with rational weights $c_{ij} \in \{1/20, 3/20, 3/10, \dots\}$.
   - Evaluating the bilinear form using Neumaier compensated summation (`math.fsum`) yields the certified rounding bound:
     $$B_{\text{cert}}(A) = \gamma_{64} \cdot \sum_{k=1}^{N_{\text{seg}}} \sum_{i,j} |c_{ij}| \cdot |x_{k,i} y_{k,j}|, \quad \gamma_{64} = \frac{64 u_{64}}{1 - 64 u_{64}}$$
3. **`Method C3` — Bernstein Convex-Hull & Interval Arithmetic Enclosure (`mpmath.iv`) (`Subdivision, Projection, Offset Regularity, Curvature, Intersections`):**
   - Polynomials in Bernstein basis $P(t) = \sum_{i=0}^n b_i B_i^n(t)$ satisfy the exact convex-hull enclosure $\min_i b_i \le P(t) \le \max_i b_i$ for all $t \in [0, 1]$.
   - Combining Bernstein subdivision with outwardly rounded IEEE 754 interval arithmetic (`mpmath.iv`) yields rigorous interval enclosures $[\underline{x}, \overline{x}]$ over every parameter sub-interval $[a, b] \subseteq [0, 1]$ with certified half-width $B_{\text{cert}} = \frac{1}{2}(\overline{x} - \underline{x})$.

The complete 10-column Mathematical Assurance Matrix across all 8 mathematical domains is normatively specified in [`04_MIGRATION_AND_PARITY_POLICY.md §4.2`](../04_MIGRATION_AND_PARITY_POLICY.md).

---

## 3. Decision Part II — Complete Parameter-Interval ($t \in [0, 1]$) Offset Regularity & Self-Intersection Verification (`Correction 05`)

Let $\mathbf{B}(t) = (x(t), y(t))$ be a cubic Bézier curve on $t \in [0, 1]$ with derivative $\mathbf{B}'(t) = (x'(t), y'(t))$ (degree 2), second derivative $\mathbf{B}''(t) = (x''(t), y''(t))$ (degree 1), signed cross product:
$$C(t) = x'(t)y''(t) - y'(t)x''(t) \quad (\text{degree } 2\text{ polynomial})$$
and squared speed:
$$Q(t) = \|\mathbf{B}'(t)\|^2 = x'(t)^2 + y'(t)^2 \quad (\text{degree } 4\text{ polynomial})$$

For an offset distance $d > 0$ and orientation sign $s \in \{-1, +1\}$ (where $\hat{\mathbf{n}}(t) = s \cdot (-y'(t), x'(t)) / \sqrt{Q(t)}$), the exact offset curve is:
$$\mathbf{O}(t) = \mathbf{B}(t) + s \cdot d \cdot \hat{\mathbf{n}}(t)$$
and its tangent vector satisfies:
$$\mathbf{O}'(t) = \bigl(1 + s \cdot d \cdot \kappa(t)\bigr)\,\mathbf{B}'(t), \quad \text{where } \kappa(t) = \frac{C(t)}{Q(t)^{3/2}}$$

### 3.1 Exact Algebraic Equivalence of Complete-Interval Regularity ($t \in [0, 1]$)
An offset segment $\mathbf{O}(t)$ is **strictly regular, cusp-free, and free of tangent reversal on the entire closed interval $t \in [0, 1]$** if and only if:
$$\forall t \in [0, 1]: \quad Q(t) > 0 \quad \text{and} \quad 1 + s \cdot d \cdot \kappa(t) \ge \varepsilon_{\text{cusp}} > 0 \quad (\varepsilon_{\text{cusp}} = 0.05)$$
Letting $\alpha = 1 - \varepsilon_{\text{cusp}} = 0.95 > 0$, the condition $1 + s \cdot d \cdot \frac{C(t)}{Q(t)^{3/2}} \ge \varepsilon_{\text{cusp}}$ is equivalent to:
$$s \cdot d \cdot C(t) \ge -\alpha \, Q(t)^{3/2} \quad \forall t \in [0, 1]$$
- Whenever $s \cdot d \cdot C(t) \ge 0$ (convex offset direction), the inequality holds automatically for all $t$ where $Q(t) > 0$.
- Whenever $s \cdot d \cdot C(t) < 0$ (concave offset direction where cusps can occur), squaring both sides yields the **exact degree-6 polynomial positivity condition**:
  $$P_{\text{cusp}}(t) := \alpha^2 \, Q(t)^3 - d^2 \, C(t)^2 \ge 0 \quad \forall t \in [0, 1]$$

### 3.2 Two-Stage Verification Architecture (`Stage 1` Fast Screen vs. `Stage 2` Complete-Interval Proof)

#### Stage 1 — Fast Detection Heuristic (`Screening Only — Never Sufficient for Acceptance`)
- Evaluate $Q(t_j)$ and $1 + s \cdot d \cdot \kappa(t_j)$ at the 65 Gauss–Lobatto nodes $t_j \in [0, 1]$.
- **Role:** If any node violates $Q(t_j) \ge v_{\text{floor}}^2$ or $1 + s \cdot d \cdot \kappa(t_j) \ge \varepsilon_{\text{cusp}}$, immediately trigger adaptive subdivision/trimming without waiting for polynomial expansion.
- **Hard Rule:** Passing Stage 1 **never** certifies an offset segment; every candidate segment that passes Stage 1 must pass Stage 2 before acceptance.

#### Stage 2 — Proof-Quality Complete-Interval Certification (`Bernstein Bounds + mpmath.iv Interval Arithmetic`)
1. **Step 2A — Complete-Interval Base Speed Certification ($Q(t) > 0, \forall t \in [0, 1]$):**
   - Convert $Q(t) = x'(t)^2 + y'(t)^2$ into its exact degree-4 Bernstein basis representation $Q(t) = \sum_{i=0}^4 q_i B_i^4(t)$ using outward-rounded interval arithmetic (`mpmath.iv`).
   - If $\min_{0 \le i \le 4} \underline{q_i} \ge v_{\text{floor}}^2$, then by the Bernstein convex-hull property $Q(t) \ge v_{\text{floor}}^2 > 0$ is **proven for all $t \in [0, 1]$**.
   - Otherwise, recursively bisect $[a, b]$ via De Casteljau subdivision (`max_depth = 20`) until every sub-interval is certified or an interval with $\overline{Q([a,b])} < v_{\text{floor}}^2$ is isolated (rejected as a degenerate base curve cusp/stationary point).
2. **Step 2B — Complete-Interval Cusp & Tangent-Reversal Absence Certification ($\forall t \in [0, 1]$):**
   - Convert $S(t) = s \cdot d \cdot C(t)$ (degree 2) and $P_{\text{cusp}}(t) = \alpha^2 Q(t)^3 - d^2 C(t)^2$ (degree 6) into their exact Bernstein representations over $[0, 1]$ using `mpmath.iv`:
     $$S(t) = \sum_{i=0}^2 s_i B_i^2(t), \quad P_{\text{cusp}}(t) = \sum_{i=0}^6 p_i B_i^6(t)$$
   - **Sufficient Certificate 1 (Purely Convex Offset):** If $\min_{0 \le i \le 2} \underline{s_i} \ge 0$, the offset is convex over the entire interval $[0, 1]$ and $1 + s \cdot d \cdot \kappa(t) \ge 1 > \varepsilon_{\text{cusp}}$ is **proven for all $t \in [0, 1]$**.
   - **Sufficient Certificate 2 (Bounded Concave Curvature):** If $\min_{0 \le i \le 6} \underline{p_i} \ge 0$ and Step 2A holds, then wherever $S(t) < 0$, $\alpha^2 Q(t)^3 \ge d^2 C(t)^2 \implies 1 + s \cdot d \cdot \kappa(t) \ge \varepsilon_{\text{cusp}}$ is **proven for all $t \in [0, 1]$**.
   - **Recursive Interval Bisection (`Branch-and-Bound`):** If neither certificate holds on the current interval $[a, b]$ (because Bernstein bounds are conservative), bisect $[a, b] \to [a, m], [m, b]$ using De Casteljau subdivision of the Bernstein coefficients.
     - If on any sub-interval $[a, b]$, $\max_i \overline{s_i} < 0$ and $\max_i \overline{p_i} < 0$, a genuine interior cusp or tangent reversal is **proven to exist** in $[a, b]$.
     - If recursion reaches $\text{depth} = 20$ ($\Delta t = 2^{-20} < 10^{-6}$) without certifying $\min_i \underline{p_i} \ge 0$, evaluate the interval enclosure $I_{\text{reg}}([a,b]) = 1 + s \cdot d \cdot \frac{C([a,b])}{Q([a,b])^{3/2}}$ directly in `mpmath.iv`. Any sub-interval where $\underline{I_{\text{reg}}([a,b])} < \varepsilon_{\text{cusp}}$ is rejected as a cusp/near-cusp and routed to exact trimming (`Step 2D`).
3. **Step 2C — Complete-Interval Approximation Deviation Certification ($\delta_{\max} \le 0.01\text{ cm}$):**
   - For each fitted cubic Bézier offset sub-segment $\tilde{\mathbf{O}}_k(u)$ approximating the true offset $\mathbf{O}(t)$ on $[t_{k-1}, t_k]$, bound the normal deviation $\|\tilde{\mathbf{O}}_k(u) - \mathbf{O}(t(u))\|$ using `mpmath.iv` interval enclosure and 17-point Gauss–Lobatto + Bernstein derivative bounds. If the upper bound exceeds $\tau_{\text{offset}} = 0.01\text{ cm}$, bisect $[t_{k-1}, t_k]$ and refit until certified.
4. **Step 2D — Corner / Miter Transition & Local/Global Self-Intersection Trimming (`M02f`):**
   - **Corner & Miter Transitions:** At $G^0$ corners between adjacent contour segments with interior angle $\theta$:
     - If $\theta \ge \theta_{\text{miter\_min}} = 30^\circ$ ($0.5236\text{ rad}$) and miter spike ratio $L_{\text{miter}} / d = \csc(\theta/2) \le 3.86$, construct an exact tangential miter join;
     - If $\theta < 30^\circ$ (acute dart apex or sharp notch corner), automatically transition to a **squared bevel join** at distance $d$ to prevent runaway miter spikes.
   - **Complete Contour Self-Intersection Elimination:**
     - **Local Cusp Loop Removal:** When Step 2B detects a concave cusp interval $[t_{\text{entry}}, t_{\text{exit}}]$ where $1 + s \cdot d \cdot \kappa(t) < \varepsilon_{\text{cusp}}$, isolate the self-intersection parameters $(t_1^*, t_2^*)$ with $t_1^* < t_{\text{entry}} < t_{\text{exit}} < t_2^*$ where $\mathbf{O}(t_1^*) = \mathbf{O}(t_2^*)$ using 2D Bernstein bezier-clipping + interval Krawczyk root isolation, split the offset contour at $(t_1^*, t_2^*)$, and discard the inverted interior loop $[t_1^*, t_2^*]$.
     - **Global Contour Self-Intersection Audit:** Build an R-tree (`STRtree`) over the Bernstein convex-hull bounding boxes of all offset sub-segments $\{1, \dots, N\}$ of the closed cut contour. For every non-adjacent pair $(i, j)$ with overlapping boxes (and adjacent pairs outside their shared endpoint), run 2D Bézier clipping + interval Krawczyk verification. A cut contour is certified (`self_intersection_count == 0`, winding number $+1$ on exterior, $-1$ on internal cutouts) **only if zero non-endpoint intersections exist across the entire closed boundary**.

---

## 4. Consequences & Enforcement
- **Positive:** Replaces heuristic finite-point offset checking with a mathematically complete interval proof over $t \in [0, 1]$, guarantees that every reported numerical error bound $B_{\text{cert}}$ is rigorously justified (`Method C1/C2/C3`), and eliminates hidden interior cusps and self-intersections (`DEF-M00-01`, `DEF-M00-02` permanently closed).
- **Enforcement (`AC-03`, `AC-05`, `AC-10`):** Enforced by `services/fashion-engine/app/geometry_core/offset_verifier.py` and verified in CI by `test_offset_interval_certification.py` and `oracle_geometry_mpmath.py`.
