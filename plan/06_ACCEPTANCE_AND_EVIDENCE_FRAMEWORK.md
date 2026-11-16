# 06 — Acceptance Criteria, Numerical Assurance, and Evidence Framework

**Document ID:** `PATRONER-R2.1.2-R1-06`  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Numerical Assurance Alignment)  
**Governing Authority:** Monograph v5.16; Addendum v4.1; Revision v4.5; `ADR-003`, `ADR-006`, `ADR-008`, `ADR-009` (`R2.1.2-R1`)  
**Status:** **CONTROLLED SPECIFICATION — M00 REMAINS BLOCKED PENDING EXPLICIT OWNER APPROVAL**

> **Governance Rule (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Evidence-First Engineering Principle

No milestone (`M00`–`M11`) or authorization gate (`Gate Auth-1`–`Gate Auth-4`) may be declared complete based on self-reported status, unverified unit tests, or visual inspection alone. Every milestone requires **deterministic, machine-verifiable evidence artifacts** archived with SHA-256 checksums.

Furthermore, this framework enforces strict **Verification Honesty (`ADR-009 §6.3`)**:
* **Executed Specification-Time Sanity Checks:** Only the 4 analytical circle offset test cases (`Case 1`–`Case 4`) and the analytical derivation of the removable parameterization degeneracy counterexample $\mathbf{B}(t) = (t^3, 0)$ have been evaluated at specification time (`ADR-009 §1.4`, `§2.2`, `§6.1`).
* **Required Future Implementation Deliverables (`M00.4` / `M00.10`):** The `IntervalLibraryQualificationReport`, the executable `C1-Cert` Python reference oracle, and the **17-Family Adversarial Geometry Test Suite (`AG-01`–`AG-17`)** have **not yet been executed in code** and are mandatory deliverables of `M00.4` and `M00.10`.

---

## 2. Numerical & Geometric Acceptance Thresholds (`M00`, `M02`, `M05`)

All geometry produced by the Python `C1-Fast` engine (`M02`) and audited by the `M05` Pre-Flight Gatekeeper must pass the following quantitative acceptance gates when measured against the `C1-Cert` reference oracle (`ADR-009`):

### 2.1 Curve Parameterization, Root Isolation & Arc-Length Gates
1. **Forward Arc-Length Accuracy:**
   $$\max_{t \in [0, 1]} \bigl|L_{\mathrm{fast}}(t) - L_{\mathrm{cert}}(t)\bigr| \le 10^{-6}\text{ cm} \quad (10\text{ nm})$$
2. **Inverse Arc-Length Mapping ($s \mapsto t$) & Notch Positioning:**
   $$\bigl|L(t^*) - s_{\mathrm{target}}\bigr| \le 10^{-7}\text{ cm} \quad (1\text{ nm})$$
3. **Dual Root-Isolation Stopping Criterion (Parameter Width vs. Physical Position Error, `ADR-009 §4.1`):**
   Every isolated root interval $[t] = [\underline{t}, \overline{t}]$ for cusp detection, self-intersection, or curve-curve intersection must simultaneously satisfy:
   $$\delta_t = \overline{t} - \underline{t} \le 10^{-12} \quad \text{AND} \quad \Delta_{\mathrm{pos}}([t]) := \sup_{\tau \in [t]} \|\mathbf{B}'(\tau)\|\,\delta_t \le 10^{-7}\text{ cm}$$

### 2.2 Offset Curve Classification & Approximation Gates (`ADR-009 §2–§4`)
Using the canonical CCW exterior boundary convention where $\mathbf{N}_+(t) = \frac{(-y'(t), x'(t))}{\sqrt{Q(t)}}$ points **inward**, $\mathbf{N}_+'(t) = -\kappa(t)\mathbf{B}'(t)$, and $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$ has derivative $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$:
1. **100% Classification Accuracy Across All 6 Offset Categories:**
   The `C1-Cert` oracle and `M02e` offset engine must classify every test curve into its exact category (`ADR-009 §3`):
   * `Category 1: CERTIFIED_REGULAR`
   * `Category 2a: ACTUAL_ZERO_SPEED_CUSP` ($Q(t^*)=0$ with true tangent reversal $\mathbf{T}(t^{*+}) = -\mathbf{T}(t^{*-})$ or curvature blow-up)
   * `Category 2b: ACTUAL_CURVATURE_CUSP` ($Q(t^*)>0$ with transverse root $f(t^*)=0, f'(t^*)\ne 0$, i.e., $P_{\mathrm{cusp}}(t^*)=0$ and $s\cdot C(t^*) > 0$)
   * `Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY` ($Q(t^*)=0$ with odd multiplicity $m$ such that $\mathbf{T}(t^{*-}) = \mathbf{T}(t^{*+})$ and $1 - s\,d\,\kappa_{\lim} > 0$, e.g., $\mathbf{B}(t) = (t^3, 0)$ at $t = 0$)
   * `Category 3: TANGENTIAL_CUSP_DEGENERACY` (grazing root $f(t^*)=0, f'(t^*)=0$ or near-singular clearance)
   * `Category 4: SELF_INTERSECTING_NON_LOCAL` (locally regular offset with global self-intersection loop)
2. **Piecewise Cubic Bezier Offset Fit Error Bounds (`Category 1` & Reparameterized `Category 2c`):**
   * **Dense Sample Grid Error ($N_{\mathrm{grid}} = 1024$ points):** $E_{\mathrm{grid}} \le 0.005\text{ cm}$ (`0.05 mm`).
   * **Certified Interval Enclosure Bound ($N_{\mathrm{cert}} \ge 256$ sub-intervals):** $E_{\mathrm{cert}} \le 0.010\text{ cm}$ (`0.10 mm`), where $E_{\mathrm{cert}} = \max_m \overline{D}([t_m])$.
   * **Interior Sub-Segment Join Continuity:** $G^1$ tangent angle jump $\Delta\theta \le 0.05^\circ$.

### 2.3 Topological & Manufacturing Safety Gates (`M05.3` & `DEC-11`)
1. **Closed Simple Polygon Topology:** 0 self-intersections (`is_simple == True`), 0 micro-sliver faces ($< 10^{-4}\text{ cm}^2$), closure gap $\le 10^{-6}\text{ cm}$.
2. **Two-Tier Paired Seam Length Parity (`DEC-11`):**
   * **Tier 1 — CAD Geometry Gate (`M02f` / `M05.3`):** $\bigl|L_{\mathrm{CAD}}(e_A) - L_{\mathrm{CAD}}(e_B) - \Delta_{\mathrm{ease}}\bigr| \le 0.05\text{ cm}$ (`0.5 mm`).
   * **Tier 2 — Physical Sewn / 3D Assembly Gate (`M06.1` / `M09.3`):** $\bigl|L_{\mathrm{sewn}}(e_A) - L_{\mathrm{sewn}}(e_B) - \Delta_{\mathrm{ease}}\bigr| \le 0.20\text{ cm}$ (`2.0 mm`).
3. **DXF-AAMA / ASTM Independent Round-Trip Gate (`M05.1`):** Re-parsing the exported `.dxf` file via an independent reader must recover all layers (`1, 2, 4, 7, 8, 11`), piece metadata, notches, and boundary vertices within $\le 0.001\text{ cm}$ (`0.01 mm`).

---

## 3. Mandatory 17-Family Adversarial Geometry Test Suite (`AG-01`–`AG-17`)

To pass `M00.4`, `M00.10`, and `Gate Auth-2`, the verification harness must execute and archive 100% passing results for all **17 Adversarial Geometry Test Families** (`ADR-009 §6.2`):

| Family ID | Test Family Name | Target Singularity / Condition | Required Expected Classification & Outcome |
| :--- | :--- | :--- | :--- |
| **`AG-01`** | Exact Circle Inward Sub-Critical ($d < R$) | CCW circle $R=10\text{ cm}, s=+1, d=1.5\text{ cm}$ | `Category 1: CERTIFIED_REGULAR`, exact radius $R-d=8.5\text{ cm}$, $E_{\mathrm{cert}} \le 0.01\text{ cm}$ |
| **`AG-02`** | Exact Circle Inward Critical ($d = R$) | CCW circle $R=10\text{ cm}, s=+1, d=10.0\text{ cm}$ | `Category 3: TANGENTIAL_CUSP_DEGENERACY`, focal collapse $\mathbf{O}(t) \equiv (0,0)$, $\mathbf{O}'(t) \equiv \mathbf{0}$ |
| **`AG-03`** | Exact Circle Inward Super-Critical ($d > R$) | CCW circle $R=10\text{ cm}, s=+1, d=12.0\text{ cm}$ | Inverted orientation $1 - d/R = -0.2 < 0$, flagged & trimmed (`Category 2b`/`Category 4`) |
| **`AG-04`** | Exact Circle Outward Seam Allowance ($s = -1$) | CCW circle $R=10\text{ cm}, s=-1, d=1.5\text{ cm}$ | `Category 1: CERTIFIED_REGULAR`, exact radius $R+d=11.5\text{ cm}$, $f(t)=1.15 > 0$ |
| **`AG-05`** | Cubic Bezier Inflection Point | $C(t^*)=0, C'(t^*)\ne 0$ at $t^*=0.5$ | `Category 1: CERTIFIED_REGULAR`, smooth sign transition of $\kappa(t)$ |
| **`AG-06`** | High-Curvature Neckline / Armscye Curve | $\max \kappa(t) > 1/d$ on inward offset | `Category 2b: ACTUAL_CURVATURE_CUSP`, exact isolation of 2 transverse roots $t_1^*, t_2^*$ |
| **`AG-07`** | Grazing Tangential Curvature Extrema | $\max \kappa(t) = 1/d$ ($f(t^*)=0, f'(t^*)=0$) | `Category 3: TANGENTIAL_CUSP_DEGENERACY`, certified interval bracket without false negative |
| **`AG-08`** | Symmetric Swallowtail Double Cusp | Two transverse roots of $f(t)=0$ + self-crossing | `Category 2b` + `Category 4`, exact swallowtail loop trimming |
| **`AG-09`** | Interior True Zero-Speed Cusp | $\mathbf{B}(t) = (t^2, t^3)$ on $[-1, 1]$ ($m=2, n=3$) | `Category 2a: ACTUAL_ZERO_SPEED_CUSP`, tangent reverses by $\pi$ radians across $t^*=0$ |
| **`AG-10`** | Endpoint Zero-Speed Degeneracy | $\mathbf{P}_1 = \mathbf{P}_0$ ($t^*=0, Q(0)=0$) | One-sided Taylor limit evaluated; classified via limiting curvature $\kappa(0^+)$ |
| **`AG-11`** | **Removable Parameterization Degeneracy** | $\mathbf{B}(t) = (t^3, 0)$ on $[-1, 1]$ ($m=3$ odd at $t^*=0$) | **`Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY`**; continuous $\mathbf{T}=(1,0), \kappa=0$; reparameterized to regular line; **NOT** classified as cusp |
| **`AG-12`** | Coincident Interior Control Points | $\mathbf{P}_1 = \mathbf{P}_2$ with non-collinear $\mathbf{P}_0, \mathbf{P}_3$ | Certified speed-minimum / cusp separation via `C1-Cert` |
| **`AG-13`** | Extreme Parametric Speed Ratio | $\max Q(t) / \min Q(t) > 10^8$ ($Q(t) > 0$) | Triggers `C1-Cert` escalation; satisfies both $\delta_t \le 10^{-12}$ and $\Delta_{\mathrm{pos}} \le 10^{-7}\text{ cm}$ |
| **`AG-14`** | Acute Miter Corner ($\theta < 25^\circ$) | Sharp dart tip / collar point outward offset | Certified miter-limit bevel / trim (`M02e`) with 0 self-intersections |
| **`AG-15`** | Global Non-Local Pocket Self-Intersection | Locally regular $f(t) > 0$ everywhere, global overlap | `Category 4: SELF_INTERSECTING_NON_LOCAL`, detected by Bezier fat-line AABB pruning + trimmed |
| **`AG-16`** | Near-Multiple Root Cluster (Wilkinson-Style) | Two roots separated by $\Delta t = 10^{-7}$ | Isolated into disjoint certified intervals by `113-bit` interval + `Fraction` oracle |
| **`AG-17`** | Full Bodice Front + Armscye + Dart + Notches | End-to-end multi-edge piece with $d = 1.5\text{ cm}$ | Closed simple exterior & sew rings, notch error $\le 10^{-7}\text{ cm}$, seam parity $\le 0.05\text{ cm}$ |

---

## 4. Gate-by-Gate Evidence & Artifact Bundle Requirements

### 4.1 `Gate Auth-1` (Pre-`M00` Authorization Gate)
* **Required Inputs:** Published Blueprint `R2.1.2-R1` documentation (`plan/`), `ADR-001`–`ADR-009` (`R2.1.2-R1`), `DEC-01` architecture selection, and `DEC-13 Stage 1` candidate interval library selection (`mpmath.iv` + `Fraction` primary candidate).
* **Exit Criterion:** Explicit written Owner sign-off unblocking `M00`.

### 4.2 `Gate Auth-2` (Post-`M00` Audit & Core Platform Entry Gate)
* **Required Machine-Verifiable Evidence Artifacts from `M00`:**
  1. `SchemasLockReport.json` (`M00.1`: JSON Schema Draft 2020-12 + Pydantic v2 parity).
  2. `BaselineDivergenceRegistry.json` (`M00.2`: `C0-Legacy` snapshots and `Class A` / `Class B` classification).
  3. `IntervalLibraryQualificationReport.json` (`M00.4`: empirical verification of outward rounding, performance, and zero false negatives on candidate libraries).
  4. `AdversarialGeometryVerificationReport.json` (`M00.4`/`M00.10`: 100% pass across all 17 adversarial families `AG-01`–`AG-17` and all 6 offset categories).
  5. `ReproducibleEnvironmentManifest.json` (`M00.10`: pinned Python 3.12 lockfile, container digest, and SHA-256 artifact manifest).
* **Required Decisions Signed Off:** `DEC-13 Stage 2` (Production Interval Library Adoption), `DEC-02 Stage 1`, `DEC-03 Stage 1`, `DEC-04`, `DEC-05`, `DEC-06`, `DEC-09`, `DEC-11`.

### 4.3 `Gate Auth-3` (Vertical Slice 1 & 3D Physics Qualification Gate)
* **Required Evidence Artifacts:**
  1. `VerticalSlice1VerificationBundle.json` (Bodice + Trouser E2E draft $\to$ grade $\to$ offset $\to$ DXF-AAMA round-trip $\to$ signed `TechPackManifest`).
  2. `ClothSimulationQualificationReport.json` (`DEC-02 Stage 2`: passing benchmarks `B1` Flat Cantilever Bending, `B2` Cylindrical Drape, `B3` Spherical Four-Point Shear Drape, and `B4` Bodice/Trouser Tension Map within $\le 5\%$ error).
  3. `MaterialCorrelationReport.json` (`DEC-03 Stage 2`: empirical validation of the 3-tier fabric testing hierarchy).

### 4.4 `Gate Auth-4` (Commercial Pilot & Financial Readiness Gate)
* **Required Evidence Artifacts:**
  1. `SubLedgerReconciliationAudit.json` (`M08`: double-entry invariant $\sum \text{Debits} = \sum \text{Credits}$, idempotent webhook replay, immutable escrow split).
  2. `CryptographicManifestAudit.json` (`M05.5`/`M09.2`: Ed25519 signature verification on `TechPackManifest`).
  3. Signed Owner approvals for `DEC-07`, `DEC-08`, `DEC-10`, and `DEC-12`.
