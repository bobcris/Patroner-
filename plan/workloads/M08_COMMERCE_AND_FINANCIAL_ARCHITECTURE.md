# WORKLOAD M08 — COMMERCE ECOSYSTEM, 8-ROLE CONTRACT & MULTI-CURRENCY FINANCIAL ARCHITECTURE (`R2.1`)

## 1. Workload ID & Title
- **Workload ID:** `M08`
- **Title:** Commercial Ecosystem Separation, 8-Role `ProductOfferContract`, ISO 4217 Multi-Currency Double-Entry Ledger, FX Gain/Loss, Principal-vs-Agent Recognition, Tax Policy & Multi-Party Settlements
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase E/F Preparation (Commercial & Multi-Currency Financial Architecture)`

## 2. Purpose & Architectural Role (`Correction 06`)
`M08` implements Patroner's **Commercial Ecosystem & Multi-Currency Financial Operating System** (`v5.16 Ch. 02`, `Ch. 08`, `Ch. 12`, and `v5.15 Commercial Ecosystem Update`) inside `services/fashion-engine`. It enforces the strict structural and tenant separation between **Engine 1 (B2B/Pro Platform SaaS)**, **Engine 2A (Patroner Own-Label Capsules)**, and **Engine 2B (Managed Brand Studio Creator Ventures)**, binds every commercial offer to the mandatory **8 Accountable Commercial Roles (`REQ-COM-01`, `v5.16 Ch. 08`)**, and records every monetary event in an immutable **ISO 4217 Multi-Currency ACID Double-Entry Accounting Ledger (`REQ-FIN-01`, `Correction 06`, `ADR-008`)** from which the **8 canonical `v5.16 Ch. 12` management metrics** are derived without conflation.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 02`, `Ch. 08`, `Ch. 12`, `Ch. 15 (Phase E/F)`, `App. C`, `App. F`
- `Patroner_Monograph_v5.15_Commercial_Ecosystem_Update.pdf`
- `Dossier 01 v4.9`, `Dossier 16 v5.14`
- `ADR-007` & `ADR-008` (`R2.1` Multi-Currency Double-Entry Ledger)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-COM-01`**: Commercial Line & Own-Label Tenant Separation + Mandatory 8-Role `ProductOfferContract`
- **`REQ-FIN-01`**: ISO 4217 Multi-Currency Double-Entry General Ledger (`minor_unit_exponent` `0|2|3|4`, Explicit Rounding Policy, FX Rate Provenance, Dual Transaction/Functional Currency Balancing, FX Gain/Loss, Principal-vs-Agent Recognition, Tax/VAT Configuration, Settlements, Reserves & 8 Management Metrics)
- **`REQ-MFG-01`**: Commercial Checkout Gate Requiring `SignedManufacturingReleasePackage` (`is_production_ready: true`)

## 5. Current Repository Baseline & Classification
- **Commercial Offer Governance & Multi-Currency Financial Ledger**: `M` (Missing — `0%` implemented in the current repository).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Prevents **`RSK-08`** (Principal-vs-Agent accounting errors, fixed 2-decimal currency exponent bugs on `JPY`/`KWD`, unrecorded FX variance, unreserved custom-fit returns, or premature creator payouts before return windows close).

## 7. Prerequisites & Upstream Dependencies
- Requires **`M01`** (Multi-tenant IAM, Organization registry, RBAC+ABAC, and PostgreSQL ACID persistence) and integrates with **`M05`/`M07`** (`SignedManufacturingReleasePackage` and `ManufacturingWorkOrder` milestones).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/commerce_and_finance/
├── commercial_programs.py     # Engine 1 (SaaS), Engine 2A (Own-Label Tenant), Engine 2B (Managed Brand Studio)
├── offer_contract.py          # 8-role ProductOfferContract validator & ProductionReady release binding
├── order_lifecycle.py         # Order state machine: Checkout -> Escrow/WIP -> Shipped -> ReturnWindow -> Settled
├── ledger/
│   ├── iso4217_currencies.py  # ISO 4217 currency registry, minor_unit_exponent (0, 2, 3, 4) & rounding policies
│   ├── fx_rates.py            # Immutable ExchangeRateSnapshot store, timestamp & SHA-256 provenance
│   ├── chart_of_accounts.py   # Multi-currency Chart of Accounts (Assets, Liabilities, Equity, Revenue, COGS, FX)
│   ├── journal_engine.py      # ACID serializable dual-currency double-entry engine (tx & functional balance)
│   └── reconciliation.py      # PSP (Stripe) webhook idempotency & daily cash-to-ledger reconciliation
├── tax_and_recognition.py     # Configurable jurisdiction tax profiles & Principal vs Agent recognition rules
├── settlements.py             # Creator royalty split engine, reserve holdbacks, maker cross-currency payables
└── management_reporting.py    # Authoritative calculator for the 8 v5.16 Ch. 12 management metrics
```

