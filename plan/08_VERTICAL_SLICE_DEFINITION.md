# 08 — VERTICAL SLICE DEFINITION

**Document ID:** `PATRONER-BP-R2-08`  
**Status:** Authoritative End-to-End Architectural Vertical Slice Specification  
**Governing Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 03`, `Ch. 09`, `Ch. 15 Phase C/D`, `Revision v4.5`)

---

## 1. Purpose of the Vertical Slice

Before scaling across all garment categories or launching the `M09` Commercial Pilot, Patroner must prove that its complete **Python Authoritative Computational System (`services/fashion-engine`) + Next.js Workspace (`apps/web`)** executes the full `Revision v4.5` closed-loop engineering flow end-to-end on real garments without architectural shortcuts, mock data, or TypeScript authority leakage.

---

## 2. Selected Garment Wedge & Engineering Justification

### 2.1 Selected Garment Families
1. **Primary Foundation Wedge:** **Tailored Woven Midi Skirt (`skirt-block-v1`)** — 2-dart contoured waist-to-hip fit, center-back invisible zipper seam, kicked/straight side seams, faced waistline, and metered hem allowance.
2. **Coordinated Structural Upper-Body Wedge:** **Tailored Set-In Sleeve Woven Bodice (`bodice-sleeve-v1`)** — bust and waist shaping darts, contoured armscye, pitched set-in sleeve cap with controlled ease distribution, shoulder/side seams, and neckline facing.

### 2.2 Why This Wedge Is Architecturally Optimal
- **Exercises Both Simple and Complex Curvature Topology:** The skirt validates baseline waist/hip dart intake, straight/slightly curved side seams, and hem balance; the set-in sleeve bodice immediately forces the engine to solve **non-trivial curved seam mating with intentional ease** (sleeve cap arc length vs. armscye arc length), multi-dart apex convergence, and 3D shoulder/bust curvature drape.
- **Avoids Premature Edge-Case Explosion:** Validates the full 14-step pipeline before introducing bifurcated crotch-curve saddles (`trouser-block-v1`) or biaxial negative-ease elastane recovery (`knit-tshirt-v1`), which follow immediately in `M02d` Track 2.
- **Directly Reconciles Existing Repository Assets:** Replaces the repository's incomplete skirt/bodice TypeScript prototypes (`DEF-M00-05` where `gradePattern` ignored `'skirt'` and graded a bodice) with a unified, category-aware Python parametric block and grading architecture.

---

## 3. The 14-Step End-to-End Vertical Slice Pipeline

Every execution of the Vertical Slice must traverse all **14 steps** below, persisting an append-only `FashionRevisionNode` and SHA-256 digest at each state transition:

| Step | Stage Name | Owning Workload | Input Contract | Authoritative Computation (`services/fashion-engine`) | Output Artifact & Provenance Node | Verification Gate |
| :---: | :--- | :---: | :--- | :--- | :--- | :---: |
| **01** | **Project & Tenant Context Initialization** | `M01` | Authenticated `Person`, `Organization`, `Tenant`, `Role` + `CreateProjectRequest` | Enforce RBAC+ABAC policy; initialize `FashionProject` and root `RevisionDAG`. | `FashionProject` (`state: Concept`) | `AC-11` |
| **02** | **Multimodal Design Intent Interpretation** | `M04` | Front/back sketch or reference photos + natural-language design brief | Extract visible construction features vs. inferred priors vs. explicit ambiguity flags (`Dossier 07`). | `DesignObservationBundle` + `AmbiguityResolutionPrompt` | `AC-04`, `AC-05` |
| **03** | **Human Disambiguation & Intent Freeze** | `M04` + `M01` | Designer confirmation of closure location, dart configuration, and hem/sleeve length in `apps/web` | Compile confirmed intent into canonical `GarmentIntentSpecification` (`Dossier 08`). | `GarmentIntentSpecification` (`state: Specified`) | `AC-01`, `AC-04` |
| **04** | **Body Measurement & Avatar Selection** | `M02c` + `M06` | Customer/fit-model `BodyMeasurementProfile` (base EU 38 + target grade EU 34–46) | Validate anthropometric plausibility (`Dossier 03`, `Dossier 11`), compute derived chains, generate parametric 3D fit avatar. | `ValidatedBodyProfile` + `ParametricAvatarMesh` | `AC-05`, `AC-08` |
| **05** | **Material & Fabric Assignment** | `M03` | Selected woven fabric coupon (e.g., 100% Virgin Wool Gabardine, $240\text{ g/m}^2$) | Load measured tensile/bending/shear/shrinkage parameters (`Dossier 04`, `Dossier 09`) and category ease policy. | `CalibratedMaterialSpec` (`confidence_tier: Tier_1_or_2`) | `AC-07` |
| **06** | **Deterministic Recipe Compilation & 2D Drafting** | `M02a`–`M02e` | `GarmentIntentSpecification` + `ValidatedBodyProfile` + `CalibratedMaterialSpec` | Execute deterministic block drafting (`skirt-block-v1` / `bodice-sleeve-v1`) and style transforms in `float64` (`Dossier 03`, `Dossier 08`). | `DraftedPatternRevision` (`state: Drafted`) | `AC-03`, `AC-05` |
| **07** | **Seam Allowance, Mitering, Notches & Assembly Validation** | `M02a`, `M02b`, `M02f` | `DraftedPatternRevision` + ISO 4916 seam assignment rules | Compute exact offset curves (65-point interior + cusp verification), corner miters, notches, and seam-mating arc lengths ($\Delta L \le 0.05\text{ cm}$). | `ValidatedPatternRevision` (`state: Validated`) | `AC-03`, `AC-05` |
| **08** | **3D Garment Assembly & Drape Simulation** | `M06` | `ValidatedPatternRevision` + `ParametricAvatarMesh` + `CalibratedMaterialSpec` | Construct 3D sewing constraint graph, triangulate planar pieces, run calibrated FEM/XPBD drape solver to equilibrium (`Dossier 10`). | `SimulationCaseResult` (3D draped mesh, strain/pressure maps) | `AC-08` |
| **09** | **Quantitative Fit Evaluation** | `M06` | `SimulationCaseResult` + `GarmentIntentSpecification` fit targets | Evaluate regional ease, contact pressure, grainline torque, and hem levelness (`Dossier 05`, `Dossier 11`, `Dossier 12`). | `FitEvaluationReport` (`fit_score`, regional diagnostics) | `AC-08`, `AC-09` |
| **10** | **Bounded Pattern Optimization & Re-Verification** | `M06` + `M02` | `FitEvaluationReport` (if regional strain/ease outside target band) | Adjust bounded recipe parameters (e.g., dart intake $\pm 0.4\text{ cm}$, side-seam curve $\pm 0.5\text{ cm}$), re-draft (`Step 06`), re-validate (`Step 07`), and re-simulate (`Step 08`). | `OptimizationCandidateRevision` + `ParetoComparison` | `AC-03`, `AC-05`, `AC-08` |
| **11** | **Human Patternmaker Approval & Multi-Size Grading** | `M02g` + `M01` | Approved base-size revision + `GradingRuleTable` (EU 34–46) | Grade all pieces across target sizes; verify cross-size seam mating ($\Delta L \le 0.05\text{ cm}$), notch proportionality, and monotonic area scaling (`Dossier 13`). | `GradedPatternFamilyRevision` (`state: Fit Approved`) | `AC-06`, `AC-11` |
| **12** | **Marker Nesting, Piece Production Sheets & Tech Pack** | `M02h` + `M05` | `GradedPatternFamilyRevision` + `CalibratedMaterialSpec` + `OrderQuantityMap` | Compute nested cutting markers, piece production sheets, ISO 4915/4916 seam schedule, operation routing DAG, BOM, and POM QC sheet (`Dossier 14`). | `ManufacturingTechPack` + `DXF-AAMA` + `PDF Plot` | `AC-03`, `AC-10` |
| **13** | **Physical Plotter Verification & First-Article Toile Trial** | `M05` + `M07` | `ManufacturingTechPack` + physical fabric lot | Verify $100.0\text{ mm}$ calibration square on physical cutter/plotter; sew physical sample; measure POMs and compare fit against Step 09 prediction (`Dossier 06`, `Dossier 14`). | `PhysicalSampleApprovalRecord` (`state: Sample Approved`) | `AC-09`, `AC-10` |
| **14** | **Cryptographic Release Package Sign-Off** | `M05` + `M07` | `ManufacturingTechPack` + `PhysicalSampleApprovalRecord` + QA Ed25519 signature | Assemble RFC 8785 canonical JSON manifest, verify SHA-256 Merkle root, transition revision to `Production Ready` (`isProductionReady: true` for this revision). | `SignedManufacturingReleasePackage` (`state: Production Ready`) | `AC-10`, `AC-11` |

---

## 4. Explicit Inclusions & Exclusions for the Vertical Slice Gate

### 4.1 Included in Vertical Slice
- Full `apps/web` (Next.js) ↔ `services/fashion-engine` (Python FastAPI) round-trip with zero TypeScript computational authority.
- Both `skirt-block-v1` and `bodice-sleeve-v1` across sizes EU 34, 36, 38, 40, 42, 44, 46.
- Real multimodal extraction (`M04`) with explicit human ambiguity resolution.
- Real calibrated fabric parameters (`M03`) and 3D drape simulation (`M06`) with bounded optimization.
- Complete `M05` tech pack, DXF-AAMA/PDF export, and physical sample verification protocol (`AC-09`, `AC-10`).

### 4.2 Excluded from Vertical Slice (Delivered in Subsequent Tracks)
- Bifurcated trousers (`trouser-block-v1`) and negative-ease knitwear (`knit-tshirt-v1`) — delivered in `M02d` Track 2 prior to `M09` expansion.
- Multi-party commercial checkout, VAT invoicing, and creator royalty payouts (`M08` / `M09`) — verified at the `M09` Commercial Pilot Gate.
