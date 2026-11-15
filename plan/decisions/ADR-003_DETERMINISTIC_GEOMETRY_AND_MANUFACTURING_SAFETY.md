# ADR-003 — DETERMINISTIC GEOMETRY, EXACT NUMERICAL PRECISION & MANUFACTURING SAFETY

- **ADR ID:** `ADR-003`
- **Revision:** `2.1` (Controlled Architecture, Dependency, Numerical Assurance & Release-Governance Correction)
- **Status:** Accepted & Mandatory (`Numeric Assurance & Complete-Interval Offset Verification Detailed in ADR-009`)
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05`, `Ch. 07`), `Dossier 03 v5.1`, `Dossier 13 v5.11`, `Dossier 14 v5.12`, Phase E3 Audit Findings (`DEF-M00-01`–`DEF-M00-06`), `REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`, `REQ-MFG-02`, `ADR-009`

---

## 1. Context & Problem Statement
Independent mathematical audits (Phase E2 and Phase E3) of the current TypeScript repository exposed critical numerical and geometric defects:
- `DEF-M00-01`: `.toFixed(3)` rounding on `arcLengthCm` introduced up to $0.0005\text{ cm}$ truncation error while reporting a quadrature error bound of $0.0000257\text{ cm}$ (violating $|L_{\text{returned}} - L_{\text{true}}| \le \text{bound}$ by $17.1\times$).
- `DEF-M00-02`: 3-point offset curve checking (`u in {0, 0.5, 1}`) missed interior cusps and self-reversals at $t=0.25$ on cubic Bézier sub-segments and allowed `2%`-span straight line segments on curved primary cutting contours.
- `DEF-M00-06`: `.toFixed(2)` (`roundCoord`) truncated intermediate coordinates inside `cubicBezierPoint`, `splitCubicBezier`, and `lineSegmentIntersection`.

Furthermore, Blueprint R2 required strengthening in Revision 2.1 (`Corrections 02, 04, and 05`) to:
1. Explicitly separate the four distinct numerical concepts (`High-precision reference value`, `Floating-point implementation error`, `Certified / rigorously justified numerical error bound`, and `Domain acceptance tolerance`),
2. Replace finite 65-point node sampling alone with a **complete parameter-interval ($t \in [0, 1]$)** proof-quality verification procedure (`ADR-009`), and
3. Enforce the mandatory 8-stage deterministic marker nesting and validation sequence (`M02h` → `M05`).

---

## 2. Decision
1. **Raw IEEE 754 `float64` Internal Precision & Zero Intermediate Rounding:**
   - All geometric coordinates, curve subdivisions, intersections, arc lengths, areas, graded families, and marker placements in `services/fashion-engine` (`M02a`–`M02h`, `M05`) are computed and stored in full IEEE 754 `float64` (`cm`).
   - Decimal formatting (`.toFixed(k)` / `round(x, k)`) is **strictly banned** in computational and contract layers and permitted only in human display strings.
2. **Four-Tier Numerical Assurance & Certified Error Bounds (`ADR-009`):**
   - Every numerical operator in `M02a`–`M02h` and `M05` separates:
     1. **High-Precision Reference Value ($X_{\text{ref}}$)** computed by the independent `mpmath` (`mp.dps = 80`) oracle,
     2. **Floating-Point Implementation Error ($E_{\text{impl}} = |X_{\text{float64}} - X_{\text{ref}}|$)**,
     3. **Certified / Rigorously Justified Numerical Error Bound ($B_{\text{cert}}$)** computed via `Method C1` (aposteriori + Higham rounding + regular speed floor), `Method C2` (exact polynomial Green's integral + compensated summation bound), or `Method C3` (Bernstein convex-hull + `mpmath.iv` interval enclosure), and
     4. **Domain Acceptance Tolerance ($\tau_{\text{domain}}$)**.
   - Every returned bound must satisfy both $E_{\text{impl}} \le B_{\text{cert}}$ and $B_{\text{cert}} \le \tau_{\text{domain}}$.
3. **Two-Stage Complete-Interval ($t \in [0, 1]$) Offset Regularity & Self-Intersection Verification (`ADR-009`):**
   - Finite 65-point Gauss–Lobatto sampling (`Stage 1`) is used **only as a fast rejection screen** and is never accepted as proof of regularity.
   - Authoritative certification (`Stage 2`) uses **exact Bernstein-basis polynomial bounds (`P_cusp(t)` degree 6, `Q_speed(t)` degree 4) combined with rigorous interval arithmetic (`mpmath.iv`)** over every sub-interval $[a, b] \subseteq [0, 1]$, plus complete-domain spatial/parametric self-intersection checking (`M02f`).
4. **Mandatory 8-Stage Marker Nesting & Tech-Pack Sequence (`M02h` → `M05`):**
   - No `ManufacturingTechPack` (`M05.2`) may be assembled without a validated `MarkerNestingResult` (`M02h`) that verifies $0$ piece-to-piece overlaps, $0$ selvedge breaches, exact grainline alignment ($\le 0.1^\circ$), and exact Green's theorem fabric utilization ($U = \sum A_{\text{cut},i} / (W_{\text{usable}} \cdot L_{\text{marker}})$).
5. **Hard `is_production_ready: false` Invariant:**
   - `is_production_ready` remains `false` on all digital geometry, marker, and tech-pack artifacts until physical plotter verification ($100.0\text{ mm} \times 100.0\text{ mm}$ calibration square within $\pm 0.1\text{ mm}$) and physical first-article sample approval (`M07`) are cryptographically signed.

---

## 3. Consequences & Enforcement
- **Positive:** Permanently closes `DEF-M00-01`, `DEF-M00-02`, and `DEF-M00-06`, guarantees complete-interval $[0, 1]$ mathematical soundness (`ADR-009`), and ensures cut files and marker layouts cannot damage physical fabric.
- **Enforcement (`AC-03`, `AC-05`, `AC-10`):** Verified on every commit by `services/fashion-engine/tests/oracles/oracle_geometry_mpmath.py` and `test_offset_interval_certification.py`.
