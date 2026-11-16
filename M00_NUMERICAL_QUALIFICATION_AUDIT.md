# PATRONER — `M00` NUMERICAL QUALIFICATION AUDIT (`CHECKPOINT 13A`)

- **Audit Checkpoint:** `13A` (Pre-`Gate Auth-2` Independent Audit)
- **Date:** 16 November 2026
- **Governing Specification:** `plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md` (`R2.1.2-R1 §2, §3.1, §3.2, §4, §5, §7.2`)
- **Audited Source Files:**
  - `services/geometry-engine/patroner_geometry/qualification.py`
  - `services/geometry-engine/patroner_geometry/c1_cert_oracle.py`
  - `services/geometry-engine/patroner_geometry/sub_oracles.py`
  - `artifacts/m00/IntervalLibraryQualificationReport.json` (`SHA-256: e34c60d1567149dd6fb89d83227b1291bc171a3b9cf8024b0bcaa69cae8e1c22`)
- **Audit Conclusion:** **`NOT QUALIFIED FOR DEC-13 STAGE 2 SIGN-OFF`** — Material gaps exist between `qualification.py` / `IntervalLibraryQualificationReport.json` and the mandatory 8-point qualification protocol in `ADR-009 §3.2`.

---

## 1. Resolution of Conflicting Reported Interval Enclosure Widths

During the `M00` submission turn, two mutually conflicting markdown tables appeared in the chat response (`Submitted Chat Report A` and `Submitted Chat Report B`), neither of which matched `artifacts/m00/IntervalLibraryQualificationReport.json`:

| Candidate Stack | `Submitted Chat Report A` Claimed Width | `Submitted Chat Report B` Claimed Width | Actual Value in `IntervalLibraryQualificationReport.json` | Independently Measured Width from `qualification.py` in `Python 3.10.12` |
| :--- | :--- | :--- | :--- | :--- |
| **1. `mpmath.iv` (`1.4.1`) + `fractions.Fraction`** | `width = 2.86e-16 > 0` | `width = 2.13e-16 > 0` | **No numeric width field present** (only `"outwardDirectedRoundingVerified": true`) | - At `iv.prec = 53`:<br>`width((1/3) + (1/7)) = 1.110223e-16` ($2^{-53}$)<br>`width(sqrt(2)) = 2.220446e-16` ($2^{-52}$)<br>- At `iv.prec = 113`:<br>`width((1/3) + (1/7)) = 9.629650e-35` ($2^{-113}$)<br>`width(sqrt(2)) = 1.925930e-34` ($2^{-112}$) |
| **2. `python-flint` (`0.9.0`, `arb` + `fmpq`)** | `width = 4.44e-16 > 0` | `width = 3.70e-16 > 0` | **No numeric width field present** (only `"outwardDirectedRoundingVerified": true`) | - `qualification.py:220` only sets `flint.ctx.prec = 113` (never runs `prec = 53`):<br>`rad((1/3)+(1/7)) = 7.222237e-35`, `diam = 1.444447e-34`<br>`diam(sqrt(2)) = 3.851860e-34`<br>- If run at `prec = 53`:<br>`diam((1/3)+(1/7)) = 1.665335e-16`<br>`diam(sqrt(2)) = 4.440892e-16` |
| **3. `fractions.Fraction` + `decimal.Decimal` (`prec=50`)** | `width = 2.00e-50 > 0` | `width = 2.00e-50 > 0` | **No numeric width field present** (only `"outwardDirectedRoundingVerified": true`) | - At `prec = 50`:<br>`width((1/3) + (1/7)) = 2.00e-50`<br>`width(sqrt(2)) = 1.00e-49` |

**Audit Root-Cause Finding (`FINDING-QUAL-02`):**
The width values `2.86e-16`, `2.13e-16`, and `3.70e-16` in the chat summaries were manually fabricated in prose and do not exist in `IntervalLibraryQualificationReport.json` (`lines 12–68`) or `qualification.py`.

---

## 2. Candidate-by-Candidate Code & Mathematical Audit

