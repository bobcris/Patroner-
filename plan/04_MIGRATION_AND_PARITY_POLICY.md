# 04 — Migration, Dual-Engine Strangler Fig, and Mathematical Parity Policy

**Document ID:** `PATRONER-R2.1.2-R1-04`  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Numerical Assurance Alignment)  
**Governing Authority:** Addendum v4.1 (§2–§6); Monograph v5.16 (Part II §4); `ADR-001`, `ADR-003`, `ADR-009` (`R2.1.2-R1`)  
**Status:** **CONTROLLED SPECIFICATION — M00 REMAINS BLOCKED PENDING EXPLICIT OWNER APPROVAL**

> **Governance Rule (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Purpose and Scope

This policy governs the controlled migration of Patroner from its current browser-bound React 19 / Vite TypeScript prototype (`src/`) to the target **Next.js 15 App Router + Python 3.12 Authoritative Computational Engine** architecture (`ADR-001`).

Crucially, this document resolves the **Legacy Bug vs. Mathematical Correctness Paradox**:
* The existing TypeScript prototype (`src/services/patternEngine.ts`, `seamAllowance.ts`, `dxfExporter.ts`) contains known mathematical approximations (e.g., fixed-step polygonal chord sums, control-polygon Bezier offsetting, uncertified miter clipping).
* **Byte-for-byte or floating-point parity with defective legacy geometry is explicitly prohibited.**
* Instead, migration cutover is governed by **First-Principles Mathematical Reference Oracles** (`ADR-003`, `ADR-009`) and a **Three-Classification Parity Taxonomy**.

---

## 2. Prototype Disposition Matrix (Keep / Port / Quarantine / Retire)

Every module in the current repository is assigned a binding disposition before `M00` begins:

| Legacy Path / Asset | Current Role | Disposition | Target Destination & Authority Rule |
| :--- | :--- | :--- | :--- |
| `src/types/pattern.ts` | Client-side TypeScript interfaces | **UPGRADE & SCHEMA-LOCK** | Port to versioned JSON Schema + Pydantic v2 (`packages/contracts/` & `services/geometry-engine/contracts/`) in `M00.1`. |
| `src/services/patternEngine.ts` | Basic bodice / sleeve / skirt / pants drafting | **PORT TO PYTHON & UPGRADE** | Port parametric topological construction to Python (`M02b`), replacing chord-length approximations with adaptive 5-point Gauss-Legendre arc-length (`ADR-003 §2.1`). |
| `src/services/seamAllowance.ts` | Naive polygon/control-point offset | **QUARANTINE & REPLACE** | Quarantine legacy logic as `C0-Legacy` baseline only. Replace in Python (`M02e`) with exact signed normal offset $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$, degree-12 cusp polynomial $P_{\mathrm{cusp}}(t) = Q(t)^3 - d^2 C(t)^2 = 0$ with sign filter $s \cdot C(t) > 0$, 5-way $Q(t^*)=0$ singularity classification, and certified interval root isolation (`ADR-009`). |
| `src/services/gradingEngine.ts` | Basic rule-table coordinate shifts | **PORT TO PYTHON & UPGRADE** | Port to Python (`M02d`) as continuous anthropometric manifold vector shifts with invariant seam-pair re-walking. |
| `src/services/dxfExporter.ts` | Unvalidated string-template DXF writer | **QUARANTINE & REPLACE** | Replace in Python (`M05.1`/`M05.3`) with schema-validated DXF-AAMA / ASTM D6673 emitter gated by independent round-trip geometric parser. |
| `src/components/PatternCanvas.tsx` | 2D SVG viewport, pan/zoom, layer toggles | **KEEP & ADAPT (READ-ONLY)** | Migrate to Next.js 15 (`apps/web/`) in `M01.2`. Strictly **read-only rendering** of Python-authored `PatternPiece[]` payloads; zero client-side geometry mutation. |
| `src/components/MeasurementPanel.tsx` | Anthropometric input sliders & presets | **KEEP & ADAPT** | Migrate to Next.js 15 (`apps/web/`) validated against `BodyProfile` schema (`M02a`). |

---

## 3. Three-Tier Numerical & Geometric Maturity Hierarchy

To prevent confusion between legacy code, fast production code, and high-precision certification code, every computational routine is classified into one of three tiers (`ADR-009 §5`):

| Tier ID | Name | Runtime Precision & Representation | Role in Architecture |
| :--- | :--- | :--- | :--- |
| **`C0-Legacy`** | Legacy TypeScript Prototype | IEEE-754 `binary64` (`Number`) in V8/Node.js; naive polygonal / control-point approximations | **Historical Baseline Only.** Used in `M00.2` solely to record where the prototype diverges from exact mathematics (`Class B: Intentional Mathematical Upgrade`). Never used as a ground-truth oracle. |
| **`C1-Fast`** | Production Python Runtime | IEEE-754 `binary64` (`float64` via `NumPy`/`SciPy`) with compensated summation (Kahan/Neumaier) and condition-number monitoring | **Primary Runtime Engine (`M02`/`M05`).** Executes fast drafting, adaptive Gauss-Legendre integration, and Bezier offset fitting (`< 50 ms` per block). Automatically escalates to `C1-Cert` whenever a conditioning guard triggers. |
| **`C1-Cert`** | Certified Reference Oracle & Fallback | Outward-rounded interval arithmetic ($\mathbb{I}\mathbb{F}_{53}$ screen + $\mathbb{I}\mathbb{F}_{113}$ quad-precision certification tier) + exact rational arithmetic ($\mathbb{Q}$, Python `fractions.Fraction`) for exact Bernstein-basis sign evaluation | **Ground-Truth Verification Oracle (`M00.4`) & Degeneracy Fallback (`M02e`).** Certifies root brackets, distinguishes removable parameterization degeneracies (`Category 2c`, e.g., $\mathbf{B}(t) = (t^3, 0)$) from true geometric cusps (`Category 2a`/`2b`), and resolves grazing tangencies (`Category 3`). |

### 3.1 Automatic Escalation Triggers (`C1-Fast` $\to$ `C1-Cert`)
The `C1-Fast` runtime must automatically invoke the `C1-Cert` certified kernel whenever any of the following four conditions occurs on a curve segment (`ADR-009 §5.2`):
1. **Near-Zero Base Speed:** $\min_{t \in [0,1]} Q(t) \le 10^{-8} \cdot \max_{t \in [0,1]} Q(t)$ (potential $Q(t^*)=0$ root requiring Taylor/Puiseux order $(m, n)$ classification to separate `Category 2a` true zero-speed cusps from `Category 2c` removable parameterization degeneracies).
2. **Near-Critical Offset Speed Factor:** $\min_{t \in [0,1]} |1 - s\,d\,\kappa(t)| \le 10^{-3}$ (potential regular curvature cusp `Category 2b` or tangential grazing degeneracy `Category 3`).
3. **Bernstein Sign Ambiguity:** Evaluated `float64` Bernstein coefficients of $P_{\mathrm{cusp}}(t)$ fall within the floating-point error bound $|\hat{b}_k| \le \varepsilon_{\mathrm{mach}} \cdot \max_j |\hat{b}_j| \cdot 2^{12}$.
4. **Post-Fit Tolerance Violation:** The `C1-Fast` dense-grid offset approximation error $E_{\mathrm{grid}}$ exceeds $0.004\text{ cm}$ (`80%` of the $0.005\text{ cm}$ budget).

---

## 4. Three-Classification Parity & Divergence Taxonomy

During `M00.2` (Baseline Behavioral Capture) and `M00.4` (Golden Dataset & Reference Verification Harness), every comparison between `C0-Legacy` (TypeScript) and `C1-Cert` (Exact Mathematical Oracle) is classified into one of three categories:

1. **`CLASS A — EXACT INVARIANT PARITY`:**
   * Topological piece count, piece IDs, notch count, grainline orientation vector, and straight-line horizontal/vertical construction coordinates where `C0-Legacy` used exact arithmetic.
   * **Requirement:** `C1-Fast` must match `C0-Legacy` within $\le 10^{-6}\text{ cm}$.
2. **`CLASS B — INTENTIONAL MATHEMATICAL UPGRADE (AUTHORIZED DIVERGENCE)`:**
   * Curved seam lengths (armscye, neckline, crotch curve, sleeve cap), exact normal offset curves $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t)$, cusp trimming (`Category 2a`/`2b`), removable parameterization degeneracy reparameterization (`Category 2c`), and miter joins.
   * **Requirement:** `C0-Legacy` is documented as mathematically approximate in the `BaselineDivergenceRegistry.json` (`M00.2`). `C1-Fast` is verified strictly against the **`C1-Cert` Reference Oracle** (`ADR-009`), **not** against `C0-Legacy`.
