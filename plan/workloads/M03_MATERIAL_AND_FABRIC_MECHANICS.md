# WORKLOAD M03 — MATERIAL AND FABRIC MECHANICS

## 1. Workload ID & Title
- **Workload ID:** `M03`
- **Title:** Material Property Model, Fabric Characterization, Shrinkage/Seam Compensation & Constitutive Solver Calibration
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase B/C (Material Intelligence & Constitutive Calibration)`

## 2. Purpose & Architectural Role
`M03` implements the authoritative **Material & Fabric Mechanics System** (`Dossier 04 v5.2` and `Dossier 09 v5.7`) inside `services/fashion-engine`. It separates raw physical test measurements from normalized mechanical properties and solver-calibrated constitutive tensors, governs garment-category ease and negative-ease policies for `M02d`, provides shrinkage and seam-pucker compensation for `M05`, and supplies physically valid orthotropic shell parameters for `M06`.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 05 (§5.4)`, `Ch. 06`, `Ch. 15`
- `Dossier 04 v5.2` (Material & Fabric Mechanics — corrected to Python execution per `Addendum v4.1`)
- `Dossier 09 v5.7` (Material Property Model & Fabric Characterization)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-MAT-01`**: Dual-Layer Material Characterization (Raw Empirical Observations vs. Calibrated Constitutive Parameters), Shrinkage & Seam Behavior, and Positive/Negative Ease Policies
- **`REQ-ARCH-01`**: Authoritative Python Computation

## 5. Current Repository Baseline & Classification
- **Material & Fabric Mechanics**: `M` (Missing) — The current repository has no material model, fabric schema, shrinkage compensation, or constitutive parameter calibration (`0%` implemented).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Closes **`CNF-003`** (eliminating any TypeScript/WebAssembly client-side fabric physics assumption from `Dossier 04 v5.2`) and eliminates hardcoded magic-number ease assumptions in pattern drafting by binding block ease to `CalibratedMaterialSpec`.

## 7. Prerequisites & Upstream Dependencies
- Requires **`M01.3`** (Fashion World Model & PostgreSQL persistence in `services/fashion-engine`).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/materials/
├── schema.py                # RawFabricObservation, NormalizedMechanicalProperties, CalibratedMaterialSpec
├── characterization.py      # Tier 1 (KES/FAST/ISO), Tier 2 (Benchtop cantilever/drape/tensile), Tier 3 (Priors)
├── constitutive_calibration.py # Orthotropic membrane (E_warp, E_weft, G_bias, nu) & bending (B_warp, B_weft) fitter
├── ease_and_shrinkage.py    # Category ease bounds, knit negative-ease recovery checks, wash/steam shrinkage compensation
└── seam_mechanics.py        # Fabric thickness, needle/thread/stitch compatibility & seam slippage/pucker risk model
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`RawFabricObservation` (Immutable Lab/Bench Record):**
   - `observation_id`, `tenant_id`, `fabric_lot_id`, `weave_or_knit_structure: "PLAIN_WEAVE" | "TWILL" | "SATIN" | "JERSEY_KNIT" | "RIB_KNIT" | "INTERLOCK" | "DENIM" | "GABARDINE"`
   - `fiber_composition: Map<FiberType, Percentage>`
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
   - `ease_policy_bounds`: `{ min_circumferential_ease_cm, recommended_ease_cm, max_negative_ease_pct, sleeve_cap_ease_ratio_band }`

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Bending Rigidity from Cantilever Overhang (`ASTM D1388`):**
   $$B_{\text{dir}} = w \cdot c_{\text{dir}}^3, \quad c_{\text{dir}} = \frac{L_{\text{overhang, dir}}}{2} \left(\frac{\cos(\theta/2)}{8 \tan \theta}\right)^{1/3} \quad (\text{for standard } \theta = 41.5^\circ, \; c \approx 0.5 \, L_{\text{overhang}})$$
   where $w = \text{GSM} \times 10^{-3} \times g$ is weight per unit area ($\text{N/m}^2$).
2. **Thermodynamic & Mechanical Positive-Definiteness Invariant:**
   The calibrated 2D orthotropic planar elasticity tensor $\mathbf{C}$ must be strictly symmetric positive-definite ($\text{det}(\mathbf{C}) > 0$, $E_{\text{warp}} > 0$, $E_{\text{weft}} > 0$, $G_{\text{shear}} > 0$, $1 - \nu_{12}\nu_{21} > 0.05$). Any calibration violating positive-definiteness is rejected (`AC-07`).
3. **Shrinkage Compensation Transformation:**
   When a fabric has verified relaxation shrinkage $(s_{\text{warp}}, s_{\text{weft}}) \in [-0.15, 0.05]$ (where negative indicates shrinkage), post-cut/pre-wash pattern scaling along the piece grainline basis $(\hat{\mathbf{g}}, \hat{\mathbf{g}}^\perp)$ is bounded by:
   $$\lambda_{\text{warp}} = \frac{1}{1 + s_{\text{warp}}}, \quad \lambda_{\text{weft}} = \frac{1}{1 + s_{\text{weft}}}$$
4. **Negative-Ease Safety Policy (`Knitwear` vs. `Woven`):**
   - For `Woven` fabrics without elastane ($\text{elastic\_recovery} < 90\%$ or $\text{extension} < 5\%$), negative circumferential ease ($\text{ease} < 0\text{ cm}$) is **hard-blocked** at `M02d` drafting.
   - For `Knit` / stretch fabrics, negative ease is permitted only up to $\min(\text{safe\_working\_elongation\_pct}, 0.6 \times \text{max\_recoverable\_strain})$ so residual permanent set remains $\le 2\%$.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/materials/observations` → Records `RawFabricObservation` with test protocol metadata.
