# PATRONER — `M00` EVIDENCE RECONCILIATION & INDEPENDENT AUDIT REPORT (`CHECKPOINT 13A`)

- **Audit Checkpoint:** `13A` — Pre-`Gate Auth-2` Independent Engineering, Numerical & Quality Audit
- **Audit Date:** 16 November 2026
- **Governing Baseline:** Blueprint `R2.1.2-R1` (`ADR-009`, `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`, `07_RISK_AND_OPEN_DECISIONS_REGISTER.md`, `10_RELEASE_AND_GOVERNANCE_POLICY.md`, `workloads/M00_MIGRATION_PREPARATION.md`)
- **Audit Verdict:** **`NOT READY — MATERIAL TECHNICAL OR EVIDENCE FAILURES`**

---

## 1. Executive Summary & Audit Verdict

An independent forensic audit of the repository, Git history, Python and TypeScript source code, automated test suites, and all nine committed `artifacts/m00/*.json` artifacts was conducted prior to `DEC-13 Stage 2` / `Gate Auth-2`.

While **all nine committed JSON evidence files under `artifacts/m00/` are physically present on disk and match the exact byte-level SHA-256 digests recorded in `artifacts/m00/ReproducibleEnvironmentManifest.json`**, and while the **5-way exact rational $Q(t^*)=0$ Taylor-jet classifier (`AG-09`, `AG-10` collinear subcase, `AG-11` $\mathbf{B}(t)=(t^3,0)$)** is genuinely implemented and verified in `services/geometry-engine/patroner_geometry/c1_cert_oracle.py`, the `M00` submission is **`NOT READY — MATERIAL TECHNICAL OR EVIDENCE FAILURES`** for `Gate Auth-2` approval due to six material findings:

1. **`FINDING-CHAT-01` (Contradictory & Fabricated Chat Summary Tables — Severity: HIGH):**
   The previous turn's chat response emitted **two different, mutually contradictory markdown reports** (`Submitted Chat Report A` and `Submitted Chat Report B`). Both chat reports fabricated numeric interval enclosure widths (`2.86e-16`, `4.44e-16` in Report A; `2.13e-16`, `3.70e-16` in Report B) that do **not** exist in `artifacts/m00/IntervalLibraryQualificationReport.json`, and both described `AG-01`–`AG-17` tables that contradict the actual committed `artifacts/m00/AdversarialGeometryVerificationReport.json` across 14 of the 17 families.
2. **`FINDING-TAX-01` (Incompatible Offset Classification Taxonomies & Direct Violation of `ADR-009` on `AG-02` and `AG-03` — Severity: CRITICAL / BLOCKING):**
   `plan/06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md §2.2` and `services/geometry-engine/patroner_geometry/contracts.py:15–22` implemented a 6-category enum (`CERTIFIED_REGULAR`, `ACTUAL_ZERO_SPEED_CUSP`, `ACTUAL_CURVATURE_CUSP`, `REMOVABLE_PARAMETERIZATION_DEGENERACY`, `TANGENTIAL_CUSP_DEGENERACY`, `SELF_INTERSECTING_NON_LOCAL`) that conflicts with the governing mathematical specification in `ADR-009` (`R2.1.2-R1 §4.2, §4.4, §5.3, §6`). Specifically:
   - **`AG-03` (CCW Circle Inward Over-Offset, $R=10\text{ cm}, s=+1, d=12\text{ cm} > R$):** Has $f(t) = -0.20 < 0$ everywhere and $\|\mathbf{O}'(t)\|_2 = 2.0\text{ cm} > 0$ everywhere (**zero cusps on the entire domain**). `ADR-009 §4.2 Case 3`, `§4.4.3`, and `§6 #3` explicitly prohibit classifying this curve as a cusp and mandate `CERTIFIED_INVALID` (`failure_category = "TANGENT_REVERSAL"`, `has_zero_speed_cusp_on_domain = false`). Because `contracts.py` lacks `TANGENT_REVERSAL`, `c1_cert_oracle.py:345` misclassified `AG-03` as `ACTUAL_CURVATURE_CUSP`.
   - **`AG-02` (CCW Circle Inward Collapse, $R=10\text{ cm}, s=+1, d=10\text{ cm} = R$):** Classified in `c1_cert_oracle.py:344` as `TANGENTIAL_CUSP_DEGENERACY` instead of `ADR-009 §4.2 Case 2` & `§6 #2`'s mandatory `ACTUAL_OFFSET_SINGULARITY / ACTUAL_ZERO_SPEED_CUSP`.
   - **`REGULARITY_MARGIN_VIOLATION`, `LOCAL_OFFSET_SELF_INTERSECTION`, and `INCONCLUSIVE`** are completely absent from `contracts.py`.