### 2.1 Candidate 1: `mpmath.iv` (`1.4.1`) + `fractions.Fraction` (`qualification.py:123–204`)
- **What Is Implemented & Verified:**
  - Tests `iv.prec = 53` and `iv.prec = 113` on one addition (`c = iv.mpf(1)/iv.mpf(3) + iv.mpf(1)/iv.mpf(7)`) and one square root (`s2 = iv.sqrt(iv.mpf(2))`).
  - Evaluates grazing polynomial `(2*t - 1)^2 * (1 + (t - 0.5)^2)` on `t_grazing = iv.mpf(["0.499999999999", "0.500000000001"])` and verifies `0 in val_grazing`.
  - Evaluates exact rational Bernstein conversion `power_to_bernstein_exact([1, -4, 4]) -> [1, -1, 1]` (`2` Descartes sign variations).
  - Evaluates Wilkinson quadratic `(0.5 - r1)*(0.5 - r2)` at `t = 0.5` for `r1 = 0.49999995, r2 = 0.50000005` and verifies `mid_val_iv.b < 0`.
  - Benchmarks 20 iterations of degree-12 exact rational `power_to_bernstein_exact`, `de_casteljau_subdivide_exact`, and `iv` monomial evaluation (`2.4142 ms` per curve).
- **Defects & Deficiencies vs. `ADR-009 §3.2`:**
  1. **Floating-Point Comparison Instead of Exact Rational Cross-Check (`qualification.py:137–150`):**
     Instead of converting the interval endpoints `c.a` and `c.b` to exact `fractions.Fraction` (`Fraction(c.a._mpf_[1] * 2**c.a._mpf_[2])` or `Fraction.from_float`) and comparing against `exact_10_21 = Fraction(10, 21)`, `qualification.py:135` computes `exact_10_21 = Fraction(10, 21)` **and never uses the variable `exact_10_21`!** Instead, lines 140–142 compare `lo_mpf` and `hi_mpf` against a `256`-bit floating-point approximation `exact_mp = mpmath.mpf(10) / mpmath.mpf(21)`, and line 149 checks `lo_s2 * lo_s2 <= mpmath.mpf(2) <= hi_s2 * hi_s2` in `256`-bit floating-point arithmetic (which rounds `lo_s2 * lo_s2` and `hi_s2 * hi_s2` to 256 bits rather than performing an exact rational square!).
  2. **Sample Size Deficit (`1` test case vs. `10,000` required by `ADR-009 §3.2 Criteria 3 & 4`):**
     Only 1 rational addition (`1/3 + 1/7`) and 1 square root (`sqrt(2)`) are tested; subtraction, multiplication, division across sign combinations, and 10,000 rational pairs are not tested.
  3. **Precision Tier Mismatch vs. `ADR-009 §3.2 Criterion 1` & `§5.2`:**
     `qualification.py:195` tests `precisionTiersBits = [53, 113]`, whereas `ADR-009 §2.5`, `§3.2`, and `§5.2` specify working precision `iv.dps = 50` (`170` bits) with escalation to `iv.dps = 100` (`336` bits).

### 2.2 Candidate 2: `python-flint` (`0.9.0`, `flint.arb` + `flint.fmpq`) (`qualification.py:207–264`)
- **What Is Implemented & Verified:**
  - Evaluates `a = flint.arb(1) / flint.arb(3)`, `b = flint.arb(1) / flint.arb(7)`, `c = a + b`, and `s2 = flint.arb(2).sqrt()` at `flint.ctx.prec = 113`.
  - Benchmarks 20 iterations of degree-12 polynomial evaluation (`0.0240 ms` per curve).
- **Defects & Deficiencies vs. `ADR-009 §3.2`:**
  1. **Weak `.overlaps()` Check Instead of Rigorous Containment (`qualification.py:226`):**
     Line 226 checks `c.overlaps(exact_target)` where `exact_target = flint.arb(10) / flint.arb(21)`. Overlapping of two intervals (`A ∩ B ≠ ∅`) does **not** prove outward directed rounding or that the exact rational $10/21 \in \mathbb{Q}$ is contained in `c`. Similarly, `(s2 * s2).contains(flint.arb(2))` squares the ball `s2` in `arb` (which widens the radius during multiplication) rather than verifying in exact rational arithmetic (`fmpq` or `Fraction`) that $(\mathrm{mid}(s_2) - \mathrm{rad}(s_2))^2 \le 2 \le (\mathrm{mid}(s_2) + \mathrm{rad}(s_2))^2$.
  2. **Untested `53-bit` Tier (`qualification.py:220, 255`):**
     Line 255 reports `"precisionTiersBits": [53, 113]`, but line 220 only sets `flint.ctx.prec = 113` and never tests `prec = 53`.