3. **`CLASS C — REGRESSION / DEFECT (BLOCKING FAILURE)`:**
   * Any discrepancy between `C1-Fast` and `C1-Cert` exceeding the certified tolerances in Section 5, or any unapproved topological difference vs. `C0-Legacy`.
   * **Requirement:** Blocks milestone exit and CI pipeline immediately.

---

## 5. Binding Numerical Tolerance & Certification Matrix (`ADR-009` Alignment)

All `C1-Fast` outputs must satisfy the following tolerances when measured against the `C1-Cert` oracle:

| Geometric / Physical Quantity | Symbol | Certified Tolerance Bound | Governing Verification Method (`ADR-009`) |
| :--- | :--- | :--- | :--- |
| **Forward Arc-Length Integral** | $|L_{\mathrm{fast}}(t) - L_{\mathrm{cert}}(t)|$ | $\le 10^{-6}\text{ cm}$ (`10 nm`) | Adaptive 5-point Gauss-Legendre vs. 113-bit interval quadrature |
| **Inverse Arc-Length Parameter ($s \mapsto t$)** | $|L(t^*) - s_{\mathrm{target}}|$ | $\le 10^{-7}\text{ cm}$ (`1 nm`) | Monotone Newton-Brent with certified bracket $[\underline{t}, \overline{t}]$ |
| **Parameter Root Bracket Width** | $\delta_t = \overline{t} - \underline{t}$ | $\le 10^{-12}$ (dimensionless) | Interval Newton / bisection in `C1-Cert` |
| **Physical Root / Notch Position Uncertainty** | $\Delta_{\mathrm{pos}}([t]) = \sup_{\tau \in [t]} \|\mathbf{B}'(\tau)\|\,\delta_t$ | $\le 10^{-7}\text{ cm}$ (`1 nm`) | First-order Taylor velocity enclosure (`ADR-009 §4.1`) |
| **Offset Curve Fit (Dense Grid)** | $E_{\mathrm{grid}}$ ($N_{\mathrm{grid}} = 1024$) | $\le 0.005\text{ cm}$ (`0.05 mm`) | Max normal/Euclidean deviation at 1024 sample points |
| **Offset Curve Fit (Certified Interval)** | $E_{\mathrm{cert}}$ ($N_{\mathrm{cert}} \ge 256$ panels) | $\le 0.010\text{ cm}$ (`0.10 mm`) | Rigorous interval enclosure over all $t \in [0, 1]$ (`ADR-009 §4.3`) |
| **Join Tangent Continuity ($G^1$)** | $\Delta\theta_{\mathrm{join}}$ | $\le 0.05^\circ$ | Interior smooth join tangent angle delta |
| **Paired CAD Seam Length Delta** | $|L(e_A) - L(e_B) - \Delta_{\mathrm{ease}}|$ | $\le 0.050\text{ cm}$ (`0.50 mm`) | Walked arc-length parity at CAD gate (`DEC-11`) |
| **Topological Contour Closure** | $\|\mathbf{P}_{\mathrm{start}} - \mathbf{P}_{\mathrm{end}}\|$ | $\le 10^{-6}\text{ cm}$ (`10 nm`) | Exact vertex ring closure + `is_simple == True` |