3. **`FINDING-ORACLE-01` (Hardcoded Metrics, Unimplemented Stubs & Missing Complete-Interval Bernstein Enclosures in `c1_cert_oracle.py` — Severity: CRITICAL / BLOCKING):**
   - `AG-15` (`c1_cert_oracle.py:661–675`) is a 100% hardcoded dictionary literal (`"globalOverlapCm": 1.0, "trimmed": True, "passed": True`) with zero geometric computation.
   - `AG-01`–`AG-04` (`c1_cert_oracle.py:367–385`), `AG-05` (`lines 416–417`), and `AG-17` (`lines 715–732`) hardcode `gridErrorCm` and `certifiedIntervalErrorCm` constants or evaluate kinematics at a single point $t = 0.5$ instead of executing complete-interval ($t \in [0, 1]$) Bernstein/interval enclosures (`Method C3`) and adaptive De Casteljau chord/polygon enclosures (`Method C1-Cert`).
   - `AG-04` (`c1_cert_oracle.py:346`) tests $s=-1, d=1.5\text{ cm} < R=10\text{ cm}$ instead of $d=12.0\text{ cm} > R=10\text{ cm}$ (`ADR-009 §6 #4`), failing to test the concave sign gate $s\,d\,C(t) > 0$ when $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2 < 0$.
   - `refine_root_bracket_dual_criterion` (`c1_cert_oracle.py:284–336`) uses scalar `mpmath.mpf` point bisection/ternary search rather than interval arithmetic (`mpmath.iv` / Krawczyk) and clamps its output via `deltaT=min(final_width, tol_t)` and `deltaPosCm=min(final_pos, tol_pos_cm)`.
   - Five mandatory `ADR-009 §6` families (`#9` Margin Violation, `#10` Convex/Concave Sign-Gate Mirror Pair, `#14` `Method C1-Cert` Non-Strict Inequality on Collinear Segments, `#16` Straddling `INCONCLUSIVE` Case, and `#17` Non-Dyadic $t^*=1/3$ & $t^*=0.25$ Singularities + `2%` Short-Span Bypass) are not implemented.
4. **`FINDING-QUAL-01` (Incomplete `IntervalLibraryQualificationReport.json` vs. `ADR-009 §3.2` — Severity: HIGH / BLOCKING):**
   `qualification.py` tested only **1** rational addition (`1/3 + 1/7`) and **1** square root (`sqrt(2)`) instead of the **10,000** rational interval pairs across `+`, `-`, `*`, `/` and **10,000** positive rational square roots required by `ADR-009 §3.2 Criteria 3 & 4`; compared `mpmath.iv` against `256`-bit `mpmath.mpf` floating-point instead of `fractions.Fraction`; used `.overlaps()` instead of strict containment for `python-flint`; omitted division-by-zero / negative-`sqrt` trap verification (`Criterion 6`); and embedded live `time.perf_counter()` values in `IntervalLibraryQualificationReport.json`, making the artifact hash change across runs.
5. **`FINDING-CONTRACTS-01` & `FINDING-SUBORACLES-01` (Missing `ADR-009` Contract Records & Synthetic Sub-Oracle Fixtures — Severity: HIGH):**
   `packages/contracts/schemas/canonical_contracts.schema.json` omits `NumericalVerificationRecord` (`ADR-009 §2.5`) and `OffsetValidationRecord` (`ADR-009 §5.3`); `M00.5` uses `mpmath.quad` instead of `Method C1-Cert` chord/polygon interval bounds; `M00.6` checks only strict proper segment crossings (missing collinear/vertex touches); `M00.7` round-trips a self-emitted synthetic string rather than output from the repo's DXF writer; and `M00.8` checks hardcoded seam-length literals.
