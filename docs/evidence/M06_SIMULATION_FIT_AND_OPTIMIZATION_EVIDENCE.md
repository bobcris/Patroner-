# Patroner — Milestone 06 Simulation, Fit Evaluation & Bounded Optimization Evidence

**Workspace:** `/app/applet`
**Governance Posture:**
- `M00`: NOT ACCEPTED
- Protected Gates (`Gate Auth-2`, `Gate Auth-3`, `Gate Auth-4`, `DEC-13 Stage 2`): CLOSED
- `isProductionReady`: `false` strictly enforced across all M06 simulations, regional fit reports, constitutive material specs, optimization proposals, and AC-09 toile records
- `physicalValidationRequired`: `true` strictly enforced (`AC-09` defaults strictly to `PENDING` with zero fabricated physical data)
- `externalCadInteroperabilityVerified`: `false`
- `plan/` directory preserved untouched; zero unauthorized merges, pushes, or deployments.

---

## 1. Summary of M06 Engineering Deliverables (`M06.1`–`M06.6`)

### M06.1 — Parametric 3D Avatar Reconstruction & REQ-BODY-01 Semantic Guard (`src/engine/simulation/avatar-generator.ts`)
- Implemented `generateParametricAvatar`, `validateAvatarProvenance`, `sampleTorsoEllipseAtY`, and `evaluateTorsoSurfaceClearance` across three articulated poses (`CANONICAL_A_POSE`, `ARM_FORWARD_45`, `SEATED_90`).
- Positioned anatomical shoulder acromion pivots cleanly lateral to the torso ribcage envelope (`shoulder.semiWidthXCm + 1.1 cm`, abducted `22° / 18° / 16°`) so arm cylinder SDFs maintain genuine clear air-gap separation from the chest/scye ellipse.
- Computes 8 elliptical cross-section planes (`neck`, `shoulder`, `scye`, `bust`, `waist`, `high_hip`, `low_hip`, `hem`), 15 anatomical landmarks, articulated arm cylinder axes, and explicit measurement uncertainties (`±0.7–1.5 cm`).
- Strictly labels `sourceType: 'ESTIMATED_PARAMETRIC_M02C'` and rejects attempts to spoof `'MEASURED_3D_SCAN'` without a valid certificate and scan ID.

### M06.2 & M06.3 — Orthotropic Material Constitutive Engine, Multi-Resolution AC-08 Benchmarks B1–B4, & Damped XPBD Equilibrium Solver
- **Constitutive Mechanics (`src/engine/simulation/material-constitutive.ts`):**
  - Enforces 2D orthotropic reciprocal symmetry with serialized precision (`nu21 = nu12 * E_weft / E_warp` to 12 decimal places, keeping serialized symmetry residual `<= 1e-9`, measured `~4.4e-11` on `wool-crepe`), positive definiteness (`determinant2D > 0`), and strict 3-tier evidence gating (`TIER_1_LAB`, `TIER_2_BENCHTOP`, `TIER_3_PRIOR`).
- **AC-08 Analytical Benchmarks (`src/engine/simulation/analytical-benchmarks.ts`):**
  - Implemented multi-resolution live solver benchmarks (`SOLVER_VERSION = 'patroner-cst-xpbd-v1.1.0'`) with fail-closed constitutive gating (`isMaterialConstitutiveValidForBenchmarks`):
    - `B1_UNIAXIAL_MEMBRANE`: Coarse `4x8` (`0.00075%`) and Refined `8x16` (`0.00576%`) vs acceptance limit `<= 0.1%`.
    - `B2_CANTILEVER_BENDING`: `32-hinge` (`0.0004%`) and `64-hinge` (`0.0001%`) vs nonlinear large-deflection RK4 ODE (`<= 1.5%`).
    - `B3_CATENARY_CURVE`: `30-link (ds=8mm)` (`0.0191 cm`) and `60-link (ds=4mm)` (`0.046 cm`) vs `y = a * cosh(x / a)` (`<= 0.05 cm`).
    - `B4_MESH_CONVERGENCE`: Both `20mm -> 10mm` (`0.00647%`) and M06 §10.2 `8mm -> 4mm` (`10x15` vs `20x30`, `0.0133%`) refinement stability (`< 2.0%`).
- **2D-to-3D Triangular Mesh, Contact Barriers & Self-Intersection Separation (`src/engine/simulation/cloth-solver.ts`):**
  - Mirror-invariant Bowyer-Watson 2D Delaunay triangulation inside `PatternPiece.stitchingContour`, bijective `(theta, tAxis)` sleeve-tube projection, and dense topological seam-spring pairing across all shared seam boundaries (including welded `CF`/`CB` waist/neck corner vertices at `|restX| < 0.05`).
  - Alternating vertex/centroid body-clearance SDF projections (`evaluateTorsoSurfaceClearance` & `evaluateArmCylinderClearance`) paired with AABB + Möller-Trumbore non-adjacent cloth-cloth intersection detection and outward separation (`resolveClothSelfIntersectionsPass`).
  - Achieves **`0` body interpenetrating triangles**, **`0` non-adjacent cloth self-intersecting triangles**, **`0` degenerate triangles**, **`< 0.01 cm` L/R symmetry error**, and explicit 4-layer `epistemicLayers` separation (`AC-08_PASSED`, `CONVERGED`, `PARAMETRIC_M02C_SYNTHETIC`, `AC-09_PENDING`) on both Skirt and Bodice+Sleeve across all 3 poses.

