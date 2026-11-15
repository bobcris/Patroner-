# WORKLOAD M07 — MAKER NETWORK, SAMPLE APPROVAL & SHOP-FLOOR TRACEABILITY (`R2.1`)

## 1. Workload ID & Title
- **Workload ID:** `M07`
- **Title:** Maker Qualification, Capacity & Quoting, Physical Sample Approval (`Gate G5/G6`), Roll-Width/Lot Traceability, Shop-Floor Execution & Closed-Loop Quality
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase D/E (Manufacturing Execution, Shop-Floor Traceability & Quality Control)`

## 2. Purpose & Architectural Role
`M07` implements Patroner's **Manufacturing Execution, Workshop Network & Shop-Floor Quality System** (`Dossier 14 v5.12`, `Dossier 15 v5.13`, and `v5.16 Ch. 07`) inside `services/fashion-engine`. It connects digital tech packs (`M05`) and validated markers (`M02h`) to qualified physical workshops, governs the **Physical First-Article / Toile Sample Approval Gate** that unlocks `is_production_ready: true` for a specific garment revision (`Release Level A`), verifies incoming physical fabric roll widths and relaxation shrinkage against `M02h`/`M03` marker assumptions (`RSK-14`), and enforces append-only unit/lot traceability across cutting, sewing, inline inspection, final POM QC, rework/disposition, and governed closed-loop quality learning.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 07`, `Ch. 09`, `Ch. 11`, `Ch. 15 (Phase D/E)`, `App. A10–A11`, `App. F`
- `Dossier 14 v5.12` (Manufacturing Constraints & Production Release)
- `Dossier 15 v5.13` (Shop-Floor Traceability & Closed-Loop Quality)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-MFG-01`**: Hard `isProductionReady` Gate (Requires Physical Sample Approval + $100.0\text{ mm}$ Plotter Check + Qualified Maker Binding)
- **`REQ-MFG-02`**: Maker Qualification, RFQ/Quotes, Capacity/MOQ/Lead-Time Bands & Physical Sample Protocol
- **`REQ-SHOP-01`**: Material Lot & Roll-Width Traceability, Append-Only Work-Order Execution, POM Inspection & Governed Closed-Loop Quality

## 5. Current Repository Baseline & Classification
- **`src/engine/prototype/fit-validator.ts`**: `I2 + X` for 1D prototype measurement table validation, currently wired in UI to static mock fixtures (`MOCK_CONFORMING_PROTOTYPE_BODICE_M` — `D`).
- **Maker Qualification, Quoting, Lot Traceability & Work Orders**: `M` (Missing — `0%` implemented).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Retires `MOCK_CONFORMING_PROTOTYPE_BODICE_M` from runtime UI (`04_MIGRATION_AND_PARITY_POLICY.md` #11) and provides the physical verification gate required by `M05.1`/`M05.2.1` so `isProductionReady` transitions from `false` to `true` **only** via a cryptographically signed `PhysicalSampleApprovalRecord` (`RSK-06`, `RSK-10`, `RSK-14`).

## 7. Prerequisites & Upstream Dependencies
- Requires **`M01`** (Multi-tenant IAM & scoped ABAC `ActiveWorkshopGrant`), **`M05`** (`ManufacturingTechPack` including `M02h` `ValidatedMarkerArtifact`), and **`M06`** (`FitEvaluationReport` for physical-vs-digital sample comparison).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/manufacturing_execution/
├── maker_registry.py         # Workshop profiles, ISO 4915/4916 machine matrix, qualification status, capacity caps
├── quoting_and_routing.py    # RFQ/quotes, MOQ, lead-time bands, SAM cost estimator & capability matching
├── sample_approval.py        # Physical sample trial protocol, POM measurement intake & Ed25519 QA sign-off
├── lot_traceability.py       # FabricRollLot, incoming roll width vs M02h marker width check, shrinkage quarantine
├── work_order_execution.py   # Append-only WorkOrder state machine & shop-floor operation event log
├── quality_inspection.py     # Inline & final POM QC evaluator, DefectRecord, Rework/Scrap disposition
└── closed_loop_feedback.py   # Governed quality learning requiring data quality, comparability & human approval
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`MakerFacilityProfile` & `MakerQuoteRecord` (`Dossier 14`):**
   - `MakerFacilityProfile`: `{ maker_org_id, facility_id, qualification_tier: "CANDIDATE" | "SAMPLE_QUALIFIED" | "PRODUCTION_QUALIFIED" | "SUSPENDED", supported_garment_families: string[], iso_4915_stitch_capabilities: string[], plotter_cutter_calibration_status: CalibrationCertRef, active_capacity_units_per_week: int, min_order_quantity: int, standard_lead_time_days: int, quality_pass_rate_trailing_90d: float }`
   - `MakerQuoteRecord`: `{ quote_id, maker_facility_id, tech_pack_id, unit_make_cost_minor_units: int, currency_code: ISO4217Code, committed_lead_time_days: int, moq_units: int, valid_until_utc }`
2. **`PhysicalSampleApprovalRecord` (`Gate G5/G6` in `plan/10`):**
   - `{ approval_id, tenant_id, project_id, revision_id, tech_pack_id, maker_facility_id, fabric_lot_id, plotter_100mm_check_measured_mm: [float, float], pom_measurements_cm: Map<POMCode, float>, max_pom_deviation_within_tolerance: bool, fit_concordance_verified: bool, decision: "APPROVED" | "REJECTED_REQUIRES_PATTERN_REV" | "REJECTED_MAKER_DEFECT", qa_approver_person_id, ed25519_signature: string, signed_at }`
3. **`MaterialLotRecord` (`RSK-14` Roll-Width & Shrinkage Gate):**
   - `{ lot_id, material_spec_id, supplier_batch_ref, measured_usable_roll_width_cm: float, incoming_relaxation_shrinkage_warp_pct: float, incoming_relaxation_shrinkage_weft_pct: float, shade_band_code: string, quarantine_status: "RELEASED" | "QUARANTINED_WIDTH_SHORTFALL" | "QUARANTINED_SHRINKAGE_DRIFT" }`
4. **`ManufacturingWorkOrder` & `UnitOperationEvent` (Append-Only):**
   - `WorkOrder`: `{ work_order_id, tenant_id, release_package_id, maker_facility_id, maker_quote_id, allocated_fabric_lot_ids: UUID[], size_quantities: Map<SizeCode, int>, status: "ISSUED" | "ACCEPTED" | "CUTTING" | "SEWING" | "PRESSING_FINISHING" | "FINAL_QC" | "COMPLETED" | "HALTED" }`
5. **`QualityInspectionRecord` & `DefectDisposition`:**
   - `{ inspection_id, garment_serial_unit_id, inspection_stage: "CUT_PANEL_AUDIT" | "INLINE_SEWING" | "FINAL_POM_AND_VISUAL", measured_poms_cm: Map<POMCode, float>, defects: DefectEntry[], disposition: "PASS_FIRST_QUALITY" | "REWORK_REQUIRED" | "SECOND_QUALITY" | "SCRAP_REMAKE" }`

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Maker Capability, Quote & Roll-Width Verification Predicate (`Correction 02`, `RSK-14`):**
   A work order $W$ bound to `ManufacturingTechPack` $T$ (with `M02h` marker usable width $W_{\text{marker}}$) and fabric lot $L$ may enter `CUTTING` at workshop $m$ iff:
   $$\text{Qualification}(m) = \texttt{PRODUCTION\_QUALIFIED} \;\land\; \text{ReqMachines}(T.\text{routing}) \subseteq \text{Capabilities}(m) \;\land\; L.\text{measured\_usable\_roll\_width\_cm} \ge W_{\text{marker}} \;\land\; L.\text{quarantine\_status} = \texttt{RELEASED}$$
   If $L.\text{measured\_usable\_roll\_width\_cm} < W_{\text{marker}}$, cutting is blocked until `M02h` re-nests the marker for the narrower physical roll width.
2. **Physical POM Tolerance & Governed Closed-Loop Quality (`Dossier 15`):**
   - Unit $u$ passes dimensional QC iff $\forall p \in \text{CRITICAL} \cup \text{MAJOR}: -\tau_p^- \le y_{p,u} - \mu_{p,s} \le \tau_p^+$ (where $\tau_p \ge 0.20\text{ cm}$ per `DEC-11`).
   - **Governed Closed-Loop Learning:** Raw shop-floor defect or POM drift events **never** automatically mutate `M02` recipe defaults, `M03` material specs, or workshop ratings; `closed_loop_feedback.py` requires statistical sample sufficiency ($N \ge 5$, $p < 0.01$), lot comparability, tenant permission, and human engineering approval before creating a new `CalibratedMaterialSpec` or recipe revision.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/makers/facilities` / `POST /api/v1/makers/{facility_id}/qualify` / `POST /api/v1/makers/quotes`
