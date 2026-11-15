# WORKLOAD M04 — MULTIMODAL AI DESIGN INTERPRETATION & CONTROLLED RECIPES

## 1. Workload ID & Title
- **Workload ID:** `M04`
- **Title:** Multimodal Design Interpretation, Epistemic Uncertainty Partitioning, `GarmentIntentSpecification` & Controlled Recipe Compilation
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase C (AI Vision, World Model & Recipe Compilation)`

## 2. Purpose & Architectural Role
`M04` implements Patroner's **Multimodal Design Interpretation & Controlled Recipe Compilation Architecture** (`Dossier 06 v5.4`, `Dossier 07 v5.5`, `Dossier 08 v5.6`) inside `services/fashion-engine`. It enforces the core architectural invariant (`REQ-AI-01`) that **AI models never directly emit unconstrained raw 2D cut coordinates or unstructured 3D meshes**. Instead, multimodal reasoning extracts structured observations from sketches, photographs, and text, partitions visible facts from inferred priors and unresolved ambiguities, guides human disambiguation, and compiles confirmed intent into a deterministic `GarmentRecipeAST` executed by `M02`.

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 04`, `Ch. 05 (§5.1–§5.2)`, `Ch. 11`, `Ch. 15 (Phase C)`
- `Patroner_Architecture_Correction_Addendum_v4.1.pdf`, `Patroner_Architecture_Revision_v4.5.pdf`
- `Dossier 06 v5.4` (Validation, Benchmarks & Model Credibility), `Dossier 07 v5.5` (Multimodal Design Interpretation), `Dossier 08 v5.6` (Garment Recipes & Controlled Draft Compilation)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-AI-01`**: Epistemic Partitioning (Observed vs. Inferred vs. Ambiguous), Human Disambiguation Gate, and Prohibition on Direct LLM Coordinate Generation
- **`REQ-ARCH-01`**: Authoritative Python AI & World-Model Execution
- **`REQ-WM-02`**: Full Prompt, Model Version, and Seed Provenance

## 5. Current Repository Baseline & Classification
- **Multimodal AI Interpretation & Recipe Compilation**: `M` (Missing) — `0%` implemented in the current repository.

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Prevents **`RSK-03`** (AI hallucination of unseen garment backs/interiors or invalid seam geometry) through schema-constrained epistemic tagging and mandatory human confirmation gates.

## 7. Prerequisites & Upstream Dependencies
- Requires **`M01.3`** (World Model & revision graph), **`M01.5`** (secure media intake), **`M02d`** (parametric block library), and **`M02e`** (deterministic style operators).

## 8. Target Architecture & Module Ownership
```text
services/fashion-engine/app/ai_interpretation/
├── multimodal_extractor.py  # Gemini multimodal structured extraction via @google/genai / google-genai SDK
├── epistemic_partitioner.py # Separates observed_features, inferred_priors, ambiguous_questions
├── intent_compiler.py       # Compiles confirmed GarmentIntentSpecification -> GarmentRecipeAST
├── plausibility_critic.py   # Validates recipe parameters against M02 geometric & M03 material bounds
└── benchmarks/              # Stratified gold-standard holdout benchmark runner (Dossier 06)
```

## 9. Domain Entities, State Machines & Data Contracts
1. **`EpistemicFeatureClaim<T>`:**
   - `{ field_path: string, value: T, epistemic_status: "OBSERVED_VISIBLE" | "INFERRED_CATEGORY_PRIOR" | "AMBIGUOUS_REQUIRES_CONFIRMATION", confidence: float, visual_evidence_bbox?: BoundingBox2D, alternative_candidates: T[], rationale: string }`
2. **`DesignObservationBundle`:**
   - `{ bundle_id, project_id, source_media_ids: UUID[], model_id, model_version, prompt_template_sha256, claims: EpistemicFeatureClaim[], unresolved_ambiguities: AmbiguityPrompt[] }`
3. **`GarmentIntentSpecification` (Confirmed Canonical Intent — `Dossier 08`):**
   - `{ intent_spec_id, garment_family: "skirt-block-v1" | "bodice-sleeve-v1" | "trouser-block-v1" | "dress-foundation-v1" | "knit-tshirt-v1", silhouette_profile, waist_level_offset_cm, length_ratio_or_cm, dart_configuration, seam_lines, closure_spec, facing_and_hem_spec, target_fit_intent: "TAILORED" | "SEMI_FITTED" | "RELAXED", provenance_observation_bundle_id, confirmed_by_person_id }`
4. **`GarmentRecipeAST`:**
   - `{ recipe_id, foundation_block_id, block_parameters: Map<string, float>, style_operators: RecipeOperatorNode[], seam_allowance_policy_id, material_spec_id }`

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Visible vs. Occluded Epistemic Rule (`Dossier 07`):**
   - If input media contains only a front view (`view_angles == ["FRONT"]`), all back-construction attributes (`back_dart_count`, `back_closure_type`, `back_vent_type`, `back_yoke_presence`) **must** be classified as `"INFERRED_CATEGORY_PRIOR"` or `"AMBIGUOUS_REQUIRES_CONFIRMATION"` — never `"OBSERVED_VISIBLE"`.
2. **Confidence & Ambiguity Escalation Gate:**
   - Any structural feature (`garment_family`, `closure_spec`, `dart_configuration`, `sleeve_type`) with `confidence < 0.80` or `epistemic_status == "AMBIGUOUS_REQUIRES_CONFIRMATION"` blocks automatic transition to `Specified` until resolved by a human designer or explicit default acceptance (`REQ-AI-01`).
3. **Bounded Recipe Parameter Mapping (`Dossier 08`):**
   - Maps continuous semantic ratios (e.g., `skirt_hem_flare_ratio`, `waistline_drop_cm`, `dart_suppression_fraction`) onto convex, box-constrained intervals $[p_{\min}, p_{\max}]$ validated by `M02d`/`M02e` so that no AI output can construct an out-of-bounds parameter vector.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/intent/interpret` (Async Job) → Runs multimodal analysis on uploaded sketches/photos + brief; emits `DesignObservationBundle`.