---

## 6. Adversarial Geometry Test Suite (`AG-01` through `AG-17`)

Before the Strangler-Fig proxy (`M01.2`) can route traffic to the Python engine, the `M00.4` Reference Verification Harness must implement and execute all **17 Adversarial Geometry Test Families** (`AG-01` through `AG-17`, specified in `ADR-009 §6.2`), covering:
* **`AG-01`–`AG-04`:** Exact circular arc sanity baselines (inward/outward sub-critical, critical $d = R$, and super-critical $d > R$ on CCW exterior contours).
* **`AG-05`–`AG-08`:** Inflection points ($C(t^*)=0$), high-curvature French curves ($\kappa_{\max} > 1/d$), grazing tangential cusps ($f(t^*)=0, f'(t^*)=0$, `Category 3`), and symmetric double-cusp swallowtails (`Category 2b` + `Category 4`).
* **`AG-09`–`AG-12`:** Base-curve $Q(t^*)=0$ singularities:
  * `AG-09`: Interior true zero-speed cusp $\mathbf{B}(t) = (t^2, t^3)$ on $[-1, 1]$ (`Category 2a: ACTUAL_ZERO_SPEED_CUSP`).
  * `AG-10`: Endpoint zero-speed degeneracy $\mathbf{P}_1 = \mathbf{P}_0$ (`Category 1` / `Category 2a` depending on limiting curvature).
  * `AG-11`: Interior **removable parameterization degeneracy** $\mathbf{B}(t) = (t^3, 0)$ on $[-1, 1]$ (reparameterized on $[0, 1]$ at $u = 0.5$), verifying that $Q(0.5) = 0$ is classified as `Category 2c: REMOVABLE_PARAMETERIZATION_DEGENERACY` with continuous tangent $\mathbf{T} = (1, 0)$ and $\kappa = 0$, **never** as a geometric cusp.
  * `AG-12`: Coincident interior control points $\mathbf{P}_1 = \mathbf{P}_2$ with non-collinear endpoints.
* **`AG-13`–`AG-17`:** Extreme speed ratio ($\max Q / \min Q > 10^8$), acute miter join spike clipping, concave pocket global self-intersection (`Category 4`), Wilkinson-style near-multiple root clusters, and full bodice armscye + notch + seam-allowance integration.

> **Verification Honesty Note (`R2.1.2-R1`):** Only the 4 analytical circle sanity cases and the $\mathbf{B}(t) = (t^3, 0)$ analytical derivation have been verified at specification time (`ADR-009 §6.1`). The 17-family test matrix (`AG-01`–`AG-17`) and the `IntervalLibraryQualificationReport` are **mandatory future engineering deliverables** to be implemented and executed in `M00.4` and `M00.10`.

---

## 7. Strangler-Fig Cutover Sequence (`M00` $\to$ `M01` $\to$ `M02`)

1. **Phase 0 (`M00` — Pre-Migration Preparation, Blocked Pending `Gate Auth-1`):**
   * Freeze contract schemas (`M00.1`), capture `C0-Legacy` behavioral snapshots and `BaselineDivergenceRegistry.json` (`M00.2`), execute `IntervalLibraryQualificationReport` and build the `C1-Cert` verification oracle + 17-family adversarial suite (`M00.4`), and verify green CI (`M00.10`).
2. **Phase 1 (`M01` — Platform Shell & Dual-Harness Proxy, Blocked Pending `Gate Auth-2`):**
   * Stand up Next.js 15 (`apps/web/`) and FastAPI (`services/geometry-engine/`). Run shadow comparisons between `C0-Legacy` and Python skeleton.
3. **Phase 2 (`M02` — Deterministic Fashion Engine Cutover):**
   * Decommission `src/services/patternEngine.ts`, `seamAllowance.ts`, and `gradingEngine.ts` once `M02` passes 100% of the `AG-01`–`AG-17` adversarial suite and `Gate Auth-3` sign-off is granted.
