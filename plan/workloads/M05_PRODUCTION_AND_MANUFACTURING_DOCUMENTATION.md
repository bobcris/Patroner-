# WORKLOAD M05 — PRODUCTION SHEETS, TECH PACKS & MANUFACTURING DOCUMENTATION (`R2.1.1`)

## 1. Workload ID & Title
- **Workload ID:** `M05`
- **Title:** Piece Production Sheets, Complete Industrial Tech Packs, ISO 4915/4916 Seam Schedules, Operation Routing, `M02h`-Linked BOM, POM/QC & Cut-File Qualification
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase B/D (Production Engineering & Manufacturing Documentation)`
- **Authorization Gate (`Correction F`):** Governed by **`Gate Auth-2`** (`M00.10` + `ADR-009`, `DEC-09`, `DEC-11`, `DEC-13`).

## 2. Purpose & Architectural Role
`M05` transforms a validated, graded pattern family (`M02g`), a validated deterministic marker layout (`M02h`, `Correction 02`), and a calibrated material specification (`M03`) into a complete, factory-executable **Manufacturing Tech Pack and Cryptographically Signed Release Package** (`Dossier 14 v5.12`) inside `services/fashion-engine`. It ports and remediates `src/engine/production/piece-production-sheet.ts` (consuming `M02a`/`M02f` production geometry to close `DEF-M00-02` via tri-state complete-interval $[0, 1]$ Bernstein/interval verification `Corrections C, D, E`, closing `DEF-M00-03` via strict quantity key set equality, and closing `DEF-M00-04` via mandatory tenant binding), while adding **Construction Specifications, ISO 4915/4916 Seam & Stitch Schedules, Directed Acyclic Sewing Operation Routing (`OperationDAG`), `M02h`-Linked Bill of Materials (`BOM`), Geometrically Reconciled Points of Measure (`POM`) QC Tolerances, and Calibrated DXF-AAMA / 1:1 PDF Cut-File Exports**.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 07`, `Ch. 09`, `Ch. 11`, `Ch. 15 (Phase B/D)`, `App. A10`, `App. F`
- `Dossier 14 v5.12` (Manufacturing Constraints, Tech Packs & Production Release)
- Prior Milestone Audit Baseline: `M05.1` (Lifecycle & Provenance) and `M05.2.1-R2` (Piece Production Sheets — Phase E3 Audit Findings)
- `ADR-003` & `ADR-009` (`R2.1.1` Five-Concept Numerical Assurance, `Method C1` Downgrade, 6-Category Offset Failure Taxonomy & Tri-State Interval Verification)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-MFG-01`**: Hard `isProductionReady: false` Default Invariant until Physical Sample + Plotter Qualification
- **`REQ-MFG-02`**: Complete Industrial Tech Pack (Piece Sheets, ISO 4915/4916 Seam Schedule, Operation Routing DAG, `M02h`-Linked BOM, POM/QC, Calibrated DXF-AAMA/PDF Exports)
- **`REQ-GEO-01`**, **`REQ-GEO-02`** (Consumes `M02a`/`M02f` certified `Method C1-Cert/C2/C3` area/perimeter bounds & tri-state `CERTIFIED_VALID` complete-interval $t \in [0, 1]$ offset verification)
- **`REQ-SEC-01`**, **`REQ-WM-02`** (Mandatory tenant isolation & RFC 8785 SHA-256 + Ed25519 provenance)

## 5. Current Repository Baseline & Classification
- **Piece Production Sheet (`src/engine/production/piece-production-sheet.ts`)**: `P + X` — Generates per-piece per-size sheets with grainlines, notches, seam allowances, and SHA-256 digests while enforcing `isProductionReady: false`, but contains `DEF-M00-02` (3-point offset cusp bypass & `2%` short-span line bypass), `DEF-M00-03` (extra quantity keys & scalar/map conflict bypass), and `DEF-M00-04` (optional tenant check in builders), and is unmounted in the UI.
- **Industrial Tech Pack (ISO 4915/4916 Seam Schedule, Sewing Operation DAG, BOM, POM QC Table, DXF-AAMA Export)**: `M` (Missing — `0%` implemented).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
1. **`DEF-M00-02` Closure (`Corrections C, D, E`):** Replace 3-point (`0, 0.5, 1`) offset segment sampling in `piece-production-sheet.ts` by delegating offset verification to `M02f`'s complete parameter-interval ($t \in [0, 1]$) Bernstein polynomial + `mpmath.iv` interval verifier (`Method C3`, `ADR-009`), enforcing `verification_outcome == "CERTIFIED_VALID"`, recording the 6-category `OffsetValidationRecord` (`REGULARITY_MARGIN_VIOLATION`, `ACTUAL_ZERO_SPEED_CUSP`, `TANGENT_REVERSAL`, `LOCAL_OFFSET_SELF_INTERSECTION`, `GLOBAL_CONTOUR_SELF_INTERSECTION`, `INCONCLUSIVE_VERIFICATION`), and enforcing $\ge 85\%$ primary segment projection span (banning `2%`-span straight line substitutions on curved contours).
2. **`DEF-M00-03` Closure:** Enforce strict set equality $\text{keys}(\texttt{quantity\_by\_size}) \equiv \text{set}(\texttt{supported\_sizes})$ (rejecting any extraneous/unknown size keys with `GRADING_EXTRA_UNDECLARED_SIZE` / `QUANTITY_BASIS_INVALID`) and reject payloads that supply conflicting scalar `expected_quantity_per_piece` and `expected_quantities_by_size`.
3. **`DEF-M00-04` Closure:** Require non-empty `tenant_id` on both input artifacts (`grading_artifact.tenant_id`) and execution context in all builders and verifiers (`input.tenant_id == context.tenant_id`), failing closed with `CROSS_TENANT_MISMATCH` if either is missing.

## 7. Prerequisites & Upstream Dependencies (`Correction 02` & `Correction E`)
- Requires **`M01.5`** (Signed artifact storage), **`M02a`/`M02f`** (Authoritative production geometry & tri-state offset/seam/notch engine), **`M02g`** (Validated multi-size grading), **`M02h`** (Validated deterministic marker nesting & utilization — `Correction 02`), and **`M03`** (Material & seam compatibility rules).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/production/
├── piece_production_sheet.py # Ported & remediated piece-sheet builder + verifier consuming M02a/M02f (DEF-M00-02..04 closed)
├── seam_stitch_schedule.py   # ISO 4916 seam classes + ISO 4915 stitch classes + SPI + needle/thread spec
├── operation_routing.py      # Sewing Operation DAG, workcenter types, SAM (Standard Allowed Minutes)
├── bill_of_materials.py      # Consumes M02h ValidatedMarkerArtifact length + M03 shrinkage + trims/thread
├── pom_qc_specification.py   # Graded Points of Measure (POM) table with +/- tolerances & inspection protocol
├── exporters/
│   ├── dxf_aama_exporter.py  # ASTM D6673 / AAMA DXF exporter with 100.0mm x 100.0mm calibration square
│   └── pdf_plot_exporter.py  # 1:1 tiled/large-format PDF plot + human-readable Tech Pack PDF
└── release_package.py        # RFC 8785 SHA-256 Merkle manifest + Ed25519 signature verifier
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`PieceProductionSheetPackage`:**
   - `{ package_id, tenant_id, project_id, revision_id, garment_family, supported_sizes, quantity_by_size, sheets: PieceProductionSheet[], numerical_verification_records: NumericalVerificationRecord[], offset_validation_records: OffsetValidationRecord[], all_outcomes_certified_valid: true, package_sha256, is_production_ready: false }`
2. **`SeamAndStitchScheduleEntry` (`ISO 4915` / `ISO 4916`):**
   - `{ seam_id, joined_piece_edges: [EdgeRef, EdgeRef], iso_4916_seam_class: "SSa-1" | "SSn-1" | "LSa-1" | "EFa-1" | "EFb-1", iso_4915_stitch_class: "301_LOCKSTITCH" | "401_CHAINSTITCH" | "504_OVEREDGE_3THD" | "514_OVEREDGE_4THD", stitches_per_cm: float, needle_system_and_size: string, thread_ticket_tex: string, pressing_instruction: string }`
3. **`SewingOperationDAG`:**
   - `{ routing_id, operations: SewingOperationNode[], precedence_edges: [OpID, OpID][], total_sam_minutes: float, required_machine_classes: string[] }` (Verified acyclic).
4. **`BillOfMaterials (BOM)` (Linked to `M02h` Marker):**
   - `{ bom_id, validated_marker_id: UUID, size_breakdown_quantities, shell_fabric_lines: FabricBOMLine[], trim_and_notions_lines: TrimBOMLine[], thread_consumption_m_by_size: Map<SizeCode, float>, waste_allowance_pct: float }`
5. **`GradedPOMSpecification`:**
   - `{ pom_id, pom_code: string, pom_name: string, measurement_method_description: string, geometric_anchor_refs: [AnchorRef, AnchorRef], target_value_cm_by_size: Map<SizeCode, float>, tolerance_minus_cm: float, tolerance_plus_cm: float, criticality: "CRITICAL" | "MAJOR" | "MINOR" }`
6. **`ManufacturingTechPack` & `SignedManufacturingReleasePackage`:**
   - Aggregates `ValidatedMarkerArtifact` (`M02h`) + `PieceProductionSheetPackage` + `SeamAndStitchSchedule` + `SewingOperationDAG` + `BOM` + `GradedPOMSpecification` + `DXFAAMAArtifact` + `PDFPlotArtifact` + `CalibrationCertificate`.

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Mandatory 8-Stage Geometry-to-Tech-Pack Sequence (`Correction 02`) & Tri-State Gate (`Correction D`):**
   `M05` enforces that `PieceProductionSheetPackage` and `ManufacturingTechPack` cannot be built unless Stages 12.1–12.6 (`M02a`–`M02f` geometry with `verification_outcome == "CERTIFIED_VALID"` → `M02g` grading → `M03` material width/nap constraints → `M02h` marker preparation → `M02h` deterministic marker nesting → `M02h` independent non-overlap & utilization verification) have completed and produced a valid `ValidatedMarkerArtifact`. Any `CERTIFIED_INVALID` or `INCONCLUSIVE` record fails closed while preserving its exact `failure_category`.
2. **Strict Quantity Map Validation (`DEF-M00-03` Fix):**
   - Let $S = \text{set}(\texttt{graded\_family.supported\_sizes})$ and $K = \text{set}(\texttt{quantity\_by\_size.keys()})$.
   - Require $K \equiv S$ ($K \setminus S = \emptyset$ and $S \setminus K = \emptyset$), and $\forall s \in S: \texttt{quantity\_by\_size}[s] \in \mathbb{Z}_{\ge 1}$.
   - If both `expected_quantity_per_piece` and `expected_quantities_by_size` are supplied in verification options, require $\forall s \in S: \texttt{expected\_quantities\_by\_size}[s] == \texttt{expected\_quantity\_per\_piece}$; otherwise reject immediately with `QUANTITY_BASIS_INVALID`.
3. **Marker-Driven Fabric & Thread Consumption Formulas (`BOM`):**
   - Shell fabric linear consumption from `M02h` `ValidatedMarkerArtifact`:
     $$L_{\text{total\_shell}} = (1 + w_{\text{loss}}) \cdot L_{\text{marker}}(\mathbf{q}) \cdot \lambda_{\text{warp}}$$
   - Thread consumption per seam $e$ of certified length $L_e$ (`Method C1-Cert`):
     $$L_{\text{thread}, e} = (1 + w_{\text{thread}}) \cdot \gamma(\text{ISO\_4915\_class}, \text{thickness\_mm}) \cdot L_e$$
4. **POM Geometric Reconciliation Invariant:**
   - Every graded POM target value $P(S_k)$ is computed directly from `M02g` net sew contour anchors and verified to match the 2D piece geometry within $\le 0.05\text{ cm}$ (`DEC-11`), while physical QC inspection tolerances $\pm \tau_p$ ($\ge 0.20\text{ cm}$) govern shop-floor inspection in `M07.5`.
5. **DXF-AAMA (`ASTM D6673`) Layer Standard & Calibration Square:**
   - Embeds an authoritative $100.0\text{ mm} \times 100.0\text{ mm}$ ($10.0\text{ cm} \times 10.0\text{ cm}$) calibration square piece on every DXF and 1:1 PDF plot sheet (`AC-10`).

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/production/piece-sheets` → Builds and verifies `PieceProductionSheetPackage`.
- `POST /api/v1/production/tech-pack` → Consumes `M02h` `ValidatedMarkerArtifact` and `PieceProductionSheetPackage` to generate complete `ManufacturingTechPack`.
- `POST /api/v1/production/verify-package` → Runs independent cryptographic, 5-concept numerical enclosure (`Method C1-Cert/C2/C3`), tri-state offset, marker, quantity, and tenant verification.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Mandatory `tenant_id` equality check at builder entry, verifier entry, and artifact download (`DEF-M00-04` closed).
- `is_production_ready` is unconditionally `false` on all `M05` outputs until counter-signed in `M07.2` (`PhysicalSampleApprovalRecord` + `PlotterCalibrationCertificate` + `MakerQualificationMatch`) using Ed25519 signature verification (`DEC-09`).

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Production Engineering & Tech Pack Studio (Wires `ProductionOverview` to Python):**
  - Interactive Piece Production Sheet viewer with per-size selector, 5-concept `NumericalVerificationRecord` & tri-state `OffsetValidationRecord` inspector, and notch/grainline table,
  - Tabbed Tech Pack views: **Nested Marker Strip (`M02h`)**, **ISO Seam & Stitch Schedule**, **Sewing Operation Routing DAG**, **Graded BOM & Thread Calculator**, and **Graded POM QC Sheet**,
  - Signed Export Drawer for `DXF-AAMA` and `1:1 PDF Plot` with $100.0\text{ mm}$ calibration square checklist.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M05.1` — Remediated Piece Production Sheet Engine (Python Port):** Port `piece-production-sheet.ts` to Python, delegating geometry/offset verification to `M02a`/`M02f` (`Method C1-Cert/C2/C3` + tri-state 6-category offset verification) and closing `DEF-M00-02`, `DEF-M00-03`, `DEF-M00-04`, and `DEF-M00-05`.
2. **`M05.2` — ISO 4915/4916 Seam Schedule & Operation Routing DAG Generator.**
3. **`M05.3` — `M02h`-Linked Bill of Materials (BOM) & Graded POM Reconciliation Engine.**
4. **`M05.4` — Calibrated DXF-AAMA & 1:1 PDF Exporter.**
5. **`M05.5` — Independent Tech-Pack Verifier & Merkle Signer.**

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Preserves all 18 R1 and 34 R2 structural/provenance invariants from `m0521-piece-production-sheet.test.ts`, while replacing the defective numerical/cusp/quantity/tenant behaviors (`DEF-M00-02`–`05`) with Class B Normative expectations verified by the independent `M00.4` oracle harness.

## 16. Unit, Property & Adversarial Test Plan
- Reproduce all Phase E2/E3 adversarial vectors (`t=0.25` and $t=1/\pi$ interior cusps, regularity-margin-only violation, `2%` straight segment on curved contour, extraneous size key `XXXL: 99`, conflicting scalar vs. map quantities, omitted `expectedTenantId` with blank `tenantId`, and skirt grading) and verify 100% deterministic classification into the exact 6-category taxonomy and fail-closed rejection.
- Verify that an `INCONCLUSIVE` offset verification outcome blocks `PieceProductionSheetPackage` approval while recording `failure_category: "INCONCLUSIVE_VERIFICATION"` (never `ACTUAL_ZERO_SPEED_CUSP`).
- Missing `ValidatedMarkerArtifact` (`M02h`) when requesting `ManufacturingTechPack` → rejected.

## 17. Independent Verification Oracles
- Independent DXF-AAMA parser (`ezdxf` in isolated verification script) reading back exported `.dxf` files and verifying vertex-for-vertex arc length, closed loop topology, notch positions, and $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square dimensions within $\pm 0.01\text{ mm}$.

## 18. Physical, Manufacturing or Financial Validation Protocol
- Plot exported DXF/PDF on a physical large-format pattern plotter and flatbed cutter; measure the $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square and piece POMs with a calibrated steel rule (`±0.1 mm` requirement for `AC-10`).

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-03`**, **`AC-04`**, **`AC-05`**, **`AC-06`**, **`AC-10`** (Manufacturing & Cut-File Qualification), **`AC-11`** (Tenant isolation & provenance). Required for **Release Level A**.

