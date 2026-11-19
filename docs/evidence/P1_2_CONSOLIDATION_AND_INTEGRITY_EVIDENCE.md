# P1-2 Consolidation, Skirt Readiness Integrity & AC-09 Fail-Closed Evidence Report

**Evidence ID:** `PATRONER-P1-2-CONSOLIDATION-INTEGRITY-EVIDENCE`  
**Document Revision:** **Revision 2 — Checkpoint 8 (`P1-2` Acceptance Remediation)** *(preserves Revision 1 history verbatim below and records the prior independent audit verdict of **`NOT ACCEPTED`**)*  
**Workspace:** `/app/applet` (no `.git` repository present; no Git operations performed)  
**Scope:** Authorized `P1-2` remediation (`P1-2A` through `P1-2E`, followed by Checkpoint 8 independent audit defect remediation `§2`–`§8` and `§9` deferred tracking record; `P1-3` NOT started)  
**Revision 1 Prior Reported Baseline (Independently Reproduced Before Rev 1 Edits):** `850/850` tests passing across `184` suites (`0` failures)  
**Revision 1 Post-Implementation Result (Prior Independent Audit Verdict: `NOT ACCEPTED`):** `862/862` tests passing across `184` suites (`0` failures)  
**Revision 2 (Checkpoint 8 Remediation) Verified Result:** **`882/882` tests passing across `184` suites** (`0` failures, `0` skipped, `0` cancelled; `91,064.30 ms`)  

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

## 5. Next Planned Task (Revision 1 Historical Note — Superseded by Revision 2 Below)

- **`P1-3` (Multi-Size Skirt Grading)** remains the next planned engineering task under the authoritative roadmap, strictly subject to review and acceptance of this `P1-2` consolidation and integrity package.
- All protected gates (`M00`, `Gate Auth-2`, `Gate Auth-3`, `Gate Auth-4`, `DEC-13 Stage 2`, `AC-09`) remain **CLOSED / NOT ACCEPTED / PENDING**, and `isProductionReady` and `externalCadInteroperabilityVerified` remain **`false`**.

---

# Revision 2 — Checkpoint 8: Independent P1-2 Audit Remediation & Evidence Archive

## 6. Independent Audit Verdict Record & Revision 1 Errata Corrections

An independent read-only acceptance audit of Revision 1 returned **`NOT ACCEPTED`**, identifying critical P0/P1 defects across the AC-09 trust boundary, production-package canonical digest determinism, duplicate grading-artifact ownership, unwired staleness tracking, Module 05 state/category consistency, armscye nominal POM computation, and Revision 1 evidence inaccuracies. All Revision 1 sections above are preserved for audit traceability; the following errata correct inaccuracies present in Revision 1:

