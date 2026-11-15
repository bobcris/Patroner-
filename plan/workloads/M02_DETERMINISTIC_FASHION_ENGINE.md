# WORKLOAD M02 — AUTHORITATIVE DETERMINISTIC FASHION ENGINE (`M02a`–`M02h`) (`R2.1.2`)

## 1. Workload ID & Title
- **Workload ID:** `M02` (Decomposed into Sub-Workloads `M02a`, `M02b`, `M02c`, `M02d`, `M02e`, `M02f`, `M02g`, `M02h`)
- **Title:** Authoritative Production Computational Geometry, Five-Concept Numerical Enclosures with Parameter-to-Output Propagation, Tri-State Complete-Interval Offset Verification, Parametric Block Library, Style Operators, Multi-Size Grading & Deterministic Marker Nesting
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase B & Phase C (Deterministic Fashion Engine)`
- **Authorization Gate (`Critical Corrections D & E`):** Governed by **`Gate Auth-2`** (Requires `M00.10` completion + formal approval of `ADR-009` (`R2.1.2`), `DEC-13 Stage 2` after `M00.4` `IntervalLibraryQualificationReport` & `< 5 ms` benchmark for `M02a`/`M02f`, `DEC-11` for `M02b`/`M02g`, and `DEC-06` for `M02h`).

## 2. Purpose & Authoritative Production Scope (`Section 9`)
`M02` is the authoritative production computational geometry and garment engineering engine of Patroner inside `services/fashion-engine/app/pattern_engine/`.

`M02` (and **not** `M00`) is the sole owner of:
- Authoritative **production geometry algorithms (`M02a`)**,
- Authoritative **production topology and seam-mating validation (`M02b`)**,
- Authoritative **anthropometric body profiles and provenance gates (`M02c`)**,
- Authoritative **parametric foundation blocks (`M02d`)** and **style transformation operators (`M02e`)**,
- Authoritative **production offset curve generation, corner mitering/beveling, envelope trimming, corrected regularity factor $f(t) = 1 - s\,d\,\kappa(t)$, 6-category failure classification, and tri-state complete-interval ($t \in [0, 1]$) verification (`M02f`)**,
- Authoritative **category-strict multi-size grading (`M02g`)** and **deterministic marker nesting (`M02h`)**,
- Numerical implementation contracts (`NumericalVerificationRecord`, `OffsetValidationRecord`), and
- Authoritative domain-level acceptance criteria (`AC-03`, `AC-05`, `AC-06`).

`M02`'s production outputs are independently audited in CI by the separate `M00.4` reference-oracle harness (`services/fashion-engine/tests/oracles/`) under the 5-dimensional oracle independence model (`ADR-009 §6`, `04_MIGRATION_AND_PARITY_POLICY.md §2.3`).

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 05`, `Ch. 09`, `Ch. 15 (Phase B/C)`, `App. A2–A6`
- `Dossier 03 v5.1` (Deterministic Pattern Geometry), `Dossier 08 v5.6` (Garment Recipes & Controlled Draft Compilation), `Dossier 13 v5.11` (Pattern Grading, Multi-Size & Fit Optimization)
- `ADR-003` & `ADR-009` (`R2.1.2` Corrected Offset Derivative Sign $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, Parameter-to-Output Error Propagation `Method B1/B2`, 4-Layer `Method C1-Cert` Assurance, 6-Category Offset Failure Taxonomy & Tri-State Interval Verification)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-GEO-01`** (Authoritative production owner: Full `float64` precision, zero intermediate rounding, 5-concept numerical assurance with parameter-to-output propagation `Method B1/B2`, 4-layer `Method C1-Cert`/`Method C2`/`Method C3` certified enclosures and `Method C1-Est` engineering estimate)
- **`REQ-GEO-02`** (Authoritative production owner: Complete-interval $t \in [0, 1]$ offset verification with $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, separate $Q(t)=0$ check, $s\,d\,C(t)>0$ concave/evolute sign condition, 6-category failure taxonomy, tri-state outcomes `CERTIFIED_VALID`/`CERTIFIED_INVALID`/`INCONCLUSIVE` & $\ge 85\%$ primary span coverage)
- **`REQ-MEAS-01`** (Anthropometric body profile, derived chains, Mahalanobis plausibility & strict provenance gating)
- **`REQ-DRFT-01`** (Parametric foundation blocks & deterministic style transformation operators)
- **`REQ-ASSM-01`** (Topological assembly, two-tier seam mating `DEC-11`, corner mitering & notches)
- **`REQ-GRAD-01`** (Category-strict multi-size grading `M02g` & authoritative deterministic marker nesting `M02h`)

## 5. Current Repository Baseline & Classification
- **`M02a` Planar Geometry (`src/engine/geometry/*`)**: `I2` / `R` — Has Gauss–Legendre quadrature and Green's theorem, but marred by `.toFixed(2)` / `.toFixed(3)` truncation (`DEF-M00-01`, `DEF-M00-06`).
- **`M02b` Pattern Topology & Assembly (`src/engine/assembly/*`, `seam-validator.ts`)**: `I2` / `R` — Downgrades `toleranceAchieved: false` to `'warning'` (`DEF-M00-01`).
- **`M02c` Body Profile (`src/engine/measurements/*`)**: `I1 + X` — Validates ISO 8559 `XS`–`XXL` charts and provenance gates; lacks trouser/dress/knit derived chains.
- **`M02d` Parametric Blocks (`src/engine/drafting/*`)**: `I1/I2 + X` — Implements bodice, sleeve, and basic 2-dart skirt; missing trouser, dress, and knit blocks.
- **`M02e` Style Operators (`dart-manipulation.ts`)**: `I1 + X` for 6 rotational dart styles; `M` for slash-and-spread, yoke split, pleats, and flare.
- **`M02f` Seam Allowance, Miter & Notch (`piece-production-sheet.ts`)**: `P + X` — Misses interior cusps at $t=0.25$ and permits `2%` short-span lines (`DEF-M00-02`).
- **`M02g` Multi-Size Grading (`pattern-grader.ts`)**: `P + X` — Hardcodes `gradeBodice` even for skirts (`DEF-M00-05`).
- **`M02h` Deterministic Marker Nesting & Validation**: `M` (Missing — `0%` implemented).

## 6. Residual Defects Closed in Production by `M02` (`DEF-*`)
- Permanently closes **`DEF-M00-01`**, **`DEF-M00-02`**, **`DEF-M00-05`**, and **`DEF-M00-06`** in authoritative production Python code across `M02a`, `M02b`, `M02f`, and `M02g`.

## 7. Prerequisites, Governance Decisions & Upstream Dependencies (`Critical Corrections D & E`)
- **`Gate Auth-2` Governance Prerequisites (`07_RISK_AND_OPEN_DECISIONS_REGISTER.md`):**
  - `M02a` and `M02f` require `M00.10` completion + formal approval of **`ADR-009` (`R2.1.2`)** and **`DEC-13 Stage 2`** (Production Adoption & `< 5 ms` Performance Gate based on the `M00.4` `IntervalLibraryQualificationReport`).
  - `M02b` and `M02g` additionally require formal approval of **`DEC-11`** (Two-Tier Paired Seam Tolerance).
  - `M02h` additionally require formal approval of **`DEC-06`** (In-house NFP nesting solver architecture).
- **Technical Workload Dependencies:**
  - `M02b` and `M02c` require `M01.3` (World Model revision persistence).
  - `M02d` requires `M02b`, `M02c`, and `M03` (material ease policies).
  - `M02e` requires `M02d`.
  - `M02f` requires `M02a`, `M02b`, `M02d`, `M02e`, and `M04b` (when executing compiled `DraftPlan` recipes).
  - `M02g` requires `M02f`.
  - `M02h` requires `M02g` (Validated Multi-Size Grading) and `M03` (Material & Fabric-Width/Nap/Shrinkage Constraints).

## 8. Target Architecture & Module Ownership (`services/fashion-engine/app/pattern_engine/`)
```text
services/fashion-engine/app/pattern_engine/
├── m02a_geometry/       # Production float64 primitives, Method C1-Cert/C2 enclosures, Method B1/B2 output propagation
├── m02b_topology/       # Half-edge planar graph, piece loop winding, 2D Krawczyk intersection & seam mating verifier
├── m02c_measurements/   # Anthropometric schema, provenance state machine, anatomical & Mahalanobis validator
├── m02d_blocks/         # Parametric blocks: skirt_v1, bodice_sleeve_v1, trouser_v1, dress_v1, knit_v1
├── m02e_operators/      # Deterministic AST operators: rotate_dart (6 styles), slash_spread, split_yoke, pleat, flare
├── m02f_seam_notch/     # Production offset generator (O'=(1-s*d*kappa)B'), 6-category taxonomy, tri-state [0,1] verifier
├── m02g_grading/        # Category-strict multi-size grading (XS-XXL / EU 34-46), anti-cloning & seam matrix verifier
└── m02h_nesting/        # Outward-buffered NFP deterministic strip-packing marker solver & independent layout verifier
```

## 9. Domain Entities, State Machines & Numerical Implementation Contracts
- **`NumericalVerificationRecord` (`ADR-009 §2.5`)**: `{ quantity_name, reference_method_and_version, precision_and_arithmetic_model, enclosure_or_remainder_method, assurance_classification: "CERTIFIED_ENCLOSURE" | "HIGH_PRECISION_NUMERICAL_REFERENCE" | "CONSERVATIVE_ENGINEERING_ESTIMATE", error_components: { x_float64, x_ref, observed_discrepancy_e_obs, reference_enclosure_b_ref, implementation_to_exact_bound_b_cert, heuristic_error_estimate, parameter_enclosure, output_propagation }, acceptance_tolerance_tau, verification_outcome: "CERTIFIED_VALID" | "CERTIFIED_INVALID" | "INCONCLUSIVE", reproducibility_manifest }`.
- **`OffsetValidationRecord` (`ADR-009 §5.3`)**: `{ segment_id, verification_outcome: "CERTIFIED_VALID" | "CERTIFIED_INVALID" | "INCONCLUSIVE", failure_category: "NONE" | "REGULARITY_MARGIN_VIOLATION" | "ACTUAL_ZERO_SPEED_CUSP" | "TANGENT_REVERSAL" | "LOCAL_OFFSET_SELF_INTERSECTION" | "GLOBAL_CONTOUR_SELF_INTERSECTION" | "INCONCLUSIVE_VERIFICATION", coordinate_convention: "CARTESIAN_RH_CCW", offset_sign_s, offset_distance_d_cm, regularity_margin_epsilon: 0.05, max_subdivision_depth_reached, min_certified_speed_sq_cm2, min_certified_regularity_factor, max_certified_radial_error_cm, primary_span_coverage_ratio, local_self_intersection_status, global_contour_self_intersection_status, unresolved_intervals, escalation_trace }`.
- **`PatternPieceTopology`**: `{ piece_id, garment_family, coordinate_convention: "CARTESIAN_RH_CCW", net_sew_contour: ClosedContour2D, cut_contour: ClosedContour2D, internal_darts: DartSpec[], grainline: VectorSegment2D, notches: NotchSpec[], seam_edges: Map<EdgeID, SeamPairingSpec>, offset_validation_records: OffsetValidationRecord[] }`.
- **`GradedPatternFamily`**: `{ base_size, supported_sizes: string[], pieces_by_size: Map<SizeCode, PatternPieceTopology[]>, cross_size_seam_report: SeamMatingMatrix }`.
- **`ValidatedMarkerArtifact` (`M02h`)**: `{ marker_id, graded_family_id, material_spec_id, usable_fabric_width_cm: float, nap_mode: "EITHER_0_180" | "ONE_WAY_0_ONLY", chordal_outward_buffer_cm: 0.02, min_kerf_clearance_cm: float, placements: PiecePlacement2D[], marker_length_verification: NumericalVerificationRecord, utilization_ratio: float, independent_overlap_audit_passed: bool, random_seed: int }`.

## 10. Mathematical, Algorithmic & Domain Specifications (By Sub-Workload)

### `M02a` — Authoritative Planar Geometry, Parameter-to-Output Propagation & Four-Layer `Method C1-Cert` (`Critical Corrections B & C`)
- **Zero Intermediate Rounding (`DEF-M00-06` Fix):** All point, intersection, subdivision (De Casteljau), and projection coordinates remain raw IEEE 754 `float64`.
- **Parameter Uncertainty Is Not Output Error (`Critical Correction B`, `ADR-009 §2.3`):**
  - Whenever an algorithm isolates a parameter root $t^* \in I = [\underline{t}, \overline{t}]$ (such as inverse arc-length parameter lookup for notch placement, curve projection, or intersection), the parameter half-width $r_{\mathrm{param}} = \frac{\overline{t} - \underline{t}}{2}$ bounds only $|t^* - t_{\mathrm{mid}}|$ and **never** substitutes for geometric output error.
  - Geometric output error is bounded via **`Method B1` (Validated Derivative Bound)**:
    $$\|X(t^*) - X(t_{\mathrm{mid}})\| \le M_X(I)\,r_{\mathrm{param}} + \delta_{\mathrm{eval}}, \qquad M_X(I) = \overline{\sup_{t \in I} \|X'(t)\|}$$
    or **`Method B2` (Direct Interval Image Enclosure)** $X(I) = [\underline{X}(I), \overline{X}(I)]$, so $B_{\mathrm{cert}}(X) = E_{\mathrm{obs}}(X) + B_{\mathrm{ref}}(X) \le \tau_{\mathrm{domain}}(X)$.
- **Certified Arc-Length Enclosure (`Method C1-Cert`, 4 Assurance Layers) vs. Quadrature Discrepancy Estimate (`Method C1-Est`) (`DEF-M00-01` Fix, `ADR-009 §3`):**
  - Strict finite-positive tolerance validation (`if not math.isfinite(tol) or tol <= 0: return CERTIFIED_INVALID`).
  - **`Method C1-Cert` (`CERTIFIED_ENCLOSURE`, 4-Layer Assurance):**
    - *Layer 1 (Mathematical theorem):* Non-strict convex-hull inequality $L_{\mathrm{chord}}(\mathbf{B}_k) \le L_{\mathrm{exact}}(\mathbf{B}_k) \le L_{\mathrm{control\ polygon}}(\mathbf{B}_k)$ (with equality on degenerate/collinear segments).
    - *Layer 2 (Algorithmic derivation):* Adaptive De Casteljau subdivision summing outward-rounded leaf bounds $\underline{L}_{\mathrm{chord}, k}$ and $\overline{L}_{\mathrm{poly}, k}$, giving $B_{\mathrm{cert}}(L) = \max(|L_{\mathrm{float64}} - \underline{L}_{\mathrm{chord}}|, |\overline{L}_{\mathrm{poly}} - L_{\mathrm{float64}}|)$.
    - *Layer 3 (Implementation assurance):* Relies on the `M00.4` 8-point `IntervalLibraryQualificationReport` (`ADR-009 §3.2`) qualifying `mpmath.iv` against `fractions.Fraction`.
    - *Layer 4 (Empirical verification):* Differential and property tests are recorded as empirical evidence, **never** mathematical proof, and unconditioned absolute mathematical-certification claims are prohibited.
  - **`Method C1-Est` (`CONSERVATIVE_ENGINEERING_ESTIMATE`):** The 8-pt vs. 16-pt Gauss–Legendre difference formula with $S_{\mathrm{safety}} = 16.0$ is recorded only as `heuristic_error_estimate` and is **never** claimed as a certified bound.
- **Certified Green's Theorem Area (`Method C2`):**
  - Centroid-shifted evaluation $\mathbf{p} \mapsto \mathbf{p} - \mathbf{c}$ of exact degree-5 algebraic polynomial cross-product terms with Neumaier/Kahan compensated summation and Higham forward inner-product error bound $B_{\mathrm{cert, area}} = \gamma_{64} \sum |A_{\mathrm{term}}| \le 10^{-6}\text{ cm}^2$ (verified against the exact rational `fractions.Fraction` oracle in `M00.4` where $B_{\mathrm{ref}} = 0$).

### `M02b` — 2D Pattern Topology & Assembly Validation
- Enforces simple closed piece contours with zero local or global self-intersections (`Method C3` `STRtree` + 2D Bézier fat-line clipping + interval Krawczyk root isolation with `Method B1/B2` coordinate output bounds).
- Enforces hard fail-closed behavior (`DEF-M00-01` closed): any curve projection or seam arc-length evaluation returning `CERTIFIED_INVALID` or `INCONCLUSIVE` blocks transition to `Validated` (never downgraded to `'warning'`).

### `M02c` — Anthropometric Body Profile, Derived Chains & Provenance Gate
- Preserves the `M05.1` measurement provenance gate blocking `standard-chart`, `ai-estimated`, `heuristic`, `default`, `synthetic-persona`, and `synthetic-fixture` origins from production approval (`REQ-MEAS-01`).
- Validates anatomical ratios and multivariate Mahalanobis plausibility scores across upper body, lower body, bifurcated trouser, dress, and knit profiles.

### `M02d` — Parametric Block Library (5 Canonical Garment Families)
- **Track 1 (Vertical Slice Wedge):**
  1. `skirt-block-v1`: Contoured 2-dart woven skirt (`skirt-front`, `skirt-back`, `waistband-or-facing`).
  2. `bodice-sleeve-v1`: Contoured bust/waist-dart woven bodice (`bodice-front`, `bodice-back`, `set-in-sleeve`) with controlled scye/cap ease calibrated by `M03`.
- **Track 2 (Post-Vertical-Slice Expansion):**
  3. `trouser-block-v1`, 4. `dress-foundation-v1`, 5. `knit-tshirt-v1`.

### `M02e` — Deterministic Style Transformation Operators
- Ports all 6 verified rotational dart manipulation styles from `dart-manipulation.ts` (preserving total angular intake $\le 10^{-6}\text{ deg}$, bust apex, leg parity $\le 0.10\text{ cm}$, and fold tangency $\le 0.5^\circ$) and adds `slash_and_spread`, `split_yoke`, `add_pleat`, and `hem_flare`.

### `M02f` — Authoritative Production Offset Engine, Corrected Derivative Sign, Six-Category Failure Taxonomy & Tri-State $[0, 1]$ Verification (`Critical Correction A`)
- **Explicit Planar Sign Conventions & Corrected Offset Derivative (`ADR-009 §4.1`):**
  - Normalizes contours to right-handed Cartesian CCW orientation (`coordinate_convention: "CARTESIAN_RH_CCW"`), base speed squared $Q(t) = x'(t)^2 + y'(t)^2$, left-hand normal $\hat{\mathbf{n}}_+(t) = (-y'(t), x'(t))/\sqrt{Q(t)}$ (for $Q(t) > 0$), signed curvature numerator $C(t) = x'(t)y''(t) - y'(t)x''(t)$, and signed curvature $\kappa(t) = C(t)/Q(t)^{3/2}$.
  - For $\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\hat{\mathbf{n}}_+(t)$ ($d > 0$, $s = -1$ outward for CCW contour, $s = +1$ inward), since $\hat{\mathbf{n}}_+'(t) = -\kappa(t)\,\mathbf{B}'(t)$, the exact offset derivative and regularity factor (for $Q(t) > 0$) are:
    $$\mathbf{O}'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t), \qquad f(t) = 1 - s\,d\,\kappa(t) = 1 - \frac{s\,d\,C(t)}{Q(t)^{3/2}}$$
  - *CCW Circle Sanity Check:* On $\mathbf{B}(t) = (R\cos t, R\sin t)$ ($\kappa = +1/R > 0$), inward offset ($s=+1$) gives $f(t) = 1 - d/R$ (radius $R-d$, singular at $d=R$, tangent reversal for $d>R$); outward offset ($s=-1$) gives $f(t) = 1 + d/R > 1$ (radius $R+d$, always smooth).
- **Separate Zero-Speed Base-Curve Check (`ADR-009 §4.2`):**
  - Before dividing by $Q(t)^{3/2}$ or evaluating $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2$, `M02f` checks $Q(t)$ on $t \in [0, 1]$. Any certified root $Q(t^*) = 0$ is immediately classified as `CERTIFIED_INVALID` (`ACTUAL_ZERO_SPEED_CUSP`) without dividing by $Q(t)^{3/2}$.
- **Concave / Evolute-Side Sign Gate (`s * d * C(t) > 0`):**
  - Because squaring $Q(t)^{3/2} = s\,d\,C(t)$ to $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2 = 0$ introduces extraneous roots where $s\,d\,C(t) < 0$ (convex offset side where $f(t) = 1 + |s\,d\,\kappa(t)| > 1$), `M02f` enforces $s\,d\,C(t) > 0$ on all three concave offset failure predicates:
    - **Evolute Cusp (`ACTUAL_ZERO_SPEED_CUSP`):** $Q(t^*) > 0 \;\wedge\; s\,d\,C(t^*) > 0 \;\wedge\; P_{\mathrm{exact}}(t^*) = 0$.
    - **Tangent Reversal (`TANGENT_REVERSAL`):** $Q(t) > 0 \;\wedge\; s\,d\,C(t) > Q(t)^{3/2}$ (i.e., $s\,d\,C(t) > 0 \;\wedge\; P_{\mathrm{exact}}(t) < 0$).
    - **Regularity-Margin Violation (`REGULARITY_MARGIN_VIOLATION`):** $Q(t) > 0 \;\wedge\; s\,d\,C(t) > 0 \;\wedge\; P_{\mathrm{exact}}(t) > 0 \;\wedge\; P_{\mathrm{margin}}(t) = (1 - \varepsilon_{\mathrm{margin}})^2 Q(t)^3 - d^2 C(t)^2 < 0$.
- **Two-Stage Verification Architecture (`Stage 1` Heuristic Screen vs. `Stage 2` Tri-State Complete-Interval Proof):**
  - **Stage 1 (Fast Heuristic Screen Only):** 65-point Gauss–Lobatto check for rapid early subdivision/trimming trigger; passing Stage 1 is **never** accepted as certification.
  - **Stage 2 (Complete-Interval $t \in [0, 1]$ Tri-State Verification):** Evaluates Bernstein-basis interval enclosures in `mpmath.iv`, runs local and global self-intersection isolation (`STRtree` + 2D interval Krawczyk), emits `CERTIFIED_VALID`, `CERTIFIED_INVALID`, or `INCONCLUSIVE`, and enforces $\ge 85\%$ primary cutting segment projection span (`DEF-M00-02` closed).

### `M02g` — Category-Strict Multi-Size Grading Engine (`DEF-M00-05` Fix)
- Dispatches strictly on `garment_category` (`skirt`, `bodice`, `trouser`, `dress`, `knit_top`), implementing a dedicated `SkirtGrader` (`XS`–`XXL` / `EU 34`–`46`) alongside `BodiceGrader` and `SleeveGrader` and prohibiting cross-category fallback (`DEF-M00-05` closed) or base-size geometry cloning (`GRADING_BASE_CLONING_PROHIBITED`).
- Verifies cross-size seam parity (`Method C1-Cert` bounds within `DEC-11` tolerance), notch proportionality ($\le 0.05\text{ cm}$), and strictly monotonic area/perimeter scaling across all graded sizes.

### `M02h` — Deterministic Marker Nesting, Validation & Utilization Engine
- **Authoritative Manufacturing Role:** `M02h` is an authoritative manufacturing computation for digital cut-layout validity, `M05` BOM fabric consumption, and pre-production costing.
- **Outward-Buffered Polygon Enclosure:** Every curved cutting contour is enclosed in an outward-buffered polygon ($\delta_{\mathrm{chord}} = 0.02\text{ cm}$ outward normal offset so $\mathcal{P}_{\mathrm{exact\_cut}} \subseteq \mathcal{P}_{\mathrm{buffered}}$) plus minimum cutter kerf clearance $c_{\mathrm{kerf}} \ge 0.10\text{ cm}$.
- **Seeded NFP Strip Packing & Independent Verification (`verify_marker_layout.py`):** Places all required piece instances within usable fabric width $W_{\mathrm{usable}} = W_{\mathrm{total}} - 2\,m_{\mathrm{selvedge}}$ (`M03`), honoring grainline tilt limits ($\le 0.1^\circ$) and nap direction (`EITHER_0_180` vs. `ONE_WAY_0_ONLY`), and independently proves zero overlap in exact rational arithmetic.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/pattern/draft` → Executes `M02d`/`M02e` from direct parameters or `M04b` `DraftPlan`.
- `POST /api/v1/pattern/validate-assembly` → Runs `M02b` + `M02f` tri-state complete-interval offset and seam verification.
- `POST /api/v1/pattern/grade` → Runs `M02g` category-strict multi-size grading.
- `POST /api/v1/pattern/nest-marker` → Runs `M02h` deterministic marker nesting and independent layout verification.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Every draft, grade, and marker execution runs inside an `M01` tenant-isolated context (with 3-point worker re-auth on async jobs) and records its deterministic seed, algorithm version, `NumericalVerificationRecord`, `OffsetValidationRecord`, and RFC 8785 SHA-256 digest in `GarmentRevisionNode`.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- 2D Interactive SVG CAD Canvas (rendering authoritative Python DTOs) with layer toggles for net sew lines, cut lines, seam allowances, grainlines, notches, multi-size grade nests (`M02g`), nested marker strip layouts (`M02h`), and tri-state offset diagnostic badges (`CERTIFIED_VALID`, `CERTIFIED_INVALID` Category 1–5, or `INCONCLUSIVE`).

## 14. Detailed Work Packages & Implementation Sequence
1. **`M02a`:** Production `float64` geometry primitives, `Method C1-Cert` 4-layer chord/polygon arc-length enclosures, `Method B1/B2` parameter-to-output propagation, `Method C2` Green's area bounds, and Bernstein/interval polynomial toolkit.
2. **`M02b`:** Half-edge planar topology builder, `Method C3` local/global self-intersection detector, and hard-fail seam/dart validator (`DEF-M00-01` closed).
3. **`M02c`:** Anthropometric profile validator, derived chains, and provenance gate.
4. **`M02d` Track 1:** `skirt-block-v1` and `bodice-sleeve-v1` parametric blocks.
5. **`M02e`:** 6-style rotational dart manipulation + slash-and-spread, yoke split, pleat, and flare operators.
6. **`M02f`:** Production offset curve generator ($\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$), separate $Q(t)=0$ check, $s\,d\,C(t)>0$ sign gate, 6-category failure classifier, tri-state complete-interval $t \in [0, 1]$ Bernstein/interval offset verifier (`DEF-M00-02` closed), corner mitering/beveling, and notch projection.
7. **`M02g`:** Category-strict multi-size grading engine (`SkirtGrader`, `BodiceGrader`, `SleeveGrader` — `DEF-M00-05` closed) and cross-size seam matrix verifier.
8. **`M02h`:** Outward-buffered NFP deterministic strip-packing marker engine and independent marker containment auditor.
9. **`M02d` Track 2:** `trouser-block-v1`, `dress-foundation-v1`, and `knit-tshirt-v1`.

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Validates all `M02a`–`M02h` production outputs against the independent `M00.4` Class B Normative fixtures and `Method C1-Cert/C2/C3` certified enclosures (`04_MIGRATION_AND_PARITY_POLICY.md §4`).

## 16. Unit, Property & Adversarial Test Plan (Including All 14 Mandatory Adversarial Families)
- `Hypothesis` property tests generating 1,000 random valid body profiles per garment block verifying closed contours, `CERTIFIED_VALID` offset and self-intersection status, seam mating parity, and monotonic size grading.
- Mandatory execution of all **14 Adversarial Geometry Test Families (`ADR-009 §4.4`)**:
  1. **Convex vs. Concave Offset (`|\kappa|` Identical, Opposite Sign):** Verify convex offset ($s\,d\,C(t) < 0$, $f(t) = 1 + |s\,d\,\kappa(t)| > 1$) is `CERTIFIED_VALID` even when $P_{\mathrm{exact}}(t) \le 0$, whereas concave offset ($s\,d\,C(t) > 0$) with $d \ge R$ fails closed.
  2. **Exact Evolute Cusp ($1 - s\,d\,\kappa(t^*) = 0$):** $Q(t^*) > 0$, $s\,d\,C(t^*) > 0$, $P_{\mathrm{exact}}(t^*) = 0$ → `CERTIFIED_INVALID` (`ACTUAL_ZERO_SPEED_CUSP`).
  3. **Over-Offset Tangent Reversal ($1 - s\,d\,\kappa(t) < 0$):** $Q(t) > 0$, $s\,d\,C(t) > Q(t)^{3/2}$ ($f(t_{\min}) = -0.15 < 0$) → `CERTIFIED_INVALID` (`TANGENT_REVERSAL`).
  4. **Near-Cusp Inside Regularity Margin ($0 < 1 - s\,d\,\kappa(t) < \varepsilon_{\mathrm{margin}}$):** $Q(t) > 0$, $s\,d\,C(t) > 0$, $f(t_{\min}) = 0.02 \in (0, 0.05)$ → `CERTIFIED_INVALID` (`REGULARITY_MARGIN_VIOLATION`, verified **not** misclassified as `ACTUAL_ZERO_SPEED_CUSP` or `TANGENT_REVERSAL`).
  5. **Base-Curve Stationary Point ($Q(t^*) = 0$):** Stationary cusps at $t^* = 0.25$ (`DEF-M00-02`) and $t^* = 1/3$ → caught by the separate $Q(t)=0$ check and classified as `CERTIFIED_INVALID` (`ACTUAL_ZERO_SPEED_CUSP`).
  6. **Inflection Point ($C(t^*) = 0$ Inside Segment):** S-curve where $s\,d\,C(t)$ changes sign across $t^*$ → convex sub-arc passes while concave sub-arc is evaluated with $s\,d\,C(t) > 0$.
  7. **High-Curvature Tight Armhole / Crotch Curve:** High peak curvature tested across $d \in \{0.6, 1.0, 1.5\}\text{ cm}$.
  8. **Nearly Flat Cubic Segment:** Verifies non-strict inequality $L_{\mathrm{chord}} \le L_{\mathrm{exact}} \le L_{\mathrm{control\ polygon}}$ (including exact equality on collinear segments).
  9. **Steep Parameterization / Large Derivative (`Method B1/B2`):** Verifies that a tiny parameter bracket $r_{\mathrm{param}} = 10^{-4}$ with $\|X'(t)\| = 500\text{ cm}$ yields $B_{\mathrm{ref}}(X) \ge 0.05\text{ cm}$ and is never accepted on $r_{\mathrm{param}}$ alone.
  10. **Local Self-Intersection Without Cusp:** Untrimmed concave offset loop crossing → `CERTIFIED_INVALID` (`LOCAL_OFFSET_SELF_INTERSECTION`).
  11. **Global Self-Intersection Between Non-Adjacent Segments:** Narrow keyhole/neck contour where opposite smooth seam allowances collide ($1 - s\,d\,\kappa(t) > 0.5$ locally) → `CERTIFIED_INVALID` (`GLOBAL_CONTOUR_SELF_INTERSECTION`).
  12. **Short-Span `2%` Segment on Curved Contour (`DEF-M00-02`):** Primary segment span $< 85\%$ rejected (`PRIMARY_OFFSET_SPAN_INSUFFICIENT`).
  13. **Extraneous Size Keys & Conflicting Quantity Basis (`DEF-M00-03`):** Rejected in `M05.1`.
  14. **Missing `expectedTenantId` with Blank Artifact `tenantId` (`DEF-M00-04`):** Rejected in `M01.2` / `M05.1`.
  - Plus artificial subdivision depth cap ($d_{\max}=2$) on a threshold-straddling curve → `INCONCLUSIVE` (`INCONCLUSIVE_VERIFICATION`, never misclassified as `Categories 1–5`).

## 17. Independent Verification Oracles (`M00.4` Separation Boundary)
- Audited by `services/fashion-engine/tests/oracles/oracle_geometry_mpmath.py` and `verify_marker_layout.py` under the 5-dimensional oracle independence model (`ADR-009 §6`) and 7-point separation rules (`04_MIGRATION_AND_PARITY_POLICY.md §2.3`).

## 18. Physical, Manufacturing or Financial Validation Protocol
- Plot physical 1:1 base and graded patterns and reference marker strips for `skirt-block-v1` and `bodice-sleeve-v1`; physically walk sewn seams on cutting table and verify notch alignment within $\pm 0.5\text{ mm}$.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-03`** (5-concept numerical assurance, parameter-to-output propagation `Method B1/B2`, 4-layer `Method C1-Cert/C2/C3` certified bounds & `CERTIFIED_VALID` complete-interval $[0, 1]$ offset proof with $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$), **`AC-04`** (100% Python execution & 5-dimensional oracle independence), **`AC-05`** (construction & `M02h` marker validity), **`AC-06`** (multi-size grading fidelity). Required for **Release Level A**.

## 20. Failure Modes, Rollback & Recovery Procedures
- Fails closed on both `CERTIFIED_INVALID` and `INCONCLUSIVE` outcomes while preserving their distinct classifications in `OffsetValidationRecord` and triggering the 4-step escalation ladder (`ADR-009 §5.2`) for `INCONCLUSIVE` cases.

## 21. Observability, Audit Logging & Telemetry
- Logs complete `NumericalVerificationRecord` and `OffsetValidationRecord` payloads in structured revision metadata.

## 22. Explicit Non-Goals & Scope Guardrails
- `M02` does not perform 3D cloth drape simulation (`M06`) or multimodal image perception (`M04a`).

## 23. Downstream Unlocks
- Unlocks **`M04b`** (controlled recipe compilation target), **`M05`** (piece production sheets, `M02h`-linked BOM & tech packs), and **`M06`** (3D simulation & bounded pattern optimization).

## 24. Definition of Done Checklist
- [ ] `Gate Auth-2` approvals (`ADR-009` (`R2.1.2`), `DEC-13 Stage 2`, `DEC-11`, `DEC-06`) recorded before implementation.
- [ ] `M02a`–`M02h` production modules implemented in Python `services/fashion-engine/app/pattern_engine/` with strict `mypy` typing and zero shared imports from `tests/oracles/`.
- [ ] Zero `.toFixed()` intermediate coordinate or arc-length truncation (`DEF-M00-01`, `DEF-M00-06` closed) and mandatory `Method B1/B2` parameter-to-output propagation on all root-isolated quantities.
- [ ] Corrected offset derivative $\mathbf{O}'(t) = (1 - s\,d\,\kappa(t))\mathbf{B}'(t)$, separate $Q(t)=0$ check, $s\,d\,C(t)>0$ sign gate, 6-category offset failure taxonomy, and tri-state complete-interval $t \in [0, 1]$ verification active in `M02f` (`DEF-M00-02` closed) and verified across all 14 adversarial test families.
- [ ] Category-strict grading (`M02g`, `DEF-M00-05` closed) and authoritative NFP marker nesting (`M02h`) verified.
- [ ] All Class B Normative 5-concept numerical enclosure checks pass (`AC-03`, `AC-05`, `AC-06`).