- `POST /api/v1/manufacturing/sample-approvals` → Records physical sample inspection and Ed25519 QA signature; transitions revision to `Sample_Approved` (`Gate G5`) and unlocks `SignedManufacturingReleasePackage` (`is_production_ready: true`, `Gate G6`).
- `POST /api/v1/manufacturing/lots` → Registers and validates incoming `MaterialLotRecord` against `M02h` width and `M03` shrinkage bounds.
- `POST /api/v1/manufacturing/work-orders` / `POST /api/v1/manufacturing/work-orders/{wo_id}/events`
- `POST /api/v1/manufacturing/inspections` → Records inline/final POM measurements and defect dispositions.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- **Scoped Maker ABAC (`Dossier 16`):** Time-bounded, order-scoped `ActiveWorkshopGrant` exposes only the tech pack, graded cut files, and anonymous `GarmentSerialUnitID` — never customer PII or 3D body scans (`AC-11`).
- **Immutability:** `PhysicalSampleApprovalRecord`, `UnitOperationEvent`, and `QualityInspectionRecord` are append-only PostgreSQL tables protected against `UPDATE`/`DELETE`.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Maker Network, RFQ & Qualification Console**
- **Physical Sample Approval Gate Drawer** (comparing physical sample POMs against `M05` targets and `M06` fit predictions, with Ed25519 QA sign-off)
- **Shop-Floor Work Order & QC Tablet View**

