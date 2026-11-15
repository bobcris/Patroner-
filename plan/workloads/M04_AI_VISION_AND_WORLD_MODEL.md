# WORKLOAD M04 — MULTIMODAL PERCEPTION (`M04a`) & CONTROLLED RECIPE COMPILATION (`M04b`) (`R2.1`)

## 1. Workload ID & Title
- **Workload ID:** `M04` (Formally Separated into Sub-Workloads **`M04a`** and **`M04b`** per `Correction 01`)
- **Title:**
  - **`M04a`:** Multimodal Perception, Epistemic Uncertainty Partitioning & User-Confirmed Design Intent (`Dossier 07`)
  - **`M04b`:** Controlled Recipe Compilation, `RecipeOperatorAST` Validation & Deterministic `DraftPlan` / `EnginePlan` Integration (`Dossier 08`)
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase A/B/C (Multimodal Design Intent & Controlled Recipe Compilation)`

## 2. Purpose & Architectural Role (`Correction 01`)
`M04` implements Patroner's **Multimodal Design Interpretation & Controlled Recipe Compilation Architecture** (`Dossier 06 v5.4`, `Dossier 07 v5.5`, `Dossier 08 v5.6`) inside `services/fashion-engine`.

To eliminate any dependency circularity between multimodal intent intake and deterministic pattern drafting (`Correction 01`), `M04` is formally split into two sequential, independently gated capabilities:
1. **`M04a` — Multimodal Perception and Design Intent (Executes *Before* Deterministic Drafting):**
   - Depends **only** on `M01` (`M01.3` World Model & `M01.5` Secure Media Intake) — **zero dependency on `M02d` or `M02e`**.
   - Ingests reference sketches, photographs, and design briefs; extracts visual observations; partitions visible construction features (`OBSERVED_VISIBLE`) from inferred category priors (`INFERRED_CATEGORY_PRIOR`) and unresolved ambiguities (`AMBIGUOUS_REQUIRES_CONFIRMATION`); drives the human clarification workflow; and produces the user-confirmed **`GarmentIntentSpecification`** with complete source-to-observation provenance.
   - **Strict Guardrail:** `M04a` must **never** emit authoritative 2D/3D geometry, must **never** silently determine or fabricate missing body measurements (`M02c`), and must **never** promote inferred details without explicit user approval.
2. **`M04b` — Controlled Recipe Compilation and Engine Integration (Executes *After* Intent Confirmation & `M02d`/`M02e` Availability):**
   - Depends on **`M04a`** (approved `GarmentIntentSpecification`), **`M02c`** (`ValidatedBodyProfile`), **`M02d`** (Parametric Blocks), **`M02e`** (Style Transformation Operators), and **`M03`** (`CalibratedMaterialSpec`).
   - Converts the user-approved `GarmentIntentSpecification` into a typed **`GarmentRecipe`** and **`RecipeOperatorAST`**, validates operator compatibility and parameter sufficiency against `M02`/`M03` domain bounds, produces a typed **`DraftPlan` / `EnginePlan`** (`Dossier 02`), invokes deterministic Python drafting (`M02d`/`M02e`/`M02f`), and captures full execution provenance and validation outcomes.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 04`, `Ch. 05 (§5.1–§5.2)`, `Ch. 09`, `Ch. 11`, `Ch. 15`, `App. A8–A9`
