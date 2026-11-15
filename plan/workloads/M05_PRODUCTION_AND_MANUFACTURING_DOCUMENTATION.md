# WORKLOAD M05 — PRODUCTION SHEETS, TECH PACKS & MANUFACTURING DOCUMENTATION

## 1. Workload ID & Title
- **Workload ID:** `M05`
- **Title:** Piece Production Sheets, Complete Industrial Tech Packs, ISO 4915/4916 Seam Schedules, Operation Routing, BOM, POM/QC & Cut-File Qualification
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase D (Production Engineering & Manufacturing Documentation)`

## 2. Purpose & Architectural Role
`M05` transforms a graded, validated pattern family (`M02g`) and calibrated material specification (`M03`) into a complete, factory-executable **Manufacturing Tech Pack and Cryptographically Signed Release Package** (`Dossier 14 v5.12`) inside `services/fashion-engine`. It ports and remediates `src/engine/production/piece-production-sheet.ts` (closing `DEF-M00-02`, `DEF-M00-03`, and `DEF-M00-04`), while adding the missing industrial specifications required by workshops: **Construction Specification, ISO 4915/4916 Seam & Stitch Schedule, Directed Acyclic Sewing Operation Routing (`OperationDAG`), Bill of Materials (`BOM`), Points of Measure (`POM`) QC Tolerances, and Calibrated DXF-AAMA / PDF Cut-File Exports**.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 07`, `Ch. 09`, `Ch. 11`, `Ch. 15 (Phase D)`, `App. F`
- `Dossier 14 v5.12` (Production Engineering, Tech Packs & Manufacturing Execution)
- Prior Milestone Audit Baseline: `M05.1` (Lifecycle & Provenance) and `M05.2.1-R2` (Piece Production Sheets — Phase E3 Audit Findings)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-MFG-01`**: Hard `isProductionReady: false` Default Invariant until Physical Sample + Plotter Qualification
- **`REQ-MFG-02`**: Complete Industrial Tech Pack (Piece Sheets, ISO 4915/4916 Seam Schedule, Operation Routing DAG, BOM, POM/QC, Calibrated DXF-AAMA/PDF Exports)
- **`REQ-GEO-01`**, **`REQ-GEO-02`** (Exact area/perimeter bounds & continuous offset cusp rejection)
- **`REQ-SEC-01`**, **`REQ-WM-02`** (Mandatory tenant isolation & RFC 8785 SHA-256 + Ed25519 provenance)

## 5. Current Repository Baseline & Classification
- **Piece Production Sheet (`src/engine/production/piece-production-sheet.ts`)**: `I2` (Partial) / `R` (Risk) — Generates per-piece per-size sheets with grainlines, notches, seam allowances, and SHA-256 digests while enforcing `isProductionReady: false`, but contains `DEF-M00-02` (interior cusp bypass), `DEF-M00-03` (extra quantity keys & scalar/map conflict bypass), and `DEF-M00-04` (optional tenant check in builders), and works only on bodice (`DEF-M00-05`).
- **Industrial Tech Pack (ISO 4915/4916 Seam Schedule, Sewing Operation DAG, BOM, POM QC Table, DXF-AAMA Export)**: `M` (Missing) — `0%` implemented in the repository.

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
1. **`DEF-M00-02` Closure:** Replace 3-point (`0, 0.5, 1`) offset segment sampling with `M02f` 65-point Gauss–Lobatto + analytical curvature extrema verification and ban `2%`-span straight line-to-line segments on curved primary cutting contours.
2. **`DEF-M00-03` Closure:** Enforce strict set equality $\text{keys}(\texttt{quantity\_by\_size}) \equiv \text{set}(\texttt{supported\_sizes})$ (rejecting any extraneous/unknown size keys) and reject payloads that supply conflicting scalar `expected_quantity_per_piece` and `expected_quantities_by_size`.
3. **`DEF-M00-04` Closure:** Require non-empty `tenant_id` on both input artifacts and execution context in all builders and verifiers (`input.tenant_id == context.tenant_id`), failing closed if either is missing.

## 7. Prerequisites & Upstream Dependencies
- Requires **`M01.4`** (Signed artifact storage), **`M02f`** (Seam/notch engine), **`M02g`** (Multi-size grading), **`M02h`** (Marker utilization for BOM), and **`M03`** (Material & seam compatibility rules).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/production/
├── piece_production_sheet.py # Ported & remediated piece-sheet builder + verifier (DEF-M00-02..04 closed)
├── seam_stitch_schedule.py   # ISO 4916 seam classes + ISO 4915 stitch classes + SPI + needle/thread spec
├── operation_routing.py      # Sewing Operation DAG, workcenter types, SAM (Standard Allowed Minutes)
├── bill_of_materials.py      # Shell fabric, lining, interlining/fusing, thread, zippers, buttons, labels
├── pom_qc_specification.py   # Graded Points of Measure (POM) table with +/- tolerances & inspection protocol
├── exporters/
│   ├── dxf_aama_exporter.py  # ASTM D6673 / AAMA DXF exporter with 100.0mm x 100.0mm calibration square
│   └── pdf_plot_exporter.py  # 1:1 tiled/large-format PDF plot + human-readable Tech Pack PDF
└── release_package.py        # RFC 8785 SHA-256 Merkle manifest + Ed25519 signature verifier
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`PieceProductionSheetPackage`:**
   - `{ package_id, tenant_id, project_id, revision_id, garment_family, supported_sizes, quantity_by_size, sheets: PieceProductionSheet[], package_sha256, is_production_ready: false }`
2. **`SeamAndStitchScheduleEntry` (`ISO 4915` / `ISO 4916`):**
   - `{ seam_id, joined_piece_edges: [EdgeRef, EdgeRef], iso_4916_seam_class: "SSa-1" | "SSn-1" | "LSa-1" | "EFa-1" | "EFb-1", iso_4915_stitch_class: "301_LOCKSTITCH" | "401_CHAINSTITCH" | "504_OVEREDGE_3THD" | "514_OVEREDGE_4THD", stitches_per_cm: float, needle_system_and_size: string, thread_ticket_tex: string, pressing_instruction: string }`
3. **`SewingOperationDAG`:**
   - `{ routing_id, operations: SewingOperationNode[], precedence_edges: [OpID, OpID][], total_sam_minutes: float, required_machine_classes: string[] }` (Verified acyclic with topological sort).
4. **`BillOfMaterials (BOM)`:**
   - `{ bom_id, size_breakdown_quantities, shell_fabric_lines: FabricBOMLine[], trim_and_notions_lines: TrimBOMLine[], thread_consumption_m_by_size: Map<SizeCode, float>, waste_allowance_pct: float }`
5. **`GradedPOMSpecification`:**
   - `{ pom_id, pom_code: string, pom_name: string, measurement_method_description: string, geometric_anchor_refs: [AnchorRef, AnchorRef], target_value_cm_by_size: Map<SizeCode, float>, tolerance_minus_cm: float, tolerance_plus_cm: float, criticality: "CRITICAL" | "MAJOR" | "MINOR" }`
6. **`ManufacturingTechPack` & `SignedManufacturingReleasePackage`:**
   - Aggregates `PieceProductionSheetPackage` + `SeamAndStitchSchedule` + `SewingOperationDAG` + `BOM` + `GradedPOMSpecification` + `DXFAAMAArtifact` + `PDFPlotArtifact` + `CalibrationCertificate`.

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Strict Quantity Map Validation (`DEF-M00-03` Fix):**
   - Let $S = \text{set}(\texttt{graded\_family.supported\_sizes})$ and $K = \text{set}(\texttt{quantity\_by\_size.keys()})$.
   - Require $K = S$ (zero missing keys, zero extra keys: $K \setminus S = \emptyset$ and $S \setminus K = \emptyset$), and for all $s \in S$, $\texttt{quantity\_by\_size}[s] \in \mathbb{Z}_{\ge 1}$.
   - If both `expected_quantity_per_piece` and `expected_quantities_by_size` are supplied in verification options, require $\forall s \in S: \texttt{expected\_quantities\_by\_size}[s] == \texttt{expected\_quantity\_per\_piece}$; otherwise reject immediately with `CONFLICTING_EXPECTED_QUANTITY_OPTIONS`.
2. **Thread & Fabric Consumption Formulas (`BOM`):**
   - Marker-based shell consumption for order size vector $\mathbf{q}$: $L_{\text{total\_shell}} = (1 + w_{\text{loss}}) \cdot L_{\text{marker}}(\mathbf{q}) \cdot \lambda_{\text{warp}}$ (incorporating `M03` warp relaxation shrinkage factor $\lambda_{\text{warp}}$).
   - Thread consumption per seam $e$ of length $L_e$: $L_{\text{thread}, e} = (1 + w_{\text{thread}}) \cdot \gamma(\text{ISO\_4915\_class}, \text{thickness\_mm}) \cdot L_e$, where $\gamma_{301} \approx 2.5$, $\gamma_{401} \approx 4.0$, $\gamma_{504} \approx 12.0$, $\gamma_{514} \approx 15.5$.
3. **POM Geometric Reconciliation Invariant:**
   - Every graded POM value $P(S_k)$ in `GradedPOMSpecification` is computed directly from the `M02g` net sew contour anchors (e.g., $\text{Finished\_Waist\_Circumference}(S_k) = 2 \cdot (L_{\text{front\_waist}}(S_k) + L_{\text{back\_waist}}(S_k)) - \text{closure\_overlap}$) and verified to match the 2D piece geometry within $\le 0.05\text{ cm}$.
4. **DXF-AAMA (`ASTM D6673`) Layer Standard & Calibration Square:**
   - Layer `1`: Piece Boundary (Cut Line), Layer `2`: Internal/Annotation, Layer `3`: Grainline (`7` in AAMA), Layer `4`: Notches, Layer `8`: Net Sew Line, Layer `14`: Drill Holes.
   - Embeds an authoritative $100.0\text{ mm} \times 100.0\text{ mm}$ ($10.0\text{ cm} \times 10.0\text{ cm}$) calibration square piece on every DXF and 1:1 PDF plot sheet (`AC-10`).

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/production/piece-sheets` → Builds and verifies `PieceProductionSheetPackage`.
- `POST /api/v1/production/tech-pack` → Generates complete `ManufacturingTechPack` (Piece Sheets + Seam Schedule + Operation DAG + BOM + POM + DXF-AAMA + PDF).
- `POST /api/v1/production/verify-package` → Runs independent cryptographic, geometric, topological, quantity, and tenant verification on a tech pack.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Mandatory `tenant_id` equality check at builder entry, verifier entry, and artifact download (`DEF-M00-04` closed).
- `is_production_ready` is unconditionally `false` on all `M05` outputs until counter-signed by `M07` (`PhysicalSampleApprovalRecord` + `MakerQualificationMatch`) using Ed25519 signature verification (`DEC-09`).

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Production Engineering & Tech Pack Studio:**
  - Interactive Piece Production Sheet viewer with per-size selector, area/perimeter error-bound inspector, and notch/grainline table,
  - Tabbed Tech Pack views: **ISO Seam & Stitch Schedule**, **Sewing Operation Routing DAG**, **Graded BOM & Thread Calculator**, and **Graded POM QC Sheet**,
  - Signed Export Drawer for `DXF-AAMA` and `1:1 PDF Plot` with calibration square checklist.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M05.1` — Remediated Piece Production Sheet Engine (Python Port):** Port `piece-production-sheet.ts` to Python, integrating `M02a`/`M02f` exact math and closing `DEF-M00-02`, `DEF-M00-03`, `DEF-M00-04`, and `DEF-M00-05`.
2. **`M05.2` — ISO 4915/4916 Seam Schedule & Operation Routing DAG Generator:** Implement category-specific construction templates for `skirt-block-v1`, `bodice-sleeve-v1`, `trouser-block-v1`, `dress-foundation-v1`, and `knit-tshirt-v1`.
3. **`M05.3` — Bill of Materials (BOM) & Graded POM Reconciliation Engine:** Compute fabric, interlining, zipper/button, and ISO stitch thread consumption + geometrically reconciled POM tables.
4. **`M05.4` — Calibrated DXF-AAMA & 1:1 PDF Exporter:** Implement standards-compliant `ASTM D6673` DXF writer and PDF plotter generator with $100.0\text{ mm}$ calibration square.
5. **`M05.5` — Independent Tech-Pack Verifier & Merkle Signer:** Implement comprehensive fail-closed package verifier.

## 15. Migration & Parity Strategy (Class A vs Class B Fixtures)
- All 34 structural/provenance invariants from `m0521-piece-production-sheet.test.ts` are preserved, while the defective numerical/cusp/quantity/tenant behaviors (`DEF-M00-02`–`05`) are replaced by Class B Normative expectations verified by `M00.4` Python oracles.

## 16. Unit, Property & Adversarial Test Plan
- Reproduce all 6 Phase E2/E3 adversarial vectors (`t=0.25` interior cusp, `2%` straight segment on curved contour, extraneous size key `{"S": 1, "EXTRA": 2}`, conflicting scalar vs map quantities, omitted `expectedTenantId` with blank `tenantId`, and skirt grading) and verify 100% deterministic rejection/closure.
- DAG cycle injection test on `SewingOperationDAG` → rejected.
- Tampered POM value diverging by $0.2\text{ cm}$ from 2D net sew geometry → rejected by POM reconciliation check.

## 17. Independent Verification Oracles
- Independent DXF-AAMA parser (`ezdxf` in isolated verification script) reading back exported `.dxf` files and verifying vertex-for-vertex arc length, closed loop topology, notch positions, and $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square dimensions within $\pm 0.01\text{ mm}$.

## 18. Physical, Manufacturing or Financial Validation Protocol
- Plot exported DXF/PDF on a physical large-format pattern plotter and flatbed cutter; measure the $100.0\text{ mm} \times 100.0\text{ mm}$ calibration square and piece POMs with a calibrated steel rule (`±0.1 mm` requirement for `AC-10`).

## 19. Acceptance Criteria (`AC-01`–`AC-12` Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-03`**, **`AC-04`**, **`AC-05`**, **`AC-06`**, **`AC-10`** (Manufacturing & Cut-File Qualification), **`AC-11`** (Tenant isolation & provenance).

