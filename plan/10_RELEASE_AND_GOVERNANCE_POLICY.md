# 10 — RELEASE AND GOVERNANCE POLICY (`R2.1`)

**Document ID:** `PATRONER-BP-R2.1-10`  
**Status:** Authoritative 8-State Realization Lifecycle, Three-Level Release Governance (`Level A/B/C`), `isProductionReady` Gate & `Appendix F` Applicability Matrix  
**Governing Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 09`, `Ch. 11`, `Ch. 17`, `Ch. 20`, `App. F`)

---

## 1. The Canonical 8-State Realization Lifecycle (`v5.16 Ch. 09, p. 16`)

Every garment revision in the Fashion World Model (`M01`) is governed by an explicit, append-only 8-state realization lifecycle. To maintain 100% traceability between the strategic prose in `v5.16 Ch. 09 (p. 16)` and the technical state machine in `services/fashion-engine`, the table below maps each canonical `v5.16` realization state to its technical enum identifier, `isProductionReady` invariant, and required promotion gate:

```mermaid
stateDiagram-v2
  [*] --> Inspiration_Concept
  Inspiration_Concept --> AI_Proposal_Specified : Gate G1 (M04a ObservationBundle + Human Disambiguation -> GarmentIntentSpecification)
  AI_Proposal_Specified --> User_Approved_Design_Drafted : Gate G2 (M02c Body + M03 Material + M04b Recipe Compilation -> M02d/e Draft)
  User_Approved_Design_Drafted --> Specification_Validated : Gate G3 (AC-03 Certified Math + AC-05 Complete-Interval Offset/Seam + AC-06 M02g Grading)
  Specification_Validated --> Feasibility_Fit_Approved : Gate G4 (AC-08 M06 Simulation + Fit Report + M02h Marker + M05 Tech Pack + Maker Quote)
  Feasibility_Fit_Approved --> Sample_Approved : Gate G5 (AC-09 Physical Toile Trial + AC-10 100mm Plotter Check & First-Article POM QC)
  Sample_Approved --> Production_Ready_Offer : Gate G6 (AC-10 Ed25519 Signed Release Package + AC-12 8-Role Offer Contract)
  Production_Ready_Offer --> In_Production_Fulfilled : Gate G7 (M07 Work Order + Lot Traceability + Final POM QC + M08 Ledger Settlement)
  User_Approved_Design_Drafted --> Inspiration_Concept : Superseded by New Revision Node
  Specification_Validated --> AI_Proposal_Specified : Bounded Optimization Loop (Revision v4.5 / M06)