## 14. Detailed Work Packages & Implementation Sequence
1. **`M07.1` — Maker Registry, Capability Matrix & RFQ Quoting Engine.**
2. **`M07.2` — Physical Sample Approval & `is_production_ready` Cryptographic Promotion Gate.**
3. **`M07.3` — Material Lot Intake, Roll-Width Verification & Shrinkage Quarantine Gate (`RSK-14`).**
4. **`M07.4` — Append-Only Work Order & Serial Unit Execution Engine.**
5. **`M07.5` — Inline/Final POM QC & Governed Closed-Loop Drift Analyzer.**

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Ports `validatePhysicalFit` (`src/engine/prototype/fit-validator.ts`) into `M07.2` / `M07.5` (`Class B`) and retires runtime mock fixtures (`MOCK_CONFORMING_PROTOTYPE_BODICE_M`).

## 16. Unit, Property & Adversarial Test Plan
- **Premature Promotion Attack:** Attempt to create `SignedManufacturingReleasePackage` (`is_production_ready: true`) without an approved `PhysicalSampleApprovalRecord` or using a synthetic mock fixture → 100% hard rejection.
- **Narrow Roll-Width Attack (`RSK-14`):** Attempt to cut a $148.0\text{ cm}$ `M02h` marker on an incoming fabric lot with $145.5\text{ cm}$ usable width → blocked with `QUARANTINED_WIDTH_SHORTFALL`.
- **Automatic Recipe Mutation Block:** Verify raw shop-floor POM defect events cannot mutate `M02` recipes or `M03` specs without human sign-off.

## 17. Independent Verification Oracles
- Independent cryptographic release-chain verifier checking that every `GarmentSerialUnitID` links unbrokenly to a valid `QualityInspectionRecord (PASS_FIRST_QUALITY)` → `WorkOrder` → `MaterialLotRecord` → `PhysicalSampleApprovalRecord` → `SignedManufacturingReleasePackage` → `GarmentRevisionNode`.

## 18. Physical, Manufacturing or Financial Validation Protocol
- **Level A Qualification:** Qualify $\ge 2$ physical partner workshops using the Vertical Slice `skirt-block-v1` and `bodice-sleeve-v1` tech packs; execute physical $100.0\text{ mm}$ plotter calibration check and physical first-article sample cutting, sewing, and POM inspection (`AC-09`, `AC-10`).

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`**, **`AC-09`** (Physical Sample Fit Approval), **`AC-10`** (Manufacturing Qualification & Traceability), **`AC-11`** (Scoped Maker ABAC & append-only audit trail). Completes **Release Level A** manufacturing requirements and governs **Release Level B** shop-floor quality measurement in `M09`.

## 20. Failure Modes, Rollback & Recovery Procedures
- **Shop-Floor Scrap Remake:** Marking a unit `SCRAP_REMAKE` at final QC automatically spawns a linked replacement `GarmentSerialUnitID` referencing the failure record and updates `M08` remake reserve utilization.

## 21. Observability, Audit Logging & Telemetry
- Tracks workshop lead-time adherence, first-pass QC yield, defect pareto by operation node, and POM systematic drift statistics.

## 22. Explicit Non-Goals & Scope Guardrails
- `M07` tracks Patroner-governed materials, patterns, work orders, and quality inspections; it is not a generic third-party factory payroll/ERP system.

## 23. Downstream Unlocks
- Unlocks **Release Level A Gate** and **`M09` (Controlled Commercial Pilot)**.

## 24. Definition of Done Checklist
- [ ] Maker qualification registry, RFQ quoting, and ISO 4915/4916 capability matcher operational.
- [ ] `PhysicalSampleApprovalRecord` gate enforced as the sole path to `is_production_ready: true` (mock fixtures retired from runtime).
- [ ] Incoming roll width vs. `M02h` marker width check (`RSK-14`) and shrinkage quarantine active.
- [ ] Append-only `WorkOrder`, `MaterialLotRecord`, and `QualityInspectionRecord` pipelines verified.
