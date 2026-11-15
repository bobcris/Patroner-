# WORKLOAD M03 — MATERIAL AND FABRIC MECHANICS (`R2.1`)

## 1. Workload ID & Title
- **Workload ID:** `M03`
- **Title:** Material Property Model, Fabric Characterization, Shrinkage/Width/Seam Mechanics, Regional Ease Governance & Constitutive Solver Calibration
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase B/C (Material Intelligence & Constitutive Calibration)`

## 2. Purpose & Architectural Role
`M03` implements the authoritative **Material & Fabric Mechanics System** (`Dossier 04 v5.2` and `Dossier 09 v5.7`) inside `services/fashion-engine`, preserving 100% of the normative requirements of **Dossier 04 (`DOS-04-R1` through `DOS-04-R6`)** as reconciled in `01_SOURCE_REGISTER_AND_REQUIREMENTS.md` (§3.2, `Correction 07`). It separates immutable raw physical test measurements from normalized mechanical properties and solver-calibrated constitutive tensors, governs garment-category regional ease and signed negative-ease policies for `M02d` and `M04b`, supplies usable fabric width, selvedge, grainline tilt, nap, and shrinkage constraints to `M02h` (Marker Nesting, `Correction 02`) and `M05` (Tech Packs/BOM), and provides physically valid orthotropic shell parameters for `M06`.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 05 (§5.4)`, `Ch. 06`, `Ch. 15`, `App. A7`
- `Dossier 04 v5.2` (Material & Fabric Mechanics — reconciled in `01_SOURCE_REGISTER_AND_REQUIREMENTS.md` §3.2)
- `Dossier 09 v5.7` (Material Property Model & Fabric Characterization)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-MAT-01`**: Reconciled Dossier 04 (`DOS-04-R1`–`R6`) & Dossier 09 Dual-Layer Material Characterization (`RawFabricObservation` vs. `CalibratedMaterialSpec`), Shrinkage/Width/Seam Behavior, and Construction-Aware Positive/Negative Ease Policies
- **`REQ-ARCH-01`**: Authoritative Python Computation

## 5. Current Repository Baseline & Classification
- **`src/engine/fabric/*`**: `I1 + X` for 1D directional properties (`warp`/`weft`/`bias`), provenance classification, explicit consent for illustrative presets, and signed negative-ease/recovery/bias authorization policies (`3,616` LOC of TS tests); `M` (Missing) for raw lab test observation persistence (`DOS-09`) and 3D orthotropic continuum solver calibration (`DOS-04`).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Reconciles **`CNF-002`** (preserving all `DOS-04-R1`–`R6` domain requirements in Python while retiring browser execution) and prevents **`RSK-14`** (marker width vs. physical roll width mismatch) by binding usable cuttable width and shrinkage tolerances into `CalibratedMaterialSpec`.

## 7. Prerequisites & Upstream Dependencies
- Requires **`M01.3`** (Fashion World Model & PostgreSQL persistence in `services/fashion-engine`).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/materials/
├── schema.py                   # RawFabricObservation, NormalizedMechanicalProperties, CalibratedMaterialSpec
├── characterization.py         # Tier 1 (KES/FAST/ISO), Tier 2 (Benchtop cantilever/drape/tensile), Tier 3 (Priors)
├── constitutive_calibration.py # Orthotropic membrane (k_warp, k_weft, k_shear, nu) & bending (B_warp, B_weft) fitter
├── ease_and_shrinkage.py       # Ported regional ease engine, signed negative-ease policies, wash/steam shrinkage factors
├── marker_and_cut_constraints.py # Nominal total/usable fabric width, selvedge margin, nap mode & grain tilt limits for M02h
└── seam_mechanics.py           # Fabric thickness, needle/thread/stitch compatibility & seam slippage/pucker risk model
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`RawFabricObservation` (Immutable Lab/Bench Record — `DOS-09`, `DOS-04-R1..R4`):**
   - `observation_id`, `tenant_id`, `fabric_lot_id`, `weave_or_knit_structure: "PLAIN_WEAVE" | "TWILL" | "SATIN" | "JERSEY_KNIT" | "RIB_KNIT" | "INTERLOCK" | "DENIM" | "GABARDINE"`
   - `fiber_composition: Map<FiberType, Percentage>`
   - `nominal_total_width_cm: float`, `selvedge_margin_each_side_cm: float`, `usable_cuttable_width_cm: float`, `nap_or_directionality: "EITHER_0_180" | "ONE_WAY_0_ONLY"`
   - `areal_density_gsm: float` (`ISO 3801`), `thickness_mm_at_0_5_kpa: float` (`ISO 5084`)
   - `cantilever_overhang_length_cm: { warp: float, weft: float, bias_45: float }` (`ASTM D1388`)
   - `tensile_extension_pct_at_load: { warp: float, weft: float, bias_45: float, load_n_per_m: float }` (`ISO 13934` / `ASTM D5034` or Knit Stretch `ASTM D2594`)
   - `elastic_recovery_pct_after_cycle: { warp: float, weft: float }`
   - `dimensional_change_relaxation_pct: { warp_length_pct: float, weft_width_pct: float }` (`ISO 6330` / steam press protocol)
   - `drape_coefficient_pct: float` (`ISO 9073-9` Cusick drape)
   - `measurement_tier: "TIER_1_LAB" | "TIER_2_BENCHTOP" | "TIER_3_PRIOR"`
2. **`CalibratedMaterialSpec` (Versioned Engine Artifact):**
   - `material_spec_id`, `raw_observation_id`, `calibration_model_version`
   - `orthotropic_membrane_stiffness`: $\{k_{\text{warp}}, k_{\text{weft}}, k_{\text{shear}}, \nu_{12}\}$ in $\text{N/m}$ with 95% confidence intervals
   - `orthotropic_bending_rigidity`: $\{B_{\text{warp}}, B_{\text{weft}}, B_{\text{twist}}\}$ in $\mu\text{N}\cdot\text{m}$
   - `friction_coefficients`: $\{\mu_{\text{fabric\_body}}, \mu_{\text{fabric\_fabric}}\}$
   - `shrinkage_compensation_factors`: $\{\lambda_{\text{warp}}, \lambda_{\text{weft}}\}$
   - `marker_constraints`: `{ usable_cuttable_width_cm, nap_mode, max_grainline_tilt_deg, min_kerf_clearance_cm }` (Consumed by `M02h`)
   - `ease_policy_bounds`: `{ regional_min_ease_cm, recommended_ease_cm, max_negative_ease_pct, signed_negative_ease_policy_ref, sleeve_cap_ease_ratio_band }`

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Bending Rigidity from Cantilever Overhang (`DOS-04-R2`, `ASTM D1388`):**
   $$B_{\text{dir}} = w \cdot c_{\text{dir}}^3, \quad c_{\text{dir}} = \frac{L_{\text{overhang, dir}}}{2} \left(\frac{\cos(\theta/2)}{8 \tan \theta}\right)^{1/3} \quad (\text{for standard } \theta = 41.5^\circ, \; c \approx 0.5 \, L_{\text{overhang}})$$
   where $w = \text{GSM} \times 10^{-3} \times g$ is weight per unit area ($\text{N/m}^2$).
2. **Thermodynamic & Mechanical Positive-Definiteness Invariant (`DOS-04-R1`):**
   The calibrated 2D orthotropic planar elasticity tensor $\mathbf{C}$ must be strictly symmetric positive-definite ($\det(\mathbf{C}) > 0$, $k_{\text{warp}} > 0$, $k_{\text{weft}} > 0$, $k_{\text{shear}} > 0$, $1 - \nu_{12}\nu_{21} > 0.05$). Any calibration violating positive-definiteness is rejected (`AC-07`).
3. **Shrinkage Compensation Transformation (`DOS-04-R4`):**
   When a fabric has verified relaxation shrinkage $(s_{\text{warp}}, s_{\text{weft}}) \in [-0.15, 0.05]$, pre-wash pattern scaling along the piece grainline basis $(\hat{\mathbf{g}}, \hat{\mathbf{g}}^\perp)$ is:
   $$\lambda_{\text{warp}} = \frac{1}{1 + s_{\text{warp}}}, \quad \lambda_{\text{weft}} = \frac{1}{1 + s_{\text{weft}}}$$
4. **Construction-Aware Regional Ease & Signed Negative-Ease Governance (`DOS-04-R5`, `DOS-04-R6`):**
   - Preserves all verified rules from `src/engine/fabric/ease-engine.ts`: for non-stretch `Woven` fabrics ($\text{elastic\_recovery} < 90\%$ or $\text{extension} < 5\%$), negative circumferential ease ($\text{ease} < 0\text{ cm}$) is **hard-blocked**.
   - For stretch/knit fabrics, negative ease is permitted only within $\min(\text{safe\_working\_elongation\_pct}, 0.6 \times \text{max\_recoverable\_strain})$ and requires a valid signed `NegativeEaseAuthorizationPolicy` when required by category governance.
   - `TIER_3_PRIOR` illustrative presets require explicit user consent for exploratory `Concept`/`Drafted` views and are **hard-blocked** from `Sample_Approved` and `Production_Ready`.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/materials/observations` → Records immutable `RawFabricObservation`.
- `POST /api/v1/materials/calibrate` → Runs constitutive fitting & positive-definiteness verification, producing `CalibratedMaterialSpec`.
- `GET /api/v1/materials/{material_spec_id}/ease-and-marker-policy` → Returns regional ease bounds, `M02h` marker width/nap constraints, and recommended ISO 4915/4916 stitch/seam classes for `M02`, `M04b`, and `M05`.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Proprietary mill and brand fabric libraries are tenant-scoped (`tenant_id`) via `M01` RLS; Patroner's reference fabric catalog is published as read-only system-shared records with full `SHA-256` provenance.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Material & Fabric Lab Panel:** Displays raw lab/bench observations alongside calibrated stiffness/drape curves, confidence tiers (`Tier 1 Lab` / `Tier 2 Bench` / `Tier 3 Prior`), usable width & nap rules, shrinkage compensation badges, and regional ease pairings.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M03.1` — Material Schema & Repository:** Implement `RawFabricObservation` and `CalibratedMaterialSpec` tables and contracts.
2. **`M03.2` — Constitutive Calibration Engine (`DOS-04-R1..R3`):** Implement `ASTM D1388` / `ISO 13934` / `ISO 9073-9` to orthotropic shell parameter conversion with positive-definiteness enforcement.
3. **`M03.3` — Ported Regional Ease, Signed Negative-Ease & Shrinkage Engine (`DOS-04-R4..R6`):** Port `src/engine/fabric/*` rules and add grainline-aligned shrinkage compensation matrices.
4. **`M03.4` — Marker Constraints & Seam Compatibility Engine:** Provide usable fabric width/nap rules to `M02h` and map fabric GSM/thickness to allowed ISO 4915/4916 stitch/seam classes for `M05`.
5. **`M03.5` — Reference Fabric Catalog Seeding:** Populate 25 validated reference fabrics (including 100% Virgin Wool Gabardine $240\text{ g/m}^2$ and Cotton Poplin $135\text{ g/m}^2$ for the Vertical Slice).

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Ports 100% of verified test cases from `src/engine/fabric/fabric-audit.test.ts` and `ease-engine.test.ts` into Class B Normative Python fixtures, extended with new constitutive calibration and shrinkage tests.

## 16. Unit, Property & Adversarial Test Plan
- **Thermodynamic Violation Tests:** Input negative overhang, Poisson ratio $\nu_{12}\nu_{21} \ge 1$, or negative GSM → verify hard rejection.
- **Ported Negative-Ease & Provenance Attacks:** Verify 100% rejection of unsigned negative-ease policies, expired recovery authorizations, woven negative ease, and `TIER_3_PRIOR` production promotion (`AC-07`).

## 17. Independent Verification Oracles
- Independent Python symbolic/numerical mechanics oracle verifying `ASTM D1388` flexural rigidity conversion and positive-definite strain energy density across random strain tensors $\boldsymbol{\varepsilon}$.

## 18. Physical, Manufacturing or Financial Validation Protocol
- Physical benchtop validation (`DEC-03`) on $\ge 20$ physical fabric swatches comparing cantilever overhang, Cusick drape coefficient, usable roll width, and steam-press relaxation shrinkage against digital `CalibratedMaterialSpec` predictions.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`** (100% Python execution), **`AC-07`** (Material-Model Credibility & Tier enforcement). Required for **Release Level A**.

## 20. Failure Modes, Rollback & Recovery Procedures
- Unmeasured fabrics (`TIER_3_PRIOR`) are restricted to exploratory `Concept`/`Drafted` states with explicit uncertainty bands (`±25%` stiffness range) and fail closed at `Sample_Approved` / `Production_Ready`.

## 21. Observability, Audit Logging & Telemetry
- Logs calibration residuals, confidence tier, usable width, and shrinkage compensation deltas in revision provenance metadata.

## 22. Explicit Non-Goals & Scope Guardrails
- `M03` does not run full 3D garment mesh time-integration (owned by `M06`); it provides the constitutive material parameters, ease bounds, and marker width/shrinkage rules consumed by `M02`, `M04b`, `M05`, and `M06`.

## 23. Downstream Unlocks
- Unlocks **`M02d`** (material-aware block ease), **`M04b`** (recipe parameter validation), **`M02h`** (marker width/nap/shrinkage constraints), **`M05`** (BOM & ISO seam schedules), and **`M06`** (calibrated 3D cloth simulation).

## 24. Definition of Done Checklist
- [ ] All 6 Dossier 04 requirements (`DOS-04-R1`–`R6`) and Dossier 09 schemas implemented in Python.
- [ ] Orthotropic elasticity positive-definiteness verifier enforced (`AC-07`).
- [ ] All ported `fabric-audit` and `ease-engine` normative tests passing in Python.
- [ ] Marker width/nap/shrinkage constraints wired into `M02h` and `M05`.
