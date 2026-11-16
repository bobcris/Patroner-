# 00 — Patroner Blueprint Revision 2.1.2-R1: Master Architecture & Execution Plan

**Document ID:** `PATRONER-R2.1.2-R1-00`  
**Revision:** Blueprint Revision 2.1.2-R1 (`R2.1.2-R1` — Targeted Mathematical Correction, Singularity Classification & Governance Alignment)  
**Authoritative Git Lineage:**
* **R2.1 Baseline:** `617cc7f5d9e41b8cd55ed96b64d2363cdb29557b`
* **R2.1.1 Baseline:** `8805140b1e6e7799922348369d7e29881102a75e` (`docs/blueprint-revision-2.1.1`)
* **R2.1.2 Published Baseline:** `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3` (`docs/blueprint-revision-2.1.2`; pre-restart local commit `724fc09b621b1fc623967f5228e5c0f1108c9422` recorded as historical note)
* **R2.1.2-R1 Approved Recovery Anchor:** `282a303ea1126fb3b1da368e4e8e4ddbeb59c552` (contains completed `R2.1.2-R1` update to `ADR-009`)
* **Target Branch:** `docs/blueprint-revision-2.1.2-r1`

**Governing Sources:**
1. *Patroner Living Project Monograph v5.16 Consolidated Master* (Strategic & Product Vision)
2. *Patroner Architecture Correction Addendum v4.1* (Python Computational Authority & Next.js Platform Boundary)
3. *Patroner Architecture Revision v4.5* (3D Fit Prediction, Material Physics & Calibration Loop)
4. *Patroner Monograph v5.15 Commercial Ecosystem Update* (Escrow Sub-Ledger & Micro-Factory Network)
5. *Specialist Dossiers 01–16* (Governed by source register authority hierarchy in `01_SOURCE_REGISTER_AND_REQUIREMENTS.md`)

