# Patroner — Milestone 05 Production Engineering Verification Evidence

**Workspace:** `/app/applet`
**Governance Posture:**
- `M00`: NOT ACCEPTED
- Protected Gates (`Gate Auth-2`, `Gate Auth-3`, `Gate Auth-4`, `DEC-13 Stage 2`): CLOSED
- `isProductionReady`: `false` strictly enforced across all M05 packages, BOM reports, manufacturing docs, DXF exports, and validation diagnostics
- `externalCadInteroperabilityVerified`: `false` (DXF-AAMA verification is internal synthetic round-trip only; external Gerber/Lectra/Optitex/CLO3D interoperability remains unverified)
- Planning documents under `plan/` preserved untouched.

---

## 1. Summary of Engineering Work Delivered

### Workstream A & D — Production Pattern Specifications & Multi-Size Package Orchestrator (`src/engine/production/production-engineering.ts`, `production-engineering-types.ts`, `index.ts`)
- Implemented `buildM05ProductionPackage`, `buildCanonicalProductionPackagePayload`, and `serializeDeterministicProductionBundle`.
- Connects deterministic Bodice + Sleeve drafting, M04.3 Bodice–Sleeve Assembly, M04.4 `gradePattern` (`XS–XXL` for bodice; explicit single-size policy for skirt), M05.1 `createProductionPatternRevision` + `validatePatternRevision`, and M05.2.1 `createAuthoritativeGradingArtifact` + `buildAuthoritativePieceProductionSheetSet`.
- Enforces dynamic cut semantics (`single-centered-on-fold` with explicit fold segment ID for fold pieces; `paired-mirrored-left-right` with confirmed mirroring for cut-2 panels; `single-asymmetric` / `multiple-identical`).
- Tracks upstream specification, body measurement, base pattern, and grading SHA-256 fingerprints (`upstreamRevisionTracking`), detecting upstream staleness (`isStaleAgainstPrevious`, `staleReasons`).
- Computes FIPS 180-4 SHA-256 digest over canonical UTF-8 JSON (`canonicalContentDigest`, `reportSha256Hex`, `canonicalJsonByteLength`) via `digestCanonicalPayload`, rejecting `{}` (`44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`).

### Workstream B — Feature-Traced Manufacturing Documentation (`src/engine/production/manufacturing-docs.ts`)
- Implemented `generateManufacturingDocumentation` and `verifyManufacturingDocumentationCompleteness`.
- Generates piece cutting instructions, ISO 4915 sewing operation sequences (`ISO 301` woven vs `ISO 401` stretch), stitch-class-mapped seam construction specifications, notch alignment instructions (single/double/scye vs general tolerances), pressing/finishing rules (<= `3.0 cm` hem fold check), and QC checkpoints (`<= 0.05 cm` CAD, `<= 0.20 cm` sewn garment tolerance).
- Strictly traces every operation and trim note to drafted pieces, seams, darts, or declared `designSpec.constructionFeatures`; never invents phantom zippers/hardware when omitted and never injects sleeve/shoulder steps into Skirt docs.

### Workstream C — Deterministic Geometry-Driven Bill of Materials (`src/engine/production/bom-engine.ts`)
- Implemented `computePieceContourAreaCm2`, `computePieceStitchingPerimeterCm`, `getEffectivePhysicalPanelMultiplier`, and `computeProductionBom`.
- Uses cutting-contour polygon area with explicit `2x` unfolded width multiplier for `onFold` pieces and cut count for paired panels, converted to linear meters across configurable bolt width (`fabricRollWidthCm`), selvedge margin, and marker waste buffer (`markerWasteFactor`).
- Separates basis taxonomy (`'calculated'`, `'configured-allowance'`, `'estimated'`, `'user-entered'`), derives thread consumption from total stitching perimeter + lockstitch ratio, interfacing along curved stay-lines (`neck`/`armhole`/`waist`/`hem`), optional lining/packaging, and multi-size order scaling (`orderQuantitiesBySize`).

### Workstream E — Enhanced DXF-AAMA (AC1009) Export & Full-Feature Round-Trip (`src/engine/production/dxf-aama-exporter.ts`)
- Extended `exportPatternPiecesToDxfAama` and `verifyDxfAamaRoundTrip` with optional `sourceRevisionId`, `sourceContentFingerprint`, `sizeCode` metadata `TEXT` entities, polyline group `70` closure flags, and full feature checks (`cutPolylines`, `sewPolylines`, `grainLines`, `notchLines`, `drillPoints`, `internalPolylines`, `pieceLabels`, `$ACADVER=AC1009`, `$INSUNITS=5`) within `<= 0.001 cm`.