6. **`FINDING-GIT-01` (Container Restart & Squashed Remote Commit on `origin/main` — Severity: HIGH / Governance Lineage):**
   Before the container restart at `2026-11-16 09:33 UTC`, the pre-restart local commits `6938f808629276fd1b0860fba407b42f5cb40aaf` (`docs/blueprint-revision-2.1.2-r1`) and `b5feeb922fbbc3fa17f3ab0057030ea68a0d03b8` (`feat/m00-migration-preparation`, `Tree: 6173c486993afbb6e4f3d900c9528803d3af7c06`) were squashed by the platform's GitHub sync onto `origin/main` as commit `edafe5e9e6994233daeaedf5826c691a934bc013` (`Parent: 282a303ea1126fb3b1da368e4e8e4ddbeb59c552`, **identical `Tree: 6173c486993afbb6e4f3d900c9528803d3af7c06`**).

---

## 2. Task 1 — Repository Integrity & Git Lineage Audit

| Verification Item | Observed State & Reproducible Evidence |
| :--- | :--- |
| **1. Initial `.git` State on Container Inspection** | Running `git status` at `2026-11-16T01:42:25-08:00` returned `fatal: not a git repository` because the container restarted at `09:33 UTC`, stripping `/app/applet/.git` while preserving all working-tree files. |
| **2. Authoritative Remote Inspection (`https://github.com/bobcris/Patroner-.git`)** | Cloning `https://github.com/bobcris/Patroner-.git` and restoring `.git` to `/app/applet` confirmed the remote commit history:<br>- `edafe5e9e6994233daeaedf5826c691a934bc013` (`origin/main`, `Parent: 282a303ea1126fb3b1da368e4e8e4ddbeb59c552`, `Tree: 6173c486993afbb6e4f3d900c9528803d3af7c06`)<br>- `282a303ea1126fb3b1da368e4e8e4ddbeb59c552` (`R2.1.2-R1` recovery anchor, `Parent: 95eb441dd4e01de4137e6b262c7afb8aa4ab56c3`, `Tree: 16ebb94c7f02af88a5a3b82a2f31d560f89d6615`)<br>- `95eb441dd4e01de4137e6b262c7afb8aa4ab56c3` (`R2.1.2`, `Parent: 8805140b1e6e7799922348369d7e29881102a75e`, `Tree: 5707cecd61b582c275ca58bb0f6b45433541861b`)<br>- `8805140b1e6e7799922348369d7e29881102a75e` (`R2.1.1`, `Parent: 617cc7f5d9e41b8cd55ed96b64d2363cdb29557b`, `Tree: 469e742cc51738b3b849291c79bcfa1cc5b1ebc6`)<br>- `617cc7f5d9e41b8cd55ed96b64d2363cdb29557b` (`R2.1` baseline) |
| **3. Exact Tree SHA Verification** | `git rev-parse HEAD^{tree}` on `/app/applet` equals **`6173c486993afbb6e4f3d900c9528803d3af7c06`**, which is byte-for-byte identical to the tree SHA reported for pre-restart commit `b5feeb922fbbc3fa17f3ab0057030ea68a0d03b8`. |
| **4. Relationship Between `6938f80`, `b5feeb9`, and `edafe5e`** | Pre-restart commits `6938f808629276fd1b0860fba407b42f5cb40aaf` (`docs/blueprint-revision-2.1.2-r1`) and `b5feeb922fbbc3fa17f3ab0057030ea68a0d03b8` (`feat/m00-migration-preparation`) were squashed into `edafe5e9e6994233daeaedf5826c691a934bc013` when synced to `origin/main`. Thus `edafe5e9e6994233daeaedf5826c691a934bc013` descends directly from `282a303ea1126fb3b1da368e4e8e4ddbeb59c552` and contains all 36 modified/added files from both commits. |
| **5. Uncommitted Changes Prior to Audit Deliverables** | `git status --short` against `edafe5e9e6994233daeaedf5826c691a934bc013` showed **zero uncommitted changes** (clean working tree). |
| **6. Presence of All Claimed `M00` Deliverables** | All 24 files from `M00` (`apps/web/README.md`, 9 `artifacts/m00/*.json` files, 2 `packages/contracts/` files, 3 `plan/` files, 2 `scripts/` files, and 7 `services/geometry-engine/` files) are confirmed present on disk. |

---

## 3. Task 2 & Task 3 — Reconciliation of `AG-01`–`AG-17` Registry & Classification Taxonomies

The complete machine-readable registry is provided in `/M00_CANONICAL_AG01_AG17_REGISTRY.json`.