- `POST /api/v1/materials/calibrate` → Runs constitutive parameter fitting & thermodynamic stability verification, producing `CalibratedMaterialSpec`.
- `GET /api/v1/materials/{material_spec_id}/ease-and-seam-policy` → Returns category ease bounds, recommended ISO 4915/4916 stitch/seam classes, and needle/thread sizing for `M02` and `M05`.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Proprietary mill and brand fabric libraries are tenant-scoped (`tenant_id`) via `M01` RLS; Patroner's curated reference fabric library is published as read-only system-shared records with full `SHA-256` provenance.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Material & Fabric Lab Panel:** Displays raw lab/bench observations alongside calibrated stiffness/drape curves, confidence tiers (`Tier 1 Lab` / `Tier 2 Bench` / `Tier 3 Prior`), shrinkage compensation badges, and recommended ease/seam pairings.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M03.1` — Material Schema & Repository:** Implement `RawFabricObservation` and `CalibratedMaterialSpec` tables and Pydantic contracts.
2. **`M03.2` — Constitutive Calibration Engine:** Implement `ASTM D1388` / `ISO 13934` / `ISO 9073-9` to orthotropic shell parameter conversion with positive-definiteness enforcement.
3. **`M03.3` — Ease, Negative-Ease & Shrinkage Policy Engine:** Implement category-specific ease rules and grainline-aligned shrinkage compensation matrices.
4. **`M03.4` — Seam & Needle Compatibility Engine:** Map fabric GSM, thickness, and weave/knit structure to allowed ISO 4916 seam classes, seam allowance widths, and stitch densities for `M05`.
5. **`M03.5` — Reference Fabric Catalog Seeding:** Populate 25 validated reference fabrics (including 100% Virgin Wool Gabardine $240\text{ g/m}^2$ and Cotton Poplin $135\text{ g/m}^2$ for the Vertical Slice).

## 15. Migration & Parity Strategy (Class A vs Class B Fixtures)
- Pure greenfield Python domain module (`Class B Normative` only); replaces implicit zero-fabric-awareness in the legacy TypeScript prototype.

## 16. Unit, Property & Adversarial Test Plan
- **Thermodynamic Violation Tests:** Input negative overhang, Poisson ratio $\nu_{12}\nu_{21} \ge 1$, or negative GSM → verify hard rejection.
- **Woven Negative-Ease Rejection Test:** Attempt to draft a non-stretch wool gabardine skirt with $-2.0\text{ cm}$ hip ease → verify `M03` policy blocks compilation.
- **Tier Promotion Gate Test:** Verify that a `TIER_3_PRIOR` fabric cannot transition a garment revision to `Sample_Approved` or `Production_Ready` (`AC-07`).

## 17. Independent Verification Oracles
- Independent Python symbolic/numerical mechanics oracle verifying `ASTM D1388` flexural rigidity conversion and positive-definite strain energy density across random strain tensors $\boldsymbol{\varepsilon}$.

## 18. Physical, Manufacturing or Financial Validation Protocol
- Physical benchtop validation (`DEC-03`) on $\ge 20$ physical fabric swatches comparing cantilever overhang, Cusick drape coefficient, and steam-press relaxation shrinkage against digital `CalibratedMaterialSpec` predictions.

## 19. Acceptance Criteria (`AC-01`–`AC-12` Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`** (100% Python execution), **`AC-07`** (Material-Model Credibility & Tier enforcement).

## 20. Failure Modes, Rollback & Recovery Procedures
- If a user selects an unmeasured fabric (`TIER_3_PRIOR`), `M03` permits exploratory `Concept`/`Drafted` previews with explicit uncertainty bands (`±25%` stiffness range) while blocking `Sample_Approved` / `Production_Ready` promotion until `TIER_1_LAB` or `TIER_2_BENCHTOP` coupon measurements are recorded.

## 21. Observability, Audit Logging & Telemetry
- Logs calibration residuals, confidence tier, and shrinkage compensation deltas in revision provenance metadata.

## 22. Explicit Non-Goals & Scope Guardrails
- `M03` does not run full 3D garment mesh time-integration (owned by `M06`); it provides the constitutive material parameters and bounds consumed by `M02`, `M05`, and `M06`.

## 23. Downstream Unlocks
- Unlocks **`M02d`** (material-aware block ease), **`M05`** (BOM, shrinkage compensation & ISO seam schedules), and **`M06`** (calibrated 3D cloth simulation).

## 24. Definition of Done Checklist
- [ ] `RawFabricObservation` and `CalibratedMaterialSpec` schemas and endpoints active.
- [ ] Orthotropic elasticity positive-definiteness verifier enforced (`AC-07`).
- [ ] Woven vs. knit ease and negative-ease safety policies integrated with `M02d`.
- [ ] 25 reference fabric records seeded with full provenance metadata.
