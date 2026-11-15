# WORKLOAD M09 — CONTROLLED COMMERCIAL PILOT EXECUTION (`R2.1`)

## 1. Workload ID & Title
- **Workload ID:** `M09`
- **Title:** Controlled Commercial Pilot Execution Across Own-Label, Managed Brand Studio & Personalized Fit DTC Tracks (`Release Level A Entry` → `Release Level B Exit`)
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase E (Commercial Pilot & Real-World Validation)`

## 2. Purpose & Architectural Role (`Correction 03`)
`M09` executes the **Controlled Commercial Pilot** specified in `/plan/09_COMMERCIAL_PILOT_DEFINITION.md` and `v5.16 Ch. 15 (Phase E)`. It validates the complete Patroner System of Systems under real commercial, physical manufacturing, customer fit, and financial settlement conditions across strictly capped capsule volumes ($\le 50\text{ physical garments}$ across Track P1 Own-Label, Track P2 Managed Brand Studio Creator Capsule, and Track P3 Personalized Fit DTC).

Per **`Correction 03`**, `M09` is strictly decoupled from `M10` enterprise-scale requirements:
- **`M09` Enters at Release Level A (Engineering & Controlled Pilot Entry Release):** Requires completion of `M00`–`M08` and the `Vertical Slice Gate`, plus pilot-scoped single-region backup/recovery and legal/tax sign-off (`DEC-12`). **Zero `M10` (`Level C`) capabilities are required to start `M09`.**
- **`M09` Exits at Release Level B (Measured Pilot Acceptance):** Evaluated exclusively from real physical production, real POM quality inspections, real customer fit outcomes, and real bank/PSP-to-ledger reconciliation across the pilot cohort. Passing `Level B` unlocks `M10`.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 02`, `Ch. 07`, `Ch. 08`, `Ch. 09`, `Ch. 12`, `Ch. 15 (Phase E)`, `App. F`
- All 16 Specialist Dossiers (`01` through `16`) operating as an integrated system under **Release Level A / B**.

## 4. Canonical Requirements Implemented (`REQ-*`)
- Integrates and validates **`REQ-ARCH-01`** through **`REQ-FIN-01`** under live operational conditions (`Release Level B`).

## 5. Current Repository Baseline & Classification
- **Commercial Pilot Execution**: `M` (Missing) — Requires completion of `M00`–`M08`, the `Vertical Slice Gate`, and **Release Level A Gate**.

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Zero open `DEF-M00-*` or critical/high defects are permitted at `M09` entry (`Release Level A` across `App. F` Gates `F.1`–`F.10` in `/plan/10_RELEASE_AND_GOVERNANCE_POLICY.md`).

## 7. Prerequisites & Upstream Dependencies (`Correction 03` Non-Circular)
- Requires **100% completion and sign-off of `M00` through `M08`**, the **Vertical Slice Gate (`plan/08_VERTICAL_SLICE_DEFINITION.md`)**, and **Release Level A Gate**.
- **Explicit Non-Dependency:** `M09` has **zero dependency on `M10`**.

## 8. Target Architecture & Module Ownership
- **`services/fashion-engine/app/pilot_operations/`**:
  - `capsule_allocation.py`: Enforces hard inventory/capacity caps ($\le 25$ P1, $\le 15$ P2, $\le 10$ P3) and workshop SLA reservation locking.
  - `custom_fit_concierge.py`: Mandatory human patternmaker review queue for every Track P3 Personalized Fit customer order prior to cutting.
  - `pilot_telemetry_and_postmortem.py`: Tracks real-world POM pass rates, physical-vs-digital fit accuracy, return/alteration reasons, and unit-economics variance against pre-pilot estimates (`Release Level B` evidence generator).

## 9. Domain Entities, State Machines & Data Contracts
- **`PilotCapsuleCampaign`**: `{ campaign_id, track: "P1_OWN_LABEL" | "P2_BRAND_STUDIO" | "P3_PERSONALIZED_DTC", offer_contract_id, operating_jurisdiction_profile_id, functional_currency_code: ISO4217Code, max_units_cap: int, allocated_units: int, primary_maker_facility_id, backup_maker_facility_id, level_a_gate_certificate_sha256, status: "LEVEL_A_AUDITED" | "LIVE" | "FULFILLING" | "SETTLEMENT_RECONCILIATION" | "LEVEL_B_ACCEPTED" }`
- **`CustomerFitFollowUpRecord`**: `{ order_id, garment_serial_unit_id, customer_fit_satisfaction_score: int, regional_fit_feedback: Map<FitZoneID, string>, alteration_or_remake_required: bool, root_cause_classification: "MEASUREMENT_INTAKE" | "PATTERN_EASE" | "FABRIC_RELAXATION" | "WORKSHOP_SEWING" | "NONE" }`

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Atomic Capacity Reservation & Bottleneck Protection:**
   When a pilot customer initiates checkout on campaign $C$, `capsule_allocation.py` acquires a serializable lock verifying:
   $$\text{allocated\_units}(C) + 1 \le \text{max\_units\_cap}(C) \;\land\; \text{workshop\_active\_load}(m_{\text{primary}}) < \text{max\_weekly\_capacity}(m_{\text{primary}})$$
   automatically routing overflow within the cap to $m_{\text{backup}}$ if $m_{\text{primary}}$ approaches $80\%$ weekly load (`RSK-10`).
