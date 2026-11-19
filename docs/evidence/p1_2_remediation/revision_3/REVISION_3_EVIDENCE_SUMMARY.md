# P1-2 Checkpoint 8 — Revision 3 Remediation Evidence Pack

**Scope:** Owner-authorized P1-2 Checkpoint 8 Revision 3 remediation (`N-01` through `N-07`)  
**Workspace:** `/app/applet` (Git not initialized; confirmed `test ! -d .git`)  
**Date:** 2026-11-19  
**Previous Independent Audit Verdict:** NOT ACCEPTED (Revision 2, 882/882 tests)  
**Revision 3 Verification Baseline:** **890/890 tests passing across 184 suites (0 fail)**, TypeScript clean, ESLint/typecheck clean, Vite production build clean, and **35/35 live headless Chromium assertions passing (0 page errors, 0 console errors)** across desktop (`1440×900`) and tablet (`768×1024`).

---

## 1. Governance & Safety Invariants Preserved

All authoritative roadmap constraints and fail-closed safety invariants remain strictly unchanged:

- **M00:** NOT ACCEPTED
- **Gate Auth-2:** CLOSED
- **Gate Auth-3:** CLOSED
- **Production Readiness:** `isProductionReady: false` preserved unconditionally
- **External CAD Interoperability:** `externalCadInteroperabilityVerified: false` preserved unconditionally
- **AC-09 Physical Validation:** Initializes strictly `PENDING` with zero fabricated physical toile measurements, zero fabricated photographic evidence, and zero fabricated reviewer seals
- **Roadmap Scope:** Bounded strictly to Revision 3 items `N-01`–`N-07`; no P1-3 implementation or roadmap modification performed; all previous evidence packs (`revision_1`, `revision_2`, prior audit documents) left intact and unmodified.

---

## 2. Itemized Remediation Traceability (`N-01` – `N-07`)

### N-01 — AC-09 Hem-Level Structural Tolerance Validation
- **Files Modified:**
  - `src/engine/simulation/simulation-types.ts`
  - `src/engine/simulation/physical-validation.ts`
  - `src/features/simulation/Ac09PhysicalValidationPanel.tsx`
  - `src/engine/simulation/ac09-physical-validation.test.ts` (`AC09-REV3-N01`)
- **Behavior Enforced:**
  - `validateAc09HemLevelDeviation(value, toleranceCm = 0.80)` enforces `hemLevelPhysicalDeviationCm` as a required unsigned physical deviation magnitude in `[0, policy.hemLevelToleranceCm]` (default `[0, 0.80]` cm).
  - Missing (`null`/`undefined`) → `INCOMPLETE` (`AC09_MISSING_HEM_DEVIATION`), blocking `READY_FOR_REVIEW` and `APPROVED_PASS`.
  - Negative, `NaN`, `±Infinity`, or non-numeric values → `FAILED` (`AC09_INVALID_HEM_DEVIATION`).
  - Values strictly greater than `0.80` cm → `FAILED` (`AC09_HEM_DEVIATION_EXCEEDS_TOLERANCE`).
  - Enforced uniformly across `transitionAc09WorkflowState`, `recordAc09ReviewerDecision`, and `evaluateAc09ToileRecord` in both `workflow` and `legacy` execution modes.
  - Exposed in UI via `data-testid="m06-ac09-hem-deviation-input"`.

### N-02 — AC-09 Seam Allowance Validation
- **Files Modified:**
  - `src/engine/simulation/simulation-types.ts`
  - `src/engine/simulation/physical-validation.ts`
  - `src/features/simulation/Ac09PhysicalValidationPanel.tsx`
  - `src/engine/simulation/ac09-physical-validation.test.ts` (`AC09-REV3-N02`)
- **Behavior Enforced:**
  - `validateAc09SeamAllowanceCm(value)` requires a finite numeric value strictly `> 0` cm.
  - Missing (`null`/`undefined`) → `INCOMPLETE` (`AC09_MISSING_SEAM_ALLOWANCE`).
  - `<= 0`, `NaN`, `±Infinity`, or non-numeric values → `FAILED` (`AC09_INVALID_SEAM_ALLOWANCE`).
  - Enforced across `registerAc09PhysicalSample`, `transitionAc09WorkflowState`, `recordAc09ReviewerDecision`, and `evaluateAc09ToileRecord` (`workflow` and `legacy` modes).
  - Exposed in UI via `data-testid="m06-ac09-seam-allowance-input"`.

