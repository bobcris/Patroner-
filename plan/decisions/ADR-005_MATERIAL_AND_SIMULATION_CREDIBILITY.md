# ADR-005 — MATERIAL CHARACTERIZATION, CONSTITUTIVE CALIBRATION & NUMERICAL CREDIBILITY

- **ADR ID:** `ADR-005`
- **Revision:** `2.1` (Controlled Architecture, Dependency, Numerical Assurance & Release-Governance Correction)
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05 §5.4`, `Ch. 06`), `Patroner_Architecture_Revision_v4.5.pdf`, `Dossier 04 v5.2` (`DOS-04-R1`–`R6`), `Dossier 06 v5.4`, `Dossier 09 v5.7`, `Dossier 10 v5.8`, `REQ-MAT-01`, `REQ-SIM-01`

---

## 1. Context & Problem Statement
3D garment visualization in many consumer tools relies on arbitrary spring stiffnesses and decorative shaders (`src/components/Viewport3D.tsx` in the current repo renders a static cylinder). If cloth simulation is used to predict physical garment fit (`M06`) or guide pattern adjustments, uncalibrated fabric parameters, uncompensated steam/wash relaxation shrinkage, or numerically locked meshes will produce misleading fit diagnostics and ruined physical samples (`RSK-04`).

---

## 2. Decision
1. **Dual-Layer Material Architecture & Full Dossier 04 v5.2 Reconciliation (`DOS-04-R1`–`R6`, `Dossier 09`):**
   - `M03` strictly separates immutable **Raw Empirical Observations (`RawFabricObservation`, `DOS-04-R1`)** (mass per unit area $w$ in $\text{g/m}^2$ `ISO 3801`, thickness $h$ in $\text{mm}$ `ISO 5084`, warp/weft/bias cantilever bending overhang lengths $L_{\text{overhang}}$ `ASTM D1388`, low-load tensile elongation `ISO 13934`, Cusick drape coefficient `ISO 9073-9`, and steam/wash relaxation shrinkage `ISO 6330`) from **Solver-Calibrated Constitutive Parameters (`CalibratedMaterialSpec`, `DOS-04-R2`)** (orthotropic membrane stiffnesses $E_{\text{warp}}, E_{\text{weft}}, G_{12}, \nu_{12}, \nu_{21}$ and bending rigidities $B_{\text{warp}}, B_{\text{weft}}, B_{\text{bias}}$).
   - **Thermodynamic Admissibility (`DOS-04-R2`):** Every calibrated material tensor must satisfy orthotropic symmetry ($\nu_{12} E_{\text{weft}} = \nu_{21} E_{\text{warp}}$) and strict positive-definiteness ($E_{\text{warp}}, E_{\text{weft}}, G_{12} > 0$, $1 - \nu_{12}\nu_{21} > 0$, $\det(\mathbf{C}_{\text{2D}}) > 0$).
   - **Conditioning-Aware Geometry Compensation (`DOS-04-R4`, `DOS-04-R5`, `DOS-04-R6`):** Directional warp/weft relaxation shrinkage (`shrinkage_warp_pct`, `shrinkage_weft_pct`), maximum safe ease/stretch bounds, and grainline alignment tolerances are exported in `CalibratedMaterialSpec` and consumed by `M02d`/`M02h`/`M05`.
2. **Three-Tier Material Evidence Gating (`DOS-04-R3`, `DEC-03`):**
   - `TIER_3_PRIOR` (Category priors with wide uncertainty bands) is permitted only for early `Concept` / `Drafted` exploration.
   - Promotion to `Sample_Approved` or `Production_Ready` **requires** `TIER_1_LAB` or `TIER_2_BENCHTOP` physical coupon measurements (`AC-07`).
3. **Mandatory Analytical Mechanics Verification Before Garment Fit Evaluation (`Dossier 10`, `AC-08`):**
   - The `M06` cloth solver must pass four closed-form analytical benchmarks in CI (B1 Uniaxial Membrane Patch, B2 Cantilever Elastica Bending, B3 Catenary Drape, and B4 $<2\%$ Mesh Refinement Convergence) before any garment simulation result is marked `convergence_verified: true`.

---

## 3. Consequences & Enforcement
- **Positive:** Ensures that 3D drape, strain predictions, and pattern shrinkage allowances correspond to real physical fabric mechanics (`DOS-04-R1`–`R6`).
- **Enforcement (`AC-07`, `AC-08`, `AC-09`):** Enforced by `M03` positive-definite elasticity checks, `M06` analytical benchmark gates, and blinded physical-vs-digital toile trials.