### 2.3 Candidate 3: Pure-Python `fractions.Fraction` + `decimal.Decimal` (`qualification.py:29–85, 267–329`)
- **What Is Implemented & Verified:**
  - Implements `DecimalInterval` with `ROUND_FLOOR` and `ROUND_CEILING` contexts at `prec = 50`.
  - Correctly verifies in exact `fractions.Fraction` (`lines 280–285`) that `Fraction(c.lo) <= Fraction(10, 21) <= Fraction(c.hi)` and `Fraction(s2.lo)**2 <= Fraction(2) <= Fraction(s2.hi)**2`.
- **Defects & Deficiencies:**
  1. **Missing `div` Method on `DecimalInterval` (`qualification.py:29–85`):**
     `DecimalInterval` implements `from_fraction`, `add`, `sub`, `mul`, and `sqrt`, but has **no general interval division (`div`) method** and no straddling-zero division check (`0 in denom`).
  2. **1-ULP Outward Padding on Exact Squares in `DecimalInterval.sqrt` (`qualification.py:83`):**
     In line 83 (`hi_out = ctx_ceil.next_plus(raw_hi) if raw_hi * raw_hi < self.hi or lo_out == raw_hi else raw_hi`), when taking `sqrt` of an exact square point interval such as `[4, 4]`, `lo_out == raw_hi == 2`, so `hi_out` is forced to `next_plus(2) = 2 + 10^{-49}` even though `2^2 == 4` is exact. While conservative (outward), this artificially inflates exact square intervals.

---

## 3. Audit Against `ADR-009 §3.2` Mandatory 8-Point Qualification Protocol

| # | `ADR-009 §3.2` Qualification Criterion | Required by `ADR-009 §3.2` | Actual Implementation in `qualification.py` | Audit Status |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Exact Library & Runtime Version Pin** | Python `3.12.x`, `mpmath` version pin, OS/CPU, `iv.prec = 170` bits (`50` dps) & `336` bits (`100` dps). | Python `3.10.12`, `mpmath == 1.4.1`, `iv.prec = 53, 113`. | **PARTIAL (`PREC/PY MISMATCH`)** |
| **2** | **Exact Input Conversion Verification** | Verify lossless `float64 -> iv.mpf` dyadic conversion (width `0`) and non-dyadic rational enclosure against `fractions.Fraction`. | Not explicitly tested for `float64` dyadic lossless conversion (`width == 0`). | **MISSING** |
| **3** | **Outward Rounding on `+`, `-`, `*`, `/` (`10,000` Pairs)** | Cross-check `10,000` rational interval pairs in `fractions.Fraction` against `mpmath.iv` across all 4 operations. | Tested **1** rational addition (`1/3 + 1/7`); compared `mpmath.iv` against `mpmath.mpf` (`256`-bit float) instead of `fractions.Fraction`. | **FAILED (`1/10,000` & FLOAT CHECK)** |
| **4** | **Outward Rounding on `sqrt` (`10,000` Rationals)** | Cross-check `10,000` positive rationals in `fractions.Fraction` ($\underline{s}^2 \le q \le \overline{s}^2$). | Tested **1** value (`sqrt(2)`); compared `mpmath.iv` in `256`-bit `mpmath.mpf` instead of `fractions.Fraction`. | **FAILED (`1/10,000` & FLOAT CHECK)** |
| **5** | **Polynomial & Bernstein Basis Containment (`1,000` Points/Sub-Intervals)** | Evaluate degree-5 and degree-9/12 Bernstein polynomials at `1,000` rational points $t_j$ and sub-intervals $I_j$, verifying $P_{\mathbb{Q}}(t_j) \in P_{\mathrm{iv}}(I_j)$. | Tested 1 quadratic `(1 - 2t)^2` and 1 interval `[0.25, 0.26]` in monomial power basis without checking $P_{\mathbb{Q}}(t_j) \in P_{\mathrm{iv}}(I_j)$. | **FAILED** |
| **6** | **Division-by-Zero & Straddling-Zero Containment** | Verify `0 in denom_iv` and `sqrt` of negative lower bound raise deterministic domain trap or `INCONCLUSIVE` flag. | Not tested for `mpmath.iv` or `python-flint`. | **MISSING** |
| **7** | **Deterministic Cross-Run Reproducibility (`PYTHONHASHSEED=0`)** | Bit-for-bit identical interval endpoints and deterministic report artifact across runs. | `IntervalLibraryQualificationReport.json` embeds live `time.perf_counter()` values (`perCurveBenchmarkLatencyMs`), changing its SHA-256 on every run. | **PARTIAL (`TIMING NON-DETERMINISM`)** |
| **8** | **Known Limitations & Safe-Usage Rules** | Document unverified software status, mandatory `fractions.Fraction` cross-check at $Q(t)=0$ / $P_{\mathrm{exact}}(t)=0$, and Bernstein basis requirement. | Omitted from `IntervalLibraryQualificationReport.json`. | **MISSING** |