> **Mandatory Governance Boundary (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Executive Summary of Blueprint Revision 2.1.2-R1

Blueprint Revision `R2.1.2-R1` is a controlled mathematical, numerical-assurance, and release-governance correction built directly on the Owner-approved recovery anchor `282a303ea1126fb3b1da368e4e8e4ddbeb59c552` (which incorporated the `R2.1.2-R1` overhaul of `ADR-009` on top of the published `R2.1.2` commit `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3`). It propagates the exact mathematical formulations and governance rules of `ADR-009` across all cross-referenced documents in `plan/`:

1. **Canonical Planar Orientation & First-Principles Offset Derivative (`ADR-009 §1`):**
   * Exterior garment piece contours are oriented **counter-clockwise (CCW)** in the right-handed $(x, y)$ plane; internal cutouts are **clockwise (CW)**.
   * At any regular point ($Q(t) = x'(t)^2 + y'(t)^2 > 0$), the unit tangent is $\mathbf{T}(t) = \frac{(x'(t), y'(t))}{\sqrt{Q(t)}}$ and the left-hand unit normal is $\mathbf{N}_+(t) = \frac{(-y'(t), x'(t))}{\sqrt{Q(t)}}$ (pointing **inward** on a CCW exterior boundary, while $-\mathbf{N}_+(t)$ points **outward** into the seam allowance).
   * With signed curvature $\kappa(t) = \frac{C(t)}{Q(t)^{3/2}}$ where $C(t) = x'(t)y''(t) - y'(t)x''(t)$, the Frenet-Serret normal derivative is $\mathbf{N}_+'(t) = -\kappa(t)\mathbf{B}'(t)$, and the signed offset curve $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$ ($d > 0, s \in \{+1, -1\}$) has exact derivative:
     $$\mathbf{O}'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t) = f(t)\,\mathbf{B}'(t)$$
   * Verified analytically across **4 CCW Circle Sanity Cases** (`Case 1`: inward sub-critical $d < R$, regular radius $R-d$; `Case 2`: inward critical $d = R$, focal collapse $\mathbf{O}(t) \equiv (0,0)$; `Case 3`: inward super-critical $d > R$, inverted tangent $f(t) = 1 - d/R < 0$; `Case 4`: outward seam allowance $s = -1$, unconditionally regular radius $R+d$ with $f(t) = 1 + d/R > 1$).

2. **Rigorous 5-Way $Q(t^*) = 0$ Base-Curve Singularity Distinction (`ADR-009 §2.2`):**
   * Corrects the mathematical error in `R2.1.2` where every zero of $Q(t^*) = x'(t^*)^2 + y'(t^*)^2 = 0$ was automatically classified as a true geometric cusp (`Category 2a`).
   * Because $Q(t^*) = 0 \implies C(t^*) = 0 \implies P_{\mathrm{cusp}}(t^*) = Q(t^*)^3 - d^2 C(t^*)^2 = 0$ identically for all $d$, every $Q(t^*) = 0$ point must be analyzed via its Taylor/Puiseux leading non-zero derivative orders $(m, n)$:
     * **Odd multiplicity $m$ with continuous tangent (`Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY`):** Demonstrated by the concrete counterexample $\mathbf{B}(t) = (t^3, 0)$ on $[-1, 1]$ (or $\mathbf{B}(u) = ((2u-1)^3, 0)$ on $[0, 1]$ at $u = 0.5$), which has $\mathbf{B}'(0) = (0, 0)$ and $Q(0) = 0$, yet traces a smooth straight line with continuous unit tangent $\mathbf{T}(t) \equiv (1, 0)$, $\mathbf{N}_+(t) \equiv (0, 1)$, $\kappa(t) \equiv 0$, and smooth offset $\mathbf{O}(t) = (t^3, s\,d)$. Such curves are **not** geometric cusps and are reparameterized to regular curves before export.
     * **Even multiplicity $m$ with tangent reversal $\mathbf{T}(t^{*+}) = -\mathbf{T}(t^{*-})$ (`Category 2a: ACTUAL_ZERO_SPEED_CUSP`):** True geometric base-curve cusp/fold (e.g., $\mathbf{B}(t) = (t^2, t^3)$ at $t = 0$).

3. **Six Mutually Exclusive Offset Classifications & 17-Family Future Test Suite (`ADR-009 §3, §6.2`):**
   * Formalizes the 6 offset classifications (`Category 1`, `Category 2a`, `Category 2b`, `Category 2c`, `Category 3`, `Category 4`) and expands the mandatory verification matrix to **17 Adversarial Geometry Test Families (`AG-01`–`AG-17`)**, explicitly distinguishing specification-time analytical checks from future `M00.4`/`M00.10` code deliverables.

4. **Candidate Status of `mpmath.iv` & 4-Stage Governance Lifecycle (`ADR-009 §5, §7.2`):**
   * Treats `mpmath.iv` (`53-bit` + `113-bit` tiers) + `fractions.Fraction` as the **primary candidate** (`DEC-13 Stage 1` at `Gate Auth-1`), requires executing the `IntervalLibraryQualificationReport` in `M00.4` as a future deliverable, verifies the `C1-Cert` oracle across `AG-01`–`AG-17` in `M00.4`/`M00.10`, and gates production adoption on `DEC-13 Stage 2` at `Gate Auth-2` (with an explicit non-bypass rule for `SPIKE-DEC13-01`).

---

## 2. Target Platform Architecture & Authority Boundary (`ADR-001`–`ADR-009`)

| Architectural Layer | Technology Stack | Strict Authority Boundary |
| :--- | :--- | :--- |
| **Presentation & Interaction Shell (`apps/web/`)** | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Three.js / R3F (3D viewport) | **Read-Only Geometry Consumer.** Renders SVG/WebGL viewports, captures anthropometric inputs, and displays fit/QC diagnostics. **Zero client-side pattern math, offset computation, or DXF generation.** |
| **Authoritative Computational Engine (`services/geometry-engine/`)** | Python 3.12, FastAPI, Pydantic v2, NumPy/SciPy (`C1-Fast`), `mpmath.iv` + `fractions.Fraction` candidate (`C1-Cert`) | **Single Source of Mathematical Truth.** Executes all parametric drafting (`M02b`), adaptive Gauss-Legendre arc-length (`M02c`), grading (`M02d`), certified offset synthesis (`M02e`), nesting (`M02h`), 3D cloth simulation (`M06`), and DXF-AAMA export + Gatekeeper validation (`M05`). |
| **Constrained AI Copilot (`M04`)** | Structured LLM Function Calling / Schema-Constrained Proposals (`ADR-002`) | **Parameter Proposal Only.** Emits bounded `StyleIntentProposal` JSON tokens; never emits raw coordinates or bypasses `M02`/`M05.3`. |
| **Persistence, Sub-Ledger & Artifact Store (`M01.3`, `M08`)** | PostgreSQL 16 (ACID relational + double-entry sub-ledger) + S3/GCS content-addressed storage (`DEC-04`, `ADR-006`) | **Immutable Audit & Financial Integrity.** Stores versioned pattern graphs, SHA-256 keyed DXF/glTF artifacts, Ed25519-signed `TechPackManifest` bundles (`DEC-09`), and zero-sum escrow ledger entries (`DEC-08`). |

---

## 3. Master Workload Roadmap (`M00` through `M11`)

| Workload | Name | Entry Gate | Core Deliverables & Exit Verification |
| :--- | :--- | :--- | :--- |
| **`M00`** | **Pre-Migration Verification, Contracts & Reference Oracle** | **`Gate Auth-1`** (`DEC-01`, `DEC-13 Stage 1`) | Canonical schemas (`M00.1`), `C0-Legacy` divergence registry (`M00.2`), `IntervalLibraryQualificationReport` + `C1-Cert` oracle + 17-family adversarial suite `AG-01`–`AG-17` (`M00.4`), reproducible audit bundle (`M00.10`). |
| **`M01`** | **Platform Foundation & Dual-Engine Strangler Proxy** | **`Gate Auth-2`** (`DEC-04`, `DEC-05`) | Next.js 15 + FastAPI monorepo, PostgreSQL 16 + S3/GCS persistence, Celery/Temporal async queue, shadow-mode parity harness. |
| **`M02`** | **Deterministic 2D Fashion & Geometry Engine** | **`Gate Auth-2`** (`DEC-13 Stage 2`, `DEC-06`, `DEC-11`) | `M02a`–`M02h`: Bodice/Sleeve/Skirt/Trouser blocks, Gauss-Legendre arc-length ($\le 10^{-6}\text{ cm}$), 6-category certified offset engine ($E_{\mathrm{grid}} \le 0.005\text{ cm}, E_{\mathrm{cert}} \le 0.01\text{ cm}$), paired seam walking ($\le 0.05\text{ cm}$ CAD gate), 2D NFP nesting. |
| **`M03`** | **Material Physics & Fabric Digital Twin Library** | **`Gate Auth-2`** (`DEC-03 Stage 1`) | 3-tier fabric characterization (tensile, shear, bending hysteresis, aerial weight) and digital twin schema. |
| **`M04`** | **Constrained Generative Design Copilot** | **`Gate Auth-3`** | Bounded `StyleIntentProposal` translator validated by `M02` and `M05.3` with zero raw coordinate emission. |
| **`M05`** | **Manufacturing Documentation & Pre-Flight Gatekeeper** | **`Gate Auth-2`** (Entry) / **`Gate Auth-3`** (Exit) | DXF-AAMA (`Layers 1,2,4,7,8,11`) with round-trip verification ($\le 0.001\text{ cm}$), `M05.3` Gatekeeper, BOM/POM specs, `Ed25519`-signed `TechPackManifest` (`DEC-09`). |
| **`M06`** | **3D Digital Assembly & Physics Fit Prediction** | **`Gate Auth-2`** (`DEC-02 Stage 1`) / **`Gate Auth-3`** (`Stage 2`) | 2D-to-3D seam stitching around avatar, cloth drape solver qualified against Benchmarks `B1`–`B4` ($\le 5\%$ error), strain/pressure fit maps. |
| **`M07`** | **Fit Intelligence & Return-Loop Calibration** | **`Gate Auth-3`** | Bayesian post-purchase fit feedback ingestion and grading ease-allowance calibration loop. |
| **`M08`** | **Commercial Platform, Order State Machine & Sub-Ledger** | **`Gate Auth-3`** (Dev) / **`Gate Auth-4`** (`DEC-07,08,10,12`) | Double-entry ACID sub-ledger ($\sum D = \sum C$), Stripe Connect escrow integration, deterministic order routing. |
| **`M09`** | **Micro-Factory Manufacturing Execution & Pilot** | **`Gate Auth-4`** | Live 2-garment capsule pilot (`DEC-10`), signed `TechPackManifest` machine intake, physical QC ($\le 0.20\text{ cm}$ sewn tolerance, `DEC-11`), escrow settlement. |
| **`M10`** | **Observability, Deterministic Replay & SRE** | **`Gate Auth-2`** / **`Gate Auth-4`** | OpenTelemetry tracing, deterministic failure replay bundles, SLO alerting. |
| **`M11`** | **Commercial Ecosystem & Multi-Tenant Scale** | **Post-`Gate Auth-4`** | Multi-brand studio SDK, distributed micro-factory capacity bidding, regional compliance scaling. |
