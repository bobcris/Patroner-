# WORKLOAD M08 — COMMERCE ECOSYSTEM, 8-ROLE CONTRACT & FINANCIAL ARCHITECTURE

## 1. Workload ID & Title
- **Workload ID:** `M08`
- **Title:** Commercial Ecosystem Separation, 8-Role `ProductOffer` Governance Contract, Double-Entry Accounting Ledger, Principal-vs-Agent Revenue Recognition, Tax/VAT & Multi-Party Settlements
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase E Preparation (Commercial & Financial Architecture)`

## 2. Purpose & Architectural Role
`M08` implements Patroner's **Commercial Ecosystem & Financial Operating System** (`v5.16 Ch. 02`, `Ch. 08`, `Ch. 12`, and `v5.15 Commercial Ecosystem Update`) inside `services/fashion-engine`. It enforces the strict structural separation between **Engine 1 (B2B/Pro Platform SaaS)**, **Engine 2A (Patroner Own-Label Capsules)**, and **Engine 2B (Managed Brand Studio Creator Ventures)**, binds every commercial offer to the mandatory **8-Role Commercial Governance Contract (`REQ-COM-01`)**, and records every monetary event in an immutable **ACID Double-Entry Accounting Ledger (`REQ-FIN-01`)**.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 02`, `Ch. 08`, `Ch. 12`, `Ch. 15 (Phase E)`, `App. F`
- `Patroner_Monograph_v5.15_Commercial_Ecosystem_Update.pdf`
- `Dossier 01 v4.9` (Domain System of Record), `Dossier 16 v5.14` (Security, RBAC/ABAC & Audit Controls)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-COM-01`**: Commercial Line Separation & Mandatory 8-Role `ProductOffer` Governance Contract
- **`REQ-FIN-01`**: Immutable Double-Entry Accounting Ledger, Transaction Lifecycle, Principal-vs-Agent Recognition, VAT/Tax, Settlements, Reserves & 8 Management Metrics
- **`REQ-MFG-01`**: Commercial Checkout Gate Requiring `SignedManufacturingReleasePackage` (`is_production_ready: true`)

## 5. Current Repository Baseline & Classification
- **Commercial Offer Governance & Financial Ledger**: `M` (Missing) — `0%` implemented in the current repository.

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Prevents **`RSK-08`** (Principal-vs-Agent accounting errors, VAT miscalculation, unreserved custom-fit returns, or premature creator payouts before return windows close).

## 7. Prerequisites & Upstream Dependencies
- Requires **`M01`** (Multi-tenant IAM, Organization registry, RBAC+ABAC, and PostgreSQL ACID persistence) and integrates with **`M05`/`M07`** (`SignedManufacturingReleasePackage` and `ManufacturingWorkOrder` milestones).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/commerce_and_finance/
├── commercial_programs.py   # Engine 1 (SaaS), Engine 2A (Own-Label), Engine 2B (Managed Brand Studio)
├── offer_contract.py        # 8-role ProductOfferContract validator & ProductionReady release binding
├── order_lifecycle.py       # Order state machine: Checkout -> Escrow/WIP -> Shipped -> ReturnWindow -> Settled
├── ledger/
│   ├── chart_of_accounts.py # Multi-currency Chart of Accounts (Assets, Liabilities, Equity, Revenue, COGS, Reserves)
│   ├── journal_engine.py    # ACID serializable double-entry posting engine (Sum(Debits) == Sum(Credits))
│   └── reconciliation.py    # PSP (Stripe) webhook ingestion & daily cash-to-ledger reconciliation
├── tax_and_recognition.py   # Principal vs Agent revenue rules, EU/UK/US VAT/Sales Tax calculation
├── settlements.py           # Creator royalty split engine, reserve holdbacks, maker milestone payables
└── management_reporting.py  # Authoritative calculator for the 8 v5.16 Ch. 12 management metrics
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`ProductOfferContract` (`v5.16 Ch. 08` — 8 Mandatory Roles):**
   - `{ offer_id, tenant_id, commercial_mode: "OWN_LABEL_PRINCIPAL" | "BRAND_STUDIO_MANAGED_VENTURE" | "PERSONALIZED_DTC_PRINCIPAL", signed_release_package_id, brand_owner_org_id, ip_owner_org_id, seller_of_record_org_id, manufacturing_principal_org_id, maker_of_record_org_id, fulfillment_owner_org_id, customer_support_owner_org_id, return_risk_bearer_org_id, accounting_mode: "PRINCIPAL_GROSS" | "AGENT_NET_COMMISSION", retail_price_minor_units: int, currency: "EUR", creator_royalty_rate_bps: int, return_reserve_holdback_bps: int, status: "DRAFT" | "ACTIVE" | "SUSPENDED" }`
2. **Chart of Accounts & Double-Entry Journal (`v5.16 Ch. 12`):**
   - **`LedgerAccount`**: `{ account_code, account_name, account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "CONTRA_REVENUE" | "COGS" | "EXPENSE", currency, normal_balance: "DEBIT" | "CREDIT" }`
   - Canonical Account Codes:
     - `1010` Cash / PSP Clearing Asset
     - `1200` Inventory / Made-to-Order Work-in-Progress (WIP) Asset
     - `2100` Deferred / Unearned Customer Revenue Liability
     - `2200` Output VAT / Sales Tax Payable Liability
     - `2300` Workshop Maker Accounts Payable Liability
     - `2400` Creator Venture Royalty / Split Payable Liability
     - `2500` Return, Remake & Chargeback Reserve Holdback Liability
     - `4010` Gross Product Revenue (Principal Mode — Own-Label / Managed Venture)
     - `4020` Platform Commission & Orchestration Fee Revenue (Agent Mode)
     - `4090` Returns, Allowances & Remake Contra-Revenue
     - `5010` Direct Manufacturing COGS (Fabric + Workshop Make + Trim)
     - `5020` Payment Processing & Fulfillment Direct Expense
   - **`JournalEntry` & `JournalLine` (Immutable Append-Only):**
     - `JournalEntry`: `{ entry_id, idempotency_key, event_type, order_id, posted_at, description, lines: JournalLine[], entry_sha256 }`
     - Invariant enforced by PostgreSQL constraint trigger: $\sum_{i} \text{debit\_minor\_units}_i = \sum_{i} \text{credit\_minor\_units}_i > 0$.

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Double-Entry Lifecycle Posting Rules (`v5.16 Ch. 12`):**
   Let gross customer payment be $G = P_{\text{net}} + V$ where $V$ is VAT and $P_{\text{net}}$ is net price ex-VAT:
   - **Event 1 — Order Authorized & Captured (`Checkout`):**
     $$\text{Dr } \texttt{1010 PSP Clearing } (G - F_{\text{psp}}), \quad \text{Dr } \texttt{5020 PSP Fee } (F_{\text{psp}}) \quad \Big| \quad \text{Cr } \texttt{2100 Deferred Revenue } (P_{\text{net}}), \quad \text{Cr } \texttt{2200 VAT Payable } (V)$$
   - **Event 2 — Work Order Issued & Completed (`M07` Maker Milestone $C_{\text{make}}$ + Fabric Lot $C_{\text{mat}}$):**
     $$\text{Dr } \texttt{1200 WIP Inventory } (C_{\text{make}} + C_{\text{mat}}) \quad \Big| \quad \text{Cr } \texttt{2300 Maker Payable } (C_{\text{make}}), \quad \text{Cr } \texttt{1210 Raw Fabric Asset } (C_{\text{mat}})$$
   - **Event 3 — Garment Shipped & Delivered (`Fulfillment` — Principal Mode with Reserve Rate $r_{\text{res}}$ & Creator Royalty $r_{\text{creator}}$):**
     - Revenue & Reserve Recognition:
       $$\text{Dr } \texttt{2100 Deferred Revenue } (P_{\text{net}}) \quad \Big| \quad \text{Cr } \texttt{4010 Gross Revenue } \big((1 - r_{\text{res}}) P_{\text{net}}\big), \quad \text{Cr } \texttt{2500 Return Reserve Liability } (r_{\text{res}} P_{\text{net}})$$
     - COGS & Creator Split Accrual:
       $$\text{Dr } \texttt{5010 Direct COGS } (C_{\text{make}} + C_{\text{mat}} + R_{\text{creator}}) \quad \Big| \quad \text{Cr } \texttt{1200 WIP Inventory } (C_{\text{make}} + C_{\text{mat}}), \quad \text{Cr } \texttt{2400 Creator Payable } \big((1 - r_{\text{hold}}) R_{\text{creator}}\big), \quad \text{Cr } \texttt{2500 Creator Reserve Holdback } (r_{\text{hold}} R_{\text{creator}})$$
   - **Event 4 — Return Window Expiry (`t_delivery + 14/30 days` with zero return):**
     - Releases held-back `2500` reserve to recognized revenue and payable settlement pool.
   - **Event 5 — Customer Refund, Remake, or Chargeback:**
     - Reverses proportional VAT (`2200`), draws down `2500 Return Reserve` / `4090 Contra-Revenue`, and adjusts unvested `2400 Creator Payable` per the `return_risk_bearer_org_id` policy in the 8-role contract.
2. **The 8 Mandatory Management Metrics (`v5.16 Ch. 12`):**
   1. `GMV` $=\sum G$
   2. `Net_Recognized_Revenue` $=\text{Balance}(\texttt{4010}) + \text{Balance}(\texttt{4020}) - \text{Balance}(\texttt{4090})$
   3. `Direct_COGS` $=\text{Balance}(\texttt{5010})$
   4. `Contribution_Margin_1_and_2` (`CM1` $= \text{Net\_Revenue} - \text{Direct\_COGS}$; `CM2` $= \text{CM1} - \text{Balance}(\texttt{5020})$)
   5. `Reserve_Coverage_Ratio` $=\text{Balance}(\texttt{2500}) / \text{Expected\_Open\_Window\_Returns}$
   6. `Creator_Net_Payable_Accrual` $=\text{Balance}(\texttt{2400})$
   7. `Maker_Net_Payable_Accrual` $=\text{Balance}(\texttt{2300})$
   8. `Daily_Cash_Reconciliation_Variance` $= |\text{PSP\_Statement\_Balance} - \text{Balance}(\texttt{1010})|$ (Required: `0` minor units).

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/commerce/offers` → Validates all 8 governance roles and `is_production_ready == True` before activating an offer.
- `POST /api/v1/commerce/orders` → Creates customer order, locks pattern/size/custom-fit snapshot, and initiates PSP payment intent.
- `POST /api/v1/finance/webhooks/psp` → Idempotent PSP event processor posting double-entry journal lines.
- `POST /api/v1/finance/settlements/run` → Executes maker and creator payout batches after QC and return-window clearance.
- `GET /api/v1/finance/reports/management-metrics` → Returns the 8 canonical management metrics and trial balance.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Only `FINANCE_CONTROLLER` and `TENANT_ADMIN` roles can execute settlements or view full ledger journals; creators (`CREATOR_STUDIO`) and workshops (`WORKSHOP_MAKER`) have scoped read-only access strictly to their own venture/work-order statements (`AC-11`, `AC-12`).
- Every `JournalEntry` is chained via SHA-256 hash (`prev_entry_sha256` → `entry_sha256`) and protected by PostgreSQL `SERIALIZABLE` isolation and append-only triggers.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Brand Studio & Capsule Offer Configurator:** Interactive 8-role contract builder with live unit-economics margin simulator (`CM1`/`CM2` preview from `M05` BOM + `M07` maker quote).
- **Financial Controller & Settlement Console:** Real-time Trial Balance, 8-metric executive scorecard, reserve holdback tracker, and Creator/Maker payout statement generator.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M08.1` — 8-Role `ProductOfferContract` & Release Gate Validator:** Enforce all 8 non-null governance roles and `is_production_ready: true` verification.
2. **`M08.2` — Double-Entry PostgreSQL Ledger & Chart of Accounts:** Implement `ledger_accounts`, `journal_entries`, and `journal_lines` with zero-imbalance DB triggers.
3. **`M08.3` — Order Lifecycle, Principal-vs-Agent & VAT Engine:** Implement postings for Events 1–5 across Own-Label, Brand Studio, and Personalized DTC modes.
4. **`M08.4` — Creator & Maker Settlement Engine:** Implement return-window holdback release and milestone payout scheduling.
5. **`M08.5` — PSP Reconciliation & 8-Metric Reporting Engine:** Implement daily settlement reconciliation and management reporting endpoints.

## 15. Migration & Parity Strategy (Class A vs Class B Fixtures)
- Greenfield Python financial domain (`Class B Normative`); verified against penny-exact accounting test vectors.

## 16. Unit, Property & Adversarial Test Plan
- **`Hypothesis` Stateful Ledger Fuzzing:** Execute 5,000 randomized sequences of orders, partial shipments, custom-fit remakes, refunds, chargebacks, and currency roundings → verify $\sum \text{Debits} == \sum \text{Credits}$ at every step and zero negative reserve leaks.
- **Incomplete 8-Role Offer Rejection:** Attempt to publish a `ProductOfferContract` missing `return_risk_bearer_org_id` or pointing to a pattern revision with `is_production_ready == False` → 100% hard rejection.
- **Duplicate Webhook Idempotency Test:** Replay identical PSP payment/chargeback webhooks 10 times → verify exactly 1 `JournalEntry` is posted.

## 17. Independent Verification Oracles
- Standalone accounting trial-balance and T-account replay auditor verifying penny-exact conservation of value across all accounts, VAT buckets, and multi-party splits (`AC-12`).

## 18. Physical, Manufacturing or Financial Validation Protocol
- Execute end-to-end sandbox settlement dry run across Track P1 (Own-Label), Track P2 (Brand Studio Creator Capsule), and Track P3 (Personalized Fit DTC) prior to opening `M09` live orders.

## 19. Acceptance Criteria (`AC-01`–`AC-12` Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`**, **`AC-11`** (Financial RBAC/ABAC & tamper-proof ledger chain), **`AC-12`** (8-Role Contract & Double-Entry Financial Readiness).

## 20. Failure Modes, Rollback & Recovery Procedures
- **Ledger Corrections:** Journal entries are never mutated or deleted; errors are corrected exclusively via explicit, linked **Reversing and Adjusting Journal Entries** with mandatory controller approval and audit reason codes.

## 21. Observability, Audit Logging & Telemetry
- Real-time alerts on any PSP reconciliation variance $\ne 0$, failed webhook signature, or reserve utilization exceeding threshold bands.

## 22. Explicit Non-Goals & Scope Guardrails
- `M08` explicitly prohibits open, uncurated third-party marketplace listings where external sellers upload unverified patterns (`v5.16 Ch. 02`, `Ch. 08`).

## 23. Downstream Unlocks
- Unlocks **`M09`** (Controlled Commercial Pilot).

## 24. Definition of Done Checklist
- [ ] 8-role `ProductOfferContract` validator enforced on 100% of commercial offers.
- [ ] PostgreSQL ACID double-entry ledger active with zero-imbalance database triggers.
- [ ] Principal vs. Agent revenue recognition, VAT, reserve holdbacks, refunds, and chargebacks verified across 5,000 property-test lifecycles.
- [ ] All 8 management metrics (`v5.16 Ch. 12`) computed and reconciled to the penny.
