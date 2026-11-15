# 05 — WORKLOAD DEPENDENCY GRAPH (`R2.1.1`)

**Document ID:** `PATRONER-BP-R2.1.1-05`  
**Status:** Authoritative Workload Sequencing, Strict `M00`/`M02` Scope Separation, `M04a`/`M04b` Split, `M02h` Integration & Six-Gate Authorization Mapping  
**Governing Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 14`, `Ch. 15`, `App. F`)

---

## 1. Governing Sequencing Principles (`R2.1.1` Corrected)

1. **Strict Separation of `M00` (Migration Preparation & Independent Reference Oracles) vs. `M02` (Authoritative Production Implementation) (`Correction E`):**
   - **`M00` (`M00.1`–`M00.10`)** is strictly limited to source/contract inventory, defect reproduction (`DEF-M00-01`–`06`), legacy TS classification & freeze, Class A vs. Class B fixture extraction, canonical serialization baseline, and the **independent reference-oracle verification harness (`M00.4` in `services/fashion-engine/tests/oracles/`)**. `M00` does **not** implement authoritative production geometry or production seam-offset algorithms.
   - **`M02` (`M02a`–`M02h` in `services/fashion-engine/app/pattern_engine/`)** owns all authoritative production geometry (`M02a`) and production seam-allowance offset, trimming, and validation (`M02f`).
2. **Proportionate Six-Gate Authorization Governance (`Correction F`):**
   - **`Gate Auth-1` (Authorization to Begin `M00`):** Requires approval of `ADR-009`, `DEC-01`, `DEC-13`, and explicit Project-Owner commencement authorization. **Current Status: `BLOCKED / UNAUTHORIZED` (`R2.1.1` is a planning baseline only).**
   - **`Gate Auth-2` (Authorization to Begin `M01`/`M02` Authoritative Implementation):** Requires `M00.10` exit audit sign-off and workload-specific engineering decisions (`DEC-02`, `DEC-03`, `DEC-04`, `DEC-05`, `DEC-06`, `DEC-09`, `DEC-11` for their respective workloads). Commercial/tax decisions (`DEC-07`, `DEC-08`, `DEC-10`, `DEC-12`, `ADR-008`) do **not** block `M00`–`M07`.
3. **Security and Domain Authority Before Computation (`M01`):** No production computational engine, AI workflow, or manufacturing export may run outside the `M01` tenant-isolated, RBAC+ABAC-authorized, append-only revision graph (`REQ-SEC-01`, `REQ-SEC-02`, `REQ-WM-02`).
4. **Separation of `M04a` (Perception & Intent) from `M04b` (Recipe Compilation) (`Correction 01`):**
   - **`M04a` (Multimodal Perception & Design Intent)** depends **only** on `M01` (`M01.3` World Model & `M01.4`/`M01.5` Secure Media Intake). It executes *before* deterministic drafting (`M02d`/`M02e`) and produces a human-confirmed `GarmentIntentSpecification`.
   - **`M04b` (Controlled Recipe Compilation & Engine Integration)** depends on `M04a`, `M02c` (Body Measurements), `M02d` (Parametric Blocks), `M02e` (Style Operators), and `M03` (Material Mechanics) to compile the approved intent into a typed `GarmentRecipe` / `RecipeOperatorAST` / `DraftPlan`.
5. **Integration of `M02h` (Marker Nesting) into the Vertical Slice & `M05` (`Correction 02`):**
   - `M02h` (Deterministic Marker Nesting, Validation & Utilization Reporting) depends on `M02g` (Validated Multi-Size Grading) and `M03` (Material & Fabric-Width Constraints), and is a **hard prerequisite** for `M05` (Piece Production Sheets, BOM Fabric Consumption & Tech Packs) and the **Vertical Slice Gate (`Gate Auth-3`, `Step 12`)**.
6. **Non-Circular Release Governance Between `M09` and `M10` (`Correction 03` & `Correction F`):**
   - `M09` (Controlled Commercial Pilot) enters at **`Gate Auth-4` (Release Level A: Controlled Pilot Entry, gated by `DEC-07`, `DEC-08`, `DEC-10`, `DEC-12`, `ADR-008`)** and exits at **`Gate Auth-5` (Release Level B: Measured Pilot Acceptance)**.
   - `M10` (Enterprise & Institutional Scale) is strictly downstream of `M09` (`Gate Auth-5`) and governs **`Gate Auth-6` (Release Level C)**. Zero `M10`-only institutional capabilities block `M09` entry.

---

## 2. Master Dependency & Authorization Gate Graph (Mermaid — `R2.1.1`)

```mermaid
graph TD
  AUTH1[["Gate Auth-1: Authorization to Begin M00 (ADR-009, DEC-01, DEC-13 + Owner Sign-Off) — CURRENTLY BLOCKED"]]

  subgraph M00["M00: Migration Preparation & Independent Reference Oracles (Zero Production Implementation)"]
    M00_1["M00.1 Source & Contract Inventory"]
    M00_2["M00.2 Residual Defect Reproduction Register (DEF-M00-01..06)"]
    M00_3["M00.3 Dual-Class Fixture Extraction (Class A vs Class B)"]
    M00_4["M00.4 Independent Python Reference & Interval Oracles (tests/oracles/ only)"]
    M00_5["M00.5 Target Monorepo Layout (apps/web + services/fashion-engine)"]
    M00_6["M00.6 OpenAPI 3.1 + JSON Schema Contract Pipeline"]
    M00_7["M00.7 Legacy TS Freeze & Deprecation Boundary"]
    M00_8["M00.8 CI/CD Dual-Runtime Verification Harness"]
    M00_9["M00.9 Deterministic Seed & RFC 8785 Hash Parity"]
    M00_10["M00.10 M00 Exit Audit & Freeze Gate"]

    M00_1 --> M00_2 --> M00_3 --> M00_4 --> M00_10
    M00_1 --> M00_5 --> M00_6 --> M00_8 --> M00_10
    M00_2 --> M00_7 --> M00_9 --> M00_10
  end

  AUTH2[["Gate Auth-2: Authorization to Begin Authoritative M01/M02 Implementation"]]

  subgraph M01["M01: Canonical Foundation, Contracts & Security"]
    M01_IAM["M01.1 Person / Org / Tenant / Role IAM"]
    M01_ABAC["M01.2 RBAC + ABAC Policy Engine & 3-Point Job Re-Auth"]
    M01_WM["M01.3 Fashion World Model & Append-Only Revision DAG"]
    M01_ORCH["M01.4 Durable Job Orchestrator (Dossier 02)"]
    M01_MEDIA["M01.5 Secure Media Upload & Signed Export Links"]
    M01_IAM --> M01_ABAC --> M01_WM --> M01_ORCH --> M01_MEDIA
  end

  subgraph M04["M04: Multimodal AI & Controlled Recipe Compilation (Split)"]
    M04a["M04a Multimodal Perception, Epistemic Uncertainty & Design Intent"]
    M04b["M04b Controlled Recipe Compilation & DraftPlan Integration"]
    M04a --> M04b
  end

  subgraph M02["M02: Authoritative Deterministic Fashion Engine (services/fashion-engine/app/pattern_engine/)"]
    M02a["M02a Authoritative Planar Geometry, Arc-Length (Method C1-Cert) & Green's Area (Method C2)"]
    M02b["M02b 2D Pattern Topology, Half-Edge & Assembly Validator"]
    M02c["M02c Anthropometric Body Profile & Provenance Gate"]
    M02d["M02d Parametric Block Library (Skirt -> Bodice+Sleeve -> Trouser -> Dress -> Knit)"]
    M02e["M02e Style Transformation & Dart/Slash Operators"]
    M02f["M02f Authoritative Seam Allowance, 6-Category Tri-State Offset (Method C3) & Notch Engine"]
    M02g["M02g Category-Strict Multi-Size Grading (XS-XXL / EU 34-46)"]
    M02h["M02h Deterministic Marker Nesting, Validation & Utilization"]

    M02a --> M02b
    M02c --> M02d
    M02b --> M02d --> M02e --> M02f --> M02g --> M02h
  end

  M03["M03: Material & Fabric Mechanics (Dossiers 04, 09)"]
  M05["M05: Piece Production Sheets, Tech Packs & Export Qualification (Dossier 14)"]
  M06["M06: 3D Simulation, Avatar Fit & Bounded Optimization (Dossiers 05, 10, 11, 12)"]
  VS[["Gate Auth-3: Internal Technical Acceptance (14-Step Vertical Slice Gate)"]]
  M07["M07: Maker Network, Physical Sample Approval & Traceability (Dossiers 14, 15)"]
  M08["M08: Commercial Ecosystem, 8-Role Offer & Multi-Currency Ledger"]
  L_A[["Gate Auth-4: Release Level A Gate (Controlled Commercial Pilot Entry)"]]
  M09["M09: Controlled Commercial Pilot (Tracks P1, P2, P3 <= 50 Units)"]
  L_B[["Gate Auth-5: Release Level B Gate (Commercial Pilot Acceptance)"]]
  M10["M10: Advanced Governance, Enterprise Scale & Multi-Region Resilience"]
  L_C[["Gate Auth-6: Release Level C Gate (Enterprise-Scale Release)"]]

  AUTH1 --> M00_1
  M00_10 --> AUTH2
  AUTH2 --> M01_IAM
  AUTH2 --> M02a
  M01_WM --> M02b
  M01_WM --> M02c
  M01_WM --> M03
  M01_MEDIA --> M04a
  M01_ABAC --> M08

  M03 --> M02d
  M02c --> M04b
  M02d --> M04b
  M02e --> M04b
  M03 --> M04b
  M04b --> M02f

  M03 --> M02h
  M02f --> M05
  M02g --> M05
  M02h --> M05
  M03 --> M05
  M01_MEDIA --> M05

  M02c --> M06
  M02g --> M06
  M03 --> M06

  M04a --> VS
  M04b --> VS
  M02h --> VS
  M05 --> VS
  M06 --> VS

  VS --> M07
  M05 --> M07
  M07 --> L_A
  M08 --> L_A
  L_A --> M09
  M09 --> L_B
  L_B --> M10
  M10 --> L_C
