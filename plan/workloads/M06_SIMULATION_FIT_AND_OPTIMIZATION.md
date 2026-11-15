# WORKLOAD M06 — 3D SIMULATION, AVATAR FIT EVALUATION & BOUNDED OPTIMIZATION (`R2.1`)

## 1. Workload ID & Title
- **Workload ID:** `M06`
- **Title:** Parametric Body/Avatar vs. 3D Scan Representation, Calibrated 3D Cloth Simulation, Quantitative Fit Evaluation & Bounded Pattern Optimization
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase C (Simulation, Fit Prediction & Bounded Optimization)`

## 2. Purpose & Architectural Role
`M06` implements the **Core Engineering Loop of `Revision v4.5`** (`Dossier 05 v5.3`, `Dossier 10 v5.8`, `Dossier 11 v5.9`, `Dossier 12 v5.10`) inside `services/fashion-engine`. It replaces the repository's mock Three.js cylinder (`src/components/Viewport3D.tsx`) with an authoritative Python simulation, fit evaluation, and bounded optimization pipeline where 3D visual rendering is a diagnostic projection of verified physical mechanics rather than a decorative illusion (`ADR-005`, `ADR-006`).

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 04`, `Ch. 06`, `Ch. 09`, `Ch. 15`, `App. A7`
- `Patroner_Architecture_Revision_v4.5.pdf` (Fit Prediction, Bounded Optimization & Independent Re-Validation)
- `Dossier 05 v5.3`, `Dossier 06 v5.4`, `Dossier 10 v5.8`, `Dossier 11 v5.9`, `Dossier 12 v5.10`

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-BODY-01`**: Semantic Separation of 1D Tape Measurements (`M02c`), Estimated Parametric 3D Avatars, and Measured 3D Body Scans with Anatomical Landmarks & Pose Semantics
- **`REQ-SIM-01`**: Numerically Credible 3D Cloth Solver Passing Analytical Mechanics Benchmarks (B1–B4)
- **`REQ-FIT-01`**: Quantitative Regional Fit Diagnostics & Bounded Pattern Optimization (`M04b` + `M02` Re-Validation)

## 5. Current Repository Baseline & Classification
- **`src/components/Viewport3D.tsx`**: `D` (Demo/Mock) / `X` (Contradicts Spec) — Renders a static Three.js cylinder with zero association to 2D pattern pieces, zero sewing constraints, zero material mechanics, and zero fit diagnostics.

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Mitigates **`RSK-04`** (uncalibrated simulation) and **`RSK-05`** (optimization overfitting) by enforcing `Dossier 10` analytical convergence gates and `Revision v4.5` bounded recipe-parameter optimization coupled to `M04b` and `M02`.

## 7. Prerequisites & Upstream Dependencies
- Requires **`M02c`** (Body measurements), **`M02g`** (Validated 2D pattern pieces & seam pairings), and **`M03`** (`CalibratedMaterialSpec`), and integrates with **`M04b`** (for bounded recipe parameter re-compilation during optimization).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/simulation_and_fit/
├── avatar/
│   ├── parametric_body.py       # Parametric body generator from M02c profile + anatomical landmarks
│   ├── scan_registration.py     # 3D body scan mesh cleaner, landmark registration & cross-section slicer
│   └── pose_kinematics.py       # Canonical A-pose, T-pose, seated & reach evaluation poses (Dossier 11)
├── solver/
│   ├── mesh_triangulator.py     # Constrained Delaunay triangulation of 2D pieces with controlled edge length
│   ├── cloth_solver.py          # Orthotropic FEM membrane + discrete hinge bending + IPC frictional contact
│   └── analytical_benchmarks.py # Cantilever elastica, catenary drape, cylinder wrap & mesh convergence tests
├── fit_evaluation/
│   ├── regional_metrics.py      # Circumferential ease, contact pressure, warp/weft strain, grainline torque, balance
│   └── fit_critic.py            # Synthesizes FitEvaluationReport against GarmentIntentSpecification targets
└── optimization/
    ├── bounded_optimizer.py     # Box-constrained Bayesian / trust-region Pareto optimizer over M04b recipe params
    └── independent_revalidator.py # Invokes M04b -> M02d/e/f/b to re-validate every candidate from scratch
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`AvatarBodyRepresentation` (`Dossier 11`):**
   - `{ avatar_id, tenant_id, source_type: "ESTIMATED_PARAMETRIC_M02C" | "MEASURED_3D_SCAN", pose_id: "CANONICAL_A_POSE" | "SEATED_90" | "ARM_FORWARD_45", watertight_mesh_uri, anatomical_landmarks: Map<LandmarkID, Point3D>, cross_section_contours: Map<AnatomicalPlaneID, ClosedContour3D>, measurement_uncertainty_cm: Map<string, float> }`
2. **`SimulationCaseResult` (`Dossier 10`):**
   - `{ simulation_id, revision_id, avatar_id, material_spec_id, solver_version, mesh_edge_length_mm: float, equilibrium_residual_norm: float, energy_history: EnergyPoint[], draped_mesh_gltf_uri, vertex_strain_tensor_field_uri, body_contact_pressure_kpa_field_uri, convergence_verified: bool }`
3. **`FitEvaluationReport` (`Dossier 05` / `Dossier 12`):**
   - `{ fit_report_id, simulation_id, overall_fit_status: "PASS" | "MARGINAL_ADJUSTABLE" | "FAIL_STRUCTURAL", regional_zones: Map<FitZoneID, ZoneFitMetrics>, hem_level_deviation_cm: float, grainline_plumb_deviation_deg: float, pull_line_vectors: Vector3D[], actionable_findings: FitDiagnosticFinding[] }` (Prohibits a single universal fit score).
4. **`BoundedOptimizationProposal` (`Revision v4.5`):**
   - `{ proposal_id, parent_revision_id, parameter_deltas: Map<RecipeParamID, float>, objective_scores_before: FitObjectiveVector, objective_scores_after: FitObjectiveVector, pareto_rank: int, independent_m02_validation_passed: bool, requires_human_approval: true }`

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Orthotropic Shell Energy & Equilibrium (`Dossier 10`):**
   $$E(\mathbf{x}) = E_{\text{membrane}}(\mathbf{x}; k_{\text{warp}}, k_{\text{weft}}, k_{\text{shear}}, \nu_{12}) + E_{\text{bending}}(\mathbf{x}; B_{\text{warp}}, B_{\text{weft}}) + E_{\text{seam}}(\mathbf{x}) + E_{\text{gravity}}(\mathbf{x}) + E_{\text{contact\_barrier}}(\mathbf{x}, \mathcal{B}_{\text{avatar}})$$
   with non-penetrating Incremental Potential Contact (IPC) barrier ensuring zero cloth-body or cloth-cloth interpenetration.
2. **Mandatory Analytical Credibility Benchmarks (`AC-08`):**
   - **B1 — Uniaxial Membrane Patch Test:** Exact analytical strain $\varepsilon = F / (k \cdot W)$ within $\le 0.1\%$.
   - **B2 — Cantilever Elastica Bending (`ASTM D1388`):** Tip deflection matches numerical elastica ODE solution within $\le 1.5\%$.
   - **B3 — Catenary Suspension Curve:** Hanging strip matches exact hyperbolic cosine $y(x) = a \cosh(x/a)$ within $\le 0.5\text{ mm}$.
   - **B4 — Mesh Refinement Convergence:** Halving triangle edge length ($h = 8\text{ mm} \to 4\text{ mm}$) changes mean regional strain by $< 2.0\%$.
3. **Bounded Multi-Objective Pattern Optimization (`Revision v4.5` & `Dossier 12`):**
   $$\min_{\boldsymbol{\theta} \in [\boldsymbol{\theta}_{\min}, \boldsymbol{\theta}_{\max}]} \mathbf{J}(\boldsymbol{\theta}) = \Big( J_{\text{strain}}(\boldsymbol{\theta}), \; J_{\text{ease\_deviation}}(\boldsymbol{\theta}), \; J_{\text{balance\_tilt}}(\boldsymbol{\theta}), \; J_{\text{style\_preservation}}(\|\boldsymbol{\theta} - \boldsymbol{\theta}_0\|_W^2) \Big)$$
   where every candidate $\boldsymbol{\theta}^*$ is re-compiled via `M04b` (`Step 06`) and independently re-validated via `M02b`/`M02f` (`Step 07` certified bounds and complete-interval offset checks) before presentation to the human patternmaker.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/avatar/generate` → Builds `AvatarBodyRepresentation` with strict provenance labeling (`ESTIMATED_PARAMETRIC_M02C` vs. `MEASURED_3D_SCAN`).
