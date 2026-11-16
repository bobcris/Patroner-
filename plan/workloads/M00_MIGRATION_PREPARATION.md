# Workload M00 — Pre-Migration Verification, Canonical Contracts & Certified Reference Oracle

**Document ID:** `PATRONER-R2.1.2-R1-M00`  
**Workload ID:** `M00` (`M00.1` through `M00.10`)  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Governance Alignment)  
**Governing Authority:** Addendum v4.1; `ADR-001`, `ADR-003`, `ADR-009` (`R2.1.2-R1`); `04_MIGRATION_AND_PARITY_POLICY.md`; `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`  
**Status:** **GATE AUTH-1 APPROVED (CHECKPOINT 12, 2026-11-16) — AUTHORIZED FOR SEQUENTIAL EXECUTION (`M00.1`–`M00.10`)**

> **Owner Authorization Record (`Checkpoint 12` — 16 November 2026):**
> `Gate Auth-1`, `DEC-01`, and `DEC-13 Stage 1` are formally approved by the Project Owner. `M00` is authorized to execute in its defined sequence (`M00.1`–`M00.10`). `M00.4` must produce the required `IntervalLibraryQualificationReport`, all 17 adversarial geometry test families (`AG-01`–`AG-17`) must be verified with recorded evidence, and `DEC-13 Stage 2` / `Gate Auth-2` remains mandatory before `M02` production implementation.

---

## 1. Mission and Entry Prerequisites

`M00` establishes the canonical data contracts, records the `C0-Legacy` TypeScript prototype baseline and its documented mathematical divergences (`Class B`), qualifies the candidate interval arithmetic library (`IntervalLibraryQualificationReport`), and builds the executable **`C1-Cert` Reference Verification Oracle** and **17-Family Adversarial Geometry Test Suite (`AG-01`–`AG-17`)** before any platform migration (`M01`) or Python geometry implementation (`M02`) begins.

### 1.1 Hard Entry Gate (`Gate Auth-1` — APPROVED 2026-11-16)
`M00` entry prerequisites satisfied at **`Gate Auth-1`** (`Checkpoint 12`, `16 November 2026`):
1. Approval of Blueprint `R2.1.2-R1` (`6938f808629276fd1b0860fba407b42f5cb40aaf`) and `ADR-001`–`ADR-009`.
2. Sign-off on **`DEC-01`** (pnpm + Turborepo + uv monorepo layout `apps/web`, `services/geometry-engine`, `packages/contracts` & Strangler-Fig cutover policy).
3. Sign-off on **`DEC-13 Stage 1`** (Candidate Selection of `mpmath.iv` (`53-bit` + `113-bit` tiers) + Python `fractions.Fraction` as primary candidate, `python-flint` secondary, pure-Python `Fraction`+`Decimal` tertiary for evaluation in `M00.4`).

---

## 2. Sub-Workload Breakdown (`M00.1` through `M00.10`)

### `M00.1` — Canonical Coordinate Frame, Units & Contract Schemas
* **Deliverables:**
  * Lock canonical physical units (`centimeters [cm]` for 2D geometry, `millimeters [mm]` for CNC tool clearances, `radians [rad]` for internal math, `degrees [deg]` for UI/DXF angles).
  * Lock canonical orientation (`ADR-009 §1.1`): right-handed $(x, y)$ plane, **CCW** winding for exterior piece boundaries ($\mathbf{N}_+(t) = \frac{(-y'(t), x'(t))}{\sqrt{Q(t)}}$ points **inward**; $-\mathbf{N}_+(t)$ points **outward**), **CW** winding for internal cutouts.
  * Publish JSON Schema Draft 2020-12 and Pydantic v2 models (`BodyProfile`, `PatternPiece`, `BezierSegment`, `SeamAllowanceSpec`, `NotchSpec`, `OffsetClassificationReport`) with automated round-trip parity (`SchemasLockReport.json`).

### `M00.2` — `C0-Legacy` Behavioral Snapshot & Divergence Registry
* **Deliverables:**
  * Capture deterministic JSON snapshots of the existing TypeScript prototype (`src/services/patternEngine.ts`, `seamAllowance.ts`, `gradingEngine.ts`, `dxfExporter.ts`) across standard size presets.
  * Classify every legacy output into `Class A` (Exact Invariant Parity) or `Class B` (Intentional Mathematical Upgrade — where legacy chord-length or naive control-point offsetting diverges from exact differential geometry) in `BaselineDivergenceRegistry.json`.

### `M00.3` — Monorepo Workspace & Python 3.12 Reproducible Toolchain Skeleton
* **Deliverables:**
  * Prepare the workspace configuration per `DEC-01` with pinned Python 3.12 (`uv.lock` / `pyproject.toml`) and Node.js 22 (`pnpm-lock.yaml`) dependencies, without altering the running prototype UI.

