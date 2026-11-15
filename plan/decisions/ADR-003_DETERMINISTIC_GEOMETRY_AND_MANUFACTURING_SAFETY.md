# ADR-003 — DETERMINISTIC GEOMETRY, EXACT NUMERICAL PRECISION & MANUFACTURING SAFETY (`R2.1.1`)

- **ADR ID:** `ADR-003`
- **Revision:** `2.1.1` (Targeted Numerical Assurance, Migration Boundary & Governance Correction)
- **Status:** Accepted & Mandatory (`Five-Concept Numerical Assurance, Method C1-Cert vs. C1-Est, Six-Category Offset Taxonomy & Tri-State Interval Verification Detailed in ADR-009`)
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05`, `Ch. 07`), `Dossier 03 v5.1`, `Dossier 13 v5.11`, `Dossier 14 v5.12`, Phase E3 Audit Findings (`DEF-M00-01`–`DEF-M00-06`), `REQ-GEO-01`, `REQ-GEO-02`, `REQ-MFG-01`, `REQ-MFG-02`, `ADR-009`

---

## 1. Context & Problem Statement
Independent mathematical audits (Phase E2 and Phase E3) of the current TypeScript repository exposed critical numerical and geometric defects:
- `DEF-M00-01`: `.toFixed(3)` rounding on `arcLengthCm` introduced up to $0.0005\text{ cm}$ truncation error while reporting a quadrature error bound of $0.0000257\text{ cm}$ (violating $|L_{\text{returned}} - L_{\text{true}}| \le \text{bound}$ by $17.1\times$).
- `DEF-M00-02`: 3-point offset curve checking (`u in {0, 0.5, 1}`) missed interior cusps and self-reversals at $t=0.25$ on cubic Bézier sub-segments and allowed `2%`-span straight line segments on curved primary cutting contours.
- `DEF-M00-06`: `.toFixed(2)` (`roundCoord`) truncated intermediate coordinates inside `cubicBezierPoint`, `splitCubicBezier`, and `lineSegmentIntersection`.

In Blueprint Revision `R2.1.1` (`Corrections A–E`), the numerical assurance and offset verification rules in `ADR-003` and `ADR-009` are refined to:
1. Enforce the explicit triangle inequality $|X_{\mathrm{float64}} - X_{\mathrm{exact}}| \le |X_{\mathrm{float64}} - X_{\mathrm{ref}}| + |X_{\mathrm{ref}} - X_{\mathrm{exact}}|$ and the **Five-Concept Numerical Assurance Taxonomy** (`Correction A`),
2. Downgrade the adaptive Gauss–Legendre quadrature difference formula (`Method C1-Est` with $S_{\mathrm{safety}}=16.0$) to a **`CONSERVATIVE_ENGINEERING_ESTIMATE`** while using **`Method C1-Cert`** (outward-rounded De Casteljau chord vs. control-polygon convex-hull enclosure in `mpmath.iv`) whenever a true mathematical arc-length certificate is required (`Correction B`),
3. Enforce the **Six-Category Offset Geometry Failure Taxonomy** and **Tri-State Interval Verification Outcomes** (`CERTIFIED_VALID`, `CERTIFIED_INVALID`, `INCONCLUSIVE`) (`Corrections C & D`), and
4. Strictly separate the **`M00.4` Independent Reference-Oracle Harness** from **`M02a`/`M02f` Authoritative Production Geometry Implementation** (`Correction E`).

---

## 2. Decision
1. **Raw IEEE 754 `float64` Internal Precision & Zero Intermediate Rounding:**
   - All geometric coordinates, curve subdivisions, intersections, arc lengths, areas, graded families, and marker placements in `services/fashion-engine` (`M02a`–`M02h`, `M05`) are computed and stored in full IEEE 754 `float64` (`cm`).
   - Decimal formatting (`.toFixed(k)` / `round(x, k)`) is **strictly banned** in computational and contract layers and permitted only in human display strings.
2. **Five-Concept Numerical Assurance & Certified Error Enclosures (`ADR-009 §2–§3`):**
   - Every numerical operator and verification oracle separates:
     1. **High-Precision Reference Result ($X_{\mathrm{ref}}$)**,
     2. **Observed Implementation-to-Reference Discrepancy ($E_{\mathrm{obs}} = |X_{\mathrm{float64}} - X_{\mathrm{ref}}|$)**,
     3. **Certified Reference-to-Exact Enclosure ($B_{\mathrm{ref}} \ge |X_{\mathrm{ref}} - X_{\mathrm{exact}}|$)** (never silently assumed to be zero; if unestablished, the result is labeled `HIGH_PRECISION_NUMERICAL_REFERENCE` / `EMPIRICAL_ESTIMATE`, never a `CERTIFIED_BOUND`),
     4. **Certified Implementation-to-Exact Error Bound ($B_{\mathrm{cert}} \ge |X_{\mathrm{float64}} - X_{\mathrm{exact}}|$)** derived via **`Method C1-Cert`** (De Casteljau chord/control-polygon convex-hull interval enclosure), **`Method C2`** (exact polynomial Green's integral + Higham rounding bound), or **`Method C3`** (Bernstein convex-hull + `mpmath.iv` interval enclosure), and
     5. **Engineering Acceptance Tolerance ($\tau_{\mathrm{domain}}$)**.
   - The asymptotic Gauss–Legendre discrepancy formula (`Method C1-Est` with $S_{\mathrm{safety}} = 16.0$) is classified strictly as a **`CONSERVATIVE_ENGINEERING_ESTIMATE`** and is never labeled a mathematical proof or certified bound (`Correction B`).
3. **Two-Stage Complete-Interval ($t \in [0, 1]$) Offset Verification, Six-Category Failure Taxonomy & Tri-State Outcomes (`ADR-009 §4–§5`):**
   - Finite 65-point Gauss–Lobatto sampling (`Stage 1`) is used **only as a fast rejection screen** and is never accepted as proof of regularity.
   - Authoritative verification (`Stage 2` in `M02f` and independent oracle in `M00.4`) uses **Bernstein-basis polynomial enclosures combined with outward-rounded interval arithmetic (`mpmath.iv`)** over $[0, 1]$, classifying outcomes into **`CERTIFIED_VALID`**, **`CERTIFIED_INVALID`**, or **`INCONCLUSIVE`**, and distinguishing the six independent failure categories (`REGULARITY_MARGIN_VIOLATION`, `ACTUAL_ZERO_SPEED_CUSP`, `TANGENT_REVERSAL`, `LOCAL_OFFSET_SELF_INTERSECTION`, `GLOBAL_CONTOUR_SELF_INTERSECTION`, `INCONCLUSIVE_VERIFICATION`).
   - Downstream release gates fail closed unless verification returns **`CERTIFIED_VALID`**, while never misreporting `INCONCLUSIVE` as a confirmed cusp or self-intersection.
4. **Mandatory 8-Stage Marker Nesting & Tech-Pack Sequence (`M02h` → `M05`):**
   - No `ManufacturingTechPack` (`M05.2`) may be assembled without a validated `ValidatedMarkerArtifact` (`M02h`) that verifies $0$ piece-to-piece overlaps, $0$ selvedge breaches, exact grainline alignment ($\le 0.1^\circ$), and exact Green's theorem fabric utilization.
5. **Hard `is_production_ready: false` Invariant:**
   - `is_production_ready` remains `false` on all digital geometry, marker, and tech-pack artifacts until physical plotter verification ($100.0\text{ mm} \times 100.0\text{ mm}$ calibration square within $\pm 0.1\text{ mm}$) and physical first-article sample approval (`M07`) are cryptographically signed.

---

## 3. Consequences & Enforcement
- **Positive:** Permanently closes `DEF-M00-01`, `DEF-M00-02`, and `DEF-M00-06`, enforces mathematical honesty on reference enclosures and `Method C1`, and separates proven geometric defects from inconclusive interval bounds (`ADR-009`).
- **Enforcement (`AC-03`, `AC-05`, `AC-10`):** Production algorithms live exclusively in `M02a`–`M02h` and `M05`; independent verification executes in `services/fashion-engine/tests/oracles/` (`M00.4`) with zero shared production geometry imports (`Correction E`).