- `Patroner_Architecture_Correction_Addendum_v4.1.pdf`, `Patroner_Architecture_Revision_v4.5.pdf`
- `Dossier 06 v5.4` (Validation, Benchmarks & Model Credibility), `Dossier 07 v5.5` (Multimodal Design Interpretation), `Dossier 08 v5.6` (Garment Recipes & Controlled Draft Compilation)
- `ADR-004` (Multimodal AI Epistemic Discipline & Controlled Recipe Compilation)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-AI-01a` (`M04a`)**: Multimodal Perception, 3-Way Epistemic Partitioning, Separation from Body Measurements, Human Disambiguation Gate & Source Provenance (`Dossier 07`)
- **`REQ-AI-01b` (`M04b`)**: Controlled `GarmentRecipe` & `RecipeOperatorAST` Compilation, Sufficiency Validation & `DraftPlan` / `EnginePlan` Execution (`Dossier 08`, `Dossier 02`)
- **`REQ-ARCH-01`**, **`REQ-WM-02`** (Authoritative Python Execution & Full Prompt/Model/Seed Provenance)

## 5. Current Repository Baseline & Classification
- **`src/services/ai/fashion-service.ts`**: `D` (Demo-only stub) — Calls non-existent `/api/fashion/concept` and falls back to hardcoded string templates (`studio-demonstration-mode`).
- **True `M04a` Multimodal Perception & `M04b` Recipe Compiler**: `M` (Missing — `0%` implemented).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Retires the demo string fallback in `src/services/ai/fashion-service.ts` (`04_MIGRATION_AND_PARITY_POLICY.md` #12) and prevents **`RSK-03`** (AI hallucination of unseen garment backs/interiors or unverified measurements).

## 7. Prerequisites & Upstream Dependencies (`Correction 01` Non-Circular Split)
- **`M04a` Prerequisites:** Requires **only `M01.3`** (World Model & revision graph) and **`M01.5`** (Secure media upload & sanitization). **Does NOT depend on `M02a`–`M02h` or `M03`.**
- **`M04b` Prerequisites:** Requires **`M04a`** (approved `GarmentIntentSpecification`), **`M02c`** (`ValidatedBodyProfile`), **`M02d`** (Parametric Block Library), **`M02e`** (Style Transformation Operators), and **`M03`** (`CalibratedMaterialSpec`).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/ai_interpretation/
├── m04a_perception_and_intent/   # Depends ONLY on M01 (Available before drafting)
│   ├── media_ingestion.py        # Binds sanitized M01.5 image/sketch digests & view-angle metadata
│   ├── multimodal_extractor.py   # Gemini structured visual extraction via google-genai SDK
│   ├── epistemic_partitioner.py  # Enforces OBSERVED_VISIBLE vs INFERRED_CATEGORY_PRIOR vs AMBIGUOUS
│   └── disambiguation_workflow.py# Human clarification state machine -> freezes GarmentIntentSpecification
├── m04b_recipe_compilation/      # Depends on M04a + M02c + M02d + M02e + M03
│   ├── recipe_compiler.py        # Compiles confirmed GarmentIntentSpecification -> GarmentRecipe & RecipeOperatorAST
│   ├── compatibility_validator.py# Validates operator compatibility & parameter sufficiency against M02/M03
│   └── draft_plan_executor.py    # Emits typed DraftPlan / EnginePlan and calls M02d/M02e/M02f
└── benchmarks/                   # Stratified gold-standard holdout benchmark runner (Dossier 06)
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`EpistemicFeatureClaim<T>` (`M04a` — `Dossier 07`):**
   - `{ claim_id, field_path: string, value: T, epistemic_status: "OBSERVED_VISIBLE" | "INFERRED_CATEGORY_PRIOR" | "AMBIGUOUS_REQUIRES_CONFIRMATION", confidence: float, source_media_id: UUID, visual_evidence_bbox?: BoundingBox2D, alternative_candidates: T[], rationale: string }`
2. **`DesignObservationBundle` (`M04a`):**
   - `{ bundle_id, tenant_id, project_id, source_media_ids: UUID[], view_angles_present: ("FRONT" | "BACK" | "SIDE" | "DETAIL")[], model_id, model_version, prompt_template_sha256, claims: EpistemicFeatureClaim[], unresolved_ambiguities: AmbiguityPrompt[], contains_authoritative_geometry: false, contains_body_measurements: false }`
3. **`GarmentIntentSpecification` (`M04a` Output — Confirmed Canonical Intent):**
   - `{ intent_spec_id, tenant_id, project_id, revision_id, garment_family: "skirt-block-v1" | "bodice-sleeve-v1" | "trouser-block-v1" | "dress-foundation-v1" | "knit-tshirt-v1", silhouette_profile, waist_level_offset_cm, length_ratio_or_cm, dart_configuration, seam_lines, closure_spec, facing_and_hem_spec, target_fit_intent: "TAILORED" | "SEMI_FITTED" | "RELAXED", provenance_observation_bundle_id, claim_approval_decisions: Map<ClaimID, UserResolutionRecord>, confirmed_by_person_id, confirmed_at }`
4. **`GarmentRecipe`, `RecipeOperatorAST` & `DraftPlan` (`M04b` Output — `Dossier 08` & `Dossier 02`):**
   - `GarmentRecipe`: `{ recipe_id, recipe_schema_version, intent_spec_id, foundation_block_id, block_parameters: Map<string, float>, operator_ast: RecipeOperatorNode[], seam_allowance_policy_id, required_measurement_keys: string[] }`
   - `DraftPlan` (`EnginePlan`): `{ draft_plan_id, recipe_id, validated_body_profile_id, calibrated_material_spec_id, parameter_sufficiency_verified: true, operator_compatibility_verified: true, target_engine_steps: ["M02d_DRAFT", "M02e_TRANSFORM", "M02f_OFFSET_AND_NOTCH", "M02b_VALIDATE"], random_seed: int, plan_sha256: string }`

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Visible vs. Occluded Epistemic Rule (`M04a` — `Dossier 07`):**
   - If input media contains only a front view (`view_angles_present == ["FRONT"]`), all occluded back/interior construction attributes (`back_dart_count`, `back_closure_type`, `back_vent_type`, `back_yoke_presence`, `internal_facing_width`) **must** be classified as `"INFERRED_CATEGORY_PRIOR"` or `"AMBIGUOUS_REQUIRES_CONFIRMATION"` — **never** `"OBSERVED_VISIBLE"`.
2. **Strict Separation of Visual Estimates from Body Dimensions (`M04a`):**
   - `M04a` is permitted to extract dimensionless semantic proportions (e.g., `skirt_length_relative_to_knee: "MIDI_BELOW_KNEE"`, `waist_placement: "NATURAL_WAIST"`), but is **forbidden** from emitting absolute anthropometric body circumferences (`bust_cm`, `waist_cm`, `hip_cm`). Absolute body dimensions come exclusively from `M02c` (`ValidatedBodyProfile`).
3. **Human Disambiguation Gate (`M04a` → `M04b` Boundary):**
   - Any structural feature with `confidence < 0.80`, `epistemic_status == "AMBIGUOUS_REQUIRES_CONFIRMATION"`, or unconfirmed `INFERRED_CATEGORY_PRIOR` blocks transition to `Specified` (`AI_PROPOSAL_SPECIFIED`) and blocks `M04b` invocation until explicitly confirmed or overridden by an authenticated user.
4. **Controlled Recipe Compilation & Sufficiency Verification (`M04b` — `Dossier 08`):**
   - `M04b` checks:
     1. **Parameter Sufficiency:** $\text{required\_measurement\_keys}(\text{recipe}) \subseteq \text{available\_keys}(\text{ValidatedBodyProfile})$,
     2. **Box-Constraint Projection:** Every continuous recipe parameter $p_k \in [p_{k,\min}, p_{k,\max}]$ lies strictly within the convex domain supported by `M02d`/`M02e` and `M03` ease bounds,
     3. **AST Operator Compatibility:** Verifies that the sequence of `RecipeOperatorNode` transformations (e.g., dart rotation followed by yoke split) satisfies topological precondition invariants before emitting `DraftPlan`.

## 11. API Endpoints, Async Jobs & Event Contracts
- **`M04a` Endpoints (Available after `M01`):**
  - `POST /api/v1/intent/interpret` (Async Job) → Runs `M04a` multimodal perception on uploaded sketches/photos + brief; emits `DesignObservationBundle`.
  - `POST /api/v1/intent/{bundle_id}/resolve-ambiguities` → Records human designer selections and freezes `GarmentIntentSpecification` (`lifecycle_state: Specified`).
- **`M04b` Endpoints (Available after `M04a` + `M02c` + `M02d` + `M02e` + `M03`):**
  - `POST /api/v1/intent/{intent_spec_id}/compile-recipe` → Runs `M04b` to compile `GarmentIntentSpecification` into `GarmentRecipe` + `RecipeOperatorAST` + `DraftPlan`, validates sufficiency, and dispatches deterministic `M02` execution.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Uploaded design sketches and reference images are sanitized via `M01.5` before VLM ingestion.
- Every `M04a` VLM invocation records `model_id`, `model_version`, `temperature: 0.0`, `prompt_template_sha256`, `source_media_sha256`, and output digest in the revision graph (`REQ-WM-02`).
- Private tenant sketches and prompts are never shared across tenants or used for model training by default (`REQ-AI-01`, `DOS-16`).

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **`M04a` Multimodal Design Intake & Disambiguation Studio:**
  - Side-by-side reference sketch/photo viewer with visual evidence bounding-box overlays,
  - Epistemic Inspector grouping extracted claims into **Observed Visible (Green)**, **Inferred Category Prior (Amber — Requires Confirmation)**, and **Ambiguous / Conflict (Red — Interactive Selection Cards)**.
- **`M04b` Recipe & `DraftPlan` Inspector:**
  - Displays the compiled `GarmentRecipe`, `RecipeOperatorAST` sequence, and parameter sufficiency checklist prior to executing `M02` drafting.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M04a.1` — Epistemic Observation & `GarmentIntentSpecification` Contracts:** Define Pydantic v2 / JSON Schema models (`contains_authoritative_geometry: false`, `contains_body_measurements: false`).