| Revision 1 Text / Claim | Authoritative Codebase Reality (Corrected in Revision 2) |
| :--- | :--- |
| Reviewer roles listed as `QA_ENGINEER`, `ATELIER_MASTER`, `PROJECT_OWNER` | Exact `Ac09AuthorizedReviewerRole` union in `src/engine/simulation/physical-validation.ts`: `'LEAD_PATTERNMAKER' \| 'QA_LEAD' \| 'ATELIER_TECH_DIRECTOR' \| 'PRODUCTION_ENGINEER'` |
| Provenance field cited as `dataSource === 'PHYSICAL_TOILE_MEASUREMENT'` | Exact provenance field and literal: `sourceFlag === 'PHYSICAL_OPERATOR_CAPTURE'` (and `isSyntheticData !== true`) |
| Workflow states omitted from Revision 1 summary | Exact `Ac09WorkflowState` union: `'PENDING' \| 'DRAFT' \| 'SAMPLE_REGISTERED' \| 'EVIDENCE_INCOMPLETE' \| 'READY_FOR_REVIEW' \| 'PASSED' \| 'FAILED'` |
| Execution modes | Exact `Ac09ExecutionMode` union: `'workflow' \| 'legacy'`; both now enforce identical fail-closed requirements |
| Bundle type names | Authoritative M05 package type: `M05ProductionPackageBundle`; shared workspace bundle type: `AuthoritativeProductionWorkspaceBundle` |
| `P1-3` framing | `P1-3` is **NOT authorized** until a fresh, read-only independent acceptance audit verifies this Checkpoint 8 remediation and accepts `P1-2`. |
| Suite count / test count | Exact verified count in Revision 2: **`882/882` tests across `184` suites** (`+20` remediation tests over Revision 1's `862/862` baseline). |

---

## 7. Checkpoint 8 Remediation Summary (`§2`–`§7`)

### 7.1 `§2` (P0) — AC-09 Trust-Boundary Remediation (`src/engine/simulation/physical-validation.ts`)
All five independently reported `AC-09 PASSED` bypass paths were closed fail-closed:
1. **Cryptographic Signature & Revision-Lock Verification:** `evaluateAc09ToileRecord` now recomputes the expected SHA-256 reviewer signature digest via `computeAc09ReviewerSignatureDigest` and rejects forged/mismatched `signatureDigest` (`AC09_SIGNATURE_TAMPER_DETECTED`), invalid/incomplete sign-off fields (`AC09_INVALID_SIGN_OFF`), unlocked signed records (`AC09_LOCK_REQUIRED`), and post-sign-off tampering against the locked evidence snapshot digest (`AC09_LOCKED_SNAPSHOT_TAMPER_DETECTED`).
2. **Mandatory Fabric Specification Traceability:** `approvedFabricId`, `measuredFabricId`, `fabricComposition`, `fabricWeightGsm > 0`, `fabricStretchWeftPct` (`>= 0` finite), and non-empty `fabricDirection` are mandatory for `READY_FOR_REVIEW` and `PASSED`.
3. **Repeat-Measurement & Uncertainty Recomputation:** Every required POM must contain `>= 2` valid finite physical readings (`repeatReadingsCm.length >= 2`); `evaluateAc09ToileRecord` deterministically recomputes mean, half-range spread, and combined uncertainty against `instrumentUncertaintyCm` and rejects forged `measuredMeanCm`, `repeatSpreadCm`, `uncertaintyCm`, or `deltaCm` (`AC09_FORGED_UNCERTAINTY`).
4. **Mandatory Photographic & Structural Evidence Checklist:** Non-empty `evidenceAttachments` containing all mandatory views (`front`, `side`, `back`) with valid non-blank URIs (`uri`) and checked structural flags (`grainlinePlumbVerified`, `seamsAligned`, `hemLevelDeltaCm <= 0.8`) are required fail-closed; empty checklist arrays can no longer bypass the photo gate.
5. **Strict Workflow-State Gate in `recordAc09ReviewerDecision`:** `APPROVED_PASS` is rejected with `AC09_INVALID_WORKFLOW_STATE` unless `record.workflowState === 'READY_FOR_REVIEW'` (requiring explicit transition via `transitionAc09WorkflowState(record, 'READY_FOR_REVIEW')` after all evidence checks pass).
- **UI Alignment (`src/features/simulation/Ac09PhysicalValidationPanel.tsx`):** Added `Req #1` / `Req #2` input cues, `≥2 reads required` warning badge (`m06-ac09-pom-minreads-warn-*`), explicit `Submit for Review (READY_FOR_REVIEW)` CTA (`m06-ac09-submit-review-btn`), and synchronous `try/catch` error handling inside `handleSafeUpdate` so fail-closed rejections surface cleanly in `m06-ac09-action-error`.
- **Adversarial Test Coverage (`src/engine/simulation/ac09-physical-validation.test.ts`):** Added `AC09-SEC-01` through `AC09-SEC-16` (15 adversarial security tests closing all 5 loopholes + 1 armscye nominal POM regression test) and removed legacy single-reading/direct-sign-off shortcuts from `ac09-physical-validation.test.ts` and `simulation-fit-optimization.test.ts`.

### 7.2 `§3` (P0) — Timestamp-Free Deterministic Production-Package Digest (`src/engine/production/production-engineering.ts`)
- Excluded wall-clock `generatedAt` and wall-clock grading timestamps from `buildCanonicalProductionPackagePayload` while preserving `generatedAt` as external report metadata on `M05ProductionPackageBundle`.
- Verified via `P1-2-REM-01` that independent Bodice and Skirt bundle builds separated across wall-clock milliseconds produce distinct `generatedAt` metadata yet **bit-identical** `canonicalContentDigest` and `reportSha256Hex`.

### 7.3 `§4` (P1) — Single Authoritative Grading-Artifact Ownership (`production-engineering.ts` & `production-workspace-bundle.ts`)
- Removed the duplicate, divergent `createAuthoritativeGradingArtifact` construction and silent `catch` block from `src/engine/production/production-workspace-bundle.ts`.
- Constructed `AuthoritativeGradingArtifact` once inside `buildM05ProductionPackage`, exposed both `gradingArtifact` and `gradingArtifactError` on `M05ProductionPackageBundle`, aligned `computeMeasurementFingerprint` with `computeArtifactInputFingerprint` in `dependency-invalidation.ts`, failed closed on grading artifact errors (`GRADING_VALIDATION_FAILED`), and guaranteed no bodice grading artifact is ever generated for `skirt`.
- Verified via `P1-2-REM-02`.

### 7.4 `§5` (P1) — Real Upstream Staleness Propagation (`App.tsx`, `production-engineering.ts`, `production-workspace-bundle.ts`, `Header.tsx`, `ProductionPackagePanel.tsx`)
- Wired committed per-garment `previousPackageRevision` baselines in `src/App.tsx` (`committedBaselinesByGarment`) into `buildAuthoritativeProductionWorkspaceBundle`.
- Extended `upstreamRevisionTracking` to detect changes across all 7 upstream dimensions: specification fingerprint, measurement fingerprint, base pattern fingerprint, pattern revision ID, grading/governance controls fingerprint, grading report fingerprint, and BOM fingerprint.
- Blocked stale export fail-closed (`exportValidation.isExportPermitted = false`, `rejectionCode: 'UPSTREAM_STAGE_STALE'`, DXF-AAMA button disabled as `DXF Blocked (Stale)`).
- Distinguished `Package Stale` (`data-testid="header-package-stale-badge"`, red — strictly bound to `upstreamStaleness.isStaleAgainstPrevious`) from `Approval Pending` (`data-testid="header-approval-pending-badge"`, amber) so initial fresh load never shows a false-positive stale badge.
- Added `m05-upstream-staleness-banner` and `Re-Sync Package Baseline` (`m05-resync-baseline-btn`) to commit updated baselines intentionally.
- Verified via `P1-2-REM-03` and live Chromium testing.

### 7.5 `§6` (P1) — Module 05 State Consistency, Skirt Prototype Isolation & Spec-Switch Reset (`ProductionOverview.tsx`, `App.tsx`)
- `ProductionOverview.tsx` now reads `workspaceBundle.governance.sleeveEaseStrategy` directly (`data-testid="m05-adapted-sleeve-ease"`), eliminating stale `currentSpec.sleeveEaseStrategy ?? 'classic'` reads.
- `MOCK_CONFORMING_PROTOTYPE_BODICE_M` is strictly isolated to `isBodiceCategory`; `skirt` renders `m05-skirt-sleeve-na` and `m05-skirt-prototype-isolation-card` without evaluating bodice prototype fixtures.
- Fixed `handleUpdateSpec` in `src/App.tsx` so switching garment specifications resets optional `bodiceDartStyle` and `sleeveEaseStrategy` instead of retaining the previous garment's optional controls.
- Verified via `P1-2-REM-04` and live Chromium testing (`+2.43 cm` -> `+0.54 cm` live update on Bodice strategy switch).

### 7.6 `§7` (P0) — Armscye Nominal POM Discrepancy (`physical-validation.ts`, `PatternWorkspace.tsx`, `SimulationFitPanel.tsx`)
- Added `resolveNominalBodiceArmscyeSeamCm` in `src/engine/simulation/physical-validation.ts` deriving `pom-scye-circ` strictly from the bodice armhole stitching perimeter (`L_bf + L_bb` = **`36.79 cm`** for Size M) via `assemblyResult.ease.totalBodiceArmholeLengthCm`, with deterministic drafted piece segment fallback (`fb-armhole` + `bb-armhole` via `seg.lengthCm()`), rather than torso chest girth (`86.40 cm`) or un-eased sleeve cap length (`40.05 cm`).
- Wired `assemblyResult`, `pieces`, and `liveSnapshot?.revisionId` from `PatternWorkspace.tsx` -> `SimulationFitPanel.tsx` -> `createPendingAc09ToileRecord`.
- Verified via `AC09-SEC-16` and live Chromium browser inspection (`36.79 cm` rendered in `m06-ac09-pom-nominal-pom-scye-circ`).

---

## 8. Separately Tracked Simulation & Optimization Findings (`§9` — Deferred Outside `P1-2`)

> **Strict Boundary Preserved:** Per Checkpoint 8 instructions, cloth constitutive math (`src/engine/simulation/material-constitutive.ts`, `cloth-solver.ts`, `fit-evaluator.ts`) and bounded optimizer objectives (`src/engine/simulation/bounded-optimizer.ts`) were **NOT** modified in `P1-2`. The following six findings from the independent audit are formally recorded as separately tracked future engineering work outside `P1-2`:

1. **High Fabric Strain Despite Positive Circumferential Ease:** The surrogate strain evaluation can report elevated/failing membrane strain even in regions where static circumferential ease is positive.
2. **Low / Zero Contact Pressure Alongside Structural Strain Failure:** Contact pressure fields can read near `0 kPa` in zones simultaneously flagged for structural tensile strain failure due to decoupled clearance-vs-tension formulations.
3. **Shared / Colliding Pareto Proposal Revision IDs:** Candidate proposals emitted by bounded optimization can collide on generated child revision identifiers unless disambiguated per Pareto candidate index/hash.
4. **Pareto Candidate Trade-Off Transparency:** Multi-objective proposals can improve one regional fit metric while degrading another; trade-off delta reporting should be surfaced explicitly per objective in future M06 refinement.
5. **Static Bending-Energy Approximation:** Current cloth bending formulation uses a simplified static curvature/bending approximation rather than a full nonlinear shell bending energy solver.
6. **Clearance-Based Ease Approximation vs. Full Contact-Coupled Drape:** Regional fit ease relies on geometric clearance/offset approximation rather than full dynamic frictional body-cloth contact equilibrium.

---

## 9. Revision 2 Reproducible Verification & Archived Evidence Manifest (`docs/evidence/p1_2_remediation/`)

All checks below were executed **after the final source modification** inside `/app/applet`:

| Verification Check | Observed Result | Archived Evidence Artifact |
| :--- | :--- | :--- |
| **TypeScript Type Check (`npx tsc --noEmit`)** | **PASS (`0` errors, exit `0`)** | `docs/evidence/p1_2_remediation/tsc-output.log` |
| **Lint Check (`npm run lint`)** | **PASS (`0` errors, exit `0`)** | `docs/evidence/p1_2_remediation/lint-output.log` |
| **Production Build (`npm run build`)** | **PASS (`0` errors, exit `0`)** | `docs/evidence/p1_2_remediation/build-output.log` |
| **Full Automated Test Suite (`npm test`)** | **PASS — `882/882` tests across `184` suites (`0` fail, `0` cancelled, `0` skipped; `91,064.30 ms`)** | `docs/evidence/p1_2_remediation/test-transcript.log` |
| **Live Browser Verification (Headless Chromium via `playwright-cli`, `1440x900` Desktop + `768x1024` Tablet)** | **PASS — `30/30` assertions passed, `0` console errors, `0` page errors** | `docs/evidence/p1_2_remediation/browser-verification.log` + 11 PNG screenshots |
| **Cryptographic Evidence Manifest** | **16 archived artifacts hashed (SHA-256)** | `docs/evidence/p1_2_remediation/SHA256_MANIFEST.txt` |

### SHA-256 Checksum Manifest (`docs/evidence/p1_2_remediation/SHA256_MANIFEST.txt`)

| SHA-256 Digest | Archived Artifact Path |
| :--- | :--- |
| `41241bbc40a57b67efabe0855aedd3ab3f33ee76095b62f0cebf3030ca84a6ca` | `docs/evidence/p1_2_remediation/browser-verification.log` |
| `02b329286e4dc29c86a80674196c0308a88a12ef9a26c371a79e5db5553c27f9` | `docs/evidence/p1_2_remediation/build-output.log` |
| `a6b21efd55cdba93c857a8b986c6aa67f41a33d644c5aa05f06a0a0ec4bcb73d` | `docs/evidence/p1_2_remediation/lint-output.log` |
| `6b5c623fb029e89145d2fbd86f10058ea17ce2650a147af1f296d3c7bf75e33c` | `docs/evidence/p1_2_remediation/test-transcript.log` |
| `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `docs/evidence/p1_2_remediation/tsc-output.log` |
| `cffd514419ac21ad64892371ff19b0fb49e620bace480b5429e9a51630154af9` | `docs/evidence/p1_2_remediation/screenshots/01_desktop_skirt_m04_production.png` |
| `08a676aa0876ce3f877150a05f9f53c31d4a20367b98644b8e2e1db217eb9d5d` | `docs/evidence/p1_2_remediation/screenshots/02_desktop_skirt_m05_overview.png` |
| `3f719c495ed5d1f4cda6d4af3119987612cc9d77d1a100b522e4bcf6de205fb3` | `docs/evidence/p1_2_remediation/screenshots/03_desktop_skirt_m05_isolation.png` |
| `bb9395b2d52fcea71fe45edde10bfd4d9721db5c303e85f9cc5ed2df339bfa59` | `docs/evidence/p1_2_remediation/screenshots/04_desktop_skirt_m05_bom_stale.png` |
| `7e573abe693e4e4df154f205bd1bea3bebd5314534ea09506e8e059138395fb7` | `docs/evidence/p1_2_remediation/screenshots/05_desktop_skirt_m04_resynced.png` |
| `849d2c7ef45d42d0a5bfb6c7556d149cc65d09053fc58f435f9d47195f1d72d5` | `docs/evidence/p1_2_remediation/screenshots/06_desktop_bodice_m05_classic.png` |
| `4743cc06c0fc96ee9f56b9006b3c99cef39af41372bfdeed1e593bd08a700ba2` | `docs/evidence/p1_2_remediation/screenshots/07_desktop_bodice_m05_strategy_updated.png` |
| `18d39bdaece0b26f114616797f61f3700dbf590b0dcf8dd557bd9dd4e4f06b34` | `docs/evidence/p1_2_remediation/screenshots/08_desktop_bodice_ac09_remediated.png` |
| `701d66716eb0485b4dbbf09688bf51a70cfe391d652380d2d1d6d4390ba1ae70` | `docs/evidence/p1_2_remediation/screenshots/09_tablet_bodice_m04_ac09.png` |
| `a9103ce62e7ed620694d2753f895626290d0a2fa42c2da5673a916ec3f594207` | `docs/evidence/p1_2_remediation/screenshots/10_tablet_bodice_m05_overview.png` |
| `0883c6ebdb6336cb9f75771ad8f60e29a821776889b40258517a404a8ddc1eaa` | `docs/evidence/p1_2_remediation/screenshots/11_tablet_skirt_m05_overview.png` |

---

## 10. Authorization & Next-Step Posture

- **P1-2 Remediation Status:** Implementation and verification complete; **pending a fresh read-only independent acceptance audit**.
- **`P1-3` Status:** **NOT STARTED and NOT AUTHORIZED** until the fresh independent read-only audit accepts `P1-2`.
- **Protected Governance Gates (Unchanged):** `M00: NOT ACCEPTED`, `Gate Auth-2: CLOSED`, `Gate Auth-3: CLOSED`, `Gate Auth-4: CLOSED`, `DEC-13 Stage 2: CLOSED`, `AC-09: PENDING`, `isProductionReady: false`, `externalCadInteroperabilityVerified: false`.

