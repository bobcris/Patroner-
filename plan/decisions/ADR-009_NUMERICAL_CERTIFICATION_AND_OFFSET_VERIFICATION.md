# ADR-009 — FIVE-CONCEPT NUMERICAL CERTIFICATION, PARAMETER-TO-OUTPUT PROPAGATION (`METHOD B1/B2`), FOUR-LAYER `METHOD C1-CERT` ASSURANCE, CANONICAL OFFSET GEOMETRY ($\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$), ZERO-SPEED PARAMETERIZATION VS. GEOMETRIC SINGULARITY, SIX-CATEGORY OFFSET TAXONOMY, 17-FAMILY CLASSIFICATION MATRIX & FIVE-DIMENSIONAL ORACLE INDEPENDENCE (`R2.1.2-R1`)

- **ADR ID:** `ADR-009`
- **Revision:** `2.1.2-R1` (Controlled Mathematical Correction to `R2.1.2`: Canonical Normal Convention, Four CCW Circle Cases, Zero-Speed Parameterization vs. Geometric Singularity, Six-Category Offset Taxonomy, 17-Family Classification Matrix & Candidate Library Qualification Status)
- **Status:** `PROPOSED` (Requires Formal Engineering Governance Approval across the Four-Decision Lifecycle (`Section 7` / `DEC-13` in `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`): **Decision 1 — Candidate Selection (`DEC-13 Stage 1`)** at `Gate Auth-1` before `M00.4` execution; **Decision 2 — Library Qualification (`IntervalLibraryQualificationReport`)** and **Decision 3 — Oracle Implementation Verification** executed during `M00.4`/`M00.10`; **Decision 4 — Production Adoption (`DEC-13 Stage 2`)** at `Gate Auth-2` before `M02a`/`M02f` production implementation)
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05`, `Ch. 09`, `App. A2–A3`, `App. F`), `Dossier 03 v5.1` (Deterministic Pattern Geometry), `Dossier 06 v5.4` (Validation, Benchmarks & Model Credibility), `Dossier 14 v5.12` (Manufacturing Constraints & Production Release), `ADR-003`, `REQ-GEO-01`, `REQ-GEO-02`, `DEF-M00-01`, `DEF-M00-02`, `DEF-M00-06`

---

## 1. Context & Problem Statement

In Blueprint `R2.1.2` (`commit 724fc09b621b1fc623967f5228e5c0f1108c9422`), the offset tangent derivative sign error from `R2.1.1` was corrected to $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, parameter uncertainty was separated from geometric output error (`Method B1/B2`), `Method C1-Cert` was decomposed into four assurance layers, and `DEC-13` was split across `Gate Auth-1` and `Gate Auth-2`. However, an independent mathematical audit of `R2.1.2` identified five remaining mathematical and assurance issues that **Blueprint Revision `R2.1.2-R1`** resolves:

1. **Zero-Speed Parameterization vs. Geometric Singularity (`Critical Correction C`):**
   `R2.1.2` (`ADR-009 §4.3`, `§4.4 Category 2a`, `§4.5 Test Family 5`, `ADR-003`, `04`, `06`, `M00`, `M02`) stated that **every** parameter $t^*$ with $Q(t^*) = x'(t^*)^2 + y'(t^*)^2 = 0$ is automatically classified as `ACTUAL_ZERO_SPEED_CUSP`. That rule is mathematically false: $Q(t^*) = 0$ is a property of the **parameterization** (stationary speed), not automatically a geometric singularity of the curve image or its offset. For example, on $\mathbf{B}(t) = (t^3, 0)$, $\mathbf{B}'(t) = (3t^2, 0)$ and $Q(t) = 9t^4$, so $Q(0) = 0$, yet the geometric image is a smooth straight line with constant unit tangent $\mathbf{T} = (1, 0)$, constant unit normal $\mathbf{N}_+ = (0, 1)$, zero curvature $\kappa \equiv 0$, and smooth straight-line offset $\mathbf{O}(t) = (t^3, s\,d)$. Similarly, a cubic Bézier with collinear coincident control points (such as `R2.1.2` `Test Family 5`: $\mathbf{P}_0 = \mathbf{P}_1 = (0,0), \mathbf{P}_2 = (5,0), \mathbf{P}_3 = (10,5)$) has $Q(0) = 0$ at $t=0$ with a well-defined limiting unit tangent $\mathbf{T}_{\lim}(0) = (1, 0)$ and zero limiting curvature $\kappa_{\lim}(0) = 0$ (removable parameterization degeneracy), rather than a geometric cusp.
2. **Canonical Four CCW Circle Cases (`Critical Correction B`):**
   `R2.1.2` `§4.2` presented a 5-row CCW circle table that mixed regularity-margin discussion with collapse and over-offset cases. `R2.1.2-R1` establishes the canonical four CCW circle cases ($s=+1, 0<d<R$ regular inward circle; $s=+1, d=R$ complete inward offset collapse $\mathbf{O}(t) \equiv (0,0), \mathbf{O}'(t) \equiv \mathbf{0}$; $s=+1, d>R$ inward over-offset with $f < 0$ tangent reversal and **no zero-speed point**; $s=-1, d>0$ regular outward circle with $f = 1 + d/R > 0$).
3. **One Canonical Normal Notation (`Critical Correction A`):**
   Standardizes notation across all `plan/` documents to $\mathbf{T}(t)$, $\mathbf{N}_+(t) = \frac{(-y'(t), x'(t))}{\sqrt{Q(t)}}$, $\mathbf{N}_+'(t) = -\kappa(t)\mathbf{B}'(t)$, $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$, and $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, with $s = +1$ (left-normal; **inward** on a CCW exterior contour) and $s = -1$ (right-normal; **outward** seam-allowance direction on a CCW exterior contour).
4. **Six-Category Offset Taxonomy & 17-Family Classification Test Matrix (`Critical Corrections D & E`):**
   Separates the six offset classifications (`REGULARITY_MARGIN_VIOLATION`, `ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`, `TANGENT_REVERSAL`, `LOCAL_SELF_INTERSECTION`, `GLOBAL_SELF_INTERSECTION`, `INCONCLUSIVE`), expands the verification matrix to the complete **17-Family Classification Test Matrix**, and explicitly distinguishes **required future verification tests** (for `M00.4` and `M02f`) from **executed documentation-audit checks**.
5. **Candidate Library Status & Four-Decision Governance (`Critical Corrections F & G`):**
   Explicitly states that `mpmath.iv` is a **candidate numerical library**, `IntervalLibraryQualificationReport` is a **required future artifact** (not yet existing or passed), and distinguishes the four separate decisions: (1) Candidate selection, (2) Library qualification, (3) Oracle implementation verification, and (4) Production adoption.

---

## 2. Five-Concept Numerical Assurance Framework & Parameter-to-Output Error Propagation

### 2.1 The Five Distinct Numerical Concepts

Every numerical comparison and verification gate in `M00.4` (independent reference oracle in `services/fashion-engine/tests/oracles/`) and `M02` (authoritative production engine in `services/fashion-engine/app/pattern_engine/`) must explicitly distinguish and record five quantities for any geometric functional or point coordinate $X$ (scalar $X \in \mathbb{R}$ with $|\cdot|$, or vector $\mathbf{X} \in \mathbb{R}^2$ with Euclidean norm $\|\cdot\|_2$):

1. **Exact Mathematical Quantity ($X_{\mathrm{exact}}$):**
   The true real-valued mathematical quantity defined over $\mathbb{R}$ (e.g., exact integral arc length $L_{\mathrm{exact}}(\mathbf{B}) = \int_0^1 \|\mathbf{B}'(t)\|_2\,dt$, exact Green's theorem area $A_{\mathrm{exact}}(\partial\Omega) = \frac{1}{2}\oint (x\,dy - y\,dx)$, exact point $\mathbf{B}(t^*)$ at an implicitly defined parameter $t^*$, or exact minimum offset regularity factor $\min_{t \in [0, 1]} (1 - s\,d\,\kappa(t))$).
2. **Reference-Oracle Quantity ($X_{\mathrm{ref}}$):**
   The midpoint or rational value produced by the independent reference oracle in `M00.4` (`services/fashion-engine/tests/oracles/`).
3. **Production Implementation Quantity ($X_{\mathrm{float64}}$):**
   The IEEE 754 binary64 value produced by the authoritative production engine in `M02` (`services/fashion-engine/app/pattern_engine/`).
4. **Reference-to-Exact Enclosure Bound ($B_{\mathrm{ref}}(X) \ge 0$):**
   A rigorous upper bound (in the same geometric output units as $X$) on the distance between the reference value $X_{\mathrm{ref}}$ and the exact mathematical value $X_{\mathrm{exact}}$:
   $$\|X_{\mathrm{ref}} - X_{\mathrm{exact}}\| \le B_{\mathrm{ref}}(X)$$
   - When $X_{\mathrm{exact}}$ is a rational polynomial integral evaluated in exact rational arithmetic (`fractions.Fraction` for cubic Bézier Green's theorem area), $X_{\mathrm{ref}} = X_{\mathrm{exact}}$ and $B_{\mathrm{ref}}(X) = 0$.
   - When $X_{\mathrm{exact}}$ is enclosed in a validated interval $[\underline{X}_{\mathrm{ref}}, \overline{X}_{\mathrm{ref}}]$ such that $X_{\mathrm{exact}} \in [\underline{X}_{\mathrm{ref}}, \overline{X}_{\mathrm{ref}}]$ and $X_{\mathrm{ref}} = \mathrm{mid}([\underline{X}_{\mathrm{ref}}, \overline{X}_{\mathrm{ref}}])$, then $B_{\mathrm{ref}}(X) = \mathrm{rad}([\underline{X}_{\mathrm{ref}}, \overline{X}_{\mathrm{ref}}]) = \frac{\overline{X}_{\mathrm{ref}} - \underline{X}_{\mathrm{ref}}}{2}$ (plus outward float conversion rounding if converted).
5. **Implementation-to-Exact Certified Error Bound ($B_{\mathrm{cert}}(X) \ge 0$):**
   Let the **observed implementation-to-reference discrepancy** be:
   $$E_{\mathrm{obs}}(X) = \|X_{\mathrm{float64}} - X_{\mathrm{ref}}\|$$
   By the **Triangle Inequality**, the true error between the production implementation and the exact mathematical value is bounded by:
   $$\|X_{\mathrm{float64}} - X_{\mathrm{exact}}\| \le \|X_{\mathrm{float64}} - X_{\mathrm{ref}}\| + \|X_{\mathrm{ref}} - X_{\mathrm{exact}}\| = E_{\mathrm{obs}}(X) + B_{\mathrm{ref}}(X) =: B_{\mathrm{cert}}(X)$$
   A numerical gate with domain tolerance $\tau_{\mathrm{domain}}(X) > 0$ passes (`CERTIFIED_VALID`) **if and only if**:
   $$B_{\mathrm{cert}}(X) = E_{\mathrm{obs}}(X) + B_{\mathrm{ref}}(X) \le \tau_{\mathrm{domain}}(X)$$

### 2.2 Three-Tier Assurance Classification of Numerical Methods

Every numerical verification method across `M00.4` and `M02` must carry one of three explicit assurance labels (`assurance_classification`):

| Assurance Classification | Mathematical Requirement | Permitted Usage in Patroner |
| :--- | :--- | :--- |
| **`CERTIFIED_ENCLOSURE`** | Guarantees $X_{\mathrm{exact}} \in [\underline{X}, \overline{X}]$ via an analytical mathematical inequality (`Method C1-Cert` convex-hull chord/polygon enclosure), exact rational arithmetic (`fractions.Fraction` in `Method C2`), or validated interval/Bernstein enclosure (`Method C3`) with explicit outward rounding and parameter-to-output propagation (`Method B1/B2`), subject to the 4-layer assurance model (`Section 3`). | **Permitted for `AC-03` certification and release gating.** |
| **`HIGH_PRECISION_NUMERICAL_REFERENCE`** | High-precision evaluation (`mpmath.mpf` at $100\text{–}200$ dps) where the truncation remainder bound $B_{\mathrm{trunc}}$ is derived from analytic derivative bounds on $[0, 1]$ or validated interval remainder terms so $B_{\mathrm{ref}}(X) = B_{\mathrm{trunc}} + B_{\mathrm{round}}$ is explicitly bounded in output units. | **Permitted for Class B reference fixtures only when $B_{\mathrm{ref}}(X)$ is explicitly computed and added to $E_{\mathrm{obs}}(X)$.** |
| **`CONSERVATIVE_ENGINEERING_ESTIMATE`** | Heuristic error estimator based on empirical quadrature convergence (e.g., `Method C1-Est`: $S_{\mathrm{safety}} \cdot |L_{16} - L_8|$ with $S_{\mathrm{safety}} = 16.0$). Does **not** mathematically bound $X_{\mathrm{exact}}$ for arbitrary high-oscillation polynomials. | **Diagnostic / fast pre-screen only. Strictly prohibited from being labeled a "certified bound" or substituting for `Method C1-Cert` at `AC-03`.** |

### 2.3 Parameter Uncertainty Is Not Geometric Output Error (`Method B1` & `Method B2`)

Whenever a geometric operation isolates an unknown curve parameter $t^* \in [0, 1]$ inside a validated parameter bracket $I = [\underline{t}, \overline{t}]$ (with midpoint $t_{\mathrm{mid}} = \frac{\underline{t} + \overline{t}}{2}$ and parameter half-width $r_{\mathrm{param}} = \frac{\overline{t} - \underline{t}}{2}$)—including:
- Inverse arc-length parameter lookup $s(\tilde{t}^*) = s_{\mathrm{target}}$ for notch placement (`M02a` / `M02f`),
- Closest-point curve projection $(\mathbf{B}(t^*) - \mathbf{p}) \cdot \mathbf{B}'(t^*) = 0$ (`M02a`),
- Curve-curve intersection $\mathbf{B}_1(t_1^*) = \mathbf{B}_2(t_2^*)$ (`M02a` / `M02b`), or
- Offset singularity / minimum regularity isolation $f'(t^*) = 0$ or $f(t^*) = 0$ (`M02f`),

**the parameter half-width $r_{\mathrm{param}} = \frac{\overline{t} - \underline{t}}{2}$ is a dimensionless parameter uncertainty, NOT a bound on the geometric output $X(t^*)$.**

#### Mandatory Four-Quantity Separation for All Parameter-Isolated Operations
Every parameter-isolated verification record must explicitly separate and bound:

1. **Parameter Enclosure ($I = [\underline{t}, \overline{t}]$ and $r_{\mathrm{param}}$):**
   $$t^* \in I = [\underline{t}, \overline{t}], \qquad |t^* - t_{\mathrm{mid}}| \le r_{\mathrm{param}} = \frac{\overline{t} - \underline{t}}{2}$$
2. **Equation Residual Enclosure ($g(I) = [\underline{g}(I), \overline{g}(I)]$):**
   Enclosure of the defining equation residual $g(t)$ over $I$ (verifying $0 \in g(I)$ and, for Krawczyk/Newton isolation, $0 \notin g'(I)$). Small residual $|g(t_{\mathrm{mid}})|$ alone does **not** bound $|t^* - t_{\mathrm{mid}}|$ unless divided by $\underline{|g'(I)|} > 0$.
3. **Geometric Output Enclosure ($B_{\mathrm{ref}}(X)$ in Output Units `cm`, `cm²`, `deg`, or dimensionless $f$):**
   The parameter enclosure $I = [\underline{t}, \overline{t}]$ must be propagated to the target geometric quantity $X(t)$ using either **`Method B1`** or **`Method B2`**:
   - **`Method B1` — Validated Derivative (Lipschitz) Bound on $I$:**
     By the Mean Value Inequality on $I = [\underline{t}, \overline{t}]$, let $M_X(I)$ be a certified upper bound on $\|X'(t)\|$ over $t \in I$ obtained via Bernstein convex-hull coefficients or interval evaluation of $X'(I)$:
     $$M_X(I) = \overline{\sup_{t \in I} \|X'(t)\|}$$
     Let $\delta_{\mathrm{eval}} \ge 0$ be the outward-rounded evaluation enclosure radius of $X_{\mathrm{ref}} \approx X(t_{\mathrm{mid}})$. Then the reference-to-exact output error is rigorously bounded by:
     $$\|X(t^*) - X_{\mathrm{ref}}\| \le \|X(t^*) - X(t_{\mathrm{mid}})\| + \|X(t_{\mathrm{mid}}) - X_{\mathrm{ref}}\| \le M_X(I) \cdot r_{\mathrm{param}} + \delta_{\mathrm{eval}} =: B_{\mathrm{ref}}(X)$$
     *Special Case — Inverse Arc-Length Parameterization:* For $L(t) = \int_0^t \|\mathbf{B}'(u)\|_2\,du$, $L'(t) = \|\mathbf{B}'(t)\|_2 = \sqrt{Q(t)}$ and $\|\mathbf{B}'(t)\|_2 = \sqrt{Q(t)}$. Thus on $I = [\underline{t}, \overline{t}]$, both the arc-length output error and the 2D Euclidean point position error $\|\mathbf{B}(t^*) - \mathbf{B}(t_{\mathrm{mid}})\|_2$ are bounded by:
     $$\overline{\sqrt{Q(I)}} \cdot r_{\mathrm{param}} + \delta_{\mathrm{eval}}$$
     When $r_{\mathrm{param}}$ is chosen only as a fixed constant (e.g., $10^{-4}$), a steep curve with $\overline{\sqrt{Q(I)}} = 500\text{ cm}$ produces $0.05\text{ cm}$ of point error—violating a $10^{-4}\text{ cm}$ tolerance by $500\times$. Therefore, the root isolator must refine $I = [\underline{t}, \overline{t}]$ until $M_X(I) \cdot r_{\mathrm{param}} + \delta_{\mathrm{eval}} \le \frac{1}{2}\tau_{\mathrm{domain}}(X)$.
   - **`Method B2` — Direct Interval Image Enclosure $X(I)$:**
     Evaluate the interval extension (or Bernstein convex-hull enclosure) of $X$ directly over the parameter interval $I = [\underline{t}, \overline{t}]$:
     $$X(t^*) \in X(I) = [\underline{X}(I), \overline{X}(I)]$$
     Taking $X_{\mathrm{ref}} = \mathrm{mid}(X(I))$, the reference-to-exact output bound is directly:
     $$B_{\mathrm{ref}}(X) = \mathrm{rad}(X(I)) = \frac{\overline{X}(I) - \underline{X}(I)}{2}$$
4. **Final Certified Implementation-to-Exact Bound ($B_{\mathrm{cert}}(X)$):**
   $$B_{\mathrm{cert}}(X) = \|X_{\mathrm{float64}} - X_{\mathrm{ref}}\| + B_{\mathrm{ref}}(X) = E_{\mathrm{obs}}(X) + B_{\mathrm{ref}}(X) \le \tau_{\mathrm{domain}}(X)$$

### 2.4 Concrete Numerical Certification Methods (`Method C1-Cert`, `Method C1-Est`, `Method C2`, `Method C3`)

1. **`Method C1-Cert` — Certified Adaptive De Casteljau Chord / Control-Polygon Arc-Length Enclosure (`CERTIFIED_ENCLOSURE`):**
   - **Layer 1 Mathematical Inequality (`Non-Strict`):** By the convex-hull variation-diminishing property of Bernstein polynomials, the exact arc length $L_{\mathrm{exact}}(\mathbf{B}_k)$ of any cubic Bézier sub-segment $\mathbf{B}_k = (\mathbf{P}_{k,0}, \mathbf{P}_{k,1}, \mathbf{P}_{k,2}, \mathbf{P}_{k,3})$ satisfies the **non-strict** inequality:
     $$L_{\mathrm{chord}}(\mathbf{B}_k) = \|\mathbf{P}_{k,3} - \mathbf{P}_{k,0}\|_2 \;\le\; L_{\mathrm{exact}}(\mathbf{B}_k) \;\le\; \sum_{j=0}^{2} \|\mathbf{P}_{k,j+1} - \mathbf{P}_{k,j}\|_2 = L_{\mathrm{control\ polygon}}(\mathbf{B}_k)$$
     *(Equality $L_{\mathrm{chord}}(\mathbf{B}_k) = L_{\mathrm{exact}}(\mathbf{B}_k) = L_{\mathrm{control\ polygon}}(\mathbf{B}_k)$ holds whenever the control points $\mathbf{P}_{k,0}, \mathbf{P}_{k,1}, \mathbf{P}_{k,2}, \mathbf{P}_{k,3}$ are collinear and ordered monotonically along the chord, including straight-line segments and degenerate point segments.)*
   - **Layer 2 Algorithmic Subdivision & Outward Summation:** Subdivide $\mathbf{B}(t)$ via De Casteljau until $\sum_k (\overline{L}_{\mathrm{poly}}(\mathbf{B}_k) - \underline{L}_{\mathrm{chord}}(\mathbf{B}_k)) \le \tau_{\mathrm{enclosure}}$ (where $\underline{L}_{\mathrm{chord}}$ is lower-endpoints summed and $\overline{L}_{\mathrm{poly}}$ is upper-endpoints summed in outward interval arithmetic).
   - **Certified Bound:** Since $L_{\mathrm{exact}}(\mathbf{B}) \in [\underline{L}_{\mathrm{chord}}, \overline{L}_{\mathrm{poly}}]$, setting $L_{\mathrm{ref}} = \frac{\underline{L}_{\mathrm{chord}} + \overline{L}_{\mathrm{poly}}}{2}$ and $B_{\mathrm{ref}}(L) = \frac{\overline{L}_{\mathrm{poly}} - \underline{L}_{\mathrm{chord}}}{2}$ yields:
     $$B_{\mathrm{cert}}(L) = |L_{\mathrm{float64}} - L_{\mathrm{ref}}| + B_{\mathrm{ref}}(L) = \max\!\bigl(|L_{\mathrm{float64}} - \underline{L}_{\mathrm{chord}}|,\; |\overline{L}_{\mathrm{poly}} - L_{\mathrm{float64}}|\bigr)$$
2. **`Method C1-Est` — Two-Level Gauss–Legendre Quadrature Discrepancy (`CONSERVATIVE_ENGINEERING_ESTIMATE`):**
   - Computes $E_{\mathrm{est}} = S_{\mathrm{safety}} \cdot \sum_k |L_{16}(\mathbf{B}_k) - L_8(\mathbf{B}_k)|$ with $S_{\mathrm{safety}} = 16.0$.
   - Explicitly classified as `CONSERVATIVE_ENGINEERING_ESTIMATE`; never used as $B_{\mathrm{ref}}$ or $B_{\mathrm{cert}}$ for `AC-03`.
3. **`Method C2` — Exact Rational / Higham Certified Green's Theorem Area (`CERTIFIED_ENCLOSURE`):**
   - For piecewise linear/cubic Bézier contours with IEEE 754 `float64` control points (which are exact dyadic rationals in $\mathbb{Q}$), Green's theorem area is a finite algebraic polynomial in control-point coordinates:
     $$A_{\mathrm{exact}} = \sum_{i} \Delta A_i(\mathbf{P}_{i,0} - \mathbf{c}, \mathbf{P}_{i,1} - \mathbf{c}, \mathbf{P}_{i,2} - \mathbf{c}, \mathbf{P}_{i,3} - \mathbf{c})$$
   - **Reference Oracle (`M00.4`):** Evaluates $A_{\mathrm{ref}} = A_{\mathrm{exact}}$ using Python's exact rational `fractions.Fraction`, establishing $B_{\mathrm{ref}}(A) = 0$ and $B_{\mathrm{cert}}(A) = |A_{\mathrm{float64}} - A_{\mathrm{ref}}|$.
   - **Production Engine (`M02a`):** Evaluates centroid-shifted Green's terms in `float64` with Neumaier compensated summation and deterministic Higham inner-product error bound $B_{\mathrm{cert, prod}}(A) = \gamma_{64}\sum_m |T_m| \le 10^{-6}\text{ cm}^2$.
4. **`Method C3` — Complete-Interval ($t \in [0, 1]$) Bernstein / Interval Offset & Self-Intersection Verification (`CERTIFIED_ENCLOSURE`):**
   - Evaluates offset regularity, stationary parameterizations, tangent reversal, and self-intersection over the **entire continuous parameter domain $t \in [0, 1]$** (`Sections 4–5` below) with parameter-to-output propagation (`Method B1/B2`).

### 2.5 Mandatory `NumericalVerificationRecord` Schema (`packages/contracts`)

```json
{
  "quantity_name": "arc_length_cm | piece_area_cm2 | curve_projection_point_cm | notch_position_cm | seam_delta_cm",
  "reference_method_and_version": "Method_C1_Cert_DeCasteljau_ChordPolygon_v2.1.2_r1",
  "precision_and_arithmetic_model": "mpmath.iv_170bit_50dps_candidate | fractions.Fraction_exact_Q",
  "enclosure_or_remainder_method": "CONVEX_HULL_CHORD_POLYGON_INTERVAL | EXACT_RATIONAL_POLYNOMIAL | HIGHAM_GAMMA64_BOUND",
  "assurance_classification": "CERTIFIED_ENCLOSURE | HIGH_PRECISION_NUMERICAL_REFERENCE | CONSERVATIVE_ENGINEERING_ESTIMATE",
  "error_components": {
    "x_float64": 24.5189204123,
    "x_ref": 24.5189204119,
    "observed_discrepancy_e_obs": 4.0e-10,
    "reference_enclosure_b_ref": 1.2e-9,
    "implementation_to_exact_bound_b_cert": 1.6e-9,
    "heuristic_error_estimate": 8.5e-11,
    "parameter_enclosure": {
      "t_lower": 0.333333333333,
      "t_upper": 0.333333333334,
      "t_mid": 0.3333333333335,
      "r_param": 5.0e-13,
      "residual_interval_lower": -1.1e-11,
      "residual_interval_upper": 1.1e-11
    },
    "output_propagation": {
      "propagation_method": "NONE_DIRECT_ENCLOSURE | METHOD_B1_VALIDATED_DERIVATIVE | METHOD_B2_DIRECT_INTERVAL_IMAGE",
      "derivative_upper_bound_m": 42.5,
      "point_evaluation_rounding_bound_delta_eval": 1.0e-12,
      "output_enclosure_radius_b_ref_x": 2.1251e-11
    }
  },
  "acceptance_tolerance_tau": 1.0e-4,
  "verification_outcome": "CERTIFIED_VALID | CERTIFIED_INVALID | INCONCLUSIVE",
  "reproducibility_manifest": {
    "python_version": "3.12.x",
    "mpmath_version": "1.3.0",
    "subdivision_depth_k": 10,
    "input_fixture_sha256": "..."
  }
}
```
*(Validation Invariant: Whenever `parameter_enclosure` is non-null, `output_propagation.propagation_method` must be `METHOD_B1_VALIDATED_DERIVATIVE` or `METHOD_B2_DIRECT_INTERVAL_IMAGE`, and `reference_enclosure_b_ref` must equal `output_propagation.output_enclosure_radius_b_ref_x`, never `r_param`.)*

---

## 3. Four-Layer Assurance Model for `Method C1-Cert`, Candidate Library Status & Future Qualification Protocol (`Critical Correction F`)

To prevent mathematical theorems from being conflated with software implementation correctness or premature claims of library qualification, `ADR-009` (`R2.1.2-R1`) enforces a strict **Four-Layer Assurance Model** and explicitly distinguishes the **candidate status of `mpmath.iv`** and the **required future status of `IntervalLibraryQualificationReport`**:

### 3.1 The Four Assurance Layers

| Layer | Assurance Layer Name | Exact Scope & Claim Boundary | What This Layer Does NOT Prove |
| :---: | :--- | :--- | :--- |
| **Layer 1** | **Mathematical Theorem** | For any cubic Bézier curve $\mathbf{B}_k(t)$ on $[0, 1]$ over $\mathbb{R}^2$, the convex-hull variation-diminishing property of Bernstein polynomials implies the **non-strict** inequality $L_{\mathrm{chord}}(\mathbf{B}_k) \le L_{\mathrm{exact}}(\mathbf{B}_k) \le L_{\mathrm{control\ polygon}}(\mathbf{B}_k)$, with equality on collinear/degenerate segments. | Does not prove that finite-precision floating-point or interval software evaluates $\|\mathbf{P}_{k,j+1} - \mathbf{P}_{k,j}\|_2$ with outward rounding. |
| **Layer 2** | **Algorithmic Derivation** | Adaptive De Casteljau subdivision at $t = 1/2$ partitions $[0, 1]$ into $2^k$ dyadic sub-segments; summing lower-bounded chord lengths $\underline{L}_{\mathrm{chord}, k}$ and upper-bounded control-polygon lengths $\overline{L}_{\mathrm{poly}, k}$ with outward interval rounding preserves the global inclusion $L_{\mathrm{exact}}(\mathbf{B}) \in [\sum_k \underline{L}_{\mathrm{chord}, k}, \sum_k \overline{L}_{\mathrm{poly}, k}]$. | Does not prove that the chosen software library (`mpmath.iv`) is free of implementation defects. |
| **Layer 3** | **Implementation Assurance (`IntervalLibraryQualificationReport` — Required Future Artifact)** | Qualifying the **candidate numerical library** (`mpmath.iv`) via the mandatory 8-point `IntervalLibraryQualificationReport` (`Section 3.2`) to be executed during `M00.4`, cross-checking interval operations against independent exact rational arithmetic (`fractions.Fraction`). | Does not turn `mpmath.iv` into a formally verified theorem prover (such as Coq/Lean/Flocq); software enclosures remain conditioned on the qualified library environment and version pin. |
| **Layer 4** | **Empirical Verification** | Differential tests against `fractions.Fraction`, `Hypothesis` property tests, and the 17-Family Classification Test Matrix (`Section 4.6`) provide **empirical verification evidence** that the implementation conforms to Layers 1–3 on tested inputs. | **Empirical test execution is never mathematical proof.** Documentation in `plan/` must never state that passing unit/property tests "mathematically proves" software correctness. |

### 3.2 Candidate Library Status & Required Future `IntervalLibraryQualificationReport` (`M00.4` Deliverable for `DEC-13 Stage 2`)

> **Mandatory Status Statement (`Critical Correction F`):**
> 1. **`mpmath.iv` is currently a CANDIDATE numerical library (`DEC-13 Stage 1`), NOT an already-qualified or production-adopted library.**
> 2. **The `IntervalLibraryQualificationReport` defined below is a REQUIRED FUTURE ARTIFACT to be produced and verified during `M00.4` (after `Gate Auth-1` approval). It does NOT yet exist and has NOT yet passed.**
> 3. **Candidate selection (`DEC-13 Stage 1`) does NOT constitute library qualification (`M00.4`), oracle implementation verification (`M00.4`/`M00.10`), or production adoption (`DEC-13 Stage 2` at `Gate Auth-2`).**

During `M00.4`, before `mpmath.iv` may be used to certify Class B normative fixtures or submitted at `Gate Auth-2` (`DEC-13 Stage 2`) for production adoption in `M02a`/`M02f`, the engineering team must generate and commit `artifacts/m00-interval-library-qualification-report.json` (`IntervalLibraryQualificationReport`) verifying all 8 qualification criteria:

1. **Exact Library & Runtime Version Pin:** Records exact `mpmath` version (e.g., `mpmath == 1.3.0`), Python version (`3.12.x`), OS/CPU architecture, and `iv.dps` / bit-precision configuration (`iv.prec = 170` bits / `50` decimal digits).
2. **Exact Input Conversion Verification:** Verifies that every IEEE 754 `float64` control-point coordinate $c$ (an exact dyadic rational) is converted to `mpmath.iv.mpf` losslessly (zero conversion width $\underline{c} = \overline{c} = c$), and non-dyadic rational inputs (such as $1/3$ or decimal strings `"0.1"`) are converted via exact rational bounds $[\underline{q}, \overline{q}]$ enclosing $p/q \in \mathbb{Q}$ verified against `fractions.Fraction`.
3. **Outward-Rounding Verification of Elementary Operations (`+`, `-`, `*`, `/`):** Cross-checks $10,000$ rational interval pairs $[a, b], [c, d] \in \mathbb{Q}^2$ computed in exact `fractions.Fraction` against `mpmath.iv`, verifying that for every operation $\circ \in \{+, -, \times, \div\}$, the exact rational interval $[\underline{r}_{\mathbb{Q}}, \overline{r}_{\mathbb{Q}}]$ is strictly contained inside the `mpmath.iv` interval $[\underline{r}_{\mathrm{iv}}, \overline{r}_{\mathrm{iv}}]$ ($\underline{r}_{\mathrm{iv}} \le \underline{r}_{\mathbb{Q}} \le \overline{r}_{\mathbb{Q}} \le \overline{r}_{\mathrm{iv}}$).
4. **Outward-Rounding Verification of `sqrt`:** Cross-checks $10,000$ positive rational numbers $q \in \mathbb{Q}_{>0}$ (both perfect squares and non-squares) by computing $[\underline{s}, \overline{s}] = \texttt{mpmath.iv.sqrt}(q)$ in `fractions.Fraction` and verifying $\underline{s}^2 \le q \le \overline{s}^2$.
5. **Polynomial & Bernstein Basis Evaluation Containment:** Evaluates degree-5 and degree-9 Bernstein polynomials $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2$ at $1,000$ rational points $t_j \in \mathbb{Q} \cap [0, 1]$ and sub-intervals $I_j = [t_j, t_{j+1}]$ using exact `fractions.Fraction` Bernstein bounds and confirms $P_{\mathrm{exact},\mathbb{Q}}(t_j) \in P_{\mathrm{iv}}(I_j)$ in $100\%$ of cases.
6. **Division-by-Zero & Straddling-Zero Containment:** Verifies that dividing by any interval containing $0$ (`0 in denom_iv`) or taking `sqrt` of an interval with negative lower bound raises a deterministic domain trap or returns an explicit `INCONCLUSIVE` / straddling flag rather than silently returning `NaN` or dropping sign branches.
7. **Deterministic Cross-Run Reproducibility:** Verifies bit-for-bit identical interval endpoints `[a, b]` across repeated runs with `PYTHONHASHSEED=0`.
8. **Known Limitations & Mandatory Safe-Usage Rules:** Documents that (a) `mpmath.iv` is an unverified pure-Python software library (not hardware IEEE 1788 or Coq-verified), so all critical polynomial sign tests on rational endpoints at $Q(t)=0$ or $P_{\mathrm{exact}}(t)=0$ are cross-checked in `M00.4` using exact `fractions.Fraction`, and (b) interval dependency inflation (wrapping effect) on high-degree polynomials in monomial form must be mitigated by evaluating in the **Bernstein basis** on subdivided intervals $[a, b] \subseteq [0, 1]$.

---

## 4. Canonical Offset Curve Mathematics, Four CCW Circle Cases, Zero-Speed Parameterization vs. Geometric Singularity & Six-Category Offset Taxonomy (`Critical Corrections A, B, C, D, E`)

### 4.1 Canonical Planar Sign Convention & First-Principles Offset Derivative (`Critical Correction A`)

To guarantee 100% mathematical consistency across `M00.4`, `M02a`, `M02b`, `M02f`, and `M05.1`, Patroner enforces **one canonical planar convention** (`coordinate_convention: "CARTESIAN_RH_CCW"`):

1. **Right-Handed Cartesian Plane & Contour Orientation:**
   - Standard right-handed 2D Cartesian plane: $+x$ points right, $+y$ points up.
   - Positive angular orientation is **counter-clockwise (CCW)**.
   - Every simple closed exterior piece boundary contour $\partial\Omega_{\mathrm{ext}}$ is oriented **CCW** (interior of the pattern piece lies to the **left** of the traversal direction). Interior hole contours $\partial\Omega_{\mathrm{hole}}$ are oriented **CW**.
2. **Base Curve, Tangent, Left Unit Normal & Signed Curvature:**
   Let $\mathbf{B}(t) = (x(t), y(t))$ for $t \in [0, 1]$ be a $C^2$ planar curve (such as a cubic Bézier segment). Define:
   - First and second derivatives:
     $$\mathbf{B}'(t) = (x'(t), y'(t)), \qquad \mathbf{B}''(t) = (x''(t), y''(t))$$
   - Parametric speed squared:
     $$Q(t) = \|\mathbf{B}'(t)\|_2^2 = x'(t)^2 + y'(t)^2 \ge 0$$
   - At any regular parameter value where $Q(t) > 0$:
     - **Unit tangent vector:**
       $$\mathbf{T}(t) = \frac{\mathbf{B}'(t)}{\sqrt{Q(t)}} = \frac{(x'(t), y'(t))}{\sqrt{Q(t)}}$$
     - **Left unit normal vector** (rotated $+90^\circ$ CCW from $\mathbf{T}(t)$, pointing **inward** on a CCW exterior contour):
       $$\mathbf{N}_+(t) = \frac{(-y'(t), x'(t))}{\sqrt{Q(t)}}$$
     - **Signed curvature numerator $C(t)$ and signed scalar curvature $\kappa(t)$:**
       $$C(t) = \mathbf{B}'(t) \times \mathbf{B}''(t) = x'(t)y''(t) - y'(t)x''(t), \qquad \kappa(t) = \frac{C(t)}{Q(t)^{3/2}}$$
       Under this convention, $\kappa(t) > 0$ when the curve turns toward $\mathbf{N}_+(t)$ (left / CCW turn), and $\kappa(t) < 0$ when the curve turns toward $-\mathbf{N}_+(t)$ (right / CW turn).
3. **Frenet–Serret Derivative of the Left Unit Normal $\mathbf{N}_+(t)$:**
   Since $(\mathbf{T}(t), \mathbf{N}_+(t))$ forms a right-handed orthonormal frame along $\mathbf{B}(t)$ with arc-length derivative $\frac{d}{ds} = \frac{1}{\sqrt{Q(t)}}\frac{d}{dt}$, the Frenet–Serret equations give:
   $$\frac{d\mathbf{T}}{ds} = +\kappa(t)\,\mathbf{N}_+(t) \implies \mathbf{T}'(t) = +\kappa(t)\sqrt{Q(t)}\,\mathbf{N}_+(t)$$
   $$\frac{d\mathbf{N}_+}{ds} = -\kappa(t)\,\mathbf{T}(t) \implies \mathbf{N}_+'(t) = -\kappa(t)\sqrt{Q(t)}\,\mathbf{T}(t) = -\kappa(t)\,\mathbf{B}'(t)$$
4. **Canonical Offset Curve Definition & Direction Mapping:**
   For offset distance $d > 0$ and direction sign $s \in \{-1, +1\}$, the offset curve is:
   $$\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t), \qquad d > 0, \quad s \in \{-1, +1\}$$
   - **$s = +1$:** Left-normal offset along $+\mathbf{N}_+(t)$ (**inward** on a CCW exterior garment contour).
   - **$s = -1$:** Right-normal offset along $-\mathbf{N}_+(t)$ (**outward** on a CCW exterior garment contour — **canonical outward garment seam-allowance direction**).
5. **Exact Offset Derivative & Scalar Regularity Factor $f(t)$ (for $Q(t) > 0$):**
   Differentiating $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$ with respect to $t$ using $\mathbf{N}_+'(t) = -\kappa(t)\,\mathbf{B}'(t)$ gives:
   $$\mathbf{O}'(t) = \mathbf{B}'(t) + s\,d\,\mathbf{N}_+'(t) = \mathbf{B}'(t) - s\,d\,\kappa(t)\,\mathbf{B}'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t)$$
   $$\boxed{\mathbf{O}'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t) = f(t)\,\mathbf{B}'(t)}$$
   where the **scalar offset regularity factor** $f(t)$ (defined for $Q(t) > 0$) is:
   $$\boxed{f(t) = 1 - s\,d\,\kappa(t) = 1 - \frac{s\,d\,C(t)}{Q(t)^{3/2}} = \frac{Q(t)^{3/2} - s\,d\,C(t)}{Q(t)^{3/2}}}$$

### 4.2 Mandatory Four CCW Circle Cases (`Critical Correction B`)

Let $\mathbf{B}(t) = (R\cos t, R\sin t)$ for $R > 0$ and $t \in [0, 2\pi]$. Then:
- $\mathbf{B}'(t) = (-R\sin t, R\cos t)$, $\quad Q(t) = R^2 > 0$, $\quad \sqrt{Q(t)} = R$,
- $\mathbf{T}(t) = (-\sin t, \cos t)$,
- $\mathbf{N}_+(t) = \frac{(-y'(t), x'(t))}{\sqrt{Q(t)}} = (-\cos t, -\sin t)$ (pointing radially **inward** toward the center $(0, 0)$),
- $\mathbf{B}''(t) = (-R\cos t, -R\sin t)$, $\quad C(t) = x'(t)y''(t) - y'(t)x''(t) = R^2$,
- $\kappa(t) = \frac{C(t)}{Q(t)^{3/2}} = \frac{R^2}{R^3} = +\frac{1}{R} > 0$,
- $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t) = \bigl((R - s\,d)\cos t,\; (R - s\,d)\sin t\bigr)$,
- $\mathbf{O}'(t) = \bigl(1 - \frac{s\,d}{R}\bigr)\mathbf{B}'(t) = \bigl(-(R - s\,d)\sin t,\; (R - s\,d)\cos t\bigr)$, and $f(t) = 1 - \frac{s\,d}{R}$.

The four canonical CCW circle cases are:

| Case | Offset Sign $s$ & Distance $d > 0$ | Offset Curve $\mathbf{O}(t)$ & Derivative $\mathbf{O}'(t)$ | Regularity Factor $f = 1 - \frac{s\,d}{R}$ | Geometric Behavior | Mandatory Classification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Case 1 — Inward Regular Offset** | $s = +1$, $0 < d < R$ | $\mathbf{O}(t) = ((R-d)\cos t, (R-d)\sin t)$<br>$\|\mathbf{O}'(t)\|_2 = R - d > 0$ | $f = 1 - \frac{d}{R} \in (0, 1)$, $f > 0$ | **Regular inward circle** of radius $R - d > 0$ oriented CCW. *(Valid if $f \ge \varepsilon_{\mathrm{reg}}$; if $0 < f < \varepsilon_{\mathrm{reg}}$, classified as `REGULARITY_MARGIN_VIOLATION`, never as a cusp).* | `CERTIFIED_VALID` (when $1 - d/R \ge \varepsilon_{\mathrm{reg}}$) or `REGULARITY_MARGIN_VIOLATION` (when $0 < 1 - d/R < \varepsilon_{\mathrm{reg}}$) |
| **Case 2 — Inward Collapse** | $s = +1$, $d = R$ | $\mathbf{O}(t) = (0, 0)$ (constant point)<br>$\mathbf{O}'(t) = (0, 0)$ everywhere | $f = 1 - \frac{R}{R} = 0$ | **Complete offset collapse to a single point $(0, 0)$ — a singular offset** ($\mathbf{O}'(t) \equiv \mathbf{0}$). Never describe this merely as a small regularity margin violation. | `CERTIFIED_INVALID` (`ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`) |
| **Case 3 — Inward Over-Offset** | $s = +1$, $d > R$ | $\mathbf{O}(t) = ((R-d)\cos t, (R-d)\sin t)$ (signed radius $R - d < 0$)<br>$\|\mathbf{O}'(t)\|_2 = d - R > 0$ everywhere | $f = 1 - \frac{d}{R} < 0$ | Geometric image is a circle of radius $d - R > 0$ traversed with **reversed orientation** relative to $\mathbf{B}'(t)$, with **no zero-speed point** ($\|\mathbf{O}'(t)\|_2 = d - R > 0$ for all $t$). Never classify this as a zero-speed cusp simply because $f < 0$. | `CERTIFIED_INVALID` (`TANGENT_REVERSAL`) |
| **Case 4 — Outward Offset** | $s = -1$, $d > 0$ | $\mathbf{O}(t) = ((R+d)\cos t, (R+d)\sin t)$<br>$\|\mathbf{O}'(t)\|_2 = R + d > R > 0$ | $f = 1 + \frac{d}{R} > 1 > 0$ | **Regular outward circle** of radius $R + d > R$ oriented CCW. Smooth and non-singular for every $d > 0$. | `CERTIFIED_VALID` (`NONE`) |

### 4.3 Distinguishing Zero-Speed Parameterization ($Q(t^*) = 0$) from Geometric Singularity (`Critical Correction C`)

#### 1. Why $Q(t^*) = 0$ Is Not Automatically a Geometric Cusp (Mandatory Counterexample)
At any parameter value $t^*$ where $\mathbf{B}'(t^*) = (0, 0)$, the parametric speed squared vanishes:
$$Q(t^*) = x'(t^*)^2 + y'(t^*)^2 = 0$$
At such a point, the naive formulas $\mathbf{T}(t) = \frac{\mathbf{B}'(t)}{\sqrt{Q(t)}}$, $\mathbf{N}_+(t) = \frac{(-y'(t), x'(t))}{\sqrt{Q(t)}}$, and $\kappa(t) = \frac{C(t)}{Q(t)^{3/2}}$ have zero denominators ($0/0$).

However, **$Q(t^*) = 0$ is a property of the parameterization $\mathbf{B}(t)$, NOT automatically a geometric singularity of the curve image $\mathbf{B}([0, 1])$ or its offset.**

- **Mandatory Counterexample ($\mathbf{B}(t) = (t^3, 0)$):**
  Consider the polynomial curve:
  $$\mathbf{B}(t) = (t^3, 0), \qquad t \in [-1, 1] \text{ or } [0, 1]$$
  Then:
  $$\mathbf{B}'(t) = (3t^2, 0), \qquad Q(t) = 9t^4 \implies \mathbf{B}'(0) = (0, 0), \quad Q(0) = 0$$
  Yet the geometric image of $\mathbf{B}$ is the smooth horizontal straight line $y = 0$. Using the local reparameterization $u = t^3$ (so $\tilde{\mathbf{B}}(u) = (u, 0)$ with $\tilde{\mathbf{B}}'(u) = (1, 0) \ne \mathbf{0}$), or taking the limit as $t \to 0$:
  $$\mathbf{T}_{\lim}(0) = \lim_{t \to 0^-} \frac{\mathbf{B}'(t)}{\|\mathbf{B}'(t)\|_2} = \lim_{t \to 0^+} \frac{\mathbf{B}'(t)}{\|\mathbf{B}'(t)\|_2} = (1, 0)$$
  $$\mathbf{N}_{+,\lim}(0) = (0, 1), \qquad \kappa_{\lim}(0) = 0, \qquad \mathbf{O}(t) = (t^3, s\,d)$$
  The geometric curve and its offset $\mathbf{O}(t) = (t^3, s\,d)$ are smooth straight lines with **zero geometric cusp**.

#### 2. The Five-Way Mathematical Distinction at $Q(t^*) = 0$
Whenever $Q(t^*) = 0$ (or $0 \in Q(I)$ on a narrow parameter enclosure $I$), the geometry and offset engines (`M00.4` and `M02a`/`M02f`) must distinguish five concepts:

1. **Stationary Parameterization (`STATIONARY_PARAMETERIZATION`):**
   $Q(t^*) = \|\mathbf{B}'(t^*)\|_2^2 = 0$. This means only that the parameter speed vanishes at $t^*$; it requires local curve-germ analysis before any geometric classification is made.
2. **Removable Parameterization Degeneracy (`REMOVABLE_PARAMETERIZATION_DEGENERACY`):**
   Let $m \ge 2$ be the lowest derivative order such that $\mathbf{B}^{(m)}(t^*) \ne \mathbf{0}$ (for a non-constant cubic Bézier, $m \in \{2, 3\}$). The stationary point $t^*$ is a **removable parameterization degeneracy** if and only if:
   - **Continuous Unit Geometric Tangent:** The one-sided limiting unit tangents agree across $t^*$:
     $$\mathbf{T}_-(t^*) = \lim_{t \to t^{*-}} \frac{\mathbf{B}'(t)}{\|\mathbf{B}'(t)\|_2}, \qquad \mathbf{T}_+(t^*) = \lim_{t \to t^{*+}} \frac{\mathbf{B}'(t)}{\|\mathbf{B}'(t)\|_2}, \qquad \mathbf{T}_-(t^*) = \mathbf{T}_+(t^*) =: \mathbf{T}_{\lim}(t^*)$$
     *(For an interior point $t^* \in (0, 1)$, Taylor expansion $\mathbf{B}'(t) = \frac{(t - t^*)^{m-1}}{(m-1)!}\mathbf{B}^{(m)}(t^*) + O(|t - t^*|^m)$ implies $\mathbf{T}_+(t^*) = \frac{\mathbf{B}^{(m)}(t^*)}{\|\mathbf{B}^{(m)}(t^*)\|_2}$ and $\mathbf{T}_-(t^*) = (-1)^{m-1}\frac{\mathbf{B}^{(m)}(t^*)}{\|\mathbf{B}^{(m)}(t^*)\|_2}$. Hence an interior stationary point $t^* \in (0, 1)$ has $\mathbf{T}_-(t^*) = \mathbf{T}_+(t^*)$ if and only if the first non-zero derivative order $m$ is **odd**, i.e. $m = 3$ for a cubic Bézier where $\mathbf{B}'(t^*) = \mathbf{B}''(t^*) = \mathbf{0}$ and $\mathbf{B}'''(t^*) \ne \mathbf{0}$. At a segment endpoint $t^* \in \{0, 1\}$, only the interior one-sided limit exists, so $m = 2$ with $\mathbf{B}'(t^*) = \mathbf{0}, \mathbf{B}''(t^*) \ne \mathbf{0}$—such as coincident endpoint control points $\mathbf{P}_0 = \mathbf{P}_1$—defines a unique one-sided limiting tangent $\mathbf{T}_{\lim}(t^*) = \pm\frac{\mathbf{B}''(t^*)}{\|\mathbf{B}''(t^*)\|_2}$.)*
   - **Bounded Limiting Curvature $\kappa_{\lim}(t^*)$ under Local Reparameterization:** Under the regular local parameter $u = (t - t^*)^m$ (or arc length $s$), the curve $\tilde{\mathbf{B}}(u)$ is locally $C^2$ with finite limiting curvature:
     $$\kappa_{\lim}(t^*) = \lim_{t \to t^*} \frac{x'(t)y''(t) - y'(t)x''(t)}{(x'(t)^2 + y'(t)^2)^{3/2}} \in \mathbb{R}$$
     *(For a cubic with $m=3$ at an interior point $t^*$, $\mathbf{B}'(t^*) = \mathbf{B}''(t^*) = \mathbf{0} \implies \kappa_{\lim}(t^*) = 0$. For an endpoint $t^* \in \{0, 1\}$ with $m=2$, $\mathbf{B}'(t^*) = \mathbf{0}, \mathbf{B}''(t^*) \ne \mathbf{0}$, L'Hôpital / Taylor expansion of $C(t) = \frac{1}{2}(t-t^*)^2(\mathbf{B}''(t^*) \times \mathbf{B}'''(t^*)) + O(|t-t^*|^3)$ and $Q(t)^{3/2} = |t-t^*|^3 \|\mathbf{B}''(t^*)\|_2^3 + O(|t-t^*|^4)$ shows that $\kappa_{\lim}(t^*)$ is finite **if and only if** $\mathbf{B}''(t^*) \times \mathbf{B}'''(t^*) = 0$, in which case $\kappa_{\lim}(t^*) = 0$; if $\mathbf{B}''(t^*) \times \mathbf{B}'''(t^*) \ne 0$, $|\kappa(t)| \sim \frac{|\mathbf{B}''(t^*) \times \mathbf{B}'''(t^*)|}{2|t-t^*|\,\|\mathbf{B}''(t^*)\|_2^3} \to \infty$, which is a genuine curvature singularity!)*
   - **Regular Offset Extension:** The limiting offset regularity factor satisfies $f_{\lim}(t^*) = 1 - s\,d\,\kappa_{\lim}(t^*) \ge \varepsilon_{\mathrm{reg}} > 0$. When all three conditions hold, the local parameterization degeneracy is removable (reparameterizable by arc length or $u = (t - t^*)^m$) and the offset curve $\mathbf{O}$ is geometrically smooth and regular (`CERTIFIED_VALID`).
3. **Genuine Base-Curve Geometric Singularity (`GENUINE_BASE_GEOMETRIC_SINGULARITY`):**
   The base curve image $\mathbf{B}([0, 1])$ has a non-removable geometric singularity at $t^*$:
   - **Tangent Reversal Cusp of the Base Curve:** At an interior stationary point $t^* \in (0, 1)$, the lowest non-zero derivative order $m$ is **even** ($m = 2$, i.e. $\mathbf{B}'(t^*) = \mathbf{0}$ and $\mathbf{B}''(t^*) \ne \mathbf{0}$, such as $\mathbf{B}(t) = (t^2, t^3)$ at $t^* = 0$ or an interior cubic Bézier cusp at $t^* = 0.25$ or $t^* = 1/3$), so $\mathbf{T}_-(t^*) = -\mathbf{T}_+(t^*)$ ($180^\circ$ geometric tangent reversal on the base curve itself), **or**
   - **Infinite Curvature Singularity:** $\lim_{t \to t^*} |\kappa(t)| = +\infty$ (for example, at an endpoint $t^* \in \{0, 1\}$ where $\mathbf{B}'(t^*) = \mathbf{0}, \mathbf{B}''(t^*) \ne \mathbf{0}$, and $\mathbf{B}''(t^*) \times \mathbf{B}'''(t^*) \ne 0$), **or**
   - **Identically Degenerate Segment:** $\mathbf{B}'(t) \equiv \mathbf{0}$ on $[0, 1]$ ($\mathbf{P}_0 = \mathbf{P}_1 = \mathbf{P}_2 = \mathbf{P}_3$).
4. **Offset Singularity (`ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`):**
   The offset map $\mathbf{O}$ itself loses geometric regularity: either (a) $Q(t^*) > 0$ and $f(t^*) = 1 - s\,d\,\kappa(t^*) = 0$ (including complete offset collapse as in CCW Circle Case 2 where $d = R$), or (b) $Q(t^*) = 0$ and the base curve has a genuine non-removable geometric singularity (Case 3 above) or $1 - s\,d\,\kappa_{\lim}(t^*) = 0$.
5. **Inconclusive (`INCONCLUSIVE`):**
   Available interval/rational evidence cannot establish whether $Q(t)$ reaches zero or whether a stationary point is a removable parameterization degeneracy vs. a genuine singularity.

#### 3. Mandatory Protocol When $Q(t^*) = 0$ or $0 \in Q(I)$
1. **Never divide by $\sqrt{Q(t)}$ or $Q(t)^{3/2}$** on any interval $I$ where $0 \in Q(I)$.
2. **Never automatically classify $Q(t^*) = 0$ as a cusp.**
3. **Evaluate the local derivative jet $(\mathbf{B}'(t^*), \mathbf{B}''(t^*), \mathbf{B}'''(t^*))$** (in exact `fractions.Fraction` at rational $t^*$ or validated interval bounds on $I$):
   - If $t^* \in (0, 1)$ has $\mathbf{B}'(t^*) = \mathbf{0}$ and $\mathbf{B}''(t^*) \ne \mathbf{0}$ ($m=2$ even order at an interior point), then $\mathbf{T}_-(t^*) = -\mathbf{T}_+(t^*)$ and it is a **genuine base-curve geometric cusp** $\to$ classify as `CERTIFIED_INVALID` (`ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`).
   - If $t^* \in \{0, 1\}$ has $\mathbf{B}'(t^*) = \mathbf{0}$, $\mathbf{B}''(t^*) \ne \mathbf{0}$, and $\mathbf{B}''(t^*) \times \mathbf{B}'''(t^*) \ne 0$, then $|\kappa(t)| \to \infty$ as $t \to t^*$ $\to$ classify as `CERTIFIED_INVALID` (`ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`).
   - If $\mathbf{T}_-(t^*) = \mathbf{T}_+(t^*) = \mathbf{T}_{\lim}(t^*)$ (or one-sided endpoint tangent with $\mathbf{B}''(t^*) \times \mathbf{B}'''(t^*) = 0$), $\kappa_{\lim}(t^*) = 0$, and $f_{\lim}(t^*) = 1 \ge \varepsilon_{\mathrm{reg}}$, then $t^*$ is a **removable parameterization degeneracy** $\to$ reparameterize locally (or factor out $(t - t^*)^{m-1}$ from $\mathbf{B}'(t)$) and evaluate the regular unit tangent $\mathbf{T}(t)$, unit normal $\mathbf{N}_+(t)$, and curvature $\kappa(t)$ without zero division.
   - If interval widths prevent certifying these conditions conclusively, return **`INCONCLUSIVE`**.

---

### 4.4 The Six Offset Classifications & Exact Polynomial Predicates (`Critical Correction D`)

Why squaring requires the concave/evolute sign gate $s\,d\,C(t) > 0$:
At any regular base point ($Q(t) > 0$), $f(t) = 1 - \frac{s\,d\,C(t)}{Q(t)^{3/2}} = 0 \iff Q(t)^{3/2} = s\,d\,C(t)$. Because $Q(t)^{3/2} > 0$, this equation can hold **only when $s\,d\,C(t) > 0$** (the offset is on the **concave / evolute side** of the base curve). Squaring both sides produces the degree-12 polynomial:
$$P_{\mathrm{exact}}(t) := Q(t)^3 - d^2 C(t)^2$$
Because squaring destroys the sign of $s\,d\,C(t)$, $P_{\mathrm{exact}}(t) = 0$ has **extraneous roots whenever $s\,d\,C(t) = -Q(t)^{3/2} < 0$** (the convex offset side, where $f(t) = 1 + |s\,d\,\kappa(t)| = 2 > 1$ is completely smooth!). Therefore, every polynomial predicate using $P_{\mathrm{exact}}(t)$ or $P_{\mathrm{margin}}(t)$ **must be gated by $s\,d\,C(t) > 0$**.

The six distinct offset failure/status classifications are:

#### 1. `REGULARITY_MARGIN_VIOLATION` (`Engineering Policy Threshold — Not a Cusp`)
- **Mathematical Definition:** The base and offset curves are locally regular everywhere ($Q(t) > 0$ or removable parameterization degeneracy, and $f(t) > 0$ for all $t \in [0, 1]$), so **no zero-speed cusp and no tangent reversal exists**, but $f(t)$ dips below the configured engineering safety margin $\varepsilon_{\mathrm{reg}} > 0$ (default $\varepsilon_{\mathrm{reg}} = 0.05$, i.e. $R_{\mathrm{curv}}(t) < \frac{d}{1 - \varepsilon_{\mathrm{reg}}} \approx 1.0526\,d$):
  $$0 < \min_{t \in [0, 1]} f(t) < \varepsilon_{\mathrm{reg}}$$
- **Exact Polynomial Predicate (for $Q(t) > 0$):**
  $$Q(t) > 0 \;\wedge\; s\,d\,C(t) > 0 \;\wedge\; P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2 > 0 \;\wedge\; P_{\mathrm{margin}}(t) := (1 - \varepsilon_{\mathrm{reg}})^2 Q(t)^3 - d^2 C(t)^2 < 0$$
- **Engineering Meaning:** At $0 < f(t) < \varepsilon_{\mathrm{reg}}$, the offset curve is still mathematically regular at that parameter value, **not** singular, **not** tangent-reversed, and **not** a cusp; it is rejected (`CERTIFIED_INVALID` with `failure_category = "REGULARITY_MARGIN_VIOLATION"`) solely because manufacturing policy requires a minimum regularity margin $\varepsilon_{\mathrm{reg}}$ before CNC knife cutting.

#### 2. `ACTUAL_OFFSET_SINGULARITY` (`ACTUAL_ZERO_SPEED_CUSP`)
- **Mathematical Definition:** Occurs at $t^* \in [0, 1]$ when the offset map $\mathbf{O}$ loses regularity, which happens in two sub-cases:
  - **Sub-case 2a (Evolute / Offset Speed Zero on a Regular or Reparameterized Curve):** $Q(t^*) > 0$ (or removable parameterization degeneracy with finite $\kappa_{\lim}(t^*)$) and $f(t^*) = 1 - s\,d\,\kappa(t^*) = 0$ ($\mathbf{O}'(t^*) = \mathbf{0}$). This includes **complete offset collapse** (such as CCW Circle Case 2 where $s=+1, d=R$ and $\mathbf{O}(t) \equiv (0,0)$) as well as isolated evolute cusps ($d = R_{\mathrm{curv}}(t^*)$):
    $$Q(t^*) > 0 \;\wedge\; s\,d\,C(t^*) > 0 \;\wedge\; P_{\mathrm{exact}}(t^*) = Q(t^*)^3 - d^2 C(t^*)^2 = 0$$
  - **Sub-case 2b (Genuine Non-Removable Base-Curve Geometric Singularity):** $Q(t^*) = 0$ where the local curve germ has a non-removable geometric singularity ($\mathbf{T}_-(t^*) = -\mathbf{T}_+(t^*)$ at an interior point with even lowest derivative order $m=2$, unbounded limiting curvature $|\kappa_{\lim}(t^*)| = \infty$, or identically zero derivative $\mathbf{B}'(t) \equiv \mathbf{0}$).

#### 3. `TANGENT_REVERSAL` (`Over-Offset Beyond the Evolute`)
- **Mathematical Definition:** On a sub-interval or across the entire domain $[0, 1]$, the offset distance $d$ on the concave side exceeds the local radius of curvature $R_{\mathrm{curv}}(t) = 1/|\kappa(t)|$, so the scalar regularity factor is **strictly negative**:
  $$f(t) = 1 - s\,d\,\kappa(t) < 0 \iff Q(t) > 0 \;\wedge\; s\,d\,C(t) > Q(t)^{3/2}$$
- **Exact Polynomial Predicate:**
  $$Q(t) > 0 \;\wedge\; s\,d\,C(t) > 0 \;\wedge\; P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2 < 0$$
- **Geometric Distinction Between Pure Tangent Reversal and Sign-Changing Transition:**
  - If $f(t) < 0$ everywhere on the curve domain $[0, 1]$ (as in **CCW Circle Case 3**: $s=+1, d > R$, where $f(t) = 1 - d/R < 0$ is constant and $\|\mathbf{O}'(t)\|_2 = d - R > 0$ everywhere), the offset tangent is reversed relative to $\mathbf{B}'(t)$ across the entire curve **with NO zero-speed point ($f(t^*) = 0$) anywhere in the domain**. It is classified strictly as `TANGENT_REVERSAL` (never as `ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`).
  - If $f(t)$ is continuous on $[0, 1]$ and changes sign from $f(t_1) > 0$ to $f(t_2) < 0$, then by the Intermediate Value Theorem there exists at least one $t^* \in (t_1, t_2)$ where $f(t^*) = 0$. In that case, **both** an `ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP` (at $t^*$) **and** `TANGENT_REVERSAL` (on the sub-interval where $f(t) < 0$) are present; the `OffsetValidationRecord` records both in `detected_failure_categories` (with primary `failure_category: "TANGENT_REVERSAL"` and `has_zero_speed_cusp_on_domain: true`).

#### 4. `LOCAL_SELF_INTERSECTION` (`LOCAL_OFFSET_SELF_INTERSECTION`)
- **Mathematical Definition:** Within a single offset curve segment or local concave corner transition ($t_1 < t_2$ in $[0, 1]$), $\mathbf{O}(t_1) = \mathbf{O}(t_2)$ (isolated via 2D Bézier fat-line clipping + interval Krawczyk root isolation with `Method B1/B2` coordinate output bounds). An untrimmed local self-intersection loop invalidates a raw offset contour and must either be trimmed by `M02f` before piece-sheet construction or rejected as `LOCAL_SELF_INTERSECTION`.

#### 5. `GLOBAL_SELF_INTERSECTION` (`GLOBAL_CONTOUR_SELF_INTERSECTION`)
- **Mathematical Definition:** Every individual offset segment $\mathbf{O}_i(t)$ is locally regular ($f_i(t) \ge \varepsilon_{\mathrm{reg}}$) and locally simple, but two non-adjacent offset segments $\mathbf{O}_i(t_1)$ and $\mathbf{O}_j(t_2)$ ($|i - j| > 1 \pmod N$) or opposite sides of a narrow bottleneck/keyhole/slit intersect:
  $$\exists\, (i, t_1), (j, t_2) \text{ non-adjacent}: \quad \mathbf{O}_i(t_1) = \mathbf{O}_j(t_2)$$
  Detected via `shapely.STRtree` broad-phase bounding-box filter followed by 2D interval Krawczyk intersection certification.

#### 6. `INCONCLUSIVE` (`INCONCLUSIVE_VERIFICATION`)
- **Mathematical Definition:** At maximum subdivision depth $k_{\max} = 20$ and working precision (`50` dps, escalated to `100` dps), at least one sub-interval $I_k = [a_k, b_k] \subseteq [0, 1]$ still straddles zero or the regularity margin ($0 \in Q(I_k)$ with unresolved local curve-germ reparameterization, $0 \in P_{\mathrm{exact}}(I_k)$ with $\overline{s\,d\,C(I_k)} > 0$, $0 \in P_{\mathrm{margin}}(I_k)$ with $\overline{s\,d\,C(I_k)} > 0$, or an unresolved 2D Krawczyk box on a near-grazing self-intersection).
- **Mandatory Governance Rule:** `INCONCLUSIVE` is **not** a pass and **not** a confirmed geometric defect (`Categories 1–5`). It **fails closed** (`is_production_ready = False`) and triggers the 4-step escalation ladder (`Section 5.2`).

---

## 5. Tri-State Verification Outcomes & Complete-Interval ($t \in [0, 1]$) Algorithm

### 5.1 Complete-Interval Verification Algorithm (`Stage 1` Heuristic Screen vs. `Stage 2` Tri-State Proof)

- **Stage 1 — Fast Discrete Heuristic Pre-Screen (Diagnostic Only — Never Sufficient for Certification):**
  Evaluates $Q(t_m)$ and $f(t_m) = 1 - s\,d\,\kappa(t_m)$ at 65 Gauss–Lobatto nodes $t_m \in [0, 1]$ in `float64`. If any node violates $f(t_m) \ge \varepsilon_{\mathrm{reg}}$, `M02f` immediately triggers adaptive envelope trimming/subdivision. **Passing Stage 1 is never accepted as certification (`AC-03`).**
- **Stage 2 — Authoritative Complete-Interval ($t \in [0, 1]$) Bernstein / Interval Verification (`M00.4` Oracle & `M02f` Production Verifier):**
  For each cubic Bézier segment $\mathbf{B}(t)$ on $t \in [0, 1]$:
  1. **Step 2.1 — Stationary Parameterization Check ($Q(t) = 0$) & Curve-Germ Classification (`Section 4.3`):**
     Convert $Q(t) = x'(t)^2 + y'(t)^2$ (degree 4) to the Bernstein basis on $[0, 1]$.
     - If $\min_j b_j(Q) > 0$, then $Q(t) > 0$ everywhere on $[0, 1]$; proceed to Step 2.2.
     - If $Q(t)$ has a root $t^* \in [0, 1]$ (isolated via De Casteljau + exact `fractions.Fraction` / interval jet evaluation of $(\mathbf{B}'(t^*), \mathbf{B}''(t^*), \mathbf{B}'''(t^*))$):
       - Apply the protocol in `Section 4.3`: if $t^*$ is a **removable parameterization degeneracy** ($\mathbf{T}_-(t^*) = \mathbf{T}_+(t^*)$, finite $\kappa_{\lim}(t^*)$, and $1 - s\,d\,\kappa_{\lim}(t^*) \ge \varepsilon_{\mathrm{reg}}$), factor out the stationary power $(t - t^*)^{m-1}$ from $\mathbf{B}'(t)$ (local reparameterization) and continue verification on the regular reduced tangent/curvature polynomials.
       - If $t^*$ is a **genuine non-removable base-curve geometric singularity** ($\mathbf{T}_-(t^*) = -\mathbf{T}_+(t^*)$ at an interior even-order root $m=2$, $|\kappa_{\lim}(t^*)| = \infty$ at an endpoint with $\mathbf{B}''(t^*) \times \mathbf{B}'''(t^*) \ne 0$, or $\mathbf{B}'(t) \equiv \mathbf{0}$), return **`CERTIFIED_INVALID`** with `failure_category = "ACTUAL_ZERO_SPEED_CUSP"`.
       - If unresolved at $k_{\max} = 20$ (`100` dps), return **`INCONCLUSIVE`**.
  2. **Step 2.2 — Concave / Evolute-Side Sign Gate ($s\,d\,C(t) > 0$):**
     Evaluate the degree-2 signed curvature numerator $C(t) = x'(t)y''(t) - y'(t)x''(t)$ in the Bernstein basis on the current sub-interval $[a, b]$.
     - **Fast Convex-Offset Certificate:** If all Bernstein coefficients of $s\,d\,C(t)$ on $[a, b]$ satisfy $b_j(s\,d\,C) \le 0$, then $s\,d\,C(t) \le 0$ for all $t \in [a, b]$, which proves $f(t) = 1 - \frac{s\,d\,C(t)}{Q(t)^{3/2}} \ge 1 > \varepsilon_{\mathrm{reg}}$ everywhere on $[a, b]$. The sub-interval $[a, b]$ is immediately **certified regular** without evaluating $P_{\mathrm{exact}}(t)$ or $P_{\mathrm{margin}}(t)$.
  3. **Step 2.3 — Concave-Side Regularity, Cusp & Tangent-Reversal Isolation (where $s\,d\,C(t) > 0$):**
     On any sub-interval $[a, b]$ where $\max_j b_j(s\,d\,C) > 0$, evaluate the Bernstein coefficients of $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2$ and $P_{\mathrm{margin}}(t) = (1 - \varepsilon_{\mathrm{reg}})^2 Q(t)^3 - d^2 C(t)^2$ in `mpmath.iv`:
     - **Fast Regularity-Margin Certificate:** If $\min_j \underline{b_j(P_{\mathrm{margin}})} > 0$, then $f(t) > \varepsilon_{\mathrm{reg}}$ for all $t \in [a, b]$; sub-interval $[a, b]$ is **certified valid**.
     - **Certified Tangent Reversal (`TANGENT_REVERSAL`):** If on any sub-interval $[a, b]$, $\min_j \underline{b_j(s\,d\,C)} > 0$ and $\max_j \overline{b_j(P_{\mathrm{exact}})} < 0$, then $f(t) < 0$ on $[a, b]$; classify as **`CERTIFIED_INVALID`** (`failure_category = "TANGENT_REVERSAL"`). Also check whether $f(t)$ changes sign on $[0, 1]$ (recording `has_zero_speed_cusp_on_domain: true` if $f(t^*) = 0$ also occurs on $[0, 1]$, or `false` if $f(t) < 0$ everywhere as in CCW Circle Case 3).
     - **Certified Offset Singularity / Evolute Cusp (`ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`):** If $\min_{t \in [0, 1]} f(t) = 0$ (i.e., $P_{\mathrm{exact}}(t^*) = 0$ with $s\,d\,C(t^*) > 0$, isolated via interval Krawczyk / sign-change bracketing or exact rational root check, including complete collapse $f(t) \equiv 0$ as in CCW Circle Case 2) and no sub-interval has $f(t) < 0$, classify as **`CERTIFIED_INVALID`** (`failure_category = "ACTUAL_ZERO_SPEED_CUSP"`).
     - **Certified Regularity-Margin Violation (`REGULARITY_MARGIN_VIOLATION`):** If $P_{\mathrm{exact}}(t) > 0$ everywhere on $[0, 1]$ (so $f(t) > 0$ everywhere), but on some sub-interval $[a, b]$ with $\min_j \underline{b_j(s\,d\,C)} > 0$ we have $\max_j \overline{b_j(P_{\mathrm{margin}})} < 0$, then $0 < \min_{t \in [0, 1]} f(t) < \varepsilon_{\mathrm{reg}}$; classify as **`CERTIFIED_INVALID`** (`failure_category = "REGULARITY_MARGIN_VIOLATION"`).
     - **Ambiguous Sub-Interval:** Subdivide $[a, b]$ at its midpoint via De Casteljau up to depth $k_{\max} = 20$ (with automatic precision escalation from `50` dps to `100` dps at $k = 16$). If any sub-interval remains unresolved at $k_{\max} = 20$, return **`INCONCLUSIVE`** (`failure_category = "INCONCLUSIVE_VERIFICATION"`).
  4. **Step 2.4 — Radial Offset Approximation Distance & Primary Span Coverage (`DEF-M00-02` Closure):**
     Verify radial offset approximation error $\max_{t \in [0, 1]} \|\hat{\mathbf{O}}(t) - \mathbf{O}(t)\|_2 \le 0.01\text{ cm}$ (using `Method B1/B2` output bounds) and primary cutting contour projection span coverage $\ge 85\%$.
  5. **Step 2.5 — Local & Global Self-Intersection Verification (`Categories 4 & 5`):**
     Execute intra-segment (`LOCAL_OFFSET_SELF_INTERSECTION`) and inter-segment `STRtree` + 2D interval Krawczyk (`GLOBAL_CONTOUR_SELF_INTERSECTION`) checks across the closed piece cut contour.

### 5.2 Four-Step Escalation Ladder for `INCONCLUSIVE` Outcomes
1. **Step 1 (Automatic Precision Escalation):** Re-run the unresolved sub-interval $[a_k, b_k]$ in `mpmath.iv` at `iv.dps = 100` (`336` bits) up to local depth $k = 24$.
2. **Step 2 (Exact Rational Algebraic Check):** If control points are rational, evaluate the Sturm sequence or exact rational Bernstein sign of $Q(t)$ and $P_{\mathrm{exact}}(t)$ on $[a_k, b_k]$ using `fractions.Fraction`.
3. **Step 3 (Deterministic Knot Insertion / Envelope Retrimming):** Split the base curve segment at the midpoint of the unresolved bracket and re-run `M02f` offset construction.
4. **Step 4 (Hard Fail-Closed Governance Hold):** Persist `verification_outcome = "INCONCLUSIVE"` and `failure_category = "INCONCLUSIVE_VERIFICATION"`, keep `is_production_ready = False`, and surface the exact parameter bracket $[a_k, b_k]$ in the CAD diagnostic inspector.

### 5.3 Mandatory `OffsetValidationRecord` Schema (`packages/contracts`)

```json
{
  "segment_id": "bodice_front_armscye_seg_02",
  "verification_outcome": "CERTIFIED_VALID | CERTIFIED_INVALID | INCONCLUSIVE",
  "failure_category": "NONE | REGULARITY_MARGIN_VIOLATION | ACTUAL_ZERO_SPEED_CUSP | TANGENT_REVERSAL | LOCAL_OFFSET_SELF_INTERSECTION | GLOBAL_CONTOUR_SELF_INTERSECTION | INCONCLUSIVE_VERIFICATION",
  "detected_failure_categories": [],
  "has_zero_speed_cusp_on_domain": false,
  "stationary_parameterization_status": "NONE_REGULAR_SPEED | REMOVABLE_PARAMETERIZATION_DEGENERACY | GENUINE_BASE_GEOMETRIC_SINGULARITY | UNRESOLVED",
  "coordinate_convention": "CARTESIAN_RH_CCW",
  "offset_sign_s": -1,
  "offset_distance_d_cm": 1.0,
  "regularity_margin_epsilon": 0.05,
  "max_subdivision_depth_reached": 6,
  "min_certified_speed_sq_cm2": [14.2011, 14.2015],
  "min_certified_regularity_factor": [0.3124, 0.3129],
  "max_certified_radial_error_cm": [0.0018, 0.0021],
  "primary_span_coverage_ratio": 1.0,
  "local_self_intersection_status": "CERTIFIED_NONE",
  "global_contour_self_intersection_status": "CERTIFIED_NONE",
  "unresolved_intervals": [],
  "escalation_trace": []
}
```

---

## 6. Complete 17-Family Classification Test Matrix (`Critical Correction E`)

> **Mandatory Verification Status Disclosure (`Critical Correction E`):**
> - The 17 test families in the matrix below are **REQUIRED FUTURE AUTOMATED TESTS** to be implemented and executed in `M00.4` (`services/fashion-engine/tests/oracles/test_offset_classification_matrix.py`) and `M02f` (`services/fashion-engine/tests/pattern_engine/test_m02f_offset_verifier.py`) after `Gate Auth-1` / `Gate Auth-2` authorization.
> - **None of these 17 Python automated test suites have been executed during this documentation-only revision (`R2.1.2-R1`).** During `R2.1.2-R1`, only analytical/symbolic mathematical derivations of the formulas in `Sections 4.1`–`4.4` and repository documentation consistency checks were performed (`14_BLUEPRINT_R2_1_2_TO_R2_1_2_R1_CHANGELOG.md §9`).

| # | Test Family | Mathematical Input | Expected Geometric Behavior | Expected Classification (`verification_outcome` & `failure_category`) | Required Numerical Evidence | Whether a Formal Certificate Is Required | Failure and Inconclusive Conditions |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **1** | **CCW Circle Inward Regular Offset** (`Case 1`) | $\mathbf{B}(t) = (R\cos t, R\sin t)$, $R = 10\text{ cm}$, $s = +1$ (inward), $d = 2\text{ cm} < R$, $\varepsilon_{\mathrm{reg}} = 0.05$ (and rational/cubic Bézier circle arc approximation). | Regular inward circle of radius $R - d = 8\text{ cm} > 0$, CCW orientation, $\kappa = +0.1\text{ cm}^{-1}$, $f(t) = 1 - d/R = 0.80 \ge 0.05$. | `CERTIFIED_VALID` (`failure_category: "NONE"`) | Interval enclosure of $Q(t) \in [100, 100]$, $s\,d\,C(t) = 20 > 0$, $f(t) \in [0.80, 0.80] \ge \varepsilon_{\mathrm{reg}}$, radial error $\le 0.01\text{ cm}$, zero self-intersections. | **Yes** (`CERTIFIED_ENCLOSURE` via `Method C3`) | Fails if inward sign $s=+1$ is flipped to $1 + d/R = 1.20$; `INCONCLUSIVE` if interval enclosure of $f(t)$ straddles $\varepsilon_{\mathrm{reg}}$. |
| **2** | **CCW Circle Inward Collapse** (`Case 2`) | $\mathbf{B}(t) = (R\cos t, R\sin t)$, $R = 10\text{ cm}$, $s = +1$ (inward), $d = R = 10\text{ cm}$. | **Complete offset collapse** to the single point $\mathbf{O}(t) \equiv (0, 0)$ with $\mathbf{O}'(t) \equiv (0, 0)$ and $f(t) = 1 - R/R \equiv 0$ everywhere. | `CERTIFIED_INVALID` (`failure_category: "ACTUAL_ZERO_SPEED_CUSP"`, `has_zero_speed_cusp_on_domain: true`) | Exact rational / interval proof that $Q(t) = 100 > 0$, $s\,d\,C(t) = 1000 > 0$, and $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2 \equiv 0$ ($f(t) \equiv 0$). | **Yes** (`CERTIFIED_ENCLOSURE` + exact rational root check) | Must **never** be classified merely as `REGULARITY_MARGIN_VIOLATION` or `TANGENT_REVERSAL`; `INCONCLUSIVE` if non-exact circle approximation straddles $P_{\mathrm{exact}}(t) = 0$ without resolving collapse. |
| **3** | **CCW Circle Inward Over-Offset** (`Case 3`) | $\mathbf{B}(t) = (R\cos t, R\sin t)$, $R = 10\text{ cm}$, $s = +1$ (inward), $d = 12\text{ cm} > R$. | Signed radius $R - d = -2\text{ cm} < 0$; geometric image is a circle of radius $d - R = 2\text{ cm} > 0$ traversed with **reversed orientation**, $f(t) = 1 - 12/10 = -0.20 < 0$ everywhere, and **no zero-speed point** ($\|\mathbf{O}'(t)\|_2 = 2\text{ cm} > 0$ for all $t$). | `CERTIFIED_INVALID` (`failure_category: "TANGENT_REVERSAL"`, `has_zero_speed_cusp_on_domain: false`) | Interval enclosure proving $Q(t) = 100 > 0$, $s\,d\,C(t) = 1200 > Q(t)^{3/2} = 1000$, $P_{\mathrm{exact}}(t) < 0$ everywhere, and $f(t) \in [-0.20, -0.20] < 0$. | **Yes** (`CERTIFIED_ENCLOSURE`) | Must **never** be classified as `ACTUAL_ZERO_SPEED_CUSP` simply because $f < 0$; `has_zero_speed_cusp_on_domain` must be `false`. |
| **4** | **CCW Circle Outward Offset** (`Case 4`) | $\mathbf{B}(t) = (R\cos t, R\sin t)$, $R = 10\text{ cm}$, $s = -1$ (outward seam allowance), $d = 12\text{ cm} > R$. | Regular outward circle of radius $R + d = 22\text{ cm} > R$, CCW orientation, $s\,d\,C(t) = -1200 < 0$, $f(t) = 1 + d/R = 2.20 > 1$. | `CERTIFIED_VALID` (`failure_category: "NONE"`) | Convex-side sign gate certificate showing $s\,d\,C(t) < 0$ across $[0, 2\pi]$ so $f(t) > 1 \ge \varepsilon_{\mathrm{reg}}$ (even though the un-gated squared polynomial $P_{\mathrm{exact}}(t) = 10^6 - 1.44 \times 10^6 < 0$). | **Yes** (`CERTIFIED_ENCLOSURE`) | Fails if the verifier omits the $s\,d\,C(t) > 0$ sign gate and falsely rejects outward convex offsets when $d \ge R$. |
| **5** | **Straight Line Reparameterized as $\mathbf{B}(t) = (t^3, 0)$ (`Removable Parameterization Degeneracy`)** | Cubic Bézier on $t \in [0, 1]$ with $\mathbf{P}_0 = \mathbf{P}_1 = \mathbf{P}_2 = (0, 0), \mathbf{P}_3 = (10, 0)$ (so $\mathbf{B}(t) = (10t^3, 0)$), and interior shifted version $\mathbf{B}(t) = ((t - 1/2)^3, 0)$ on $t \in [0, 1]$ ($Q(t^*) = 0$ at $t^*=0$ or $t^*=1/2$), $d = 1.0\text{ cm}, s = -1$. | Geometric image is a smooth horizontal straight line segment ($y = 0$) with constant unit tangent $\mathbf{T}_{\lim} = (1, 0)$, constant normal $\mathbf{N}_{+,\lim} = (0, 1)$, $\kappa_{\lim} \equiv 0$, $f_{\lim} \equiv 1$, and smooth straight-line offset $\mathbf{O}(t) = (x(t), -d)$. | `CERTIFIED_VALID` (`failure_category: "NONE"`, `stationary_parameterization_status: "REMOVABLE_PARAMETERIZATION_DEGENERACY"`) | Exact rational jet verification at $t^*$: $\mathbf{B}'(t^*) = \mathbf{B}''(t^*) = (0,0)$, $\mathbf{B}'''(t^*) \ne (0,0)$ ($m=3$ odd), $\mathbf{T}_-(t^*) = \mathbf{T}_+(t^*) = (1, 0)$, $\kappa_{\lim}(t^*) = 0$, $f_{\lim}(t^*) = 1 \ge \varepsilon_{\mathrm{reg}}$. | **Yes** (`CERTIFIED_ENCLOSURE` + exact `fractions.Fraction` jet check) | Must **never** divide by $Q(t^*)^{3/2} = 0$ and must **never** automatically classify $Q(t^*) = 0$ as `ACTUAL_ZERO_SPEED_CUSP`. |
| **6** | **Genuine Base-Curve Geometric Cusp at $Q(t^*) = 0$** | Cubic curve with interior even-order stationary point ($m=2$), e.g. $\mathbf{B}(t) = \bigl((2t-1)^2, (2t-1)^3\bigr)$ on $t \in [0, 1]$ (semicubical parabola cusp at $t^* = 0.5$ where $\mathbf{B}'(0.5) = (0,0), \mathbf{B}''(0.5) = (8, 0) \ne (0,0)$), and endpoint infinite-curvature case $\mathbf{P}_0 = \mathbf{P}_1 = (0,0), \mathbf{P}_2 = (5,0), \mathbf{P}_3 = (10,5)$ at $t^* = 0$ ($\mathbf{B}''(0) \times \mathbf{B}'''(0) \ne 0$). | For $t^* = 0.5$, one-sided unit tangents reverse by $180^\circ$ ($\mathbf{T}_-(0.5) = (-1, 0) = -\mathbf{T}_+(0.5)$); for the endpoint case with $\mathbf{B}''(0) \times \mathbf{B}'''(0) \ne 0$, $|\kappa(t)| \to \infty$ as $t \to 0^+$. Both are non-removable base-curve geometric singularities. | `CERTIFIED_INVALID` (`failure_category: "ACTUAL_ZERO_SPEED_CUSP"`, `stationary_parameterization_status: "GENUINE_BASE_GEOMETRIC_SINGULARITY"`) | Exact rational / interval jet proof at $t^*$ showing either $\mathbf{T}_-(t^*) = -\mathbf{T}_+(t^*)$ ($m=2$ interior cusp) or $\mathbf{B}''(t^*) \times \mathbf{B}'''(t^*) \ne 0$ ($\kappa_{\lim} \to \infty$ at $m=2$ endpoint). | **Yes** (`CERTIFIED_ENCLOSURE` + exact `fractions.Fraction` jet check) | Fails if missed by discrete sampling; `INCONCLUSIVE` if jet derivatives cannot be separated from zero within interval width. |
| **7** | **Smooth Curve with Exact Offset Cusp $f(t^*) = 0$ at One Interior Point** | Regular cubic Bézier ($Q(t) > 0$ on $[0, 1]$) with concave peak curvature $\max_{t \in [0, 1]} s\,\kappa(t) = \kappa(t^*) = \frac{1}{d}$ at interior point $t^* = 0.5$ so $f(0.5) = 0$ and $f(t) > 0$ for $t \ne 0.5$. | Base curve is smooth ($Q(t) > 0$), but at $t^* = 0.5$ the offset distance $d$ equals the minimum radius of curvature $R_{\mathrm{curv}}(0.5)$, producing an isolated zero-speed offset cusp $\mathbf{O}'(0.5) = \mathbf{0}$ without $f(t) < 0$. | `CERTIFIED_INVALID` (`failure_category: "ACTUAL_ZERO_SPEED_CUSP"`, `has_zero_speed_cusp_on_domain: true`) | Proof that $Q(0.5) > 0$, $s\,d\,C(0.5) > 0$, $P_{\mathrm{exact}}(0.5) = 0$, and $P_{\mathrm{exact}}(t) \ge 0$ on $[0, 1]$ (with `Method B1/B2` output bound on $f(t^*)$). | **Yes** (`CERTIFIED_ENCLOSURE`) | If floating-point interval evaluation cannot prove whether $\min P_{\mathrm{exact}}(t) = 0$ vs. $\pm 10^{-16}$ without exact rational tangency check, must return `INCONCLUSIVE` (never `CERTIFIED_VALID`). |
| **8** | **Smooth Curve Where $f(t)$ Crosses from Positive to Negative** | Regular concave cubic Bézier ($Q(t) > 0$) with $f(0) = 0.65 > 0$, $f(1) = 0.65 > 0$, and interior peak curvature exceeding $1/d$ so $\min_{t \in [0, 1]} f(t) = f(t_{\min}) = -0.15 < 0$. | As $t$ traverses $[0, 1]$, $f(t)$ crosses zero at two evolute cusp points $t_1^*, t_2^*$ ($f(t_1^*) = f(t_2^*) = 0$) and is strictly negative ($f(t) < 0$, tangent reversal) on $(t_1^*, t_2^*)$, forming a classic swallowtail / dual-cusp loop. | `CERTIFIED_INVALID` (`failure_category: "TANGENT_REVERSAL"`, `detected_failure_categories: ["ACTUAL_ZERO_SPEED_CUSP", "TANGENT_REVERSAL"]`, `has_zero_speed_cusp_on_domain: true`) | Interval certificate of sign change $f(0) > 0$, $f(t_{\min}) \in [-0.1501, -0.1499] < 0$ ($s\,d\,C > 0, P_{\mathrm{exact}} < 0$), and bracketed roots $t_1^*, t_2^*$ where $0 \in P_{\mathrm{exact}}(I_{1,2})$. | **Yes** (`CERTIFIED_ENCLOSURE`) | Fails if classified as `REGULARITY_MARGIN_VIOLATION` or if the co-existence of $f(t^*)=0$ and $f(t)<0$ is not recorded. |
| **9** | **Smooth Curve with $0 < \min f(t) < \varepsilon_{\mathrm{reg}}$ (`Margin Violation Only`)** | Regular concave cubic Bézier ($Q(t) > 0$) with $\varepsilon_{\mathrm{reg}} = 0.05$ and $\min_{t \in [0, 1]} f(t) = 0.02 \in (0, 0.05)$ ($d = 0.98\,R_{\min}$). | Offset curve is mathematically regular and smooth everywhere ($f(t) \ge 0.02 > 0$, no cusp, no tangent reversal), but violates the $\varepsilon_{\mathrm{reg}} = 0.05$ engineering margin. | `CERTIFIED_INVALID` (`failure_category: "REGULARITY_MARGIN_VIOLATION"`, `has_zero_speed_cusp_on_domain: false`) | Interval enclosure proving $\min_{t \in [0, 1]} P_{\mathrm{exact}}(t) > 0$ ($f(t) \ge 0.0199 > 0$ everywhere) AND $\min_{t \in [0, 1]} P_{\mathrm{margin}}(t) < 0$ ($f(t_{\min}) \le 0.0201 < 0.05$). | **Yes** (`CERTIFIED_ENCLOSURE`) | Must **never** be misclassified as `ACTUAL_ZERO_SPEED_CUSP` or `TANGENT_REVERSAL`. |
| **10** | **Convex vs. Concave Curves with Identical $|\kappa|$ and Opposite Curvature Sign** | Mirror-image cubic Bézier pair $\mathbf{B}_{\mathrm{convex}}(t)$ ($s\,d\,C(t) < 0$) and $\mathbf{B}_{\mathrm{concave}}(t)$ ($s\,d\,C(t) > 0$) with identical speed $Q(t)$ and identical curvature magnitude $|\kappa(t)|$ where $\max |\kappa(t)| = 1.2/d$. | On $\mathbf{B}_{\mathrm{convex}}$, $f(t) = 1 + d|\kappa(t)| \ge 1$ (smooth expanding offset). On $\mathbf{B}_{\mathrm{concave}}$, $f(t) = 1 - d|\kappa(t)|$ reaches $-0.20 < 0$ (evolute cusp + tangent reversal). | $\mathbf{B}_{\mathrm{convex}} \to$ `CERTIFIED_VALID` (`NONE`);<br>$\mathbf{B}_{\mathrm{concave}} \to$ `CERTIFIED_INVALID` (`TANGENT_REVERSAL`) | Sign of $s\,d\,C(t)$ in Bernstein basis + interval bounds on $f(t)$ ($[1.0, 2.2]$ for convex vs. $[-0.20, 0.80]$ for concave). | **Yes** (`CERTIFIED_ENCLOSURE`) | Fails if $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2 < 0$ is evaluated without the $s\,d\,C(t) > 0$ sign gate (which would falsely reject $\mathbf{B}_{\mathrm{convex}}$). |
| **11** | **Cubic with Inflection Point ($C(t^*) = 0$ Inside Segment)** | S-shaped cubic Bézier where $C(t)$ changes sign at $t^* = 0.4$ ($C(0.4) = 0$): sub-interval $[0, 0.4)$ has $s\,d\,C(t) < 0$ (convex offset) and $(0.4, 1]$ has $s\,d\,C(t) > 0$ (concave offset), tested in two sub-cases: (11a) concave peak $d\kappa_{\max} = 0.4 < 1 - \varepsilon_{\mathrm{reg}}$, (11b) concave peak $d\kappa_{\max} = 1.15 > 1$. | At $t^* = 0.4$, $\kappa(0.4) = 0$ and $f(0.4) = 1.0$. Sub-case (11a) is smooth on both halves; Sub-case (11b) is smooth on $[0, 0.4]$ and has cusp + tangent reversal on $(0.4, 1]$. | (11a) $\to$ `CERTIFIED_VALID` (`NONE`);<br>(11b) $\to$ `CERTIFIED_INVALID` (`TANGENT_REVERSAL`) | De Casteljau subdivision isolating the convex sub-domain ($s\,d\,C \le 0 \implies f \ge 1$) from the concave sub-domain ($s\,d\,C > 0$) and certifying $f(t)$ on each. | **Yes** (`CERTIFIED_ENCLOSURE`) | Fails if inflection sign change causes false cancellation or misses the concave peak on $(0.4, 1]$. |
| **12** | **Local Offset Self-Intersection** | Deep concave U-shaped notch/dart contour where raw untrimmed offset segments $\mathbf{O}(t_1) = \mathbf{O}(t_2)$ cross locally ($t_1 < t_2$). | Offset curve forms a self-intersecting local loop across the concave throat. | `CERTIFIED_INVALID` (`failure_category: "LOCAL_OFFSET_SELF_INTERSECTION"`) if untrimmed; `CERTIFIED_VALID` only after `M02f` trims the loop and re-verifies the trimmed contour. | 2D Bézier fat-line clipping + interval Krawczyk root isolation proving a unique transversal intersection $(t_1^*, t_2^*)$ with `Method B1/B2` point error $\le 10^{-5}\text{ cm}$. | **Yes** (`CERTIFIED_ENCLOSURE` via 2D Krawczyk) | `INCONCLUSIVE` if near-tangential grazing self-intersection has singular Jacobian $\det J_{\mathbf{O}}(I_1, I_2) \ni 0$. |
| **13** | **Global Non-Adjacent Offset Self-Intersection** | Narrow keyhole / slit neckline piece contour where every segment is locally flat or gently curved ($f_i(t) > 0.80$ everywhere), but non-adjacent opposite seam allowances ($d = 1.0\text{ cm}$ across a $1.5\text{ cm}$ gap) collide globally ($\mathbf{O}_i(t_1) = \mathbf{O}_j(t_2)$, $|i - j| > 1$). | Each individual segment is locally smooth and cusp-free, but the global cut boundary self-intersects across the bottleneck. | `CERTIFIED_INVALID` (`failure_category: "GLOBAL_CONTOUR_SELF_INTERSECTION"`) | `STRtree` broad-phase pair detection + 2D interval Krawczyk certification of $\mathbf{O}_i(t_1^*) = \mathbf{O}_j(t_2^*)$ between non-adjacent segments $i, j$. | **Yes** (`CERTIFIED_ENCLOSURE` via 2D Krawczyk) | Fails if offset verifier checks only single-segment $f_i(t)$ and omits global non-adjacent contour intersection checking. |
| **14** | **Almost-Flat Cubic Segment (`Method C1-Cert` Non-Strict Inequality)** | Collinear cubic Bézier $\mathbf{P}_0=(0,0), \mathbf{P}_1=(3,0), \mathbf{P}_2=(7,0), \mathbf{P}_3=(10,0)$ and nearly flat cubic with $10^{-7}\text{ cm}$ transverse deflection. | On the collinear segment, $L_{\mathrm{chord}} = L_{\mathrm{exact}} = L_{\mathrm{control\ polygon}} = 10.0\text{ cm}$ (exact equality); on the nearly flat segment, $L_{\mathrm{chord}} < L_{\mathrm{exact}} < L_{\mathrm{control\ polygon}}$ with gap $< 10^{-12}\text{ cm}$ at $k=0$. | `CERTIFIED_VALID` (`NumericalVerificationRecord` with $B_{\mathrm{cert}}(L) \le 10^{-4}\text{ cm}$) | Interval verification of the **non-strict** inequality $\underline{L}_{\mathrm{chord}} \le L_{\mathrm{exact}} \le \overline{L}_{\mathrm{poly}}$ (accepting $L_{\mathrm{chord}} == L_{\mathrm{control\ polygon}}$ without false strict-inequality assertion failure). | **Yes** (`CERTIFIED_ENCLOSURE` via `Method C1-Cert`) | Fails if code asserts strict inequality $L_{\mathrm{chord}} < L_{\mathrm{exact}} < L_{\mathrm{control\ polygon}}$ and crashes on straight/collinear segments. |
| **15** | **Steep Parameterization Where Small Parameter Error Causes Large Geometric Point Error (`Method B1/B2`)** | High-speed cubic curve segment with $\|\mathbf{B}'(t^*)\|_2 = 500\text{ cm}$ at inverse arc-length notch target $t^* \in I = [\underline{t}, \overline{t}]$ where initial parameter half-width is $r_{\mathrm{param}} = 10^{-4}$ ($\tau_{\mathrm{pos}} = 10^{-4}\text{ cm}$). | Although parameter bracket half-width is $r_{\mathrm{param}} = 10^{-4}$, geometric position uncertainty is $\|\mathbf{B}(t^*) - \mathbf{B}(t_{\mathrm{mid}})\|_2 \approx 500 \times 10^{-4} = 0.05\text{ cm} \gg \tau_{\mathrm{pos}}$. | Unrefined bracket ($r_{\mathrm{param}} = 10^{-4}$) $\to$ **Rejected** ($B_{\mathrm{cert}}(\mathbf{B}) = 0.05\text{ cm} > 10^{-4}\text{ cm}$);<br>Refined bracket ($r_{\mathrm{param}} \le 10^{-7}$ so $M_{\mathbf{B}}(I)\,r_{\mathrm{param}} \le 5\times 10^{-5}\text{ cm}$) $\to$ `CERTIFIED_VALID`. | `NumericalVerificationRecord` recording `r_param`, `derivative_upper_bound_m` ($\ge 500.0$), and `output_enclosure_radius_b_ref_x` via `Method B1` or `Method B2`. | **Yes** (`CERTIFIED_ENCLOSURE` via `Method B1/B2`) | Fails if the implementation substitutes $r_{\mathrm{param}}$ for $B_{\mathrm{ref}}(\mathbf{B})$ and falsely accepts the unrefined $0.05\text{ cm}$ position error. |
| **16** | **Subdivision-Limit / Straddling Interval Case (`INCONCLUSIVE`)** | Concave cubic Bézier with $\min_{t \in [0, 1]} f(t) = \varepsilon_{\mathrm{reg}} + 10^{-18}$ evaluated under an artificially capped subdivision depth ($k_{\max} = 2$) so the Bernstein enclosure $f(I_k) = [0.048, 0.052]$ straddles $\varepsilon_{\mathrm{reg}} = 0.05$. | True curve barely clears $\varepsilon_{\mathrm{reg}}$, but at depth $k_{\max} = 2$ the interval enclosure $[0.048, 0.052]$ cannot prove $f(t) \ge 0.05$ or $f(t) < 0.05$. | `INCONCLUSIVE` (`failure_category: "INCONCLUSIVE_VERIFICATION"`, `is_production_ready: false`) | Recorded `unresolved_intervals: [[a_k, b_k]]` with straddling interval bounds $[0.048, 0.052] \ni 0.05$ and `escalation_trace`. | **No** (Cannot be certified at capped depth; must return `INCONCLUSIVE`) | Fails if the verifier silently passes (`CERTIFIED_VALID`) or falsely reports `ACTUAL_ZERO_SPEED_CUSP` / `REGULARITY_MARGIN_VIOLATION` when the interval merely straddles the threshold. |
| **17** | **Non-Dyadic ($t^* = 1/3$) & Interior `t = 0.25` Singularities + Short-Span `2%` Bypass (`DEF-M00-02`)** | (17a) Cubic Bézier with interior cusp / evolute singularity at $t^* = 0.25$ (missed by legacy 3-point $\{0, 0.5, 1\}$ sampling in `piece-production-sheet.ts:878`); (17b) Cubic Bézier with interior singularity at non-dyadic $t^* = 1/3$ (never hit as a dyadic midpoint $m/2^k$); (17c) Curved boundary replaced by a `2%`-span straight segment (`piece-production-sheet.ts:946`). | (17a) and (17b) have interior singularities missed by point sampling or dyadic-midpoint point checks; (17c) omits $98\%$ of the curved seam allowance. | All three $\to$ `CERTIFIED_INVALID` ((17a/b) `ACTUAL_ZERO_SPEED_CUSP` or `TANGENT_REVERSAL`; (17c) `PRIMARY_OFFSET_SPAN_INSUFFICIENT` with `primary_span_coverage_ratio = 0.02 < 0.85`). | Complete-interval $[0, 1]$ Bernstein enclosure isolating $t^* \in [a_k, b_k]$ for both $t^*=0.25$ and $t^*=1/3$, plus projection span coverage ratio check. | **Yes** (`CERTIFIED_ENCLOSURE`) | Fails if verifier relies on discrete point sampling (`0, 0.5, 1` or dyadic endpoints only) or permits primary span coverage $< 85\%$. |

---

## 7. Five-Dimensional Oracle Independence & Four-Decision Governance Lifecycle (`Critical Corrections F & G`)

### 7.1 The Five Independence Dimensions (`M00.4` Reference Oracle vs. `M02` Production Engine)

| Dimension | Independence Dimension | How `M00.4` (`services/fashion-engine/tests/oracles/`) & `M02` (`services/fashion-engine/app/pattern_engine/`) Satisfy It |
| :---: | :--- | :--- |
| **1** | **Algorithmic Independence** | - **Arc Length (`M02a` vs. `M00.4`):** Production `M02a` uses adaptive `float64` Gauss–Legendre quadrature + `float64` chord/polygon bounds; the `M00.4` oracle uses `mpmath.iv` arbitrary-precision De Casteljau chord/polygon enclosures (`Method C1-Cert`) and independent Gauss–Kronrod interval quadrature.<br>- **Green's Area (`M02a` vs. `M00.4`):** Production `M02a` uses `float64` centroid-shifted algebraic evaluation with Neumaier summation; the `M00.4` oracle evaluates the exact degree-5 polynomial integral over $\mathbb{Q}$ using `fractions.Fraction` ($B_{\mathrm{ref}} = 0$).<br>- **Marker Nesting (`M02h` vs. `M00.4`):** Production `M02h` uses NFP strip packing; the independent auditor (`verify_marker_layout.py`) uses exact rational polygon containment and minimum distance checks. |
| **2** | **Source-Code Independence** | Zero shared domain code: `services/fashion-engine/tests/oracles/` is strictly prohibited from importing any function, class, polynomial evaluator, root isolator, or constant from `services/fashion-engine/app/pattern_engine/` (enforced by CI AST linter `scripts/check_oracle_independence.py` under `AC-04`). |
| **3** | **Arithmetic / Library Independence** | **Explicit Shared-Library Disclosure & Rational Cross-Check:** Where both `M00.4` and `M02f` Stage 2 use `mpmath.iv` for Bernstein interval arithmetic, they are **not** library-independent with respect to `mpmath.iv`. To prevent a single `mpmath.iv` bug from masking a defect in both `M00.4` and `M02f`, `M00.4` implements an independent **Pure-Python Exact Rational (`fractions.Fraction`) Bernstein & Sturm Verifier** that cross-checks `mpmath.iv` on all rational test points, stationary-point curve germs ($Q(t^*)=0$), exact cusp roots ($P_{\mathrm{exact}}(t^*)=0$), Green's area (`Method C2`), and the 8-point `IntervalLibraryQualificationReport` (`Section 3.2`). |
| **4** | **Input / Fixture Independence** | Class B Normative fixtures (`tests/fixtures/class_b_normative/`) are generated from analytical closed-form geometric identities (exact circles, ellipses, collinear segments, exact algebraic cusps with rational coordinates) and independent `M00.4` oracle calculations—never by recording or snapshotting `M02` production outputs. |
| **5** | **Reviewer / Verification Independence** | Oracle qualification reports (`IntervalLibraryQualificationReport`), Class B fixture manifests, and `Gate Auth-2` / `Gate Auth-3` release evidence are verified by an independent CI pipeline job and audited against the 12 acceptance dimensions (`AC-01`–`AC-12`) separately from feature development. |

### 7.2 Four-Decision Numerical Library & Oracle Governance Lifecycle (`Critical Corrections F & G`, `DEC-13`)

> **Mandatory Governance Principle (`Critical Corrections F & G`):**
> **Candidate selection does not constitute implementation qualification or production adoption.**

To eliminate any circularity between `DEC-13` and `M00.4` while preventing premature claims of library qualification or unauthorized pre-`M00` work, Patroner separates numerical library and oracle governance into **four distinct sequential decisions**:

1. **Decision 1 — Candidate Library Selection (`DEC-13 Stage 1` at `Gate Auth-1`, Pre-`M00`):**
   - **Scope:** Approves the mathematical specification in `ADR-009` (`R2.1.2-R1`) and selects `mpmath.iv` + `fractions.Fraction` as the **candidate numerical library pair** to be evaluated in `M00.4`.
   - **Evidence Required at `Gate Auth-1`:** Static mathematical and architectural review of `ADR-009` (`R2.1.2-R1`). Requires **zero `M00` code execution** prior to `Gate Auth-1`.
   - **Optional Pre-`M00` Spike (`SPIKE-DEC13-01`):** If the Project Owner desires empirical runtime timing before signing off on `Gate Auth-1`, the Owner may **separately and explicitly authorize** a bounded non-production spike (`SPIKE-DEC13-01`). **`SPIKE-DEC13-01` remains separately authorized by the Project Owner and must never become an implicit route around `Gate Auth-1` or an authorization to begin `M00`.**
2. **Decision 2 — Library Qualification (`IntervalLibraryQualificationReport` during `M00.4`):**
   - **Scope:** After `Gate Auth-1` and `AUTH-M00-START` are approved by the Project Owner, `M00.4` executes the 8-point qualification protocol (`Section 3.2`) comparing `mpmath.iv` against exact `fractions.Fraction` and produces the required future artifact `artifacts/m00-interval-library-qualification-report.json`.
3. **Decision 3 — Oracle Implementation Verification (`M00.4` / `M00.10` Readiness Gate):**
   - **Scope:** Verifies the standalone `M00.4` reference-oracle implementation (`services/fashion-engine/tests/oracles/`) against all **17 mandatory classification test families (`Section 6`)**, parameter-to-output propagation (`Method B1/B2`), and 5-dimensional oracle independence (`Section 7.1`).
4. **Decision 4 — Production Adoption (`DEC-13 Stage 2` at `Gate Auth-2`, Post-`M00.10` / Pre-`M02`):**
   - **Scope:** Reviews the completed `IntervalLibraryQualificationReport` (Decision 2), the 17-family oracle verification results (Decision 3), and the `< 5 ms` per-contour benchmark across the 63 canonical garment contours produced during `M00.4`/`M00.10` to approve production adoption in `M02a` and `M02f` (or select optional Rust/C++ `PyO3` acceleration if the pure-Python `mpmath.iv` Stage 2 verifier exceeds `5 ms` per contour).

---

## 8. Consequences & Enforcement

- **Positive:**
  1. Establishes one canonical right-handed CCW normal convention ($\mathbf{N}_+(t)$ inward on CCW exterior contours, $s=+1$ inward, $s=-1$ outward seam allowance) with $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$ (`Critical Correction A`).
  2. Correctly classifies all four CCW circle cases: regular inward ($0 < d < R$), complete inward offset collapse ($d = R$, $\mathbf{O}'(t) \equiv \mathbf{0}$), inward over-offset ($d > R$, tangent reversal with $f < 0$ and **no zero-speed point**), and regular outward ($s = -1, d > 0$) (`Critical Correction B`).
  3. Distinguishes stationary parameterization ($Q(t^*) = 0$) and removable parameterization degeneracy (such as $\mathbf{B}(t) = (t^3, 0)$) from genuine non-removable geometric singularities (`Critical Correction C`).
  4. Cleanly separates all six offset classifications (`REGULARITY_MARGIN_VIOLATION`, `ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP`, `TANGENT_REVERSAL`, `LOCAL_SELF_INTERSECTION`, `GLOBAL_SELF_INTERSECTION`, `INCONCLUSIVE`) and defines the complete 17-Family Classification Test Matrix (`Critical Corrections D & E`).
  5. Maintains strict epistemic honesty regarding the candidate status of `mpmath.iv`, the future status of `IntervalLibraryQualificationReport`, and the four-decision governance lifecycle (`Critical Corrections F & G`).
- **Enforcement (`AC-01`, `AC-02`, `AC-03`, `AC-04`, `AC-05`, `AC-10`):**
  - Enforced by JSON Schema contract validation (`packages/contracts`), the 17-Family Classification Test Matrix (`Section 6`), the future 8-point `IntervalLibraryQualificationReport` (`Section 3.2`), and the CI AST oracle-independence linter (`scripts/check_oracle_independence.py`).
