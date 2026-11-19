# P1-2 Consolidation, Skirt Readiness Integrity & AC-09 Fail-Closed Evidence Report

**Evidence ID:** `PATRONER-P1-2-CONSOLIDATION-INTEGRITY-EVIDENCE`  
**Workspace:** `/app/applet` (no `.git` repository present; no Git operations performed)  
**Scope:** Authorized `P1-2` remediation (`P1-2A` through `P1-2E`) + Section 7 `B1`–`B4` documentation conflict record  
**Prior Reported Baseline (Independently Reproduced Before Edits):** `850/850` tests passing across `184` suites (`0` failures)  
**Post-Implementation Verified Result:** `862/862` tests passing across `184` suites (`0` failures, `0` skipped, `0` cancelled)  

> **Preserved Governance Posture (Unchanged):**
> - `M00`: **NOT ACCEPTED**
> - `Gate Auth-2`: **CLOSED**
> - `Gate Auth-3`: **CLOSED**
> - `Gate Auth-4`: **CLOSED**
> - `DEC-13 Stage 2`: **CLOSED**
> - `AC-09 Physical Validation`: **PENDING** (awaiting real physical toile evidence and authorized human reviewer sign-off)
> - `isProductionReady`: **`false`**
> - `externalCadInteroperabilityVerified`: **`false`**

---

## 1. Executive Summary of Implemented `P1-2` Deliverables

### 1.1 `P1-2A` — One Authoritative Production Workspace Bundle
- **New Shared Orchestration Layer:** `src/engine/production/production-workspace-bundle.ts` (exported via `src/engine/production/index.ts`).
- **Single Authoritative Computation:** `buildAuthoritativeProductionWorkspaceBundle(...)` produces one deterministic `AuthoritativeProductionWorkspaceBundle` containing:
  - Category grading policy (`resolveCategoryGradingPolicy(category)`),
  - Drafted pattern set (`draftedPatternSet`),
  - Category-scoped grading artifact (`gradedPatternSet` and `liveGradingArtifact`),
  - Canonical `m05Package` (`buildM05ProductionPackage(...)`) with synchronized `bomControls` and governance flags (`strictUncertaintyGate`, `requireApprovedGovernance`),
  - Authoritative `liveSnapshot`, `readinessReport`, `exportValidation`, `canonicalDigestSha256`, and upstream revision lineage (`pipelineState`).
- **Single Authoritative UI State Owner (`src/App.tsx`):**
  - Lifted shared `bomControls` (`ProductionWorkspaceBomControls`), `bodiceDartStyle`, `sleeveEaseStrategy`, `strictUncertaintyGate`, and `requireApprovedGovernance` to `src/App.tsx`.
  - Computes `workspaceBundle` once via `useMemo` and passes it alongside controlled setters into `Header`, `PatternWorkspace` (Module 04), and `ProductionOverview` (Module 05).
- **Consumer Consolidation:**
  - `src/features/pattern-workspace/PatternWorkspace.tsx` (Module 04) no longer invokes `gradePattern`, `buildM05ProductionPackage`, or local BOM/governance state; renders a shared production readiness summary strip (`data-testid="m04-production-readiness-summary"`) sourced directly from `workspaceBundle`.
  - `src/features/production/ProductionOverview.tsx` (Module 05) no longer invokes `gradePattern`, `buildM05ProductionPackage`, `evaluateSpecPipelineSafely`, or `validateProductionExportPrerequisites` independently; consumes the identical `workspaceBundle` and shared `bomControls` setters.
- **Governance Gate Enforcement (`src/engine/production/production-validator.ts` & `src/engine/production/production-engineering.ts`):**
  - Added `requireApprovedGovernance?: boolean` to `EvaluateProductionReadinessInput` and `M05PackageBuildOptions`. When `true`, Gate 7 (`unresolved-measurement-approvals`) elevates from warning/advisory to `'fail'` / `'blocking'`.

### 1.2 `P1-2B` — Skirt/Bodice Grading Category Boundary & Export Policy Alignment
- **Explicit Fail-Closed Category Guard (`src/engine/grading/pattern-grader.ts`):**
  - Exported `GRADING_SUPPORTED_GARMENT_CATEGORIES = ['bodice'] as const`, `isMultiSizeGradingSupportedCategory(...)`, and `UnsupportedGradingCategoryError` (`code: 'UNSUPPORTED_GRADING_CATEGORY'`).
  - `gradePattern(...)` now rejects non-bodice categories (`skirt`, `trouser`, `dress`, or any unsupported category) immediately before `gradeBodice` can ever execute, guaranteeing skirt specifications can never synthesize bodice geometry.