- `POST /api/v1/simulation/run` (Async Job) → Executes 3D assembly, sewing closure, and equilibrium drape simulation.
- `POST /api/v1/fit/evaluate` → Computes regional `FitEvaluationReport`.
- `POST /api/v1/fit/optimize-bounded` (Async Job) → Runs bounded Pareto optimization, re-validates via `M04b`/`M02`, and emits candidate revision proposals for human approval.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- 3D body scans and customer anthropometric avatars are encrypted at rest with tenant-scoped KMS keys, protected by strict ABAC (never accessible to workshop makers in `M07`), and subject to GDPR erasure (`M01` / `M10`).
- Optimization proposals never overwrite the active revision; they create candidate child branches requiring explicit `LEAD_PATTERNMAKER` approval.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Diagnostic 3D Fit & Optimization Viewport (Replaces Mock `Viewport3D.tsx`):**
  - Renders the authoritative draped 3D mesh (`glTF`) with explicit avatar provenance badge (`Estimated Parametric Surface` vs. `Measured 3D Scan`),
  - Diagnostic heatmap overlays: **Warp/Weft Strain (%)**, **Contact Pressure (kPa)**, **Circumferential Ease Cross-Sections**, and **Grainline Plumb/Balance Lines**,
  - **Bounded Optimization Review Drawer** with `Approve & Branch` or `Reject` controls.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M06.1` — Parametric Avatar vs. 3D Scan Engine (`Dossier 11`).**
2. **`M06.2` — 2D-to-3D Constrained Delaunay Mesher & Sewing Graph Builder.**
3. **`M06.3` — Orthotropic Cloth Solver & Analytical Benchmark Suite (B1–B4, `Dossier 10`).**
4. **`M06.4` — Quantitative Regional Fit Evaluator (`Dossier 05` / `Dossier 12`).**
5. **`M06.5` — Bounded Pattern Optimizer & `M04b`/`M02` Independent Re-Validator.**
6. **`M06.6` — Next.js Diagnostic 3D Viewport Replacement.**

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Retires `src/components/Viewport3D.tsx` (`Disposition: RETIRE & REIMP`). Establishes Class B analytical mechanics fixtures (B1–B4) as the mandatory baseline.

## 16. Unit, Property & Adversarial Test Plan
- Analytical solver benchmarks B1–B4 run on every solver change.
- **Interpenetration Zero-Tolerance Test:** Verify 0 intersecting cloth-avatar triangles at equilibrium across 50 body profiles.
- **Semantic Provenance Enforcement Test:** Verify `ESTIMATED_PARAMETRIC_M02C` cannot be serialized or approved as `MEASURED_3D_SCAN`.

## 17. Independent Verification Oracles
- Closed-form analytical ODE/catenary oracle (`scipy.integrate.solve_bvp`) for B1–B3 + independent signed-distance-field (SDF) verifier checking cloth-body clearance and circumferential ease cross-sections.

## 18. Physical, Manufacturing or Financial Validation Protocol
- **Physical vs. Digital Fit Concordance Trial (`AC-09`, `Level A`):** Sew physical toiles of `skirt-block-v1` and `bodice-sleeve-v1` in calibrated fabrics on target dress forms; verify $\le 0.5\text{ cm}$ POM concordance and $\ge 85\%$ regional fit-issue agreement with `FitEvaluationReport`.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`**, **`AC-05`**, **`AC-07`**, **`AC-08`** (Simulation Numerical Credibility), **`AC-09`** (Level A Physical Toile Validation), **`AC-11`**. Required for **Release Level A**.

## 20. Failure Modes, Rollback & Recovery Procedures
- Non-convergent runs fail closed (`STRUCTURAL_DONNING_OR_CONVERGENCE_FAILURE`) and cannot qualify fit or trigger optimization promotion.

## 21. Observability, Audit Logging & Telemetry
- Records mesh triangle count, solver wall-clock time, final gradient norm, energy trajectory, and optimization evaluations per revision.

## 22. Explicit Non-Goals & Scope Guardrails
- Digital simulation (`AC-08`) is never a substitute for physical sample approval (`AC-09`/`AC-10` in `M07`).

## 23. Downstream Unlocks
- Unlocks the **Vertical Slice Gate (`plan/08`)** and **`M07`** (Physical Sample Approval).

## 24. Definition of Done Checklist
- [ ] Mock cylinder in `Viewport3D.tsx` retired and replaced by real Python simulation outputs.
- [ ] Analytical mechanics benchmarks B1–B4 passing in CI (`AC-08`).
- [ ] Regional `FitEvaluationReport` and bounded Pareto optimizer operational with mandatory `M04b`/`M02` re-validation and human sign-off.
- [ ] Level A physical vs. digital toile validation completed for `skirt-block-v1` and `bodice-sleeve-v1` (`AC-09`).
