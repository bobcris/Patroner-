# WORKLOAD M02 — DETERMINISTIC FASHION ENGINE (`M02a`–`M02h`) (`R2.1`)

## 1. Workload ID & Title
- **Workload ID:** `M02` (Decomposed into Sub-Workloads `M02a`, `M02b`, `M02c`, `M02d`, `M02e`, `M02f`, `M02g`, `M02h`)
- **Title:** Deterministic Computational Geometry, Certified Numerical Enclosures, Complete-Interval Offset Verification, Parametric Block Library, Style Operators, Multi-Size Grading & Authoritative Marker Nesting
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase B & Phase C (Deterministic Fashion Engine)`

## 2. Purpose & Architectural Role
`M02` is the mathematical heart of Patroner inside `services/fashion-engine`. It ports and substantially expands the prototype TypeScript geometry/drafting/grading modules into an exact IEEE 754 `float64` Python computational geometry and garment engineering engine (`Dossier 03`, `Dossier 08`, `Dossier 13`), permanently closing `DEF-M00-01`, `DEF-M00-02`, `DEF-M00-05`, and `DEF-M00-06`. In `R2.1`, `M02` incorporates **Four-Tier Certified Numerical Bounds (`Correction 04`, `ADR-009`)**, **Complete-Interval ($t \in [0, 1]$) Bernstein/Interval Offset Verification (`Correction 05`, `ADR-009`)**, clean integration with **`M04b` Controlled Recipe Compilation (`Correction 01`)**, and **Authoritative Deterministic Marker Nesting & Validation (`M02h`, `Correction 02`)**.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 05`, `Ch. 09`, `Ch. 15 (Phase B/C)`, `App. A2–A6`
- `Dossier 03 v5.1` (Deterministic Pattern Geometry), `Dossier 08 v5.6` (Garment Recipes & Controlled Draft Compilation), `Dossier 13 v5.11` (Pattern Grading, Multi-Size & Fit Optimization)
- `ADR-003` & `ADR-009` (`PROPOSED` Numerical Certification & Offset Verification)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-GEO-01`** (Full `float64` precision, zero intermediate rounding, 4-tier numerical assurance with certified `Method C1/C2/C3` bounds)
- **`REQ-GEO-02`** (Complete-interval $t \in [0, 1]$ offset regularity, interior cusp absence, tangent-reversal absence & $\ge 85\%$ primary span coverage)
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

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Closes **`DEF-M00-01`**, **`DEF-M00-02`**, **`DEF-M00-05`**, and **`DEF-M00-06`** across `M02a`, `M02b`, `M02f`, and `M02g`.

## 7. Prerequisites & Upstream Dependencies
- `M02a` requires `M00.4` & `M00.10`.
- `M02b` and `M02c` require `M01.3` (World Model revision persistence).
- `M02d` requires `M02b`, `M02c`, and `M03` (material ease policies).
- `M02e` requires `M02d`.
- `M02f` requires `M02a`, `M02b`, `M02d`, `M02e`, and `M04b` (when executing compiled `DraftPlan` recipes).
- `M02g` requires `M02f`.
- `M02h` requires `M02g` (Validated Multi-Size Grading) and `M03` (Material & Fabric-Width/Nap/Shrinkage Constraints).

## 8. Target Architecture & Module Ownership (`services/fashion-engine/app/pattern_engine/`)
```text
services/fashion-engine/app/pattern_engine/
├── m02a_geometry/       # float64 primitives, Method C1/C2 certified bounds, Bernstein/interval polynomial kernel
├── m02b_topology/       # Half-edge planar graph, piece loop winding, dart & seam mating verifier
├── m02c_measurements/   # Anthropometric schema, provenance state machine, anatomical & Mahalanobis validator
├── m02d_blocks/         # Parametric blocks: skirt_v1, bodice_sleeve_v1, trouser_v1, dress_v1, knit_v1
├── m02e_operators/      # Deterministic AST operators: rotate_dart (6 styles), slash_spread, split_yoke, pleat, flare
├── m02f_seam_notch/     # Complete-interval [0,1] Bernstein/interval offset verifier, miter/bevel trim & notch projection
├── m02g_grading/        # Category-strict multi-size grading (XS-XXL / EU 34-46), anti-cloning & seam matrix verifier
└── m02h_nesting/        # Outward-buffered NFP deterministic strip-packing marker solver & independent layout verifier
```

## 9. Domain Entities, State Machines & Data Contracts
- **`CertifiedScalarResult`**: `{ value_fp64: float, certified_error_bound: float, certification_method: "METHOD_C1_CHORD_POLYGON" | "METHOD_C2_HIGHAM_INNER_PRODUCT" | "METHOD_C3_BERNSTEIN_INTERVAL", domain_tolerance: float, tolerance_achieved: bool }`.
- **`PatternPieceTopology`**: `{ piece_id, garment_family, winding: "CW_SCREEN_OR_CCW_CARTESIAN_EXPLICIT", net_sew_contour: ClosedContour2D, cut_contour: ClosedContour2D, internal_darts: DartSpec[], grainline: VectorSegment2D, notches: NotchSpec[], seam_edges: Map<EdgeID, SeamPairingSpec> }`.
- **`GradedPatternFamily`**: `{ base_size, supported_sizes: string[], pieces_by_size: Map<SizeCode, PatternPieceTopology[]>, cross_size_seam_report: SeamMatingMatrix }`.
- **`ValidatedMarkerArtifact` (`M02h`)**: `{ marker_id, graded_family_id, material_spec_id, usable_fabric_width_cm: float, nap_mode: "EITHER_0_180" | "ONE_WAY_0_ONLY", chordal_outward_buffer_cm: 0.02, min_kerf_clearance_cm: float, placements: PiecePlacement2D[], marker_length_cm: CertifiedScalarResult, utilization_ratio: float, independent_overlap_audit_passed: bool, random_seed: int }`.

## 10. Mathematical, Algorithmic & Domain Specifications (By Sub-Workload)

### `M02a` — Planar Geometry & Four-Tier Certified Numerical Bounds (`Correction 04`)
- **Zero Intermediate Rounding (`DEF-M00-06` Fix):** All point, intersection, subdivision (De Casteljau), and projection coordinates remain raw IEEE 754 `float64`.
- **Certified Arc-Length Enclosure (`Method C1`, `DEF-M00-01` Fix):**
  - Adaptive De Casteljau subdivision in `float64` with strict finite-positive tolerance validation (`if not math.isfinite(tol) or tol <= 0: raise ValueError`).
  - On each leaf sub-segment $\mathbf{B}_i$, computes chord length $L_{\text{chord}, i} = \|\mathbf{P}_{i,3} - \mathbf{P}_{i,0}\|$ and control-polygon length $L_{\text{poly}, i} = \sum_{j=0}^{2} \|\mathbf{P}_{i,j+1} - \mathbf{P}_{i,j}\|$. By the convex-hull property of Bernstein polynomials, $L_{\text{chord}, i} \le L_{\text{exact}}(\mathbf{B}_i) \le L_{\text{poly}, i}$ holds unconditionally.
  - Emits unrounded `value_fp64` (5-pt Gauss–Legendre on leaf segments clamped inside $[L_{\text{chord}, i}, L_{\text{poly}, i}]$) and **certified bound** $B_{\text{cert}} = \sum_i (L_{\text{poly}, i} - L_{\text{chord}, i}) + \delta_{\text{fp64}} \le 10^{-4}\text{ cm}$.
- **Certified Green's Theorem Area (`Method C2`):**
  - Centroid-shifted evaluation $\mathbf{p} \mapsto \mathbf{p} - \mathbf{c}$ of exact degree-5 algebraic polynomial cross-product terms with Kahan-Babuška compensated summation and Higham forward inner-product error bound $B_{\text{cert, area}} = \gamma_{24} \sum |A_{\text{term}}| \le 10^{-6}\text{ cm}^2$.

### `M02b` — 2D Pattern Topology & Assembly Validation
- Enforces simple closed piece contours with zero self-intersections (`Method C3` 2D Bézier fat-line clipping + interval Krawczyk enclosure).
- Enforces hard failure (`status = "INVALID"`, never downgraded to `'warning'`) if any curve projection returns `tolerance_achieved == False` (`DEF-M00-01` closed) or if mated seams violate the governed two-tier seam tolerance (`DEC-11`: `0.05 cm` digital CAD net sew-line geometry / `0.20 cm` physical assembly).

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

### `M02f` — Certified Seam Allowance, Complete-Interval Offset Verification & Notch Engine (`Correction 05`)
- Separates **Stage 1 Fast Screening Heuristic** (65-point Gauss–Lobatto grid check) from **Stage 2 Proof-Quality Complete-Interval ($t \in [0, 1]$) Verification (`Method C3`, `ADR-009`)**:
  1. **Base Stitch-Curve Regularity Proof on $[0, 1]$:** Converts $V(t) = x'(t)^2 + y'(t)^2$ (degree 4) into the Bernstein basis on $[0, 1]$ with outward-rounded interval coefficients (`mpmath.iv`). Proves $V(t) \ge v_{\min}^2 = 10^{-8}\text{ cm}^2$ for all $t \in [0, 1]$ via Bernstein convex-hull positivity / certified interval subdivision (permanently catching interior stationary cusps at $t=0.25$ or any arbitrary $t^* \in (0, 1)$ in `DEF-M00-02`).
  2. **Complete-Interval Offset Cusp Absence Proof on $[0, 1]$:** Converts $N(t) = x'(t)y''(t) - y'(t)x''(t)$ (degree 2) and the rational-free degree-6 polynomial $Q_{\text{cusp}}(t) = V(t)^3 - d^2 N(t)^2$ into the Bernstein basis on $[0, 1]$. Whenever outward offset sign $s \cdot d \cdot N(t) < 0$ is possible on an interval, proves $Q_{\text{cusp}}(t) > 0$ across the entire interval $t \in [0, 1]$ via certified Bernstein subdivision.
  3. **Complete-Interval Tangent Reversal Absence Proof on $[0, 1]$:** Converts the synchronized inner product $D(u) = \tilde{\mathbf{O}}'(u) \cdot \mathbf{B}'(t(u))$ (degree 4) into the Bernstein basis on $[0, 1]$ and proves $D(u) > 0$ for all $u \in [0, 1]$.
  4. **Certified Radial Offset Distance & Tangential Span Coverage:** Encloses radial deviation $\big|\|\tilde{\mathbf{O}}(u) - \mathbf{B}(t(u))\| - d\big| \le 0.01\text{ cm}$ via interval arithmetic and enforces primary cutting segment span $[s_0, s_1]$ covering $\ge 85\%$ of base stitch arc length (blocking `2%` short-span line substitutions in `DEF-M00-02`).
  5. **Envelope Trimming:** Where genuine gouging ($Q_{\text{cusp}}(t) \le 0$) or concave corner overlap occurs, isolates exact roots via Bernstein subdivision, computes the exact offset-envelope intersection via 2D fat-line clipping + interval Newton refinement, and trims the self-intersecting loop.

### `M02g` — Category-Strict Multi-Size Grading Engine (`DEF-M00-05` Fix)
- Dispatches strictly on `garment_category` (`skirt`, `bodice`, `trouser`, `dress`, `knit_top`), implementing a dedicated `SkirtGrader` (`XS`–`XXL` / `EU 34`–`46`) alongside `BodiceGrader` and `SleeveGrader` and prohibiting cross-category fallback (`DEF-M00-05` closed) or base-size geometry cloning (`GRADING_BASE_CLONING_PROHIBITED`).
- Verifies cross-size seam parity, notch proportionality ($\le 0.05\text{ cm}$), and strictly monotonic area/perimeter scaling across all graded sizes.

### `M02h` — Deterministic Marker Nesting, Validation & Utilization Engine (`Correction 02`)
- **Authoritative Manufacturing Role:** `M02h` is an authoritative manufacturing computation for digital cut-layout validity, `M05` BOM fabric consumption, and pre-production costing (distinct from physical cutter calibration in `AC-10` and physical roll inspection in `M07.3`).
- **Outward-Buffered Polygon Enclosure:** Every curved cutting contour is enclosed in an outward-buffered polygon ($\delta_{\text{chord}} = 0.02\text{ cm}$ outward normal offset so $\mathcal{P}_{\text{exact\_cut}} \subseteq \mathcal{P}_{\text{buffered}}$) plus minimum cutter kerf clearance $c_{\text{kerf}} \ge 0.10\text{ cm}$.
- **Seeded NFP Strip Packing:** Places all required piece instances for the order's validated size-quantity vector within usable fabric width $W_{\text{usable}} = W_{\text{total}} - 2\,m_{\text{selvedge}}$ (`M03`), honoring grainline tilt limits ($\le 0.1^\circ$) and nap direction (`EITHER_0_180` vs. `ONE_WAY_0_ONLY`).
- **Independent Marker Verification (`verify_marker_layout.py`):** Independently proves zero pairwise buffered-polygon overlap, zero strip-boundary protrusion, exact grainline adherence, and certified utilization $\eta = \frac{\sum A_{\text{cut}}}{W_{\text{usable}} \cdot L_{\text{marker}}}$.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/pattern/draft` → Executes `M02d`/`M02e` from direct parameters or `M04b` `DraftPlan`.
- `POST /api/v1/pattern/validate-assembly` → Runs `M02b` + `M02f` complete-interval offset and seam verification.
- `POST /api/v1/pattern/grade` → Runs `M02g` category-strict multi-size grading.
- `POST /api/v1/pattern/nest-marker` → Runs `M02h` deterministic marker nesting and independent layout verification.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Every draft, grade, and marker execution runs inside an `M01` tenant-isolated context (with 3-point worker re-auth on async jobs) and records its deterministic seed, algorithm version, certified error bounds, and RFC 8785 SHA-256 digest in `GarmentRevisionNode`.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- 2D Interactive SVG CAD Canvas (rendering authoritative Python DTOs) with layer toggles for net sew lines, cut lines, seam allowances, grainlines, notches, multi-size grade nests (`M02g`), and nested marker strip layouts (`M02h`).

