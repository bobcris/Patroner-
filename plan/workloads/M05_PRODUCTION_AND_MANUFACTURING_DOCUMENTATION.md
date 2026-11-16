# Workload M05 — Production Export, Pre-Flight Gatekeeper & Cryptographic Tech Pack

**Document ID:** `PATRONER-R2.1.2-R1-M05`  
**Workload ID:** `M05` (`M05.1` through `M05.5`)  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Numerical Assurance Alignment)  
**Governing Authority:** Monograph v5.16 (Part II §7, Part IV §13); Addendum v4.1 (§4, §6); `ADR-003`, `ADR-006`, `ADR-009` (`R2.1.2-R1`)  
**Status:** **SPECIFICATION COMPLETE — BLOCKED PENDING GATE AUTH-2 & M02 COMPLETION**

> **Mandatory Governance Boundary (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Mission and Entry Prerequisites

`M05` converts verified 2D pattern geometry from `M02` into industrial-grade manufacturing packages (DXF-AAMA / ASTM D6673, nested cut markers, BOM/spec sheets, and cryptographically signed `TechPackManifest` bundles) gated by an independent **Pre-Flight Manufacturing Gatekeeper (`M05.3`)**.

### 1.1 Hard Entry Prerequisites (`Gate Auth-2` & `M02`)
`M05` requires:
1. Completion of `M00` (`M00.1`–`M00.10`) and Owner sign-off at **`Gate Auth-2`**, including **`DEC-09`** (Cryptographic Signing Standard: `Ed25519` over RFC 8785 JCS), **`DEC-11`** (Two-Tier Paired Seam Tolerance Reconciliation: `0.05 cm` CAD vs. `0.20 cm` Sewn), and **`DEC-13 Stage 2`** (Production Interval Library Adoption).
2. Certified pattern geometry outputs from `M02` (`M02a`–`M02g`).

---

## 2. Sub-Workload Breakdown (`M05.1` through `M05.5`)

### `M05.1` — Industrial DXF-AAMA / ASTM D6673 Exporter & Independent Round-Trip Validator
* Emits compliant DXF-AAMA files with strict layer discipline:
  * `Layer 1`: Exterior Cut Boundary (CCW closed polyline/spline).
  * `Layer 2`: Drill Holes & Internal Points.
  * `Layer 4`: Slit / V / T Notches anchored to boundary.
  * `Layer 7`: Grainline vector strictly inside piece interior.
  * `Layer 8`: Internal Sew / Net Pattern Boundary (CCW closed loop).
  * `Layer 11`: Internal Cutouts / Windows (CW closed loops).
* Every exported `.dxf` file is immediately re-parsed by the independent `M00.7` round-trip reader to verify that all vertices, layers, and arc lengths match the source `M02` geometry within $\le 0.001\text{ cm}$ (`0.01 mm`).

### `M05.2` — Nested Marker Plotter Export (HPGL / Cut-File / PDF 1:1 Scale)
* Exports nested marker layouts from `M02h` with physical 10 cm $\times$ 10 cm calibration squares, roll width borders, piece labels, and CNC cutter toolpath ordering.

### `M05.3` — Pre-Flight Manufacturing Gatekeeper (`ADR-003` & `ADR-009` Enforcement)
The `M05.3` Gatekeeper acts as an independent verification firewall before any pattern or tech pack can be released. It rejects any payload that fails any of the following checks:
1. **Offset & Singularity Certification Audit (`ADR-009 §3–§4`):**
   * Verifies that all seam allowance offset segments carry a valid `OffsetClassificationReport` from `M02e`:
     * `Category 1: CERTIFIED_REGULAR` segments and reparameterized `Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY` segments (such as $\mathbf{B}(t) = (t^3, 0)$ after arc-length reparameterization) must satisfy dense-grid error $E_{\mathrm{grid}} \le 0.005\text{ cm}$ and certified interval bound $E_{\mathrm{cert}} \le 0.010\text{ cm}$ ($N_{\mathrm{cert}} \ge 256$), with $G^1$ join continuity $\le 0.05^\circ$.
     * Untrimmed `Category 2a` (`ACTUAL_ZERO_SPEED_CUSP`), untrimmed `Category 2b` (`ACTUAL_CURVATURE_CUSP`), unresolved `Category 3` (`TANGENTIAL_CUSP_DEGENERACY`), or untrimmed `Category 4` (`SELF_INTERSECTING_NON_LOCAL`) loops trigger an immediate **HARD MANUFACTURING REJECTION**.
2. **Topological Closure & Winding Invariant:**
   * Verifies exterior boundaries (`Layer 1`, `Layer 8`) are simple (`is_simple == True`), closed ($\|\mathbf{P}_{\mathrm{start}} - \mathbf{P}_{\mathrm{end}}\| \le 10^{-6}\text{ cm}$), **CCW-oriented**, and free of micro-slivers ($< 10^{-4}\text{ cm}^2$).
3. **Two-Tier Paired Seam Length Parity Check (`DEC-11`):**
   * Enforces **Tier 1 CAD Geometry Gate**: walked seam length discrepancy between mated edges $(e_A, e_B)$ must satisfy:
     $$\bigl|L_{\mathrm{CAD}}(e_A) - L_{\mathrm{CAD}}(e_B) - \Delta_{\mathrm{ease}}\bigr| \le 0.05\text{ cm} \quad (0.5\text{ mm})$$
   * Records the **Tier 2 Physical Sewn / 3D Assembly Tolerance** ($\le 0.20\text{ cm}$ / `2.0 mm`) in the tech pack QC tolerances for downstream verification in `M06.1` and `M09.3`.
4. **CNC Tool & Notch Clearance Check:**
   * Verifies minimum internal radius $r_{\min} \ge 0.15\text{ cm}$ and notch arc-length placement accuracy $\le 10^{-7}\text{ cm}$.

### `M05.4` — Automated Bill of Materials (BOM), Pom/Spec Sheet & Construction Sequence Generator
* Generates deterministic Point-of-Measure (POM) tables, seam type schedules (ISO 4915 / ASTM D6193 stitch classifications), fabric consumption yields from `M02h`, and thread/trim BOM quantities.

### `M05.5` — Cryptographically Signed `TechPackManifest` (`DEC-09`)
* Canonicalizes the complete manufacturing package metadata using **RFC 8785 JSON Canonicalization Scheme (JCS)**, binds SHA-256 digests of all DXF, PDF, glTF, and `OffsetClassificationReport` artifacts, and signs the manifest using **`Ed25519`** (`DEC-09`).
* Any modification to a pattern file after `M05.5` signing invalidates the signature and blocks cutting intake in `M08`/`M09`.