- **Fail-Closed Override Guard (`src/engine/production/production-engineering.ts`):**
  - `buildM05ProductionPackage` rejects any injected `gradedPatternSetOverride` whose `garmentCategory !== spec.garmentCategory` or where `!isMultiSizeGradingSupportedCategory(spec.garmentCategory)`, keeping `gradedPatternSet = null` and surfacing a blocking integrity error in Gate 10 (`invalid-or-stale-revision`).
- **Single-Size Ungraded Skirt Scope Alignment (`PatternWorkspace.tsx` & `ProductionOverview.tsx`):**
  - For `skirt`, `workspaceBundle` yields `categoryPolicy.exportPolicy === 'single-size-ungraded'`, `gradedPatternSet === null`, and `liveGradingArtifact === undefined`.
  - Module 04 (`PatternWorkspace.tsx`) hides the multi-size Grading tab when `gradedPatternSet === null` and displays `SINGLE-SIZE-UNGRADED` in the shared readiness strip.
  - Module 05 (`ProductionOverview.tsx`) replaces the invalid Bodice XS–XXL matrix for Skirt with an explicit single-size ungraded scope panel (`data-testid="m05-skirt-single-size-scope"`, stating `Single-Size Ungraded Scope`, `Grading Artifact: None`, `Bodice Grader Never Invoked`, and multi-size skirt grading deferred to `P1-3`), while preserving the full XS–XXL matrix (`data-testid="m05-graded-matrix-section"`) for `bodice`.
  - Both modules guard rendering on `if (!isCadSupported || !m05Package)` rather than requiring `gradedPatternSet`.

### 1.3 `P1-2C` — AC-09 Fail-Closed Integrity (`src/engine/simulation/physical-validation.ts`)
- Closed the `'legacy'` execution-mode bypass in `evaluateAc09ToileRecord`:
  - **Zero-data default preservation:** Default records with no captured measurements, observations, process records, or reviewer sign-off remain strictly `PENDING` (never fabricated `PASSED` or false `FAILED`).
  - **Universal fail-closed evaluation across ALL execution modes (`'workflow'` and `'legacy'`):** No record in any execution mode can achieve `AC-09 PASSED` unless ALL mandatory requirements are satisfied:
    1. Valid sample registration (`sampleId`, `sampleRevision`, `sizeCode`),
    2. Pattern revision & fabric specification traceability matching active references (ID, composition, weight gsm, stretch %, material direction),
    3. Cutting & sewing process record including explicit `cuttingGrainlineVerified === true`, `seamAllowanceCm`, `stitchType`, `pressingMethod`, operators/dates,
    4. All required POM measurements (`<= 0.50 cm` concordance, repeat-measurement spread and instrument uncertainty checks),
    5. All required regional fit observations (`>= 85%` agreement),
    6. Required photographic attachment URIs (`front`, `side`, `back`),
    7. Authorized human reviewer sign-off (`LEAD_PATTERNMAKER`, `QA_ENGINEER`, `ATELIER_MASTER`, or `PROJECT_OWNER`) with non-empty name, date, and decision,
    8. Non-synthetic physical data provenance (`dataSource === 'PHYSICAL_TOILE_MEASUREMENT'`), and
    9. Immutability of signed `PASSED`/`FAILED` records requiring a new sample revision.

### 1.4 `P1-2D` — AC-09 UI Accuracy (`src/features/simulation/Ac09PhysicalValidationPanel.tsx`)
- Added an explicit in-session persistence disclosure banner (`data-testid="m06-ac09-persistence-notice"`) informing users that AC-09 records are stored in non-durable in-session browser state and must be exported via JSON report for durable archival.
- Removed implicit `cuttingGrainlineVerified: true` and implicit `pressingMethod` auto-population from the Stitch Type field handler.
- Provided three separate, explicit Process & Operator inputs:
  - `Stitch Type` (`data-testid="m06-ac09-stitch-type-input"`),
  - `Pressing Method` (`data-testid="m06-ac09-pressing-method-input"`),
  - Explicit `Cutting Grainline Verified` checkbox (`data-testid="m06-ac09-cutting-grainline-checkbox"`), defaulting to `false` until explicitly verified by the operator.