### `M00.4` — Interval Library Qualification (`IntervalLibraryQualificationReport`) & `C1-Cert` Reference Oracle (`AG-01`–`AG-17`)
* **Purpose:** Execute **Stage 2 (Library Qualification)** and **Stage 3 (Oracle Implementation Verification)** of the 4-Stage Numerical Governance Lifecycle (`ADR-009 §7.2`).
* **Step 1 — Execute `IntervalLibraryQualificationReport` (Future Deliverable):**
  * Evaluate the `DEC-13 Stage 1` candidate libraries (`mpmath.iv` + `fractions.Fraction`, `python-flint`, pure-Python `Fraction`+`Decimal`) on the target Linux container:
    1. Verify outward-directed rounding ($\nabla$ toward $-\infty$, $\Delta$ toward $+\infty$) on algebraic operations and square roots.
    2. Verify exact rational ($\mathbb{Q}$) Bernstein coefficient transformation and Descartes sign-variation counting on degree-12 polynomials $P_{\mathrm{cusp}}(t) = Q(t)^3 - d^2 C(t)^2$.
    3. Verify zero false negatives on tangential grazing roots ($f(t^*) = 0, f'(t^*) = 0$, `Category 3`) and Wilkinson-style near-multiple root clusters ($\Delta t = 10^{-7}$, `AG-16`).
    4. Measure per-curve verification latency (`<= 50 ms` target).
  * Emit `IntervalLibraryQualificationReport.json` for Owner review at `Gate Auth-2` (`DEC-13 Stage 2`).
* **Step 2 — Implement the `C1-Cert` Reference Oracle (`ADR-009 §1–§5`):**
  * Implement exact first-principles offset derivative and singularity classification:
    $$\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t), \qquad \mathbf{O}'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t) = f(t)\,\mathbf{B}'(t)$$
  * Implement the **5-Way $Q(t^*)=0$ Base-Curve Singularity Classifier (`ADR-009 §2.2`)** via Taylor/Puiseux derivative orders $(m, n)$:
    * Distinguishes true zero-speed geometric cusps ($m$ even, e.g., $\mathbf{B}(t) = (t^2, t^3)$ at $t = 0$, `Category 2a: ACTUAL_ZERO_SPEED_CUSP`) from **removable parameterization degeneracies** ($m$ odd, e.g., $\mathbf{B}(t) = (t^3, 0)$ at $t = 0$, `Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY`, which has continuous unit tangent $\mathbf{T} \equiv (1, 0)$ and $\kappa \equiv 0$).
  * Enforce the **Dual Root-Isolation Stopping Criterion (`ADR-009 §4.1`)**:
    $$\delta_t = \overline{t} - \underline{t} \le 10^{-12} \quad \text{AND} \quad \Delta_{\mathrm{pos}}([t]) = \sup_{\tau \in [t]} \|\mathbf{B}'(\tau)\|\,\delta_t \le 10^{-7}\text{ cm}$$
* **Step 3 — Execute the 17-Family Adversarial Geometry Test Matrix (`AG-01`–`AG-17`, Future Deliverable):**
  * Implement and run all 17 adversarial test families (`AG-01` through `AG-17` defined in `ADR-009 §6.2` and `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md §3`), verifying 100% classification accuracy across all 6 offset categories (`Category 1`, `2a`, `2b`, `2c`, `3`, `4`) and emitting `AdversarialGeometryVerificationReport.json`.

### `M00.5` — Adaptive Gauss-Legendre Arc-Length & Monotone Brent Inversion Oracle
* **Deliverables:**
  * Reference implementation of 5-point adaptive Gauss-Legendre quadrature ($\le 10^{-6}\text{ cm}$ global error) and Newton-Brent inverse arc-length solver ($|L(t^*) - s_{\mathrm{target}}| \le 10^{-7}\text{ cm}$), verified against elliptic-integral and circular analytical baselines.

### `M00.6` — Topological Predicate & Polygon Boolean Verification Suite
* **Deliverables:**
  * Reference test suite for CCW/CW winding verification, simple polygon validation (`is_simple == True`), micro-sliver rejection ($< 10^{-4}\text{ cm}^2$), and exact contour closure ($\le 10^{-6}\text{ cm}$).

### `M00.7` — DXF-AAMA / ASTM Round-Trip Reference Parser
* **Deliverables:**
  * Independent Python verification parser that reads exported DXF-AAMA files, reconstructs all layers (`1, 2, 4, 7, 8, 11`), and verifies geometric fidelity within $\le 0.001\text{ cm}$ (`0.01 mm`).

### `M00.8` — Anthropometric Validation & Grading Invariant Test Fixtures
* **Deliverables:**
  * Golden `BodyProfile` test fixtures spanning standard, petite, plus, and asymmetric proportions, plus paired seam-length invariance assertions ($\le 0.05\text{ cm}$ CAD gate per `DEC-11`).

### `M00.9` — Deterministic CI Pipeline & Seed/Hash Pinning
* **Deliverables:**
  * CI workflow executing `M00.1`–`M00.8` checks with fixed `PYTHONHASHSEED=0`, single-threaded deterministic BLAS flags for verification runs, and SHA-256 artifact hashing.

### `M00.10` — `M00` Exit Audit Package & `Gate Auth-2` Submission
* **Deliverables:**
  * Assemble `SchemasLockReport.json`, `BaselineDivergenceRegistry.json`, `IntervalLibraryQualificationReport.json`, `AdversarialGeometryVerificationReport.json`, and `ReproducibleEnvironmentManifest.json` for Project Owner audit at **`Gate Auth-2`** (including **`DEC-13 Stage 2`** production adoption sign-off).
