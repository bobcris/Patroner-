# PATRONER — PKG-M00-04 CHECKPOINT J

## 63-Canonical-Contour Performance Investigation and Remediation Report (Finding I-04)

- **Authority:** Existing `PKG-M00-04` implementation authorization (controlled technical investigation and in-scope remediation)
- **Primary Finding Addressed:** `I-04` — Canonical 63-garment-contour Stage 2 offset verification benchmark previously exceeded the `5.0 ms` P95 target across all three interval candidates (`python-flint: 6.78 ms`, `DecimalInterval: 14.18 ms`, `mpmath.iv: 47.16 ms`).
- **Governance State Preserved Unchanged:**
  - `M00`: **NOT ACCEPTED**
  - `Gate Auth-2`, `Gate Auth-3`, `Gate Auth-4`: **CLOSED**
  - `DEC-13 Stage 2`: **CLOSED**
  - `AC-09` physical validation: **PENDING**
  - `M01` / `M02` / `M03` production implementation: **NOT STARTED**
  - `P1-3` (legacy TypeScript skirt grading): **NOT AUTHORIZED**
  - `isProductionReady`: `false`
  - `externalCadInteroperabilityVerified`: `false`
  - Trouser block: **`BLOCKED_MISSING_TROUSER_BLOCK`** (not implemented; zero synthetic trouser contours fabricated)
  - `I-08` governance conflicts (`CONFLICT-D1`–`CONFLICT-D10`): **OPEN** for Project Owner adjudication

---

## 1. Normative Classification of the 5.0 ms P95 Threshold (`ADR-009`)

Inspection of the authoritative specifications (`plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md`, `plan/workloads/M00_MIGRATION_PREPARATION.md`, `plan/06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`, `plan/07_RISK_AND_OPEN_DECISIONS_REGISTER.md`, and `plan/04_MIGRATION_AND_PARITY_POLICY.md`) establishes the exact legal/normative status of `< 5 ms`:

- **Classification:** **Category 2 — Production-Adoption Performance Target & Architectural Decision Trigger** for `DEC-13 Stage 2` at `Gate Auth-2` (NOT a mandatory M00 library-qualification hard failure gate, and NOT a requirement that all three candidates simultaneously pass `< 5 ms`).
- **Authoritative Citations:**
  1. **`ADR-009 §7.2` (Decision 4, lines 152 & 475, verbatim):**
     > *"Reviews the completed `IntervalLibraryQualificationReport` (Decision 2), the 17-family oracle verification results (Decision 3), and the `< 5 ms` per-contour benchmark across the 63 canonical garment contours produced during `M00.4`/`M00.10` to approve production adoption in `M02a` and `M02f` (or select optional Rust/C++ `PyO3` acceleration if the pure-Python `mpmath.iv` Stage 2 verifier exceeds `5 ms` per contour)."*
  2. **`ADR-009 §3.2` (Interval Library Qualification Criteria):** Defines 8 mathematical, outward-rounding, precision-tier, root-isolation, and determinism requirements for `IntervalLibraryQualificationReport`. It does **not** include a `5 ms` pass/fail gate.
  3. **`plan/workloads/M00_MIGRATION_PREPARATION.md` (`M00.4` Step 1, line 50) & `plan/07_RISK_AND_OPEN_DECISIONS_REGISTER.md` (§1.1 Decision 2, line 27):** Specify a `<= 50 ms` per-curve / runtime budget target.
- **Consequence:** Exceeding `5 ms` in pure-Python `mpmath.iv` would not invalidate mathematical qualification; rather, it is the explicit `DEC-13 Stage 2` trigger to evaluate C/C++/Rust acceleration (`python-flint` / `PyO3`). Nevertheless, eliminating the root-cause algorithmic defect documented below brought **all three candidates** (`python-flint`, `DecimalInterval`, and pure-Python `mpmath.iv`) comfortably under `5.0 ms` P95 on both cold-start and steady-state runs.

---

## 2. Reproduced Pre-Optimization Baseline & Environment Profile

- **Runtime / Hardware Environment:**
  - OS / Kernel: `Linux-4.19.0-gvisor-x86_64-with-glibc2.36` (`8` vCPUs)
  - Python: `3.12.16` (`/tmp/patroner-m00-venv/bin/python`, `PYTHONHASHSEED=0`)
  - Interval Backends: `mpmath 1.4.1`, `python-flint 0.9.0`, Python stdlib `decimal` + `fractions.Fraction`