### 1.5 `P1-2E` — Bounded Optimization UI Wording (`src/features/simulation/SimulationFitPanel.tsx`)
- Renamed handler `handleApproveProposal` $\to$ `handleBranchProposal`.
- Replaced misleading CTA wording `"Approve & Branch Child"` with `"Branch Unapproved Child Revision"` (applied state: `"Unapproved Child Draft Branched"`).
- Preserved unapproved child revision invariants (`isApproved: false`, `approvalState: 'draft'`, `requiresHumanApproval: true`).

---

## 2. Section 7 — `B1`–`B4` Analytical Benchmark Documentation Conflict Record

> **Strict Rule Observed:** No benchmark mathematical code (`src/engine/simulation/analytical-benchmarks.ts`) and no authoritative files under `plan/` were modified. This section records the exact conflict and authority analysis for formal Project Owner / plan resolution.

### 2.1 Conflicting `B1`–`B4` Definitions Across `plan/`

| Attribute | Definition A (Blueprint `06` / Governance & Schedule Docs) | Definition B (`ADR-005` / `M06` Workload Spec & Implemented Solver Suite) |
| :--- | :--- | :--- |
| **Primary Source Locations** | - `plan/06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md §4.3` (Doc ID `PATRONER-R2.1.2-R1-06`, Line 103)<br>- Echoed (`B1`–`B4` $\le 5\%$ error, `DEC-02 Stage 2`, `Gate Auth-3`) in:<br>  - `plan/01_SOURCE_REGISTER_AND_REQUIREMENTS.md §2` (Line 39)<br>  - `plan/07_RISK_AND_OPEN_DECISIONS_REGISTER.md §2–§3` (Lines 40, 64)<br>  - `plan/10_RELEASE_AND_GOVERNANCE_POLICY.md` (Line 66)<br>  - `plan/16_UNIFIED_EXECUTION_SCHEDULE.md §2` (Line 62) | - `plan/decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md §2.3` (Rev `2.1`, Line 25)<br>- `plan/workloads/M06_SIMULATION_FIT_AND_OPTIMIZATION.md §10.2` (`AC-08`, Lines 63–67)<br>- Implemented in `src/engine/simulation/analytical-benchmarks.ts` |
| **`B1`** | **Flat Cantilever Bending** ($\le 5\%$ error) | **Uniaxial Membrane Patch Test** ($\varepsilon = F / (k \cdot W)$ within $\le 0.1\%$) |
| **`B2`** | **Cylindrical Drape** ($\le 5\%$ error) | **Cantilever Elastica Bending (`ASTM D1388`)** (tip deflection matches elastica ODE within $\le 1.5\%$) |
| **`B3`** | **Spherical Four-Point Shear Drape** ($\le 5\%$ error) | **Catenary Suspension Curve** ($y(x) = a \cosh(x/a)$ within $\le 0.5\text{ mm}$ / `0.05 cm`) |
| **`B4`** | **Bodice/Trouser Tension Map** ($\le 5\%$ error) | **Mesh Refinement Convergence** ($h = 8\text{ mm} \to 4\text{ mm}$ changes mean regional strain by $< 2.0\%$) |
| **Threshold / Criterion** | Uniform $\le 5\%$ error (`ClothSimulationQualificationReport.json`, `DEC-02 Stage 2`, `Gate Auth-3`) | Benchmark-specific analytical & convergence bounds ($\le 0.1\%$, $\le 1.5\%$, $\le 0.5\text{ mm}$, $< 2.0\%$; `AC-08` `convergence_verified: true`) |

### 2.2 Authority Hierarchy Analysis (`plan/01` & `plan/15`)
1. **`plan/01_SOURCE_REGISTER_AND_REQUIREMENTS.md §1` (`PATRONER-R2.1.2-R1-01`, Lines 16–22):**
   - Places **Blueprint `R2.1.2-R1` (`ADR-001`–`ADR-009`)** at **Rank 1 (Highest — Mathematical & Governance Precision)** and **Architecture Correction Addendum v4.1 & Revision v4.5** at **Rank 2** (explicitly mentioning `B1`–`B4` at Line 19).
   - However, **both** conflicting definitions reside inside the `plan/` Blueprint package itself: `plan/06 §4.3` carries Doc ID `PATRONER-R2.1.2-R1-06` (`R2.1.2-R1`), whereas `ADR-005` carries Revision `2.1` (15 Nov 2026) and `M06` carries the `AC-08` analytical benchmark specification.
   - Furthermore, `plan/01 §2` (Line 39) and `plan/07` (Line 64) cite `ADR-004` alongside `DEC-02` and `B1`–`B4` ($\le 5\%$), whereas `plan/README.md` (Line 44) maps `B1`–`B4` 3D Drape Qualification to `ADR-005`.
