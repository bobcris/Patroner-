# WORKLOAD M07 — MAKER NETWORK, SAMPLE APPROVAL & SHOP-FLOOR TRACEABILITY

## 1. Workload ID & Title
- **Workload ID:** `M07`
- **Title:** Maker Qualification, Capacity & Quoting, Physical Sample Approval, Lot Traceability, Shop-Floor Execution & Closed-Loop Quality
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase D/E (Manufacturing Execution, Shop-Floor Traceability & Quality Control)`

## 2. Purpose & Architectural Role
`M07` implements Patroner's **Manufacturing Execution, Workshop Network & Shop-Floor Quality System** (`Dossier 14 v5.12`, `Dossier 15 v5.13`, and `v5.16 Ch. 07`) inside `services/fashion-engine`. It connects digital tech packs (`M05`) to qualified physical workshops, governs the **Physical First-Article / Toile Sample Approval Gate** that unlocks `is_production_ready: true` for a specific garment revision, and enforces append-only unit/lot traceability across cutting, sewing, inline inspection, final POM QC, rework/disposition, and closed-loop feedback into pattern/material tolerances.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 07`, `Ch. 09`, `Ch. 11`, `Ch. 15 (Phase D/E)`, `App. F`
- `Dossier 14 v5.12` (Production Engineering, Tech Packs & Manufacturing Execution)
- `Dossier 15 v5.13` (Shop-Floor Traceability, Quality Control & Maker Network)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-MFG-01`**: Hard `isProductionReady` Gate (Requires Physical Sample Approval + Qualified Maker Binding)
- **`REQ-SHOP-01`**: Maker Qualification, Capacity/MOQ/Lead-Time Quoting, Material Lot Traceability, Append-Only Work-Order Execution, POM Inspection & Closed-Loop Quality

## 5. Current Repository Baseline & Classification
- **Maker Network, Sample Approval & Shop-Floor Traceability**: `M` (Missing) — `0%` implemented in the current repository.

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Provides the missing institutional and physical verification gate required by `M05.1`/`M05.2.1` so that `isProductionReady` can transition from `false` to `true` **only** via a cryptographically signed `PhysicalSampleApprovalRecord` and `MakerQualificationMatch` (`RSK-06`, `RSK-10`).

## 7. Prerequisites & Upstream Dependencies
- Requires **`M01`** (Multi-tenant IAM & ABAC `WorkOrderGrant`), **`M05`** (`ManufacturingTechPack`), and **`M06`** (`FitEvaluationReport` for physical-vs-digital sample comparison).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/manufacturing_execution/
├── maker_registry.py         # Workshop profiles, ISO 4915/4916 machine matrix, qualification status, capacity caps
├── quoting_and_routing.py    # MOQ, lead-time, SAM cost estimator & workshop capability matching
├── sample_approval.py        # Physical sample trial protocol, POM measurement intake & Ed25519 QA sign-off
├── lot_traceability.py       # FabricRollLot, TrimLot, incoming shrinkage verification & serial unit binding
├── work_order_execution.py   # Append-only WorkOrder state machine & shop-floor operation event log
├── quality_inspection.py     # Inline & final POM QC evaluator, DefectRecord, Rework/Scrap disposition
└── closed_loop_feedback.py   # Aggregates shop-floor POM drift & shrinkage variance back to M02/M03
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`MakerFacilityProfile` (`Dossier 15`):**
   - `{ maker_org_id, facility_id, qualification_tier: "CANDIDATE" | "SAMPLE_QUALIFIED" | "PRODUCTION_QUALIFIED" | "SUSPENDED", supported_garment_families: string[], iso_4915_stitch_capabilities: string[], plotter_cutter_calibration_status: CalibrationCertRef, active_capacity_units_per_week: int, min_order_quantity: int, standard_lead_time_days: int, quality_pass_rate_trailing_90d: float }`
2. **`PhysicalSampleApprovalRecord` (`Gate G5/G6` in `plan/10`):**
   - `{ approval_id, tenant_id, project_id, revision_id, tech_pack_id, maker_facility_id, fabric_lot_id, plotter_100mm_check_measured_mm: [float, float], pom_measurements_cm: Map<POMCode, float>, max_pom_deviation_within_tolerance: bool, fit_concordance_verified: bool, decision: "APPROVED" | "REJECTED_REQUIRES_PATTERN_REV" | "REJECTED_MAKER_DEFECT", qa_approver_person_id, ed25519_signature: string, signed_at }`
3. **`MaterialLotRecord`:**
   - `{ lot_id, material_spec_id, supplier_batch_ref, roll_width_cm: float, incoming_relaxation_shrinkage_warp_pct: float, incoming_relaxation_shrinkage_weft_pct: float, shade_band_code: string, quarantine_status: "RELEASED" | "QUARANTINED" }`
4. **`ManufacturingWorkOrder` & `GarmentUnitExecutionLog` (Append-Only):**
   - `WorkOrder`: `{ work_order_id, tenant_id, release_package_id, maker_facility_id, allocated_fabric_lot_ids: UUID[], size_quantities: Map<SizeCode, int>, status: "ISSUED" | "ACCEPTED" | "CUTTING" | "SEWING" | "PRESSING_FINISHING" | "FINAL_QC" | "COMPLETED" | "HALTED" }`
   - `UnitOperationEvent` (Append-only): `{ event_id, work_order_id, garment_serial_unit_id, operation_node_id, operator_id, machine_id, status: "STARTED" | "COMPLETED" | "FLAGGED", recorded_at }`
5. **`QualityInspectionRecord` & `DefectDisposition`:**
   - `{ inspection_id, garment_serial_unit_id, inspection_stage: "CUT_PANEL_AUDIT" | "INLINE_SEWING" | "FINAL_POM_AND_VISUAL", measured_poms_cm: Map<POMCode, float>, defects: DefectEntry[], disposition: "PASS_FIRST_QUALITY" | "REWORK_REQUIRED" | "SECOND_QUALITY" | "SCRAP_REMAKE" }`

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Maker Capability & Capacity Matching Predicate:**
   A workshop $m$ is eligible to receive a `ManufacturingWorkOrder` for `ManufacturingTechPack` $T$ iff:
   $$\text{Qualification}(m) = \texttt{PRODUCTION\_QUALIFIED} \;\land\; \text{ReqMachines}(T.\text{routing}) \subseteq \text{Capabilities}(m) \;\land\; \text{OrderUnits}(W) \le \text{AvailableCapacity}(m)$$
2. **Physical POM Tolerance & Systematic Drift Detection (`Closed-Loop Quality`):**
   - For each POM $p$ on unit $u$ of size $s$, let $e_{p,u} = y_{p,u} - \mu_{p,s}$ be the signed deviation from the `M05` target $\mu_{p,s} \in [\mu_{p,s} - \tau_p^-, \mu_{p,s} + \tau_p^+]$.
   - Unit $u$ passes dimensional QC iff $\forall p \in \text{CRITICAL} \cup \text{MAJOR}: -\tau_p^- \le e_{p,u} \le \tau_p^+$.
   - **Closed-Loop Feedback Rule:** Across a lot of $N \ge 5$ units, if the sample mean deviation $|\bar{e}_p| > 0.6 \cdot \tau_p$ with $t$-statistic $p\text{-value} < 0.01$ (indicating systematic fabric relaxation or seam-takeup bias rather than random operator variance), `closed_loop_feedback.py` emits a structured `SystematicToleranceDriftAlert` proposing a calibrated `M03` shrinkage/takeup parameter update for the next revision.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/makers/facilities` / `POST /api/v1/makers/{facility_id}/qualify`
