# ADR-004 — MULTIMODAL AI INTERPRETATION, EPISTEMIC UNCERTAINTY & CONTROLLED RECIPE COMPILATION

- **ADR ID:** `ADR-004`
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 04`, `Ch. 05`), `Patroner_Architecture_Revision_v4.5.pdf`, `Dossier 06 v5.4`, `Dossier 07 v5.5`, `Dossier 08 v5.6`, `REQ-AI-01`

---

## 1. Context & Problem Statement
Generative vision-language models (VLMs) and diffusion models excel at semantic interpretation of sketches and photographs, but they hallucinate occluded geometry (such as back seams, invisible zippers, facings, or internal dart intakes when given only a front photo) and cannot guarantee $0.5\text{ mm}$ seam-mating tolerances or developable 2D planar topology if allowed to emit raw polygon vertices or SVG paths directly.

## 2. Decision
1. **Strict Separation of Semantic Interpretation (`M04`) and Geometric Compilation (`M02`):**
   - Multimodal AI models in `M04` are **strictly prohibited** from outputting raw 2D pattern coordinates, Bézier control points, or unstructured 3D garment meshes.
   - `M04` outputs a typed `DesignObservationBundle` that compiles (after human disambiguation) into a canonical `GarmentIntentSpecification` and a bounded `GarmentRecipeAST` executed exclusively by the deterministic `M02` geometry engine.
2. **Three-Way Epistemic Partitioning (`Dossier 07`):**
   Every structural attribute extracted by `M04` must carry an explicit epistemic classification:
   - `OBSERVED_VISIBLE`: Directly visible in the provided view angle(s) with bounding-box evidence and calibrated confidence $\ge 0.80$.
   - `INFERRED_CATEGORY_PRIOR`: Not directly visible (e.g., center-back zipper on a front-only skirt sketch) and populated from a documented category prior.
   - `AMBIGUOUS_REQUIRES_CONFIRMATION`: Conflicting visual/text cues or confidence $< 0.80$.
3. **Mandatory Human Disambiguation Gate:**
   - No `DesignObservationBundle` containing unresolved `AMBIGUOUS_REQUIRES_CONFIRMATION` claims or unconfirmed occluded structural priors may transition to `Specified` without explicit designer confirmation recorded in the revision graph.

## 3. Consequences & Enforcement
- **Positive:** Combines the creative speed of multimodal sketch/photo intake with 100% deterministic, manufacturable pattern geometry (`RSK-03` mitigated).
- **Enforcement (`AC-04`, `AC-05`):** JSON Schema validation rejects any coordinate arrays in `M04` contracts; holdout benchmark (`M04.5`) verifies $0\%$ hallucinated `OBSERVED_VISIBLE` claims on occluded views.
