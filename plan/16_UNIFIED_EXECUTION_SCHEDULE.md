# 16 — Unified Resource-Loaded Execution Schedule (`M00`–`M10` Through 31 March 2027)

**Document ID:** `PATRONER-R2.2-16`  
**Revision Layer:** `Blueprint R2.2` (`docs/r2.2-unified-execution-blueprint`)  
**Planning Window:** `2026-11-16` (`Checkpoint 12` / `Gate Auth-1`) through **`2027-03-31`** (19.3 calendar weeks / 96 engineering working days)  
**Scope Envelope:** Full Patroner Vision (**`M00`–`M10`**; strictly **NO `M11`**; zero MVP feature reduction)  
**Governance Premise:** Production code implementation in `M01`–`M10` remains gated by `Gate Auth-2` (2026-11-27 Target), `Gate Auth-3` (2027-02-05 Target), and `Gate Auth-4` (2027-02-26 Target).

---

## 1. Critical Path & Milestone Dependency Chain

```
[2026-11-16] Gate Auth-1 (APPROVED)
   │
   ▼
M00 (M00.1–M00.10 + PKG-P00-01 + DXF/Seam + R2.2 Reconcile)  [2026-11-16 → 2026-11-25]
   │
   ▼
[2026-11-27] ★ GATE AUTH-2 (DEC-13 Stage 2, DEC-02 S1, DEC-03 S1, DEC-04..06, DEC-09, DEC-11)
   │
   ├──► M01 (Monorepo, FastAPI + Next.js 15 Proxy, Auth/DB)     [2026-11-30 → 2026-12-18]
   ├──► M02 (Deterministic 2D CAD, C1-Fast/Cert, Sleeve M02b,    [2026-11-30 → 2027-01-15]
   │         Trouser Block, Offsets, Grading, NFP Nesting M02h)
   └──► M03 (3-Tier Fabric Digital Twin & Bench/KES Calibration) [2026-12-07 → 2027-01-15]
          │
          ├──► M05 (DXF-AAMA Real CAM Interop, M05.3 Gate, Ed25519) [2027-01-04 → 2027-01-29]
          └──► M06 (3D Garment Assembly & XPBD/PD Drape B1–B4)      [2027-01-04 → 2027-02-03]
                 │
                 ▼
[2027-02-05] ★ GATE AUTH-3 (Vertical Slice 1 + DEC-02/03 Stage 2 Physical Physics Audit)
   │
   ├──► M04 (Constrained AI Design Copilot & World Model)        [2027-02-08 → 2027-02-24]
   ├──► M07 (Maker Network Routing, Fit Feedback Calibration)    [2027-02-08 → 2027-02-25]
   └──► M08 (Commerce, Order State Machine, Double-Entry Escrow) [2027-02-08 → 2027-02-25]
          │
          ▼
[2027-02-26] ★ GATE AUTH-4 (DEC-07, DEC-08, DEC-10, DEC-12 Live Commercial Sign-Off)
   │
   ├──► M09 (Micro-Factory Pilot Execution & Physical Garments)  [2027-03-01 → 2027-03-22]
   └──► M10 (Observability, Deterministic Replay, SRE & Cutover) [2027-03-08 → 2027-03-31]
```

**Critical Path (Zero Total Float):**  
`Gate Auth-1` $\to$ `M00` (`2w`) $\to$ `Gate Auth-2` $\to$ `M02` (`C1-Fast`/`Cert` + `trouser-block` + `sleeve-block` `M02b` ease solver + `M02h` NFP) (`6w`) $\to$ `M05`/`M06` (`B1`–`B4` 3D Physics + Real DXF-AAMA CAM validation) (`4w` parallel) $\to$ `Gate Auth-3` $\to$ `M08` (Double-entry escrow + PSP) (`3w`) $\to$ `Gate Auth-4` $\to$ `M09` (Micro-Factory Pilot) (`3.2w`) $\to$ `M10` (Final SRE & Replay Lock `2027-03-31`).

---

## 2. Resource-Loaded Workstream Allocation Table (`M00`–`M10`)

**Core Pod Capacity Assumption (Target Baseline):** 6 Full-Time Specialist Tracks (`CompGeom`, `Physics/Fabric`, `FullStack-TS`, `Backend/Ledger`, `AI-WorldModel`, `Verification/CAM-QA`).

