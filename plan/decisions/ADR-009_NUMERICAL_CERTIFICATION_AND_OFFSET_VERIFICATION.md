# ADR-009 — FIVE-CONCEPT NUMERICAL ASSURANCE, METHOD C1 DOWNGRADE, OFFSET FAILURE TAXONOMY & TRI-STATE INTERVAL VERIFICATION (`R2.1.1`)

- **ADR ID:** `ADR-009`
- **Revision:** `2.1.1` (Targeted Numerical Assurance, Migration Boundary & Governance Correction)
- **Status:** `PROPOSED — Requires Engineering & Computational Geometry Governance Approval (DEC-11, DEC-13; Blocks Gate Auth-1 / M00 Start)`
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05`, `Ch. 07`, `App. A2–A3`, `App. F`), `Dossier 03 v5.1` (Deterministic Pattern Geometry), `Dossier 06 v5.4` (Validation & Benchmarks), `Dossier 14 v5.12` (Manufacturing Constraints), Phase E2 & E3 Mathematical Audit Reports (`DEF-M00-01`–`DEF-M00-06`), `REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`, `ADR-003`

---

## 1. Context & Problem Statement (`R2.1` → `R2.1.1` Review Findings)
Independent review of Blueprint Revision `R2.1` (`commit 617cc7f5d9e41b8cd55ed96b64d2363cdb29557b`) identified four mathematical and verification defects in the `R2.1` formulation of `ADR-009`:

1. **Silent Assumption of Zero Reference-Oracle Error (`Correction A`):**
   - `R2.1` defined $E_{\mathrm{impl}} = |X_{\mathrm{float64}} - X_{\mathrm{ref}}|$ (`ADR-009 §2`) while simultaneously treating $E_{\mathrm{impl}} \le B_{\mathrm{cert}}$ as a certified bound against the true mathematical value $X_{\mathrm{exact}}$, silently assuming $|X_{\mathrm{ref}} - X_{\mathrm{exact}}| = 0$.
   - A finite-precision evaluation in `mpmath` (`mp.dps = 80`) is a high-precision numerical approximation, **not** an exact value with zero error unless its own reference-to-exact error $|X_{\mathrm{ref}} - X_{\mathrm{exact}}|$ is rigorously enclosed.
2. **Insufficient Derivation Behind the `Method C1` Certification Claim (`Correction B`):**
   - `R2.1` (`ADR-009 §2.1`) claimed that multiplying the 8-point vs. 16-point Gauss–Legendre quadrature discrepancy $|I_{16,k} - I_{8,k}|$ by a fixed constant $S_{\mathrm{safety}} = 16.0$ at subdivision depth $d \le 12$ yielded a "certified bound" via Peano-kernel remainder bounds.
   - A safety factor is not a mathematical proof. For a cubic Bézier curve $\mathbf{B}(t)$, the speed integrand $f(t) = \sqrt{x'(t)^2 + y'(t)^2}$ has branch-point singularities in the complex plane at the roots of $x'(z)^2 + y'(z)^2 = 0$. When a cubic curve has a tight loop or near-vanishing speed, those complex conjugate singularities approach the real interval $[a, b]$, causing the 16th and 32nd derivatives $f^{(16)}(t)$ and $f^{(32)}(t)$ in the Peano kernel remainder to grow without a uniform bound independent of curve geometry. Moreover, `04_MIGRATION_AND_PARITY_POLICY.md` (`§3`) described a different chord/control-polygon method under the same label `Method C1`.
3. **Conflation of Offset Geometry Failure Categories (`Correction C`):**
   - `R2.1` (`ADR-009 §3.1–§3.2`) treated a violation of the regularity safety margin $1 + s\,d\,\kappa(t) < \varepsilon_{\mathrm{margin}}$ ($\varepsilon_{\mathrm{margin}} = 0.05$) as proof of an actual cusp or tangent reversal, and did not cleanly separate local differential curvature checks from local and global contour self-intersection checks.
4. **Invalid Treatment of Inconclusive Interval Verification at Depth 20 (`Correction D`):**
   - `R2.1` (`ADR-009 §3.2 Step 2B`) stated that if recursion reached $\mathrm{depth} = 20$ and the interval lower bound satisfied $\underline{I_{\mathrm{reg}}([a,b])} < \varepsilon_{\mathrm{cusp}}$, the interval was "rejected as a cusp/near-cusp and routed to exact trimming".
   - In interval arithmetic, $\underline{I([a,b])} < \varepsilon < \overline{I([a,b])}$ means the enclosure **straddles** the threshold due to interval dependency or finite subdivision budget; it does **not** prove that a geometric defect exists on $[a, b]$.

---

## 2. Decision Part I — Reference Oracle Triangle Inequality & Five-Concept Numerical Assurance (`Correction A`)

### 2.1 Explicit Triangle Inequality
For any scalar or vector geometric quantity with true mathematical value $X_{\mathrm{exact}}$, production IEEE 754 `binary64` (`float64`) result $X_{\mathrm{float64}}$, and independent reference result $X_{\mathrm{ref}}$, the true implementation error is governed by the triangle inequality:

$$|X_{\mathrm{float64}} - X_{\mathrm{exact}}| \;\le\; |X_{\mathrm{float64}} - X_{\mathrm{ref}}| \;+\; |X_{\mathrm{ref}} - X_{\mathrm{exact}}|$$

**Mandatory Rule:** The second term $|X_{\mathrm{ref}} - X_{\mathrm{exact}}|$ **must never be silently assumed to be zero**.

### 2.2 Five-Concept Numerical Assurance Taxonomy
Every numerical specification, production validator (`M02a`–`M02h`, `M05`), and independent verification oracle (`M00.4`) must explicitly distinguish five separate quantities:

| # | Numerical Concept | Symbol | Definition & Mathematical Requirement |
| :---: | :--- | :---: | :--- |
| **1** | **High-Precision Reference Result** | $X_{\mathrm{ref}}$ | An independent high-precision numerical approximation (e.g., `mpmath` at `mp.dps = 80` decimal digits). **A high-precision reference result is not automatically a mathematical certificate.** |
| **2** | **Observed Implementation-to-Reference Discrepancy** | $E_{\mathrm{obs}}$ | The measured discrepancy between the production `float64` result and the reference result: $E_{\mathrm{obs}} = |X_{\mathrm{float64}} - X_{\mathrm{ref}}|$. |
| **3** | **Certified Reference-to-Exact Enclosure** | $B_{\mathrm{ref}}$ | A rigorously established upper bound satisfying $|X_{\mathrm{ref}} - X_{\mathrm{exact}}| \le B_{\mathrm{ref}}$, derived via outward-rounded interval arithmetic (`mpmath.iv`), exact rational arithmetic (`fractions.Fraction`), validated interval-Newton / Krawczyk root isolation, or analytically proven remainder bounds. **If $|X_{\mathrm{ref}} - X_{\mathrm{exact}}|$ cannot be bounded rigorously, $B_{\mathrm{ref}}$ is `UNESTABLISHED` and the result must be labeled `HIGH_PRECISION_NUMERICAL_REFERENCE` (`EMPIRICAL_ESTIMATE`), never a `CERTIFIED_BOUND`.** |
| **4** | **Certified Implementation-to-Exact Error Bound** | $B_{\mathrm{cert}}$ | A rigorously justified upper bound on the true implementation error $|X_{\mathrm{float64}} - X_{\mathrm{exact}}| \le B_{\mathrm{cert}}$, established either by:<br>(a) **Direct Runtime Enclosure:** $X_{\mathrm{exact}} \in [\underline{X}, \overline{X}]$ with $B_{\mathrm{cert}} = \max(|X_{\mathrm{float64}} - \underline{X}|, |\overline{X} - X_{\mathrm{float64}}|)$, or<br>(b) **Oracle Triangle Enclosure:** $B_{\mathrm{cert}} = E_{\mathrm{obs}} + B_{\mathrm{ref}}$ where $B_{\mathrm{ref}}$ is rigorously established (with outward IEEE 754 rounding). |
| **5** | **Engineering Acceptance Tolerance** | $\tau_{\mathrm{domain}}$ | The garment-engineering or manufacturing threshold (`REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`). Where certified enclosure is required, acceptance requires $B_{\mathrm{cert}} \le \tau_{\mathrm{domain}}$. |

### 2.3 Evidence Allowed to Establish a Certified Reference Enclosure ($B_{\mathrm{ref}}$)
A reference enclosure $B_{\mathrm{ref}} \ge |X_{\mathrm{ref}} - X_{\mathrm{exact}}|$ may be claimed **only** when supported by one of the following mathematically defensible methods:
1. **Exact Rational Arithmetic (`fractions.Fraction`):** For algebraic polynomial problems with rational/dyadic IEEE 754 `float64` inputs (such as exact degree-5 polynomial Green's theorem contour area on line and cubic Bézier segments), evaluating the exact rational polynomial produces $X_{\mathrm{ref}} = X_{\mathrm{exact}}$ with $B_{\mathrm{ref}} = 0$ (or, when converted to an 80-digit decimal/interval, $B_{\mathrm{ref}} \le \frac{1}{2}\mathrm{ulp}_{80}(X_{\mathrm{ref}})$).
2. **Outward-Rounded Interval Arithmetic (`mpmath.iv`):** Evaluating a monotone or convex-hull-bounded geometric enclosure (such as De Casteljau chord vs. control-polygon arc-length bounds or Bernstein polynomial envelopes) in outward-rounded arbitrary-precision interval arithmetic $[\underline{X}_{\mathrm{ref}}, \overline{X}_{\mathrm{ref}}] \ni X_{\mathrm{exact}}$, setting $X_{\mathrm{ref}} = \mathrm{mid}([\underline{X}_{\mathrm{ref}}, \overline{X}_{\mathrm{ref}}])$ and $B_{\mathrm{ref}} = \mathrm{rad}([\underline{X}_{\mathrm{ref}}, \overline{X}_{\mathrm{ref}}]) = \frac{1}{2}(\overline{X}_{\mathrm{ref}} - \underline{X}_{\mathrm{ref}})$.
3. **Validated Interval Root Isolation (Interval Newton / Krawczyk / Bolzano Sign-Change):** Isolating a simple root $t^* \in [\underline{t}, \overline{t}]$ where $f(\underline{t})\cdot f(\overline{t}) < 0$ in outward-rounded interval arithmetic and the derivative interval $0 \notin f'([\underline{t}, \overline{t}])$, yielding $B_{\mathrm{ref}}(t^*) = \frac{1}{2}(\overline{t} - \underline{t})$.
4. **Unenclosed High-Precision Quadrature (`mpmath.quad` without rigorous remainder bound):** When `mpmath.quad` (`mp.dps = 80`) is used without an interval remainder proof, its heuristic error estimate is recorded as `empirical_reference_error_estimate`, `B_ref` is marked `null` (`UNESTABLISHED`), and the comparison is classified as `HIGH_PRECISION_NUMERICAL_REFERENCE` (`EMPIRICAL_ESTIMATE`) — **never** `CERTIFIED_ENCLOSURE`.

### 2.4 Mandatory Persistence Schema (`NumericalVerificationRecord`)
Every numerical verification result persisted in CI oracle reports (`M00.4`) and runtime validation manifests (`M02`, `M05`) must record:
```json
{
  "quantity_name": "cubic_bezier_arc_length_cm",
  "reference_method_and_version": "mpmath.iv_de_casteljau_chord_polygon_v1 | mpmath.quad_gauss_kronrod_dps80_v1",
  "precision_and_arithmetic_model": "IEEE754_binary64_runtime + mpmath_iv_265bit_outward_interval_oracle",
  "enclosure_or_remainder_method": "METHOD_C1_CERT_CHORD_POLYGON_INTERVAL | METHOD_C1_EST_GAUSS_LEGENDRE_DIFF | METHOD_C2_EXACT_POLYNOMIAL_HIGHAM | METHOD_C3_BERNSTEIN_INTERVAL",
  "assurance_classification": "CERTIFIED_ENCLOSURE | HIGH_PRECISION_NUMERICAL_REFERENCE | CONSERVATIVE_ENGINEERING_ESTIMATE",
  "error_components": {
    "x_float64": 4.859561284190234,
    "x_ref": "4.8595612841902341189...",
    "observed_discrepancy_e_obs": 1.19e-16,
    "reference_enclosure_b_ref": 4.82e-7,
    "implementation_to_exact_bound_b_cert": 4.83e-7,
    "heuristic_error_estimate": 2.57e-5
  },
  "acceptance_tolerance_tau": 1.0e-4,
  "verification_outcome": "CERTIFIED_VALID | CERTIFIED_INVALID | INCONCLUSIVE",
  "reproducibility_manifest": {
    "algorithm_version": "m02a-v2.1.1",
    "python_version": "3.12.x",
    "mpmath_version": "1.3.0",
    "random_seed": 0,
    "input_canonical_sha256": "..."
  }
}
```

---

## 3. Decision Part II — Resolution of `Method C1`: Downgrade of the $S_{\mathrm{safety}} = 16$ Heuristic & Separation from `Method C1-Cert` (`Correction B`)

Per `Correction B (§4)`, `ADR-009` selects **Option 2 (Downgrade the `Method C1` $S_{\mathrm{safety}} = 16.0$ quadrature-difference formula to a `CONSERVATIVE_ENGINEERING_ESTIMATE`)** and resolves the naming discrepancy between `ADR-009` and `04_MIGRATION_AND_PARITY_POLICY.md` by separating `Method C1-Est` from `Method C1-Cert`:

### 3.1 `Method C1-Est` — Adaptive Gauss–Legendre Quadrature Discrepancy (`CONSERVATIVE_ENGINEERING_ESTIMATE` — Downgraded from Certified Claim)
- **Formula:** On a cubic Bézier curve subdivided into $M$ leaf sub-segments ($d \le 12$), let $I_{8,k}$ and $I_{16,k}$ be the 8-point and 16-point Gauss–Legendre approximations of $\int_0^1 \|\mathbf{B}_k'(u)\|\,du$ in `float64`, and define:
  $$E_{\mathrm{est, C1}}(L) = \sum_{k=1}^{M} \left( S_{\mathrm{safety}} \cdot |I_{16, k} - I_{8, k}| + 32 \cdot u_{64} \cdot I_{16, k} \right) + M \cdot u_{64} \cdot L_{\mathrm{total}}, \quad S_{\mathrm{safety}} = 16.0, \; u_{64} = 2^{-53}$$
- **Formal Classification:** **`CONSERVATIVE_ENGINEERING_ESTIMATE`** (`EMPIRICAL_ESTIMATE`).
- **Why It Is Downgraded (No Fabricated Proof):**
  - The difference $|I_{16,k} - I_{8,k}|$ is an a posteriori asymptotic error indicator, not an upper bound on $|I_{16,k} - L_{\mathrm{exact},k}|$.
  - Bounding $|I_{16,k} - L_{\mathrm{exact},k}|$ via the Peano kernel theorem requires bounding $\sup_{u \in [0,1]} |f_k^{(32)}(u)|$ where $f_k(u) = \sqrt{x_k'(u)^2 + y_k'(u)^2}$. Because $f_k(z)$ has branch points in $\mathbb{C}$ wherever $x_k'(z)^2 + y_k'(z)^2 = 0$, the derivatives $f_k^{(2n)}(u)$ scale as $\mathcal{O}((2n)! / \rho^{2n})$ where $\rho$ is the complex Bernstein-ellipse semi-axis distance to the nearest zero of $\|\mathbf{B}_k'(z)\|^2$. No universal constant $S_{\mathrm{safety}} = 16.0$ holds without an explicit complex-plane root-distance bound $\rho$ on every leaf segment.
  - Furthermore, capping adaptive subdivision at $d_{\max} = 12$ can terminate in the pre-asymptotic regime on near-cusp curves.
- **Known Assumptions:** Assumes regular cubic sub-segments where $\|\mathbf{B}_k'(u)\|$ is smooth and complex zeros of $\|\mathbf{B}_k'(z)\|^2$ are well-separated from $[0, 1]$.
- **Validation Evidence:** Empirically validated against 80-digit `mpmath.quad` reference values across the 34 repository curves and 29 Phase E3 adversarial curves (after removing `.toFixed(3)` rounding `DEF-M00-01`).
- **Limitations:** Can underestimate true error if a curve has a tight self-reversing micro-loop or if accidental cancellation occurs between 8-point and 16-point nodes.
- **Prohibited Uses:** `Method C1-Est` **must never** be described as `certified`, `proof`, `mathematically guaranteed`, or `CERTIFIED_ENCLOSURE`.

### 3.2 `Method C1-Cert` — De Casteljau Chord / Control-Polygon Convex-Hull Interval Enclosure (`CERTIFIED_ENCLOSURE`)
- **Mathematical Basis & Complete Derivation:**
  - Let $\mathbf{B}_k(u) = \sum_{j=0}^3 \mathbf{P}_{k,j} B_j^3(u)$ ($u \in [0, 1]$) be the $k$-th cubic Bézier leaf sub-segment obtained by De Casteljau subdivision.
  - By the fundamental triangle inequality for rectifiable curves in $\mathbb{R}^2$, the Euclidean chord length between endpoints is a strict lower bound on exact arc length:
    $$L_{\mathrm{chord}, k} := \|\mathbf{P}_{k,3} - \mathbf{P}_{k,0}\|_2 \;\le\; \int_0^1 \|\mathbf{B}_k'(u)\|_2\,du = L_{\mathrm{exact}}(\mathbf{B}_k)$$
  - Conversely, since $\mathbf{B}_k'(u) = 3 \sum_{j=0}^2 (\mathbf{P}_{k,j+1} - \mathbf{P}_{k,j}) B_j^2(u)$ and the quadratic Bernstein basis functions satisfy $B_j^2(u) \ge 0$ and $\int_0^1 3 B_j^2(u)\,du = 1$ for each $j \in \{0, 1, 2\}$, Minkowski's integral inequality (triangle inequality under the integral sign) yields unconditionally for **every** cubic Bézier curve (with zero regularity, aspect-ratio, or derivative assumptions):
    $$L_{\mathrm{exact}}(\mathbf{B}_k) = \int_0^1 \left\| 3 \sum_{j=0}^2 (\mathbf{P}_{k,j+1} - \mathbf{P}_{k,j}) B_j^2(u) \right\|_2 du \;\le\; \sum_{j=0}^2 \|\mathbf{P}_{k,j+1} - \mathbf{P}_{k,j}\|_2 \int_0^1 3 B_j^2(u)\,du = \sum_{j=0}^2 \|\mathbf{P}_{k,j+1} - \mathbf{P}_{k,j}\|_2 =: L_{\mathrm{poly}, k}$$
  - Evaluating the De Casteljau control points $\mathbf{P}_{k,j}$ and Euclidean norms in outward-rounded interval arithmetic (`mpmath.iv`) produces a rigorous interval $[\underline{L}_{\mathrm{chord}}, \overline{L}_{\mathrm{poly}}]$ satisfying:
    $$\underline{L}_{\mathrm{chord}} := \sum_{k=1}^M \underline{\|\mathbf{P}_{k,3} - \mathbf{P}_{k,0}\|_2} \;\le\; L_{\mathrm{exact}}(\mathbf{B}) \;\le\; \sum_{k=1}^M \sum_{j=0}^2 \overline{\|\mathbf{P}_{k,j+1} - \mathbf{P}_{k,j}\|_2} =: \overline{L}_{\mathrm{poly}}$$
  - Therefore, for any runtime `float64` value $L_{\mathrm{float64}}$, the quantity:
    $$B_{\mathrm{cert, C1-Cert}}(L) := \max\bigl(|L_{\mathrm{float64}} - \underline{L}_{\mathrm{chord}}|, \; |\overline{L}_{\mathrm{poly}} - L_{\mathrm{float64}}|\bigr)$$
    is a **100% mathematically certified upper bound** on $|L_{\mathrm{float64}} - L_{\mathrm{exact}}|$.
- **Subdivision Termination & Tri-State Outcome:** Because $\overline{L}_{\mathrm{poly}} - \underline{L}_{\mathrm{chord}} = \mathcal{O}(h^2)$ on smooth segments of parameter width $h = 2^{-d}$, adaptive bisection terminates with `CERTIFIED_VALID` when $B_{\mathrm{cert, C1-Cert}}(L) \le \tau_{\mathrm{domain}}$. If recursion reaches $d_{\max}$ with $B_{\mathrm{cert, C1-Cert}}(L) > \tau_{\mathrm{domain}}$, the enclosure remains mathematically valid ($L_{\mathrm{exact}} \in [\underline{L}_{\mathrm{chord}}, \overline{L}_{\mathrm{poly}}]$), and the tolerance check returns `INCONCLUSIVE` (`tolerance_achieved: False`, failing closed in downstream gates).

### 3.3 `Method C2` — Exact Algebraic Polynomial Green's Theorem Area + Higham Inner-Product Rounding Bound (`CERTIFIED_ENCLOSURE`)
- For a closed contour of line segments and cubic Bézier curves with IEEE 754 `float64` control points (which are exact dyadic rationals), Green's integral $A_{\mathrm{exact}} = \frac{1}{2}\oint (x\,dy - y\,dx)$ is an **exact degree-5 polynomial** with zero quadrature truncation error.
- **Reference Oracle ($B_{\mathrm{ref}} = 0$):** Evaluating the exact rational bilinear form in Python `fractions.Fraction` yields $A_{\mathrm{ref}} = A_{\mathrm{exact}}$ ($B_{\mathrm{ref}} = 0$).
- **Runtime Bound ($B_{\mathrm{cert}}$):** Shifting coordinates by the contour centroid $\mathbf{c}$ and applying Higham's forward inner-product rounding bound $\gamma_{64} = \frac{64 u_{64}}{1 - 64 u_{64}}$ with outward ULP padding yields a rigorous upper bound $B_{\mathrm{cert}}(A)$ on $|A_{\mathrm{float64}} - A_{\mathrm{exact}}|$.

---

## 4. Decision Part III — Six-Category Offset Geometry Failure Taxonomy (`Correction C`)

### 4.1 Explicit Planar Curve Orientation, Normal & Curvature Sign Conventions
Let $\mathbf{B}(t) = (x(t), y(t))$, $t \in [0, 1]$, be a planar cubic Bézier curve in a right-handed Cartesian coordinate frame $(x, y)$ (where any screen-space $+y$-down contour is explicitly normalized or tagged via `coordinate_convention: "CARTESIAN_RH_CCW"`):
1. **Squared Speed & Unit Tangent:** For $Q(t) := x'(t)^2 + y'(t)^2 > 0$, the unit tangent in the direction of increasing $t$ is $\hat{\mathbf{t}}(t) = (x'(t), y'(t)) / \sqrt{Q(t)}$.
2. **Left-Hand Unit Normal:** $\hat{\mathbf{n}}_+(t) := (-y'(t), x'(t)) / \sqrt{Q(t)}$ (obtained by rotating $\hat{\mathbf{t}}(t)$ by $+90^\circ$ counterclockwise).
3. **Signed Curvature:**
   $$\kappa(t) := \frac{x'(t)y''(t) - y'(t)x''(t)}{Q(t)^{3/2}} = \frac{C(t)}{Q(t)^{3/2}}, \quad C(t) := x'(t)y''(t) - y'(t)x''(t)$$
   so $\kappa(t) > 0$ when $\mathbf{B}(t)$ bends toward $\hat{\mathbf{n}}_+(t)$ (leftward) and $\kappa(t) < 0$ when $\mathbf{B}(t)$ bends toward $-\hat{\mathbf{n}}_+(t)$ (rightward).
4. **Offset Curve & Offset Derivative Identity:** For offset distance $d > 0$ and normal-side sign $s \in \{-1, +1\}$ (for a CCW exterior contour, outward seam allowance has $s = -1$, so $s\,\hat{\mathbf{n}}_+(t)$ points outward):
   $$\mathbf{O}(t) := \mathbf{B}(t) + s \cdot d \cdot \hat{\mathbf{n}}_+(t)$$
   Differentiating with respect to $t$ using the Frenet–Serret relation $\hat{\mathbf{n}}_+'(t) = -\kappa(t)\,\mathbf{B}'(t)$ yields:
   $$\mathbf{O}'(t) = \bigl(1 + s \cdot d \cdot \kappa(t)\bigr)\,\mathbf{B}'(t) = \left(1 + \frac{s \cdot d \cdot C(t)}{Q(t)^{3/2}}\right)\mathbf{B}'(t)$$

### 4.2 Six Mutually Distinct Offset Verification Failure Categories
To prevent conflating a conservative safety-margin failure with an actual cusp, tangent reversal, or self-intersection, `M02f`, `M05.1`, and the `M00.4` oracle must classify every offset verification non-pass into one of **six independent categories**:

| Category ID | Failure Code | Mathematical Definition | Required Establishing Evidence (No Unproven Inference Permitted) |
| :---: | :--- | :--- | :--- |
| **1** | **`REGULARITY_MARGIN_VIOLATION`** | The offset regularity factor violates the safety margin $\varepsilon_{\mathrm{margin}} \in (0, 1)$ ($\varepsilon_{\mathrm{margin}} = 0.05$) without proven vanishing or reversal:<br>$$0 < 1 + s\,d\,\kappa(t) < \varepsilon_{\mathrm{margin}}$$ | Established when a point $t_0 \in [0,1]$ or sub-interval $[a,b] \subseteq [0,1]$ is proven in `mpmath.iv` to satisfy $\overline{1 + s\,d\,\kappa([a,b])} < \varepsilon_{\mathrm{margin}}$ while $\underline{1 + s\,d\,\kappa([a,b])} > 0$. **Must never be reported as an actual cusp or tangent reversal.** |
| **2** | **`ACTUAL_ZERO_SPEED_CUSP`** | Either:<br>(a) **Base-Curve Stationary Cusp:** $Q(t^*) = \|\mathbf{B}'(t^*)\|^2 = 0$, or<br>(b) **Offset Evolute Cusp:** $Q(t^*) > 0$ and $1 + s\,d\,\kappa(t^*) = 0$ (equivalently $s\,d\,C(t^*) < 0$ and $P_{\mathrm{exact}}(t^*) := Q(t^*)^3 - d^2 C(t^*)^2 = 0$). | Requires either:<br>(a) Proven exact root $Q(t^*) = 0$ (via rational/Bernstein root isolation or collinear zero-velocity control polygon), or<br>(b) A verified root bracket $[t_a, t_b] \subseteq [0,1]$ where $s\,d\,C([t_a, t_b]) < 0$ and $P_{\mathrm{exact}}(t_a)\cdot P_{\mathrm{exact}}(t_b) \le 0$ with $0 \notin P_{\mathrm{exact}}'([t_a, t_b])$ (Bolzano/Krawczyk root certificate). |
| **3** | **`TANGENT_REVERSAL`** | The offset tangent vector points strictly opposite to the base tangent:<br>• **Exact Offset:** $1 + s\,d\,\kappa(t) < 0$ (i.e., $s\,d\,C(t) < 0$ and $P_{\mathrm{exact}}(t) := Q(t)^3 - d^2 C(t)^2 < 0$), or<br>• **Fitted Cubic Offset $\tilde{\mathbf{O}}(u)$:** $D(u) := \tilde{\mathbf{O}}'(u)\cdot \mathbf{B}'(t(u)) < 0$. | Requires a point $t_0 \in [0,1]$ or sub-interval $[a,b] \subseteq [0,1]$ where outward-rounded interval evaluation in `mpmath.iv` proves strictly negative upper bound:<br>$\overline{s\,d\,C([a,b])} < 0$ and $\overline{P_{\mathrm{exact}}([a,b])} < 0$ (or $\overline{D([u_a, u_b])} < 0$). |
| **4** | **`LOCAL_OFFSET_SELF_INTERSECTION`** | Two distinct parameters $t_1^* < t_2^*$ within a local concave offset neighborhood or adjacent corner miter transition satisfy $\mathbf{O}(t_1^*) = \mathbf{O}(t_2^*)$ (or $\tilde{\mathbf{O}}_k(u_1^*) = \tilde{\mathbf{O}}_m(u_2^*)$). | Requires an isolated 2D intersection root box $[t_{1,a}, t_{1,b}] \times [t_{2,a}, t_{2,b}]$ with $t_{1,b} < t_{2,a}$ verified by 2D interval Krawczyk / interval-Newton operator or exact transverse segment crossing. |
| **5** | **`GLOBAL_CONTOUR_SELF_INTERSECTION`** | Two non-local segments $(i, j)$ of the assembled closed cutting contour intersect away from shared topological vertices: $\tilde{\mathbf{O}}_i(u^*) = \tilde{\mathbf{O}}_j(v^*)$. | Requires broad-phase bounding-box overlap (`STRtree`) followed by verified 2D interval Krawczyk / transverse crossing certificate between non-adjacent contour segments. **Local curvature checks (`Categories 1–3`) never establish the absence of `GLOBAL_CONTOUR_SELF_INTERSECTION`.** |
| **6** | **`INCONCLUSIVE_VERIFICATION`** | The bounded verification procedure cannot mathematically prove either validity (`CERTIFIED_VALID`) or a specific violation (`Categories 1–5`) within its permitted subdivision depth, precision, or compute budget. | Triggered whenever any sub-interval $[a,b]$ straddles zero ($\underline{F([a,b])} \le 0 \le \overline{F([a,b])}$) at maximum depth without an isolated root or strictly negative upper bound (`Section 5`). **Must never be mislabeled as `Categories 1–5`.** |

---

## 5. Decision Part IV — Tri-State Interval Verification & Depth-Limit Governance (`Correction D`)

### 5.1 Tri-State Verification Outcomes
Every interval-based geometric verification procedure in `M00.4`, `M02a`, `M02b`, `M02f`, `M02h`, and `M05.1` must return one of three mutually exclusive outcomes:

1. **`CERTIFIED_VALID`**:
   - Every required validity condition is mathematically proven across the entire parameter domain $t \in [0, 1]$ (and across all contour segment pairs):
     - Base speed strictly positive: $\underline{Q([a,b])} \ge v_{\mathrm{floor}}^2 > 0$ on all sub-intervals partitioning $[0, 1]$,
     - Offset regularity margin strictly satisfied: either $\underline{s\,d\,C([a,b])} \ge 0$ (convex) or $\underline{P_{\mathrm{margin}}([a,b])} > 0$ where $P_{\mathrm{margin}}(t) := (1 - \varepsilon_{\mathrm{margin}})^2 Q(t)^3 - d^2 C(t)^2$ on all sub-intervals partitioning $[0, 1]$,
     - Fitted offset tangent alignment $\underline{D([u_a, u_b])} > 0$ and radial deviation $\overline{\delta_{\mathrm{rad}}([u_a, u_b])} \le \tau_{\mathrm{offset}}$,
     - Zero local or global self-intersections (`STRtree` + 2D Bernstein/interval pruning proves $\mathbf{0} \notin \tilde{\mathbf{O}}_i([u_a,u_b]) - \tilde{\mathbf{O}}_j([v_a,v_b])$ for all non-shared pairs).
2. **`CERTIFIED_INVALID`**:
   - At least one validity condition is **mathematically proven to be violated** (`Categories 1–5` in `Section 4.2`), established by a strictly negative interval upper bound ($\overline{F([a,b])} \le 0$ at an interior point or sub-interval) or a validated Krawczyk / Bolzano sign-change root bracket.
3. **`INCONCLUSIVE`**:
   - No sub-interval is proven `CERTIFIED_INVALID`, **and** at least one sub-interval $[a, b]$ remains undecided ($\underline{F([a,b])} \le 0 < \overline{F([a,b])}$) when the verification budget ($d_{\max} = 20$), interval dependency overestimation, or conditioning limit is reached.
   - **Hard Non-Conflation Rule:** An `INCONCLUSIVE` result **must never** be reported as a confirmed cusp, tangent reversal, or self-intersection.

### 5.2 Mandatory Escalation & Next-Action Protocol by Outcome

| Outcome | Automated Engine Action (`M02f` / `M05.1`) | Escalation & Governance Action | Downstream Release-Gate Disposition (`AC-03`, `AC-05`, `AC-10`) |
| :--- | :--- | :--- | :--- |
| **`CERTIFIED_VALID`** | Accept contour/segment; attach `OffsetValidationRecord` with `outcome = "CERTIFIED_VALID"` to revision manifest. | None required. | **PASS** — Eligible for promotion to `Validated` (`Gate G3`). |
| **`CERTIFIED_INVALID`** | 1. Record exact proven failure category (`Category 1`–`5`), parameter bracket $[t_a, t_b]$, and spatial coordinates.<br>2. If failure is a trimmable concave offset loop (`Categories 1–4` on allowance curve with regular base stitch curve), execute deterministic envelope trimming (`Step 2D`) and re-run complete tri-state verification on the trimmed contour.<br>3. If base stitch curve is singular ($Q(t^*)=0$) or trimming fails, halt and return `CERTIFIED_INVALID`. | Surface exact geometric defect location in `apps/web` CAD diagnostics for patternmaker correction. | **FAIL-CLOSED REJECT** — Blocks transition to `Validated`, `Fit_Approved`, `Sample_Approved`, and `Production_Ready`. |
| **`INCONCLUSIVE`** | **Step 1 (Localized Precision & Depth Escalation):** Re-evaluate undecided sub-intervals $[a,b]$ using centered/Taylor-form interval arithmetic in `mpmath.iv` at `mp.dps = 80` with up to $+4$ localized bisection levels ($d \le 24$).<br>**Step 2 (Alternative Validated Method):** Run exact rational Sturm-habicht / Bernstein Descartes sign-variation root counting in `fractions.Fraction` on the polynomial over $[a,b]$.<br>**Step 3 (Persist Inconclusive Record):** If still undecided, persist `outcome = "INCONCLUSIVE"` with reason code (`SUBDIVISION_DEPTH_EXHAUSTED`, `INTERVAL_DEPENDENCY_OVERESTIMATION`, or `GRAZING_TANGENTIAL_JACOBIAN_SINGULAR`). | Escalate to independent offline oracle verification and manual computational-geometry / lead-patternmaker expert review. | **FAIL-CLOSED HOLD (Without Misclassification)** — Downstream release gates require `CERTIFIED_VALID` and therefore block automatic promotion of `INCONCLUSIVE` contours while preserving the `INCONCLUSIVE` label in all logs and records. |

### 5.3 Persisted Offset Validation Record Schema (`OffsetValidationRecord`)
```json
{
  "segment_id": "bodice_front_armscye_seg_02",
  "verification_outcome": "CERTIFIED_VALID | CERTIFIED_INVALID | INCONCLUSIVE",
  "failure_category": "NONE | REGULARITY_MARGIN_VIOLATION | ACTUAL_ZERO_SPEED_CUSP | TANGENT_REVERSAL | LOCAL_OFFSET_SELF_INTERSECTION | GLOBAL_CONTOUR_SELF_INTERSECTION | INCONCLUSIVE_VERIFICATION",
  "coordinate_convention": "CARTESIAN_RH_CCW",
  "offset_sign_s": -1,
  "offset_distance_d_cm": 1.0,
  "regularity_margin_epsilon": 0.05,
  "max_subdivision_depth_reached": 6,
  "min_certified_speed_sq_cm2": 14.8201,
  "min_certified_regularity_factor": 0.4182,
  "max_certified_radial_error_cm": 0.0012,
  "primary_span_coverage_ratio": 0.942,
  "local_self_intersection_status": "CERTIFIED_VALID",
  "global_contour_self_intersection_status": "CERTIFIED_VALID",
  "unresolved_intervals": [],
  "escalation_trace": []
}
```

---

## 6. Consequences & Enforcement
- **Positive:** Establishes complete mathematical honesty across reference enclosures (`Correction A`), downgrades the heuristic $S_{\mathrm{safety}}=16$ quadrature formula to a `CONSERVATIVE_ENGINEERING_ESTIMATE` while providing the exact convex-hull chord/polygon proof `Method C1-Cert` (`Correction B`), prevents false geometric diagnoses via the 6-category failure taxonomy (`Correction C`), and ensures interval overestimation at depth limits is recorded as `INCONCLUSIVE` rather than a fabricated cusp (`Correction D`).
- **Governance Gate (`Correction F`):** `ADR-009` and `DEC-13` must be formally approved before **`Gate Auth-1` (`M00` Commencement)** and **`Gate Auth-2` (`M02a`/`M02f` Implementation)**.