```

| # | `v5.16 Ch. 09` Canonical State Name | Technical Enum (`lifecycle_state`) | `isProductionReady` Flag | Permitted Downstream Actions | Required Promotion Gate Evidence |
| :---: | :--- | :--- | :---: | :--- | :--- |
| **1** | **Inspiration** | `Concept` (`INSPIRATION_CONCEPT`) | `false` | Reference sketch/image upload, text brief intake (`M04a`) | Authenticated project & tenant context (`M01`). |
| **2** | **AI proposal** | `Specified` (`AI_PROPOSAL_SPECIFIED`) | `false` | Epistemic inspection, human disambiguation, measurement/material binding | `M04a` `DesignObservationBundle` + human disambiguation freezing `GarmentIntentSpecification`. |
| **3** | **User-approved design** | `Drafted` (`USER_APPROVED_DESIGN_DRAFTED`) | `false` | Seam allowance, miter, notch, and assembly validation (`M02b`/`M02f`) | Confirmed `GarmentIntentSpecification` (`M04a`) + `ValidatedBodyProfile` (`M02c`) + `CalibratedMaterialSpec` (`M03`) compiled via `M04b` into `M02d`/`M02e` 2D pieces. |
| **4** | **Specification in progress** | `Validated` (`SPECIFICATION_VALIDATED`) | `false` | 3D simulation (`M06`), multi-size grading (`M02g`), marker nesting (`M02h`), tech-pack compilation (`M05`) | Passing `AC-03` (certified interval/Bernstein bounds), `AC-05` (complete-interval $t \in [0, 1]$ offset verification & seam mating), and `AC-06` (`M02g` multi-size grading). |
| **5** | **Feasibility reviewed** | `Fit_Approved` (`FEASIBILITY_FIT_APPROVED`) | `false` | Sample cutting order & physical toile trial at qualified workshop (`M07`) | Passing `AC-08` (`M06` simulation convergence & `FitEvaluationReport`), `M02h` validated marker, `M05` `ManufacturingTechPack`, `M07.1` maker capability/quote match, and human patternmaker approval. |
| **6** | **Sample approved** | `Sample_Approved` (`SAMPLE_APPROVED`) | `false` | Cryptographic production release signing & commercial offer binding | Physical $100.0\text{ mm}$ plotter calibration check ($\pm 0.1\text{ mm}$) + physical first-article sample measured and approved against POM tolerances (`AC-09`, `AC-10`, `M07.2`). |
| **7** | **Production-ready offer** | `Production_Ready` (`PRODUCTION_READY_OFFER`) | **`true`** *(Revision-Scoped)* | Commercial checkout (`M08`/`M09`) & production work-order dispatch (`M07.4`) | RFC 8785 canonical JSON manifest + SHA-256 Merkle root + Ed25519 signature (`SignedManufacturingReleasePackage`) + 8-role `ProductOfferContract` (`AC-10`, `AC-11`, `AC-12`). |
| **8** | **In production / fulfilled** | `In_Production_Completed` (`IN_PRODUCTION_FULFILLED`) | **`true`** *(Locked)* | Shop-floor operation logging, final POM QC, shipment, financial settlement | Complete `WorkOrderOperationLog`, lot traceability, final POM inspection pass (`M07.5`), and balanced double-entry ledger settlement (`M08`). |

---

## 2. Hard Invariant on `isProductionReady: false`

1. **Global Default:** Across all software builds in `M00` through `M06`, `isProductionReady` **must remain `false`** by default on all pattern, grading, marker, and piece-production-sheet artifacts.
2. **Prohibition on Manual Override:** No UI toggle, query parameter, or client payload may set `isProductionReady: true`.
3. **Cryptographic Promotion Function:** In `services/fashion-engine`, `is_production_ready` is a computed read-only property derived exclusively from the presence of a valid, non-revoked `SignedManufacturingReleasePackage` (`State 7`) linking a `Validated` + `Fit_Approved` revision (`AC-03`, `AC-05`, `AC-06`, `AC-08`), a signed `PhysicalSampleApprovalRecord` (`AC-09`, `AC-10`), and a qualified `MakerOfRecord` capability match (`M07`).

---

## 3. Three-Level Release Governance & `v5.16 Appendix F` Applicability Matrix (`Correction 03`)

To eliminate any circular dependency where `M10` enterprise capabilities would block the `M09` Controlled Commercial Pilot (`Correction 03`), release governance is partitioned into **Level A (Engineering & Controlled Pilot Entry)**, **Level B (`M09` Pilot Exit Acceptance)**, and **Level C (`M10` Enterprise & Institutional Scale Release)**.

All 10 institutional gates of `v5.16 Appendix F (p. 41)` are preserved in full and mapped to their exact release stage below:

| `v5.16 Appendix F` Gate | Institutional Requirement | **Level A: Engineering & Controlled Pilot Entry (`M09` Entry Gate)** | **Level B: `M09` Pilot Exit Acceptance (Unlocks `M10`)** | **Level C: Enterprise & Institutional Scale Release (`M10` Exit Gate)** |
| :--- | :--- | :--- | :--- | :--- |
| **Gate F.1 — System-of-Systems Boundary Integrity** (`Addendum v4.1`) | Zero authoritative domain math, grading, marker, simulation, or approval execution in client UI. | **MANDATORY (`AC-04`):** CI AST verification & bundle audit for Vertical Slice & pilot surfaces. | **MAINTAINED:** Zero boundary regressions during live pilot operations. | **MANDATORY:** Extended to enterprise white-label & partner API gateways (`M10.3`). |
| **Gate F.2 — Deterministic Numerical & Geometric Certification** | Certified numerical bounds (`ADR-009`) & complete-interval $[0, 1]$ offset cusp/reversal verification. | **MANDATORY (`AC-03`):** Certified `Method C1/C2/C3` bounds verified across all pilot blocks (`skirt-block-v1`, `bodice-sleeve-v1`). | **MAINTAINED:** Verified across all pilot custom-fit (`Track P3`) customer revisions. | **MANDATORY:** Verified across all expanded garment families (`trouser`, `dress`, `knit`). |
| **Gate F.3 — Cross-Size Grading, Construction & Marker Certification** | Full size-matrix seam parity, anti-cloning, and `M02h` non-overlapping marker utilization. | **MANDATORY (`AC-05`, `AC-06`):** Verified across `XS`–`XXL` / `EU 34`–`46` for pilot capsules. | **MANDATORY (Real Evidence):** Zero marker/cut-fit geometric failures across $\le 50$ pilot garments. | **MANDATORY:** Automated across multi-brand grading libraries. |
| **Gate F.4 — Material Characterization & Shrinkage Compliance** | Separation of raw test observations from calibrated parameters; physical coupon evidence. | **MANDATORY (`AC-07`):** `TIER_1_LAB` or `TIER_2_BENCHTOP` certificates for all pilot capsule fabrics. | **MANDATORY (Real Evidence):** Incoming physical roll lot shrinkage (`M07.3`) vs. post-press POM drift reconciled. | **MANDATORY:** Multi-mill supplier lot federation & automated closed-loop calibration. |
| **Gate F.5 — Simulation Convergence & Physical Toile Concordance** | Analytical solver benchmarks B1–B4 + physical vs. digital fit concordance. | **MANDATORY (`AC-08`, `AC-09`):** Solver passes B1–B4; physical toile trial passes $\le 0.5\text{ cm}$ POM concordance on pilot blocks. | **MANDATORY (Real Evidence):** Real customer fit return/remake rate $\le 8\%$ (P1/P2) and $\le 12\%$ (P3) (`AC-09`). | **MANDATORY:** Multi-pose & 3D body-scan cohort calibration across expanded categories. |
| **Gate F.6 — Manufacturing Tech-Pack, Plotter & Maker Qualification** | $100.0\text{ mm}$ physical plotter calibration, complete BOM/ISO 4915/4916/POM tech pack, and qualified makers. | **MANDATORY (`AC-10`):** Physical $100.0\text{ mm}$ check ($\pm 0.1\text{ mm}$), complete tech pack, and $\ge 2$ workshops qualified with approved physical samples. | **MANDATORY (Real Evidence):** $\ge 95\%$ first-pass final POM QC yield across all shipped pilot units (`M07.5`). | **MANDATORY:** Multi-region maker network SLA routing & automated capacity balancing. |
| **Gate F.7 — Multi-Tenant Security, RBAC+ABAC & Job Re-Authorization** | Person/Org/Tenant isolation, PostgreSQL RLS, 3-point worker re-auth, scoped workshop grants. | **MANDATORY (`AC-11`):** Zero-finding cross-tenant penetration test & mid-job revocation verification across Own-Label, Brand Studio, and Maker tenants. | **MAINTAINED:** Zero cross-tenant or workshop PII exposure incidents during pilot. | **MANDATORY:** Enterprise BYOK KMS envelope encryption & external security audit (`M10.2`). |
| **Gate F.8 — Cryptographic Provenance & Reproducibility Audit** | RFC 8785 Canonical JSON SHA-256 Merkle lineage + Ed25519 release signatures. | **MANDATORY (`AC-11`):** End-to-end replay reproducing identical digests from intent to `SignedManufacturingReleasePackage`. | **MANDATORY (Real Evidence):** 100% of shipped `GarmentSerialUnitID` units trace unbrokenly to signed release packages and fabric lots. | **MANDATORY:** Preserved under GDPR biometric crypto-shredding (`M10.2`). |
| **Gate F.9 — 8-Role Commercial Contract & Multi-Currency Double-Entry Ledger** | 8-role `ProductOfferContract`, ISO 4217 multi-currency balanced ledger, VAT/reserves, and 8 metrics. | **MANDATORY (`AC-12`):** 8-role contract enforcement, 5,000-lifecycle ledger property test, sandbox settlement dry run, and legal/tax sign-off (`DEC-12`). | **MANDATORY (Real Evidence):** $0$ minor-unit cash-to-ledger reconciliation variance across all real pilot orders, refunds, maker invoices, and creator payouts. | **MANDATORY:** Celebrity/licensed minimum-guarantee advance recoupment waterfalls (`M10.1`). |
| **Gate F.10 — Operational Resilience, Backup Restore & Privacy Governance** | Database/artifact backup restoration, incident rollback, and GDPR data retention/erasure. | **PILOT-SCOPED (`Level A`):** Single-region automated daily PostgreSQL + object-store backups with **verified pre-pilot restore test** (`RPO <= 1 hr`, `RTO <= 2 hr`) and documented GDPR erasure procedure (`M01`). | **MAINTAINED:** Zero unrecoverable data loss; timely processing of any pilot subject privacy requests. | **ENTERPRISE-SCOPED (`Level C` in `M10.2`/`M10.4`):** Multi-region active/standby automated DR drills (`RPO <= 5 min`, `RTO <= 30 min`) and automated crypto-shredding pipeline at scale. |

> **Non-Promotion Rule:** Passing **Level A** authorizes launching the capped `M09` Commercial Pilot ($\le 50$ units) — it must **never** be represented as **Level B** (proven commercial/manufacturing pilot acceptance) or **Level C** (enterprise production readiness).

---

## 4. Living Monograph & Blueprint Governance Protocol (`v5.16 Ch. 20`)

1. **No Silent Architecture Drift:** Any proposed change to system boundaries, mathematical tolerances, lifecycle states, or commercial roles requires a formal **ADR (`decisions/ADR-00X`)**, an update to `01_SOURCE_REGISTER_AND_REQUIREMENTS.md`, and explicit human approval.
2. **Evidence Classification Preservation:** Every capability reported in status updates or release notes must carry its true implementation classification (`I1`, `I2`, `P`, `D`, `M`, `X`, `R`, `H`) verified by independent tests rather than commit messages.