### N-03 — Accurate Classification of Client-Side SHA-256 Integrity Seals
- **Files Modified:**
  - `src/engine/simulation/simulation-types.ts`
  - `src/engine/simulation/physical-validation.ts`
  - `src/features/simulation/Ac09PhysicalValidationPanel.tsx`
  - `src/engine/simulation/ac09-physical-validation.test.ts` (`AC09-REV3-N03`)
- **Behavior Enforced:**
  - Types, JSDoc comments, and `Ac09PhysicalValidationPanel.tsx` accurately describe `signatureDigest` and `lockedSnapshotDigest` as **unkeyed client-side SHA-256 tamper-evident integrity seals** that detect accidental or partial post-lock mutation.
  - Explicit UI disclosure (`data-testid="m06-ac09-seal-disclosure"`) states that role authorization checks the allowlist (`LEAD_PATTERNMAKER`, `QA_LEAD`, `ATELIER_TECH_DIRECTOR`) and **does not perform cryptographic reviewer identity authentication or defend against local digest recomputation**.
  - Removed misleading `"Signature Verified"` / `"SIGNED:"` wording; integrity seal badge (`data-testid="m06-ac09-integrity-seal-badge"`) renders only after a reviewer decision is recorded (count `0` on initial `PENDING` state).

### N-04 — Fail-Closed Production Export Gates & Guarded Baseline Synchronization
- **Files Modified:**
  - `src/engine/production/production-workspace-bundle.ts`
  - `src/features/production/ProductionPackagePanel.tsx`
  - `src/features/production/ProductionOverview.tsx`
  - `src/features/pattern-workspace/PatternWorkspace.tsx`
  - `src/App.tsx`
  - `src/engine/production/production-workspace-bundle.test.ts` (`P1-2-REV3-N04-01`, `P1-2-REV3-N04-02`)
- **Behavior Enforced:**
  - `evaluateProductionPackageExportGate` and direct guarded executors (`executeGuardedDxfReleaseExport`, `executeGuardedCanonicalReleaseJsonExport`) enforce fail-closed export eligibility both in UI disabled states (`m05-export-dxf-btn`, `m05-export-canonical-json-btn`, `handlePrint`) and inside handler execution paths.
  - Explicitly segregated non-release snapshot export via `buildDiagnosticProductionPackageJson` (`m05-export-diagnostic-json-btn`, `artifactClass: 'DIAGNOSTIC_NON_RELEASE_SNAPSHOT'`, `isApprovedProductionArtifact: false`).
  - Replaced permissive `Re-Sync Package Baseline` with explicit `evaluateBaselineCommitEligibility` / `executeGuardedBaselineCommit` driving two distinct controls:
    1. `Commit Production Baseline` (`m05-commit-baseline-btn`): enabled ONLY when validation passes AND governance/export approvals are satisfied.
    2. `Sync Working Draft Snapshot (Non-Approved)` (`m05-sync-working-draft-btn`): enabled ONLY when validation passes without blocking failures (blocked on failing packages such as Bodice Flat Gate 6 XXL), and syncing a working draft **never unlocks release exports**.

### N-05 — Skirt / Bodice Category Isolation in Module 05 Ease Table
- **Files Modified:**
  - `src/engine/production/production-workspace-bundle.ts` (`getApplicableEaseGirthsForCategory`)
  - `src/features/production/ProductionOverview.tsx` (`m05-ease-table`, `m05-ease-row-${girth}`)
  - `src/engine/production/production-workspace-bundle.test.ts` (`P1-2-REV3-N05` using `react-dom/server` `renderToStaticMarkup` across Skirt → Bodice → Skirt transitions)
- **Behavior Enforced:**
  - Skirt renders `Waist Circumference` (`waist`) and `Low Hip Circumference` (`lowHip`) exclusively — never `Bust Circumference`.
  - Bodice renders `Bust Circumference` (`bust`), `Waist Circumference` (`waist`), and `Low Hip Circumference` (`lowHip`).