## 9. Domain Entities, State Machines & Data Contracts (`Correction 06`)
1. **`CurrencyDefinition` & `ExchangeRateSnapshot` (`ISO 4217`):**
   - `CurrencyDefinition`: `{ currency_code: ISO4217Code, numeric_code: string, minor_unit_exponent: 0 | 2 | 3 | 4, default_rounding_mode: "ROUND_HALF_EVEN" | "ROUND_HALF_UP" }` (e.g., `JPY`: exponent `0`; `EUR`, `USD`, `GBP`: exponent `2`; `KWD`, `BHD`, `TND`: exponent `3`).
   - `ExchangeRateSnapshot`: `{ fx_rate_id, base_currency: ISO4217Code, quote_currency: ISO4217Code, rate_decimal: DecimalString, rate_source: "ECB_REFERENCE" | "PSP_LOCKED_SETTLEMENT" | "TREASURY_CONTRACT", observed_at_utc: ISOTimestamp, snapshot_sha256: string }` — **Append-only**.
2. **`ProductOfferContract` (`v5.16 Ch. 08` — All 8 Accountable Roles + Structural Governance):**
   - `{ offer_id, tenant_id, commercial_mode: "OWN_LABEL_PRINCIPAL" | "BRAND_STUDIO_MANAGED_VENTURE" | "PERSONALIZED_DTC_PRINCIPAL" | "MARKETPLACE_AGENT", signed_release_package_id, seller_of_record_org_id, maker_of_record_org_id, payment_collector_org_id, customer_support_owner_org_id, creator_beneficiary_org_id, defect_liability_bearer_org_id, delay_liability_bearer_org_id, return_risk_bearer_org_id, brand_owner_org_id, ip_owner_org_id, manufacturing_principal_org_id, fulfillment_owner_org_id, accounting_mode: "PRINCIPAL_GROSS" | "AGENT_NET_COMMISSION", pricing_currency_code: ISO4217Code, retail_price_minor_units: int, tax_jurisdiction_profile_id: string, creator_royalty_rate_bps: int, return_reserve_holdback_bps: int, status: "DRAFT" | "ACTIVE" | "SUSPENDED" }`