2. **`plan/15_R2.2_CROSS_DOCUMENT_RECONCILIATION_MATRIX.md` (`PATRONER-R2.2-15`, Lines 13–33):**
   - Establishes `plan/15` as the authoritative `R2.2` cross-document harmonization layer above immutable `R2.1.2-R1` for residual drift across `plan/00`–`14`, ADRs, and Workloads.
   - Its 6-row Cross-Document Drift Audit & Reconciliation Matrix (`§2`, Lines 25–32) covers: (1) `M11` scope drift, (2) `services/fashion-engine` vs. `services/geometry-engine`, (3) `Gate Auth-1` banner drift, (4) offset classification taxonomy drift, (5) Vertical Slice 1 prototype readiness gap, and (6) dual-gate consolidation.
   - **`plan/15` contains NO reconciliation row for the `B1`–`B4` definition divergence** between `plan/06 §4.3` and `ADR-005 §2.3` / `M06 §10.2`.

### 2.3 Formal Finding & Governance Recommendation
- **Finding:** Governing precedence between Definition A (`plan/06 §4.3` / `DEC-02 Stage 2` physical/drape benchmarks $\le 5\%$) and Definition B (`ADR-005 §2.3` & `M06 §10.2` closed-form `AC-08` analytical/convergence benchmarks) is **not unambiguously resolved in `plan/`**.
- **Required Action:** A **formal Project Owner / Blueprint plan decision** (e.g., an `R2.2` reconciliation row in `plan/15` or an explicit `DEC-02 Stage 1 / Stage 2` addendum clarifying whether Definition B governs `AC-08` analytical solver qualification while Definition A governs `DEC-02 Stage 2` drape/garment qualification at `Gate Auth-3`, or whether one supersedes the other) is required before `Gate Auth-3` / `DEC-02 Stage 2` sign-off.
- **Current Code Posture:** `src/engine/simulation/analytical-benchmarks.ts` remains untouched and aligned with `ADR-005 §2.3` / `M06 §10.2` (`AC-08`).

---

## 3. Modified and Created Files

### Created Files
- `src/engine/production/production-workspace-bundle.ts` — Shared deterministic production workspace orchestration helper (`P1-2A`, `P1-2B`).
- `src/engine/production/production-workspace-bundle.test.ts` — Dedicated unit & architectural boundary test suite (`P1-2A-01`–`04`, `P1-2B-01`–`05`; 9 new tests).
- `docs/evidence/P1_2_CONSOLIDATION_AND_INTEGRITY_EVIDENCE.md` — This evidence report (no existing evidence files overwritten or deleted).

### Modified Source Files
- `src/engine/grading/pattern-grader.ts` — Added `GRADING_SUPPORTED_GARMENT_CATEGORIES`, `isMultiSizeGradingSupportedCategory`, `UnsupportedGradingCategoryError`, and fail-closed category guard in `gradePattern`.
- `src/engine/production/production-validator.ts` — Added `requireApprovedGovernance?: boolean` option to `EvaluateProductionReadinessInput` so Gate 7 elevates to blocking `'fail'` when enabled.
- `src/engine/production/production-engineering.ts` — Guarded `gradedPatternSetOverride` fail-closed against unsupported or mismatched `garmentCategory`; propagated `requireApprovedGovernance` to `evaluateProductionReadiness`.
- `src/engine/production/index.ts` — Exported `production-workspace-bundle.ts`.
- `src/App.tsx` — Lifted shared BOM controls, drafting strategy options, and governance flags; computes single authoritative `workspaceBundle` and passes to `Header`, `PatternWorkspace`, and `ProductionOverview`.
- `src/features/pattern-workspace/PatternWorkspace.tsx` — Consumes `workspaceBundle` + shared setters; removed duplicated drafting/grading/M05 build logic; added M04 shared readiness strip; guarded grading UI by `gradedPatternSet`.
- `src/features/production/ProductionOverview.tsx` — Consumes `workspaceBundle` + shared setters; removed duplicated drafting/grading/M05/export-validation logic; replaced bogus Bodice XS–XXL matrix for Skirt with honest single-size ungraded scope panel (`P1-3` deferral).
- `src/engine/simulation/physical-validation.ts` — Closed the `'legacy'` execution-mode bypass so mandatory physical evidence, traceability, `cuttingGrainlineVerified`, photographic attachments, and authorized human reviewer sign-off are enforced fail-closed across all execution modes while preserving `PENDING` zero-data defaults.
- `src/features/simulation/Ac09PhysicalValidationPanel.tsx` — Added non-durable in-session persistence disclosure (`m06-ac09-persistence-notice`), decoupled `Stitch Type` and `Pressing Method` inputs without mutating `cuttingGrainlineVerified`, added explicit `Cutting Grainline Verified` checkbox (`m06-ac09-cutting-grainline-checkbox`), and refined input layout for clean readability.
- `src/features/simulation/SimulationFitPanel.tsx` — Renamed `handleApproveProposal` $\to$ `handleBranchProposal` and updated CTA copy to `"Branch Unapproved Child Revision"` / `"Unapproved Child Draft Branched"`.

