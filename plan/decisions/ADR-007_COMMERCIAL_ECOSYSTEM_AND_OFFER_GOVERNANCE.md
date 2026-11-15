# ADR-007 — COMMERCIAL ECOSYSTEM SEPARATION & 8-ROLE OFFER GOVERNANCE

- **ADR ID:** `ADR-007`
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 02`, `Ch. 08`, `Ch. 12`), `Patroner_Monograph_v5.15_Commercial_Ecosystem_Update.pdf`, `REQ-COM-01`

---

## 1. Context & Problem Statement
Fashion platforms that blur B2B software tooling, first-party apparel retail, and third-party creator capsules without explicit legal and operational boundaries suffer from confused IP ownership, unallocated custom-fit return liabilities, Principal-vs-Agent tax audit failures, and uneven manufacturing quality (`RSK-08`).

## 2. Decision
1. **Strict Separation of Three Commercial Operating Modes (`v5.16 Ch. 02` & `Ch. 08`):**
   - **Engine 1 — B2B / Pro Platform SaaS:** Subscription and usage-metered access to Patroner's engineering workspace for external brands and patternmakers.
   - **Engine 2A — Patroner Own-Label Capsules:** First-party garments designed, manufactured, quality-assured, and sold by Patroner as Principal.
   - **Engine 2B — Managed Brand Studio Creator Ventures:** Curated, contractually governed co-created capsules with selected creators/designers/celebrities managed through Patroner's qualified maker network.
   - **Explicit Prohibition:** Patroner **will not** operate an open, uncurated self-serve third-party marketplace where external sellers list unverified garments.
2. **Mandatory 8-Role `ProductOfferContract` (`REQ-COM-01`):**
   No garment offer may be activated or sold unless an immutable `ProductOfferContract` binds non-null `Organization` IDs to all **8 commercial governance roles**:
   1. `brand_owner_org_id`
   2. `ip_owner_org_id`
   3. `seller_of_record_org_id`
   4. `manufacturing_principal_org_id`
   5. `maker_of_record_org_id`
   6. `fulfillment_owner_org_id`
   7. `customer_support_owner_org_id`
   8. `return_risk_bearer_org_id`
3. **Hard Link to `SignedManufacturingReleasePackage` (`is_production_ready: true`):**
   - Every `ProductOfferContract` must reference a cryptographically verified `SignedManufacturingReleasePackage` (`M05` + `M07`).

## 3. Consequences & Enforcement
- **Positive:** Eliminates ambiguity over who owns pattern IP, who acts as Seller of Record for VAT, who pays the workshop, and who absorbs return/remake costs.
- **Enforcement (`AC-12`):** Enforced by database NOT NULL constraints and `offer_contract.py` validation before checkout activation.