3. **Chart of Accounts & Dual-Currency Double-Entry Journal (`v5.16 Ch. 12` & `ADR-008`):**
   - Canonical Account Codes:
     - `1010` Cash / PSP Clearing Asset (sub-ledgered by `currency_code`)
     - `1200` Inventory / Made-to-Order Work-in-Progress (WIP) Asset
     - `1350` Prepaid Creator Minimum-Guarantee Advance Asset (`M10`)
     - `2100` Deferred / Unearned Customer Revenue Liability
     - `2200` Output VAT / Sales Tax Payable Liability (sub-ledgered by `tax_jurisdiction_profile_id`)
     - `2300` Workshop Maker Accounts Payable Liability
     - `2400` Creator Venture Royalty / Split Payable Liability
     - `2500` Return, Remake & Chargeback Reserve Holdback Liability
     - `4010` Gross Merchandise Sales / Product Revenue (Principal Mode)
     - `4020` Platform Commission, Orchestration & SaaS Fee Revenue
     - `4090` Returns, Allowances, Discounts & Remake Contra-Revenue
     - `4810` Realized Foreign Exchange (FX) Gain
     - `4820` Unrealized FX Revaluation Adjustment
     - `5010` Direct Manufacturing COGS (Fabric + Workshop Make + Trim + Creator Production Royalty)
     - `5020` Payment Processing & Fulfillment Direct Expense
     - `5810` Realized Foreign Exchange (FX) Loss
   - **`JournalEntry` & `JournalLine` (Immutable Append-Only):**
     - `JournalEntry`: `{ entry_id, tenant_id, idempotency_key, event_type, order_id, functional_currency_code: ISO4217Code, fx_rate_snapshot_id?: UUID, posted_at_utc, description, lines: JournalLine[], prev_entry_sha256, entry_sha256 }`
     - `JournalLine`: `{ line_id, account_code, direction: "DEBIT" | "CREDIT", transaction_currency_code: ISO4217Code, transaction_minor_unit_exponent: int, transaction_amount_minor: int, functional_currency_code: ISO4217Code, functional_minor_unit_exponent: int, functional_amount_minor: int }`

## 10. Mathematical, Algorithmic & Domain Specifications (`Correction 06`)
1. **ISO 4217 Minor-Unit Scaling, Exact Decimal Quantization & Remainder Conservation:**
   - For any currency $c$ with exponent $e_c \in \{0, 2, 3, 4\}$, 1 major unit equals $10^{e_c}$ integer minor units (`transaction_amount_minor`).
   - Any proportional calculation (tax rate $\tau$, royalty rate $r_{\text{bps}} / 10000$, reserve holdback, or FX conversion at rate $\rho$) is evaluated in exact `decimal.Decimal` (28+ significant digits) and quantized to integer minor units $M_i = \text{quantize}(x_i \cdot 10^{e_c}, \text{rounding\_mode})$.
   - **Conservation of Integer Minor Units across Multi-Way Splits:** When partitioning a total integer minor-unit amount $M_{\text{total}}$ across $k$ buckets $(w_1, \dots, w_k)$ with $\sum w_i = 1$, any rounding residual $\Delta = M_{\text{total}} - \sum_{i=1}^k M_i \in \{-k+1, \dots, k-1\}$ is allocated deterministically by largest fractional remainder (with deterministic tie-breaking by bucket priority) so that $\sum_{i=1}^k M_i^* \equiv M_{\text{total}}$ holds identically.
2. **Dual-Currency Balance Invariant & FX Gain/Loss Posting:**
   - Every `JournalEntry` must satisfy **both**:
     1. **Functional Currency Balance:** $\sum_{l \in \text{DEBIT}} l.\texttt{functional\_amount\_minor} = \sum_{l \in \text{CREDIT}} l.\texttt{functional\_amount\_minor} > 0$, AND
     2. **Per-Transaction-Currency Balance:** For each distinct `transaction_currency_code` $c$ in the entry (unless the entry is an explicit cross-currency FX conversion/settlement entry paired via FX clearing legs), $\sum_{l \in \text{DEBIT}, c} l.\texttt{transaction\_amount\_minor} = \sum_{l \in \text{CREDIT}, c} l.\texttt{transaction\_amount\_minor}$.
   - **Realized FX Gain/Loss on Cross-Currency Settlement:** If an order or maker payable is accrued at time $t_1$ at FX rate $\rho_1$ (functional value $F_1 = \text{round}(M_{\text{tx}} \cdot \rho_1)$) and settled at time $t_2$ at PSP/bank locked FX rate $\rho_2$ (functional cash value $F_2 = \text{round}(M_{\text{tx}} \cdot \rho_2)$), the difference $\Delta F = F_2 - F_1$ is posted atomically to `4810 Realized FX Gain` or `5810 Realized FX Loss`.