2. **Pilot Cohort Statistical Evaluation (`v5.16 Ch. 17` — `Release Level B`):**
   Computes empirical physical-to-digital POM Root Mean Square Error ($\text{RMSE}_{\text{POM}} = \sqrt{\frac{1}{|U|}\sum_{u \in U} (y_{p,u} - \hat{y}_{p,u})^2}$, target $\le 0.35\text{ cm}$) and realized unit Contribution (`CM1`, `CM2`) variance against `M05`/`M08` pre-production quotes.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/pilot/campaigns` → Registers and locks a capped pilot capsule after verifying **Release Level A** across `App. F` Gates F.1–F.10.
- `POST /api/v1/pilot/orders/{order_id}/concierge-approve` → Records mandatory human patternmaker sign-off on Track P3 personalized orders before work-order release.
- `GET /api/v1/pilot/campaigns/{campaign_id}/level-b-audit-summary` → Produces complete operational, quality, fit, and financial reconciliation report for **Release Level B** sign-off.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Enforces full tenant isolation between the Track P1 Own-Label tenant (`PATRONER_OWN_LABEL`) and the Track P2 Partner Creator Studio tenant (`CREATOR_STUDIO`) (`AC-11`).
- Every shipped garment includes a verifiable digital provenance passport linking its `GarmentSerialUnitID` to the approved release digest and workshop QC inspection without exposing internal cost margins.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Curated Capsule Storefront & Guided Fit Intake (`apps/web`)**
- **Pilot Operations Command Center:** Live tracking of every unit (`Unit #01/50` through `Unit #50/50`) across checkout, pattern review, cutting, sewing, QC inspection, shipping, customer fit feedback, and ledger settlement.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M09.1` — Pre-Launch Release Level A Audit (`App. F` Level A Column):** Verify Level A criteria across `M01`–`M08` (including single-region backup restore drill and `DEC-12` legal/tax sign-off).
2. **`M09.2` — Capsule Configuration & Physical Sample Sign-Off:** Lock the 8-role `ProductOfferContract` and `SignedManufacturingReleasePackage` (`is_production_ready: true`) for Track P1, P2, and P3 garments across $\ge 2$ qualified workshops.
3. **`M09.3` — Controlled Order Intake & Custom-Fit Concierge Review:** Open capped checkout ($\le 50\text{ units}$) and execute patternmaker review on all Track P3 orders.
4. **`M09.4` — Workshop Execution, Lot Traceability & 100% Final POM QC:** Execute cutting, sewing, and 100% final POM inspection via `M07`.
5. **`M09.5` — Fulfillment, Customer Fit Post-Mortem & Release Level B Financial Settlement:** Collect post-delivery fit feedback, clear return windows, execute creator/maker payouts via `M08`, and publish the **Release Level B Pilot Acceptance Report**.

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Live operational validation workload (`Release Level B`); empirical pilot measurements become gold-standard physical calibration fixtures for `M03` and `M06`.

## 16. Unit, Property & Adversarial Test Plan
- **Cap Overflow Stress Test (`Level A`):** 100 concurrent checkout requests against a 15-unit Track P2 capsule → exactly 15 succeed, 85 fail gracefully with zero over-allocation or ledger double-charging.
- **Unapproved Custom-Fit Bypass Test (`Level A`):** Attempt to dispatch a Track P3 personalized order to workshop cutting before `concierge-approve` sign-off → blocked.

## 17. Independent Verification Oracles
- Independent end-to-end audit script reconciling all $\le 50$ physical `GarmentSerialUnitID` records against workshop QC logs, customer delivery confirmations, PSP bank settlements, and `M08` general ledger balances.

## 18. Physical, Manufacturing or Financial Validation Protocol
- **100% Physical Inspection Protocol (`Release Level B`):** Every single garment produced in `M09` (100% sampling, not statistical AQL sampling) undergoes full physical POM measurement and visual QC inspection prior to customer shipment.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **Entry Gate:** Must pass **Release Level A** across `AC-01`–`AC-12`.
- **Exit Gate (`Release Level B` — Real Measured Evidence Required):**
  - First-pass workshop POM QC yield $\ge 95\%$ (`AC-10`),
  - Fit-related return/remake rate $\le 8\%$ (Tracks P1/P2) and $\le 12\%$ (Track P3) (`AC-09`),
  - Cash-to-ledger reconciliation variance $= 0$ minor units across all orders, VAT accruals, maker invoices, and creator payouts (`AC-12`).

## 20. Failure Modes, Rollback & Recovery Procedures
- **Workshop Halt / Failover:** If Primary Workshop A experiences equipment failure or fails $>10\%$ inline QC on a batch, `capsule_allocation.py` halts remaining uncut units at Workshop A and re-issues work orders to pre-qualified Backup Workshop B using the identical `SignedManufacturingReleasePackage`.

## 21. Observability, Audit Logging & Telemetry
- Complete per-unit lifecycle SLA timers, POM deviation histograms, and real-time contribution margin tracking.

## 22. Explicit Non-Goals & Scope Guardrails
- `M09` is strictly capped at $\le 50\text{ units}$ and must **never** be represented as **Release Level C** enterprise production readiness (`Correction 03`).

## 23. Downstream Unlocks
- Passing **Release Level B** unlocks **`M10`** (Advanced Governance, Repeatable Brand Studio Ventures & Enterprise Scale — `Release Level C`).

## 24. Definition of Done Checklist
- [ ] All 10 `App. F` gates satisfied at **Release Level A** prior to pilot launch (with zero dependency on `M10`).
- [ ] Tracks P1, P2, and P3 executed within volume caps ($\le 50\text{ units}$).
- [ ] **Release Level B** exit criteria ($\ge 95\%$ first-pass POM QC yield, $\le 8\% / 12\%$ fit return rate, and $0$ minor-unit cash-to-ledger variance) achieved from real physical and financial evidence.
