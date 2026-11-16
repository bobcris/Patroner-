# 02 — Architecture Decision Records (ADR-001 through ADR-009) Master Index

**Document ID:** `PATRONER-R2.1.2-R1-02`  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Governance Alignment)  
**Governing Authority:** Monograph v5.16; Addendum v4.1; Revision v4.5; Specialist Dossiers 01–16  
**Status:** **PROPOSED ARCHITECTURE BASELINE — REQUIRES OWNER SIGN-OFF AT GATE AUTH-1 (M00 REMAINS BLOCKED)**

> **Mandatory Governance Boundary (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Master Index of Architecture Decision Records (`ADR-001` – `ADR-009`)

All nine Architecture Decision Records under `plan/decisions/` are cross-audited and synchronized to Blueprint Revision `R2.1.2-R1`:

| ADR ID | Document Path | Title & Core Architectural Mandate | Governing Gate & Linked Open Decisions |
| :--- | :--- | :--- | :--- |
| **[`ADR-001`](./decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md)** | `plan/decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md` | **Authoritative System Boundary & Python Computational Authority:** Establishes Python 3.12 (`FastAPI`) as the single authoritative computational engine for all 2D/3D geometry, physics, grading, nesting, and DXF generation; confines Next.js 15 (`apps/web`) strictly to a read-only presentation and orchestration shell. | **`Gate Auth-1`** (`DEC-01`), **`Gate Auth-2`** (`DEC-04`, `DEC-05`) |
| **[`ADR-002`](./decisions/ADR-002_CANONICAL_WORLD_MODEL_AND_REVISIONS.md)** | `plan/decisions/ADR-002_CANONICAL_WORLD_MODEL_AND_REVISIONS.md` | **Canonical Fashion World Model, Coordinate Frame & Immutable Revisions:** Locks canonical physical units (`cm`, `mm`, `rad`, `deg`), right-handed $(x, y)$ plane with **CCW** exterior boundaries ($\mathbf{N}_+(t)$ inward) and **CW** internal cutouts, content-addressed artifact revisions, and cryptographic `TechPackManifest` provenance (`Ed25519` over RFC 8785 JCS). | **`Gate Auth-1`** (`M00.1`), **`Gate Auth-2`** (`DEC-04`, `DEC-09`) |
| **[`ADR-003`](./decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md)** | `plan/decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md` | **Deterministic Geometry, Exact Topology & Manufacturing Safety Gates (`R2.1.2-R1`):** Mandates 5-point adaptive Gauss-Legendre arc-length ($\le 10^{-6}\text{ cm}$), monotone Brent inversion ($\le 10^{-7}\text{ cm}$), first-principles offset equation $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$ with $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, 5-way $Q(t^*)=0$ singularity classification, 6 offset categories, Shewchuk-style topological predicates, and the `M05.3` Pre-Flight Gatekeeper. | **`Gate Auth-1`** (`DEC-13 Stage 1`), **`Gate Auth-2`** (`DEC-13 Stage 2`, `DEC-11`) |
| **[`ADR-004`](./decisions/ADR-004_AI_EPISTEMIC_DISCIPLINE_AND_RECIPE_COMPILATION.md)** | `plan/decisions/ADR-004_AI_EPISTEMIC_DISCIPLINE_AND_RECIPE_COMPILATION.md` | **AI Epistemic Discipline & Constrained Recipe Compilation:** Prohibits LLMs from emitting raw pattern coordinates, SVG paths, or DXF entities. Restricts AI copilot outputs (`M04`) to schema-validated parameter proposals compiled deterministically by `M02` and validated by `M05.3`. | **`Gate Auth-1`** (Policy), **`Gate Auth-3`** (`M04` Cutover) |
| **[`ADR-005`](./decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md)** | `plan/decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md` | **Material Characterization & 3D Cloth Simulation Credibility:** Mandates the 3-tier fabric characterization hierarchy (`M03`) and quantitative 3D drape qualification against Analytical/Empirical Benchmarks `B1`–`B4` ($\le 5\%$ error) before `M06` fit predictions are unlocked. | **`Gate Auth-2`** (`DEC-02 Stage 1`, `DEC-03 Stage 1`), **`Gate Auth-3`** (`Stage 2`) |
| **[`ADR-006`](./decisions/ADR-006_BOUNDED_OPTIMIZATION_AND_INDEPENDENT_VALIDATION.md)** | `plan/decisions/ADR-006_BOUNDED_OPTIMIZATION_AND_INDEPENDENT_VALIDATION.md` | **Bounded Optimization, Marker Nesting & Independent Validation:** Governs 2D NFP marker nesting (`M02h`, `DEC-06`), ease/fit calibration loops (`M07`), and independent verification oracles so optimization passes never violate grainline or topological safety invariants. | **`Gate Auth-2`** (`DEC-06`), **`Gate Auth-3`** (`M07`) |
| **[`ADR-007`](./decisions/ADR-007_COMMERCIAL_ECOSYSTEM_AND_OFFER_GOVERNANCE.md)** | `plan/decisions/ADR-007_COMMERCIAL_ECOSYSTEM_AND_OFFER_GOVERNANCE.md` | **Commercial Ecosystem, Maker Network & Offer Governance:** Governs custom garment intake (`DEC-07`), pilot capsule constraints (`DEC-10`), micro-factory routing (`M07`/`M09`), and cryptographic `TechPackManifest` machine intake. | **`Gate Auth-4`** (`DEC-07`, `DEC-10`, `DEC-12`) |
| **[`ADR-008`](./decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md)** | `plan/decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md` | **Financial Transaction Model & Double-Entry Escrow Sub-Ledger:** Mandates an immutable PostgreSQL 16 ACID double-entry sub-ledger ($\sum \text{Debits} = \sum \text{Credits}$) with idempotent webhook ingestion and milestone-gated factory escrow disbursement (`M08`/`M09`). | **`Gate Auth-4`** (`DEC-08`, `DEC-12`) |
| **[`ADR-009`](./decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md)** | `plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md` | **Numerical Certification, Offset Curve Differential Geometry & Singularity Verification (`R2.1.2-R1`):** Authoritative mathematical specification deriving $\mathbf{N}_+'(t) = -\kappa(t)\mathbf{B}'(t)$, $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, the 4 CCW circle sanity checks, the 5-way $Q(t^*)=0$ singularity classification (proving $\mathbf{B}(t) = (t^3, 0)$ is a `Category 2c` removable parameterization degeneracy, not a cusp), the 6 offset categories, parameter vs. Euclidean error bounds, the 17-family future adversarial test matrix (`AG-01`–`AG-17`), and the 4-decision lifecycle for `DEC-13`. | **`Gate Auth-1`** (`DEC-13 Stage 1`), **`M00.4`/`M00.10`** (`IntervalLibraryQualificationReport` & `AG-01`–`AG-17`), **`Gate Auth-2`** (`DEC-13 Stage 2`) |

---

## 2. Summary of `R2.1.2-R1` Architectural Corrections (`ADR-003` & `ADR-009`)

1. **Canonical Normal & Derivative Convention (`ADR-009 §1`):**
   * Exterior piece contour = **CCW**; $\mathbf{T}(t) = \frac{\mathbf{B}'(t)}{\sqrt{Q(t)}}$; $\mathbf{N}_+(t) = \frac{(-y'(t), x'(t))}{\sqrt{Q(t)}}$ points **inward**; $-\mathbf{N}_+(t)$ points **outward**.
   * $\mathbf{N}_+'(t) = -\kappa(t)\mathbf{B}'(t)$ and $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t) = f(t)\mathbf{B}'(t)$ ($d > 0, s \in \{+1, -1\}$).
2. **Separation of Regular Curvature Cusps from Base-Curve $Q(t^*)=0$ Singularities (`ADR-009 §2`):**
   * Regular base curve ($Q(t) > 0$): offset speed vanishes iff $f(t) = 1 - s\,d\,\kappa(t) = 0 \iff P_{\mathrm{cusp}}(t) = Q(t)^3 - d^2 C(t)^2 = 0$ with $s \cdot C(t) > 0$.
   * Base-curve speed zero ($Q(t^*) = 0$): analyzed via Taylor/Puiseux leading derivative orders $(m, n)$ to separate true geometric cusps (`Category 2a: ACTUAL_ZERO_SPEED_CUSP`, $m$ even, tangent reverses by $\pi$) from removable parameterization degeneracies (`Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY`, $m$ odd, e.g., $\mathbf{B}(t) = (t^3, 0)$, where unit tangent $\mathbf{T}(t) \equiv (1, 0)$ is continuous and $\kappa(t) \equiv 0$).
3. **Dual Parameter & Physical Stopping Criterion (`ADR-009 §4.1`):**
   * Enforces both $\delta_t = \overline{t} - \underline{t} \le 10^{-12}$ and $\Delta_{\mathrm{pos}}([t]) = \sup_{\tau \in [t]} \|\mathbf{B}'(\tau)\|\,\delta_t \le 10^{-7}\text{ cm}$.
4. **4-Decision Lifecycle for Interval Arithmetic Qualification (`ADR-009 §7.2`):**
   * Separates `DEC-13 Stage 1` (candidate selection at `Gate Auth-1`), `IntervalLibraryQualificationReport` (future execution in `M00.4`), `C1-Cert` oracle verification across `AG-01`–`AG-17` (`M00.4`/`M00.10`), and `DEC-13 Stage 2` (production adoption at `Gate Auth-2`).