## 14. Detailed Work Packages & Implementation Sequence
1. **`M02a`:** `float64` geometry primitives, `Method C1` chord/polygon arc-length bounds, `Method C2` Green's area bounds, and Bernstein/interval polynomial toolkit.
2. **`M02b`:** Half-edge planar topology builder, `Method C3` self-intersection detector, and hard-fail seam/dart validator (`DEF-M00-01` closed).
3. **`M02c`:** Anthropometric profile validator, derived chains, and provenance gate.
4. **`M02d` Track 1:** `skirt-block-v1` and `bodice-sleeve-v1` parametric blocks.
5. **`M02e`:** 6-style rotational dart manipulation + slash-and-spread, yoke split, pleat, and flare operators.
6. **`M02f`:** Complete-interval $t \in [0, 1]$ Bernstein/interval offset verifier (`DEF-M00-02` closed), corner mitering, and notch projection.
7. **`M02g`:** Category-strict multi-size grading engine (`SkirtGrader`, `BodiceGrader`, `SleeveGrader` — `DEF-M00-05` closed) and cross-size seam matrix verifier.
8. **`M02h`:** Outward-buffered NFP deterministic strip-packing marker engine and independent marker containment auditor (`Correction 02`).
9. **`M02d` Track 2:** `trouser-block-v1`, `dress-foundation-v1`, and `knit-tshirt-v1`.

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Validates all `M02a`–`M02h` outputs against `M00.4` Class B Normative fixtures and `Method C1/C2/C3` certified error bounds (`04_MIGRATION_AND_PARITY_POLICY.md` §4).