## 20. Failure Modes, Rollback & Recovery Procedures
- Any discrepancy between 2D piece geometry, `M02h` marker quantities, BOM lines, or POM table values, or any `CERTIFIED_INVALID` / `INCONCLUSIVE` verification record, blocks tech-pack export and surfaces exact field-level diagnostic errors.

## 21. Observability, Audit Logging & Telemetry
- Logs package SHA-256 Merkle root, `M02h` marker digest, DXF/PDF file hashes, and verification outcome breakdown (`CERTIFIED_VALID`, `CERTIFIED_INVALID`, `INCONCLUSIVE`) in `AuditLogEntry`.

## 22. Explicit Non-Goals & Scope Guardrails
- `M05` never sets `is_production_ready = True` on its own; physical sample sign-off and workshop assignment in `M07` are mandatory prerequisites.

## 23. Downstream Unlocks
- Unlocks the **Vertical Slice Gate (`plan/08`)** and **`M07`** (Maker Network, Sample Approval & Shop-Floor Traceability).

## 24. Definition of Done Checklist
- [ ] `DEF-M00-02`, `DEF-M00-03`, `DEF-M00-04`, and `DEF-M00-05` verified closed by adversarial tests.
- [ ] Complete 8-stage `M02g` → `M03` → `M02h` → `M05` pipeline operational in Python.
- [ ] Five-concept `NumericalVerificationRecord` and 6-category tri-state `OffsetValidationRecord` persisted on every production sheet.
- [ ] DXF-AAMA and 1:1 PDF exports verified by independent `ezdxf` reader and physical $100.0\text{ mm}$ calibration check (`AC-10`).
- [ ] `is_production_ready: false` default enforced across all unapproved revisions.
