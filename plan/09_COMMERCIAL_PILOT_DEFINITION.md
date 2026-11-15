# 09 — COMMERCIAL PILOT DEFINITION

**Document ID:** `PATRONER-BP-R2-09`  
**Status:** Authoritative Commercial Pilot Specification (`v5.16 Ch. 15 Phase E` / Workload `M09`)  
**Governing Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 02`, `Ch. 08`, `Ch. 12`, `Ch. 15`, `v5.15 Commercial Ecosystem Update`)

---

## 1. Purpose & Strategic Role of the Commercial Pilot

Per `v5.16 Ch. 02`, `Ch. 08`, and `Ch. 15 (Phase E)`, Patroner is not merely a CAD tool; it is a **Fashion Operating System** operating two synergistic commercial models:
1. **Patroner Own-Label Capsules** (Patroner acts as Brand Owner, Seller of Record, and Manufacturing Principal).
2. **Managed Brand Studio Creator Ventures** (Patroner co-creates limited capsules with selected designers/creators under explicit commercial, manufacturing, and IP contracts — **not** an uncurated self-serve marketplace).

The Commercial Pilot (`M09`) validates the complete design-to-cash-to-settlement lifecycle across real physical garments, real workshop work orders (`M07`), and real double-entry accounting postings (`M08`).

---

## 2. Three Pilot Offer Tracks & Strict Volume Caps

| Pilot Track | Commercial Engine | Garment Scope | Sizing Mode | Hard Volume Cap | Primary Validation Objective |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Track P1: Patroner Own-Label Capsule** | Engine 2A: Own-Label (`Principal`) | Tailored Wool Midi Skirt (`skirt-block-v1`) + Set-In Sleeve Bodice (`bodice-sleeve-v1`) | Graded Standard Sizes (`EU 34–46`) | $\le 25\text{ units}$ | Validate direct inventory/made-to-order COGS, workshop routing, QC inspection, and Principal revenue recognition. |
| **Track P2: Managed Brand Studio Creator Capsule** | Engine 2B: Brand Studio (`Principal` or `Contractual Venture`) | Co-designed Skirt + Bodice variation using `M04` intent + `M02e` style transforms | Graded Standard Sizes (`EU 34–46`) | $\le 15\text{ units}$ | Validate creator contractual splits, reserve holdbacks, IP provenance attribution, and creator payable settlement (`M08`). |
| **Track P3: Personalized Fit DTC Offer** | Engine 2A/2B with Custom Fit | Tailored Woven Skirt (`skirt-block-v1`) | Individual Customer `BodyMeasurementProfile` + human patternmaker sign-off | $\le 10\text{ units}$ | Validate custom-fit measurement intake, `M06` fit prediction, single-ply marker generation, and custom-fit alteration/return reserve accounting. |

**Total Pilot Volume Cap:** $\le 50\text{ physical garments}$ across $\ge 2$ pre-qualified partner workshops.

---

## 3. Mandatory 8-Role `ProductOffer` Contract Matrix

Per `v5.16 Ch. 08` and `REQ-COM-01`, no pilot offer may be published or transacted unless all **8 mandatory commercial governance roles** are explicitly bound in the immutable `ProductOfferContract`:

| Governance Role | Track P1 (Own-Label Capsule) | Track P2 (Managed Brand Studio Capsule) | Track P3 (Personalized Fit DTC) |
| :--- | :--- | :--- | :--- |
| **1. `brand_owner_id`** | Patroner Own-Label Entity | Partner Creator Entity (or Co-Branded Venture) | Patroner Own-Label Entity |
| **2. `ip_owner_id`** | Patroner (Block + Style Revision) | Patroner (Base Block/Engine) + Creator (Surface Style Spec) | Patroner (Base Block) + Customer Profile License |
| **3. `seller_of_record_id`** | Patroner Commerce Entity | Patroner Commerce Entity (Principal Mode) | Patroner Commerce Entity |
| **4. `manufacturing_principal_id`** | Patroner Operations Entity | Patroner Operations Entity | Patroner Operations Entity |
| **5. `maker_of_record_id`** | Qualified Workshop Partner A/B (`M07`) | Qualified Workshop Partner A/B (`M07`) | Qualified Bespoke/Small-Batch Workshop A (`M07`) |
| **6. `fulfillment_owner_id`** | Patroner QC & Logistics Hub | Patroner QC & Logistics Hub | Patroner QC & Logistics Hub |
| **7. `customer_support_owner_id`** | Patroner Client Concierge | Patroner Client Concierge | Patroner Fit & Client Concierge |
| **8. `return_risk_bearer_id`** | Patroner Own-Label Reserve | Shared per Venture Agreement (85% Platform / 15% Creator Reserve Holdback) | Patroner Custom-Fit Alteration/Remake Reserve |

---

## 4. Workshop Qualification, Sample Protocol & Shop-Floor Controls

1. **Pre-Pilot Workshop Qualification (`M07`):**
   - At least **2 independent workshops** must complete equipment profiling (ISO 4915 stitch classes `301`, `401`, `504`, `514`, fusing press calibration, steam finishing, and plotter/cutter verification).
   - Each workshop must cut and sew a **Physical Qualification Sample** from the `M05` release package and pass `AC-09` (fit on form) and `AC-10` (100% POM tolerance within spec).
2. **Lot & Work-Order Traceability (`M07`):**
   - Every garment unit in Tracks P1, P2, and P3 is assigned a unique `GarmentSerialUnitID` linked to:
     - Exact `SignedManufacturingReleasePackage` SHA-256 digest (`M05`),
     - Physical `FabricRollLotID` and shrinkage test batch (`M03`/`M07`),
     - Append-only `WorkOrderOperationLog` (Cutting → Sewing → Pressing → Inline QC → Final POM Inspection),
     - Final QA inspector cryptographic sign-off before shipment dispatch.

---

## 5. Financial & Unit-Economics Reconciliation Protocol (`M08` → `M09`)

Every pilot order must execute through the `M08` double-entry ledger (`plan/workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md`) and produce penny-exact reporting across all **8 required management metrics** (`v5.16 Ch. 12`):
1. **Gross Merchandise Value (`GMV`)**
2. **Net Recognized Revenue (Principal vs. Agent separated)**
3. **Direct Manufacturing Cost (`COGS`: fabric lot consumption + workshop make fee + trim/packaging)**
4. **Gross Margin & Contribution Margin 1 / 2 (`CM1`, `CM2` after fulfillment & payment fees)**
5. **Return, Remake & Alteration Reserve Utilization**
6. **Creator Royalty / Venture Payable Accrual & Net Settlement**
7. **Workshop Payable Accrual & SLA Quality Holdback Release**
8. **Cash-to-Ledger Daily Reconciliation Variance (Target: `0.00 EUR`)**

---

## 6. Pilot Go / No-Go & Exit Criteria

- **Pre-Launch Go Gate:** `Vertical Slice` (`plan/08`) + `M07` + `M08` must pass `AC-01` through `AC-12` with zero open critical defects, and `isProductionReady` must be transitioned to `true` **only** for the specific physically approved pilot revisions.
- **Pilot Success Exit Criteria (Unlocks `M10`):**
  - $\ge 95\%$ of shipped pilot units pass final POM QC on first pass,
  - Fit-related return/remake rate $\le 8\%$ on graded capsules (Tracks P1/P2) and $\le 12\%$ on personalized DTC orders (Track P3),
  - $100\%$ penny-exact reconciliation between PSP settlements, internal double-entry ledger, creator payout statements, and workshop invoices.
