# ADR-007 — COMMERCIAL ECOSYSTEM SEPARATION & 8-ROLE OFFER GOVERNANCE

- **ADR ID:** `ADR-007`
- **Revision:** `2.1` (Controlled Architecture, Dependency, Numerical Assurance & Release-Governance Correction)
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 02`, `Ch. 08`, `Ch. 12`), `Patroner_Monograph_v5.15_Commercial_Ecosystem_Update.pdf`, `REQ-COM-01`

---

## 1. Context & Problem Statement
Fashion platforms that blur B2B software tooling, first-party apparel retail, and third-party creator capsules without explicit legal and operational boundaries suffer from confused IP ownership, unallocated custom-fit return liabilities, Principal-vs-Agent tax audit failures, and uneven manufacturing quality (`RSK-08`).

---

## 2. Decision
1. **Strict Separation of Three Commercial Operating Modes (`v5.16 Ch. 02` & `Ch. 08`):**
   - **Engine 1 — B2B / Pro Platform SaaS (`B2B_SAAS_SUBSCRIPTION`):** Subscription and usage-metered access to Patroner's engineering workspace for external brands and patternmakers.
   - **Engine 2A — Patroner Own-Label Capsules (`OWN_LABEL_PRINCIPAL`):** First-party garments designed, manufactured, quality-assured, and sold by Patroner as Principal.
   - **Engine 2B — Managed Brand Studio Creator Ventures (`BRAND_STUDIO_MANAGED_VENTURE`):** Curated, contractually governed co-created capsules with selected creators/designers/celebrities managed through Patroner's qualified maker network.
   - **Explicit Prohibition:** Patroner **will not** operate an open, uncurated self-serve third-party marketplace where external sellers list unverified garments.
2. **Mandatory 8 Canonical `v5.16 Ch. 08` Accountable Roles + Structural Governance IDs (`REQ-COM-01`):**
   No garment offer may be activated or sold unless an immutable `ProductOfferContract` binds non-null `Organization` IDs to all **8 canonical `v5.16 Ch. 08` accountable roles**:
   1. **Seller of Record (`seller_of_record_org_id`)**
   2. **Design & Pattern IP Owner (`design_and_pattern_ip_owner_org_id`)**
   3. **Manufacturing Counterparty (`manufacturing_counterparty_org_id` + `maker_of_record_org_id`)**
   4. **Quality Release Authority (`quality_release_authority_org_id`)**
   5. **Inventory & Make Risk Holder (`inventory_and_make_risk_holder_org_id`)**
   6. **Fulfillment & Logistics Operator (`fulfillment_and_logistics_operator_org_id`)**
   7. **Customer Service & Returns Owner (`customer_service_and_returns_owner_org_id` + `return_risk_bearer_org_id`)**
   8. **Royalty / Revenue Share Beneficiary (`royalty_revenue_share_beneficiary_org_id` + `brand_owner_org_id`)**
3. **Hard Link to `SignedManufacturingReleasePackage` (`is_production_ready: true`):**
   - Every `ProductOfferContract` must reference a cryptographically verified `SignedManufacturingReleasePackage` (`M05` + `M07`).

---

## 3. Consequences & Enforcement
- **Positive:** Eliminates ambiguity over who owns pattern IP, who acts as Seller of Record for VAT/GST/sales tax, who pays the workshop, who signs quality release, and who absorbs inventory/make and return/remake costs.
- **Enforcement (`AC-12`):** Enforced by database NOT NULL constraints and `offer_contract.py` validation before checkout activation.