## 16. Unit, Property & Adversarial Test Plan
- `Hypothesis` property tests generating 1,000 random valid body profiles per garment block verifying closed contours, zero self-intersections, seam mating parity, and monotonic size grading.
- Adversarial interior-cusp cubic Béziers at $t=0.25$ and at non-grid irrational parameters $t = 1/\pi$, evolute crossings $R = d - 10^{-5}\text{ cm}$, and $2\%$ short-span line substitutions (`DEF-M00-02`).
- Adversarial marker overlap & nap-direction violation tests (`M02h`).

## 17. Independent Verification Oracles
- `oracle_geometry_mpmath.py` (`mp.dps = 80` reference + `mpmath.iv` / Bernstein interval verifier) + `verify_marker_layout.py` (independent exact polygon intersection & strip containment verifier).

## 18. Physical, Manufacturing or Financial Validation Protocol
- Plot physical 1:1 base and graded patterns and reference marker strips for `skirt-block-v1` and `bodice-sleeve-v1`; physically walk sewn seams on cutting table and verify notch alignment within $\pm 0.5\text{ mm}$.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-03`** (`Method C1/C2/C3` certified bounds & complete-interval $[0, 1]$ offset proof), **`AC-04`** (100% Python execution), **`AC-05`** (construction & `M02h` marker validity), **`AC-06`** (multi-size grading fidelity). Required for **Release Level A**.

## 20. Failure Modes, Rollback & Recovery Procedures
- Fails closed with structured geometric diagnostic coordinates (`piece_id`, `edge_id`, `t_interval`, `violation_code`) whenever any certified bound exceeds tolerance or any offset interval contains an untrimmable cusp.

## 21. Observability, Audit Logging & Telemetry
- Logs per-piece `certified_error_bound`, Bernstein subdivision depth, seam mating deltas, and `M02h` marker utilization percentages in structured revision metadata.

## 22. Explicit Non-Goals & Scope Guardrails
- `M02` does not perform 3D cloth drape simulation (`M06`) or multimodal image perception (`M04a`).

## 23. Downstream Unlocks
- Unlocks **`M04b`** (controlled recipe compilation target), **`M05`** (piece production sheets, `M02h`-linked BOM & tech packs), and **`M06`** (3D simulation & bounded pattern optimization).

## 24. Definition of Done Checklist
- [ ] `M02a`–`M02h` modules implemented in Python `services/fashion-engine` with strict `mypy` typing.
- [ ] Zero `.toFixed()` intermediate coordinate or arc-length truncation (`DEF-M00-01`, `DEF-M00-06` closed).
- [ ] Complete-interval $t \in [0, 1]$ Bernstein/interval offset cusp & reversal verification active (`DEF-M00-02` closed, `Correction 05`).
- [ ] Category-strict grading (`M02g`, `DEF-M00-05` closed) and authoritative NFP marker nesting (`M02h`, `Correction 02`) verified.
- [ ] All Class B Normative `mpmath` + `Method C1/C2/C3` certified bound checks pass (`AC-03`, `AC-05`, `AC-06`).