- **Canonical Corpus (`artifacts/m00/CanonicalGarmentContours63.json`):**
  - `63` garment contours (`48` bodice/sleeve contours + `15` skirt contours; `18` CCW exterior contours with outward sign `s = -1`, `45` CW exterior contours with outward sign `s = +1`)
  - `495` total segments, `129` cubic Bézier segments (`66` all-$C \ge 0$, `5` all-$C \le 0$, `58` mixed/inflection, `0` flat)
  - Max exact `Fraction` coefficient bit-length in power-basis $P_{\text{cusp}}(t)$: `667` bits
  - Offset parameters: $d = 1.5\text{ cm}$ (`Fraction(3, 2)`), regularity margin $\varepsilon_{\text{reg}} = 0.05$ (`Fraction(1, 20)`)

### Pre-Optimization Cold-Start Baseline (1st Run)

| Candidate | P50 (ms) | P90 (ms) | P95 (ms) | P99 (ms) | Max (ms) | Prep (ms) | Init (ms) | IA (ms) | Root Iso (ms) | Cert (ms) | Ser (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `python-flint` (`arb + fmpq`) | 5.4621 | 6.6936 | 7.1281 | 7.6910 | 7.6910 | 59.61 | 0.31 | 56.05 | 187.11 | 0.01 | 0.89 |
| `DecimalInterval` (`Fraction`) | 10.2606 | 12.5736 | 13.5662 | 16.1654 | 16.1654 | 59.61 | 0.32 | 99.18 | 398.42 | 0.01 | 0.96 |
| `mpmath.iv` (`Fraction`) | 33.7007 | 43.9696 | 47.1895 | 59.5099 | 59.5099 | 59.61 | 0.50 | 363.45 | 1466.86 | 0.02 | 1.42 |

### Pre-Optimization Steady-State Baseline (5 Measured Repetitions After 2 Warm-Ups)

| Candidate | P50 (ms) | P90 (ms) | **P95 (ms)** | P99 (ms) | Max (ms) | Pooled-315 P95 / Max (ms) | Root Iso Share | Peak Traced Mem |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `python-flint` | 5.5314 | 6.9295 | **7.2893** | 7.6239 | 7.6239 | 7.8454 / 14.3837 | 62.0% (`203.79 ms`) | 14.0 KiB |
| `DecimalInterval` | 9.8508 | 13.5161 | **14.2577** | 15.0619 | 15.0619 | 15.0922 / 27.1328 | 71.5% (`430.70 ms`) | 17.8 KiB |
| `mpmath.iv` | 32.6648 | 47.1721 | **51.0517** | 54.2716 | 54.2716 | 52.5736 / 72.8417 | 77.7% (`1586.78 ms`) | 24.9 KiB |

*(Individual repetition P95s before optimization: `python-flint`: `[8.0386, 7.8325, 8.2892, 7.2797, 7.3141]` ms; `DecimalInterval`: `[15.3503, 15.0922, 15.7563, 14.2464, 14.2380]` ms; `mpmath.iv`: `[54.4641, 52.8849, 52.0038, 48.6188, 51.1605]` ms.)*

---

## 3. Per-Contour Performance Data Across All 63 Canonical Contours (Post-Optimization Steady-State)

Measurement protocol: `1` cold-start pass + `1` warm-up pass + `5` measured steady-state repetitions (per-contour steady-state median end-to-end time across the 5 repetitions; zero cross-contour caching; full outward-rounded 113-bit Bernstein certification per contour).

### Category Summary

| Garment Category | Contours | Total Segments | Cubic Béziers | `python-flint` Mean / Max (ms) | `DecimalInterval` Mean / Max (ms) | `mpmath.iv` Mean / Max (ms) |
|---|---:|---:|---:|---:|---:|---:|
| Bodice & Sleeve (`bodice`) | 48 | 360 | 114 | 0.1851 / 0.2148 | 1.3228 / 1.4589 | 2.1169 / 2.3526 |
| Skirt (`skirt`) | 15 | 135 | 15 | 0.0780 / 0.1044 | 0.4665 / 0.6892 | 0.7451 / 1.0883 |
| Trouser (`trouser`) | 0 | 0 | 0 | `BLOCKED_MISSING_TROUSER_BLOCK` | `BLOCKED_MISSING_TROUSER_BLOCK` | `BLOCKED_MISSING_TROUSER_BLOCK` |
| **All 63 Contours** | **63** | **495** | **129** | **0.1762 P50 / 0.2044 P95** | **1.2849 P50 / 1.4278 P95** | **2.0361 P50 / 2.2859 P95** |

### Complete 63-Contour Table

| # | Contour ID | Category | Segs | Beziers | Sign `s` | `python-flint` (ms) | `DecimalInterval` (ms) | `mpmath.iv` (ms) | Outcome (All 3) | Max Depth |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | `BOD-F-WAIST-XS` | bodice | 9 | 2 | +1 | 0.1762 | 1.3016 | 2.2092 | `CERTIFIED_VALID` | 0 |
| 2 | `BOD-F-WAIST-S` | bodice | 9 | 2 | +1 | 0.1740 | 1.3023 | 2.1878 | `CERTIFIED_VALID` | 0 |
| 3 | `BOD-F-WAIST-M` | bodice | 9 | 2 | +1 | 0.1618 | 1.2710 | 2.0589 | `CERTIFIED_VALID` | 0 |
| 4 | `BOD-F-WAIST-L` | bodice | 9 | 2 | +1 | 0.1751 | 1.2579 | 2.0039 | `CERTIFIED_VALID` | 0 |
| 5 | `BOD-F-WAIST-XL` | bodice | 9 | 2 | +1 | 0.1920 | 1.3232 | 1.9596 | `CERTIFIED_VALID` | 0 |
| 6 | `BOD-F-WAIST-XXL` | bodice | 9 | 2 | +1 | 0.1955 | 1.3080 | 2.0298 | `CERTIFIED_VALID` | 0 |
| 7 | `BOD-F-SIDE-BUST-XS` | bodice | 9 | 2 | +1 | 0.1784 | 1.2297 | 2.0039 | `CERTIFIED_VALID` | 0 |
| 8 | `BOD-F-SIDE-BUST-S` | bodice | 9 | 2 | +1 | 0.1632 | 1.2145 | 1.9396 | `CERTIFIED_VALID` | 0 |
| 9 | `BOD-F-SIDE-BUST-M` | bodice | 9 | 2 | +1 | 0.1661 | 1.2722 | 1.9510 | `CERTIFIED_VALID` | 0 |
| 10 | `BOD-F-SIDE-BUST-L` | bodice | 9 | 2 | +1 | 0.1661 | 1.2808 | 2.0128 | `CERTIFIED_VALID` | 0 |
| 11 | `BOD-F-SIDE-BUST-XL` | bodice | 9 | 2 | +1 | 0.1883 | 1.2799 | 2.2696 | `CERTIFIED_VALID` | 0 |
| 12 | `BOD-F-SIDE-BUST-XXL` | bodice | 9 | 2 | +1 | 0.1810 | 1.2621 | 1.9287 | `CERTIFIED_VALID` | 0 |
| 13 | `BOD-F-FRENCH-XS` | bodice | 9 | 2 | +1 | 0.1716 | 1.3812 | 2.0260 | `CERTIFIED_VALID` | 0 |
| 14 | `BOD-F-FRENCH-S` | bodice | 9 | 2 | +1 | 0.1917 | 1.2751 | 1.9846 | `CERTIFIED_VALID` | 0 |
| 15 | `BOD-F-FRENCH-M` | bodice | 9 | 2 | +1 | 0.1736 | 1.3322 | 2.1563 | `CERTIFIED_VALID` | 0 |
| 16 | `BOD-F-FRENCH-L` | bodice | 9 | 2 | +1 | 0.1720 | 1.2822 | 2.0538 | `CERTIFIED_VALID` | 0 |
| 17 | `BOD-F-FRENCH-XL` | bodice | 9 | 2 | +1 | 0.1720 | 1.2849 | 1.9729 | `CERTIFIED_VALID` | 0 |
| 18 | `BOD-F-FRENCH-XXL` | bodice | 9 | 2 | +1 | 0.1743 | 1.2230 | 2.0330 | `CERTIFIED_VALID` | 0 |
| 19 | `BOD-B-CLASSIC-XS` | bodice | 9 | 2 | +1 | 0.1778 | 1.2437 | 2.0398 | `CERTIFIED_VALID` | 0 |
| 20 | `BOD-B-CLASSIC-S` | bodice | 9 | 2 | +1 | 0.1862 | 1.3539 | 2.1636 | `CERTIFIED_VALID` | 0 |
| 21 | `BOD-B-CLASSIC-M` | bodice | 9 | 2 | +1 | 0.1789 | 1.2457 | 2.0219 | `CERTIFIED_VALID` | 0 |
| 22 | `BOD-B-CLASSIC-L` | bodice | 9 | 2 | +1 | 0.1760 | 1.3078 | 1.9582 | `CERTIFIED_VALID` | 0 |
| 23 | `BOD-B-CLASSIC-XL` | bodice | 9 | 2 | +1 | 0.1691 | 1.2925 | 2.0163 | `CERTIFIED_VALID` | 0 |
| 24 | `BOD-B-CLASSIC-XXL` | bodice | 9 | 2 | +1 | 0.1669 | 1.3590 | 2.0861 | `CERTIFIED_VALID` | 0 |
| 25 | `BOD-B-FITTED-XS` | bodice | 9 | 2 | +1 | 0.1965 | 1.3042 | 2.2494 | `CERTIFIED_VALID` | 0 |
| 26 | `BOD-B-FITTED-S` | bodice | 9 | 2 | +1 | 0.1835 | 1.2714 | 2.0637 | `CERTIFIED_VALID` | 0 |
| 27 | `BOD-B-FITTED-M` | bodice | 9 | 2 | +1 | 0.1757 | 1.2770 | 2.0309 | `CERTIFIED_VALID` | 0 |
| 28 | `BOD-B-FITTED-L` | bodice | 9 | 2 | +1 | 0.1905 | 1.3000 | 2.0498 | `CERTIFIED_VALID` | 0 |
| 29 | `BOD-B-FITTED-XL` | bodice | 9 | 2 | +1 | 0.1743 | 1.2580 | 2.0361 | `CERTIFIED_VALID` | 0 |
| 30 | `BOD-B-FITTED-XXL` | bodice | 9 | 2 | +1 | 0.1965 | 1.3355 | 2.1732 | `CERTIFIED_VALID` | 0 |
| 31 | `SLV-CLASSIC-XS` | bodice | 5 | 3 | -1 | 0.1820 | 1.3876 | 2.2016 | `CERTIFIED_VALID` | 0 |
| 32 | `SLV-CLASSIC-S` | bodice | 5 | 3 | -1 | 0.1927 | 1.3808 | 2.2172 | `CERTIFIED_VALID` | 0 |
| 33 | `SLV-CLASSIC-M` | bodice | 5 | 3 | -1 | 0.2017 | 1.4247 | 2.3265 | `CERTIFIED_VALID` | 0 |
| 34 | `SLV-CLASSIC-L` | bodice | 5 | 3 | -1 | 0.2007 | 1.3685 | 2.2859 | `CERTIFIED_VALID` | 0 |
| 35 | `SLV-CLASSIC-XL` | bodice | 5 | 3 | -1 | 0.1928 | 1.3216 | 2.3526 | `CERTIFIED_VALID` | 0 |
| 36 | `SLV-CLASSIC-XXL` | bodice | 5 | 3 | -1 | 0.2004 | 1.4589 | 2.2188 | `CERTIFIED_VALID` | 0 |
| 37 | `SLV-TAILORED-XS` | bodice | 5 | 3 | -1 | 0.1947 | 1.4543 | 2.2669 | `CERTIFIED_VALID` | 0 |
| 38 | `SLV-TAILORED-S` | bodice | 5 | 3 | -1 | 0.2044 | 1.3574 | 2.3312 | `CERTIFIED_VALID` | 0 |
| 39 | `SLV-TAILORED-M` | bodice | 5 | 3 | -1 | 0.2148 | 1.3776 | 2.2296 | `CERTIFIED_VALID` | 0 |
| 40 | `SLV-TAILORED-L` | bodice | 5 | 3 | -1 | 0.2079 | 1.3907 | 2.2213 | `CERTIFIED_VALID` | 0 |
| 41 | `SLV-TAILORED-XL` | bodice | 5 | 3 | -1 | 0.1945 | 1.3633 | 2.2171 | `CERTIFIED_VALID` | 0 |
| 42 | `SLV-TAILORED-XXL` | bodice | 5 | 3 | -1 | 0.1901 | 1.3173 | 2.2180 | `CERTIFIED_VALID` | 0 |
| 43 | `SLV-FITTED-XS` | bodice | 5 | 3 | -1 | 0.1969 | 1.3497 | 2.1865 | `CERTIFIED_VALID` | 0 |
| 44 | `SLV-FITTED-S` | bodice | 5 | 3 | -1 | 0.2143 | 1.4195 | 2.1019 | `CERTIFIED_VALID` | 0 |
| 45 | `SLV-FITTED-M` | bodice | 5 | 3 | -1 | 0.1892 | 1.4278 | 2.1986 | `CERTIFIED_VALID` | 0 |
| 46 | `SLV-FITTED-L` | bodice | 5 | 3 | -1 | 0.1844 | 1.2934 | 2.1179 | `CERTIFIED_VALID` | 0 |
| 47 | `SLV-FITTED-XL` | bodice | 5 | 3 | -1 | 0.1865 | 1.4279 | 2.1205 | `CERTIFIED_VALID` | 0 |
| 48 | `SLV-FITTED-XXL` | bodice | 5 | 3 | -1 | 0.1941 | 1.3431 | 2.1283 | `CERTIFIED_VALID` | 0 |
| 49 | `SK-F-CLASSIC-XS` | skirt | 9 | 1 | +1 | 0.1021 | 0.6344 | 1.0314 | `CERTIFIED_VALID` | 0 |
| 50 | `SK-F-CLASSIC-S` | skirt | 9 | 1 | +1 | 0.0944 | 0.6152 | 1.0126 | `CERTIFIED_VALID` | 0 |
| 51 | `SK-F-CLASSIC-M` | skirt | 9 | 1 | +1 | 0.1020 | 0.6585 | 1.0077 | `CERTIFIED_VALID` | 0 |
| 52 | `SK-F-CLASSIC-L` | skirt | 9 | 1 | +1 | 0.0965 | 0.6663 | 0.9980 | `CERTIFIED_VALID` | 0 |
| 53 | `SK-F-CLASSIC-XL` | skirt | 9 | 1 | +1 | 0.0391 | 0.1003 | 0.2099 | `CERTIFIED_VALID` | 0 |
| 54 | `SK-F-CLASSIC-XXL` | skirt | 9 | 1 | +1 | 0.0334 | 0.0951 | 0.2013 | `CERTIFIED_VALID` | 0 |
| 55 | `SK-F-FITTED-XS` | skirt | 9 | 1 | +1 | 0.0980 | 0.6892 | 0.9609 | `CERTIFIED_VALID` | 0 |
| 56 | `SK-F-FITTED-M` | skirt | 9 | 1 | +1 | 0.1022 | 0.6596 | 1.0883 | `CERTIFIED_VALID` | 0 |
| 57 | `SK-F-FITTED-XL` | skirt | 9 | 1 | +1 | 0.0358 | 0.0958 | 0.2012 | `CERTIFIED_VALID` | 0 |
| 58 | `SK-B-CLASSIC-XS` | skirt | 9 | 1 | +1 | 0.0927 | 0.6284 | 0.9904 | `CERTIFIED_VALID` | 0 |
| 59 | `SK-B-CLASSIC-S` | skirt | 9 | 1 | +1 | 0.1006 | 0.6578 | 1.0606 | `CERTIFIED_VALID` | 0 |
| 60 | `SK-B-CLASSIC-M` | skirt | 9 | 1 | +1 | 0.1044 | 0.6737 | 1.0249 | `CERTIFIED_VALID` | 0 |
| 61 | `SK-B-CLASSIC-L` | skirt | 9 | 1 | +1 | 0.1001 | 0.6280 | 0.9891 | `CERTIFIED_VALID` | 0 |
| 62 | `SK-B-CLASSIC-XL` | skirt | 9 | 1 | +1 | 0.0354 | 0.0984 | 0.2033 | `CERTIFIED_VALID` | 0 |
| 63 | `SK-B-CLASSIC-XXL` | skirt | 9 | 1 | +1 | 0.0336 | 0.0963 | 0.1970 | `CERTIFIED_VALID` | 0 |

*(Note: The slowest outliers are sleeve contours with 3 cubic Béziers such as `SLV-CLASSIC-XL` at `2.3526 ms` in `mpmath.iv`, `SLV-CLASSIC-XXL` at `1.4589 ms` in `DecimalInterval`, and `SLV-TAILORED-M` at `0.2148 ms` in `python-flint`. Skirt contours XL/XXL have purely convex outward side curves certified in Step 2.2 at `~0.20 ms` in `mpmath.iv` / `~0.035 ms` in `python-flint`.)*

---

## 4. Root-Cause Bottleneck Analysis

Profiling the pre-optimization 63-contour benchmark uncovered **two coupled root causes** — one algorithmic/mathematical defect and one redundant-work hotspot:

1. **Monomial Power-Basis Horner Wrapping-Effect Blowup (Primary Cause — 62% to 78% of Total Latency + 100% False-Positive Cusp Rate):**
   - The pre-optimization `_evaluate_contour_cusp_panels_with_candidate` converted each cubic Bézier into a degree-12 monomial power polynomial $P_{\text{cusp}}(t) = Q(t)^3 - d^2 C(t)^2$ with up to `667`-bit rational coefficients and evaluated it via naive Horner's rule across 8 coarse panels (`width = 0.125`), bisecting every straddling panel.
   - This directly violated `ADR-009 §3.2(8)(b)` & `§5.1`, which specify **Bernstein-basis evaluation and De Casteljau subdivision** specifically to avoid monomial interval dependency blowup.
   - Because alternating-sign high-degree monomial coefficients cancel dramatically on $[0, 1]$, naive Horner inflated interval enclosures across zero on `594` panels (`mpmath.iv`/`DecimalInterval`) and `655` panels (`python-flint`), triggering **~15,000 wasted bisection evaluations** per pass and **falsely classifying all 63/63 regular garment contours as `CUSP_OR_BOUNDARY_DETECTED`**.
   - Independent exact rational verification and `c1_cert_oracle` proved that **all 129/129 cubic Béziers are strictly `CERTIFIED_VALID`** with $0$ roots of $Q(t)$ and $0$ roots of $P_{\text{cusp}}(t)$ on $[0, 1]$, and **all 129/129 satisfy $\min_k b_k(P_{\text{margin}}) > 0$ at depth 0** in the Bernstein basis!

2. **Redundant Coefficient Conversion & Context Allocation Inside Inner Loops (`60.4%` of `mpmath.iv` CPU Time):**
   - Inside `_eval_poly_horner_candidate_interval`, every single one of the `8,012`–`8,269` panel evaluations re-converted every 667-bit `Fraction` coefficient to an interval (`111,924` divisions and `231,860` `ctx_iv.convert` calls per pass) and re-instantiated `decimal.Context` objects per call.

---

## 5. Changes Made and Affected Files

All changes were strictly scoped to in-scope PKG-M00-04 geometry-engine remediation, tests, and evidence documentation (zero changes to `plan/`, ADRs, governance gates, or trouser block):

1. **`services/geometry-engine/patroner_geometry/qualification.py`:**
   - Added `DecimalInterval.sqr(ctx_floor, ctx_ceil)` preserving exact outward rounding and non-negative lower bound `[0, max(|lo|, |hi|)^2]` across zero-straddling intervals.
   - Added immutable precomputed mathematical Bernstein binomial multiplication and degree-elevation weight tables (`_W_BERN_4_4`, `_W_BERN_8_4`, `_W_BERN_ELEV_4_12`) and `_get_bernstein_candidate_tables(candidate_library, prec_bits)` (caches mathematical constants only; zero contour or geometry caching).
   - Implemented `certify_cubic_segment_bernstein_candidate(...)` executing the complete `ADR-009 §5.1` & `§5.2` Stage 2 Bernstein-basis tri-state offset verifier symmetrically across all three candidates (`mpmath_iv`, `python_flint`, `decimal_interval`):
     - Exact dyadic/outward-rounded input conversion directly into Bernstein $Q(t)$ (deg 4) and $C(t)$ (deg 2).
     - Step 2.1 base-speed certification ($Q(t) > 0$) with exact jet stationary-point classification (`ADR-009 §4.3`).
     - Step 2.2 convex sign gate ($s \cdot d \cdot C(t) \le 0 \implies f(t) \ge 1 > \varepsilon_{\text{reg}}$).
     - Step 2.3 direct Bernstein construction of degree-12 $P_{\text{exact}} = Q^3 - d^2 C^2$ and $P_{\text{margin}} = (1-\varepsilon_{\text{reg}})^2 Q^3 - d^2 C^2$ with adaptive De Casteljau midpoint subdivision (`max_depth=20`), precision escalation (`113 -> 170 -> 336` bits / `35 -> 52 -> 102` decimal digits), exact rational Sturm/Bernstein fallback (`ADR-009 §5.2 Step 2`), and fail-closed `INCONCLUSIVE`.
   - Added `_contour_outward_offset_sign(contour)` computing each contour's true outward seam-allowance sign (`s = -1` CCW, `s = +1` CW).
   - Upgraded `_evaluate_contour_cusp_panels_with_candidate` and `benchmark_63_canonical_garment_contours(..., repetitions=5, warmup_runs=1)` to record cold-start summary, steady-state 5-repetition summary, pooled 315-sample distribution, per-phase timing breakdowns, explicit `normativeThresholdClassification`, and per-contour records.
2. **`services/geometry-engine/tests/test_checkpoint_j_performance_and_equivalence.py`:**
   - Added 15 new Checkpoint J unit, differential-equivalence, adversarial-curve, and 63-contour benchmark regression tests.
3. **`docs/evidence/pkg_m00_04/CHECKPOINT_J_PERFORMANCE_REPORT.md`:**
   - This Checkpoint J evidence report (hashed automatically in `M00_ARTIFACT_HASH_VERIFICATION.json`).
4. **Regenerated Runtime Observation & Evidence Artifacts (via `scripts/m00_execute_all.py`):**
   - `artifacts/m00/IntervalCandidateBenchmarks.json`, `artifacts/m00/RuntimeBenchmarkObservation.json`, and deterministic manifests updated consistently.

---

## 6. Mathematical Equivalence & Differential Correctness Evidence

Zero approximations, zero heuristics, and zero cross-contour caches were introduced. Equivalence was independently verified via:

1. **Exact Algebraic Identity Verification:** Direct Bernstein construction of $Q^3 - d^2 C^2$ matched `power_to_bernstein_exact(_cubic_segment_to_exact_p_cusp_and_q_c(...))` with **0 mismatches across all 129/129 canonical cubic Béziers**.
2. **Full 63-Contour Differential Check vs Independent `c1_cert_oracle`:**
   - Tested all **129 cubic Béziers × 2 offset signs (`s = -1` and `s = +1`) × 3 candidates = 774 differential checks** against `c1_cert_oracle.certify_cubic_offset_on_unit_interval`.
   - Result: **774/774 exact matches (`0` mismatches)**; all `129/129` outward-offset Béziers certified `CERTIFIED_VALID` / `NONE` at **depth 0** (`23/129` via Step 2.2 convex sign gate, `106/129` via full degree-12 Bernstein $P_{\text{margin}} > 0$).
3. **Adversarial & Pathological Curve Differential Suite vs `c1_cert_oracle` (11 Curves × 3 Candidates + Fail-Closed `INCONCLUSIVE`):**
   - Exact interior evolute cusp ($f(0.5) = 0$): `CERTIFIED_INVALID` / `ACTUAL_ZERO_SPEED_CUSP` (3/3 candidates match oracle)
   - Swallowtail tangent reversal ($f(0.5) < 0$): `CERTIFIED_INVALID` / `TANGENT_REVERSAL` (3/3 match)
   - Regularity margin violation ($0 < \min f(t) = 1/30 < 0.05$): `CERTIFIED_INVALID` / `REGULARITY_MARGIN_VIOLATION` (3/3 match)
   - Convex mirror with identical $|\kappa|$: `CERTIFIED_VALID` / `NONE` (3/3 match)
   - S-inflection valid (`11a`): `CERTIFIED_VALID` / `NONE` (3/3 match)
   - S-inflection reversal (`11b`): `CERTIFIED_INVALID` / `TANGENT_REVERSAL` (3/3 match)
   - Endpoint removable parameterization degeneracy $(10t^3, 0)$: `CERTIFIED_VALID` / `NONE` (3/3 match)
   - Interior removable parameterization degeneracy $((t-1/2)^3, 0)$: `CERTIFIED_VALID` / `NONE` (3/3 match)
   - Genuine base-curve cusp $((2t-1)^2, (2t-1)^3)$: `CERTIFIED_INVALID` / `ACTUAL_ZERO_SPEED_CUSP` (3/3 match)
   - Endpoint infinite curvature $\mathbf{P}_0=\mathbf{P}_1=(0,0)$: `CERTIFIED_INVALID` / `ACTUAL_ZERO_SPEED_CUSP` (3/3 match)
   - Non-dyadic $t^* = 1/3$ base-curve cusp $((3t-1)^2, (3t-1)^3)$: `CERTIFIED_INVALID` / `ACTUAL_ZERO_SPEED_CUSP` (3/3 match)
   - Artificially depth-capped (`max_depth=1, allow_exact_rational_fallback=False`) evolute cusp: **`INCONCLUSIVE`** (3/3 fail-closed)
4. **`DecimalInterval.sqr` Outward-Rounding Verification:** Verified exact `[0, max(|lo|, |hi|)^2]` enclosure across zero-straddling intervals and exact rational containment for non-terminating fractions (`1/3`, `-2/7`, `17/19`, `-11/13`).

---

## 7. Before / After Performance Comparison (63 Canonical Contours)

### Steady-State P95, Distribution, and Speedup (5 Measured Repetitions)

| Candidate | Before P95 (ms) | After P95 (ms) | Speedup | After Cold-Start P95 (ms) | After Pooled-315 P95 (ms) | After Steady Max (ms) | `< 5.0 ms` Target |
|---|---:|---:|---:|---:|---:|---:|:---:|
| **`python-flint`** | 7.2893 | **0.2044** | **35.7×** | 0.4402 | 0.2565 | 0.2148 | **PASS** (24.5× headroom) |
| **`DecimalInterval`** | 14.2577 | **1.4278** | **10.0×** | 2.5682 | 1.7209 | 1.4589 | **PASS** (3.5× headroom) |
| **`mpmath.iv`** | 51.0517 | **2.2859** | **22.3×** | 3.6600 | 2.8221 | 2.3526 | **PASS** (2.2× headroom) |

### Phase Breakdown (Total Across 63 Contours, Steady-State Median Pass) & Peak Memory

| Candidate | Prep (ms) | Init (ms) | Interval Arith (ms) | Root Iso (ms) | Cert (ms) | Ser (ms) | Peak Traced Mem (63-Pass) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `python-flint` | 0.6268 | 0.1585 | 9.3495 | 0.0000 | 0.0861 | 0.5825 | 8.06 KiB |
| `DecimalInterval` | 0.6268 | 0.0500 | 74.5154 | 0.0000 | 0.1044 | 0.6443 | 25.09 KiB |
| `mpmath.iv` | 0.6268 | 0.2826 | 117.1252 | 0.0000 | 0.1124 | 0.6736 | 18.68 KiB |

*(False-positive cusp detections dropped from **63/63** pre-optimization to **0/63** post-optimization; all 63 contours now certify as `CERTIFIED_VALID` matching exact rational ground truth.)*

---

## 8. Full Regression & Verification Suite Coverage

Executed after all Checkpoint J code and documentation edits (recorded in authoritative artifacts and CI verification scripts):
- Python verification & adversarial test suite (`pytest -v services/geometry-engine/tests`): **70 tests** (55 existing M00/PKG-M00-03/PKG-M00-04 tests + 15 new Checkpoint J tests).
- TypeScript test suite (`npm test`): **892 tests**.
- Static TypeScript type-check (`npx tsc --noEmit`), Vite production build (`compile_applet`), and lint (`lint_applet`).
- AST oracle-independence & ADR-001 TypeScript boundary audit (`scripts/check_oracle_independence.py`): 0 violations.
- Full M00 execution (`scripts/m00_execute_all.py`), 2-subprocess OS-isolated bit-exact determinism replay (`scripts/verify_m00_reproducibility.py`), and manifest/hash/anti-leak verification (`scripts/verify_m00_manifest.py`).
- All 17 adversarial geometry families (`AG-01`..`AG-17`), ADR-009 §6 18/18 coverage, Schema/Pydantic parity, and production DXF/DEC-11 seam parity checks.

---

## 9. Remaining Limitations (Explicitly Preserved)

1. **`BLOCKED_MISSING_TROUSER_BLOCK`:** The canonical contour corpus contains 63 real bodice/sleeve (`48`) and skirt (`15`) contours from `src/engine/drafting/bodice-block.ts` and `skirt-block.ts`. The trouser block module is not implemented in this repository; zero synthetic trouser contours were fabricated, and this gap remains explicitly disclosed in `CanonicalGarmentContours63.json` and `IntervalCandidateBenchmarks.json`.
2. **Open Governance Conflicts (`I-08`, `CONFLICT-D1`–`CONFLICT-D10`):** Documented in `docs/evidence/pkg_m00_04/I08_GOVERNANCE_ADJUDICATION_DOSSIER.md`; none have been decided, waived, or rewritten here and all require formal Project Owner adjudication.
3. **Closed Gates & Pending Physical Validation:** `Gate Auth-2`, `Gate Auth-3`, `Gate Auth-4`, `DEC-13 Stage 2`, and `AC-09` physical validation remain **CLOSED / PENDING**; `isProductionReady: false` and `externalCadInteroperabilityVerified: false` remain strictly preserved.
4. **Hardware / Runtime Observation Caveat:** Wall-clock timings are environment-dependent observations isolated strictly in `artifacts/m00/IntervalCandidateBenchmarks.json` and `artifacts/m00/RuntimeBenchmarkObservation.json` (excluded from deterministic SHA-256 manifests).

---

## 10. Updated M00 Acceptance Recommendation

- **Technical Finding `I-04` Status:** **RESOLVED.** All three interval library candidates now satisfy the `ADR-009 §7.2` `< 5.0 ms` P95 target on the 63 canonical garment contours — both cold-start (`0.44 ms` / `2.57 ms` / `3.66 ms`) and steady-state (`0.20 ms` / `1.43 ms` / `2.29 ms`) — with `0` false cusp detections, `100%` differential equivalence against `c1_cert_oracle`, and full preservation of outward-rounded interval rigor. Because pure-Python `mpmath.iv` now achieves `2.29 ms` P95 (`2.35 ms` max), `ADR-009 §7.2`'s optional Rust/C++ `PyO3` acceleration trigger is **not** forced on this corpus, while `python-flint` (`0.20 ms` P95) remains available as a qualified 11× faster C-backed option for `DEC-13 Stage 2` selection.
- **Formal M00 Acceptance Recommendation:** **DO NOT ACCEPT YET — KEEP `M00 = NOT ACCEPTED` AND `Gate Auth-2 = CLOSED` PENDING OWNER ADJUDICATION OF `I-08`.** All technical M00 engineering blockers (`I-01` through `I-07`, including `I-04`) are now resolved and independently verified; formal M00 acceptance and opening `Gate Auth-2` / `DEC-13 Stage 2` remain contingent solely on Project Owner adjudication of the `I-08` governance conflicts (`CONFLICT-D1`–`CONFLICT-D10`) and explicit Owner disposition of `BLOCKED_MISSING_TROUSER_BLOCK`.