### Modified Test Files
- `src/engine/simulation/ac09-physical-validation.test.ts` — Added `AC09-11` (`P1-2C`), `AC09-12` (`P1-2D`), and `AC09-13` (`P1-2E`).
- `src/engine/simulation/simulation-fit-optimization.test.ts` — Updated AC-09 test to verify fail-closed `'legacy'` mode rejection and valid full workflow authorized sign-off.
- Legacy M04.6 / M05.1 test fixture alignments (removed invalid `gradePattern(skirtSpec)` synthetic helper calls / wrong concept index exposed by `P1-2B` without weakening production guards):
  - `src/engine/production/end-to-end-integrity.test.ts`
  - `src/engine/production/audit-lineage-and-approval.test.ts`
  - `src/engine/production/m046234-trust-boundary-remediation.test.ts`
  - `src/engine/production/m046236-residual-findings-remediation.test.ts`
  - `src/engine/production/production-integrity-boundary-v2.test.ts`
  - `src/engine/production/m051-pattern-lifecycle-and-package.test.ts`
  - `src/engine/production/m0511-remediation.test.ts`
  - `src/engine/production/enterprise-trust-and-grading-lineage.test.ts`

---

## 4. Independent Verification Evidence

| Verification Check | Observed Result |
| :--- | :--- |
| **Pre-Edit Baseline (`npm test`)** | `850/850` tests passed across `184` suites (`0` fail) |
| **Post-Implementation Test Suite (`npm test`)** | **`862/862` tests passed across `184` suites** (`0` fail, `0` cancelled, `0` skipped; `84,460 ms`) — includes `+12` new `P1-2` tests (`P1-2A-01`..`04`, `P1-2B-01`..`05`, `AC09-11`..`13`) |
| **TypeScript Check (`npm run lint` / `tsc --noEmit`)** | **PASS (`0` errors)** |
| **Production Build (`npm run build` / `vite build`)** | **PASS (`0` errors)** |
| **Live Browser Verification (Headless Chromium via `playwright-cli`, `http://localhost:3000`)** | **PASS — `0` console errors, `0` console warnings, `0` runtime errors** across `1440x900` desktop and `768x1024` tablet viewports:<br>- **Skirt M04 & M05:** Identical canonical digest (`89905fc1dd4d95bf...`) after shared BOM quantity mutation (`1` $\to$ `3`), `SINGLE-SIZE-UNGRADED` policy, no Grading tab in M04, honest Single-Size Ungraded Scope card in M05 (`Grading Artifact: None`, `Bodice Grader Never Invoked`, zero XS–XXL Bodice matrix).<br>- **Bodice M04 & M05:** Full XS–XXL graded matrix rendered in M05 (`VERIFIED`, `PRODUCTION READY: FALSE`), matching canonical digest between M04 and M05.<br>- **M06 Optimization UI:** Displays `"Branch Unapproved Child Revision"` and `Child Revision State: DRAFT (UNAPPROVED)`.<br>- **M06 AC-09 UI:** Displays in-session persistence disclosure (`NON-DURABLE SESSION STORE`), separate `Stitch Type` and `Pressing Method` inputs, and explicit unchecked `Cutting Grainline Verified` checkbox; entering `"ISO-301 lockstitch"` left `Cutting Grainline Verified` unchecked and `Pressing Method` empty; `Reset Pending` restored `AC-09: PENDING`. |

---

## 5. Next Planned Task

- **`P1-3` (Multi-Size Skirt Grading)** remains the next planned engineering task under the authoritative roadmap, strictly subject to review and acceptance of this `P1-2` consolidation and integrity package.
- All protected gates (`M00`, `Gate Auth-2`, `Gate Auth-3`, `Gate Auth-4`, `DEC-13 Stage 2`, `AC-09`) remain **CLOSED / NOT ACCEPTED / PENDING**, and `isProductionReady` and `externalCadInteroperabilityVerified` remain **`false`**.