3. **The 8 Canonical Management Metrics (`v5.16 Ch. 12, p. 22`):**
   Derived strictly in functional reporting currency without ever combining or conflating them:
   1. **`GMV`**: Total gross value of customer orders processed across all commercial modes.
   2. **`Gross merchandise sales`**: Gross sales value of Principal-mode merchandise (`4010` before contra-revenue).
   3. **`Net sales / revenue`**: Recognized merchandise revenue net of returns, allowances, discounts (`4090`), and excluding output VAT/sales tax (`2200`).
   4. **`Platform revenue`**: Commission, orchestration, and B2B SaaS fees earned by Patroner Platform (`4020`).
   5. **`Maker payout`**: Accrued and settled manufacturing payables to partner workshops (`2300`).
   6. **`Creator earnings`**: Accrued and settled Brand Studio creator royalties/splits (`2400`) net of unvested return reserves.
   7. **`Contribution`**: Net revenue minus direct manufacturing COGS (`5010`), payment/fulfillment expenses (`5020`), and return/remake reserve provisions (`2500`).
   8. **`Operating profit`**: Contribution minus platform/venture operating expenses and net FX adjustments.
4. **Distinction Between `M09` Pilot Jurisdiction and Multi-Jurisdiction Configuration (`DEC-12`):**
   - `tax_and_recognition.py` loads tax/VAT and accounting rules from versioned, externally approved `TaxJurisdictionPolicyProfile` configurations (never hardcoded or invented by engineers).
   - While `M08` implements and tests full multi-currency (`0|2|3|4` exponent) and cross-currency FX capabilities in CI, live `M09` pilot orders operate within the approved pilot home jurisdiction and functional currency (`DEC-12`) signed off by external legal/CPA counsel.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/commerce/offers` → Validates all 8 accountable roles, `tax_jurisdiction_profile_id`, `ISO4217Code`, and `is_production_ready == True`.
- `POST /api/v1/commerce/orders` → Creates customer order, locks pattern/size/custom-fit snapshot and `ExchangeRateSnapshot`, and initiates PSP payment intent.
- `POST /api/v1/finance/webhooks/psp` → Idempotent PSP event processor posting balanced dual-currency journal lines.
- `POST /api/v1/finance/settlements/run` → Executes maker and creator payout batches (including cross-currency FX gain/loss posting where applicable) after QC and return-window clearance.
- `GET /api/v1/finance/reports/management-metrics` → Returns the 8 canonical `v5.16 Ch. 12` management metrics and trial balance.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Patroner Platform and Patroner Own-Label operate as separate `Tenant` records with separate Trial Balances and P&Ls and zero cross-tenant privilege (`REQ-COM-01`).
- Every `JournalEntry` is chained via SHA-256 hash (`prev_entry_sha256` → `entry_sha256`) and protected by PostgreSQL `SERIALIZABLE` isolation and append-only triggers.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Brand Studio & Capsule Offer Configurator:** Interactive 8-role contract builder with currency/jurisdiction selector and live unit-economics margin simulator (`M05` BOM + `M07` maker quote).
- **Financial Controller & Settlement Console:** Real-time Multi-Currency Trial Balance, 8-metric executive scorecard, FX snapshot inspector, reserve holdback tracker, and Creator/Maker payout statement generator.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M08.1` — 8-Role `ProductOfferContract` & Own-Label Tenant Separation Validator.**
2. **`M08.2` — ISO 4217 Currency Registry (`0|2|3|4` Exponents), `ExchangeRateSnapshot` & Dual-Currency PostgreSQL Ledger.**
3. **`M08.3` — Order Lifecycle, Principal-vs-Agent, Configurable Tax Profile & FX Gain/Loss Posting Engine.**
4. **`M08.4` — Creator & Maker Settlement Engine with Return-Window Reserve Holdbacks.**
5. **`M08.5` — PSP Reconciliation & 8-Metric Reporting Engine.**

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Greenfield Python financial domain (`Class B Normative`); verified against minor-unit-exact multi-currency accounting test vectors.

