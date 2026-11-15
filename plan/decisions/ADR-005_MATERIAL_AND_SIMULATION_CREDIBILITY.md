# ADR-005 — MATERIAL CHARACTERIZATION, CONSTITUTIVE CALIBRATION & NUMERICAL CREDIBILITY

- **ADR ID:** `ADR-005`
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 05 §5.4`, `Ch. 06`), `Patroner_Architecture_Revision_v4.5.pdf`, `Dossier 04 v5.2`, `Dossier 06 v5.4`, `Dossier 09 v5.7`, `Dossier 10 v5.8`, `REQ-MAT-01`, `REQ-SIM-01`

---

## 1. Context & Problem Statement
3D garment visualization in many consumer tools relies on arbitrary spring stiffnesses and decorative shaders (`src/components/Viewport3D.tsx` in the current repo renders a static cylinder). If cloth simulation is used to predict physical garment fit (`M06`) or guide pattern adjustments, uncalibrated fabric parameters or numerically locked meshes will produce misleading fit diagnostics and ruined physical samples (`RSK-04`).

## 2. Decision
1. **Dual-Layer Material Architecture (`Dossier 04` & `Dossier 09`):**
   - `M03` strictly separates immutable **Raw Empirical Observations (`RawFabricObservation`)** (GSM, thickness, cantilever overhang length `ASTM D1388`, tensile elongation `ISO 13934`, Cusick drape `ISO 9073-9`, and steam/wash relaxation shrinkage `ISO 6330`) from **Solver-Calibrated Constitutive Parameters (`CalibratedMaterialSpec`)** (orthotropic membrane stiffnesses $k_{\text{warp}}, k_{\text{weft}}, k_{\text{shear}}, \nu_{12}$ and bending rigidities $B_{\text{warp}}, B_{\text{weft}}$).
2. **Three-Tier Material Evidence Gating (`DEC-03`):**
   - `TIER_3_PRIOR` (Category priors with wide uncertainty bands) is permitted only for early `Concept` / `Drafted` exploration.
   - Promotion to `Sample_Approved` or `Production_Ready` **requires** `TIER_1_LAB` or `TIER_2_BENCHTOP` physical coupon measurements (`AC-07`).
3. **Mandatory Analytical Mechanics Verification Before Garment Fit Evaluation (`Dossier 10`, `AC-08`):**
   - The `M06` cloth solver must pass four closed-form analytical benchmarks in CI (B1 Uniaxial Membrane Patch, B2 Cantilever Elastica Bending, B3 Catenary Drape, and B4 $<2\%$ Mesh Refinement Convergence) before any garment simulation result is marked `convergence_verified: true`.

## 3. Consequences & Enforcement
- **Positive:** Ensures that 3D drape and strain predictions correspond to real physical fabric mechanics and relaxation shrinkage.
- **Enforcement (`AC-07`, `AC-08`, `AC-09`):** Enforced by `M03` positive-definite elasticity checks, `M06` analytical benchmark gates, and blinded physical-vs-digital toile trials.
