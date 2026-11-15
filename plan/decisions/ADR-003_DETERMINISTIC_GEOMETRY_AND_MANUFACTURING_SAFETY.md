# ADR-003 — DETERMINISTIC GEOMETRY, EXACT NUMERICAL PRECISION & MANUFACTURING SAFETY (`R2.1.2`)

- **ADR ID:** `ADR-003`
- **Revision:** `2.1.2` (Targeted Mathematical Correction, Numerical Assurance & Governance Alignment)
- **Base Commit:** `8805140b1e6e7799922348369d7e29881102a75e` (`Patroner Blueprint R2.1.1`)
- **Status:** Accepted & Mandatory (`Five-Concept Numerical Assurance, Parameter-to-Output Error Propagation, Four-Layer Method C1-Cert Assurance, Corrected Offset Derivative & Six-Category Tri-State Verification Detailed in ADR-009`)
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05`, `Ch. 07`), `Dossier 03 v5.1`, `Dossier 13 v5.11`, `Dossier 14 v5.12`, Phase E3 Audit Findings (`DEF-M00-01`–`DEF-M00-06`), `REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`, `REQ-MFG-02`, `ADR-009` (`R2.1.2`)

---

## 1. Context & Problem Statement
Independent mathematical audits (Phase E2 and Phase E3) of the current TypeScript repository exposed critical numerical and geometric defects:
- `DEF-M00-01`: `.toFixed(3)` rounding on `arcLengthCm` introduced up to $0.0005\text{ cm}$ truncation error while reporting a quadrature error bound of $0.0000257\text{ cm}$ (violating $|L_{\text{returned}} - L_{\text{true}}| \le \text{bound}$ by $17.1\times$).
- `DEF-M00-02`: 3-point offset curve checking (`u in {0, 0.5, 1}`) missed interior cusps and self-reversals at $t=0.25$ on cubic Bézier sub-segments and allowed `2%`-span straight line segments on curved primary cutting contours.
- `DEF-M00-06`: `.toFixed(2)` (`roundCoord`) truncated intermediate coordinates inside `cubicBezierPoint`, `splitCubicBezier`, and `lineSegmentIntersection`.

In Blueprint Revision `R2.1.2` (`Critical Corrections A–F`), the numerical assurance and offset verification rules in `ADR-003` and `ADR-009` enforce:
1. **Corrected Offset Derivative Identity (`Critical Correction A`, `ADR-009 §4`):** Under $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\hat{\mathbf{n}}_+(t)$ and $\hat{\mathbf{n}}_+'(t) = -\kappa(t)\,\mathbf{B}'(t)$, the offset derivative is $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$ with regularity factor $f(t) = 1 - \frac{s\,d\,C(t)}{Q(t)^{3/2}}$ for $Q(t) > 0$, separate treatment of zero-speed points $Q(t) = 0$, and sign condition $s\,d\,C(t) > 0$ for concave evolute cusps and tangent reversals.
2. **Parameter Uncertainty vs. Geometric Output Error (`Critical Correction B`, `ADR-009 §2.3`):** Parameter bracket half-width $\frac{1}{2}(\overline{t} - \underline{t})$ is never presented as a geometric output error bound without validated derivative propagation $\sup_{t \in I}|X'(t)|\frac{\overline{t} - \underline{t}}{2}$ or direct output interval enclosure $[\underline{X}(I), \overline{X}(I)]$.
3. **Four-Layer `Method C1-Cert` Assurance & Interval Library Qualification (`Critical Correction C`, `ADR-009 §3.2–§3.4`):** Distinguishes the non-strict mathematical theorem ($L_{\mathrm{chord}} \le L_{\mathrm{exact}} \le L_{\mathrm{control\ polygon}}$), algorithmic convergence, implementation assurance obligations, and empirical testing, while requiring explicit qualification of `mpmath.iv` operations against exact rational (`fractions.Fraction`) arithmetic.
4. **Five-Dimensional Oracle Independence & Strict `M00.4` vs. `M02` Separation (`Critical Correction F`, `ADR-009 §6`):** Qualifies algorithmic, source-code, arithmetic/library, fixture, and reviewer independence while keeping all production geometry exclusively in `M02` (`services/fashion-engine/app/pattern_engine/`).

---

## 2. Decision
1. **Raw IEEE 754 `float64` Internal Precision & Zero Intermediate Rounding:**
   - All geometric coordinates, curve subdivisions, intersections, arc lengths, areas, graded families, and marker placements in `services/fashion-engine` (`M02a`–`M02h`, `M05`) are computed and stored in full IEEE 754 `float64` (`cm`).
   - Decimal formatting (`.toFixed(k)` / `round(x, k)`) is **strictly banned** in computational and contract layers and permitted only in human display strings.
2. **Five-Concept Numerical Assurance, Output Error Enclosures & Library Qualification (`ADR-009 §2–§3`):**
   - Every numerical operator and verification oracle separates:
     1. **High-Precision Reference Result ($X_{\mathrm{ref}}$)**,
     2. **Observed Implementation-to-Reference Discrepancy ($E_{\mathrm{obs}} = |X_{\mathrm{float64}} - X_{\mathrm{ref}}|$)**,
     3. **Validated Reference-to-Exact Output Enclosure ($B_{\mathrm{ref}}(X) \ge |X_{\mathrm{ref}} - X_{\mathrm{exact}}|$)** (never silently assumed to be zero, and never conflated with a raw parameter bracket $\frac{1}{2}(\overline{t} - \underline{t})$; if unestablished, the result is labeled `HIGH_PRECISION_NUMERICAL_REFERENCE` / `EMPIRICAL_ESTIMATE`, never `CERTIFIED_ENCLOSURE`),
     4. **Validated Implementation-to-Exact Output Error Bound ($B_{\mathrm{cert}}(X) \ge |X_{\mathrm{float64}} - X_{\mathrm{exact}}|$)** derived via **`Method C1-Cert`** (non-strict chord/control-polygon convex-hull interval enclosure $L_{\mathrm{chord}} \le L_{\mathrm{exact}} \le L_{\mathrm{control\ polygon}}$ backed by all four assurance layers and `mpmath.iv` qualification in `ADR-009 §3.2, §3.4`), **`Method C2`** (exact polynomial Green's integral + Higham rounding bound), or **`Method C3`** (Bernstein convex-hull + qualified `mpmath.iv` interval enclosure), and
     5. **Engineering Acceptance Tolerance ($\tau_{\mathrm{domain}}(X)$)**.
   - The asymptotic Gauss–Legendre discrepancy formula (`Method C1-Est` with $S_{\mathrm{safety}} = 16.0$) is classified strictly as a **`CONSERVATIVE_ENGINEERING_ESTIMATE`** and is never labeled a mathematical proof or certified bound.
3. **Two-Stage Complete-Interval ($t \in [0, 1]$) Offset Verification, Corrected Sign Convention, Six-Category Taxonomy & Tri-State Outcomes (`ADR-009 §4–§5`):**
   - Finite 65-point Gauss–Lobatto sampling (`Stage 1`) is used **only as a fast pre-screen** and is never accepted as proof of regularity.
   - Authoritative verification (`Stage 2` in `M02f` and independent oracle in `M00.4`) evaluates $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$ over $[0, 1]$: first checking base-curve speed $Q(t) = x'(t)^2 + y'(t)^2$ separately for zero-speed singularities ($Q(t^*) = 0$), and on certified $Q(t) > 0$ sub-intervals evaluating $f(t) = 1 - \frac{s\,d\,C(t)}{Q(t)^{3/2}}$ via rationalized polynomials $S(t) = s\,d\,C(t)$, $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2$, and $P_{\mathrm{margin}}(t) = (1 - \varepsilon_{\mathrm{margin}})^2 Q(t)^3 - d^2 C(t)^2$ under sign gate $s\,d\,C(t) > 0$.
   - Outcomes are classified into **`CERTIFIED_VALID`**, **`CERTIFIED_INVALID`**, or **`INCONCLUSIVE`** across the six independent failure categories (`REGULARITY_MARGIN_VIOLATION`, `ACTUAL_ZERO_SPEED_CUSP`, `TANGENT_REVERSAL`, `LOCAL_OFFSET_SELF_INTERSECTION`, `GLOBAL_CONTOUR_SELF_INTERSECTION`, `INCONCLUSIVE_VERIFICATION`).
   - Downstream release gates fail closed unless verification returns **`CERTIFIED_VALID`**, while never misreporting `INCONCLUSIVE` as a confirmed cusp or self-intersection.
4. **Mandatory 8-Stage Marker Nesting & Tech-Pack Sequence (`M02h` → `M05`):**
   - No `ManufacturingTechPack` (`M05.2`) may be assembled without a validated `ValidatedMarkerArtifact` (`M02h`) that verifies $0$ piece-to-piece overlaps, $0$ selvedge breaches, exact grainline alignment ($\le 0.1^\circ$), and exact Green's theorem fabric utilization.
5. **Hard `is_production_ready: false` Invariant:**
   - `is_production_ready` remains `false` on all digital geometry, marker, and tech-pack artifacts until physical plotter verification ($100.0\text{ mm} \times 100.0\text{ mm}$ calibration square within $\pm 0.1\text{ mm}$) and physical first-article sample approval (`M07`) are cryptographically signed.

---

## 3. Consequences & Enforcement
- **Positive:** Permanently closes `DEF-M00-01`, `DEF-M00-02`, and `DEF-M00-06`, corrects the offset derivative sign to $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, enforces rigorous parameter-to-output error propagation and 4-layer interval assurance, and separates proven geometric defects from inconclusive interval bounds (`ADR-009`).
- **Enforcement (`AC-03`, `AC-05`, `AC-10`):** Production algorithms live exclusively in `M02a`–`M02h` and `M05`; independent verification executes in `services/fashion-engine/tests/oracles/` (`M00.4`) with zero shared production geometry imports and explicit 5-dimensional oracle independence qualification (`ADR-009 §6`).
