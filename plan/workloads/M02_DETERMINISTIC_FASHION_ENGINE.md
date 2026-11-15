# WORKLOAD M02 — DETERMINISTIC FASHION ENGINE (`M02a`–`M02h`)

## 1. Workload ID & Title
- **Workload ID:** `M02` (Decomposed into Sub-Workloads `M02a`, `M02b`, `M02c`, `M02d`, `M02e`, `M02f`, `M02g`, `M02h`)
- **Title:** Deterministic Computational Geometry, Parametric Block Library, Style Operators, Seam/Notch Engineering, Multi-Size Grading & Marker Nesting
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase B (Deterministic Fashion Engine)`

## 2. Purpose & Architectural Role
`M02` is the mathematical heart of Patroner inside `services/fashion-engine`. It ports and substantially expands the prototype TypeScript geometry/drafting/grading modules into an exact IEEE 754 `float64` Python computational geometry and garment engineering engine (`Dossier 03`, `Dossier 08`, `Dossier 13`), permanently eliminating `DEF-M00-01`, `DEF-M00-02`, `DEF-M00-05`, and `DEF-M00-06`.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 05`, `Ch. 09`, `Ch. 15 (Phase B)`
- `Dossier 03 v5.1` (Deterministic Pattern Geometry), `Dossier 08 v5.6` (Garment Recipes & Controlled Draft Compilation), `Dossier 13 v5.11` (Pattern Grading, Multi-Size & Fit Optimization)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-GEO-01`** (`float64` precision, zero intermediate rounding, exact arc-length & Green's area bounds)
- **`REQ-GEO-02`** (Continuous offset envelope & interior cusp/self-intersection rejection)
- **`REQ-MEAS-01`** (Anthropometric body profile, derived chains & plausibility validator)
- **`REQ-DRFT-01`** (Parametric foundation blocks & deterministic style transformation operators)
- **`REQ-ASSM-01`** (Topological assembly, seam mating $\Delta L \le 0.05\text{ cm}$, corner mitering & notches)
- **`REQ-GRAD-01`** (Category-aware multi-size grading & cross-size seam preservation)

## 5. Current Repository Baseline & Classification
- **`M02a` Planar Geometry (`src/engine/geometry/*`)**: `I2` / `R` — Has Gauss–Legendre quadrature and Green's theorem, but suffers from `.toFixed(2)` / `.toFixed(3)` truncation (`DEF-M00-01`, `DEF-M00-06`).
- **`M02b` Pattern Topology (`src/engine/assembly/*`)**: `I2` / `R` — Validates basic seams/darts but downgrades projection tolerance failure to `'warning'` (`DEF-M00-01`).
- **`M02c` Body Profile (`src/engine/measurements/*`)**: `I2` — Validates basic bodice/skirt measurements; lacks full trouser/dress/knit derived chains and Mahalanobis plausibility scoring.
- **`M02d` Parametric Blocks (`src/engine/drafting/*`)**: `I2` — Implements 1 bodice block and 1 skirt block (`2-dart`); missing sleeve, trouser, dress, and knit blocks.
- **`M02e` Style Operators**: `M` (Missing) — No dart rotation, slash-and-spread, yoke split, flare, or pleat operators exist.
- **`M02f` Seam Allowance, Miter & Notch (`src/engine/production/piece-production-sheet.ts`)**: `I2` / `R` — Computes offsets/miters for bodice/skirt but misses interior cusps at $t=0.25$ (`DEF-M00-02`).
- **`M02g` Multi-Size Grading (`src/engine/grading/pattern-grader.ts`)**: `P` / `X` — Hardcodes `draftBodice` even for skirts (`DEF-M00-05`).
- **`M02h` Nesting & Marker Utilization**: `M` (Missing).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Closes **`DEF-M00-01`**, **`DEF-M00-02`**, **`DEF-M00-05`**, and **`DEF-M00-06`** across `M02a`, `M02b`, `M02f`, and `M02g`.

## 7. Prerequisites & Upstream Dependencies
- `M02a` requires `M00.4` & `M00.10`.
- `M02b`–`M02h` require `M01.3` (World Model revision persistence) and `M03` (material ease policies for `M02d`).

## 8. Target Architecture & Module Ownership (`services/fashion-engine/app/pattern_engine/`)
```text
services/fashion-engine/app/pattern_engine/
├── m02a_geometry/       # float64 primitives, adaptive Gauss-Legendre, Green's area, offset & cusp solver
├── m02b_topology/       # Half-edge planar graph, piece loop orientation, dart & seam mating verifier
├── m02c_measurements/   # Anthropometric schema, anatomical ratio & Mahalanobis plausibility validator
├── m02d_blocks/         # Parametric blocks: skirt_v1, bodice_sleeve_v1, trouser_v1, dress_v1, knit_v1
├── m02e_operators/      # Deterministic AST operators: rotate_dart, slash_spread, split_yoke, add_pleat, flare
├── m02f_seam_notch/     # Exact offset curves, miter/square/envelope corners, notch & drill projection
├── m02g_grading/        # Category-aware multi-size rule engine & cross-size seam-mating verifier
└── m02h_nesting/        # Deterministic NFP strip-packing marker engine & fabric utilization calculator
```

## 9. Domain Entities, State Machines & Data Contracts
- **`PlanarCurveSegment`**: `LineSegment2D | CubicBezierSegment2D` (strict IEEE 754 `float64` coordinates in centimeters; zero display rounding).
- **`PatternPieceTopology`**: `{ piece_id, garment_family, orientation: "CCW", net_sew_contour: ClosedContour2D, cut_contour: ClosedContour2D, internal_darts: DartSpec[], grainline: VectorSegment2D, notches: NotchSpec[], seam_edges: Map<EdgeID, SeamPairingSpec> }`.
- **`RecipeOperatorAST`**: Ordered sequence of typed, invertible or provenance-tracked geometric transformations applied to a foundation block.
- **`GradedPatternFamily`**: `{ base_size, supported_sizes: string[], pieces_by_size: Map<SizeCode, PatternPieceTopology[]>, cross_size_seam_report: SeamMatingMatrix }`.

## 10. Mathematical, Algorithmic & Domain Specifications (By Sub-Workload)

### `M02a` — Planar Geometry, Exact Arc-Length & Green's Area Kernel
- **Zero Intermediate Rounding (`DEF-M00-06` Fix):** All point, intersection, subdivision (de Casteljau), and projection coordinates remain raw IEEE 754 `float64`. Formatting to `.toFixed(k)` is restricted to view-layer SVG/PDF strings.
- **Adaptive Arc-Length & Inverse Projection (`DEF-M00-01` Fix):**
  - Adaptive 5-point Gauss–Legendre subdivision with strict finite-positive tolerance validation (`if not math.isfinite(tol) or tol <= 0: raise ValueError`).
  - Returns unrounded `arc_length_cm: float` and guaranteed upper bound `arc_length_error_bound_cm = quadrature_residual + 4 * EPSILON * arc_length_cm` satisfying $|L_{\text{returned}} - L_{\text{true}}| \le \text{bound} \le 10^{-5}\text{ cm}$.
- **Exact Green's Theorem Area:**
  - Centroid-shifted evaluation $\mathbf{p} \mapsto \mathbf{p} - \mathbf{c}$ (preventing large-coordinate cancellation) of exact degree-5 polynomial cross-product integrals with rigorous IEEE 754 rounding error accumulation bound.

### `M02b` — 2D Pattern Topology & Assembly Validation
- Enforces simple closed counter-clockwise (`signed_area > 0`) piece contours with zero self-intersections (Bentley–Ottmann + Bézier fat-line clipping).
- Enforces hard failure (`status = "INVALID"`, never downgraded to `'warning'`) if any curve projection returns `tolerance_achieved == False` or if mated seams without intentional ease diverge by $|\Delta L| > 0.05\text{ cm}$ (`0.5 mm`).

### `M02c` — Anthropometric Body Profile & Derived Chains
- Supports full measurement profiles for upper body, lower body, bifurcated crotch/inseam/rise, and knit torso.
- Validates anatomical invariants (e.g., $\text{hip} > \text{waist}$ for standard blocks, $\text{inseam} < \text{outseam}$, $\text{front\_waist\_to\_hip} < \text{skirt\_length}$) plus multivariate Mahalanobis distance flagging against ANSUR-II / ISO 8559-1 anthropometric distributions.

### `M02d` — Parametric Block Library (5 Canonical Garment Families)
- **Track 1 (Vertical Slice Wedge):**
  1. `skirt-block-v1`: Contoured 2-dart woven skirt (`skirt-front`, `skirt-back`, `waistband-or-facing`).
  2. `bodice-sleeve-v1`: Contoured bust/waist-dart woven bodice (`bodice-front`, `bodice-back`, `set-in-sleeve`) with controlled sleeve-cap ease ratio $e_{\text{cap}} \in [4\%, 9\%]$ calibrated by `M03` fabric shear/bending stiffness.
- **Track 2 (Post-Vertical-Slice Expansion):**
  3. `trouser-block-v1`: Bifurcated woven trouser (`trouser-front`, `trouser-back`, contoured front/back crotch hook, crease grainline).
  4. `dress-foundation-v1`: Torso-continuous waistless/seamed dress block combining bodice + skirt kinematics.
  5. `knit-tshirt-v1`: Negative/zero-ease jersey torso + sleeve block governed by `M03` biaxial stretch recovery bounds.

### `M02e` — Deterministic Style Transformation Operators
- Implements pure geometric operators on `PatternPieceTopology`:
  - `pivot_dart(piece, source_dart_id, target_seam_point, angle_rad)` (preserving exact swept sector angle and sew-edge arc lengths),
  - `slash_and_spread(piece, slash_line, spread_angle_or_cm, hinge_point)` (with smooth $G^1$ cubic Bézier blending at hem/waist),
  - `split_yoke(piece, split_curve, seam_allowance_policy)`,
  - `add_knife_or_box_pleat(piece, pleat_axis, depth_cm, underlay_policy)`.

### `M02f` — Seam Allowance, Corner Mitering & Notch Engine (`DEF-M00-02` Fix)
- Generates offset curves at distance $d$ along outward unit normal $\hat{\mathbf{n}}(t)$.
- **Mandatory Interior Cusp & Reversal Check (`DEF-M00-02` Fix):** Every mapped offset sub-segment is verified across a **65-point Gauss–Lobatto grid (`u = 0..1`) plus analytical curvature extrema** $\kappa_{\max}$. If $1 + s \cdot d \cdot \kappa(t) \le \varepsilon_{\text{cusp}}$ or $\hat{\mathbf{t}}_{\text{offset}}(t) \cdot \hat{\mathbf{t}}_{\text{base}}(t) \le 0$ at any interior point $t \in (0, 1)$, the raw cubic approximation is rejected and subdivided/trimmed at the exact offset envelope intersection.
- Prohibits degenerate straight line-to-line segments replacing curved primary cutting contours unless curvature $|\kappa(t)| < 10^{-6}\text{ cm}^{-1}$ everywhere on the span.

### `M02g` — Multi-Size Grading Engine (`DEF-M00-05` Fix)
- Dispatches strictly on `base_spec.garment_category` (`skirt`, `bodice`, `trouser`, `dress`, `knit_top`) — permanently closing `DEF-M00-05`.
- Supports both **Parametric Re-Draft Grading** (re-evaluating the block + style AST at graded anthropometric profiles) and **Cardinal Growth-Vector Grading** ($\Delta x, \Delta y$ cardinal grade rules).
- Verifies cross-size invariants across every target size $S_k$:
  - Mated seam length delta $|\Delta L(S_k)| \le 0.05\text{ cm}$,
  - Notch relative arc-length ratio drift $\le 0.05\text{ cm}$,
  - Strictly monotonic piece area and perimeter ordering across ordered size tables.

### `M02h` — Deterministic Nesting & Marker Utilization Engine
- Computes exact No-Fit Polygons (NFP) on polygonized outer cutting contours (with conservative outward chordal tolerance $\delta_{\text{chord}} = 0.02\text{ cm}$ so pieces never overlap) within fabric width $W_{\text{fabric}} - 2 \cdot \text{selvedge\_margin}$.
- Enforces piece `grainline_tilt_tolerance_deg` (default $0^\circ$ or $\pm 180^\circ$ for non-directional fabrics; $0^\circ$ only for nap/one-way print fabrics).
- Outputs deterministic marker layout, linear fabric consumption $L_{\text{marker}}$, and utilization efficiency $\eta = \frac{\sum A_{\text{cut}}}{W_{\text{usable}} \cdot L_{\text{marker}}}$.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/pattern/draft` → Compiles block + style AST into `DraftedPatternRevision`.
- `POST /api/v1/pattern/validate-assembly` → Runs `M02b` + `M02f` topology and seam/offset verification.
- `POST /api/v1/pattern/grade` → Runs `M02g` multi-size grading and returns `GradedPatternFamily`.
- `POST /api/v1/pattern/nest-marker` → Runs `M02h` deterministic marker nesting.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Every draft, grade, and marker execution runs inside an `M01` tenant-isolated context and persists its input seed, algorithm version, and RFC 8785 SHA-256 digest in `GarmentRevisionNode`.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- 2D Interactive SVG CAD Canvas (read-only view of authoritative Python geometry) with layer toggles (net sew lines, cut lines, seam allowances, grainlines, notches, dart fold lines, multi-size grade nest overlay, and marker utilization strip view).

## 14. Detailed Work Packages & Implementation Sequence
1. **`M02a` Implementation:** Python `float64` geometry primitives, adaptive Gauss–Legendre arc length, centroid-shifted Green's area, and 65-point + analytical offset cusp verifier.
2. **`M02b` Implementation:** Half-edge planar topology builder, self-intersection detector, and hard-fail seam/dart validator.
3. **`M02c` Implementation:** Anthropometric profile validator and derived-measurement calculator.
4. **`M02d` Track 1 Implementation:** `skirt-block-v1` and `bodice-sleeve-v1` parametric blocks.
5. **`M02e` Implementation:** Dart pivot, slash-and-spread, yoke split, and pleat operators.
6. **`M02f` Implementation:** Exact seam allowance offsetting, corner mitering, and notch projection.
7. **`M02g` Implementation:** Category-aware multi-size grading engine and cross-size seam matrix verifier.
8. **`M02h` Implementation:** NFP deterministic strip-packing marker engine.
9. **`M02d` Track 2 Implementation:** `trouser-block-v1`, `dress-foundation-v1`, and `knit-tshirt-v1`.

## 15. Migration & Parity Strategy (Class A vs Class B Fixtures)
- Validates all `M02a`–`M02g` outputs against `M00.4` Class B Normative `mpmath` fixtures. Explicitly verifies that `DEF-M00-01`, `DEF-M00-02`, `DEF-M00-05`, and `DEF-M00-06` regression tests pass.

## 16. Unit, Property & Adversarial Test Plan
- `Hypothesis` property tests generating 1,000 random valid body profiles per garment block verifying closed CCW topology, zero self-intersections, seam mating $\Delta L \le 0.05\text{ cm}$, and monotonic size grading.
- Adversarial interior-cusp cubic Béziers ($t=0.25$ cusp) and $2\%$ line-to-line primary contour spoofing (`DEF-M00-02`).

## 17. Independent Verification Oracles
- `M00.4` `mpmath` (`mp.dps = 80`) arc-length, Green's area, and algebraic curvature/cusp oracle + independent polygon-clipping overlap checker for `M02h` markers.

## 18. Physical, Manufacturing or Financial Validation Protocol
- Plot physical 1:1 base and graded patterns for `skirt-block-v1` and `bodice-sleeve-v1`; physically walk sewn seams on cutting table and verify notch alignment within $\pm 0.5\text{ mm}$.

## 19. Acceptance Criteria (`AC-01`–`AC-12` Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-03`** (exact `float64` math & error bounds), **`AC-04`** (100% Python execution), **`AC-05`** (construction validity), **`AC-06`** (multi-size grading fidelity).

## 20. Failure Modes, Rollback & Recovery Procedures
- If an extreme body profile or aggressive style operator causes an offset self-intersection or dart apex collision, `M02b`/`M02f` fails closed with structured geometric diagnostic coordinates (`edge_id`, `t_param`, `curvature_radius_cm`) rather than emitting corrupt cut contours.

## 21. Observability, Audit Logging & Telemetry
- Logs per-piece arc-length residual bounds, Green's area error bounds, seam mating deltas, and marker utilization percentages in structured revision metadata.

## 22. Explicit Non-Goals & Scope Guardrails
- `M02` does not perform 3D cloth drape simulation (`M06`) or multimodal image inference (`M04`).

## 23. Downstream Unlocks
- Unlocks **`M04`** (recipe compilation target), **`M05`** (piece production sheets & tech packs), and **`M06`** (3D simulation & bounded pattern optimization).

## 24. Definition of Done Checklist
- [ ] `M02a`–`M02h` modules implemented in Python `services/fashion-engine` with strict `mypy` typing.
- [ ] Zero `.toFixed()` intermediate coordinate or arc-length truncation (`DEF-M00-01`, `DEF-M00-06` closed).
- [ ] 65-point + analytical interior cusp rejection active (`DEF-M00-02` closed).
- [ ] Category-aware grading active across skirt, bodice+sleeve, trouser, dress, and knit blocks (`DEF-M00-05` closed).
- [ ] All Class B Normative `mpmath` oracle checks pass (`AC-03`, `AC-05`, `AC-06`).
