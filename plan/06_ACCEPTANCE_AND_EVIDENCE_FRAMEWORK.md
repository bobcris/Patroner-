# 06 — ACCEPTANCE AND EVIDENCE FRAMEWORK

**Document ID:** `PATRONER-BP-R2-06`  
**Status:** Authoritative Acceptance Criteria, Verification Oracles & Non-Promotion Policy  
**Governing Baseline:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 09`, `Ch. 11`, `Ch. 17`, `App. F`)

---

## 1. Core Verification Philosophy

1. **Passing Unit Tests Are Necessary But Never Sufficient:** As demonstrated in the Phase E2 and Phase E3 audits of `M05.2.1`, an implementation can pass 96 unit tests while harboring 17× error-bound violations (`DEF-M00-01`), interior cusp bypasses (`DEF-M00-02`), and cross-tenant omission vulnerabilities (`DEF-M00-04`).
2. **Independent Oracle Mandate:** Every mathematical, geometric, grading, simulation, and financial invariant must be verified by an **independent verification oracle** that shares zero implementation code with the system under test.
3. **Fail-Closed Promotion:** Any workload or garment revision that fails any applicable acceptance dimension (`AC-01` through `AC-12`) is blocked from promotion in the `v5.16 Ch. 09` lifecycle.

---

## 2. The 12 Mandatory Acceptance Dimensions (`AC-01` through `AC-12`)

| ID | Acceptance Dimension | Quantitative Threshold & Pass Invariant | Independent Verification Method / Oracle | Non-Promotion Rule (If Failed) |
| :--- | :--- | :--- | :--- | :--- |
| **`AC-01`** | **Build, Type & Contract Integrity** | Zero TypeScript (`tsc --noEmit`), Python (`mypy --strict`, `ruff`), OpenAPI 3.1, or JSON Schema validation errors across `apps/web`, `services/fashion-engine`, and `packages/contracts`. | CI contract compiler + schema round-trip fuzzer (`Hypothesis` + `schemathesis`) testing malformed, boundary, and version-skewed payloads. | Blocks PR merge and container image build. |
| **`AC-02`** | **Unit, Property & Adversarial Test Suite** | 100% pass rate on deterministic unit tests, property-based tests (`Hypothesis`), and negative/adversarial boundary tests (NaN, Infinity, zero-length, self-intersecting, extra keys). | Automated test runner in clean container with randomized seeds recorded in test provenance logs. | Blocks workload gate closure. |
| **`AC-03`** | **Mathematical & Numerical Soundness** | All geometry in IEEE 754 `float64`; zero intermediate rounding; arc-length error $\le 10^{-5}\text{ cm}$ (`0.0001 mm`); Green's area error $\le \text{reportedAreaUpperBound}$ across $\ge 50$ adversarial contours; continuous offset error $\le 0.1\text{ mm}$ across $\ge 65$ interior + endpoint samples. | Independent Python arbitrary-precision (`mpmath` `mp.dps = 80`) adaptive Gauss–Legendre quadrature and exact analytical algebraic cusp/envelope solver. | Blocks `M00`, `M02a`–`M02h`, and `M05` sign-off; marks pattern revision `Invalid`. |
| **`AC-04`** | **Architecture & Boundary Conformance** | Zero authoritative domain math, grading, marker, simulation, or SHA-256 provenance execution inside `apps/web`; 100% of mutations emit immutable `FashionRevisionNode` edges in `services/fashion-engine`. | Static AST import graph analyzer + network boundary proxy test verifying Next.js acts purely as presentation/BFF client. | Blocks `M01`–`M10` architectural review sign-off. |
| **`AC-05`** | **Domain & Garment Construction Validity** | 100% closed counter-clockwise piece boundaries; zero self-intersections; sewn seam mating $\Delta L \le 0.05\text{ cm}$ (`0.5 mm`) on straight/curved seams (or explicit ease ratio within material tolerance); valid dart apex/leg symmetry ($\Delta L \le 0.01\text{ cm}$); valid grainline & notch alignment. | Independent topological half-edge & seam-walker verifier checking every sewn edge pair, dart closure angle, and corner miter intersection. | Blocks transition from `Drafted` to `Validated` (`Ch. 09`). |
| **`AC-06`** | **Multi-Size Grading & Proportion Fidelity** | Monotonic perimeter and area scaling across all target sizes (e.g., EU 34–48); cross-size sewn seam length delta $\Delta L \le 0.05\text{ cm}$ in every graded size; notch proportionality error $\le 0.05\text{ cm}$; zero piece-boundary inversions or cusp introduction in extreme sizes. | Independent cross-size matrix verifier evaluating all $N_{\text{sizes}} \times N_{\text{seams}}$ pairs and curvature sign invariants across size extremes. | Blocks graded size release and `M02g` / `M05` gate closure. |
| **`AC-07`** | **Material-Model Credibility** | Every fabric specification separates raw test observations (GSM, bend length, tensile elongation, relaxation shrinkage) from calibrated constitutive parameters with explicit confidence intervals and versioned test-method metadata (`ISO 9073`, `ASTM D1388`, `KES-FB` / `FAST` / Patroner bench protocol). | Material schema & calibration auditor verifying physical energy positivity (convex strain energy density) and shrinkage-adjusted pattern compensation bounds. | Blocks `M03`, `M05` fabric consumption, and `M06` simulation execution. |
| **`AC-08`** | **Simulation Numerical Credibility** | Mesh convergence independence ($\Delta \text{strain} < 2\%$ under $2\times$ mesh refinement); energy conservation / bounded numerical damping; pass on analytical cantilever bending, catenary drape, and cylinder-wrap benchmarks before garment drape evaluation. | Independent analytical mechanics benchmark suite (`Dossier 10`) comparing solver output against closed-form elastica and catenary solutions. | Blocks `M06` fit prediction and disables automated pattern optimization. |
| **`AC-09`** | **Physical Fit & Toile Validation** | Digital fit predictions (circumferential ease, contact pressure zones, hem balance, armhole/crotch clearance) match physical toile/sample trials on target fit forms/models within $\le 0.5\text{ cm}$ at key POMs and $\ge 85\%$ regional fit-issue concordance on holdout garments. | Blinded physical-vs-digital trial protocol (`Dossier 06` / `Dossier 12`) signed off by lead patternmaker and QA engineer with photographic + POM measurement evidence. | Blocks transition to `Sample Approved` and keeps `isProductionReady: false`. |
| **`AC-10`** | **Manufacturing & Cut-File Qualification** | DXF-AAMA / ASTM D6673 + PDF plots pass 1:1 dimensional calibration ($100.0\text{ mm} \times 100.0\text{ mm}$ calibration square within $\pm 0.1\text{ mm}$ on physical plotter/cutter); 100% BOM, ISO 4915/4916 seam schedule, operation routing, and POM reconciliation; physical first-article sample approved. | External CAD reader import check + physical plotter/cutter verification + shop-floor first-article inspection record (`M07`). | Hard gate: `isProductionReady` **must remain `false`** until `AC-10` passes. |
| **`AC-11`** | **Security, Tenant Isolation & Provenance** | 100% server-side RBAC + ABAC enforcement on every API route and async worker job (re-verified at job start and before artifact commit); zero cross-tenant reads/writes; cryptographic SHA-256 canonical digest chain verified from intent to release package. | Automated multi-tenant penetration test suite (Tenant A vs Tenant B, expired/revoked tokens mid-job, tampered revision digests, unsigned media URLs). | Blocks deployment and any external user/maker access. |
| **`AC-12`** | **Commercial, Legal & Financial Readiness** | Every `ProductOffer` explicitly binds all 8 mandatory governance roles (`REQ-COM-01`); 100% balanced double-entry ledger postings ($\sum \text{Debits} = \sum \text{Credits}$ per currency); verified principal-vs-agent revenue recognition, VAT/tax calculation, reserve holdbacks, creator royalty splits, and refund/chargeback reversals. | Independent accounting ledger invariant verifier + end-to-end transaction lifecycle replay suite across all 3 commercial modes (Own-Label, Brand Studio, Personalized DTC). | Blocks `M08` sign-off and `M09` live commercial checkout. |

---

## 3. Mandatory 24-Section Workload Specification Standard

Every workload file in `/plan/workloads/M00` through `/plan/workloads/M10` is required to include and satisfy all **24 mandatory sections** defined in the Master Prompt (`Section 8`):
1. Workload ID & Title  
2. Purpose & Architectural Role  
3. Governing Monograph Chapters, Addenda & Dossiers  
4. Canonical Requirements Implemented (`REQ-*`)  
5. Current Repository Baseline & Classification (`I1`, `I2`, `P`, `D`, `M`, `X`, `R`, `H`)  
6. Residual Defects & Technical Debt to Close (`DEF-*`)  
7. Prerequisites & Upstream Dependencies  
8. Target Architecture & Module Ownership (`services/fashion-engine` vs `apps/web` vs `packages/contracts`)  
9. Domain Entities, State Machines & Data Contracts  
10. Mathematical, Algorithmic & Domain Specifications  
11. API Endpoints, Async Jobs & Event Contracts  
12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls  
13. User Experience & Workspace Surfaces (`apps/web`)  
14. Detailed Work Packages & Implementation Sequence  
15. Migration & Parity Strategy (Class A vs Class B Fixtures)  
16. Unit, Property & Adversarial Test Plan  
17. Independent Verification Oracles  
18. Physical, Manufacturing or Financial Validation Protocol  
19. Acceptance Criteria (`AC-01`–`AC-12` Mapping)  
20. Failure Modes, Rollback & Recovery Procedures  
21. Observability, Audit Logging & Telemetry  
22. Explicit Non-Goals & Scope Guardrails  
23. Downstream Unlocks  
24. Definition of Done Checklist  