### N-06 — AC-09 Input Hygiene, Uncertainty Documentation & Dual Digest Semantics
- **N-06.1 (ISO-8601 Calendar Date Validation):** `isValidAc09IsoDateOrTimestamp` validates `decidedAt`, `evaluatedAt`, `cutDate`, `sewnDate`, and `lockedAt`, rejecting empty strings, malformed tokens, and non-calendar dates such as `2026-02-30` and `2025-02-29` fail-closed.
- **N-06.2 (Fabric Numeric Hygiene):** `validateAc09FabricWeightGsm` (`> 0` finite) and `validateAc09FabricStretchPct` (`[0, 100]%` finite) distinguish missing (`null` → `INCOMPLETE`) from malformed supplied values (`NaN`, `±Infinity`, out-of-bounds, non-numeric → `FAILED`).
- **N-06.3 (Uncertainty Formula Accuracy):** JSDoc in `recomputeAc09PomMetrics` accurately documents the implemented conservative deterministic quadrature bound `sqrt((resolutionCm / 2)^2 + (spread / 2)^2)` and explicitly notes it is **not** an ISO GUM coverage-factor calculation.
- **N-06.4 (Dual SHA-256 Digest Semantics):** `M05ProductionPackageBundle` exposes both:
  - `canonicalContentDigest`: SHA-256 over the full canonical package including validation diagnostics and upstream staleness provenance (changes when staleness/validation state transitions).
  - `engineeringContentDigest`: SHA-256 over pure deterministic engineering inputs excluding session-relative staleness/validation wrappers (verified invariant across fresh vs stale → synced baseline histories, e.g. `99af8522638f6c190364d8cc0d5517f3275a1414946276d5d14bffdcdda426dd` in live Chromium).

### N-07 — Evidence Integrity & Revision 2 Errata Corrections
This Revision 3 evidence pack supersedes Revision 2 claims where prior documentation was imprecise, without deleting or altering prior archived files:
1. AC-09 SHA-256 digests are explicitly classified as **unkeyed client-side tamper-evident integrity seals**, never cryptographic reviewer identity signatures.
2. POM uncertainty is explicitly classified as a **conservative deterministic quadrature bound**, never an ISO GUM uncertainty budget.
3. All test counts, build outputs, and live Chromium assertions in this pack were freshly executed after the final source edit and archived verbatim below.

---

## 3. Automated & Live Browser Verification Results

| Gate | Command / Harness | Outcome | Verbatim Artifact |
| :--- | :--- | :--- | :--- |
| TypeScript Check | `npx tsc --noEmit` | PASS (0 errors) | `docs/evidence/p1_2_remediation/revision_3/typecheck.log` |
| Lint / Typecheck Script | `npm run lint` | PASS (0 errors) | `docs/evidence/p1_2_remediation/revision_3/lint.log` |
| Production Bundle Build | `npm run build` | PASS (`dist/` built cleanly in 969ms) | `docs/evidence/p1_2_remediation/revision_3/build.log` |
| Unit & Security Test Suite | `npm test` | **PASS (890/890 pass, 184 suites, 0 fail)** | `docs/evidence/p1_2_remediation/revision_3/test-suite.log` |
| Live Headless Chromium E2E | `playwright-cli` (`1440×900` + `768×1024`) | **PASS (35/35 assertions, 0 page errors, 0 console errors)** | `docs/evidence/p1_2_remediation/revision_3/browser-verification.log` |

### Archived Live Chromium Screenshots
- `docs/evidence/p1_2_remediation/revision_3/screenshots/rev3b-01-desktop-skirt-production.png` — Desktop `1440×900`: Stale unapproved Skirt showing disabled `Commit Production Baseline`, enabled `Sync Working Draft Snapshot (Non-Approved)`, gated DXF & Canonical Release JSON exports, enabled `Diagnostic JSON (Non-Release)`, `EXTERNALCADINTEROPERABILITYVERIFIED: FALSE`, and dual SHA-256 digests (`canonicalContentDigest` + `engineeringContentDigest`).
- `docs/evidence/p1_2_remediation/revision_3/screenshots/rev3b-02-desktop-bodice-gate6-blocked.png` — Desktop `1440×900`: Bodice (`Tailored bodice` + Flat sleeve ease) showing Gate 6 `FAIL (BLOCKING)` on size XXL, gated release exports, and enabled diagnostic snapshot export.
- `docs/evidence/p1_2_remediation/revision_3/screenshots/rev3b-03-desktop-ac09-panel.png` — Desktop `1440×900`: Module 04 Simulation → AC-09 panel showing `PENDING` status (zero fabricated seals), `Hem Δ (cm, 0-0.8)` input, and explicit `Client-Side Integrity Seal Notice` disclaiming cryptographic reviewer identity authentication.
- `docs/evidence/p1_2_remediation/revision_3/screenshots/rev3b-04-tablet-production-overview.png` — Tablet `768×1024`: Responsive Module 05 Production Overview layout verified with `scrollWidth (768) <= innerWidth (768)` (zero horizontal overflow).