2. **`M04a.2` — Multimodal Perception & View-Occlusion Partitioner:** Implement structured VLM extraction in Python with strict front/back occlusion rules.
3. **`M04a.3` — Human Clarification & Intent Freeze Workflow:** Implement ambiguity resolution state transitions and source-to-claim provenance logging.
4. **`M04b.1` — Controlled `GarmentRecipe` & `RecipeOperatorAST` Compiler:** Map confirmed `GarmentIntentSpecification` to foundation block parameters and style operator AST nodes.
5. **`M04b.2` — Operator Compatibility, Measurement Sufficiency & `DraftPlan` Integrator:** Validate against `M02c`, `M02d`, `M02e`, and `M03` and invoke deterministic `M02` execution.
6. **`M04.5` — Holdout Evaluation Benchmark (`Dossier 06`):** Evaluate `M04a` perception accuracy and `M04b` recipe compilation validity on a stratified 100-garment gold-standard holdout benchmark.

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Retires `src/services/ai/fashion-service.ts` (`Disposition: RETIRE & REIMP in Python`); establishes Class B Normative holdout fixtures for both `M04a` observation bundles and `M04b` compiled `DraftPlan` ASTs.

## 16. Unit, Property & Adversarial Test Plan
- **Single-View Occlusion Test (`M04a`):** Feed 50 front-only garment images → verify $0\%$ of back features are marked `OBSERVED_VISIBLE` and $100\%$ trigger `INFERRED_CATEGORY_PRIOR` or `AMBIGUOUS_REQUIRES_CONFIRMATION`.
- **Unconfirmed Intent Promotion Block (`M04a` → `M04b`):** Attempt to call `M04b` `compile-recipe` on an unconfirmed `DesignObservationBundle` or with unresolved ambiguities → 100% hard rejection.
- **Coordinate & Measurement Injection Test (`M04a`):** Verify schema rejects any raw SVG path, vertex array, or absolute body circumference field in `DesignObservationBundle`.
- **Insufficient Measurement Rejection (`M04b`):** Attempt to compile a trouser recipe with a skirt-only measurement profile missing `crotch_depth_cm` / `inseam_cm` → rejected by `M04b` parameter sufficiency check.

