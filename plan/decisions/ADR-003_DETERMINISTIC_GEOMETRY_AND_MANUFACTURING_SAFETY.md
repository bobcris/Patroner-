# ADR-003 — DETERMINISTIC GEOMETRY, EXACT NUMERICAL PRECISION & MANUFACTURING SAFETY

- **ADR ID:** `ADR-003`
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05`, `Ch. 07`), `Dossier 03 v5.1`, `Dossier 13 v5.11`, `Dossier 14 v5.12`, Phase E3 Audit Findings (`DEF-M00-01`–`DEF-M00-06`), `REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`

---

## 1. Context & Problem Statement
Independent mathematical audits (Phase E2 and Phase E3) of the current TypeScript repository exposed critical numerical and geometric defects:
- `DEF-M00-01`: `.toFixed(3)` rounding on `arcLengthCm` introduced up to $0.0005\text{ cm}$ truncation error while reporting a quadrature error bound of $0.0000257\text{ cm}$ (violating $|L_{\text{returned}} - L_{\text{true}}| \le \text{bound}$ by $17.1\times$).
- `DEF-M00-02`: 3-point offset curve checking (`u in {0, 0.5, 1}`) missed interior cusps and self-reversals at $t=0.25$ on cubic Bézier sub-segments and allowed `2%`-span straight line segments on curved primary cutting contours.
- `DEF-M00-06`: `.toFixed(2)` (`roundCoord`) truncated intermediate coordinates inside `cubicBezierPoint`, `splitCubicBezier`, and `lineSegmentIntersection`.

## 2. Decision
1. **Raw IEEE 754 `float64` Internal Precision & Zero Intermediate Rounding:**
   - All geometric coordinates, curve subdivisions, intersections, arc lengths, and areas in `services/fashion-engine` (`M02a`–`M02h`, `M05`) are computed and stored in full IEEE 754 `float64` (`cm`).
   - Decimal formatting (`.toFixed(k)` / `round(x, k)`) is **strictly banned** in computational and contract layers and permitted only in human display strings.
2. **Guaranteed Conservative Error Bounds Verified by `mpmath` (`mp.dps = 80`):**
   - Every returned numerical quantity (`arc_length_cm`, `net_area_cm2`, `cut_area_cm2`) must be accompanied by an upper error bound that strictly bounds the true mathematical error against an 80-digit arbitrary-precision `mpmath` reference oracle:
     $$|X_{\text{returned}} - X_{\text{exact}}| \le \text{reported\_upper\_bound}$$
3. **65-Point Gauss–Lobatto + Analytical Curvature Extrema Cusp Rejection:**
   - Every offset curve segment at distance $d$ is checked at 65 interior Gauss–Lobatto nodes **plus** analytical roots of $\kappa'(t) = 0$. Any interior point where $1 + s \cdot d \cdot \kappa(t) \le \varepsilon_{\text{cusp}}$ or tangent dot product $\hat{\mathbf{t}}_{\text{offset}}(t) \cdot \hat{\mathbf{t}}_{\text{base}}(t) \le 0$ triggers exact subdivision and envelope trimming (`M02f`).
4. **Hard `is_production_ready: false` Invariant:**
   - `is_production_ready` remains `false` on all digital geometry and tech-pack artifacts until physical plotter verification ($100.0\text{ mm} \times 100.0\text{ mm}$ calibration square within $\pm 0.1\text{ mm}$) and physical first-article sample approval (`M07`) are cryptographically signed.

## 3. Consequences & Enforcement
- **Positive:** Permanently closes `DEF-M00-01`, `DEF-M00-02`, and `DEF-M00-06`, ensuring cut files cannot damage physical fabric due to hidden cusps or cumulative rounding drift.
- **Enforcement (`AC-03`, `AC-10`):** Verified on every commit by `services/fashion-engine/tests/oracles/oracle_geometry_mpmath.py`.
