# ADR-009 — FIVE-CONCEPT NUMERICAL ASSURANCE, PARAMETER-TO-OUTPUT ERROR PROPAGATION, FOUR-LAYER METHOD C1-CERT ASSURANCE, CORRECTED OFFSET DERIVATIVE & SIX-CATEGORY TRI-STATE VERIFICATION (`R2.1.2`)

- **ADR ID:** `ADR-009`
- **Revision:** `2.1.2` (Targeted Mathematical Correction, Numerical Assurance & Governance Alignment)
- **Base Commit:** `8805140b1e6e7799922348369d7e29881102a75e` (`Patroner Blueprint R2.1.1`)
- **Status:** `PROPOSED — Requires Engineering & Computational Geometry Governance Approval (DEC-11, DEC-13 Stage 1 at Gate Auth-1; DEC-13 Stage 2 at Gate Auth-2; Blocks Gate Auth-1 / M00 Start)`
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05`, `Ch. 07`, `App. A2–A3`, `App. F`), `Dossier 03 v5.1` (Deterministic Pattern Geometry), `Dossier 06 v5.4` (Validation & Benchmarks), `Dossier 14 v5.12` (Manufacturing Constraints), Phase E2 & E3 Mathematical Audit Reports (`DEF-M00-01`–`DEF-M00-06`), `REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`, `ADR-003`

---

## 1. Context & Problem Statement (`R2.1` → `R2.1.1` → `R2.1.2` Review Findings)

### 1.1 Preserved `R2.1.1` Foundations
Blueprint Revision `R2.1.1` (`commit 8805140b1e6e7799922348369d7e29881102a75e`) established:
1. The explicit triangle inequality $|X_{\mathrm{float64}} - X_{\mathrm{exact}}| \le |X_{\mathrm{float64}} - X_{\mathrm{ref}}| + |X_{\mathrm{ref}} - X_{\mathrm{exact}}|$ and the **Five-Concept Numerical Assurance Taxonomy** ($X_{\mathrm{ref}}, E_{\mathrm{obs}}, B_{\mathrm{ref}}, B_{\mathrm{cert}}, \tau_{\mathrm{domain}}$).
2. The downgrade of the adaptive Gauss–Legendre quadrature-difference heuristic ($S_{\mathrm{safety}} = 16.0$, `Method C1-Est`) to a **`CONSERVATIVE_ENGINEERING_ESTIMATE`** (`EMPIRICAL_ESTIMATE`), separated from De Casteljau chord/control-polygon convex-hull interval bounds (`Method C1-Cert`).
3. Separation of offset failure categories from inconclusive interval bounds via **Tri-State Interval Verification** (`CERTIFIED_VALID`, `CERTIFIED_INVALID`, `INCONCLUSIVE`).

### 1.2 Targeted Mathematical & Assurance Defects Corrected in `R2.1.2`
Independent mathematical review of `R2.1.1` (`commit 8805140b1e6e7799922348369d7e29881102a75e`) identified four remaining mathematical and numerical-assurance defects in `ADR-009` that are resolved in `R2.1.2`:

1. **Critical Correction A — Offset Derivative Sign Error (`Section 4`):**
   - `R2.1.1` (`ADR-009 §4.1`) defined the offset curve as $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\hat{\mathbf{n}}_+(t)$ together with the Frenet–Serret derivative of the left unit normal $\hat{\mathbf{n}}_+'(t) = -\kappa(t)\,\mathbf{B}'(t)$, yet erroneously wrote $\mathbf{O}'(t) = (1 + s\,d\,\kappa(t))\mathbf{B}'(t)$ instead of the mathematically required $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$.
   - Consequently, `R2.1.1` inverted the sign predicate $s\,d\,C(t)$ across its offset regularity margin, evolute cusp, and tangent-reversal conditions, which fails the analytical counter-clockwise circle sanity check.
2. **Critical Correction B — Parameter Uncertainty Conflated with Geometric Output Error (`Section 2.4`):**
   - `R2.1.1` (`ADR-009 §2.3 item 3`) wrote $B_{\mathrm{ref}}(t^*) = \frac{1}{2}(\overline{t} - \underline{t})$ for an isolated root $t^* \in [\underline{t}, \overline{t}]$ without distinguishing parameter-bracket uncertainty from the resulting geometric/scalar output error $|X(t^*) - X(t_{\mathrm{mid}})|$.
3. **Critical Correction C — Overstated `Method C1-Cert` & `mpmath.iv` Self-Certification Claim (`Section 3.2–§3.4`):**
   - `R2.1.1` (`ADR-009 §3.2`) used strict inequality wording for the chord lower bound, referred to the implementation output as a `"100% mathematically certified upper bound"`, and treated the invocation of `mpmath.iv` as self-certifying without separating the mathematical theorem from algorithmic derivation, implementation assurance obligations, library qualification evidence, and empirical testing.
4. **Critical Correction F — Unqualified Oracle Independence Claims (`Section 6`):**
   - `R2.1.1` claimed oracle independence based on directory/import separation without distinguishing algorithmic, source-code, arithmetic/library (including shared `mpmath.iv` usage), input/fixture, and reviewer independence.

---

## 2. Decision Part I — Reference Oracle Triangle Inequality, Five-Concept Numerical Assurance & Parameter-to-Output Error Propagation (`Critical Correction B`)

### 2.1 Explicit Triangle Inequality
For any scalar or vector geometric quantity with true mathematical value $X_{\mathrm{exact}}$, production IEEE 754 `binary64` (`float64`) result $X_{\mathrm{float64}}$, and independent reference result $X_{\mathrm{ref}}$, the true implementation error is governed by the triangle inequality:

$$|X_{\mathrm{float64}} - X_{\mathrm{exact}}| \;\le\; |X_{\mathrm{float64}} - X_{\mathrm{ref}}| \;+\; |X_{\mathrm{ref}} - X_{\mathrm{exact}}|$$

**Mandatory Rule:** The reference-to-exact error term $|X_{\mathrm{ref}} - X_{\mathrm{exact}}|$ **must never be silently assumed to be zero**.

### 2.2 Five-Concept Numerical Assurance Taxonomy
Every numerical specification, production validator (`M02a`–`M02h`, `M05`), and independent verification oracle (`M00.4`) must explicitly distinguish five separate quantities:

| # | Numerical Concept | Symbol | Definition & Mathematical Requirement |
| :---: | :--- | :---: | :--- |
| **1** | **High-Precision Reference Result** | $X_{\mathrm{ref}}$ | An independent high-precision numerical approximation (e.g., `mpmath` at `mp.dps = 80` decimal digits or exact rational midpoint). **A high-precision reference result is not automatically a mathematical certificate.** |
| **2** | **Observed Implementation-to-Reference Discrepancy** | $E_{\mathrm{obs}}$ | The measured discrepancy between the production `float64` result and the reference result: $E_{\mathrm{obs}} = |X_{\mathrm{float64}} - X_{\mathrm{ref}}|$ (computed with outward rounding). |
| **3** | **Validated Reference-to-Exact Output Enclosure** | $B_{\mathrm{ref}}(X)$ | A rigorously derived upper bound satisfying $|X_{\mathrm{ref}} - X_{\mathrm{exact}}| \le B_{\mathrm{ref}}(X)$ **in the output space of $X$**, established via exact rational arithmetic (`fractions.Fraction`), qualified outward-rounded interval arithmetic (`Section 3.4`), or validated derivative/image propagation across a root bracket (`Section 2.4`). **If $|X_{\mathrm{ref}} - X_{\mathrm{exact}}|$ is not bounded by a complete derivation and qualified arithmetic, $B_{\mathrm{ref}}(X)$ is `UNESTABLISHED` (`null`) and the result must be classified as `HIGH_PRECISION_NUMERICAL_REFERENCE` (`EMPIRICAL_ESTIMATE`), never `CERTIFIED_ENCLOSURE`.** |
| **4** | **Validated Implementation-to-Exact Output Error Bound** | $B_{\mathrm{cert}}(X)$ | An upper bound on the true implementation output error $|X_{\mathrm{float64}} - X_{\mathrm{exact}}| \le B_{\mathrm{cert}}(X)$, established either by:<br>(a) **Direct Output Interval Enclosure:** $X_{\mathrm{exact}} \in [\underline{X}, \overline{X}]$ with $B_{\mathrm{cert}}(X) = \max(|X_{\mathrm{float64}} - \underline{X}|, |\overline{X} - X_{\mathrm{float64}}|)$ (evaluated with upward rounding), or<br>(b) **Oracle Triangle Enclosure:** $B_{\mathrm{cert}}(X) = E_{\mathrm{obs}}(X) \oplus_{\uparrow} B_{\mathrm{ref}}(X)$ where $B_{\mathrm{ref}}(X)$ is a validated output enclosure. |
| **5** | **Engineering Acceptance Tolerance** | $\tau_{\mathrm{domain}}(X)$ | The garment-engineering or manufacturing threshold (`REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`). Where certified enclosure is required, acceptance requires $B_{\mathrm{cert}}(X) \le \tau_{\mathrm{domain}}(X)$. |

### 2.3 Parameter Uncertainty vs. Geometric Output Error (`Critical Correction B`)
When a geometric quantity $X(t^*)$ depends on an implicitly defined parameter $t^* \in [0, 1]$ (such as closest-point projection root $g(t^*) := (\mathbf{B}(t^*) - \mathbf{Q})\cdot \mathbf{B}'(t^*) = 0$, partial arc length $s(t^*) = \int_0^{t^*} \|\mathbf{B}'(u)\|_2\,du$, curvature extremum, or curve-curve intersection parameter), **a parameter bracket half-width $\frac{1}{2}(\overline{t} - \underline{t})$ bounds only the parameter distance $|t^* - t_{\mathrm{mid}}|$ and does NOT, by itself, bound the geometric output error $|X(t^*) - X(t_{\mathrm{mid}})|$**.

Every root-dependent verification procedure must explicitly distinguish and compute four separate quantities:

1. **Parameter Enclosure ($I_t = [\underline{t}, \overline{t}]$):**
   - A validated interval bracket guaranteed to contain the root $t^* \in I_t = [\underline{t}, \overline{t}]$ (established via Bolzano sign change $g(\underline{t})\cdot g(\overline{t}) \le 0$ with $0 \notin g'(I_t)$ or a contractive interval-Newton / Krawczyk operator $\mathcal{K}(I_t) \subseteq \mathrm{int}(I_t)$).
   - Let $t_{\mathrm{mid}} := \frac{1}{2}(\underline{t} + \overline{t})$ be the representative midpoint. The parameter uncertainty radius is:
     $$r_{\mathrm{param}}(I_t) := \frac{\overline{t} - \underline{t}}{2} \;\ge\; |t^* - t_{\mathrm{mid}}|$$
   - **Prohibition:** $r_{\mathrm{param}}(I_t)$ is dimensionless parameter uncertainty and **must never be reported as a geometric output error certificate $B_{\mathrm{ref}}(X)$**.

2. **Function-Value / Residual Enclosure ($I_g = [\underline{g}, \overline{g}] \ni g(t)$):**
   - The interval enclosure of the defining predicate $g(I_t)$ (and its derivative $g'(I_t)$) used to verify root existence and uniqueness on $I_t$. Near tangential or multiple roots where $0 \in g'(I_t)$, small residual values $|g(t_{\mathrm{mid}})|$ do not imply small parameter or output error; if $0 \in g'(I_t)$ cannot be resolved within the budget, the root enclosure must be classified as **`INCONCLUSIVE`**.

3. **Geometric-Output Reference Enclosure ($I_X = [\underline{X}, \overline{X}] \ni X(t^*)$ and $B_{\mathrm{ref}}(X)$):**
   - To bound the true output $X_{\mathrm{exact}} = X(t^*)$ for $t^* \in I_t = [\underline{t}, \overline{t}]$, the reference oracle must apply one of two mathematically valid output-propagation derivations:
   - **Derivation Method B1 — Validated Derivative (Lipschitz / Mean-Value) Output Bound:**
     If $X: I_t \to \mathbb{R}$ is continuously differentiable on $I_t = [\underline{t}, \overline{t}]$ and $M_{X'}(I_t) \ge \sup_{t \in I_t} |X'(t)|$ is a validated upper bound on the derivative magnitude over the entire interval $I_t$, then by the Mean Value Theorem:
     $$|X(t^*) - X(t_{\mathrm{mid}})| \;\le\; \left(\sup_{t \in I_t} |X'(t)|\right) \frac{\overline{t} - \underline{t}}{2} \;\le\; M_{X'}(I_t) \cdot \frac{\overline{t} - \underline{t}}{2}$$
     Accounting for the finite-precision point evaluation enclosure $X(t_{\mathrm{mid}}) \in [\underline{X}_{\mathrm{mid}}, \overline{X}_{\mathrm{mid}}]$ with midpoint $X_{\mathrm{ref}} = \mathrm{mid}([\underline{X}_{\mathrm{mid}}, \overline{X}_{\mathrm{mid}}])$ and evaluation radius $\delta_{\mathrm{eval}} = \frac{1}{2}(\overline{X}_{\mathrm{mid}} - \underline{X}_{\mathrm{mid}})$, the validated reference output error bound is:
     $$\boxed{B_{\mathrm{ref}}(X) \;:=\; M_{X'}(I_t) \cdot \frac{\overline{t} - \underline{t}}{2} \;+\; \delta_{\mathrm{eval}} \;\ge\; |X(t^*) - X_{\mathrm{ref}}|}$$
     - *Concrete Application to Partial Arc-Length Projection $X(t) = s(t) = \int_0^t \|\mathbf{B}'(u)\|_2\,du$:* Since $s'(t) = \|\mathbf{B}'(t)\|_2 = \sqrt{Q(t)}$, a validated derivative bound on $I_t$ is $M_{s'}(I_t) = \overline{\sqrt{Q(I_t)}}$, and $\delta_{\mathrm{eval}} = B_{\mathrm{ref}}\bigl(s(t_{\mathrm{mid}})\bigr)$ is the `Method C1-Cert` half-width on $[0, t_{\mathrm{mid}}]$, yielding:
       $$B_{\mathrm{ref}}\bigl(s(t^*)\bigr) \;=\; \overline{\sqrt{Q([\underline{t}, \overline{t}])}} \cdot \frac{\overline{t} - \underline{t}}{2} \;+\; \frac{\overline{L}_{\mathrm{poly}}(0, t_{\mathrm{mid}}) - \underline{L}_{\mathrm{chord}}(0, t_{\mathrm{mid}})}{2}$$
     - *Concrete Application to Projected Point Position $\mathbf{X}(t) = \mathbf{B}(t) \in \mathbb{R}^2$:*
       $$\|\mathbf{B}(t^*) - \mathbf{B}(t_{\mathrm{mid}})\|_2 \;\le\; \overline{\sqrt{Q([\underline{t}, \overline{t}])}} \cdot \frac{\overline{t} - \underline{t}}{2}$$
   - **Derivation Method B2 — Direct Interval Image Enclosure:**
     Evaluate a validated interval enclosure of the output image $X(I_t) \subseteq [\underline{X}(I_t), \overline{X}(I_t)]$ over $I_t = [\underline{t}, \overline{t}]$ (for example, for monotone arc length $s(t)$ with $0 \le \underline{t} \le t^* \le \overline{t} \le 1$, $s(t^*) \in [\underline{L}_{\mathrm{chord}}(0, \underline{t}), \, \overline{L}_{\mathrm{poly}}(0, \overline{t})]$). Setting $X_{\mathrm{ref}} := \frac{1}{2}\bigl(\underline{X}(I_t) + \overline{X}(I_t)\bigr)$ yields the direct geometric output bound:
     $$\boxed{B_{\mathrm{ref}}(X) \;:=\; \frac{\overline{X}(I_t) - \underline{X}(I_t)}{2} \;\ge\; |X(t^*) - X_{\mathrm{ref}}|}$$

4. **Final Certified Implementation-to-Exact Output Error Bound ($B_{\mathrm{cert}}(X)$):**
   $$B_{\mathrm{cert}}(X) \;:=\; |X_{\mathrm{float64}} - X_{\mathrm{ref}}| \;\oplus_{\uparrow}\; B_{\mathrm{ref}}(X) \;\ge\; |X_{\mathrm{float64}} - X(t^*)|$$

### 2.4 Mandatory Persistence Schema (`NumericalVerificationRecord` — Updated for `R2.1.2`)
Every numerical verification result persisted in CI oracle reports (`M00.4`) and runtime validation manifests (`M02`, `M05`) must identify all required parameter, derivative/image, and output-enclosure fields:
```json
{
  "quantity_name": "projected_curve_arc_length_cm",
  "output_unit": "cm",
  "reference_method_and_version": "mpmath_iv_chord_polygon_v2.1.2 | fractions_exact_rational_v2.1.2",
  "precision_and_arithmetic_model": "IEEE754_binary64_runtime + qualified_mpmath_iv_dps80_oracle",
  "enclosure_or_remainder_method": "METHOD_C1_CERT_CHORD_POLYGON_INTERVAL | METHOD_C1_EST_GAUSS_LEGENDRE_DIFF | METHOD_C2_EXACT_POLYNOMIAL_HIGHAM | METHOD_C3_BERNSTEIN_INTERVAL",
  "assurance_classification": "CERTIFIED_ENCLOSURE | HIGH_PRECISION_NUMERICAL_REFERENCE | CONSERVATIVE_ENGINEERING_ESTIMATE | UNQUALIFIED_INTERVAL_APPROXIMATION",
  "parameter_enclosure": {
    "applicable": true,
    "parameter_interval_t": [0.4182019001, 0.4182019005],
    "representative_t_mid": 0.4182019003,
    "parameter_half_width_r_param": 2.0e-10,
    "output_propagation_method": "DERIVATIVE_LIPSCHITZ_BOUND | DIRECT_INTERVAL_IMAGE_ENCLOSURE",
    "validated_derivative_sup_bound": 18.4205,
    "output_interval_enclosure": [7.41902310, 7.41902395]
  },
  "error_components": {
    "x_float64": 7.41902352,
    "x_ref": "7.4190235250000000000...",
    "observed_discrepancy_e_obs": 5.0e-9,
    "reference_output_enclosure_b_ref": 4.25e-7,
    "implementation_to_exact_bound_b_cert": 4.30e-7,
    "heuristic_error_estimate": 2.57e-5
  },
  "acceptance_tolerance_tau": 1.0e-3,
  "termination_and_inconclusive_reason": "NONE | MAX_DEPTH_REACHED | SINGULAR_DERIVATIVE_BRACKET | LIBRARY_QUALIFICATION_MISSING",
  "verification_outcome": "CERTIFIED_VALID | CERTIFIED_INVALID | INCONCLUSIVE",
  "interval_library_qualification_ref": "qual-mpmath-1.3.0-py3.12-sha256-...",
  "reproducibility_manifest": {
    "algorithm_version": "m02a-v2.1.2",
    "python_version": "3.12.x",
    "mpmath_version": "1.3.0",
    "random_seed": 0,
    "input_canonical_sha256": "..."
  }
}
```

---

## 3. Decision Part II — `Method C1-Est` Downgrade, Four-Layer `Method C1-Cert` Assurance Architecture & Interval Library Qualification (`Critical Correction C`)

### 3.1 `Method C1-Est` — Adaptive Gauss–Legendre Quadrature Discrepancy (`CONSERVATIVE_ENGINEERING_ESTIMATE`)
- **Formula:** On a cubic Bézier curve subdivided into $M$ leaf sub-segments ($d \le 12$), let $I_{8,k}$ and $I_{16,k}$ be the 8-point and 16-point Gauss–Legendre approximations of $\int_0^1 \|\mathbf{B}_k'(u)\|_2\,du$ in `float64`:
  $$E_{\mathrm{est, C1}}(L) = \sum_{k=1}^{M} \left( S_{\mathrm{safety}} \cdot |I_{16, k} - I_{8, k}| + 32 \cdot u_{64} \cdot I_{16, k} \right) + M \cdot u_{64} \cdot L_{\mathrm{total}}, \quad S_{\mathrm{safety}} = 16.0, \; u_{64} = 2^{-53}$$
- **Formal Classification:** **`CONSERVATIVE_ENGINEERING_ESTIMATE`** (`EMPIRICAL_ESTIMATE`).
- **Mathematical Reason for Downgrade:** The integrand $f_k(u) = \sqrt{x_k'(u)^2 + y_k'(u)^2}$ has complex branch points where $x_k'(z)^2 + y_k'(z)^2 = 0$, so higher derivatives $f_k^{(2n)}(u)$ in the Peano kernel remainder grow as $\mathcal{O}((2n)! / \rho^{2n})$ as complex zeros approach $[0, 1]$. No universal constant $S_{\mathrm{safety}} = 16.0$ bounds the true quadrature error across all curves.
- **Prohibited Language:** `Method C1-Est` **must never** be described as `certified`, `proof`, `mathematically guaranteed`, or `CERTIFIED_ENCLOSURE`.

### 3.2 `Method C1-Cert` — Four-Layer Assurance Architecture (`Critical Correction C`)
To avoid conflating a pure mathematical theorem with an unverified software implementation, `Method C1-Cert` is governed across **four distinct assurance layers**. No implementation may claim a `CERTIFIED_ENCLOSURE` unless Layers 1, 2, and 3 (including `Section 3.4` library qualification) are satisfied.

#### Layer 1 — Mathematical Theorem (Exact Real-Analysis Inequality)
- **Theorem Statement:** Let $\mathbf{B}: [0, 1] \to \mathbb{R}^2$ be a planar Bézier curve of degree $n \ge 1$ ($n = 3$ for cubic Bézier curves) with control points $\mathbf{P}_0, \mathbf{P}_1, \dots, \mathbf{P}_n \in \mathbb{R}^2$:
  $$\mathbf{B}(u) = \sum_{j=0}^{n} \mathbf{P}_j B_j^n(u), \qquad B_j^n(u) = \binom{n}{j} u^j (1 - u)^{n-j}, \qquad u \in [0, 1]$$
  Then the exact Euclidean arc length $L_{\mathrm{exact}}(\mathbf{B}) := \int_0^1 \|\mathbf{B}'(u)\|_2\,du$ satisfies the **non-strict** double inequality:
  $$\boxed{L_{\mathrm{chord}}(\mathbf{B}) \;:=\; \|\mathbf{P}_n - \mathbf{P}_0\|_2 \;\le\; L_{\mathrm{exact}}(\mathbf{B}) \;\le\; \sum_{j=0}^{n-1} \|\mathbf{P}_{j+1} - \mathbf{P}_j\|_2 \;=: \; L_{\mathrm{control\ polygon}}(\mathbf{B})}$$
- **Assumptions & Proof Summary:**
  1. **Assumptions:** $\mathbf{P}_0, \dots, \mathbf{P}_n \in \mathbb{R}^2$ are finite real coordinates (which gives a $C^\infty$ polynomial curve on $[0, 1]$). Zero regularity ($Q(u) > 0$), curvature, or aspect-ratio assumptions are required.
  2. **Lower Bound ($L_{\mathrm{chord}} \le L_{\mathrm{exact}}$):** By the Fundamental Theorem of Calculus and the triangle inequality for integrals in $(\mathbb{R}^2, \|\cdot\|_2)$,
     $$\|\mathbf{P}_n - \mathbf{P}_0\|_2 = \|\mathbf{B}(1) - \mathbf{B}(0)\|_2 = \left\|\int_0^1 \mathbf{B}'(u)\,du\right\|_2 \;\le\; \int_0^1 \|\mathbf{B}'(u)\|_2\,du = L_{\mathrm{exact}}(\mathbf{B}).$$
  3. **Upper Bound ($L_{\mathrm{exact}} \le L_{\mathrm{control\ polygon}}$):** Differentiating in the Bernstein basis yields $\mathbf{B}'(u) = \sum_{j=0}^{n-1} n(\mathbf{P}_{j+1} - \mathbf{P}_j) B_j^{n-1}(u)$. Because $B_j^{n-1}(u) \ge 0$ for all $u \in [0, 1]$ and $\int_0^1 n B_j^{n-1}(u)\,du = 1$ for every $j \in \{0, \dots, n-1\}$, the triangle inequality under the integral sign yields:
     $$L_{\mathrm{exact}}(\mathbf{B}) = \int_0^1 \left\|\sum_{j=0}^{n-1} n(\mathbf{P}_{j+1} - \mathbf{P}_j) B_j^{n-1}(u)\right\|_2 du \;\le\; \sum_{j=0}^{n-1} \|\mathbf{P}_{j+1} - \mathbf{P}_j\|_2 \int_0^1 n B_j^{n-1}(u)\,du = \sum_{j=0}^{n-1} \|\mathbf{P}_{j+1} - \mathbf{P}_j\|_2.$$
  4. **Equality Conditions (Why Non-Strict Inequalities Are Mandatory):** Equality $L_{\mathrm{chord}}(\mathbf{B}) = L_{\mathrm{exact}}(\mathbf{B}) = L_{\mathrm{control\ polygon}}(\mathbf{B})$ holds whenever the control differences $\mathbf{P}_{j+1} - \mathbf{P}_j$ are non-negative scalar multiples of a single direction vector $\hat{\mathbf{e}}$ (collinear, monotonically ordered control points, including straight line segments and zero-length single-point curves).

#### Layer 2 — Algorithmic Derivation (De Casteljau Subdivision & Bound Convergence)
- **Additive Partitioning:** For any partition $0 = t_0 < t_1 < \dots < t_M = 1$, exact De Casteljau subdivision produces $M$ cubic Bézier sub-curves $\mathbf{B}_k: [0, 1] \to \mathbb{R}^2$ with control points $\mathbf{P}_{k,0}, \mathbf{P}_{k,1}, \mathbf{P}_{k,2}, \mathbf{P}_{k,3}$. By additivity of the integral over $[t_{k-1}, t_k]$ and Layer 1 applied to each $\mathbf{B}_k$:
  $$\sum_{k=1}^{M} L_{\mathrm{chord}}(\mathbf{B}_k) \;\le\; \sum_{k=1}^{M} L_{\mathrm{exact}}(\mathbf{B}_k) = L_{\mathrm{exact}}(\mathbf{B}) \;\le\; \sum_{k=1}^{M} L_{\mathrm{control\ polygon}}(\mathbf{B}_k).$$
- **Monotonicity & Convergence:** Because De Casteljau midpoint subdivision replaces adjacent control legs by their convex-hull midpoints, each bisection step satisfies $L_{\mathrm{chord}}(\mathbf{B}_k) \le L_{\mathrm{chord}}(\mathbf{B}_{k,\mathrm{left}}) + L_{\mathrm{chord}}(\mathbf{B}_{k,\mathrm{right}})$ and $L_{\mathrm{poly}}(\mathbf{B}_{k,\mathrm{left}}) + L_{\mathrm{poly}}(\mathbf{B}_{k,\mathrm{right}}) \le L_{\mathrm{poly}}(\mathbf{B}_k)$. As max interval width $h = \max_k (t_k - t_{k-1}) \to 0$, the enclosure width $\sum_k \bigl(L_{\mathrm{poly}}(\mathbf{B}_k) - L_{\mathrm{chord}}(\mathbf{B}_k)\bigr)$ converges monotonically to $0$ ($\mathcal{O}(h^2)$ on smooth curves; $\mathcal{O}(h)$ on curves with interior cusps).

#### Layer 3 — Implementation Assurance Obligations
Because finite-precision computers do not execute exact real arithmetic, an implementation of `Method C1-Cert` only yields a valid enclosure $[\underline{L}_{\mathrm{chord}}, \overline{L}_{\mathrm{poly}}] \ni L_{\mathrm{exact}}(\mathbf{B})$ if the implementation satisfies and demonstrates all nine obligations below:
1. **Exact Input Interval Construction:** Each IEEE 754 `binary64` input coordinate $x \in \mathbb{F}_{64}$ (if finite) is an exact dyadic rational $m \cdot 2^e$ and must be converted losslessly into a degenerate interval $[x, x]$ without intermediate decimal formatting (`str(x)` or `.toFixed()`).
2. **Outward-Rounded Interval Arithmetic:** Every interval operation $\diamond \in \{+, -, \times, \div, \sqrt{\cdot}\}$ must satisfy $[\underline{A \diamond B}, \overline{A \diamond B}] \supseteq \{a \diamond b : a \in A, b \in B\}$.
3. **Validated Enclosure of Every Subdivided Control Point:** During De Casteljau subdivision at depth $d$, every intermediate control point $\mathbf{P}_{k,j}$ must be computed and stored as an interval vector $[\underline{\mathbf{P}}_{k,j}, \overline{\mathbf{P}}_{k,j}]$ so that any rounding at depth $\ge 53$ bits (or non-dyadic split parameters $t^*$) is rigorously enclosed.
4. **Validated Enclosure of Every Segment Norm and Accumulated Sum:** For each leaf $k$, the chord difference $\Delta \mathbf{P}_{k,\mathrm{chord}} = \mathbf{P}_{k,3} - \mathbf{P}_{k,0}$ and polygon leg differences $\Delta \mathbf{P}_{k,j} = \mathbf{P}_{k,j+1} - \mathbf{P}_{k,j}$ are squared, summed, square-rooted, and accumulated across $k = 1, \dots, M$ entirely in outward-rounded interval arithmetic, taking the lower endpoint $\underline{L}_{\mathrm{chord}} := \inf\bigl(\sum_{k=1}^M \|\Delta \mathbf{P}_{k,\mathrm{chord}}\|_2\bigr)$ and upper endpoint $\overline{L}_{\mathrm{poly}} := \sup\bigl(\sum_{k=1}^M \sum_{j=0}^2 \|\Delta \mathbf{P}_{k,j}\|_2\bigr)$.
5. **No Unvalidated Floating-Point Shortcuts:** No `float64` `math.hypot`, `numpy.linalg.norm`, or unenclosed `float64` De Casteljau split may be used inside the enclosure-producing path.
6. **Outward Propagation of Final Error-Bound Enclosure:** Given a runtime `float64` approximation $L_{\mathrm{float64}}$, the final error bound:
   $$B_{\mathrm{cert}}(L) := \max\Bigl(\sup\bigl(|[L_{\mathrm{float64}}, L_{\mathrm{float64}}] - [\underline{L}_{\mathrm{chord}}, \overline{L}_{\mathrm{poly}}]|\bigr)\Bigr) = \max\bigl(L_{\mathrm{float64}} \ominus_{\uparrow} \underline{L}_{\mathrm{chord}}, \; \overline{L}_{\mathrm{poly}} \ominus_{\uparrow} L_{\mathrm{float64}}\bigr)$$
   must be converted to its reported upper bound using upward rounding so conversion to `float64` never understates the bound.
7. **Explicit Handling of Overflow, Underflow & Invalid Intervals:** If any input coordinate, tolerance, or intermediate interval endpoint is `NaN`, `±Inf`, inverted ($\underline{x} > \overline{x}$), or subnormal beyond representable exponent bounds, the routine must immediately abort and return `CERTIFIED_INVALID` (`ERR_INVALID_INTERVAL_STATE`).
8. **Budget Exhaustion & `INCONCLUSIVE` Disposition:** If subdivision reaches $d_{\max}$ while $B_{\mathrm{cert}}(L) > \tau_{\mathrm{domain}}$, the interval $[\underline{L}_{\mathrm{chord}}, \overline{L}_{\mathrm{poly}}]$ remains a valid enclosure of $L_{\mathrm{exact}}$, and the verification outcome is recorded as **`INCONCLUSIVE`** (`tolerance_achieved: False`, failing closed at downstream release gates).
9. **Deterministic Reproducibility:** Subdivision order (depth-first left-before-right), working precision (`mp.dps = 80`), and library versions must be fixed and recorded in `reproducibility_manifest`.

#### Layer 4 — Empirical Verification (Necessary Bug Detection, Never Mathematical Proof)
- Unit tests, `Hypothesis` property tests, adversarial curve suites (`Section 4.4`), and cross-checks against high-precision quadrature (`mpmath.quad`) and exact rational (`fractions.Fraction`) bounds are mandatory to detect coding defects in Layer 3, **but empirical test passes must never be presented as a substitute for Layers 1–3**.

### 3.3 `Method C2` — Exact Algebraic Polynomial Green's Theorem Area + Higham Inner-Product Rounding Bound (`CERTIFIED_ENCLOSURE`)
- For a closed contour of line segments and cubic Bézier curves with IEEE 754 `float64` control points (exact dyadic rationals), Green's integral $A_{\mathrm{exact}} = \frac{1}{2}\oint (x\,dy - y\,dx)$ is an **exact degree-5 polynomial** with zero quadrature truncation error.
- **Reference Oracle ($B_{\mathrm{ref}}(A) = 0$):** Evaluating the exact rational bilinear form in Python `fractions.Fraction` yields $A_{\mathrm{ref}} = A_{\mathrm{exact}}$ ($B_{\mathrm{ref}}(A) = 0$, or $\le \frac{1}{2}\mathrm{ulp}_{80}$ when serialized to 80 decimal digits).
- **Runtime Bound ($B_{\mathrm{cert}}(A)$):** Shifting coordinates by the contour centroid $\mathbf{c}$ and applying Higham's forward inner-product rounding bound $\gamma_{64} = \frac{64 u_{64}}{1 - 64 u_{64}}$ with outward ULP padding (or evaluating the bilinear form directly in qualified outward-rounded interval arithmetic) yields a validated upper bound $B_{\mathrm{cert}}(A)$ on $|A_{\mathrm{float64}} - A_{\mathrm{exact}}|$.

### 3.4 Interval Library Qualification Protocol (`Critical Correction C §5.1`)
Using `mpmath.iv` does **not** automatically prove that an implementation is mathematically certified. Before any `M00.4` oracle or `M02` validator output using `mpmath.iv` may be classified as `CERTIFIED_ENCLOSURE`, the interval arithmetic backend must pass and persist an **`IntervalLibraryQualificationReport`** covering all eight requirements below:

| # | Qualification Requirement | Specification & Required Evidence |
| :---: | :--- | :--- |
| **1** | **Pinned Library & Runtime Version** | Exact pinned version (`mpmath == 1.3.0`, Python `3.12.x`), recording whether pure-Python `mpmath.libmp` or `gmpy2` integer backend is active. |
| **2** | **Documented Interval Guarantees** | Document the rounding guarantees of `mpmath.iv` (`MPI` representation $[a, b]$ with binary mantissa+exponent endpoints using directed rounding `'d'` for lower bounds and `'u'` for upper bounds in `mpf_add`, `mpf_sub`, `mpf_mul`, `mpf_div`, `mpf_sqrt`). |
| **3** | **Known Limitations Register** | Explicitly document `mpmath.iv` limitations: (a) string conversion of decimal literals can introduce parsing ambiguity unless constructed from exact `float`/`int`/`Fraction`, (b) non-algebraic transcendental functions (`sin`, `cos`, `exp`) have historical edge-case rounding caveats in `mpmath`, and (c) interval dependency ($X - X \neq [0, 0]$) causes width blow-up on deep polynomial evaluations unless Bernstein or centered forms are used. |
| **4** | **Restricted Operation Whitelist** | Certified geometric enclosures (`Method C1-Cert`, `Method C2`, `Method C3`) are restricted **strictly** to the algebraic operation set: exact dyadic construction from `float`/`int`/`Fraction`, `+`, `-`, `*`, `/`, `iv.sqrt`, endpoint extraction (`.a`, `.b`), `.mid`, and `.delta`. Transcendental `mpmath.iv` functions are prohibited inside certified polynomial/arc-length enclosures. |
| **5** | **Qualification of Every Relied-Upon Operation** | Each whitelisted operation (`+`, `-`, `*`, `/`, `iv.sqrt`) is independently verified against an **exact rational (`fractions.Fraction`) reference enclosure** (using exact rational arithmetic for `+`, `-`, `*`, `/` and exact integer/rational square-root bounds $\underline{q}^2 \le r \le \overline{q}^2$ for `sqrt`) across $10,000$ adversarial inputs. |
| **6** | **Adversarial Interval Test Suite** | Tests include: exact $1 \pm 2^{-53}$ ULP boundaries, catastrophic cancellation $(1 + 2^{-52}) - 1$, near-zero subnormals ($2^{-1022}$), large coordinate translations ($\pm 10^6$), non-terminating rational divisions ($1/3, 1/7$), and non-square integer/rational square roots ($\sqrt{2}, \sqrt{3}, \sqrt{1 + 2^{-50}}$), asserting $\underline{Y}_{\mathrm{iv}} \le Y_{\mathrm{exact\_rational}} \le \overline{Y}_{\mathrm{iv}}$ on 100% of cases. |
| **7** | **Independent Verification of Representative Enclosures** | Representative `Method C1-Cert` and `Method C3` curve enclosures are independently recomputed using pure `fractions.Fraction` rational arithmetic (with rational upper/lower square-root bounds via Newton-Heron + positivity certificate $\underline{s}^2 \le N/D \le \overline{s}^2$) to confirm `mpmath.iv` enclosures strictly contain the exact rational enclosures. |
| **8** | **Qualification Failure & Downgrade Rule** | If any operation fails qualification or an unwhitelisted operation is invoked, the result **must not** be labeled `CERTIFIED_ENCLOSURE`; it must be downgraded to `UNQUALIFIED_INTERVAL_APPROXIMATION` and treated as `INCONCLUSIVE` at all release gates. |

---

## 4. Decision Part III — Re-Derived Offset Differential Geometry, Circle Sanity Check & Six-Category Offset Classification (`Critical Correction A`)

### 4.1 Complete First-Principles Derivation of the Offset Derivative Identity (`Critical Correction A`)
Let $\mathbf{B}(t) = (x(t), y(t))$, $t \in [0, 1]$, be a planar cubic Bézier curve in a right-handed Cartesian coordinate frame $(x, y)$ (`coordinate_convention: "CARTESIAN_RH_CCW"`):

1. **Velocity Vector and Squared Speed:**
   $$\mathbf{B}'(t) = \bigl(x'(t), \, y'(t)\bigr), \qquad Q(t) := x'(t)^2 + y'(t)^2 = \|\mathbf{B}'(t)\|_2^2 \ge 0.$$
2. **Domain Restriction for Unit Frame ($Q(t) > 0$):**
   The unit tangent $\hat{\mathbf{t}}(t)$, left unit normal $\hat{\mathbf{n}}_+(t)$, and curvature $\kappa(t)$ are defined **if and only if** $Q(t) > 0$. Points or sub-intervals where $Q(t) = 0$ (stationary points / base-curve zero-speed singularities) must be isolated and handled **separately** (`Section 4.3`) before applying any formula that divides by $\sqrt{Q(t)}$ or $Q(t)^{3/2}$.
3. **Unit Tangent and Left Unit Normal (for $Q(t) > 0$):**
   $$\hat{\mathbf{t}}(t) := \frac{\mathbf{B}'(t)}{\sqrt{Q(t)}} = \frac{\bigl(x'(t), \, y'(t)\bigr)}{\sqrt{Q(t)}}, \qquad \hat{\mathbf{n}}_+(t) := \frac{\bigl(-y'(t), \, x'(t)\bigr)}{\sqrt{Q(t)}}$$
   where $\hat{\mathbf{n}}_+(t)$ is obtained by rotating $\hat{\mathbf{t}}(t)$ by $+90^\circ$ counter-clockwise so $\det[\hat{\mathbf{t}}(t), \, \hat{\mathbf{n}}_+(t)] = +1$.
4. **Signed Curvature and Frenet–Serret Normal Derivative (for $Q(t) > 0$):**
   Define the signed cross-product numerator:
   $$C(t) := x'(t)y''(t) - y'(t)x''(t)$$
   and the signed curvature with respect to $\hat{\mathbf{n}}_+(t)$:
   $$\kappa(t) := \frac{C(t)}{Q(t)^{3/2}} = \frac{x'(t)y''(t) - y'(t)x''(t)}{\bigl(x'(t)^2 + y'(t)^2\bigr)^{3/2}}.$$
   Differentiating $\hat{\mathbf{n}}_+(t) = (-y'(t), x'(t)) Q(t)^{-1/2}$ directly with respect to $t$ using $Q'(t) = 2(x'x'' + y'y'')$:
   $$\frac{d}{dt}\hat{\mathbf{n}}_+(t) = \frac{\bigl(-y''(x'^2 + y'^2) + y'(x'x'' + y'y''), \;\; x''(x'^2 + y'^2) - x'(x'x'' + y'y'')\bigr)}{Q(t)^{3/2}} = -\frac{x'y'' - y'x''}{Q(t)^{3/2}}\bigl(x'(t), \, y'(t)\bigr) = -\kappa(t)\,\mathbf{B}'(t).$$
5. **Offset Curve Definition and Corrected Offset Derivative (`Critical Correction A`):**
   For offset distance $d > 0$ and offset-side sign $s \in \{-1, +1\}$ (where $s = +1$ offsets in the direction of the left normal $\hat{\mathbf{n}}_+(t)$ and $s = -1$ offsets in the direction of the right normal $-\hat{\mathbf{n}}_+(t)$):
   $$\mathbf{O}(t) := \mathbf{B}(t) + s\,d\,\hat{\mathbf{n}}_+(t).$$
   Differentiating $\mathbf{O}(t)$ with respect to $t$ on any interval where $Q(t) > 0$ and substituting $\hat{\mathbf{n}}_+'(t) = -\kappa(t)\,\mathbf{B}'(t)$ necessarily yields:
   $$\boxed{\mathbf{O}'(t) \;=\; \mathbf{B}'(t) + s\,d\,\hat{\mathbf{n}}_+'(t) \;=\; \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t) \;=\; \left(1 - \frac{s\,d\,C(t)}{Q(t)^{3/2}}\right)\mathbf{B}'(t)}$$
   Therefore, for $Q(t) > 0$, the **corrected dimensionless offset regularity factor** is:
   $$\boxed{f(t) \;:=\; 1 - s\,d\,\kappa(t) \;=\; 1 - \frac{s\,d\,C(t)}{Q(t)^{3/2}}}$$

### 4.2 Mandatory Analytical Sanity Check — Counter-Clockwise Circle of Radius $R > 0$ (`Section 3.1`)
Let $\mathbf{B}(\theta) = (R\cos\theta, \, R\sin\theta)$ for $\theta \in [0, 2\pi]$ (or $\theta = 2\pi t$, $t \in [0, 1]$) be a counter-clockwise (CCW) circle of radius $R > 0$:
1. **Derivatives & Curvature:**
   - $\mathbf{B}'(\theta) = (-R\sin\theta, \, R\cos\theta)$, $\quad \mathbf{B}''(\theta) = (-R\cos\theta, \, -R\sin\theta)$.
   - $Q(\theta) = R^2\sin^2\theta + R^2\cos^2\theta = R^2 > 0$, $\quad \sqrt{Q(\theta)} = R$.
   - $C(\theta) = (-R\sin\theta)(-R\sin\theta) - (R\cos\theta)(-R\cos\theta) = R^2 > 0$.
   - $\kappa(\theta) = \frac{C(\theta)}{Q(\theta)^{3/2}} = \frac{R^2}{R^3} = +\frac{1}{R} > 0$.
2. **Left Unit Normal Direction:**
   - $\hat{\mathbf{n}}_+(\theta) = \frac{(-y'(\theta), \, x'(\theta))}{\sqrt{Q(\theta)}} = (-\cos\theta, \, -\sin\theta)$, which points **radially inward** toward the circle center $(0, 0)$.
3. **Analytical Verification of All Five Circle Requirements:**

| Case | Offset Side $s$ & Distance $d > 0$ | Offset Curve $\mathbf{O}(\theta) = \mathbf{B}(\theta) + s\,d\,\hat{\mathbf{n}}_+(\theta)$ | Corrected Regularity Factor $f(\theta) = 1 - s\,d\,\kappa(\theta)$ | Derivative $\mathbf{O}'(\theta) = f(\theta)\,\mathbf{B}'(\theta)$ & Speed $\|\mathbf{O}'(\theta)\|_2$ | Geometric Behavior & Expected Classification |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **1. Inward Regular Offset** | $s = +1$,<br>$0 < d \le R(1 - \varepsilon_{\mathrm{margin}})$ | $(R - d)(\cos\theta, \sin\theta)$<br>*(Inward circle of radius $R - d > 0$)* | $f(\theta) = 1 - \frac{d}{R} = \frac{R - d}{R} \ge \varepsilon_{\mathrm{margin}} > 0$ | $\mathbf{O}'(\theta) = \left(1 - \frac{d}{R}\right)\mathbf{B}'(\theta)$,<br>$\|\mathbf{O}'(\theta)\|_2 = R - d$ | Smooth CCW circle of radius $R - d$; **`CERTIFIED_VALID`**. |
| **2. Inward Margin Violation** | $s = +1$,<br>$R(1 - \varepsilon_{\mathrm{margin}}) < d < R$ | $(R - d)(\cos\theta, \sin\theta)$<br>*(Inward circle of radius $R - d > 0$)* | $0 < f(\theta) = 1 - \frac{d}{R} < \varepsilon_{\mathrm{margin}}$ | $\|\mathbf{O}'(\theta)\|_2 = R - d \in (0, \varepsilon_{\mathrm{margin}}R)$ | Regular curve violating safety margin $\varepsilon_{\mathrm{margin}}$ (not a cusp); **`CERTIFIED_INVALID`** (`REGULARITY_MARGIN_VIOLATION`). |
| **3. Inward Evolute Singularity** | $s = +1$,<br>$d = R$ | $(0, 0)$<br>*(Degenerates to origin point)* | $f(\theta) = 1 - \frac{R}{R} = 0$ | $\mathbf{O}'(\theta) \equiv \mathbf{0}$,<br>$\|\mathbf{O}'(\theta)\|_2 = 0$ | Zero-speed evolute singularity everywhere; **`CERTIFIED_INVALID`** (`ACTUAL_ZERO_SPEED_CUSP`). |
| **4. Inward Over-Offset Reversal** | $s = +1$,<br>$d > R$ | $-(d - R)(\cos\theta, \sin\theta)$<br>*(Antipodal circle of radius $d - R$)* | $f(\theta) = 1 - \frac{d}{R} = -\frac{d - R}{R} < 0$ | $\mathbf{O}'(\theta) = -\frac{d - R}{R}\mathbf{B}'(\theta)$ *(opposite tangent)*,<br>$\|\mathbf{O}'(\theta)\|_2 = d - R$ | Local tangent orientation reversed everywhere ($f(\theta) < 0$); **`CERTIFIED_INVALID`** (`TANGENT_REVERSAL`). |
| **5. Outward Offset** | $s = -1$,<br>$\forall d > 0$ | $(R + d)(\cos\theta, \sin\theta)$<br>*(Outward circle of radius $R + d$)* | $f(\theta) = 1 - \frac{(-1)d}{R} = 1 + \frac{d}{R} = \frac{R + d}{R} > 1$ | $\mathbf{O}'(\theta) = \left(1 + \frac{d}{R}\right)\mathbf{B}'(\theta)$,<br>$\|\mathbf{O}'(\theta)\|_2 = R + d$ | Smooth CCW circle of radius $R + d$ for all $d > 0$; **`CERTIFIED_VALID`**. |

### 4.3 Separate Treatment of Zero-Speed Points ($Q(t) = 0$) & Rationalized Polynomial Predicates (`Section 3.2`)

1. **Mandatory Separate Treatment of Zero-Speed Base Points ($Q(t) = 0$):**
   - For a cubic Bézier curve $\mathbf{B}(t)$, $Q(t) = x'(t)^2 + y'(t)^2$ is a degree-4 polynomial with $Q(t) \ge 0$.
   - At any parameter $t^* \in [0, 1]$ where $Q(t^*) = 0$ (for example, coincident adjacent control points $\mathbf{P}_0 = \mathbf{P}_1$ giving $Q(0) = 0$, or an interior stationary cusp where $x'(t^*) = y'(t^*) = 0$), the base curve has zero speed and $\kappa(t) = C(t)/Q(t)^{3/2}$ is undefined.
   - **Rule:** Every offset verification routine must **first** evaluate $Q(t)$ on $[a, b]$ before applying any curvature or $P_{\mathrm{exact}}(t)$ predicate:
     - If $Q(t^*) = 0$ is proven at an endpoint or interior root on $[0, 1]$, it is classified directly as **`ACTUAL_ZERO_SPEED_CUSP`** (`sub_type: "BASE_CURVE_ZERO_SPEED_SINGULARITY"`).
     - If $\underline{Q([a,b])} \le 0 < \overline{Q([a,b])}$ remains unresolved at the subdivision budget limit, it is classified as **`INCONCLUSIVE_VERIFICATION`** (`reason: "BASE_SPEED_POSITIVITY_UNDECIDED"`).
     - Only when $\underline{Q([a,b])} > 0$ is certified on $[a, b]$ may the curvature formulas below be evaluated on $[a, b]$.

2. **Polynomial Predicates for Certified Positive-Speed Regimes ($Q(t) > 0$):**
   Define the signed offset-curvature product (degree-2 polynomial):
   $$S(t) \;:=\; s\,d\,C(t) \;=\; s\,d\,\bigl(x'(t)y''(t) - y'(t)x''(t)\bigr)$$
   so that for $Q(t) > 0$, the regularity factor is:
   $$f(t) \;=\; 1 - \frac{S(t)}{Q(t)^{3/2}}.$$
   - **Convex / Outward-From-Evolute Regime ($S(t) \le 0$):**
     Whenever $Q(t) > 0$ and $S(t) = s\,d\,C(t) \le 0$, we have $-\frac{S(t)}{Q(t)^{3/2}} \ge 0$ and therefore:
     $$f(t) = 1 + \frac{|S(t)|}{Q(t)^{3/2}} \ge 1 > \varepsilon_{\mathrm{margin}} > 0.$$
     No evolute cusp, tangent reversal, or regularity margin violation can occur where $S(t) \le 0$ and $Q(t) > 0$.
   - **Concave / Toward-Evolute Regime ($S(t) = s\,d\,C(t) > 0$):**
     Whenever $Q(t) > 0$ and $S(t) > 0$, both $Q(t)^{3/2} > 0$ and $S(t) > 0$ are strictly positive. Define the degree-6 exact evolute-cusp polynomial $P_{\mathrm{exact}}(t)$ and the degree-6 safety-margin polynomial $P_{\mathrm{margin}}(t)$ (for $\varepsilon_{\mathrm{margin}} \in (0, 1)$, default $\varepsilon_{\mathrm{margin}} = 0.05$):
     $$P_{\mathrm{exact}}(t) \;:=\; Q(t)^3 - d^2 C(t)^2, \qquad P_{\mathrm{margin}}(t) \;:=\; (1 - \varepsilon_{\mathrm{margin}})^2 Q(t)^3 - d^2 C(t)^2.$$
     Because $Q(t)^{3/2} + S(t) > 0$ and $(1 - \varepsilon_{\mathrm{margin}})Q(t)^{3/2} + S(t) > 0$ whenever $Q(t) > 0$ and $S(t) > 0$, factoring the difference of squares gives the exact equivalences:
     - **Certified Regularity with Margin ($f(t) \ge \varepsilon_{\mathrm{margin}}$):**
       $$f(t) \ge \varepsilon_{\mathrm{margin}} \;\iff\; S(t) \le (1 - \varepsilon_{\mathrm{margin}})Q(t)^{3/2} \;\iff\; \Bigl(S(t) \le 0 \;\;\text{or}\;\; \bigl(S(t) > 0 \;\wedge\; P_{\mathrm{margin}}(t) \ge 0\bigr)\Bigr).$$
     - **Regularity Margin Violation ($0 < f(t) < \varepsilon_{\mathrm{margin}}$):**
       $$0 < f(t) < \varepsilon_{\mathrm{margin}} \;\iff\; (1 - \varepsilon_{\mathrm{margin}})Q(t)^{3/2} < S(t) < Q(t)^{3/2} \;\iff\; \boxed{s\,d\,C(t) > 0 \;\wedge\; P_{\mathrm{exact}}(t) > 0 \;\wedge\; P_{\mathrm{margin}}(t) < 0}.$$
     - **Actual Evolute Zero-Speed Cusp ($f(t^*) = 0$ with $Q(t^*) > 0$):**
       $$f(t^*) = 0 \;\iff\; S(t^*) = Q(t^*)^{3/2} \;\iff\; \boxed{s\,d\,C(t^*) > 0 \;\wedge\; P_{\mathrm{exact}}(t^*) = 0}.$$
       *(Note: Applying $P_{\mathrm{exact}}(t^*) = 0$ without the sign condition $s\,d\,C(t^*) > 0$ is invalid because $s\,d\,C(t^*) = -Q(t^*)^{3/2} < 0$ also satisfies $Q(t^*)^3 - d^2 C(t^*)^2 = 0$ while giving $f(t^*) = 2$.)*
     - **Tangent Reversal ($f(t) < 0$ with $Q(t) > 0$):**
       $$f(t) < 0 \;\iff\; S(t) > Q(t)^{3/2} \;\iff\; \boxed{s\,d\,C(t) > 0 \;\wedge\; P_{\mathrm{exact}}(t) < 0}.$$

### 4.4 Six Mutually Distinct Offset Verification Failure Categories (`Corrected Sign Predicates`)
`M02f`, `M05.1`, and the `M00.4` oracle must classify every offset verification non-pass into one of **six independent categories**:

| Category ID | Failure Code | Mathematical Definition (`R2.1.2` Corrected) | Required Establishing Evidence (No Unproven Inference Permitted) |
| :---: | :--- | :--- | :--- |
| **1** | **`REGULARITY_MARGIN_VIOLATION`** | $Q(t) > 0$ and the offset regularity factor violates the safety margin $\varepsilon_{\mathrm{margin}} \in (0, 1)$ ($\varepsilon_{\mathrm{margin}} = 0.05$) without vanishing or reversing:<br>$$0 < f(t) = 1 - s\,d\,\kappa(t) < \varepsilon_{\mathrm{margin}}$$<br>Equivalently: $s\,d\,C(t) > 0$, $P_{\mathrm{exact}}(t) > 0$, and $P_{\mathrm{margin}}(t) < 0$. | Proven on a point $t_0 \in [0, 1]$ or sub-interval $[a,b] \subseteq [0, 1]$ where qualified outward-rounded interval evaluation establishes $\underline{Q([a,b])} > 0$, $\underline{s\,d\,C([a,b])} > 0$, $\underline{P_{\mathrm{exact}}([a,b])} > 0$, and $\overline{P_{\mathrm{margin}}([a,b])} < 0$ across the global minimum of $f$. **Must never be reported as an actual cusp or tangent reversal.** |
| **2** | **`ACTUAL_ZERO_SPEED_CUSP`** | Either:<br>**(2a) Base-Curve Zero-Speed Singularity:** $Q(t^*) = x'(t^*)^2 + y'(t^*)^2 = 0$, or<br>**(2b) Offset Evolute Singularity:** $Q(t^*) > 0$ and $f(t^*) = 1 - s\,d\,\kappa(t^*) = 0$, i.e.:<br>$$s\,d\,C(t^*) > 0 \quad\text{and}\quad P_{\mathrm{exact}}(t^*) = Q(t^*)^3 - d^2 C(t^*)^2 = 0.$$ | Requires either:<br>**(2a)** Exact rational/Bernstein root certificate proving $Q(t^*) = 0$ (e.g., coincident control points at $t \in \{0, 1\}$ or isolated stationary root where $x'(t^*)=y'(t^*)=0$), or<br>**(2b)** A verified root bracket $[t_a, t_b] \subseteq [0, 1]$ with $\underline{Q([t_a, t_b])} > 0$ and $\underline{s\,d\,C([t_a, t_b])} > 0$ where either $P_{\mathrm{exact}}(t_a)\cdot P_{\mathrm{exact}}(t_b) \le 0$ with $0 \notin P_{\mathrm{exact}}'([t_a, t_b])$ (simple transverse root) or exact rational GCD / Sturm-Habicht square-free factorization proves a real root of $P_{\mathrm{exact}}(t) = 0$ on $[t_a, t_b]$ (covering tangential/even-multiplicity roots). |
| **3** | **`TANGENT_REVERSAL`** | $Q(t) > 0$ and the offset tangent vector points strictly opposite to the base tangent:<br>• **Exact Offset:** $f(t) = 1 - s\,d\,\kappa(t) < 0$, i.e.:<br>$$s\,d\,C(t) > Q(t)^{3/2} \iff s\,d\,C(t) > 0 \;\wedge\; P_{\mathrm{exact}}(t) < 0$$<br>• **Fitted Cubic Offset $\tilde{\mathbf{O}}(u)$:** $D(u) := \tilde{\mathbf{O}}'(u)\cdot \mathbf{B}'(t(u)) < 0$. | Requires a point $t_0 \in [0, 1]$ or sub-interval $[a,b] \subseteq [0, 1]$ where qualified outward-rounded interval evaluation proves:<br>$\underline{Q([a,b])} > 0$, $\underline{s\,d\,C([a,b])} > 0$, and $\overline{P_{\mathrm{exact}}([a,b])} < 0$ (or $\overline{D([u_a, u_b])} < 0$). |
| **4** | **`LOCAL_OFFSET_SELF_INTERSECTION`** | Two distinct parameters $t_1^* < t_2^*$ within a local concave offset neighborhood or adjacent corner miter transition satisfy $\mathbf{O}(t_1^*) = \mathbf{O}(t_2^*)$ (or $\tilde{\mathbf{O}}_k(u_1^*) = \tilde{\mathbf{O}}_m(u_2^*)$). | Requires an isolated 2D intersection root box $[t_{1,a}, t_{1,b}] \times [t_{2,a}, t_{2,b}]$ with $t_{1,b} < t_{2,a}$ verified by a contractive 2D interval Krawczyk / Newton operator or exact transverse segment crossing certificate. |
| **5** | **`GLOBAL_CONTOUR_SELF_INTERSECTION`** | Two non-local segments $(i, j)$ of the assembled closed cutting contour intersect away from shared topological vertices: $\tilde{\mathbf{O}}_i(u^*) = \tilde{\mathbf{O}}_j(v^*)$. | Requires broad-phase bounding-box overlap (`STRtree`) followed by a verified 2D interval Krawczyk / transverse crossing certificate between non-adjacent contour segments. **Local curvature checks (`Categories 1–3`) never establish the absence of `GLOBAL_CONTOUR_SELF_INTERSECTION`.** |
| **6** | **`INCONCLUSIVE_VERIFICATION`** | The bounded verification procedure cannot mathematically prove either validity (`CERTIFIED_VALID`) or a specific violation (`Categories 1–5`) within its permitted subdivision depth, precision, or compute budget (including unresolved grazing/even-multiplicity roots under interval arithmetic). | Triggered whenever any sub-interval $[a,b]$ straddles zero ($\underline{F([a,b])} \le 0 \le \overline{F([a,b])}$) at maximum depth and escalation limit without an isolated root certificate or strictly violating upper/lower bound (`Section 5`). **Must never be mislabeled as `Categories 1–5`.** |

### 4.5 Mandatory 14 Adversarial Geometry Test Families (`Section 3.3`)
Passing a finite test suite is necessary bug-detection evidence, **never** a substitute for the mathematical derivations in `Sections 2–4`. Every `M00.4` oracle and `M02f` offset verifier implementation must be tested against all **14 required adversarial geometry test families**:

| # | Adversarial Test Family | Concrete Mathematical Construction | Expected Mathematical Behavior | Expected Classification & Outcome | Required Persisted Evidence | Failure Condition (Reject Implementation If Observed) |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Circle Inward Offsets (Regular)** | CCW circle radius $R = 10\text{ cm}$, inward left normal $s = +1$, $d = 2.0\text{ cm}$, $\varepsilon_{\mathrm{margin}} = 0.05$. | Exact inward circle of radius $R - d = 8.0\text{ cm}$; $f(t) \equiv 1 - d/R = 0.80 \ge 0.05$. | `CERTIFIED_VALID` (`failure_category: "NONE"`) | $\underline{f([0,1])} \ge 0.7999$, arc length $2\pi(8.0)\text{ cm}$ within $B_{\mathrm{cert}}$. | Misclassifying inward circle as outward ($R+d=12$) or reporting any failure category. |
| **2** | **Circle Outward Offsets** | CCW circle radius $R = 10\text{ cm}$, outward right normal $s = -1$, $d \in \{2.0, 10.0, 15.0\}\text{ cm}$. | Exact outward circle of radius $R + d \in \{12, 20, 25\}\text{ cm}$; $s\,d\,C(t) < 0 \implies f(t) \equiv 1 + d/R > 1$. | `CERTIFIED_VALID` (`failure_category: "NONE"`) for all $d > 0$ including $d \ge R$. | $\underline{f([0,1])} \ge 1 + d/R - 10^{-12}$; zero false cusps at $d = R$. | Falsely reporting a cusp at $d=R$ or reversal at $d>R$ when $s = -1$ (`R2.1.1` sign bug). |
| **3** | **Offset Distance Equal to Circle Radius** | CCW circle radius $R = 10\text{ cm}$ (or exact circular/cubic arc with curvature $\kappa(t^*) = 1/R$), inward $s = +1$, $d = R = 10.0\text{ cm}$. | $f(t^*) = 1 - R/R = 0$; $s\,d\,C(t^*) > 0$ and $P_{\mathrm{exact}}(t^*) = 0$. | `CERTIFIED_INVALID` (`ACTUAL_ZERO_SPEED_CUSP`) | Root certificate on $P_{\mathrm{exact}}(t^*) = 0$ with $\underline{s\,d\,C} > 0$. | Returning `CERTIFIED_VALID`, `REGULARITY_MARGIN_VIOLATION`, or `TANGENT_REVERSAL`. |
| **4** | **Offset Slightly Below & Slightly Above Circle Radius** | **(4a) Slightly Below:** CCW arc radius $R = 10\text{ cm}$, $s = +1$, $d = 9.70\text{ cm}$ ($\varepsilon_{\mathrm{margin}} = 0.05$).<br>**(4b) Slightly Above:** $s = +1$, $d = 10.30\text{ cm}$. | **(4a)** $f(t) = 1 - 9.7/10 = +0.03 \in (0, 0.05)$ ($P_{\mathrm{exact}} > 0, P_{\mathrm{margin}} < 0$).<br>**(4b)** $f(t) = 1 - 10.3/10 = -0.03 < 0$ ($P_{\mathrm{exact}} < 0$). | **(4a)** `CERTIFIED_INVALID` (`REGULARITY_MARGIN_VIOLATION`)<br>**(4b)** `CERTIFIED_INVALID` (`TANGENT_REVERSAL`) | **(4a)** $\underline{P_{\mathrm{exact}}} > 0 \wedge \overline{P_{\mathrm{margin}}} < 0$.<br>**(4b)** $\underline{s\,d\,C} > 0 \wedge \overline{P_{\mathrm{exact}}} < 0$. | Conflating (4a) with an actual cusp/reversal or accepting (4b) as valid. |
| **5** | **Zero-Speed Input Parameterizations** | Cubic Bézier with coincident control points $\mathbf{P}_0 = \mathbf{P}_1 = (0,0)$, $\mathbf{P}_2 = (5,0)$, $\mathbf{P}_3 = (10,5)$ so $\mathbf{B}'(0) = \mathbf{0}$, $Q(0) = 0$. | $Q(0) = 0$; unit normal $\hat{\mathbf{n}}_+(0)$ and $\kappa(0) = C(0)/Q(0)^{3/2}$ are undefined ($0/0$). | `CERTIFIED_INVALID` (`ACTUAL_ZERO_SPEED_CUSP`, `sub_type: "BASE_CURVE_ZERO_SPEED_SINGULARITY"`) | Exact boundary evaluation $Q(0) = 0$ caught before curvature division. | Division by zero `NaN` crash or falsely passing $Q(0)^3 - d^2 C(0)^2 = 0 - 0 = 0$ as smooth. |
| **6** | **Interior Stationary Points** | Cubic Bézier with interior cusp at $t^* = 0.25$ or $t^* = 1/2$: e.g., $\mathbf{B}(t)$ with $x'(t^*) = y'(t^*) = 0 \implies Q(t^*) = 0$ (`DEF-M00-02`). | Base curve stops and reverses/cusps at $t^* \in (0, 1)$; $Q(t^*) = 0$ with $Q(t) \ge 0$ (even-multiplicity minimum of $Q$). | `CERTIFIED_INVALID` (`ACTUAL_ZERO_SPEED_CUSP`) | Exact rational GCD / Sturm-Habicht or collinear-derivative root certificate for $x'(t^*) = y'(t^*) = 0$. | Missing $t^* = 0.25$ (3-point sampling bug) or failing because $Q(t) \ge 0$ has no sign change. |
| **7** | **Near-Cusp Curves** | Smooth cubic Bézier with tight loop throat where $\min_t Q(t) = 10^{-5}\text{ cm}^2 > 0$ and peak curvature $\kappa(t_{\max}) = 0.99 / d$ for $s = +1$. | Base curve is regular ($Q(t) > 0$), offset has $f(t_{\min}) = 0.01 \in (0, \varepsilon_{\mathrm{margin}})$. | `CERTIFIED_INVALID` (`REGULARITY_MARGIN_VIOLATION`) | Certified positive $\underline{Q} > 0$, $\underline{P_{\mathrm{exact}}} > 0$, $\overline{P_{\mathrm{margin}}} < 0$. | Misclassifying as `ACTUAL_ZERO_SPEED_CUSP` or `TANGENT_REVERSAL`. |
| **8** | **Tangential Evolute Roots** | Cubic Bézier with curvature maximum $\kappa(t^*) = 1/d$ at interior point $t^* \in (0, 1)$ ($s = +1$), so $f(t^*) = 0$, $f'(t^*) = 0$, and $f(t) \ge 0$ on $[0, 1]$. | Offset touches the evolute tangentially at $t^*$; $P_{\mathrm{exact}}(t^*) = 0$ is a double root without sign change ($P_{\mathrm{exact}}(t) \ge 0$). | `CERTIFIED_INVALID` (`ACTUAL_ZERO_SPEED_CUSP`) under Step 2 exact rational GCD/Sturm escalation (or `INCONCLUSIVE` prior to rational escalation). | Square-free factorization $\gcd(P_{\mathrm{exact}}, P_{\mathrm{exact}}')$ in `fractions.Fraction` isolating $t^*$ with $\underline{s\,d\,C} > 0$. | Falsely returning `CERTIFIED_VALID` because $P_{\mathrm{exact}}(t) \ge 0$ never changes sign at sample points. |
| **9** | **Even-Multiplicity Roots** | Polynomial predicate $P_{\mathrm{exact}}(t)$ or $P_{\mathrm{margin}}(t)$ constructed with a root of multiplicity $2m$ ($m \ge 1$) at $t^* = 3/8$. | Function touches zero and rebounds without crossing zero; Bolzano sign-change test $P(t_a)P(t_b) < 0$ cannot trigger. | `CERTIFIED_INVALID` (if proven via rational square-free Sturm escalation) or `INCONCLUSIVE` (if interval-only). **Never `CERTIFIED_VALID`.** | Exact rational square-free decomposition or straddling interval $[t_a, t_b]$ with $0 \in P([t_a, t_b])$. | Returning `CERTIFIED_VALID` on an even-multiplicity root. |
| **10** | **Roots at Interval Endpoints & Dyadic Boundaries** | Curves where $f(t^*) = 0$ occurs exactly at $t^* = 0$, $t^* = 1$, or a dyadic subdivision midpoint $t^* = 0.5, 0.25, 0.125$. | Exact zero occurs on boundary between sub-intervals. | `CERTIFIED_INVALID` (`ACTUAL_ZERO_SPEED_CUSP`) | Exact endpoint evaluation + closed-interval boundary inclusion in subdivision tree. | Dropping boundary points via open-interval $(a, b)$ checks. |
| **11** | **Near-Zero Regularity Margins** | Curves with $\min_{t \in [0,1]} f(t) = \varepsilon_{\mathrm{margin}} + 10^{-7}$ (`11a`, valid) vs. $\min_{t \in [0,1]} f(t) = \varepsilon_{\mathrm{margin}} - 10^{-7}$ (`11b`, invalid). | (`11a`) Strictly above $\varepsilon_{\mathrm{margin}}$.<br>(`11b`) Strictly below $\varepsilon_{\mathrm{margin}}$ but $> 0$. | (`11a`) `CERTIFIED_VALID` (after precision escalation if needed).<br>(`11b`) `CERTIFIED_INVALID` (`REGULARITY_MARGIN_VIOLATION`). | Interval enclosure width $< 10^{-7}$ separating $\min f$ from $\varepsilon_{\mathrm{margin}}$ (or `INCONCLUSIVE` if budget capped). | Returning `CERTIFIED_VALID` on (`11b`) or `ACTUAL_ZERO_SPEED_CUSP` on (`11b`). |
| **12** | **Local Self-Intersections** | Concave cubic curve with $s = +1$ and $d > 1/\kappa_{\max}$ forming a local swallowtail loop where $\mathbf{O}(t_1^*) = \mathbf{O}(t_2^*)$ ($t_1^* < t_2^*$), or untrimmed corner miter crossover. | Offset curve crosses itself locally at $t_1^* < t_2^*$. | `CERTIFIED_INVALID` (`LOCAL_OFFSET_SELF_INTERSECTION`, plus `TANGENT_REVERSAL` on the reversed middle branch). | Isolated 2D Krawczyk intersection box $[t_{1,a}, t_{1,b}] \times [t_{2,a}, t_{2,b}]$ with $t_{1,b} < t_{2,a}$. | Failing to detect the self-crossing loop or leaving untrimmed loop in cutting contour. |
| **13** | **Global Self-Intersections** | Narrow U-shaped keyhole/slit contour of width $1.5\text{ cm}$ where every individual segment is gently curved ($f(t) > 0.8$ locally everywhere), offset outward by $d = 1.0\text{ cm}$. | Opposite seam allowances collide across the $1.5\text{ cm}$ gap ($2d = 2.0\text{ cm} > 1.5\text{ cm}$), intersecting non-locally. | `CERTIFIED_INVALID` (`GLOBAL_CONTOUR_SELF_INTERSECTION`) | `STRtree` broad-phase pair + verified 2D interval Krawczyk crossing between non-adjacent segments $(i, j)$. | Passing contour as `CERTIFIED_VALID` because all local curvature checks (`Categories 1–3`) pass. |
| **14** | **Inconclusive / Budget-Exhausted Curves** | Curve with $\min_t f(t) = \varepsilon_{\mathrm{margin}} + 10^{-30}$ evaluated under a capped subdivision budget ($d_{\max} = 4$, escalation disabled). | Interval enclosure $[\underline{P_{\mathrm{margin}}}, \overline{P_{\mathrm{margin}}}]$ straddles zero at budget exhaustion; neither validity nor violation is proven. | **`INCONCLUSIVE`** (`failure_category: "INCONCLUSIVE_VERIFICATION"`, blocking release gates). | `unresolved_intervals` non-empty with $\underline{F} \le 0 \le \overline{F}$ and `escalation_trace` logged. | Misreporting `INCONCLUSIVE` as `CERTIFIED_VALID` or as a confirmed cusp (`ACTUAL_ZERO_SPEED_CUSP`). |

---

## 5. Decision Part IV — Tri-State Interval Verification & Depth-Limit Governance (`Correction D`, Updated with Corrected Signs)

### 5.1 Tri-State Verification Outcomes
Every interval-based geometric verification procedure in `M00.4`, `M02a`, `M02b`, `M02f`, `M02h`, and `M05.1` must return one of three mutually exclusive outcomes:

1. **`CERTIFIED_VALID`**:
   - Every required validity condition is mathematically proven across the entire parameter domain $t \in [0, 1]$ (and across all contour segment pairs):
     - Base speed strictly positive: $\underline{Q([a,b])} \ge v_{\mathrm{floor}}^2 > 0$ on all sub-intervals $[a,b]$ partitioning $[0, 1]$,
     - Offset regularity margin strictly satisfied: on every sub-interval $[a,b]$ partitioning $[0, 1]$, either $\overline{s\,d\,C([a,b])} \le 0$ (convex/outward-from-evolute) or $\underline{P_{\mathrm{margin}}([a,b])} > 0$ where $P_{\mathrm{margin}}(t) = (1 - \varepsilon_{\mathrm{margin}})^2 Q(t)^3 - d^2 C(t)^2$,
     - Fitted offset tangent alignment $\underline{D([u_a, u_b])} > 0$ and normal/radial deviation $\overline{\delta_{\mathrm{rad}}([u_a, u_b])} \le \tau_{\mathrm{offset}}$,
     - Zero local or global self-intersections (`STRtree` + 2D Bernstein/interval pruning proves $\mathbf{0} \notin \tilde{\mathbf{O}}_i([u_a,u_b]) - \tilde{\mathbf{O}}_j([v_a,v_b])$ for all non-shared pairs).
2. **`CERTIFIED_INVALID`**:
   - At least one validity condition is **mathematically proven to be violated** (`Categories 1–5` in `Section 4.4`), established by a strictly violating interval bound or a validated root / intersection certificate.
3. **`INCONCLUSIVE`**:
   - No sub-interval is proven `CERTIFIED_INVALID`, **and** at least one sub-interval $[a, b]$ remains undecided ($\underline{F([a,b])} \le 0 \le \overline{F([a,b])}$) when the verification budget ($d_{\max} = 20$), interval dependency overestimation, or conditioning limit is reached.
   - **Hard Non-Conflation Rule:** An `INCONCLUSIVE` result **must never** be reported as a confirmed cusp, tangent reversal, or self-intersection, and **must never** pass downstream release gates (`AC-03`, `AC-05`, `AC-10`).

### 5.2 Mandatory Escalation & Next-Action Protocol by Outcome

| Outcome | Automated Engine Action (`M02f` / `M05.1`) | Escalation & Governance Action | Downstream Release-Gate Disposition (`AC-03`, `AC-05`, `AC-10`) |
| :--- | :--- | :--- | :--- |
| **`CERTIFIED_VALID`** | Accept contour/segment; attach `OffsetValidationRecord` with `outcome = "CERTIFIED_VALID"` to revision manifest. | None required. | **PASS** — Eligible for promotion to `Validated` (`Gate G3`). |
| **`CERTIFIED_INVALID`** | 1. Record exact proven failure category (`Category 1`–`5`), parameter bracket $[t_a, t_b]$, and spatial coordinates.<br>2. If failure is a trimmable concave offset loop (`Categories 1–4` on allowance curve with regular base stitch curve $\underline{Q} > 0$), execute deterministic envelope trimming and re-run complete tri-state verification on the trimmed contour.<br>3. If base stitch curve has $Q(t^*)=0$ or trimming fails, halt and return `CERTIFIED_INVALID`. | Surface exact geometric defect location in `apps/web` CAD diagnostics for patternmaker correction. | **FAIL-CLOSED REJECT** — Blocks transition to `Validated`, `Fit_Approved`, `Sample_Approved`, and `Production_Ready`. |
| **`INCONCLUSIVE`** | **Step 1 (Localized Precision & Depth Escalation):** Re-evaluate undecided sub-intervals $[a,b]$ using centered/Taylor-form interval arithmetic in qualified `mpmath.iv` at `mp.dps = 80` with up to $+4$ localized bisection levels ($d \le 24$).<br>**Step 2 (Exact Rational Square-Free Sturm / Bernstein Escalation):** Convert polynomial coefficients to exact `fractions.Fraction`, compute square-free part $P_{\mathrm{sf}} = P / \gcd(P, P')$ (resolving tangential/even-multiplicity roots), and run exact Sturm-Habicht / Descartes root isolation on $[a,b]$.<br>**Step 3 (Persist Inconclusive Record):** If still undecided (e.g., non-polynomial fitted parameter reparameterization), persist `outcome = "INCONCLUSIVE"` with reason code (`SUBDIVISION_DEPTH_EXHAUSTED`, `INTERVAL_DEPENDENCY_OVERESTIMATION`, or `GRAZING_TANGENTIAL_JACOBIAN_SINGULAR`). | Escalate to independent offline oracle verification and manual computational-geometry / lead-patternmaker expert review. | **FAIL-CLOSED HOLD (Without Misclassification)** — Downstream release gates require `CERTIFIED_VALID` and block automatic promotion of `INCONCLUSIVE` contours while preserving the `INCONCLUSIVE` label in all logs and records. |

### 5.3 Persisted Offset Validation Record Schema (`OffsetValidationRecord`)
```json
{
  "segment_id": "bodice_front_armscye_seg_02",
  "verification_outcome": "CERTIFIED_VALID | CERTIFIED_INVALID | INCONCLUSIVE",
  "failure_category": "NONE | REGULARITY_MARGIN_VIOLATION | ACTUAL_ZERO_SPEED_CUSP | TANGENT_REVERSAL | LOCAL_OFFSET_SELF_INTERSECTION | GLOBAL_CONTOUR_SELF_INTERSECTION | INCONCLUSIVE_VERIFICATION",
  "coordinate_convention": "CARTESIAN_RH_CCW",
  "offset_formula_convention": "O(t) = B(t) + s * d * n_plus(t); O'(t) = (1 - s * d * kappa(t)) * B'(t)",
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

## 6. Decision Part V — Five-Dimensional Qualification of Oracle Independence (`Critical Correction F`)

Do not claim "absolute oracle independence" merely because the `M00.4` oracle and `M02` production implementation reside in separate directories or use different high-level algorithms. `ADR-009` distinguishes five specific dimensions of independence, documents shared dependencies transparently, and specifies mandatory requirements for `M00` vs. `M02` vs. future scale:

| Independence Dimension | Definition | Status & Shared-Dependency Disclosure in `R2.1.2` | Requirement Level |
| :--- | :--- | :--- | :---: |
| **1. Algorithmic Independence** | Use of mathematically distinct evaluation procedures between the oracle (`M00.4`) and production runtime (`M02`). | **Satisfied:** `M00.4` uses De Casteljau chord/polygon interval enclosure (`Method C1-Cert`), exact rational Green's polynomial (`fractions.Fraction`), and exact analytical offset equations $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\hat{\mathbf{n}}_+(t)$ + rational Sturm root isolation; `M02` runtime uses `float64` adaptive Gauss–Legendre quadrature, centroid-shifted `float64` bilinear area with Higham bound, and hodograph cubic offset spline fitting $\tilde{\mathbf{O}}(u)$. | **MANDATORY for `M00` & `M02`** |
| **2. Source-Code Independence** | Zero shared domain calculation modules, helper functions, or code imports between `tests/oracles/` (`M00.4`) and `app/pattern_engine/` (`M02`). | **Satisfied:** Enforced by CI AST import-graph linter (`AC-04`). | **MANDATORY for `M00` & `M02`** |
| **3. Arithmetic & Library Independence** | Independence of the underlying numerical/interval arithmetic libraries and number representations. | **Qualified / Shared Dependency Disclosed:**<br>• **Algebraic & Polynomial Predicates (Fully Independent):** `M00.4` evaluates Green's area (`Method C2`), polynomial coefficients ($Q, C, P_{\mathrm{exact}}, P_{\mathrm{margin}}$), and Sturm root isolation in **exact rational arithmetic (`fractions.Fraction`)**, which is 100% independent of IEEE 754 `float64` and `mpmath.iv`.<br>• **Square-Root & Interval Enclosures (Shared `mpmath.iv` Dependency):** Where both `M00.4` and `M02` runtime certification call `mpmath.iv`, they share the `mpmath` library. To prevent a shared `mpmath.iv` bug from going undetected, `M00.4` qualifies `mpmath.iv` operations against an independent exact rational (`fractions.Fraction`) square-root bracketing checker (`Section 3.4`). Full dual-library heterogeneous interval checking (`mpmath.iv` vs. C-ARB `python-flint` / `MPFI`) is designated as a secondary defense. | **Rational cross-check MANDATORY for `M00`; Dual-library (`python-flint`) DESIRABLE / Stage 2 (`M02`/`M10`)** |
| **4. Input & Fixture Independence** | Generation of normative (`Class B`) test vectors from analytical formulas and oracle calculations rather than snapshotting production outputs. | **Satisfied:** `Class B` fixtures (`M00.3`/`M00.4`) are derived strictly from closed-form analytical curves (circles, straight lines, known rational cusps) and independent oracle evaluations before `M02` exists. | **MANDATORY for `M00` & `M02`** |
| **5. Reviewer & Verification Independence** | Independent technical and mathematical audit of oracle specifications, qualification reports, and gate evidence. | **Satisfied:** Gate transitions (`Gate Auth-1` through `Gate Auth-6`) require independent review sign-off separate from implementation execution. | **MANDATORY for All Gates (`Auth-1`–`Auth-6`)** |

---

## 7. Consequences & Governance Enforcement (`Critical Corrections D & E`)
1. **Resolution of `DEC-13` / `Gate Auth-1` Circularity (`Critical Correction D`):**
   - **`DEC-13 Stage 1` (At `Gate Auth-1` — Blocks `M00` Commencement):** Approves the initial reference-oracle library architecture (`fractions.Fraction` + `mpmath.iv` + exact Bernstein basis) for `M00.4` based on static mathematical/architectural review of `ADR-009` (`R2.1.2`) (or an optional, separately authorized non-production technology spike `SPIKE-DEC13-01` if requested by the Owner). **Zero `M00.4` execution is required prior to `Gate Auth-1`.**
   - **`DEC-13 Stage 2` (At `Gate Auth-2` — Blocks `M02a`/`M02f` Production Implementation):** Requires the empirical `< 5 ms` per-piece runtime verification benchmark across the 63 reference contours and the `IntervalLibraryQualificationReport` (`Section 3.4`) produced during `M00.4` before `M02a`/`M02f` production implementation begins (or activates `python-flint` C-ARB acceleration).
2. **Non-Authorization Invariant:**
   - **R2.1.2 publication does not authorize M00. M00 remains blocked pending explicit owner approval.**
