# Patroner — Milestone 04.3 & 04.4 Reconciliation & Verification Evidence

**Workspace:** `/app/applet`
**Governance Posture:**
- `M00`: NOT ACCEPTED
- Protected Gates (`Gate Auth-2`, `Gate Auth-3`, `Gate Auth-4`, `DEC-13 Stage 2`): CLOSED
- `isProductionReady`: `false` strictly enforced across all assembly, grading, and UI reports
- Planning documents under `plan/` preserved untouched.

---

## 1. Summary of Engineering Work Delivered

### Milestone 04.3 — Integrated Bodice–Sleeve Assembly (Direct `/app/applet` Integration)

1. **Deterministic Canonical SHA-256 Digest (`src/engine/assembly/sha256.ts`, `src/engine/assembly/index.ts`)**
   - Implemented pure TypeScript FIPS 180-4 SHA-256 over UTF-8 canonical JSON (`encodeUtf8`, `canonicalizeAssemblyJson`, `digestCanonicalPayload`, `sha256Hex`).
   - Enforces non-empty canonical payload serialization, failing closed if canonical serialization collapses to `{}` (`44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`).
   - Browser `crypto.subtle.digest('SHA-256', ...)` parity verified end-to-end in Chromium (`3522172e86911999ba144e8b0b4a866e9f1473e7f97bfea4f17ae2d78d841998` over `30411` canonical UTF-8 bytes for active draft).

2. **Assembly Validator & Physical Geometry Verification (`src/engine/assembly/assembly-types.ts`, `src/engine/assembly/assembly-validator.ts`)**
   - Added `formatSignedCm` so negative ease renders cleanly (`-1.83 cm`) instead of `+-1.83 cm`.
   - Added independent Front, Back, and Total seam compatibility evaluation (`evaluateSeamCompatibilityBreakdown`) separating physical feasibility (`isNonNegative`, `totalEase <= maxTotalEaseCm`) from strategy target residual (`residualCm`).
   - Implemented closed-form / interval uncertainty propagation and strict uncertainty gate (`evaluateUncertaintyGate`, `strictUncertaintyGate`).
   - Implemented endpoint orientation, notch pairing, pre-sort back double-notch ordering (`evaluateAssemblyNotches`), elbow notch placement/parity (`elbowBackPos` contour fix in `src/engine/drafting/sleeve-block.ts`), winding/closure/continuity/self-intersection validation (`evaluateAssemblyCurveContinuityAndGeometry`), and measurement provenance & governance checks (`evaluateAssemblyGovernance`).

3. **Rigid Transformation, Clone Preservation & Assembly Engine (`src/engine/assembly/bodice-sleeve-assembly.ts`)**
   - `createTransformedPiece` preserves and transforms `drillHoles` and normalizes notch angles via `normalizeAngleDeg`.
   - `deepClonePiece` clones `grainline` (with valid `GrainLine` fallback), `drillHoles`, `cuttingContour`, and `offsetResult`.
   - `buildAssemblyInspectionLayout` computes unrounded rigid translations, non-overlapping `backOffsetX`, 16-corner `layoutBoundingBox`, and `rigidVerification` tolerances.
   - `assembleBodiceSleeve` enforces physical ease bounds, governance gating when `requireApprovedGovernance` is active, and deterministic canonical report digest population across normal and incomplete/missing-data failure paths.

4. **CAD UI Integration (`src/App.tsx`, `src/features/pattern-workspace/AssemblyInspectionPanel.tsx`, `src/features/pattern-workspace/PatternWorkspace.tsx`)**
   - Wired `measurementProvenance` and `measurementApprovalState` from `App.tsx` into `PatternWorkspace`.
   - Added `AssemblyInspectionPanel` displaying `isProductionReady: false`, active vs `incompatible-xs-flat` test scenarios, policy toggles (`requireApprovedGovernance`, `strictUncertaintyGate`), independent Front/Back/Total ease breakdown via `formatSignedCm`, uncertainty telemetry, notch/elbow/contour checks, governance & provenance status, and expandable canonical JSON + SHA-256 digest verification.
   - Replaced silent `catch` blocks with surfaced `assemblyError` feedback and fixed `[BACK ASSEMBLY: SCYE MATCH]` x-offset and signed label formatting in SVG HUD/annotations.

---

### Milestone 04.4 — Graded Multi-Size Integrity & Reconciliation

1. **Propagated Assembly Guarantees Across XS–XXL (`src/engine/grading/grading-types.ts`, `src/engine/grading/assembly-grade-validator.ts`, `src/engine/grading/pattern-grader.ts`)**
   - Extended `GradingOptions` with `strictUncertaintyGate`, `measurementProvenance`, `measurementApprovalState`, and `requireApprovedGovernance`.
   - Upgraded `assembly-grade-validator.ts` to enforce per-size `seamCompatibility`, `uncertaintyGate`, `contourIntegrity`, governance approval when required, pre-sort back double-notch order checks (`preSortSleeveOrderValid`, `preSortBodiceOrderValid`), and `elbowPairParity` (`<= 0.15 cm`), producing explicit `governanceStatus`.
   - Upgraded `pattern-grader.ts` to forward `bezierToleranceCm`, `strictUncertaintyGate`, and provenance/governance options into `assembleBodiceSleeve`, and added deterministic `buildCanonicalGradingReportPayload` + `serializeDeterministicGradingReport` with SHA-256 digest fields (`canonicalContentDigest`, `reportSha256Hex`, `canonicalJsonByteLength`) on `GradedPatternSet`.

2. **Grading Nest UI & Viewport Refinement (`src/features/pattern-workspace/PatternWorkspace.tsx`)**
   - Forwarded governance and strict uncertainty options into `gradePattern` and displayed the canonical grading SHA-256 digest (`data-testid="grading-canonical-digest"`) and byte length in the M04.4 panel.
   - Adjusted initial canvas viewport (`zoom = 1.0`, `pan = { x: 0, y: 0 }`) and separated the Grading Nest Overlay Sleeve Block X offset (`465`) so headers and XS–XXL nested pieces display without clipping or horizontal piece overlap.

---

## 2. Verification Summary

- **Dedicated M04.3 & M04.4 Test Suites Added:**
  - `src/engine/assembly/m043-assembly-verification.test.ts`
  - `src/engine/grading/m044-grading-reconciliation.test.ts`
- **Build & Type Check (`npm run build` / `npx tsc --noEmit`):** Verified clean zero-error compilation and typecheck.
- **Full Repository Test Suite (`npm test`):** Verified all discovered `*.test.ts` suites under `src/` pass without regressions.
- **Headless Chromium Verification (`http://localhost:3000`, `1440x900`):**
  - Verified zero browser console errors on startup and across module transitions.
  - Verified live DOM WebCrypto `crypto.subtle.digest('SHA-256', ...)` matches displayed `assembly-canonical-digest` (`3522172e86911999ba144e8b0b4a866e9f1473e7f97bfea4f17ae2d78d841998`, `30411` bytes).
  - Verified fail-closed governance blocking under `standard-chart` / `unverified` and transition to `VERIFIED-VALID` after recording `physically-measured` operator evidence and approving measurements in Module 03 (while keeping `isProductionReady: false`).
  - Verified `incompatible-xs-flat` negative ease fails closed cleanly (`INVALID`) and renders with single `-` signs (no `+-`).
  - Verified M04.4 Grading Nest Overlay renders all 6 XS–XXL nests (`ALL VALID (6/6)`) with non-empty canonical SHA-256 (`e99acc9947a3d610c0220ed602a058431960efc0f0c3c92a77482de86a050b7a`) and clean SVG viewport spacing.
