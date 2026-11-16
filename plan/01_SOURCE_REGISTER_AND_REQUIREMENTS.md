# 01 — Governing Source Register, Authority Hierarchy & Requirements Traceability

**Document ID:** `PATRONER-R2.1.2-R1-01`  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Governance Alignment)  
**Governing Authority:** Monograph v5.16; Addendum v4.1; Revision v4.5; Monograph v5.15; Specialist Dossiers 01–16; `ADR-001`–`ADR-009` (`R2.1.2-R1`)  
**Status:** **CONTROLLED SPECIFICATION — M00 REMAINS BLOCKED PENDING EXPLICIT OWNER APPROVAL**

> **Mandatory Governance Boundary (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Governing Source Register & Conflict-Resolution Hierarchy

When reconciling requirements across project documents, the following strict precedence order governs (`Rank 1` overrides all lower ranks):

| Precedence Rank | Source Document | Scope of Authority | Conflict Resolution Rule |
| :--- | :--- | :--- | :--- |
| **Rank 1 (Highest — Mathematical & Governance Precision)** | **Blueprint `R2.1.2-R1` (`ADR-001`–`ADR-009`, specifically `ADR-009` in `282a303`)** | First-principles differential geometry, offset normal derivative sign ($\mathbf{N}_+'(t) = -\kappa(t)\mathbf{B}'(t)$), 5-way $Q(t^*)=0$ singularity classification, 6 offset categories, dual root-isolation stopping criteria, 17-family adversarial test suite, and 4-gate / 4-decision governance lifecycle. | Overrides any typographical sign error, naive offset approximation, or unseparated $Q(t^*)=0$ cusp claim in earlier drafts (`R2`, `R2.1`, `R2.1.1`, `R2.1.2`) or prototype code. |
| **Rank 2 (Architectural Authority Boundary)** | **Architecture Correction Addendum v4.1 & Revision v4.5** | Python 3.12 computational authority vs. Next.js 15 read-only presentation shell (`v4.1`); 3D cloth simulation benchmarks `B1`–`B4`, 3-tier fabric testing hierarchy, and fit calibration loop (`v4.5`). | Overrides any browser-side TypeScript geometry computation or uncalibrated 3D visual drape assumptions in earlier monograph chapters. |
| **Rank 3 (Strategic, Commercial & Product Master)** | **Patroner Living Project Monograph v5.16 (incorporating v5.15 Commercial Ecosystem Update)** | End-to-end Fashion World Model, bespoke-at-scale product vision, double-entry escrow sub-ledger, cryptographic tech-pack handoff, and micro-factory execution model (`M00`–`M11`). | Governs all product capabilities, commercial workflows, and workload scope. |
| **Rank 4 (Domain Specialist Reference)** | **Specialist Dossiers 01–16** | Deep-dive domain specifications (computational geometry, anthropometry, Kawabata/FAST material physics, DXF-AAMA, nesting, double-entry accounting, SRE). | Incorporated where consistent with Ranks 1–3; subject to the accessibility and verification audits documented below. |
| **Rank 5 (Lowest — Prototype Baseline Only)** | **Legacy TypeScript Prototype (`src/*`)** | `C0-Legacy` behavioral snapshot (`M00.2`). | Used strictly to inventory baseline UI flows and record `Class B` mathematical divergences (`04_MIGRATION_AND_PARITY_POLICY.md`). **Never authoritative for math or architecture.** |

---

## 2. Specialist Dossiers 01–16 Register & Reconciliation Notes

| Dossier ID | Domain Title | Primary Mapped Workloads | `R2.1.2-R1` Mathematical & Governance Reconciliation |
| :--- | :--- | :--- | :--- |
| **Dossier 01** | Parametric Pattern Engineering & Anthropometric Manifolds | `M00.1`, `M02a`, `M02b`, `M02d` | Enforces CCW exterior / CW interior winding (`ADR-009 §1.1`) and 14-measurement plausibility bounds. |
| **Dossier 02** | System Architecture, Monorepo & Strangler-Fig Cutover | `M00.3`, `M01.1`–`M01.5` | Governed by `ADR-001` and `DEC-01` (`Gate Auth-1`). |
| **Dossier 03** | Differential Geometry of Planar Bezier Curves & Arc-Length | `M00.5`, `M02c` | Enforces adaptive 5-point Gauss-Legendre quadrature ($\le 10^{-6}\text{ cm}$) and monotone Newton-Brent inversion ($\le 10^{-7}\text{ cm}$) with dual parameter/physical error bounds (`ADR-009 §4.1`). |
| **Dossier 04** | Exact Offset Curves, Cusp Singularities & Seam Allowances | `M00.4`, `M02e`, `M05.3` | Reconciled in `ADR-009` (`R2.1.2-R1`): $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$, $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, 5-way $Q(t^*)=0$ Taylor/Puiseux classification (`Category 2a` true cusp vs. `Category 2c` removable parameterization degeneracy $\mathbf{B}(t)=(t^3,0)$), 6 offset categories, and 17 adversarial test families (`AG-01`–`AG-17`). |
| **Dossier 05** | Interval Arithmetic, Validated Numerics & Root Isolation | `M00.4`, `M00.10`, `M02e` | Reconciled in `ADR-009 §5` & `§7.2`: `mpmath.iv` + `fractions.Fraction` is the **primary candidate** (`DEC-13 Stage 1` at `Gate Auth-1`), subject to the future `IntervalLibraryQualificationReport` in `M00.4` and production sign-off at `Gate Auth-2` (`DEC-13 Stage 2`). |
| **Dossier 06** | Computational Topology, Exact Predicates & Polygon Clipping | `M00.6`, `M02e`, `M02g`, `M05.3` | Enforces Shewchuk-style adaptive predicates / integer-lattice clipping, simple polygon invariants, and micro-sliver removal ($< 10^{-4}\text{ cm}^2$). |
| **Dossier 07** | Industrial CAD Exchange (DXF-AAMA / ASTM D6673) | `M00.7`, `M05.1`–`M05.3` | Enforces canonical layers (`1, 2, 4, 7, 8, 11`), independent round-trip verification ($\le 0.001\text{ cm}$), and two-tier seam tolerance (`DEC-11`: `0.05 cm` CAD vs. `0.20 cm` Sewn). |
| **Dossier 08** | 2D Irregular Strip Packing & NFP Marker Nesting | `M02h`, `M05.2` | Governed by `DEC-06` (`Gate Auth-2`) with strict grainline lock ($\pm 0.5^\circ$ woven) and cutter clearance. |
| **Dossier 09** | Fabric Mechanics, Kawabata/FAST Testing & Digital Twins | `M03.1`–`M03.4` | Governed by `ADR-004` and `DEC-03` (3-tier fabric testing hierarchy; Stage 1 at `Gate Auth-2`, Stage 2 correlation study at `Gate Auth-3`). |
| **Dossier 10** | 3D Cloth Simulation, Drape Physics & Collision Kernels | `M06.1`–`M06.5` | Governed by `ADR-004` and `DEC-02` (Stage 1 kernel selection at `Gate Auth-2`; Stage 2 qualification on Benchmarks `B1`–`B4` $\le 5\%$ error at `Gate Auth-3`). |
| **Dossier 11** | Constrained Generative AI & Semantic Style Translation | `M04.1`–`M04.4` | Governed by `ADR-002` (zero direct LLM coordinate emission; bounded `StyleIntentProposal` schema). |
| **Dossier 12** | Bayesian Fit Intelligence & Return-Loop Calibration | `M07.1`–`M07.4` | Post-purchase fit feedback assimilation and ease-table calibration (`Gate Auth-3`). |
| **Dossier 13** | FinTech Sub-Ledger, Double-Entry Escrow & Split Settlement | `M08.1`–`M08.5` | Governed by `ADR-006` and `DEC-08` (`Gate Auth-4`), enforcing ACID zero-sum ledger invariants ($\sum D = \sum C$). |
| **Dossier 14** | Cryptographic Provenance & Non-Repudiable Tech Packs | `M05.5`, `M09.2` | Governed by `DEC-09` (`Ed25519` signatures over RFC 8785 JCS + SHA-256 artifact hashes). |
| **Dossier 15** | Micro-Factory CAM Execution, Cut-Floor QC & Pilot Operations | `M09.1`–`M09.5` | Governed by `Gate Auth-4` (`DEC-07`, `DEC-08`, `DEC-10`, `DEC-11`, `DEC-12`). |
| **Dossier 16** | Deterministic Replay, Observability & Production SRE | `M00.9`, `M10.1`–`M10.4`, `M11` | Enforces pinned lockfiles, deterministic seeds, content-addressed failure replay bundles, and multi-tenant scale. |

---

## 3. Master Requirements Traceability Matrix (`REQ-MATH` & `REQ-GOV`)

| Requirement ID | Requirement Statement | Governing ADR / Policy | Verification Deliverable & Gate |
| :--- | :--- | :--- | :--- |
| **`REQ-MATH-01`** | Canonical CCW exterior boundary orientation with inward left unit normal $\mathbf{N}_+(t) = (-y'(t), x'(t))/\sqrt{Q(t)}$, $\mathbf{N}_+'(t) = -\kappa(t)\mathbf{B}'(t)$, and $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$. | `ADR-003`, `ADR-009 §1` | Analytical circle cases `Case 1`–`Case 4` (`ADR-009 §1.4`) + `AG-01`–`AG-04` in `M00.4` (`Gate Auth-2`). |
| **`REQ-MATH-02`** | 5-way Taylor/Puiseux classification of $Q(t^*)=0$ base-curve singularities, separating true zero-speed cusps (`Category 2a`, $m$ even) from removable parameterization degeneracies (`Category 2c`, $m$ odd, e.g., $\mathbf{B}(t) = (t^3, 0)$). | `ADR-009 §2.2`, `§3` | Analytical proof (`ADR-009 §2.2`) + `AG-09`–`AG-12` in `M00.4` (`Gate Auth-2`). |
| **`REQ-MATH-03`** | Strict separation of dimensionless parameter bracket width ($\delta_t \le 10^{-12}$) from Euclidean physical position uncertainty ($\Delta_{\mathrm{pos}}([t]) = \sup_{\tau \in [t]} \|\mathbf{B}'(\tau)\|\,\delta_t \le 10^{-7}\text{ cm}$). | `ADR-009 §4.1` | `AG-10`, `AG-13`, `AG-16` in `M00.4` (`Gate Auth-2`). |
| **`REQ-MATH-04`** | Piecewise cubic Bezier offset approximation satisfying both dense-grid error $E_{\mathrm{grid}} \le 0.005\text{ cm}$ ($N_{\mathrm{grid}} = 1024$) and certified interval enclosure $E_{\mathrm{cert}} \le 0.010\text{ cm}$ ($N_{\mathrm{cert}} \ge 256$). | `ADR-009 §4.2–§4.3` | `M00.4` `C1-Cert` oracle + `M02e` + `M05.3` Gatekeeper (`Gate Auth-2` / `Gate Auth-3`). |
| **`REQ-GOV-01`** | 4-Decision Lifecycle for interval & root-isolation library: (1) Candidate selection `DEC-13 Stage 1` at `Gate Auth-1`; (2) `IntervalLibraryQualificationReport` in `M00.4`; (3) `C1-Cert` oracle verification across `AG-01`–`AG-17` in `M00.4`/`M00.10`; (4) Production adoption `DEC-13 Stage 2` at `Gate Auth-2`. | `ADR-009 §7.2`, `05`, `07`, `10` | Audited at `Gate Auth-1` and `Gate Auth-2`; `SPIKE-DEC13-01` cannot bypass any stage. |
| **`REQ-GOV-02`** | Strict milestone execution lock: `R2.1.2-R1` is a documentation correction only; `M00` remains blocked pending explicit owner approval at `Gate Auth-1`. | `00`, `05`, `07`, `10` | Verified via `git status` / `git diff` showing zero application code changes outside `plan/`. |
