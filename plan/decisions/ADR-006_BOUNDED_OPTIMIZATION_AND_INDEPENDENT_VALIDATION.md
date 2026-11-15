# ADR-006 — BOUNDED PATTERN OPTIMIZATION & INDEPENDENT RE-VALIDATION

- **ADR ID:** `ADR-006`
- **Revision:** `2.1` (Controlled Architecture, Dependency, Numerical Assurance & Release-Governance Correction)
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Architecture_Revision_v4.5.pdf`, `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 04`, `Ch. 06`), `Dossier 05 v5.3`, `Dossier 12 v5.10`, `REQ-FIT-01`, `ADR-009`

---

## 1. Context & Problem Statement
Unconstrained gradient or mesh optimization on 2D pattern boundaries can trivially lower 3D simulation strain energy by distorting the designer's intended silhouette, breaking seam mating between joined pieces, introducing interior offset cusps, or violating minimum manufacturable dart/seam angles (`RSK-05`).

---

## 2. Decision
1. **Low-Dimensional Bounded Recipe Parameter Space (`Revision v4.5`):**
   - `M06` optimization is **forbidden** from directly perturbing individual 2D spline control points or 3D mesh vertices.
   - Optimization operates strictly over a low-dimensional vector $\boldsymbol{\theta} \in [\boldsymbol{\theta}_{\min}, \boldsymbol{\theta}_{\max}]$ of declared `M02d`/`M02e` recipe parameters (e.g., waist dart intake $\pm 0.6\text{ cm}$, hip curve offset $\pm 0.8\text{ cm}$, shoulder slope $\pm 1.5^\circ$, sleeve cap ease $\pm 1.5\%$).
2. **Multi-Objective Pareto Formulation Preserving Design Intent:**
   - The optimizer evaluates the Pareto trade-off between **Regional Strain/Pressure Penalty**, **Target Ease Deviation**, **Hem/Grainline Balance**, and **Design Intent Preservation** ($\|\boldsymbol{\theta} - \boldsymbol{\theta}_{\text{intent}}\|_W^2$).
3. **Mandatory Independent Deterministic Re-Validation (`M02` + `M02h` + `M05` + `ADR-009`):**
   - Every candidate parameter vector $\boldsymbol{\theta}^*$ must be compiled from scratch through `M02` (`Step 06` drafting and `Step 07` topological, seam-mating, and `ADR-009` complete-interval $[0, 1]$ offset regularity validation). Any candidate failing `AC-03` or `AC-05` is immediately discarded.
4. **Mandatory Human Patternmaker Approval:**
   - No optimization proposal may auto-promote to the active revision head; a human `LEAD_PATTERNMAKER` must review the 2D pattern overlay delta and `FitEvaluationReport` comparison and explicitly approve the child revision branch.

---

## 3. Consequences & Enforcement
- **Positive:** Guarantees that every optimized pattern remains 100% constructible, faithful to the designer's silhouette, and auditable.
- **Enforcement (`AC-05`, `AC-08`, `AC-11`):** Enforced by `independent_revalidator.py` and the `M01` revision state machine.
