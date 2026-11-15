# ADR-004 — MULTIMODAL AI INTERPRETATION (`M04a`), EPISTEMIC UNCERTAINTY & CONTROLLED RECIPE COMPILATION (`M04b`) (`R2.1.2`)

- **ADR ID:** `ADR-004`
- **Revision:** `2.1.2` (Targeted Mathematical Correction, Numerical Assurance & Governance Alignment)
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 04`, `Ch. 05`), `Patroner_Architecture_Revision_v4.5.pdf`, `Dossier 06 v5.4`, `Dossier 07 v5.5`, `Dossier 08 v5.6`, `REQ-AI-01a`, `REQ-AI-01b`

---

## 1. Context & Problem Statement
Generative vision-language models (VLMs) and diffusion models excel at semantic interpretation of sketches and photographs, but they hallucinate occluded geometry (such as back seams, invisible zippers, facings, or internal dart intakes when given only a front photo) and cannot guarantee $0.5\text{ mm}$ seam-mating tolerances or developable 2D planar topology if allowed to emit raw polygon vertices or SVG paths directly.

Furthermore, in Blueprint R2, `M04` was treated as a single monolithic workload depending on `M02c`/`M02d`/`M02e` and `M03` while simultaneously being required at `Steps 02–03` of the Vertical Slice *before* `Step 06` (`M02d`/`M02e` drafting).

---

## 2. Decision
1. **Explicit Architectural Split of `M04` into `M04a` and `M04b`:**
   - **`M04a` — Multimodal Perception & Design Intent (`REQ-AI-01a`):**
     - **Upstream Dependency:** Depends **only** on `M01` (`World Model, Schemas, Contracts & Revision Graph`, `M01.3` & `M01.5`). It has **zero** runtime or build-time dependency on `M02a`–`M02h` or `M03`.
     - **Lifecycle Execution (`Steps 02–03`):** Executes *before* deterministic drafting (`Step 06`) to ingest sketches, technical flats, reference images, and text briefs, produce a `DesignObservationBundle` with three-way epistemic tags (`OBSERVED_VISIBLE`, `INFERRED_CATEGORY_PRIOR`, `AMBIGUOUS_REQUIRES_CONFIRMATION`), and drive the human disambiguation gate to lock a canonical `GarmentIntentSpecification` (`Concept` → `Specified`).
   - **`M04b` — Controlled Recipe Compilation & Engine Integration (`REQ-AI-01b`):**
     - **Upstream Dependencies:** Depends on `M04a`, `M02c` (`Anthropometric Body Profile`), `M02d` (`Parametric Blocks`), `M02e` (`Style Transformation Operators`), and `M03` (`Material Mechanics`).
     - **Lifecycle Execution (`Step 06`):** Executes *once* `GarmentIntentSpecification` (`M04a` / `Step 03`), `ValidatedBodyProfile` (`M02c` / `Step 04`), and `CalibratedMaterialSpec` (`M03` / `Step 05`) are locked, deterministically compiling them into a validated `GarmentRecipe` / `RecipeOperatorAST` / `DraftPlan` (`block_id`, `block_parameters`, `operator_ast`, `seam_allowance_policy_id`) for execution by `M02d`/`M02e`/`M02f`.
2. **Strict Prohibition of Raw AI Geometry Emission:**
   - Neither `M04a` nor `M04b` may output raw 2D pattern coordinates, Bézier control points, SVG path strings, DXF entities, or unstructured 3D garment meshes.
3. **Three-Way Epistemic Partitioning (`Dossier 07`) & Mandatory Disambiguation Gate:**
   - Every structural attribute extracted by `M04a` must carry an explicit epistemic classification (`OBSERVED_VISIBLE`, `INFERRED_CATEGORY_PRIOR`, or `AMBIGUOUS_REQUIRES_CONFIRMATION`).
   - No `DesignObservationBundle` containing unresolved `AMBIGUOUS_REQUIRES_CONFIRMATION` claims or unconfirmed occluded structural priors may transition to `Specified` without explicit designer confirmation recorded in the `M01` revision graph.

---

## 3. Consequences & Enforcement
- **Positive:** Eliminates the `M04` ↔ `M02` dependency circularity, enables early multimodal intake (`M04a`) immediately after `M01`, and combines creative speed with 100% deterministic pattern geometry (`M04b` → `M02d`/`M02e`/`M02f`).
- **Enforcement (`AC-04`, `AC-05`):** JSON Schema validation rejects any coordinate arrays in `M04a`/`M04b` contracts; CI import graph check verifies `M04a` never imports `M02a`–`M02h` or `M03`; holdout benchmark (`M04.5`) verifies $0\%$ hallucinated `OBSERVED_VISIBLE` claims on occluded views.