## 17. Independent Verification Oracles
- Holdout benchmark evaluator (`Dossier 06`) computing macro-F1 on visible feature extraction ($\ge 0.88$), expected calibration error ($\text{ECE} \le 0.06$), $0\%$ occlusion hallucination rate (`M04a`), and $100\%$ downstream `M02` compilation validity on confirmed specs (`M04b`).

## 18. Physical, Manufacturing or Financial Validation Protocol
- Part of the Vertical Slice (`plan/08`): process 5 distinct sketch/photo briefs for tailored skirts (`skirt-block-v1`) and set-in sleeve bodices (`bodice-sleeve-v1`) through `M04a` (Steps 02–03) and `M04b` (Step 06) into physical 1:1 patterns.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`** (Python authority, `M04a`/`M04b` separation & zero raw AI geometry emission), **`AC-05`** (100% of `M04b` compiled `DraftPlan` objects produce topologically valid `M02` patterns), **`AC-11`** (full model/prompt/claim provenance). Required for **Release Level A**.

## 20. Failure Modes, Rollback & Recovery Procedures
- If VLM service times out or returns low confidence across $>50\%$ of structural fields in `M04a`, the workspace presents structured manual specification cards in `apps/web` so the designer can explicitly author `GarmentIntentSpecification` and proceed to `M04b` without blockage.

## 21. Observability, Audit Logging & Telemetry
- Tracks per-field confidence histograms, human override rates per attribute (`M04a`), and recipe compilation / AST validation latency (`M04b`).

## 22. Explicit Non-Goals & Scope Guardrails
- `M04a` and `M04b` never generate marketing diffusion imagery as a substitute for technical pattern geometry and never bypass `M02` deterministic drafting.

## 23. Downstream Unlocks
- **`M04a`** unlocks **Vertical Slice Steps 02–03** and **`M04b`**.
- **`M04b`** unlocks **Vertical Slice Step 06**, **`M02f`** (recipe-driven pattern completion), and **`M06`** (intent-driven fit target weighting & bounded recipe optimization).

## 24. Definition of Done Checklist
- [ ] `M04a` implemented depending only on `M01` (zero circular dependency on `M02d`/`M02e`).
- [ ] Front-only occlusion rule and zero-measurement/zero-geometry guardrails enforced in `M04a`.
- [ ] Human disambiguation gate enforced before freezing `GarmentIntentSpecification`.
- [ ] `M04b` implemented converting approved `GarmentIntentSpecification` into `GarmentRecipe`, `RecipeOperatorAST`, and `DraftPlan` validated against `M02c`/`M02d`/`M02e`/`M03`.
- [ ] Holdout evaluation benchmark (`Dossier 06`) passing in CI.