---

## 4. Mathematical Assumptions, Supported Input Domain, Precision Escalation, Failure Behavior & Known Limitations

1. **Mathematical Assumptions:**
   - Base curves are planar polynomial cubic Bézier segments $\mathbf{B}(t) = \sum_{i=0}^3 \mathbf{P}_i B_i^3(t)$ on $t \in [0, 1]$ whose control point coordinates $(x_i, y_i)$ are finite IEEE 754 `float64` numbers (exact dyadic rationals in $\mathbb{Z}[1/2] \subset \mathbb{Q}$) or exact rationals in $\mathbb{Q}$.
   - Under exact rational conversion of `(x_i, y_i)`, the speed-squared polynomial $Q(t) = x'(t)^2 + y'(t)^2$ (degree 4), signed curvature numerator $C(t) = x'(t)y''(t) - y'(t)x''(t)$ (degree 2), and evolute cusp polynomial $P_{\mathrm{exact}}(t) = Q(t)^3 - d^2 C(t)^2$ (degree 12) have exact rational coefficients in both power and Bernstein bases.
2. **Supported Input Domain:**
   - Physical coordinates in centimeters (`cm`) within $[-10^4, +10^4]\text{ cm}$; seam allowance distances $d \in [0, 10]\text{ cm}$; regularity margin $\varepsilon_{\mathrm{reg}} \in (0, 0.5)$ (default `0.05`).
3. **Precision Escalation Ladder (`ADR-009 §5.2` — Required vs. Currently Implemented):**
   - *Required by `ADR-009 §5.2`:* Stage 1 `float64` diagnostic screen $\to$ Stage 2 `mpmath.iv` Bernstein subdivision at `50` dps (`170` bits) up to $k=16$ $\to$ Step 1 Escalation to `100` dps (`336` bits) up to $k=24$ $\to$ Step 2 Exact rational `fractions.Fraction` Sturm/Bernstein sign check $\to$ Step 3 Knot insertion $\to$ Step 4 Fail-closed `INCONCLUSIVE` hold.
   - *Currently Implemented in `c1_cert_oracle.py`:* Only scalar `113`-bit `mpmath.mpf` bisection/ternary search (`refine_root_bracket_dual_criterion`) and exact rational Taylor jet evaluation at pre-supplied $t^*$ (`classify_zero_speed_point_exact`). The 4-step escalation ladder and `INCONCLUSIVE` fail-closed state are **not yet implemented**.
4. **Known Limitations:**
   - `mpmath.iv` is a pure-Python software interval library, not a formally verified theorem prover (e.g. Coq/Flocq). Therefore, exact zero checks ($Q(t^*)=0$, $P_{\mathrm{exact}}(t^*)=0$ grazing tangency, and `orient2d == 0`) cannot be certified by floating-point interval width alone and **must** be cross-checked using `fractions.Fraction` exact rational arithmetic.
   - Evaluating degree-12 polynomials in monomial form (`sum(c_k * t_iv**k)` as done in `qualification.py:185`) suffers from the interval dependency (wrapping) effect; complete-interval certification on $[a, b] \subseteq [0, 1]$ must evaluate sub-interval polynomials in the **Bernstein basis** obtained via De Casteljau subdivision.
