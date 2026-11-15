# 08 — VERTICAL SLICE DEFINITION (`R2.1.1`)

**Document ID:** `PATRONER-BP-R2.1.1-08`  
**Status:** Authoritative End-to-End Architectural Vertical Slice Specification (`Gate Auth-3` — `M04a`/`M04b`, `M02h` & Tri-State Numerical/Offset Verification Reconciled)  
**Governing Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 03`, `Ch. 09`, `Ch. 15 Phase B/C/D`, `Revision v4.5`)

---

## 1. Purpose of the Vertical Slice

Before scaling across all garment categories or launching the `M09` Commercial Pilot (`Gate Auth-4` / `Release Level A`), Patroner must prove at **`Gate Auth-3` (Vertical Slice Gate)** that its complete **Python Authoritative Computational System (`services/fashion-engine`) + Next.js Workspace (`apps/web`)** executes the full `Revision v4.5` closed-loop engineering flow end-to-end on real garments without architectural shortcuts, dependency circularity, mock data, or TypeScript authority leakage.

---

## 2. Selected Garment Wedge & Engineering Justification

### 2.1 Selected Garment Families
1. **Primary Foundation Wedge:** **Tailored Woven Midi Skirt (`skirt-block-v1`)** — 2-dart contoured waist-to-hip fit, center-back invisible zipper seam, kicked/straight side seams, faced waistline, and metered hem allowance.
2. **Coordinated Structural Upper-Body Wedge:** **Tailored Set-In Sleeve Woven Bodice (`bodice-sleeve-v1`)** — bust and waist shaping darts, contoured armscye, pitched set-in sleeve cap with controlled ease distribution, shoulder/side seams, and neckline facing.

### 2.2 Architectural Justification
- Exercises both straight/gently curved seams (`skirt-block-v1`) and complex non-isometric curved seam mating with intentional ease (`bodice-sleeve-v1` armscye vs. sleeve cap).
- Directly remediates the repository's incomplete skirt/bodice prototype (`DEF-M00-05` where `gradePattern` ignored `'skirt'` and graded a bodice).

---

## 3. The Corrected 14-Step End-to-End Vertical Slice Pipeline (`R2.1.1`)

Per **`Correction 01`**, multimodal perception and intent confirmation (**`M04a`**, Steps 02–03) execute *before* deterministic drafting and have zero dependency on `M02d`/`M02e`, while controlled recipe compilation (**`M04b`**, Step 06) bridges approved intent into `M02d`/`M02e` drafting.  
Per **`Correction 02`**, deterministic marker nesting and validation (**`M02h`**) is explicitly integrated into **Step 12** via the mandatory 8-stage geometry-to-tech-pack sequence.

| Step | Stage Name | Owning Workload | Input Contract | Authoritative Computation (`services/fashion-engine`) | Output Artifact & Provenance Node | Verification Gate |
| :---: | :--- | :---: | :--- | :--- | :--- | :---: |
| **01** | **Project & Tenant Context Initialization** | `M01` | Authenticated `Person`, `Organization`, `Tenant`, `Role` + `CreateProjectRequest` | Enforce RBAC+ABAC policy; initialize `FashionProject` and root `RevisionDAG`. | `FashionProject` (`state: Concept`) | `AC-11` |
| **02** | **Multimodal Design Perception & Epistemic Partitioning** | **`M04a`** | Front/back sketch or reference photos + natural-language design brief (`M01.5` sanitized) | Extract visible construction features (`OBSERVED_VISIBLE`) vs. inferred priors (`INFERRED_CATEGORY_PRIOR`) vs. ambiguity flags (`AMBIGUOUS_REQUIRES_CONFIRMATION`) (`Dossier 07`). **Zero geometry or measurement invention.** | `DesignObservationBundle` + `AmbiguityResolutionPrompt` | `AC-02`, `AC-04`, `AC-11` |
| **03** | **Human Disambiguation & Intent Freeze** | **`M04a` + `M01`** | Designer confirmation of closure location, dart configuration, and hem/sleeve proportions in `apps/web` | Freeze user-confirmed `GarmentIntentSpecification` (`Dossier 07/08`); record source-to-claim provenance links. | `GarmentIntentSpecification` (`state: Specified`) | `AC-01`, `AC-04`, `AC-11` |
| **04** | **Body Measurement & Avatar Selection** | `M02c` + `M06` | Customer/fit-model `BodyMeasurementProfile` (base `M` / `EU 38` + target grade `XS`–`XXL` / `EU 34`–`46`) | Validate anthropometric plausibility & measurement provenance (`Dossier 03`, `Dossier 11`), compute derived chains, generate parametric 3D fit avatar. | `ValidatedBodyProfile` + `AvatarBodyRepresentation` | `AC-02`, `AC-05`, `AC-08` |
| **05** | **Material & Fabric Assignment** | `M03` | Selected woven fabric coupon (e.g., 100% Virgin Wool Gabardine, $240\text{ g/m}^2$, usable width $148.0\text{ cm}$) | Load measured tensile/bending/shear/shrinkage parameters (`Dossier 04`, `Dossier 09`), usable width/nap rules, and category ease policy. | `CalibratedMaterialSpec` (`confidence_tier: TIER_1_LAB | TIER_2_BENCHTOP`) | `AC-07` |
| **06** | **Controlled Recipe Compilation & Deterministic 2D Drafting** | **`M04b` + `M02a` + `M02d` + `M02e`** | `GarmentIntentSpecification` (`M04a`) + `ValidatedBodyProfile` (`M02c`) + `CalibratedMaterialSpec` (`M03`) | **`M04b`** compiles confirmed intent into typed `GarmentRecipe`, `RecipeOperatorAST`, and `DraftPlan` (`Dossier 08`); invokes **`M02d`** block drafting and **`M02e`** style operators in `float64` (`Dossier 03`). | `GarmentRecipe` + `DraftPlan` + `DraftedPatternRevision` (`state: Drafted`) | `AC-03`, `AC-04`, `AC-05` |
| **07** | **Certified Seam Allowance, Mitering, Notches & Assembly Validation** | `M02a`, `M02b`, `M02f` | `DraftedPatternRevision` + ISO 4916 seam assignment rules | Compute offset curves; execute **tri-state (`CERTIFIED_VALID`) complete-interval ($t \in [0, 1]$) 6-category offset verification (`Method C3`, `Corrections C & D`, `ADR-009`)**, corner miters, notches, and certified seam-mating arc-length enclosures (`Method C1-Cert`, `Corrections A & B`). | `ValidatedPatternRevision` (`state: Validated`, `OffsetValidationRecord` & `NumericalVerificationRecord` attached) | `AC-03`, `AC-05` |
| **08** | **3D Garment Assembly & Drape Simulation** | `M06` | `ValidatedPatternRevision` + `AvatarBodyRepresentation` + `CalibratedMaterialSpec` | Construct 3D sewing constraint graph, triangulate planar pieces, run calibrated orthotropic FEM/discrete-shell drape solver to equilibrium (`Dossier 10`). | `SimulationCaseResult` (3D draped `glTF` mesh, strain/pressure fields) | `AC-08` |
| **09** | **Quantitative Fit Evaluation** | `M06` | `SimulationCaseResult` + `GarmentIntentSpecification` fit targets | Evaluate regional ease, contact pressure, grainline torque, and hem levelness (`Dossier 05`, `Dossier 11`, `Dossier 12`). | `FitEvaluationReport` (regional diagnostics, uncertainty bounds) | `AC-08`, `AC-09` |
| **10** | **Bounded Pattern Optimization & Independent Re-Verification** | `M06` + `M04b` + `M02` | `FitEvaluationReport` (if regional strain/ease outside target band) | Adjust bounded recipe parameters $\boldsymbol{\theta} \in [\boldsymbol{\theta}_{\min}, \boldsymbol{\theta}_{\max}]$, re-compile via `M04b` (`Step 06`), independently re-validate via `M02b`/`M02f` (`Step 07`), and re-simulate (`Step 08`). | `BoundedOptimizationProposal` + `ParetoComparison` | `AC-03`, `AC-05`, `AC-08` |
| **11** | **Human Patternmaker Approval & Multi-Size Grading** | `M02g` + `M01` | Human-approved base-size revision + `GradingRuleTable` (`XS`–`XXL` / `EU 34`–`46`) | Grade all pieces across target sizes using category-strict dispatcher (`DEF-M00-05` closed); verify cross-size seam mating, notch proportionality, anti-cloning, and monotonic area scaling (`Dossier 13`). | `GradedPatternFamilyRevision` (`state: Fit_Approved`) | `AC-03`, `AC-06`, `AC-11` |
| **12** | **Deterministic Marker Nesting, Piece Production Sheets & Industrial Tech Pack (`Correction 02`)** | **`M02h` + `M05`** | `GradedPatternFamilyRevision` (`M02g`) + `CalibratedMaterialSpec` (`M03`) + `OrderQuantityMap` | Execute the mandatory **8-Stage Sequence (`Section 4`)**: prepare marker inputs → run **`M02h`** deterministic NFP marker nesting → run independent marker non-overlap/grainline/utilization verification → build **`M05.1`** piece production sheets (`DEF-M00-02`–`04` closed) → generate **`M05.2`–`M05.4`** ISO 4915/4916 seam schedule, `OperationDAG`, `M02h`-linked BOM, POM QC sheet, and calibrated DXF-AAMA / 1:1 PDF exports. | `ValidatedMarkerArtifact` + `PieceProductionSheetPackage` + `ManufacturingTechPack` | `AC-03`, `AC-05`, `AC-06`, `AC-10` |
| **13** | **Physical Plotter Verification & First-Article Toile Trial** | `M05` + `M07` | `ManufacturingTechPack` + physical fabric lot (`M07.3`) | Verify $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square on physical cutter/plotter ($\pm 0.1\text{ mm}$); sew physical first-article sample; measure POMs and compare fit against Step 09 prediction (`Dossier 06`, `Dossier 14`). | `PlotterCalibrationCertificate` + `PhysicalSampleApprovalRecord` (`state: Sample_Approved`) | `AC-09`, `AC-10` |
| **14** | **Cryptographic Release Package Sign-Off** | `M05` + `M07` | `ManufacturingTechPack` + `PhysicalSampleApprovalRecord` + QA Ed25519 signature | Assemble RFC 8785 canonical JSON manifest, verify SHA-256 Merkle root & Ed25519 signature, transition revision to `Production_Ready` (`is_production_ready: true` for this revision). | `SignedManufacturingReleasePackage` (`state: Production_Ready`) | `AC-10`, `AC-11` |

---

## 4. Mandatory 8-Stage Sequence Inside Step 11–12 (`Correction 02`)

To ensure zero ambiguity between grading (`M02g`), material constraints (`M03`), marker nesting (`M02h`), piece production sheets (`M05.1`), and tech packs (`M05.2`–`M05.5`), the pipeline enforces this exact 8-stage dataflow:

1. **Stage 12.1 — Validated Pattern Geometry (`M02a`, `M02b`, `M02d`, `M02e`, `M02f`):** Base pieces pass closed-loop topology, 5-concept certified arc-length (`Method C1-Cert`) and area (`Method C2`) enclosures, and tri-state `CERTIFIED_VALID` complete-interval $[0, 1]$ 6-category offset verification (`Method C3`).
2. **Stage 12.2 — Validated Multi-Size Grading (`M02g`):** All target sizes (`XS`–`XXL` / `EU 34`–`46`) pass cross-size seam mating, notch proportionality, and monotonic area scaling.
3. **Stage 12.3 — Material & Fabric-Width Constraints (`M03`):** Load `CalibratedMaterialSpec` specifying nominal usable cuttable width $W_{\text{usable}} = W_{\text{total}} - 2\,m_{\text{selvedge}}$, relaxation shrinkage factors $(\lambda_{\text{warp}}, \lambda_{\text{weft}})$, grainline tilt limit $\Delta\theta_{\max}$, and nap/one-way directional constraints ($0^\circ$ only vs. $0^\circ/180^\circ$).
4. **Stage 12.4 — Marker Input Preparation (`M02h`):** Combine shrinkage-compensated graded cutting contours from `M02g`, validated order size-quantity breakdown (`DEF-M00-03` strict set equality), outward chordal buffer $\delta_{\text{chord}} = 0.02\text{ cm}$, and minimum cutter kerf clearance $c_{\text{kerf}} \ge 0.10\text{ cm}$.
5. **Stage 12.5 — Deterministic Marker Nesting (`M02h`):** Execute seeded No-Fit Polygon (NFP) strip-packing solver to place all required piece instances within $W_{\text{usable}}$ minimizing total marker length $L_{\text{marker}}$.
6. **Stage 12.6 — Independent Marker Validation & Utilization Reporting (`M02h`):** Independent geometric auditor (`verify_marker_layout.py`) proves (a) zero piece-piece overlap (distance $\ge c_{\text{kerf}}$), (b) zero piece-selvedge boundary protrusion, (c) grainline orientation within $\pm 0.1^\circ$ of allowed angles, and (d) certified marker utilization $\eta = \frac{\sum A_{\text{cut}}}{W_{\text{usable}} \cdot L_{\text{marker}}}$ and linear yield $L_{\text{marker}}$.
7. **Stage 12.7 — Piece Production Sheets (`M05.1`):** Generate per-piece, per-size `PieceProductionSheetPackage` binding exact net/cut areas, perimeters, grainlines, notches, seam allowances, and quantity checks.
8. **Stage 12.8 — Manufacturing Tech Pack & Calibrated Cut Exports (`M05.2`–`M05.5`):** Consume `M02h` verified marker length $L_{\text{marker}}$ into the **Bill of Materials (`BOM`)** fabric consumption calculation, combine with ISO 4915/4916 seam schedule, `OperationDAG`, and graded POM QC table, and emit calibrated DXF-AAMA / 1:1 PDF files containing the $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square.

### Authoritative Role of `M02h` Marker Nesting vs. Physical Cutter Qualification
- **Mathematically Authoritative Manufacturing Computation:** `M02h` is an authoritative geometric computation for **digital cut-layout validity, BOM fabric consumption, and pre-production unit-cost calculation** (`AC-03`, `AC-05`).
- **Not a Substitute for Physical Cutter Qualification (`AC-10`) or Roll-Specific Inspection (`M07.3`):** Passing `M02h` digital marker validation does **not** waive physical plotter/cutter dimensional calibration ($100.0\text{ mm} \times 100.0\text{ mm}$ square check in Step 13) or incoming physical fabric roll width/shrinkage verification (`M07.3`). If an incoming physical fabric roll in `M07.3` has usable width narrower than $W_{\text{usable}}$, `M02h` must be re-executed with the physical roll width before cutting.
