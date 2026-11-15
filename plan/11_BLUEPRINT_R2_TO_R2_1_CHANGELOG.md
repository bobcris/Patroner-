# 11 — BLUEPRINT REVISION 2 TO REVISION 2.1 CHANGELOG (`R2` → `R2.1`)

**Document ID:** `PATRONER-BP-R2.1-11`  
**Status:** Controlled Architecture, Dependency, Numerical Assurance & Release-Governance Correction Record  
**Prepared Date:** 15 November 2026  
**Governing Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`, `Addendum v4.1`, `Revision v4.5`, `v5.15 Commercial Ecosystem Update`, Specialist Dossiers `01`–`16`

---

## 1. Purpose of This Document

This changelog provides a complete, auditable record of every controlled correction made between **Blueprint Revision 2 (`R2`, branch `docs/blueprint-revision-2`, commit `f677c6f`)** and **Blueprint Revision 2.1 (`R2.1`, branch `docs/blueprint-revision-2.1`)**.

For each correction, it documents:
1. Correction ID & Title  
2. Original `R2` Wording or Behavior  
3. Corrected `R2.1` Wording or Behavior  
4. Technical & Architectural Reason  
5. Governing Source Authority  
6. Affected Documents  
7. Dependency & Critical-Path Impact  
8. Acceptance & Release-Gate Impact  
9. Whether Explicit Human Approval Is Required  

---

## 2. Detailed Register of Controlled Corrections (`Correction 01` – `Correction 07` + Cross-Document Alignment)

### Correction 01 — Repair `M04` Dependency Circularity (`M04a` vs. `M04b` Split)
- **Original `R2` Wording / Behavior:**
  - `05_WORKLOAD_DEPENDENCY_GRAPH.md` and `workloads/M04_AI_VISION_AND_WORLD_MODEL.md` listed `M02d` (Parametric Blocks) and `M02e` (Style Operators) as upstream prerequisites of the entire `M04` workload (`M02d --> M04`, `M02e --> M04`, `M04 --> M02e`).
  - Meanwhile, `08_VERTICAL_SLICE_DEFINITION.md` required multimodal interpretation (`Step 02`) and confirmed design intent (`Step 03`) *before* deterministic drafting (`Step 06`), creating a circular dependency between `M04` and `M02d`/`M02e`.
- **Corrected `R2.1` Wording / Behavior:**
  - `M04` is formally decomposed into two distinct sub-workloads with non-circular dependencies:
    - **`M04a` — Multimodal Perception and Design Intent:** Ingests reference images/sketches and design briefs (`M01.5`), extracts visual observations (`DesignObservationBundle`), separates `OBSERVED_VISIBLE` features from `INFERRED_CATEGORY_PRIOR` assumptions and `AMBIGUOUS_REQUIRES_CONFIRMATION` prompts, drives the human clarification workflow, and freezes the user-confirmed `GarmentIntentSpecification` (`state: Specified`) with source provenance. **`M04a` depends ONLY on `M01` (`M01.3`, `M01.5`) and executes prior to deterministic drafting.** It never creates authoritative geometry, never silently estimates missing body measurements, and never promotes inferred details without user approval.
    - **`M04b` — Controlled Recipe Compilation and Engine Integration:** Converts the user-approved `GarmentIntentSpecification` (`M04a`) into a typed `GarmentRecipe` and `RecipeOperatorAST`, validates operator compatibility and parameter sufficiency against `M02c` (Measurements), `M02d` (Blocks), `M02e` (Style Operators), and `M03` (Material Mechanics), emits a typed `DraftPlan` / `EnginePlan`, invokes deterministic Python drafting, and records execution provenance. **`M04b` depends on `M04a`, `M02c`, `M02d`, `M02e`, and `M03`.**
- **Reason:** Eliminates the `M04` ↔ `M02d`/`M02e` dependency cycle while preserving the strict epistemic boundary between perception/intent (`Dossier 07`) and deterministic recipe compilation (`Dossier 08`).
- **Governing Source:** `v5.16 Ch. 09, 10, 11`, `Revision v4.5`, `Dossier 07 (v5.5)`, `Dossier 08 (v5.6)`.
- **Affected Documents:** `README.md`, `00_BLUEPRINT_REVISION_2.md`, `01_SOURCE_REGISTER_AND_REQUIREMENTS.md`, `02_ARCHITECTURE_DECISIONS.md`, `05_WORKLOAD_DEPENDENCY_GRAPH.md`, `08_VERTICAL_SLICE_DEFINITION.md`, `workloads/M02_DETERMINISTIC_FASHION_ENGINE.md`, `workloads/M04_AI_VISION_AND_WORLD_MODEL.md`, `decisions/ADR-004_AI_EPISTEMIC_DISCIPLINE_AND_RECIPE_COMPILATION.md`.
- **Dependency Impact:** Breaks the cycle `M02e ↔ M04`; `M04a` now runs in parallel with `M02a`–`M02e` immediately after `M01`, and `M04b` sits cleanly between `(M04a + M02c + M02d + M02e + M03)` and `M02f`.
- **Acceptance Impact:** `REQ-AI-01` is refined into `REQ-AI-01a` (`M04a` epistemic perception & human disambiguation gate) and `REQ-AI-01b` (`M04b` deterministic recipe compilation gate) under `AC-02`, `AC-04`, `AC-05`, `AC-11`.
- **Human Approval Required:** **No** (Directly mandated by governing architecture `Revision v4.5` and `Dossiers 07 & 08`).

---

### Correction 02 — Reconcile `M02h` (Marker Nesting) and the Vertical Slice
- **Original `R2` Wording / Behavior:**
  - `08_VERTICAL_SLICE_DEFINITION.md` Step 12 required marker nesting (`M02h`), piece production sheets, and tech packs, but `05_WORKLOAD_DEPENDENCY_GRAPH.md` omitted `M02h` from the Mermaid links into `M05` / `VS` and omitted `M02h` from Critical Path 1.
  - Furthermore, pre-compaction files (`README.md`, `00`, `01`, `04`) referred to `M02h` as "Independent Validation" whereas `05` and `workloads/M02_DETERMINISTIC_FASHION_ENGINE.md` defined `M02h` as "Deterministic Nesting & Marker Utilization".
- **Corrected `R2.1` Wording / Behavior:**
  - Standardizes `M02a`–`M02h` across all 32 documents so **`M02h` is uniformly `Deterministic Marker Nesting, Validation & Utilization Reporting`** (while independent validation is embedded across `M02b`, `M02f`, `M02g`, `M02h`, and `M05.5`).
  - Connects `M02g` (Multi-Size Grading) and `M03` (Material & Fabric-Width Constraints) → `M02h` → `M05` → `VS` in the Mermaid graph, prerequisite matrix, and Critical Path 1.
  - Establishes the explicit **8-Stage Sequence** in `08_VERTICAL_SLICE_DEFINITION.md` (§4), `workloads/M02_DETERMINISTIC_FASHION_ENGINE.md`, and `workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md`:
    1. Validated pattern geometry (`M02a`, `M02b`, `M02d`, `M02e`, `M02f`)
    2. Validated multi-size grading (`M02g`)
    3. Material & fabric-width/nap/shrinkage constraints (`M03`)
    4. Marker input preparation (`M02h`)
    5. Deterministic marker nesting (`M02h`)
    6. Independent marker validation (zero piece-piece or piece-boundary overlap via outward-buffered polygon containment, grainline tilt adherence $\le 0.1^\circ$) & utilization reporting (`M02h`)
    7. Piece production sheets (`M05.1`)
    8. Manufacturing tech pack & `M02h`-linked BOM fabric consumption (`M05.2`–`M05.5`).
  - Defines `M02h` marker nesting as a **mathematically authoritative manufacturing computation for BOM fabric consumption, cost estimation, and reference cutting layout**, while strictly distinguishing it from **physical plotter/cutter dimensional qualification (`AC-10`)** and **incoming physical fabric roll width verification (`M07.3`, `RSK-14`)**.
- **Reason:** Aligns the dependency graph, sub-workload naming, `M05` BOM calculation, and Vertical Slice Step 12.
- **Governing Source:** `v5.16 Ch. 07, 09, 15`, `Dossier 03 (v5.1)`, `Dossier 13 (v5.11)`, `Dossier 14 (v5.12)`.
- **Affected Documents:** `README.md`, `00_BLUEPRINT_REVISION_2.md`, `01_SOURCE_REGISTER_AND_REQUIREMENTS.md`, `04_MIGRATION_AND_PARITY_POLICY.md`, `05_WORKLOAD_DEPENDENCY_GRAPH.md`, `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`, `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`, `08_VERTICAL_SLICE_DEFINITION.md`, `workloads/M02_DETERMINISTIC_FASHION_ENGINE.md`, `workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md`, `workloads/M07_MAKER_NETWORK_AND_TRACEABILITY.md`.
- **Dependency Impact:** `M02h` depends on `M02g` and `M03`; `M05` and `Vertical Slice` depend on `M02h`.
- **Acceptance Impact:** Adds explicit independent marker non-overlap, strip containment, and grainline angle verification to `AC-03`, `AC-05`, and `AC-10`.
- **Human Approval Required:** **No** for sequence/integration; **`DEC-06`** remains open for human confirmation of the specific in-house NFP solver implementation.

---

### Correction 03 — Resolve `M09` / `M10` Release-Gate Circularity (`Level A` / `Level B` / `Level C`)
- **Original `R2` Wording / Behavior:**
  - `10_RELEASE_AND_GOVERNANCE_POLICY.md` (`Gate F.10`) and `workloads/M09_COMMERCIAL_PILOT.md` (`M09.1`) required all 10 `v5.16 Appendix F` institutional gates—including `Gate F.10` (`M10` enterprise multi-region restore drills and automated GDPR crypto-shredding)—to be signed off *before* launching `M09`, even though `M10` depends on completing `M09`.
- **Corrected `R2.1` Wording / Behavior:**
  - Separates release governance into three explicit, non-circular levels across `05`, `06`, `09`, `10`, `M09`, and `M10`:
    - **Level A — Engineering & Controlled Pilot Entry Release (`M09` Entry Gate):** All architecture, security (`AC-11` core RBAC+ABAC, RLS, 3-point job re-auth), certified numerical/construction/grading/marker validity (`AC-01`–`AC-06`), calibrated material (`AC-07`), simulation & physical toile concordance (`AC-08`, `AC-09`), qualified workshop & physical first-article sample sign-off (`AC-10`), 8-role offer & multi-currency ledger (`AC-12`), and pilot-scoped operational recovery (single-region automated PostgreSQL + object backups with verified pre-pilot restore drill and documented GDPR erasure workflow).
    - **Level B — `M09` Controlled Pilot Exit Acceptance (Unlocks `M10`):** Actual measured physical, quality, fit, workshop, and financial exit criteria from the live $\le 50$-unit pilot ($\ge 95\%$ first-pass POM QC yield, $\le 8\% / 12\%$ fit return rate, $0$ minor-unit cash-to-ledger reconciliation variance). Never substituted by software unit tests.
    - **Level C — Enterprise & Institutional Scale Release (`M10` Exit Gate):** Multi-region active/standby DR drills (`RPO <= 5 min`, `RTO <= 30 min`), automated crypto-shredding at scale, BYOK KMS, enterprise partner OAuth2/mTLS APIs, and repeatable Brand Studio / celebrity advance recoupment waterfalls.
  - Reconciles all 10 `v5.16 Appendix F` gates across Levels A, B, and C without removing any requirement.
- **Reason:** Removes the `M09` ↔ `M10` deadlock while ensuring the `M09` pilot runs with full engineering, physical sample, security, and financial safety (`Level A`) and is never misrepresented as enterprise scale readiness (`Level C`).
- **Governing Source:** `v5.16 Ch. 09, 14, 15, 17, App. F`.
- **Affected Documents:** `00_BLUEPRINT_REVISION_2.md`, `05_WORKLOAD_DEPENDENCY_GRAPH.md`, `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`, `09_COMMERCIAL_PILOT_DEFINITION.md`, `10_RELEASE_AND_GOVERNANCE_POLICY.md`, `workloads/M09_COMMERCIAL_PILOT.md`, `workloads/M10_ADVANCED_GOVERNANCE_AND_SCALE.md`.
- **Dependency Impact:** `Release Level A` gates `M09` start; `Release Level B` gates `M09` exit and unlocks `M10`; `Release Level C` gates `M10` exit.
- **Acceptance Impact:** Maps `AC-01`–`AC-12` and `Appendix F` Gates `F.1`–`F.10` explicitly to Levels A, B, and C.
- **Human Approval Required:** **No** (Directly aligns with `v5.16 Ch. 14/15` phase progression `Phase E` → `Phase F/G`).

---

### Correction 04 — Strengthen Numerical Certification (`Four-Tier Separation` & `ADR-009`)
- **Original `R2` Wording / Behavior:**
  - `R2` used `mpmath` (`mp.dps = 80`) reference values and heuristic quadrature step differences ($|\mathcal{I}_{2n} - \mathcal{I}_n|$) and described them as "guaranteed" or "certified" error bounds.
  - `R2` also cited both `0.05 cm` (`0.5 mm`) and `0.20 cm` (`2.0 mm`) for paired seam tolerances across different files (`CNF-006`).
- **Corrected `R2.1` Wording / Behavior:**
  - Strictly separates four concepts in `04_MIGRATION_AND_PARITY_POLICY.md` (§3), `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`, `M00`, `M02`, `ADR-003`, and new **`ADR-009` (`PROPOSED`)**:
    1. **High-Precision Reference Value ($X_{\text{ref}}$):** Independent `mpmath` (`mp.dps = 80`) oracle calculation for differential testing in CI.
    2. **Floating-Point Implementation Error ($E_{\text{impl}} = |X_{\text{fp64}} - X_{\text{exact}}|$):** Actual error of the IEEE 754 `float64` runtime computation.
    3. **Certified / Rigorously Justified Numerical Error Bound ($B_{\text{cert}}$):** Mathematically defensible enclosure derived via **Method C1** (De Casteljau chord vs. control-polygon length enclosure $L_{\text{chord}} \le L_{\text{exact}} \le L_{\text{poly}}$ + outward ULP roundoff padding), **Method C2** (exact degree-5 algebraic Green's polynomial + Higham $\gamma_k$ inner-product error bound), or **Method C3** (Bernstein convex-hull bounds + IEEE 1788 interval arithmetic `mpmath.iv`). Prohibits claiming certification merely because $|\mathcal{I}_{2n} - \mathcal{I}_n|$ is small.
    4. **Domain Acceptance Tolerance ($\tau_{\text{domain}}$):** Engineering threshold requiring $E_{\text{impl}} \le B_{\text{cert}} \le \tau_{\text{domain}}$.
  - Documents the **10-Column Mathematical Assurance Matrix** across all 8 mathematical domains (Arc length, Green's area, Bézier subdivision/projection, Offset curves, Curvature, Intersection/self-intersection, Grading, Marker geometry) in `04_MIGRATION_AND_PARITY_POLICY.md` (§4).
  - Records the `0.05 cm` vs. `0.20 cm` seam tolerance discrepancy as `CNF-006` and proposes **`DEC-11`** (Two-Tier Domain Tolerance: `0.05 cm` for 2D digital net sew-line geometry vs. `0.20 cm` for physical sewn assembly/POM inspection) for human approval.
- **Reason:** Ensures mathematical rigor and prevents conflating empirical quadrature convergence with formal interval/enclosure certificates.
- **Governing Source:** `v5.16 App. A2–A3`, `Dossier 03 (v5.1)`, `Dossier 06 (v5.4)`, Phase E3 Audit Findings.
- **Affected Documents:** `01_SOURCE_REGISTER_AND_REQUIREMENTS.md`, `04_MIGRATION_AND_PARITY_POLICY.md`, `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`, `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`, `workloads/M00_MIGRATION_PREPARATION.md`, `workloads/M02_DETERMINISTIC_FASHION_ENGINE.md`, `decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md`, `decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md`.
- **Dependency Impact:** `M00.4` builds both the `mpmath` reference oracle and the `mpmath.iv` / Bernstein certified bound verifier consumed by `M02a`–`M02h` and `M05`.
- **Acceptance Impact:** Strengthens `AC-03` to require mathematically justified enclosure bounds (`Method C1/C2/C3`).
- **Human Approval Required:** **Yes** — **`ADR-009`**, **`DEC-11`** (Two-Tier Seam Tolerance), and **`DEC-13`** (`mpmath.iv` + Bernstein solver selection) are marked `PROPOSED` for human review and approval.

---

### Correction 05 — Complete-Interval ($t \in [0, 1]$) Offset Cusp and Reversal Verification (`ADR-009`)
- **Original `R2` Wording / Behavior:**
  - `R2` specified checking offset sub-segments on a 65-point Gauss–Lobatto grid (`u = 0..1`) plus analytical curvature extrema.
- **Corrected `R2.1` Wording / Behavior:**
  - Explicitly states that a finite sampling grid alone cannot prove the absence of interior violations over $t \in [0, 1]$.
  - Separates **Stage 1 Fast Detection Heuristics** (65-point Gauss–Lobatto screening for fast early rejection) from **Stage 2 Proof-Quality Complete-Interval Verification over $t \in [0, 1]$** (`ADR-009`, `M02f`, `M05.1`):
    1. **Base Curve Regularity Proof:** Express speed squared $V(t) = x'(t)^2 + y'(t)^2$ (degree-4 polynomial) in the **Bernstein basis on $[0, 1]$** with outward-rounded interval coefficients (`mpmath.iv`). Prove $V(t) \ge v_{\min}^2 > 0$ across all $t \in [0, 1]$ via Bernstein convex-hull positivity / certified interval subdivision (catching interior stationary cusps such as $t = 0.25$ in `DEF-M00-02` regardless of location).
    2. **Exact Offset Evolute / Cusp Absence Proof:** Express signed curvature numerator $N(t) = x'(t)y''(t) - y'(t)x''(t)$ (degree 2) and the rational-free cusp polynomial $Q_{\text{cusp}}(t) = V(t)^3 - d^2 N(t)^2$ (degree 6) in the Bernstein basis on $[0, 1]$. Whenever $s \cdot d \cdot N(t) < 0$ is possible on a sub-interval, prove $Q_{\text{cusp}}(t) > 0$ over the entire continuous interval $t \in [0, 1]$ using certified Bernstein subdivision and Descartes' rule of signs in Bernstein form.
    3. **Tangent Reversal Absence Proof:** Express the synchronized tangent inner product $D(u) = \tilde{\mathbf{O}}'(u) \cdot \mathbf{B}'(t(u))$ (degree 4) in Bernstein form on $[0, 1]$ and prove $D(u) > 0$ over the entire interval $u \in [0, 1]$.
    4. **Certified Radial Offset Error & Span Coverage:** Enclose $\|\tilde{\mathbf{O}}(u) - \mathbf{B}(t(u))\|^2 - d^2$ over $u \in [0, 1]$ via interval arithmetic and require primary segment projection span $[s_0, s_1]$ to cover $\ge 85\%$ of base arc length (blocking `2%` short-span line substitutions from `DEF-M00-02`).
    5. **Global Self-Intersection & Corner/Miter Envelope Trimming:** Isolate exact self-intersection and corner miter intersections via 2D Bézier fat-line clipping + interval Krawczyk / Newton refinement and trim self-intersecting offset loops.
- **Reason:** Provides a mathematically rigorous proof over the continuous parameter interval $t \in [0, 1]$ tailored to cubic Bézier representations.
- **Governing Source:** `v5.16 App. A3`, `Dossier 03 (v5.1)`, `Dossier 14 (v5.12)`, Phase E3 Audit Findings (`DEF-M00-02`).
- **Affected Documents:** `04_MIGRATION_AND_PARITY_POLICY.md`, `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`, `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`, `workloads/M00_MIGRATION_PREPARATION.md`, `workloads/M02_DETERMINISTIC_FASHION_ENGINE.md`, `workloads/M05_PRODUCTION_AND_MANUFACTURING_DOCUMENTATION.md`, `decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md`, `decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md`.
- **Dependency Impact:** Implemented in `M00.4` (oracle) and `M02a`/`M02f` (engine) and enforced by `M05.1`.
- **Acceptance Impact:** Required for `AC-03`, `AC-05`, and `AC-10`.
- **Human Approval Required:** **Yes** — Formalized in **`ADR-009` (`PROPOSED`)** and **`DEC-13`** for human architectural approval.

---

### Correction 06 — Multi-Currency & Jurisdiction-Aware Financial Architecture (`M08` & `ADR-008`)
- **Original `R2` Wording / Behavior:**
  - `ADR-008` and `workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md` used integer minor units with `"EUR"` ("cents") as the example and did not specify variable ISO 4217 currency exponents (`0`, `2`, `3`, `4`), explicit rounding policies, FX rate provenance, dual transaction vs. functional currency balancing, or realized/unrealized FX gain/loss treatment.
- **Corrected `R2.1` Wording / Behavior:**
  - Updates `M08`, `ADR-008`, `01_SOURCE_REGISTER_AND_REQUIREMENTS.md` (`REQ-FIN-01`), `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md` (`AC-12`), and `09_COMMERCIAL_PILOT_DEFINITION.md` to define:
    1. **ISO 4217 Currency Identity & Variable Exponent Registry:** Every currency record specifies `{ currency_code: ISO4217Code, minor_unit_exponent: 0 | 2 | 3 | 4 }` (e.g., `JPY`=`0`, `EUR`/`USD`/`GBP`=`2`, `KWD`/`BHD`/`TND`=`3`). Never hardcode `100` cents.
    2. **Integer Minor-Unit Storage & Explicit Rounding Policy:** Monetary values are stored as 64/128-bit integers in native minor units ($10^{\text{exponent}}$). Intermediate percentage/tax/royalty/FX splits use exact decimal arithmetic (`decimal.Decimal`, 28+ digits) and round to `minor_unit_exponent` via explicit configurable policy (`ROUND_HALF_EVEN` default, or `ROUND_HALF_UP` where statutory tax profile requires), with deterministic largest-remainder allocation guaranteeing $\sum \text{allocated\_parts} == \text{total\_minor\_units}$.
    3. **Exchange-Rate Source, Timestamp & Provenance:** Immutable `ExchangeRateSnapshot` (`rate_id`, `base_currency`, `quote_currency`, `rate_decimal`, `rate_source` [ECB / PSP settlement lock], `observed_at_utc`, `sha256_digest`).
    4. **Transaction Currency vs. Functional/Reporting Currency & FX Gain/Loss:** Every `JournalLine` records both `(transaction_currency, transaction_amount_minor)` and `(functional_currency, functional_amount_minor)`, balanced independently in both currencies (`Sum(Debits) == Sum(Credits)`), with differences between authorization/capture, settlement, and payout rates posted to `4810 Realized FX Gain`, `5810 Realized FX Loss`, and `4820 Unrealized FX Revaluation`.
    5. **Pilot Operating Jurisdiction vs. International Capability (`DEC-12`):** Distinguishes the `M09` pilot's single operating jurisdiction/functional currency from the `M08`/`M10` multi-currency engine, and explicitly states that financial software architecture is **not** a substitute for external CPA/legal tax certification.
- **Reason:** Prevents currency-exponent bugs on zero-decimal (`JPY`) or three-decimal (`KWD`) currencies, guarantees multi-currency auditability, and avoids inventing jurisdiction-specific tax law.
- **Governing Source:** `v5.16 Ch. 08, 12, 15`, `v5.15 Commercial Ecosystem Update`.
- **Affected Documents:** `01_SOURCE_REGISTER_AND_REQUIREMENTS.md`, `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`, `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`, `09_COMMERCIAL_PILOT_DEFINITION.md`, `workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md`, `decisions/ADR-008_FINANCIAL_TRANSACTION_MODEL.md`.
- **Dependency Impact:** Scoped within `M08` and verified before `M09` (`Level A Gate`).
- **Acceptance Impact:** Updates `AC-12` to test `0`, `2`, `3`, and `4` exponent currencies, FX revaluation, and remainder-free split conservation.
- **Human Approval Required:** **Yes** — **`ADR-008` (Multi-Currency Ledger Schema)** and **`DEC-12` (Pilot Jurisdiction & Legal/Tax Sign-Off)** require human financial/legal approval.

---

### Correction 07 — Explicit Dossier 02 and Dossier 04 Precedence Reconciliation Matrices
- **Original `R2` Wording / Behavior:**
  - `R2` noted that `Addendum v4.1` superseded historical TypeScript/Node.js/Wasm runtime assumptions in `Dossier 02 v5.0` and `Dossier 04 v5.2`, which risked reading as if the dossiers themselves were superseded.
- **Corrected `R2.1` Wording / Behavior:**
  - Adds two explicit **6-Column Reconciliation Matrices** (`Dossier requirement | Original requirement | Superseded implementation assumption, if any | Retained normative requirement | Target owner | Verification`) in `01_SOURCE_REGISTER_AND_REQUIREMENTS.md` (§3.1 & §3.2) and cross-references them in `M01` and `M03`:
    - **Dossier 02 v5.0 (`DOS-02-R1` through `DOS-02-R7`):** Retains intake validation, user-approved snapshot gates, typed `EnginePlan` compilation, sync/async job state machine, idempotency/retries, 3-point queued-job re-authorization, and execution manifests (`M01`, `M04b`).
    - **Dossier 04 v5.2 (`DOS-04-R1` through `DOS-04-R6`):** Retains orthotropic continuum mechanics (warp/weft/bias), cantilever bending rigidity (`ASTM D1388`) & Cusick drape (`ISO 9073-9`), tensile extension & cyclic recovery, relaxation/thermal shrinkage & seam take-up, construction-aware regional ease & signed negative-ease policies, and separation of presets from measured lab data (`M03`).
- **Reason:** Ensures 100% traceability of all normative domain requirements in Dossiers 02 and 04 while cleanly isolating obsolete runtime assumptions.
- **Governing Source:** `v5.16 Ch. 10, App. A7, A12, App. E`, `Addendum v4.1`, `Dossier 02 (v5.0)`, `Dossier 04 (v5.2)`.
- **Affected Documents:** `01_SOURCE_REGISTER_AND_REQUIREMENTS.md`, `workloads/M01_CANONICAL_FOUNDATION_AND_SECURITY.md`, `workloads/M03_MATERIAL_AND_FABRIC_MECHANICS.md`, `decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md`, `decisions/ADR-005_MATERIAL_AND_SIMULATION_CREDIBILITY.md`.
- **Dependency Impact:** None (reinforces `M01`, `M03`, `M04b`).
- **Acceptance Impact:** Explicitly maps `DOS-02-R1..R7` and `DOS-04-R1..R6` to `AC-01`, `AC-02`, `AC-04`, `AC-05`, `AC-07`, `AC-08`, `AC-10`, `AC-11`.
- **Human Approval Required:** **No** (Directly preserves governing dossier authority under `Addendum v4.1`).

---

### Additional Cross-Document Consistency Fixes (`Section 10 Audit`)
- **Unified ADR Filenames & Links:** Reconciled the ADR table in `README.md` and `02_ARCHITECTURE_DECISIONS.md` so every Markdown link points to the exact existing files in `plan/decisions/ADR-001_*.md` through `ADR-009_*.md` (`0` broken links).
- **Unified `M02a`–`M02h` Sub-Workload Definitions:** Reconciled `README.md`, `00_BLUEPRINT_REVISION_2.md`, `01_SOURCE_REGISTER_AND_REQUIREMENTS.md`, `04_MIGRATION_AND_PARITY_POLICY.md`, `05_WORKLOAD_DEPENDENCY_GRAPH.md`, and `workloads/M02_DETERMINISTIC_FASHION_ENGINE.md` so `M02a`–`M02h` have identical IDs, titles, and scopes across every document.
- **Unified 8-State Lifecycle Terminology (`v5.16 Ch. 09`):** Mapped the exact `v5.16 Ch. 09 (p. 16)` state names (`Inspiration`, `AI proposal`, `User-approved design`, `Specification in progress`, `Feasibility reviewed`, `Sample approved`, `Production-ready offer`, `In production / fulfilled`) to the technical state enums (`Concept`, `Specified`, `Drafted`, `Validated`, `Fit_Approved`, `Sample_Approved`, `Production_Ready`, `In_Production_Completed`) in `10_RELEASE_AND_GOVERNANCE_POLICY.md`.
- **Unified 8 Accountable Commercial Roles (`v5.16 Ch. 08`) & 8 Financial Metrics (`v5.16 Ch. 12`):** Reconciled `09_COMMERCIAL_PILOT_DEFINITION.md`, `workloads/M08_COMMERCE_AND_FINANCIAL_ARCHITECTURE.md`, and `decisions/ADR-007` / `ADR-008` so both the 8 accountable customer-facing roles (`seller`, `manufacturer`, `payment collector`, `customer support`, `creator compensation`, `defect liability`, `delay liability`, `return/refund liability`) and the structural governance IDs (`brand_owner`, `ip_owner`, `manufacturing_principal`, `fulfillment_owner`) are explicitly bound on every `ProductOfferContract`.

---

## 3. Summary of Unresolved Decisions Requiring Human Approval

All unresolved architectural, numerical, legal/tax, and operational choices that cannot be settled purely from the governing texts are isolated in [`07_RISK_AND_OPEN_DECISIONS_REGISTER.md`](./07_RISK_AND_OPEN_DECISIONS_REGISTER.md) (`DEC-01` through `DEC-13`) and [`decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md`](./decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md) (`PROPOSED`). In particular:
1. **`DEC-11` (`CNF-006`):** Approval of the Two-Tier Paired Seam Tolerance (`0.05 cm` digital CAD net sew-line geometry vs. `0.20 cm` physical sewn assembly/POM tolerance).
2. **`DEC-12` (`Correction 06`):** Confirmation of the single operating jurisdiction and functional currency (`EUR`) for the `M09` 50-unit pilot and external legal/CPA tax sign-off prior to `M09` launch.
3. **`DEC-13` & `ADR-009` (`Corrections 04 & 05`):** Approval of the `mpmath.iv` + Bernstein-basis polynomial positivity and chord/control-polygon enclosure architecture for certified numerical error bounds.
4. **`DEC-01`–`DEC-10`:** Confirmation of technology/infrastructure selections (Next.js cutover timing, Python cloth solver kernel, 3-tier fabric rig protocol, PostgreSQL + S3/GCS, durable job queue, NFP marker engine, pilot measurement intake mode, Stripe + internal ledger integration, RFC 8785 + Ed25519 release signing, and P1/P2/P3 pilot capsule mix).