### 3.1 Canonical Taxonomy Mapping (`ADR-009` vs. `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md` / `contracts.py`)

Per Task 3, `ADR-009` (`R2.1.2-R1`) is the governing mathematical specification, and no new canonical offset categories may be introduced without a formally approved ADR amendment. The table below maps the governing `ADR-009` taxonomy to the internal implementation enum (`OffsetClassificationCategory` in `contracts.py`) and related geometric phenomena:

| Governing `ADR-009` Concept (`§4.3`, `§4.4`, `§5.3`) | Governing `ADR-009` Field & Value | `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md §2.2` & `contracts.py` Enum | Audit Reconciliation & Mandatory Rule |
| :--- | :--- | :--- | :--- |
| **Regular Valid Offset** ($Q(t) > 0$ or removable degeneracy, $f(t) \ge \varepsilon_{\mathrm{reg}}$, no self-intersection) | `verification_outcome: "CERTIFIED_VALID"`<br>`failure_category: "NONE"` | `Category 1: CERTIFIED_REGULAR` | Maps 1:1 when `stationary_parameterization_status == "NONE_REGULAR_SPEED"`. |
| **Category 1 — Regularity Margin Violation** ($0 < \min_{t \in [0,1]} f(t) < \varepsilon_{\mathrm{reg}} = 0.05$, $Q(t) > 0$) | `verification_outcome: "CERTIFIED_INVALID"`<br>`failure_category: "REGULARITY_MARGIN_VIOLATION"` | **MISSING IN `contracts.py`** | **Must be added to `contracts.py` & `canonical_contracts.schema.json`.** Never classify a smooth curve with $0 < f(t) < \varepsilon_{\mathrm{reg}}$ as a cusp (`ADR-009 §4.4.1`). |
| **Category 2 — Actual Offset Singularity / Zero-Speed Cusp** | `verification_outcome: "CERTIFIED_INVALID"`<br>`failure_category: "ACTUAL_ZERO_SPEED_CUSP"`<br>`has_zero_speed_cusp_on_domain: true` | Split across:<br>- `Category 2a: ACTUAL_ZERO_SPEED_CUSP` ($Q(t^*)=0$ base cusp)<br>- `Category 2b: ACTUAL_CURVATURE_CUSP` ($Q(t^*)>0, f(t^*)=0, f'(t^*)\ne 0$)<br>- `Category 3: TANGENTIAL_CUSP_DEGENERACY` ($Q(t^*)>0, f(t^*)=0, f'(t^*)=0$ or circle collapse $d=R$) | In `ADR-009 §4.4.2`, Sub-case 2a ($Q(t^*)>0, f(t^*)=0$, including transversal evolute cusps, tangential grazing cusps $f(t^*)=f'(t^*)=0$, and complete circle collapse $d=R$) and Sub-case 2b ($Q(t^*)=0$ genuine base-curve singularity) both map to canonical `failure_category: "ACTUAL_ZERO_SPEED_CUSP"`, distinguished by `stationary_parameterization_status` and root multiplicity metadata. |
| **Category 3 — Tangent Reversal (Over-Offset Beyond Evolute)** ($Q(t) > 0, f(t) = 1 - s\,d\,\kappa(t) < 0$) | `verification_outcome: "CERTIFIED_INVALID"`<br>`failure_category: "TANGENT_REVERSAL"`<br>`has_zero_speed_cusp_on_domain: true | false` | **MISSING IN `contracts.py`** (Misclassified as `ACTUAL_CURVATURE_CUSP` in `AG-03` and `AG-06`) | **CRITICAL:** On CCW Circle Case 3 (`AG-03`, $s=+1, d=12>R=10$), $f(t) = -0.2 < 0$ everywhere and $\|\mathbf{O}'(t)\|_2 = 2 > 0$ everywhere (**no cusp exists**). Must be classified as `TANGENT_REVERSAL` with `has_zero_speed_cusp_on_domain: false`. When $f(t)$ crosses from $>0$ to $<0$ (`AG-06`), `detected_failure_categories` must record both `["ACTUAL_ZERO_SPEED_CUSP", "TANGENT_REVERSAL"]`. |
| **Category 4 — Local Offset Self-Intersection** ($\mathbf{O}(t_1) = \mathbf{O}(t_2)$ within a single segment/corner) | `verification_outcome: "CERTIFIED_INVALID"`<br>`failure_category: "LOCAL_OFFSET_SELF_INTERSECTION"` | **MISSING IN `contracts.py`** (Conflated with `SELF_INTERSECTING_NON_LOCAL` in `AG-08`) | Must be separated from `GLOBAL_CONTOUR_SELF_INTERSECTION` per `ADR-009 §4.4.4`. |
| **Category 5 — Global Contour Self-Intersection** ($\mathbf{O}_i(t_1) = \mathbf{O}_j(t_2)$ for non-adjacent segments $|i-j| > 1$) | `verification_outcome: "CERTIFIED_INVALID"`<br>`failure_category: "GLOBAL_CONTOUR_SELF_INTERSECTION"` | `Category 4: SELF_INTERSECTING_NON_LOCAL` | Corresponds to `ADR-009 §4.4.5` (`GLOBAL_CONTOUR_SELF_INTERSECTION`). |
| **Category 6 — Inconclusive Verification** (Interval straddles $0$ or $\varepsilon_{\mathrm{reg}}$ at max depth/precision) | `verification_outcome: "INCONCLUSIVE"`<br>`failure_category: "INCONCLUSIVE_VERIFICATION"` | **MISSING IN `contracts.py`** | Mandatory fail-closed outcome (`is_production_ready = False`) per `ADR-009 §4.4.6 & §5.2`. |
| **Base-Curve Stationary Point ($Q(t^*)=0$): Five-Way Distinction (`ADR-009 §4.3.2`)** | `stationary_parameterization_status`:<br>1. `STATIONARY_PARAMETERIZATION`<br>2. `REMOVABLE_PARAMETERIZATION_DEGENERACY`<br>3. `GENUINE_BASE_GEOMETRIC_SINGULARITY`<br>4. `ACTUAL_OFFSET_SINGULARITY`<br>5. `INCONCLUSIVE` | `REMOVABLE_PARAMETERIZATION_DEGENERACY` placed inside `OffsetClassificationCategory` (`AG-10`, `AG-11`) | In `ADR-009 §4.3.2` & `§5.3`, `REMOVABLE_PARAMETERIZATION_DEGENERACY` ($\mathbf{B}(t)=(t^3,0)$) is a `stationary_parameterization_status` whose offset is smooth and valid (`verification_outcome = "CERTIFIED_VALID"`, `failure_category = "NONE"`), **not** an offset failure category. |
| **Miter-Limit Violation (`AG-14`, $\theta < 25^\circ$, ratio $> 2.5$)** | Corner join transition rule (`SeamAllowanceSpec.joinStyle = "bevel"` when $1/\sin(\theta/2) > M_{\max}$) | Mapped to `CERTIFIED_REGULAR` after bevel clip (`AG-14`), or falsely labeled `"Category 5"` in Chat Report B | Miter-limit beveling is a corner-join construction policy (`ADR-003`), **not** one of the 6 canonical `ADR-009` offset classifications. |
| **Micro-Sliver Pruning & Polygon Topology (`M00.6`, area $< 10^{-4}\text{ cm}^2$)** | `TopologyVerificationReport.json` (`isSimple`, `isMicroSliver`, `actualWinding`) | Falsely labeled `"Category 6"` in Chat Report B | Planar polygon topology gate (`M00.6` / `M05.3`), **not** one of the 6 canonical `ADR-009` offset classifications. |

---

## 4. Task 7 — Independent Test Execution Log

All available Python and TypeScript test suites were executed in the current Linux container (`Linux-4.19.0-gvisor-x86_64-with-glibc2.36`, `Python 3.10.12`, `Node.js / tsx`, `PYTHONHASHSEED=0`):

1. **Python `M00` Verification Suite (`pytest`):**
   - **Command:** `PYTHONHASHSEED=0 /root/.local/bin/pytest services/geometry-engine/tests/test_m00_verification_suite.py -v`
   - **Versions:** `Python 3.10.12`, `pytest-9.2.0`, `pluggy-1.7.0`, `mpmath-1.4.1`, `python-flint-0.9.0`, `pydantic-2.14.3`, `jsonschema-4.26.0`
   - **Results:** `9 passed, 0 failed, 0 skipped` in `0.84s`.
   - **Auditor Note on Test Sufficiency:** Although all 9 `pytest` functions pass, `test_m00_4_four_circle_sanity_cases` (`test_m00_verification_suite.py:52`) explicitly asserts the misclassified category `ACTUAL_CURVATURE_CUSP` on `AG-03` ($d=12>R=10$), and `test_m00_4_all_17_adversarial_geometry_families` only checks `report["allPassed"] is True` (which passes on `AG-15`'s hardcoded literal dict).
2. **TypeScript `C0-Legacy` Geometry & Contour Validator Suite (`node:test` via `tsx`):**
   - **Command:** `npx --yes tsx --test src/engine/geometry/offset.test.ts src/engine/geometry/contour-validator.test.ts`
   - **Results:** `40 passed, 0 failed, 0 cancelled, 0 skipped` across `11 suites` in `570.36 ms`.
3. **Application Build & Type Check:**
   - **Commands:** `npm run build` (`compile_applet`) and `tsc --noEmit` (`lint_applet`)
   - **Results:** `0 errors`; Vite dev server on `http://localhost:3000` responds with `HTTP 200`.

---

## 5. Summary of Required Audit Remediation Actions Before `Gate Auth-2` Can Pass

To transition from **`NOT READY — MATERIAL TECHNICAL OR EVIDENCE FAILURES`** to **`READY FOR OWNER REVIEW`** at `Gate Auth-2`, the following concrete engineering corrections are required on `feat/m00-migration-preparation`:

1. **Align `packages/contracts` and `contracts.py` with `ADR-009` (`R2.1.2-R1 §2.5, §4.4, §5.3`):**
   - Add `NumericalVerificationRecord` (`§2.5`) and `OffsetValidationRecord` (`§5.3`) with canonical `verification_outcome` (`CERTIFIED_VALID | CERTIFIED_INVALID | INCONCLUSIVE`), `failure_category` (`NONE | REGULARITY_MARGIN_VIOLATION | ACTUAL_ZERO_SPEED_CUSP | TANGENT_REVERSAL | LOCAL_OFFSET_SELF_INTERSECTION | GLOBAL_CONTOUR_SELF_INTERSECTION | INCONCLUSIVE_VERIFICATION`), `detected_failure_categories`, `has_zero_speed_cusp_on_domain`, and `stationary_parameterization_status`.
2. **Remediate `c1_cert_oracle.py` (`FINDING-TAX-01` & `FINDING-ORACLE-01`):**
   - Reclassify `AG-02` ($d=R=10$) as `ACTUAL_ZERO_SPEED_CUSP` (`has_zero_speed_cusp_on_domain: true`) and `AG-03` ($d=12>R=10$) as `TANGENT_REVERSAL` (`has_zero_speed_cusp_on_domain: false`).
   - Update `AG-04` to test $s=-1, d=12\text{ cm} > R=10\text{ cm}$ with the concave sign gate $s\,d\,C(t) > 0$.
   - Replace hardcoded metrics and stubs (`AG-01`–`AG-05`, `AG-14`, `AG-15`, `AG-17`), remove `min(final_width, tol_t)` clamping in `refine_root_bracket_dual_criterion`, implement genuine Bernstein/interval subdivision over $t \in [0, 1]$ (`Method C3`) and `Method C1-Cert` adaptive De Casteljau chord/polygon enclosures, and cover all missing `ADR-009 §6` families (`#9`, `#10`, `#14`, `#16`, `#17`, and the non-collinear endpoint in `#6`/`AG-10`).
3. **Remediate `qualification.py` (`FINDING-QUAL-01`):**
   - Execute all 8 criteria of `ADR-009 §3.2`: cross-check `10,000` rational interval pairs (`+`, `-`, `*`, `/`) and `10,000` rational square roots against exact `fractions.Fraction` (not `mpmath.mpf` or `.overlaps()`), verify `1,000` Bernstein polynomial containment points/sub-intervals, test division-by-zero / negative-`sqrt` traps, record actual numeric enclosure widths in `IntervalLibraryQualificationReport.json`, and separate wall-clock benchmark timings from deterministic hash fields.
4. **Remediate `sub_oracles.py` (`FINDING-SUBORACLES-01`):**
   - Implement `Method C1-Cert` chord/polygon interval bounds and `Method B1` Bernstein derivative bounds in `M00.5`; add collinear/vertex-touch (`orient2d == 0`) handling in `M00.6`; test round-trip against the actual DXF R12 (`AC1009`) exporter in `M00.7`; and compute `DEC-11` paired seam deltas from drafted piece contours in `M00.8`.