```

---

## 3. Workload Prerequisite, Concurrency & Authorization Gate Matrix (`R2.1.1`)

| Workload / Sub-Workload | Hard Technical Prerequisites | Required Governance Gate & Decisions (`Correction F`) | Parallelizable With | Unlocks | Primary Acceptance Gates | Release Governance Stage |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **`M00` Migration Prep & Reference Oracles** | Base commit `e9d99cb4` (code) / `617cc7f5` (`plan/`) | **`Gate Auth-1`** (`ADR-009`, `DEC-01`, `DEC-13` + Owner Authorization — **currently `BLOCKED`**) | None — foundation freeze | `Gate Auth-2` → `M01`, `M02a` | `AC-01`, `AC-02`, `AC-03`, `AC-04` | Pre-Level A (`Gate Auth-1`) |
| **`M01` Foundation & Security** | `M00.10` | **`Gate Auth-2`** (`M00.10` exit + `DEC-02`, `DEC-03` for `M01.4`) | `M02a` (pure geometry kernel) | `M02b`–`M02h`, `M03`, `M04a`, `M05`, `M08` | `AC-01`, `AC-02`, `AC-04`, `AC-11` | `Gate Auth-2` → `Auth-3` |
| **`M04a` Multimodal Perception & Intent** | `M01.3`, `M01.5` | **`Gate Auth-2`** (`DEC-09` required before `M04a` completion) | `M02a`–`M02e`, `M03` | `M04b`, `Vertical Slice (Steps 02–03)` | `AC-01`, `AC-02`, `AC-04`, `AC-11` | `Gate Auth-2` → `Auth-3` |
| **`M02a` Authoritative Geometry Kernel** | `M00.4` (oracle harness), `M00.10` | **`Gate Auth-2`** (`ADR-003`, `ADR-009` approved at `Auth-1`) | `M01`, `M02c`, `M04a` | `M02b`, `M02f`, `M05` | `AC-01`, `AC-02`, `AC-03` | `Gate Auth-2` → `Auth-3` |
| **`M02b` Pattern Topology & Assembly** | `M01.3`, `M02a` | **`Gate Auth-2`** (`DEC-11` required before `M02b`/`M02f` exit) | `M02c`, `M03`, `M04a` | `M02d`, `M02e`, `M02f` | `AC-02`, `AC-03`, `AC-05` | `Gate Auth-2` → `Auth-3` |
| **`M02c` Anthropometric Body Profile** | `M01.3` | **`Gate Auth-2`** (`DEC-05` required before `M02c` exit) | `M02a`, `M02b`, `M03`, `M04a` | `M02d`, `M04b`, `M06` | `AC-02`, `AC-05` | `Gate Auth-2` → `Auth-3` |
| **`M03` Material & Fabric Mechanics** | `M01.3` | **`Gate Auth-2`** (`DEC-06` required before `M03.1` exit) | `M02a`–`M02c`, `M04a` | `M02d`, `M04b`, `M02h`, `M05`, `M06` | `AC-04`, `AC-07` | `Gate Auth-2` → `Auth-3` |
| **`M02d` Parametric Block Library** | `M02b`, `M02c`, `M03` (ease policies) | **`Gate Auth-2`** | `M04a` | `M02e`, `M04b`, `M02f`, `M02g` | `AC-03`, `AC-05` | `Gate Auth-2` → `Auth-3` |
| **`M02e` Style Transformation Operators** | `M02d` | **`Gate Auth-2`** | `M04a` | `M04b`, `M02f` | `AC-03`, `AC-05` | `Gate Auth-2` → `Auth-3` |
| **`M04b` Controlled Recipe Compilation** | `M04a`, `M02c`, `M02d`, `M02e`, `M03` | **`Gate Auth-2`** (`DEC-09`) | `M06.1`–`M06.3` (solver prep) | `M02f` (compiled `DraftPlan` execution), `Vertical Slice (Step 06)` | `AC-02`, `AC-04`, `AC-05` | `Gate Auth-2` → `Auth-3` |
| **`M02f` Authoritative Seam, Offset & Notch** | `M02a`, `M02b`, `M02d`, `M02e`, `M04b` | **`Gate Auth-2`** (`ADR-009`, `DEC-11`) | `M06.1`–`M06.3` | `M02g`, `M05` | `AC-03`, `AC-05`, `AC-10` | `Gate Auth-2` → `Auth-3` |
| **`M02g` Multi-Size Grading** | `M02f` | **`Gate Auth-2`** (`DEC-11`) | `M06` (base-size drape) | `M02h`, `M05`, `M06` (graded verification) | `AC-03`, `AC-06` | `Gate Auth-2` → `Auth-3` |
| **`M02h` Marker Nesting & Validation** | `M02g`, `M03` (fabric width/nap/shrinkage) | **`Gate Auth-2`** | `M06` | `M05` (BOM consumption & marker artifacts), `Vertical Slice (Step 12)` | `AC-03`, `AC-05`, `AC-10` | `Gate Auth-2` → `Auth-3` |
| **`M05` Production Sheets & Tech Packs** | `M01.5`, `M02f`, `M02g`, `M02h`, `M03` | **`Gate Auth-2`** (`ADR-009`, `DEC-11`) | `M06`, `M08` | `Gate Auth-3` (`Vertical Slice Steps 12–14`), `M07` | `AC-03`, `AC-06`, `AC-10`, `AC-11` | `Gate Auth-3` |
| **`M06` 3D Simulation, Fit & Optimization** | `M02c`, `M02g`, `M03` | **`Gate Auth-2`** (`DEC-04` required before `M06.2` solver build) | `M02h`, `M05`, `M08` | `Gate Auth-3` (`Vertical Slice Steps 08–10`), `M07` | `AC-07`, `AC-08`, `AC-09` | `Gate Auth-3` |
| **`M07` Maker Network & Traceability** | `M05`, `Gate Auth-3` (`Vertical Slice`) | **`Gate Auth-3`** (`DEC-07` for workshop SLA terms) | `M08` | `Gate Auth-4` (`Release Level A Gate`) → `M09` | `AC-09`, `AC-10`, `AC-11` | `Gate Auth-4` (`Level A`) |
| **`M08` Commerce & Multi-Currency Ledger** | `M01.2`, `M01.3` | **`Gate Auth-4`** (`ADR-008`, `DEC-07`, `DEC-08`, `DEC-10`, `DEC-12` required before `M08` completion / `M09` entry) | `M02`–`M07` | `Gate Auth-4` (`Release Level A Gate`) → `M09` | `AC-04`, `AC-11`, `AC-12` | `Gate Auth-4` (`Level A`) |
| **`M09` Controlled Commercial Pilot** | `Gate Auth-4` (`Release Level A Gate`: `Vertical Slice` + `M07` + `M08`) | **`Gate Auth-4`** (Entry) / **`Gate Auth-5`** (Exit) | None — live pilot execution | `Gate Auth-5` (`Release Level B Gate`) → `M10` | `AC-01`–`AC-12` (Level B Real Evidence) | Enters `Auth-4` (`Level A`) / Exits `Auth-5` (`Level B`) |
| **`M10` Advanced Governance & Scale** | `Gate Auth-5` (`Release Level B Gate` — `M09` Exit) | **`Gate Auth-5`** (Entry) / **`Gate Auth-6`** (Exit) | Post-pilot track expansion | `Gate Auth-6` (`Release Level C` Enterprise Operations) | `AC-04`, `AC-11`, `AC-12` (Level C) | `Gate Auth-6` (`Level C`) |

---

## 4. Corrected Critical Path Analysis (`R2.1.1`)

### 4.1 Critical Path 1 — To Internal Technical Acceptance (`Gate Auth-3`: Vertical Slice Gate)
$$\texttt{Gate Auth-1 (Blocked)} \longrightarrow \texttt{M00 (Prep \& Oracles)} \longrightarrow \texttt{Gate Auth-2} \longrightarrow \texttt{M01} \longrightarrow (\texttt{M04a} \parallel \texttt{M02a} \to \texttt{M02b} \parallel \texttt{M02c} \parallel \texttt{M03}) \longrightarrow \texttt{M02d} \longrightarrow \texttt{M02e} \longrightarrow \texttt{M04b} \longrightarrow \texttt{M02f} \longrightarrow (\texttt{M06} \parallel [\texttt{M02g} \to \texttt{M02h} \to \texttt{M05}]) \longrightarrow \texttt{Gate Auth-3 (Vertical Slice)}$$

### 4.2 Critical Path 2 — To Controlled Commercial Pilot (`Gate Auth-4` to `Gate Auth-5`) & Enterprise Scale (`Gate Auth-6`)
$$\texttt{Gate Auth-3 (Vertical Slice)} \longrightarrow \texttt{M07} + \texttt{M08} \longrightarrow \texttt{Gate Auth-4 (Release Level A)} \longrightarrow \texttt{M09 Commercial Pilot} \longrightarrow \texttt{Gate Auth-5 (Release Level B)} \longrightarrow \texttt{M10} \longrightarrow \texttt{Gate Auth-6 (Release Level C)}$$