- `POST /api/v1/manufacturing/sample-approvals` → Records physical sample inspection and Ed25519 QA signature; transitions revision to `Sample_Approved` and unlocks `SignedManufacturingReleasePackage` (`is_production_ready: true`).
- `POST /api/v1/manufacturing/lots` → Registers and validates incoming `MaterialLotRecord`.
- `POST /api/v1/manufacturing/work-orders` → Issues append-only work order to a qualified workshop.
- `POST /api/v1/manufacturing/work-orders/{wo_id}/events` → Records append-only shop-floor operation events.
- `POST /api/v1/manufacturing/inspections` → Records inline/final POM measurements and defect dispositions.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- **Scoped Maker ABAC (`Dossier 16`):** Workshop operators (`MAKER_OPERATOR`) can view and log events **only** for `WorkOrder` records explicitly assigned to their `maker_org_id`, and receive only the tech pack, graded cut files, and anonymous `GarmentSerialUnitID` — never customer names, addresses, or 3D body scans (`AC-11`).
- **Immutability:** `PhysicalSampleApprovalRecord`, `UnitOperationEvent`, and `QualityInspectionRecord` are append-only PostgreSQL tables protected against `UPDATE`/`DELETE`.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Maker Network & Qualification Console:** Workshop capability matrix, calibration certificates, capacity utilization, and quote comparison.
- **Physical Sample Approval Gate Drawer:** Interactive POM measurement entry table comparing physical sample measurements against `M05` targets and `M06` fit predictions, with QA cryptographic sign-off button.
- **Shop-Floor Work Order & QC Tablet View:** Streamlined step-by-step operation check-in, lot barcode/QR binding, POM measurement input, and defect disposition workflow.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M07.1` — Maker Registry, Capability Matrix & Quoting Engine:** Implement workshop qualification and ISO 4915/4916 machine capability matching.
2. **`M07.2` — Physical Sample Approval & `is_production_ready` Cryptographic Promotion Gate:** Implement `PhysicalSampleApprovalRecord` verification and Ed25519 release package counter-signing.
3. **`M07.3` — Material Lot Intake & Shrinkage Quarantine Gate:** Verify incoming fabric roll width and relaxation shrinkage against `M03` tolerance bands.
4. **`M07.4` — Append-Only Work Order & Serial Unit Execution Engine:** Track per-unit cutting, sewing, and pressing operations.
5. **`M07.5` — Inline/Final POM QC & Closed-Loop Drift Analyzer:** Implement POM tolerance evaluation, rework/scrap disposition, and systematic drift feedback into `M03`.

## 15. Migration & Parity Strategy (Class A vs Class B Fixtures)
- Greenfield Python capability (`Class B Normative`); integrates directly with the `M05` piece-sheet and tech-pack provenance chain to govern the `is_production_ready` transition.

## 16. Unit, Property & Adversarial Test Plan
- **Premature Promotion Attack:** Attempt to create a `SignedManufacturingReleasePackage` (`is_production_ready: true`) without an approved `PhysicalSampleApprovalRecord` or with a sample whose critical waist POM deviates by $+1.2\text{ cm}$ (tolerance $\pm 0.5\text{ cm}$) → 100% hard rejection.
- **Unqualified Maker Routing Attack:** Attempt to assign a work order requiring ISO 4915 `514` 4-thread overlock to a workshop lacking `514` capability → rejected.
- **Quarantined Fabric Lot Attack:** Attempt to start cutting a work order bound to a `QUARANTINED` fabric roll lot whose shrinkage exceeds the pattern's `M03` compensation band → blocked.

## 17. Independent Verification Oracles
- Independent cryptographic release-chain verifier checking that every `GarmentSerialUnitID` shipped in `M09` links unbrokenly to a valid `QualityInspectionRecord (PASS_FIRST_QUALITY)` → `WorkOrder` → `MaterialLotRecord` → `PhysicalSampleApprovalRecord` → `SignedManufacturingReleasePackage` → `GarmentRevisionNode`.

## 18. Physical, Manufacturing or Financial Validation Protocol
- Qualify $\ge 2$ physical partner workshops using the Vertical Slice `skirt-block-v1` and `bodice-sleeve-v1` tech packs; execute physical first-article sample cutting, sewing, and POM inspection (`AC-09`, `AC-10`).

## 19. Acceptance Criteria (`AC-01`–`AC-12` Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`**, **`AC-09`** (Physical Sample Fit Approval), **`AC-10`** (Manufacturing Qualification & Traceability), **`AC-11`** (Scoped Maker ABAC & append-only audit trail).

## 20. Failure Modes, Rollback & Recovery Procedures
- **Shop-Floor Defect / Scrap Remake:** If a unit is marked `SCRAP_REMAKE` at final QC, `work_order_execution.py` automatically spawns a linked replacement `GarmentSerialUnitID` referencing the defective unit's failure record and updates `M08` remake reserve utilization.

## 21. Observability, Audit Logging & Telemetry
- Tracks workshop lead-time adherence, first-pass QC yield, defect pareto by operation node, and POM systematic drift statistics.

## 22. Explicit Non-Goals & Scope Guardrails
- `M07` is not a generic third-party ERP for unrelated factory inventory; it tracks Patroner-governed materials, patterns, work orders, and quality inspections.

## 23. Downstream Unlocks
- Unlocks **`M09`** (Controlled Commercial Pilot).

## 24. Definition of Done Checklist
- [ ] Maker qualification registry and ISO 4915/4916 capability matcher operational.
- [ ] `PhysicalSampleApprovalRecord` gate enforced as the sole path to `is_production_ready: true`.
- [ ] Append-only `WorkOrder`, `MaterialLotRecord`, and `QualityInspectionRecord` pipelines verified.
- [ ] Closed-loop POM drift detector verified with synthetic and physical sample data.