### Workstream F — Deterministic 10-Gate Production Validator (`src/engine/production/production-validator.ts`)
- Implemented `evaluateProductionReadiness` checking all 10 deterministic gates:
  1. `missing-pattern-pieces`
  2. `invalid-contours`
  3. `incomplete-seam-allowances`
  4. `missing-grainlines`
  5. `inconsistent-piece-metadata`
  6. `invalid-size-coverage`
  7. `unresolved-measurement-approvals` (advisory warning by default unless `requireApprovedGovernance: true`, failing closed on `standard-chart` / unverified measurements or unapproved specification when governance is required)
  8. `missing-material-specs`
  9. `incomplete-manufacturing-docs`
  10. `invalid-or-stale-revision`

### Workstream G — CAD & Module 05 UI Integration (`src/App.tsx`, `src/features/pattern-workspace/PatternWorkspace.tsx`, `src/features/production/ProductionPackagePanel.tsx`, `src/features/production/ProductionOverview.tsx`, `src/components/ui/Badge.tsx`)
- Added `Production Package (M 05)` view mode in Pattern CAD across both Bodice (`XS–XXL`) and Skirt (`single-size`).
- Replaced static fabric yield formulas, hardcoded YKK zipper assumptions, static allowance blocks, and static assembly arrays in `ProductionOverview.tsx` with live `buildM05ProductionPackage` outputs and dynamic CAD seam allowance role summaries.
- Built `ProductionPackagePanel.tsx` with interactive BOM controls, 10-gate diagnostic cards, per-size matrix, feature-traced manufacturing documentation, DXF-AAMA round-trip telemetry, file downloads (`.dxf` and `.canonical.json`), and expandable canonical JSON + live SHA-256 verification.

---

## 2. Verification Summary

- **New & Extended Unit Test Suites:**
  - `src/engine/production/bom-engine.test.ts` (3/3 pass)
  - `src/engine/production/manufacturing-docs.test.ts` (3/3 pass)
  - `src/engine/production/production-engineering.test.ts` (5/5 pass)
  - `src/engine/production/dxf-aama-exporter.test.ts` & `src/engine/production/m0521-piece-production-sheet.test.ts` verified passing without regressions.
- **Full Repository Regression (`npx tsc --noEmit && npm test`):**
  - Passed cleanly (zero TypeScript errors; all discovered `*.test.ts` suites under `src/` passing).
- **Build & Lint (`compile_applet`, `lint_applet`):**
  - Clean Vite production build and TypeScript ESLint/typecheck.
- **Headless Chromium Verification (`http://localhost:3000`, `1440x900`):**
  - Zero runtime browser console errors.
  - Verified Skirt M05 mode in `4. Pattern CAD`: displays `9/10 GATES` (advisory governance warning on unverified `standard-chart` measurements, 0 blocking errors), `Pieces: 2 | Physical Panels/Garment: 3 | Sheets: 2`, and zero bodice/sleeve sewing operations in Skirt manufacturing docs.
  - Verified Bodice M05 flow after recording `physically-measured` operator evidence and approving measurements in Module 03: transitions cleanly to `2D PACKAGE VERIFIED (10/10)` with `ISPRODUCTIONREADY: FALSE`, `Sheets: 18`, DXF synthetic round-trip `231/231` cut vertices, `220/220` sew vertices, `3/3 GL`, `3/3 TXT`, `12/12 Notch`, `3/3 Drill`, `Max Round-Trip Δ 0.000000 cm`, and `EXTERNALCADINTEROPERABILITYVERIFIED: FALSE`.
  - Verified live DOM WebCrypto `crypto.subtle.digest('SHA-256', ...)` matches displayed `m05-canonical-digest` byte-for-byte (`a35bda098d1302beeea9fa861cc0c2b99e9721a75a1fda7035361eef0d87cd9b` across `26,057` UTF-8 bytes).
  - Verified `5. Production` renders live engine BOM yields, traced hardware/trims, distinct CAD seam allowance schedule (`FRONT WAIST`, `FRONT SIDE SEAM`, `FRONT ARMHOLE`, `FRONT SHOULDER`, `FRONT NECKLINE`, `CENTER BACK SEAM`), and ISO 4915 sewing operations.

---

## 3. Known Repository Boundaries (Strictly Preserved)

1. **`src/engine/drafting/trouser-block.ts` absent:** Trouser category remains specification-only (`SPECS ONLY`); M05 does not fabricate trouser pattern pieces or fake production packages for missing drafters.
2. **Skirt Multi-Size Grading (`XS–XXL`) absent:** Skirt M05 uses honest explicit single-size scope unless multi-size `requiredSizes` are demanded (in which case Gate 6 `invalid-size-coverage` fails closed).
3. **External Third-Party CAM Interoperability:** `externalCadInteroperabilityVerified` remains strictly `false` pending external CAD/CAM import testing outside Patroner.