## 16. Unit, Property & Adversarial Test Plan
- **`Hypothesis` Multi-Currency Stateful Ledger Fuzzing (`Correction 06`):** Execute 5,000 randomized lifecycles across zero-decimal (`JPY`, exponent `0`), two-decimal (`EUR`, `USD`, `GBP`, exponent `2`), and three-decimal (`KWD`, exponent `3`) currencies with fluctuating FX rates, multi-way royalty/tax splits, partial shipments, refunds, and chargebacks → verify $\sum \text{Debits} == \sum \text{Credits}$ in both transaction and functional currencies, exact minor-unit conservation on splits, and accurate `4810`/`5810` FX gain/loss postings.
- **Incomplete 8-Role Offer Rejection:** Attempt to publish a `ProductOfferContract` missing any of the 8 accountable roles or pointing to a pattern revision with `is_production_ready == False` → 100% hard rejection.
- **Duplicate Webhook Idempotency Test:** Replay identical PSP webhooks 10 times → verify exactly 1 `JournalEntry` is posted.

## 17. Independent Verification Oracles
- Standalone multi-currency trial-balance and T-account replay auditor verifying minor-unit conservation of value across all accounts, currency exponents, FX snapshots, VAT buckets, and multi-party splits (`AC-12`).

## 18. Physical, Manufacturing or Financial Validation Protocol
- Execute end-to-end sandbox settlement dry run across Track P1 (Own-Label), Track P2 (Brand Studio Creator Capsule), and Track P3 (Personalized Fit DTC) and obtain external legal/CPA sign-off on the pilot jurisdiction tax configuration (`DEC-12`) prior to `M09` launch (`Level A Gate`).

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`**, **`AC-11`** (Own-Label tenant isolation, financial RBAC/ABAC & tamper-proof ledger chain), **`AC-12`** (8-Role Contract & ISO 4217 Multi-Currency Double-Entry Financial Readiness). Required for **Release Level A** (engine & sandbox) and **Release Level B** (live pilot reconciliation).

## 20. Failure Modes, Rollback & Recovery Procedures
- **Ledger Corrections:** Journal entries are never mutated or deleted; errors are corrected exclusively via explicit, linked **Reversing and Adjusting Journal Entries** with mandatory controller approval and audit reason codes.

## 21. Observability, Audit Logging & Telemetry
- Real-time alerts on any PSP reconciliation variance $\ne 0$, stale FX rate feed, failed webhook signature, or reserve utilization exceeding threshold bands.

## 22. Explicit Non-Goals & Scope Guardrails
- `M08` software validation is **not** a substitute for external CPA/legal tax certification (`Correction 06`).
- `M08` explicitly prohibits open, uncurated third-party marketplace listings (`v5.16 Ch. 02`, `Ch. 08`).

## 23. Downstream Unlocks
- Unlocks **Release Level A Gate** and **`M09` (Controlled Commercial Pilot)**.

## 24. Definition of Done Checklist
- [ ] 8-role `ProductOfferContract` validator and Own-Label tenant isolation enforced.
- [ ] ISO 4217 currency registry (`0|2|3|4` minor-unit exponents), explicit rounding policy, and `ExchangeRateSnapshot` provenance active.
- [ ] Dual-currency ACID PostgreSQL double-entry ledger active with zero-imbalance database triggers and FX gain/loss accounts (`4810`/`5810`).
- [ ] All 8 canonical management metrics (`v5.16 Ch. 12`) computed and verified across 5,000 multi-currency property-test lifecycles.