| Milestone | Scope Summary & Key Technical Gates | Lead & Support Tracks | Effort (Eng-Weeks) | Target Start | Target Finish | Hard Dependencies & Exit Criteria |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **`M00`** | `M00.1`–`M00.10`, `PKG-P00-01` (`uv` Python 3.12, 10k x 4 tiers, `AG-01`–`AG-17`, Krawczyk `AG-15`), Workstream B DXF/seam parity, `R2.2` Reconciliation (`15`–`18`), final consolidated Owner bundle. | `CompGeom` (1.0), `Verification/CAM-QA` (1.0), `FullStack-TS` (0.5) | **4.0** | `2026-11-16` | `2026-11-25` | `Gate Auth-1` done; emits deterministic SHA-256 bundle for `Gate Auth-2`. |
| **`Gate Auth-2`** | Owner audit of `M00` bundle + sign-off on `DEC-13 Stage 2`, `DEC-02 S1`, `DEC-03 S1`, `DEC-04`, `DEC-05`, `DEC-06`, `DEC-09`, `DEC-11`. | Project Owner + Arch Lead | **0.4** | `2026-11-26` | `2026-11-27` | **Hard Blocking Gate** before any `M01`–`M10` production code. |
| **`M01`** | Monorepo scaffolding (`apps/web`, `services/geometry-engine`, `packages/contracts`), Next.js 15 BFF/Strangler proxy, PostgreSQL 16 + S3/GCS content store, Celery/Temporal async workers, RBAC/Auth. | `FullStack-TS` (1.0), `Backend/Ledger` (1.0) | **6.0** | `2026-11-30` | `2026-12-18` | `Gate Auth-2`, `DEC-01`, `DEC-04`, `DEC-05`. Parity harness green. |
| **`M02`** | Python 3.12 deterministic 2D engine (`M02a`–`M02h`): `C1-Fast` + `C1-Cert` escalation, **`trouser-block` canonical drafting (Slice 1 gap fix)**, **`sleeve-block` `Class B` `M02b` cap-height ($H_{\mathrm{cap}}$) re-solve for target ease**, `M02c` offsets, `M02d` grading, `M02h` NFP marker solver. | `CompGeom` (1.5), `Verification/CAM-QA` (0.5) | **12.0** | `2026-11-30` | `2027-01-15` | `DEC-13 Stage 2`, `DEC-06`, `DEC-11`. `100%` pass on `AG-01`–`AG-17` & `DEC-11` (`<= 0.05 cm`). |
| **`M03`** | 3-Tier material characterization pipeline (`KES-FB`/`FAST`, benchtop tester, vendor bounds), fabric digital twin schemas & parameter uncertainty bounds (`ADR-005`). | `Physics/Fabric` (1.0), `Backend/Ledger` (0.25) | **6.5** | `2026-12-07` | `2027-01-15` | `DEC-03 Stage 1`, `M00.1` contracts. Physical fabric calibration dataset loaded. |
| **`M05`** | Industrial DXF-AAMA/ASTM D6673 exporter, **real external third-party CAM/CAD parser interoperability tests** (Gerber/Lectra/Optitex/CLO dialects), `M05.3` Pre-Flight Gatekeeper, `Ed25519` JCS `TechPackManifest` (`M05.5`). | `CompGeom` (0.5), `Verification/CAM-QA` (1.0), `Backend/Ledger` (0.5) | **8.0** | `2027-01-04` | `2027-01-29` | `M02` contours, `DEC-09`, `DEC-11`. `externalCadInteroperabilityVerified` flips `true` only on real external CAM pass. |
| **`M06`** | 3D seam topological stitching, Projective Dynamics / XPBD cloth drape solver (`M06.2`), Benchmarks **`B1`–`B4` ($\le 5\%$ error)**, strain/fit pressure maps, bounded fit loop. | `Physics/Fabric` (1.5), `CompGeom` (0.5) | **9.0** | `2027-01-04` | `2027-02-03` | `M02` + `M03` twins, `DEC-02 Stage 1`. Passes `B1`–`B4` physical correlation. |
| **`Gate Auth-3`** | Audit Vertical Slice 1 (Bodice + Trouser + Sleeve + Skirt E2E to signed DXF) + `DEC-02 Stage 2` + `DEC-03 Stage 2`. | Project Owner + QA Lead | **0.4** | `2027-02-04` | `2027-02-05` | Unlocks `M04`, `M07`, `M08`. |
| **`M04`** | Constrained Generative AI Copilot (`StyleIntentProposal` JSON only, zero raw coordinate generation per `ADR-004`), Garment World Model provenance & deterministic recipe compiler. | `AI-WorldModel` (1.5), `FullStack-TS` (0.5) | **5.5** | `2027-02-08` | `2027-02-24` | `Gate Auth-3`, `M02` compiler, `M05.3` gatekeeper. |
| **`M07`** | Maker network capability matching, micro-factory routing, post-fit grading calibration & return-loop telemetry. | `Backend/Ledger` (0.75), `Physics/Fabric` (0.5) | **3.5** | `2027-02-08` | `2027-02-25` | `Gate Auth-3`, `M02d`, `M06.4`. |
| **`M08`** | Storefront checkout (`apps/web`), Order State Machine, Stripe Connect PSP integration, **ACID Double-Entry Escrow Sub-Ledger (`ADR-008`)** & idempotent webhook reconciliation. | `Backend/Ledger` (1.0), `FullStack-TS` (1.0) | **5.5** | `2027-02-08` | `2027-02-25` | `Gate Auth-3`, `M01`, `M05.5` manifest linkage. Zero-sum ledger invariant tests pass. |
| **`Gate Auth-4`** | Sign-off on `DEC-07` (body intake), `DEC-08` (live PSP), `DEC-10` (pilot capsule), `DEC-12` (jurisdiction/tax compliance). | Project Owner + Legal/Fin | **0.4** | `2027-02-26` | `2027-02-26` | **Hard Blocking Gate** before live customer transactions / `M09`. |
| **`M09`** | Commercial micro-factory capsule pilot (live customer intake $\to$ signed DXF $\to$ cut/sew $\to$ physical fit inspection `<= 0.20 cm` $\to$ escrow release). | `Verification/CAM-QA` (1.0), `Backend/Ledger` (0.5), `CompGeom` (0.5) | **6.0** | `2027-03-01` | `2027-03-22` | `Gate Auth-4` + physical factory turnaround (2-week wet/sew cycle). |
| **`M10`** | OpenTelemetry observability, deterministic replay verification across recorded production revisions, chaos/failover drills, SLO & SRE production handoff. | `Backend/Ledger` (1.0), `FullStack-TS` (0.5), `Verification/CAM-QA` (0.5) | **6.0** | `2027-03-08` | `2027-03-31` | `M09` telemetry feed; zero open critical defects; full deterministic replay bundle passes. |

