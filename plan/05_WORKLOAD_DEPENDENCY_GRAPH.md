# 05 — Workload Dependency Graph, Critical Path, and Gate Topology

**Document ID:** `PATRONER-R2.1.2-R1-05`  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Governance Alignment)  
**Governing Authority:** Monograph v5.16; Addendum v4.1; Revision v4.5; `ADR-001`–`ADR-009` (`R2.1.2-R1`); `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`  
**Status:** **CONTROLLED SPECIFICATION — M00 REMAINS BLOCKED PENDING EXPLICIT OWNER APPROVAL**

> **Governance Rule (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Authoritative 4-Gate Release & Authorization Topology

All engineering execution across `M00`–`M11` is governed by four hard Owner Authorization Gates (`Gate Auth-1` through `Gate Auth-4`). No workload may begin before its prerequisite gate and all mapped Open Decisions (`DEC-01` through `DEC-13`) are formally signed off by the Project Owner.

```
[BLUEPRINT R2.1.2-R1 SPECIFICATION BASELINE]
       │
       ▼
╔════════════════════════════════════════════════════════════════════════════╗
║ GATE AUTH-1: Pre-M00 Architecture, Math & Candidate Selection Sign-Off     ║
║ • Approves ADR-001..ADR-009 (R2.1.2-R1)                                    ║
║ • Resolves DEC-01 (Monorepo & Cutover Policy)                              ║
║ • Resolves DEC-13 Stage 1 (Candidate Interval & Root-Isolation Library     ║
║   Selection for M00.4 Evaluation: mpmath.iv + Fraction primary candidate)  ║
╚════════════════════════════════════════════════════════════════════════════╝
       │
       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ M00: Pre-Migration Verification, Contracts & Reference Oracle (M00.1–.10)  │
│ • M00.1: Canonical JSON/Pydantic Schemas & Coordinate Frame                │
│ • M00.2: C0-Legacy Snapshot & BaselineDivergenceRegistry.json              │
│ • M00.4: IntervalLibraryQualificationReport (future deliverable) +         │
│          C1-Cert Oracle + 17-Family Adversarial Geometry Suite (AG-01..17) │
│ • M00.10: Reproducible Verification Bundle & Gate Auth-2 Audit Package     │
└────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
╔════════════════════════════════════════════════════════════════════════════╗
║ GATE AUTH-2: Post-M00 Verification Audit & Core Platform Entry Sign-Off    ║
║ • Audits completed M00.1–M00.10 evidence & IntervalLibraryQualification    ║
║ • Resolves DEC-13 Stage 2 (Production Interval Library Adoption for M02)   ║
║ • Resolves DEC-02 Stage 1 (3D Simulation Kernel Selection for M06.2)       ║
║ • Resolves DEC-03 Stage 1 (Material Testing Hardware & Tier Policy)        ║
║ • Resolves DEC-04 (PostgreSQL 16 + Object Store Architecture for M01)      ║
║ • Resolves DEC-05 (Async Task Queue & Workflow Orchestrator for M01.4)     ║
║ • Resolves DEC-06 (2D Nesting & Marker Engine Selection for M02h)          ║
║ • Resolves DEC-09 (Cryptographic Signing Standard for M05.5)               ║
║ • Resolves DEC-11 (Paired Seam Tolerance Reconciliation: 0.05 vs 0.20 cm)  ║
╚════════════════════════════════════════════════════════════════════════════╝
       │
       ╠══════════════════════════════════════╦══════════════════════════════╗
       ▼                                      ▼                              ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐  ┌─────────────────────────┐
│ M01: Platform Foundation    │  │ M02: Deterministic Fashion  │  │ M03: Material Physics   │
│ (Next.js 15 + FastAPI + DB) │  │ Engine (M02a–M02h, C1-Fast  │  │ & Digital Twin Library  │
│                             │  │ + C1-Cert Escalation)       │  │ (M03.1–M03.4)           │
└──────────────┬──────────────┘  └──────────────┬──────────────┘  └────────────┬────────────┘
               │                                │                              │
               └───────────────┬────────────────┴──────────────┬───────────────┘
                               ▼                               ▼
                ┌─────────────────────────────┐ ┌─────────────────────────────┐
                │ M05: Manufacturing Docs &   │ │ M06: 3D Assembly & Fit      │
                │ Pre-Flight Gatekeeper       │ │ Prediction (M06.1–M06.5)    │
                └──────────────┬──────────────┘ └──────────────┬──────────────┘
                               │                               │
                               └───────────────┬───────────────┘
                                               ▼
╔════════════════════════════════════════════════════════════════════════════╗
║ GATE AUTH-3: Vertical Slice 1 (Bodice + Trouser) & Physics Qualification   ║
║ • Audits Vertical Slice 1 E2E (M01 + M02 + M05) against AG-01..AG-17       ║
║ • Audits DEC-02 Stage 2 (B1–B4 3D Cloth Simulation Benchmark Pass)         ║
║ • Audits DEC-03 Stage 2 (Empirical Fabric Correlation Study)               ║
║ • Confirms DEC-04, DEC-05, DEC-06, DEC-09, DEC-11 Production Readiness     ║
╚════════════════════════════════════════════════════════════════════════════╝
       │
       ╠══════════════════════════════════════╦══════════════════════════════╗
       ▼                                      ▼                              ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐  ┌─────────────────────────┐
│ M04: Constrained Generative │  │ M07: Fit Intelligence &     │  │ M08: E-Commerce, Order  │
│ AI Copilot (M04.1–M04.4)    │  │ Return-Loop Calibration     │  │ & Sub-Ledger (M08.1–.5) │
└──────────────┬──────────────┘  └──────────────┬──────────────┘  └────────────┬────────────┘
               │                                │                              │
               └───────────────┬────────────────┴──────────────┬───────────────┘
                               ▼                               ▼
╔════════════════════════════════════════════════════════════════════════════╗
║ GATE AUTH-4: Commercial Pilot & Financial Compliance Sign-Off (Pre-M09)    ║
║ • Resolves DEC-07 (Customer Body Acquisition Mode for Pilot)               ║
║ • Resolves DEC-08 (PSP & Sub-Ledger Production Integration)                ║
║ • Resolves DEC-10 (First Commercial Pilot Capsule Garment Mix)             ║
║ • Resolves DEC-12 (Pilot Operating Jurisdiction & Tax Sign-Off)            ║
╚════════════════════════════════════════════════════════════════════════════╝
       │
       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ M09: Micro-Factory Pilot → M10: Observability/SRE → M11: Ecosystem Scale   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Four-Stage Decision Lifecycle for Numerical Certification (`DEC-13` & `ADR-009 §7.2`)

To prevent any circular dependency between `Gate Auth-1`, `M00.4`, and `Gate Auth-2`, the selection, qualification, verification, and production adoption of the interval & polynomial root-isolation stack follow a strictly ordered **4-Decision / 4-Stage Governance Lifecycle**:

| Lifecycle Stage | Decision / Artifact | Gate / Milestone | Scope & Authority Boundary |
| :--- | :--- | :--- | :--- |
| **Stage 1: Candidate Selection** | `DEC-13 Stage 1` | **`Gate Auth-1`** (Pre-`M00`) | Owner approves the **candidate evaluation order** for `M00.4`: Primary candidate `mpmath.iv` (`53-bit` screen + `113-bit` quad tier) + Python `fractions.Fraction`; Secondary candidate `python-flint` (`arb`); Tertiary fallback pure-Python `Fraction` + `decimal.Decimal` (`prec=50`) with explicit `ROUND_FLOOR`/`ROUND_CEILING`. Does **not** assume qualification has already passed. |
| **Stage 2: Library Qualification** | `IntervalLibraryQualificationReport` | **`M00.4`** (Future Execution) | Engineering executes the qualification benchmark suite on the target Linux x86_64/ARM64 container (`Python 3.12`), verifying directed outward rounding, rigorous polynomial enclosure, absence of false negatives on grazing roots ($f(t^*)=0, f'(t^*)=0$), and execution latency (`<= 50 ms` per curve). |
| **Stage 3: Oracle Implementation Verification** | `C1-Cert` Oracle + **17-Family Adversarial Suite (`AG-01`–`AG-17`)** | **`M00.4` & `M00.10`** (Future Execution) | Engineering implements the `C1-Cert` reference oracle using the qualified library and verifies 100% classification accuracy across all 6 offset categories (`Category 1`, `2a`, `2b`, `2c`, `3`, `4`) and all 17 adversarial test families (`AG-01`–`AG-17`, including `AG-11` $\mathbf{B}(t) = (t^3, 0)$). |
| **Stage 4: Production Adoption Sign-Off** | `DEC-13 Stage 2` | **`Gate Auth-2`** (Post-`M00`, Pre-`M02`) | Owner reviews the completed `IntervalLibraryQualificationReport` and `M00.10` verification bundle and signs off on binding the qualified library into the production `M02` (`C1-Fast` + `C1-Cert` fallback) engine. |

> **Non-Bypass Rule (`SPIKE-DEC13-01`):** Any optional pre-`M00` benchmark spike (`SPIKE-DEC13-01`) is non-binding exploratory research only and **cannot** substitute for `DEC-13 Stage 1` (`Gate Auth-1`), the formal `IntervalLibraryQualificationReport` in `M00.4`, or `DEC-13 Stage 2` (`Gate Auth-2`).

---

## 3. Complete Workload Dependency & Gate Mapping Table (`M00`–`M11`)

| Workload | Title | Hard Prerequisite Workloads | Required Authorization Gate | Governing Open Decisions (`DEC-01`–`DEC-13`) |
| :--- | :--- | :--- | :--- | :--- |
| **`M00`** | Pre-Migration Verification, Contracts & Reference Oracle (`M00.1`–`M00.10`) | None (Entry Workload) | **`Gate Auth-1`** (Blocks `M00` start) | `DEC-01` (Monorepo/Cutover), `DEC-13 Stage 1` (Candidate Interval Library Selection) |
| **`M01`** | Platform Foundation, Contracts & Dual-Engine Proxy (`M01.1`–`M01.5`) | `M00` (`M00.1`–`M00.10` complete) | **`Gate Auth-2`** (Blocks `M01` start) | `DEC-01`, `DEC-04` (PostgreSQL 16 + S3/GCS), `DEC-05` (Task Queue/Orchestrator) |
| **`M02`** | Deterministic 2D Fashion & Geometry Engine (`M02a`–`M02h`) | `M00` complete; `M01.1`–`M01.2` contracts | **`Gate Auth-2`** (Blocks `M02` start) | `DEC-13 Stage 2` (Production Interval Library), `DEC-06` (`M02h` Nesting Engine), `DEC-11` (Seam Tolerance Reconciliation) |
| **`M03`** | Material Physics & Fabric Digital Twin Library (`M03.1`–`M03.4`) | `M00.1` schemas; `M01.3` persistence | **`Gate Auth-2`** (Blocks `M03` start) | `DEC-03 Stage 1` (Material Testing Hardware & 3-Tier Policy) |
| **`M04`** | Constrained Generative Design Copilot (`M04.1`–`M04.4`) | `M02` (`M02a`–`M02g`), `M05.3` Gatekeeper | **`Gate Auth-3`** (Blocks `M04` prod cutover) | Bounded by `ADR-002` (Zero Direct Coordinate Emission by LLMs) |
| **`M05`** | Manufacturing Documentation & Pre-Flight Gatekeeper (`M05.1`–`M05.5`) | `M02` (`M02a`–`M02g`) | **`Gate Auth-2`** (Entry) / **`Gate Auth-3`** (Slice 1 Exit) | `DEC-09` (Cryptographic Signing Standard), `DEC-11` (`0.05 cm` CAD vs. `0.20 cm` Sewn Tolerance) |
| **`M06`** | 3D Digital Assembly & Physics Fit Prediction (`M06.1`–`M06.5`) | `M02` (`2D` patterns + seams), `M03` (Fabric Twin) | **`Gate Auth-2`** (`M06.1`–`M06.2` Entry) / **`Gate Auth-3`** (B1–B4 Exit) | `DEC-02 Stage 1` (Solver Kernel Selection at `Gate Auth-2`), `DEC-02 Stage 2` (B1–B4 Benchmark Qualification at `Gate Auth-3`) |
| **`M07`** | Fit Intelligence, Grading Calibration & Return Loop (`M07.1`–`M07.4`) | `M02d`, `M06.4`, `M01.3` | **`Gate Auth-3`** | `DEC-02`, `DEC-03`, `DEC-11` |
| **`M08`** | Commercial Platform, Order Orchestration & Sub-Ledger (`M08.1`–`M08.5`) | `M01`, `M05.5` (`TechPackManifest`) | **`Gate Auth-3`** (Dev) / **`Gate Auth-4`** (Live PSP) | `DEC-07` (Body Acquisition), `DEC-08` (PSP & Sub-Ledger), `DEC-10` (Pilot Capsule), `DEC-12` (Jurisdiction/Tax) |
| **`M09`** | Micro-Factory Manufacturing Execution & Pilot (`M09.1`–`M09.5`) | `M05`, `M06`, `M08` | **`Gate Auth-4`** (Blocks `M09` live pilot) | `DEC-07`, `DEC-08`, `DEC-09`, `DEC-10`, `DEC-11`, `DEC-12` |
| **`M10`** | Observability, Deterministic Replay & SRE (`M10.1`–`M10.4`) | `M01`, `M02`, `M05` | **`Gate Auth-2`** (Core) / **`Gate Auth-4`** (Prod SRE) | `DEC-04`, `DEC-05`, `DEC-09` |
| **`M11`** | Commercial Ecosystem & Multi-Tenant Scale (`M11.1`–`M11.4`) | `M08`, `M09`, `M10` | **Post-`Gate Auth-4` Expansion** | All `DEC-01`–`DEC-13` closed and verified in `M09` pilot |

---

## 4. Reconciled Decision-to-Gate Matrix (`DEC-01` through `DEC-13`)

Every open decision in `07_RISK_AND_OPEN_DECISIONS_REGISTER.md` maps deterministically to its governing gate(s) with zero circularity:

| Decision ID | Decision Title | Stage 1 / Entry Gate | Stage 2 / Qualification & Production Gate | Dependent Workloads |
| :--- | :--- | :--- | :--- | :--- |
| **`DEC-01`** | Frontend Cutover & Monorepo Layout | **`Gate Auth-1`** | Audited at `Gate Auth-2` | `M00.3`, `M01.1`, `M01.2` |
| **`DEC-02`** | Python 3D Cloth Simulation Solver Kernel | **`Gate Auth-2`** (Candidate Kernel Selection for `M06.2`) | **`Gate Auth-3`** (B1–B4 Benchmark Qualification Sign-Off) | `M06.2`, `M06.3`, `M06.4` |
| **`DEC-03`** | Material Testing Hardware & 3-Tier Policy | **`Gate Auth-2`** (Hardware & Tier Policy for `M03.1`) | **`Gate Auth-3`** (Empirical Correlation Study Sign-Off) | `M03.1`–`M03.4`, `M06.3` |
| **`DEC-04`** | Primary Relational & Artifact Store (`PostgreSQL 16` + S3/GCS) | **`Gate Auth-2`** (Blocks `M01.3` Entry) | **`Gate Auth-3`** (Vertical Slice 1 Persistence Audit) | `M01.3`, `M05.5`, `M08.2` |
| **`DEC-05`** | Async Task Queue & Workflow Orchestrator | **`Gate Auth-2`** (Blocks `M01.4` Entry) | **`Gate Auth-3`** (Vertical Slice 1 Job Pipeline Audit) | `M01.4`, `M02h`, `M06.2` |
| **`DEC-06`** | 2D Nesting & Marker Engine Selection | **`Gate Auth-2`** (Blocks `M02h` Entry) | **`Gate Auth-3`** (Marker Utilization & Clearance Audit) | `M02h`, `M05.2` |
| **`DEC-07`** | Customer Body Acquisition Mode | **`Gate Auth-4`** (Blocks `M09` Commercial Pilot) | Post-Pilot Review | `M02a`, `M08.1`, `M09.1` |
| **`DEC-08`** | PSP & Authoritative Sub-Ledger Integration | **`Gate Auth-4`** (Blocks `M08`/`M09` Live Settlement) | Post-Pilot Audit | `M08.2`, `M08.3`, `M09.4` |
| **`DEC-09`** | Cryptographic Signing Standard (`Ed25519` / RFC 8785 JCS) | **`Gate Auth-2`** (Blocks `M05.5` Entry) | **`Gate Auth-3`** (Verified in Slice 1 `TechPackManifest`) | `M05.5`, `M08.4`, `M09.2` |
| **`DEC-10`** | First Commercial Pilot Capsule Garment Mix | **`Gate Auth-4`** (Blocks `M09` Pilot Launch) | Post-Pilot Review | `M02b`, `M09.1`, `M09.3` |
| **`DEC-11`** | Paired Seam Tolerance Reconciliation (`0.05 cm` CAD vs. `0.20 cm` Sewn) | **`Gate Auth-2`** (Blocks `M02f`/`M05.3` Entry) | **`Gate Auth-3`** (Verified across Slice 1 Blocks) | `M02f`, `M05.3`, `M06.1`, `M09.3` |
| **`DEC-12`** | `M09` Pilot Operating Jurisdiction & Tax Sign-Off | **`Gate Auth-4`** (Blocks `M09` Commercial Transactions) | Post-Pilot Legal Audit | `M08.3`, `M09.1`, `M09.4` |
| **`DEC-13`** | Certified Interval & Polynomial Root-Isolation Library | **`Gate Auth-1`** (`Stage 1`: Candidate Selection for `M00.4` Evaluation) | **`Gate Auth-2`** (`Stage 2`: Production Adoption after `M00.4` `IntervalLibraryQualificationReport` & `AG-01`–`AG-17` Verification) | `M00.4`, `M00.10`, `M02c`, `M02e`, `M05.3` |

---

## 5. Critical Path Analysis

1. **Critical Path Segment 1 (Governance & Mathematical Verification):**
   `Gate Auth-1` (`DEC-01`, `DEC-13 Stage 1`) $\to$ `M00.1` (Schemas) $\to$ `M00.2` (`C0-Legacy` Baseline) $\to$ `M00.4` (`IntervalLibraryQualificationReport` + `C1-Cert` Oracle + `AG-01`–`AG-17` Suite) $\to$ `M00.10` (Audit Bundle) $\to$ `Gate Auth-2` (`DEC-13 Stage 2`, `DEC-02`–`DEC-06`, `DEC-09`, `DEC-11`).
2. **Critical Path Segment 2 (Vertical Slice 1 — Deterministic 2D CAD to DXF-AAMA):**
   `Gate Auth-2` $\to$ `M01.1`/`M01.2` (FastAPI + Next.js Dual Harness) $\to$ `M02a`–`M02g` (`C1-Fast` + `C1-Cert` Offset/Arc-Length/Grading Engine) $\to$ `M05.1`–`M05.5` (DXF-AAMA + Pre-Flight Gatekeeper + Signed Manifest) $\to$ `Gate Auth-3`.
3. **Critical Path Segment 3 (3D Physics Qualification & Commercial Pilot):**
   `M03` (Fabric Digital Twin) + `M06` (3D Drape & B1–B4 Qualification) $\to$ `Gate Auth-3` $\to$ `M08` (Sub-Ledger & Order State Machine) $\to$ `Gate Auth-4` (`DEC-07`, `DEC-08`, `DEC-10`, `DEC-12`) $\to$ `M09` (Micro-Factory Pilot).
