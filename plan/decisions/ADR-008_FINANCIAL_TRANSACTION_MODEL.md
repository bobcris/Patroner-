# ADR-008 — DOUBLE-ENTRY FINANCIAL LEDGER & MULTI-PARTY SETTLEMENT ARCHITECTURE

- **ADR ID:** `ADR-008`
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 08`, `Ch. 12`, `App. F`), `Patroner_Monograph_v5.15_Commercial_Ecosystem_Update.pdf`, `REQ-FIN-01`

---

## 1. Context & Problem Statement
Each physical garment transaction in Patroner involves multiple financial counter-parties and timing boundaries: customer checkout capture, PSP processing fees, VAT/sales tax accrual, raw fabric lot allocation, workshop milestone payables (`M07`), return/remake reserve holdbacks, and creator royalty splits (`M08`). Storing mutable `order_total` columns or relying solely on external Stripe dashboard balances makes Principal-vs-Agent revenue recognition, return-window holdbacks, and advance recoupment waterfalls impossible to audit (`RSK-08`).

## 2. Decision
1. **Internal Authoritative ACID Double-Entry Ledger (`services/fashion-engine/app/commerce_and_finance/ledger/`):**
   - All financial events are recorded as immutable, append-only `JournalEntry` records in PostgreSQL (`SERIALIZABLE` isolation) containing two or more `JournalLine` items in integer minor currency units (cents).
   - Database constraint triggers enforce $\sum \text{debit\_minor\_units} == \sum \text{credit\_minor\_units} > 0$ on every entry and prohibit `UPDATE`/`DELETE`.
2. **Explicit Separation of Principal vs. Agent Recognition & VAT:**
   - Derived deterministically from `ProductOfferContract.seller_of_record_org_id` and `accounting_mode`:
     - **Principal Mode (`OWN_LABEL_PRINCIPAL` / `BRAND_STUDIO_MANAGED_VENTURE`):** Recognizes gross product revenue (`4010`) upon shipment/delivery net of return reserve (`2500`), and records fabric + workshop make + creator royalty as direct COGS (`5010`).
     - **Agent Mode (where external enterprise brand is Seller of Record):** Recognizes only Patroner's orchestration commission (`4020`) as revenue and holds third-party funds in segregated clearing liabilities.
3. **Mandatory Return/Remake Reserve Holdbacks & Settlement Gating:**
   - Workshop payables (`2300`) release upon `M07` final POM QC pass (`PASS_FIRST_QUALITY`).
   - Creator royalty payables (`2400`) accrue upon delivery with a contractual reserve holdback (`2500`) that releases only after the customer return/alteration window expires (`14/30 days`), subject to `M10` advance recoupment waterfalls.

## 3. Consequences & Enforcement
- **Positive:** Guarantees penny-exact auditability, automated calculation of the 8 `v5.16 Ch. 12` management metrics, and zero unreserved payout leakage.
- **Enforcement (`AC-12`, `Gate F.9`):** Verified by `Hypothesis` 5,000-lifecycle stateful property tests and daily PSP-to-ledger zero-variance reconciliation checks.