## 20. Failure Modes, Rollback & Recovery Procedures
- Any discrepancy between 2D piece geometry, BOM quantities, or POM table values blocks tech-pack export and surfaces exact field-level diagnostic errors.

## 21. Observability, Audit Logging & Telemetry
- Logs package SHA-256 Merkle root, DXF/PDF file hashes, and verification pass/fail breakdown in `AuditLogEntry`.

## 22. Explicit Non-Goals & Scope Guardrails
- `M05` never sets `is_production_ready = True` on its own; physical sample sign-off and workshop assignment in `M07` are mandatory prerequisites.

## 23. Downstream Unlocks
- Unlocks the **Vertical Slice Gate (`plan/08`)** and **`M07`** (Maker Network, Sample Approval & Shop-Floor Traceability).

## 24. Definition of Done Checklist
- [ ] `DEF-M00-02`, `DEF-M00-03`, `DEF-M00-04`, and `DEF-M00-05` verified closed by adversarial tests.
- [ ] Complete `ManufacturingTechPack` (Piece Sheets + ISO 4915/4916 Schedule + Operation DAG + BOM + POM) generated in Python.
- [ ] DXF-AAMA and 1:1 PDF exports verified by independent `ezdxf` reader and physical $100.0\text{ mm}$ calibration check (`AC-10`).
- [ ] `is_production_ready: false` default enforced across all unapproved revisions.