---

## 3. Three-Scenario Schedule & Risk-Buffer Matrix

| Scenario | Key Assumptions | Total Schedule Buffer | `Gate Auth-2` Date | `Gate Auth-3` Date | `Gate Auth-4` Date | `M10` Full Vision Finish | Status Relative to `2027-03-31` Deadline |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **1. Target Plan (Nominal)** | `Gate Auth-2` clears on `2026-11-27`; `python-flint` or `mpmath.iv` requires zero solver kernel rework; `B1`–`B4` 3D physics converges in single calibration pass; factory sewing turnaround `<= 10` business days. | `7 days` embedded in `M09/M10` overlap | `2026-11-27` | `2027-02-05` | `2027-02-26` | **`2027-03-26`** (`5` days margin) | **ON TIME** |
| **2. Risk-Adjusted Plan (P80)** | Absorbs realistic slippage: +3d Owner review at `Gate Auth-2`; +5d for `trouser-block` + `sleeve-block` `H_cap` `Class B` iteration + `M05` third-party CAM parser quirks; +5d on `B1`–`B4` drape tuning in `M06`. | Absorbs `+13` slippage days via `M02`/`M05` & `M04`/`M07`/`M08` parallel overlap | `2026-12-01` | `2027-02-17` | `2027-03-05` | **`2027-03-31`** (`0` days margin) | **AT DEADLINE (`2027-03-31`)** |
| **3. Recovery Plan (Mitigation Triggered if `Gate Auth-3` Slips Past `2027-02-19`)** | Triggered if `M06` `B1`–`B4` physical correlation or external CAM vendor round-trip hits blockers: decouple non-blocking `M04` advanced stylistic templates to post-pilot `M10` hardening sprint while preserving all `M00`–`M10` functional capabilities; add dedicated 2nd micro-factory partner slot + weekend CI qualification runs. | Recovers **`10` calendar days** on `M07`–`M09` chain | `2026-12-01` | `2027-02-19` | `2027-03-08` | **`2027-03-31`** (All `M00`–`M10` delivered) | **RECOVERABLE WITHOUT MVP REDUCTION** |

---

## 4. Immediate Pre-`Gate Auth-2` Action Queue (Next 5 Working Days)

1. **Resolve Vertical Slice 1 Drafting Completeness Baseline (`M02a` / `M00` Entry):** Scope `src/engine/drafting/trouser-block.ts` specification & `sleeve-block.ts` cap-height (`H_cap`) `Class B` upgrade inside `M02` sprint 1 immediately upon `Gate Auth-2` opening.
2. **Owner Review Package Consolidation (`M00.10`):** Combine Workstream A (`feat/m00-p00-qualification`, `d1a7940`) + Workstream B (`feat/m00-production-dxf-verification`, `d5a7075`) + Workstream C (`docs/r2.2-unified-execution-blueprint`) for single-pass **`Gate Auth-2` + `DEC-13 Stage 2`** Project Owner decision.
3. **Zero Premature Execution:** No `M01`/`M02`/`M03` production merges to `main` occur prior to explicit signed `Gate Auth-2` authorization record.