- `POST /api/v1/intent/{bundle_id}/resolve-ambiguities` → Applies human designer selections and freezes `GarmentIntentSpecification` (`lifecycle_state: Specified`).
- `POST /api/v1/intent/{intent_spec_id}/compile-recipe` → Compiles `GarmentIntentSpecification` into `GarmentRecipeAST` and invokes `M02` deterministic drafting.

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- Uploaded design sketches and reference images are sanitized via `M01.5` before VLM ingestion.
- Every VLM invocation records `model_version`, `temperature: 0.0`, `prompt_template_sha256`, `input_media_sha256`, and raw structured output digest in the revision graph (`REQ-WM-02`).
- Tenant prompts and proprietary sketches are never shared across tenants or used for cross-tenant model fine-tuning.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- **Multimodal Design Intake & Disambiguation Studio:**
  - Side-by-side reference sketch/photo viewer with visual bounding-box overlays,
  - Epistemic Inspector grouping extracted attributes into **Observed (Green)**, **Category Prior (Amber)**, and **Requires Confirmation (Red/Interactive Cards)**,
  - Live Recipe AST preview showing the exact deterministic block and style operators that will be executed.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M04.1` — Epistemic Schema & `GarmentIntentSpecification` Contracts:** Define Pydantic v2 / JSON Schema models for observations, ambiguity prompts, intent specs, and recipe ASTs.
2. **`M04.2` — Multimodal Extraction Pipeline:** Implement structured VLM extraction in Python with strict JSON schema output enforcement and view-angle occlusion rules.
3. **`M04.3` — Human-in-the-Loop Disambiguation Workflow:** Implement ambiguity resolution state transitions and audit logging.
4. **`M04.4` — Controlled Recipe Compiler & Plausibility Critic:** Implement deterministic compiler mapping `GarmentIntentSpecification` → `GarmentRecipeAST` with `M02`/`M03` constraint checks.
5. **`M04.5` — Holdout Evaluation Benchmark (`Dossier 06`):** Curate stratified 100-garment multimodal holdout dataset (front-only photos, technical flats, hand sketches, text briefs) with expert patternmaker ground-truth recipes.

## 15. Migration & Parity Strategy (Class A vs Class B Fixtures)
- Greenfield Python capability (`Class B Normative`); replaces the static hardcoded `INITIAL_SKIRT_SPEC` in `src/App.tsx` with dynamic, provenance-tracked intent-to-recipe compilation.

## 16. Unit, Property & Adversarial Test Plan
- **Single-View Occlusion Test:** Feed 50 front-only garment images → verify 0% of back features are marked `OBSERVED_VISIBLE` and 100% trigger either bounded category priors or explicit confirmation prompts.
- **Adversarial Contradiction Prompt:** Upload a sleeveless bodice sketch with text prompt *"long raglan trench coat"* → verify epistemic conflict detector flags cross-modal contradiction and blocks compilation until resolved.
- **Coordinate Injection Test:** Verify that no field in `DesignObservationBundle` or `GarmentIntentSpecification` accepts raw SVG paths or vertex arrays.

## 17. Independent Verification Oracles
- Holdout benchmark evaluator (`Dossier 06`) computing macro-F1 on structural feature extraction ($\ge 0.88$ on visible features), expected calibration error ($\text{ECE} \le 0.06$), and 100% downstream `M02` compilation validity on confirmed specs.

## 18. Physical, Manufacturing or Financial Validation Protocol
- Part of the Vertical Slice (`plan/08`): compile 5 distinct sketch/photo briefs for tailored skirts and set-in sleeve bodices into physical 1:1 patterns and verify faithful translation of design proportions.

## 19. Acceptance Criteria (`AC-01`–`AC-12` Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`** (Python authority & zero raw AI geometry generation), **`AC-05`** (100% of compiled recipes produce topologically valid `M02` patterns), **`AC-11`** (full model/prompt provenance).

## 20. Failure Modes, Rollback & Recovery Procedures
- If VLM service times out or returns low confidence across $>50\%$ of structural fields, workspace gracefully falls back to guided parametric specification cards in `apps/web` without losing project state.

## 21. Observability, Audit Logging & Telemetry
- Tracks per-field confidence histograms, human override rates per attribute (identifying systematic model blind spots), and recipe compilation latency.

## 22. Explicit Non-Goals & Scope Guardrails
- `M04` never generates marketing diffusion imagery as a substitute for technical pattern geometry, and never bypasses `M02` deterministic drafting.

## 23. Downstream Unlocks
- Unlocks the **Vertical Slice Gate (`plan/08`)** and **`M06`** (intent-driven fit target weighting).

## 24. Definition of Done Checklist
- [ ] Multimodal extractor and epistemic partitioner implemented in `services/fashion-engine`.
- [ ] Front-only occlusion rule enforced (`0%` hallucinated `OBSERVED_VISIBLE` back features).
- [ ] Human disambiguation gate active for low-confidence/ambiguous structural attributes.
- [ ] Controlled Recipe Compiler verified across 100% of holdout benchmark cases.
