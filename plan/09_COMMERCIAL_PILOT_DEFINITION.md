# 09 — COMMERCIAL PILOT DEFINITION (`R2.1`)

**Document ID:** `PATRONER-BP-R2.1-09`  
**Status:** Authoritative Commercial Pilot Specification (`v5.16 Ch. 15 Phase E` / Workload `M09` — Release Levels A & B)  
**Governing Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 02`, `Ch. 08`, `Ch. 12`, `Ch. 15`, `v5.15 Commercial Ecosystem Update`)

---

## 1. Purpose & Release-Governance Framing of the Commercial Pilot (`Correction 03`)

Per `v5.16 Ch. 02`, `Ch. 08`, and `Ch. 15 (Phase E)`, the Commercial Pilot (`M09`) validates Patroner's design-to-manufacturing-to-settlement lifecycle across real physical garments, real workshop work orders (`M07`), and real multi-currency double-entry accounting postings (`M08`).

Per **`Correction 03`**, the Commercial Pilot is governed by two distinct release gates:
1. **Pilot Entry Gate — Release Level A (Engineering & Controlled Pilot Entry Release):** Requires completion of `M00`–`M08` and the `Vertical Slice Gate`, physical qualification of $\ge 2$ workshops, physical first-article sample sign-off (`isProductionReady: true` for the pilot revisions), 8-role `ProductOfferContract` binding, and single-region operational/backup controls. **It does not require `M10` (`Level C`) enterprise scale features.**
2. **Pilot Exit Gate — Release Level B (`M09` Pilot Acceptance):** Measured exclusively from **real customer orders, real physical workshop production, real POM quality inspections, real customer fit outcomes, and real bank/PSP-to-ledger reconciliation** across the capped pilot cohort ($\le 50$ units). Software test results never substitute for Level B pilot evidence.

---

## 2. Three Pilot Offer Tracks & Strict Volume Caps

| Pilot Track | Commercial Engine | Garment Scope | Sizing Mode | Hard Volume Cap | Primary Validation Objective |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Track P1: Patroner Own-Label Capsule** | Engine 2A: Own-Label (`Principal`, Separate Tenant & P&L) | Tailored Wool Midi Skirt (`skirt-block-v1`) + Set-In Sleeve Bodice (`bodice-sleeve-v1`) | Graded Standard Sizes (`XS`–`XXL` / `EU 34`–`46`) | $\le 25\text{ units}$ | Validate direct made-to-order COGS, workshop routing, QC inspection, and Principal revenue recognition. |
| **Track P2: Managed Brand Studio Creator Capsule** | Engine 2B: Brand Studio (`Managed Venture`) | Co-designed Skirt + Bodice variation using `M04a` intent + `M04b` recipe + `M02e` style transforms | Graded Standard Sizes (`XS`–`XXL` / `EU 34`–`46`) | $\le 15\text{ units}$ | Validate creator contractual splits, reserve holdbacks, IP provenance attribution, and creator payable settlement (`M08`). |
| **Track P3: Personalized Fit DTC Offer** | Engine 2A/2B with Custom Fit | Tailored Woven Skirt (`skirt-block-v1`) | Individual Customer `BodyMeasurementProfile` + mandatory human patternmaker concierge sign-off | $\le 10\text{ units}$ | Validate custom-fit measurement intake (`M02c`), `M06` fit prediction, single-ply `M02h` marker generation, and custom-fit alteration/return reserve accounting. |

**Total Pilot Volume Cap:** $\le 50\text{ physical garments}$ across $\ge 2$ pre-qualified partner workshops.

---

## 3. Mandatory 8-Role `ProductOfferContract` Matrix (`v5.16 Ch. 08`)

Per `v5.16 Ch. 08` and `REQ-COM-01`, no pilot offer may be published or transacted unless all **8 mandatory accountable commercial roles** are explicitly bound in the immutable `ProductOfferContract`:

| Accountable Role (`v5.16 Ch. 08`) | Schema Field | Track P1 (Own-Label Capsule) | Track P2 (Managed Brand Studio Capsule) | Track P3 (Personalized Fit DTC) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Seller of Record (`seller`)** | `seller_of_record_org_id` | Patroner Own-Label Entity (Isolated Tenant) | Patroner Commerce Entity (or Designated Venture Principal) | Patroner Own-Label Entity |
| **2. Manufacturer / Maker (`manufacturer`)** | `maker_of_record_org_id` | Qualified Workshop Partner A/B (`M07`) | Qualified Workshop Partner A/B (`M07`) | Qualified Small-Batch Workshop A (`M07`) |
| **3. Payment Collector (`payment collector`)** | `payment_collector_org_id` | Patroner Commerce Entity (via Stripe Connect/PSP) | Patroner Commerce Entity | Patroner Commerce Entity |
| **4. Customer Support Owner (`customer support`)** | `customer_support_owner_org_id` | Patroner Client Concierge | Patroner Client Concierge | Patroner Fit & Client Concierge |
| **5. Creator Compensation (`creator compensation`)** | `creator_beneficiary_org_id` | N/A (`Internal Own-Label Studio` — `0 bps` external royalty) | Partner Creator Entity (`Contractual Royalty / Net Split`) | N/A or Partner Creator Entity |
| **6. Defect Liability Bearer (`defect liability`)** | `defect_liability_bearer_org_id` | Workshop Partner (Manufacturing Defects) / Patroner QC Reserve | Workshop Partner (Manufacturing Defects) / Venture Reserve | Workshop Partner (Manufacturing Defects) / Patroner Reserve |
| **7. Delay Liability Bearer (`delay liability`)** | `delay_liability_bearer_org_id` | Patroner Operations / Workshop SLA Holdback | Patroner Operations / Workshop SLA Holdback | Patroner Operations / Workshop SLA Holdback |
| **8. Return & Refund Liability (`return/refund liability`)** | `return_risk_bearer_org_id` | Patroner Own-Label Return Reserve | Shared per Venture Agreement (Reserve Holdback Account `2500`) | Patroner Custom-Fit Alteration/Remake Reserve |

*(In addition, `brand_owner_org_id`, `ip_owner_org_id`, `manufacturing_principal_org_id`, and `fulfillment_owner_org_id` are explicitly recorded on the contract header.)*

---

## 4. Multi-Currency & Jurisdiction Governance for the Pilot (`Correction 06`)

1. **Distinction Between Software Capability (`M08`) and Pilot Operating Scope (`M09`):**
   - The `M08` financial engine supports full **ISO 4217 multi-currency accounting** (`minor_unit_exponent` `0`, `2`, `3`, `4`), dual transaction/functional currency journal lines, immutable FX rate snapshots, and realized/unrealized FX gain/loss accounts (`ADR-008`).
   - For operational risk containment during the 50-unit `M09` Controlled Pilot, checkout, workshop contracting, and settlement operate in a **single primary operating jurisdiction and functional currency** (recommended default: single EU jurisdiction in `EUR`, exponent `2`, pending human legal/tax confirmation in `DEC-12`), plus automated multi-currency test-suite verification in CI.
2. **Explicit Non-Substitution for Legal / Tax Certification:**
   - Software validation of the `M08` ledger (`AC-12`) proves mathematical accounting balance and rule adherence, **not** statutory tax or legal certification. External legal counsel and a qualified CPA/tax advisor must sign off on the pilot jurisdiction's VAT registration, invoice disclosures, and consumer return terms prior to `M09` launch (`DEC-12`).

---

## 5. Financial & Unit-Economics Reconciliation Protocol (`M08` → `M09`)

Every pilot order executes through the `M08` double-entry ledger (`workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md`) and produces minor-unit-exact reporting across all **8 canonical `v5.16 Ch. 12 (p. 22)` management metrics** without conflating them:
1. **`GMV` (Gross Merchandise Value)**
2. **`Gross merchandise sales`**
3. **`Net sales / revenue` (after returns, allowances, discounts & VAT/sales tax exclusion)**
4. **`Platform revenue` (commission, orchestration & SaaS fees recognized by Patroner Platform)**
5. **`Maker payout` (accrued and settled workshop manufacturing payables)**
6. **`Creator earnings` (accrued and settled Brand Studio creator royalties/splits net of reserve holdbacks)**
7. **`Contribution` (`CM1` / `CM2` after direct COGS, fulfillment, payment fees & return/remake provisions)**
8. **`Operating profit` (after platform/venture operating expenses)**

---

## 6. Pilot Level A Entry & Level B Exit Criteria

- **Level A Entry Gate (Required to Start `M09`):**
  - `Vertical Slice Gate` (`plan/08`) + `M07` + `M08` pass all Level A criteria across `AC-01` through `AC-12`,
  - `isProductionReady: true` is cryptographically unlocked **only** for the specific physically approved pilot revisions (`Gate G6`),
  - External legal/tax configuration sign-off (`DEC-12`) is recorded.
- **Level B Pilot Exit Criteria (Required to Close `M09` & Unlock `M10`):**
  - 100% of shipped pilot units undergo full physical POM inspection (`M07.5`) with $\ge 95\%$ first-pass QC yield,
  - Fit-related return/remake rate $\le 8\%$ on graded capsules (Tracks P1/P2) and $\le 12\%$ on personalized DTC orders (Track P3),
  - $0$ minor-unit cash-to-ledger reconciliation variance across PSP settlements, double-entry ledger accounts, creator payout statements, and workshop invoices.