### M06.4 — Quantitative Regional Fit Diagnostics (`src/engine/simulation/fit-evaluator.ts`)
- Evaluates 8 anatomical zones with regional ease delta, peak warp/weft/von-Mises strain (`%`), Laplace contact pressure (`kPa`), hemline level deviation (`cm`), center-front grainline plumb tilt (`deg`), documented assumptions, and measurement provenance uncertainty statements.
- Enforces `prohibitsUniversalScalarScore: true`, `physicalValidationRequired: true`, and `isProductionReady: false`.

### M06.5 — Bounded Multi-Objective Pattern Optimizer (`src/engine/simulation/bounded-optimizer.ts`)
- Optimizes only declared M02/M04 recipe parameters within strict `±1.5 cm` box bounds (`RECIPE_BOUNDS`), deduplicates clamped candidates, and re-validates every candidate through full M02 drafting + M04.3 assembly checks (verified rejection path on invalid drafts).
- Deterministic Pareto tie-break sorting with per-zone before/after comparisons (`regionalDeltaSummary`), reusing verified `benchmarkQualification` only when `materialSpecId` and `solverVersion` match identically, and strictly emitting unapproved `draft` child specs (`isApproved: false`, `requiresHumanApproval: true`).

### M06.6 — Physical Toile Validation Protocol (`AC-09`) & Pattern CAD Viewport Integration (`src/engine/simulation/physical-validation.ts`, `src/features/simulation/SimulationFitPanel.tsx`)
- Implemented `AC-09` protocol evaluator and interactive workbench for both `skirt-block-v1` and `bodice-sleeve-v1`, strictly defaulting to `PENDING` with `null` physical tape entries (`<= 0.50 cm` POM concordance, `>= 85%` regional fit-issue agreement, photographic/grainline/seam evidence checklist).
- Upgraded `3D Fit & Optimization (M 06)` inside `4. Pattern CAD` (`SimulationFitPanel.tsx`) with 4-layer epistemic status banner, contact/self-contact/topology symmetry strip, multi-res `B1`–`B4` readouts, constitutive warning banner, before/after optimizer zone deltas, and live `AC-09` evidence panel.

---

## 2. Verification Summary

- **Full Test Suite (`npm test`):** **835 / 835 tests passed across 183 suites** (0 failures), preserving all 829 M01–M05 tests and passing all 6 expanded M06 suites (`src/engine/simulation/simulation-fit-optimization.test.ts`):
  - `M06.1 REQ-BODY-01`: parametric provenance & anti-spoofing guard across all 3 poses.
  - `M06.3 ADR-005`: orthotropic tensor symmetry (`<= 1e-9`), positive definiteness, and 3-tier evidence gating across all preset fabrics.
  - `M06.3 AC-08`: multi-resolution `B1`–`B4` (including `8mm -> 4mm`) passing across 4 fabrics + fail-closed failure on negative-modulus/negative-determinant tensors.
  - `M06.2/M06.3/M06.4`: convergence across Skirt (`1532` tris, `0` body penetrations, `0` cloth self-intersections, `0.0031 cm` L/R symmetry) and Bodice+Sleeve (`1400` tris, `0` body penetrations, `0` cloth self-intersections, `< 0.01 cm` L/R symmetry across `CANONICAL_A_POSE`, `ARM_FORWARD_45`, `SEATED_90`), plus Skirt mesh-refinement consistency.
  - `M06.5 ADR-006`: deterministic ranking, `±1.5 cm` box clamp, M02/M04.3 rejection path, before/after regional deltas, and strict unapproved `draft` gate.
  - `M06 §18 AC-09`: `PENDING` default on both `skirt-block-v1` and `bodice-sleeve-v1`, `INCOMPLETE` on partial entries, `FAILED` on out-of-tolerance POM (`> 0.50 cm`) or `< 85%` agreement, and `PASSED` only with complete in-tolerance evidence while preserving `isProductionReady: false`.
- **TypeScript & Production Build (`compile_applet`, `lint_applet`):** Clean compilation (`vite build`) and zero errors (`tsc --noEmit`).
- **Headless Chromium Verification (`http://127.0.0.1:3000`, `1440x900`):**
  - Zero console or runtime errors.
  - Verified both Skirt and Bodice+Sleeve 3D isometric renders inside `4. Pattern CAD` -> `3D Fit & Optimization (M 06)`, pose switching (`ARM_FORWARD_45`), heatmap switching (`STRAIN`), bounded optimization (`Evaluated: 5 • Rejected by M02: 0`, `Before → After Regional Delta`), `AC-09` block tab switching (`skirt-block-v1` / `bodice-sleeve-v1`), and dynamic `AC-09` tolerance transitions (`PENDING` -> `FAILED` on `92.5 cm` out-of-tolerance bust input).

---

## 3. Remaining Open Blockers & Roadmap Handoff Status

1. **M00 & Protected Human Sign-Off Gates (`Gate Auth-2`, `Auth-3`, `Auth-4`, `DEC-13 Stage 2`):** Remain **CLOSED**. Per `plan/16_UNIFIED_EXECUTION_SCHEDULE.md`, **Gate Auth-3** (blocking M07 Tech Spec & PLM / M08 Production Operations UI expansion beyond verified foundations) remains closed until independent audit sign-off and M06 physical validation closure.
2. **AC-09 Physical Toile Fit Validation:** Remains strictly **`PENDING`** until physical sewn toiles for `skirt-block-v1` and `bodice-sleeve-v1` are physically measured on a dress form and recorded (`physicalValidationRequired: true`).
3. **Absent Modules Strictly Preserved:** `src/engine/drafting/trouser-block.ts` remains absent (`trouser` stays `SPECS ONLY`); Skirt multi-size grading remains single-size scope.
4. **External CAD/CAM Interoperability:** `externalCadInteroperabilityVerified` remains `false`.
