# ADR-008 — MULTI-CURRENCY DOUBLE-ENTRY FINANCIAL LEDGER & MULTI-PARTY SETTLEMENT ARCHITECTURE (`R2.1.2`)

- **ADR ID:** `ADR-008`
- **Revision:** `2.1.2` (Targeted Mathematical Correction, Numerical Assurance & Governance Alignment)
- **Status:** `APPROVED (Policy per v5.16 Ch. 08, Ch. 12 & App. F) / PROPOSED (Concrete Multi-Currency Chart-of-Accounts, Tax Profiles & FX Schema — Requires Finance/Legal/CPA Governance Approval per DEC-08, DEC-12; Blocks M08 Production Sign-Off & Gate Auth-4 for M09)`
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 08`, `Ch. 12`, `App. F`), `Patroner_Monograph_v5.15_Commercial_Ecosystem_Update.pdf`, `REQ-FIN-01`, `DEC-08`, `DEC-12`, `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`

---

## 1. Context & Problem Statement
Each physical garment transaction in Patroner involves multiple financial counter-parties, jurisdictions, and timing boundaries: customer checkout capture, PSP processing fees, VAT/GST/sales tax accrual, raw fabric lot allocation, workshop milestone payables (`M07`), return/remake reserve holdbacks, and creator royalty splits (`M08`).

In Blueprint R2, `ADR-008` and `M08` contained hard-coded single-currency/single-jurisdiction phrasing (`EUR cents`, `EU OSS VAT`) that conflicted with `v5.16`'s international platform vision. A production-grade financial ledger must support multi-currency, multi-jurisdiction transactions natively while distinguishing between the **configurable single operating jurisdiction/currency of the `M09` controlled commercial pilot (`DEC-12`)** and **full cross-currency settlement at scale (`M10`)**. Per `07_RISK_AND_OPEN_DECISIONS_REGISTER.md` (`Critical Correction E`), CPA/legal sign-off on `ADR-008 Schema`, `DEC-08`, and `DEC-12` gates **`M08` production financial sign-off and `M09` Pilot Entry (`Gate Auth-4`)** and does **not** block unrelated foundational migration work (`M00`, `Gate Auth-1`) or geometry/simulation engineering (`M02`/`M06`, `Gate Auth-2`/`Gate Auth-3`).

---

## 2. Decision (Proposed Concrete Ledger & Multi-Currency Specification)

### 2.1 Multi-Currency Identity, Variable Minor-Unit Exponents & Integer Storage
1. **ISO 4217 Currency Identity & Variable Exponent (`CurrencySpec`):**
   - No currency code (`EUR`, `USD`, `GBP`, `JPY`, `KWD`, etc.) is hardcoded in database schemas or domain logic.
   - Every monetary amount is bound to an ISO 4217 `currency_code: str` (`CHAR(3)`) and its corresponding `minor_unit_exponent: Literal[0, 2, 3, 4]` from the `currency_registry` table:
     - `0` for zero-decimal currencies (e.g., `JPY`, `KRW`),
     - `2` for two-decimal currencies (e.g., `EUR`, `USD`, `GBP`, `CHF`),
     - `3` for three-decimal currencies (e.g., `KWD`, `BHD`, `JOD`, `TND`),
     - `4` for specialized unit-pricing/sub-cent clearing where required.
   - All ledger balances and line items are stored as **64-bit signed integers (`BIGINT`)** representing minor units ($M = \text{major\_amount} \times 10^{\text{minor\_unit\_exponent}}$). Floating-point types (`FLOAT`, `REAL`, `DOUBLE PRECISION`) are **strictly prohibited** in monetary storage and arithmetic.

### 2.2 Explicit Rounding Policy (`ROUND_HALF_EVEN`)
- All percentage allocations (tax calculation, royalty splits, return reserve percentages, FX conversions) execute in arbitrary-precision `decimal.Decimal` (`prec = 38`) and round to the target currency's integer minor unit ($10^{-e}$) using **banker's rounding (`decimal.ROUND_HALF_EVEN`)**, unless a specific tax jurisdiction's statutory rule (`TaxJurisdictionProfile.statutory_rounding_mode`) mandates `ROUND_HALF_UP`.
- **Zero-Remainder Allocation Rule:** When splitting a monetary amount across $k$ lines (e.g., multi-item order discount, tax allocation, or co-creator royalty split), the deterministic remainder $r = M_{\text{total}} - \sum_{i=1}^k M_i$ is allocated unit-by-unit to the largest fractional remainder lines (deterministic tie-break by `line_id`) so that the sum of rounded minor units equals $M_{\text{total}}$ with **zero residual discrepancy**.

### 2.3 Transaction Currency vs. Functional/Reporting Currency & FX Rate Provenance
- **Dual-Amount `JournalLine` Representation:**
   Every `JournalLine` records **both**:
  1. **Transaction Currency Amount:** `tx_currency: CHAR(3)`, `tx_minor_unit_exponent: SMALLINT`, `tx_debit_minor: BIGINT`, `tx_credit_minor: BIGINT`.
  2. **Functional / Reporting Currency Amount:** `func_currency: CHAR(3)` (defined per `Organization` / legal entity), `func_minor_unit_exponent: SMALLINT`, `func_debit_minor: BIGINT`, `func_credit_minor: BIGINT`.
- **Immutable FX Rate Provenance (`FXRateSnapshot`):**
  Whenever `tx_currency != func_currency` (or when settling across currencies), the `JournalEntry` must reference an immutable `FXRateSnapshot`:
  - `fx_snapshot_id: UUID`
  - `base_currency: CHAR(3)`, `quote_currency: CHAR(3)`
  - `rate_decimal: NUMERIC(24, 12)`
  - `rate_source: Literal["ECB_REFERENCE", "PSP_SETTLEMENT_ACTUAL", "TREASURY_LOCKED_QUOTE"]`
  - `observed_at_utc: TIMESTAMPTZ`
  - `canonical_sha256: CHAR(64)`
- **Dual Double-Entry Balancing Invariant:**
  PostgreSQL `SERIALIZABLE` constraint triggers verify on every `JournalEntry` that:
  1. For each distinct `tx_currency` within the entry (or converted via the entry's `FXRateSnapshot`), debits and credits balance, **and**
  2. In the entity's `func_currency`, $\sum \text{func\_debit\_minor} == \sum \text{func\_credit\_minor} > 0$.

### 2.4 Realized & Unrealized FX Gain/Loss Treatment & Cross-Currency Settlement
- **Realized FX Gain / Loss (`Accounts 4810 / 5810`):**
  When an invoice, customer capture (`1010`), workshop payable (`2300`), or creator royalty payable (`2400`) is recorded at an initial booking FX rate $R_{\text{book}}$ (`ECB_REFERENCE` or `TREASURY_LOCKED_QUOTE`) and subsequently settled by the PSP (`Stripe`) or bank in functional currency at actual settlement rate $R_{\text{settle}}$ (`PSP_SETTLEMENT_ACTUAL`), the functional-currency delta $\Delta_{\text{func}} = \text{round}(M_{\text{tx}} \cdot (R_{\text{settle}} - R_{\text{book}}))$ is automatically posted to `4810_REALIZED_FX_GAIN` or `5810_REALIZED_FX_LOSS`.
- **Period-End Unrealized FX Revaluation (`Account 4820`):**
  Open foreign-currency monetary receivables/payables (`1010`, `2300`, `2400`) are revalued at period-end closing reference rates into `4820_UNREALIZED_FX_REVALUATION` (with automatic reversal at the start of the next accounting period).
- **PSP Multi-Currency Reconciliation (`M08.5`):**
  Daily automated reconciliation matches PSP balance transactions (`charge`, `refund`, `dispute`, `payout`, `transfer`, `exchange_margin`) against `JournalEntry` records in both `tx_currency` and settled `func_currency`, verifying `unexplained_variance_minor == 0`.

### 2.5 Configurable Tax & Accounting Policy (`TaxJurisdictionProfile`)
- Tax calculation and reporting are driven by a versioned `TaxJurisdictionProfile` (`jurisdiction_code`, `tax_regime: Literal["VAT_EU_OSS", "VAT_UK", "SALES_TAX_US", "GST_CA", "VAT_STANDARD", "EXEMPT_EXPORT"]`, `rate_bps`, `statutory_rounding_mode`, `tax_payable_account_code`) bound to the `ProductOfferContract` and customer shipping destination, rather than hardcoded to a single region.
- **Principal vs. Agent Recognition:** Derived deterministically from `ProductOfferContract.seller_of_record_org_id` and `accounting_mode`:
  - **Principal Mode (`OWN_LABEL_PRINCIPAL` / `BRAND_STUDIO_MANAGED_VENTURE`):** Recognizes gross product revenue (`4010`) upon shipment/delivery net of return reserve (`2500`), and records fabric + workshop make + creator royalty as direct COGS (`5010`).
  - **Agent Mode (where external enterprise brand is Seller of Record):** Recognizes only Patroner's orchestration commission (`4020`) as revenue and holds third-party funds in segregated clearing liabilities.

### 2.6 Distinction Between `M09` Pilot Operating Scope and International Platform Capability (`DEC-12`, `Gate Auth-4`)
- **Platform Architecture (`M08`):** Built natively with the multi-currency, variable-exponent (`0|2|3|4`), FX-provenance, and configurable `TaxJurisdictionProfile` schema defined in `§2.1`–`§2.5`.
- **`M09` Controlled Commercial Pilot Scope (`DEC-12`, `Gate Auth-4`):** To bound regulatory and legal surface area during the first live pilot ($\le 50$ paid orders), `M09` operates with a **single configured pilot jurisdiction and functional currency** (selected via `DEC-12` and signed off by external legal/CPA counsel prior to `Gate Auth-4` / `Release Level A` Pilot Entry) while exercising the full `M08` schema in CI. Multi-currency cross-border settlement (`EUR`/`USD`/`GBP`/`JPY`) is activated for general availability at **`Gate Auth-6` / `Release Level C` (`M10`)**.

---

## 3. Consequences & Enforcement
- **Positive:** Eliminates single-currency/single-jurisdiction hardcoding, guarantees integer minor-unit exactness across 0-, 2-, 3-, and 4-decimal ISO 4217 currencies, provides full FX auditability, and cleanly separates the `M09` pilot's regulatory gate (`Gate Auth-4`) from `M00`/`M02` technical gates (`07_RISK_AND_OPEN_DECISIONS_REGISTER.md`).
- **Enforcement (`AC-12`, `Gate F.9`):** Verified by `Hypothesis` 5,000-lifecycle stateful property tests across `EUR` (`e=2`), `USD` (`e=2`), `GBP` (`e=2`), `JPY` (`e=0`), and `KWD` (`e=3`), and daily PSP-to-ledger zero-variance reconciliation checks.
