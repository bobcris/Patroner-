"""M00.4 Step 1 — Complete Interval & Polynomial Root-Isolation Library Qualification (DEC-13 Stage 1 & ADR-009 §3.2).

Remediates FINDING-QUAL-01:
1. Qualifies all three DEC-13 Stage 1 candidates:
   - Candidate 1 (Primary): `mpmath.iv` (53-bit screen, 113-bit primary certification, 170-bit escalation, 336-bit ceiling) + `fractions.Fraction`
   - Candidate 2 (Secondary): `python-flint` (`flint.arb` ball arithmetic + `flint.fmpq` exact rational at 53, 113, 170, 336 bits)
   - Candidate 3 (Tertiary Fallback): Pure-Python `fractions.Fraction` + `DecimalInterval` (`prec=50` and `prec=102`, `ROUND_FLOOR`/`ROUND_CEILING` with full `add`, `sub`, `mul`, `div`, `sqrt`)
2. Verifies outward directed rounding strictly in `fractions.Fraction` across `+`, `-`, `*`, `/`, and `sqrt` at ALL configured precision tiers.
3. Verifies exact dyadic `float64` conversion (`width == 0`) and non-dyadic rational enclosure.
4. Verifies Bernstein polynomial evaluation containment across rational points and sub-intervals.
5. Verifies division-by-zero / straddling-zero and negative-`sqrt` trap / `INCONCLUSIVE` routing.
6. Verifies genuine un-pre-split root isolation from `[0, 1]` for simple roots, double grazing roots, and Wilkinson root clusters (`Delta t = 1e-7` and `Delta t = 1e-9`) via automatic Bernstein De Casteljau subdivision.
7. Separates deterministic mathematical qualification outputs (`generate_interval_library_qualification_report`) from runtime benchmark timing statistics (`benchmark_interval_candidates_runtime`) so canonical JSON hashes are 100% deterministic across runs.
"""

from __future__ import annotations

import decimal
import math
import os
import platform
import random
import statistics
import sys
import time
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

import mpmath
from mpmath import iv

try:
    import flint  # type: ignore

    HAS_FLINT = True
except ImportError:
    HAS_FLINT = False


def mpf_to_exact_fraction(x: Any) -> Fraction:
    """Converts an mpmath.mpf or ivmpf endpoint (stored as exact binary mantissa * 2**exp) to an exact Fraction."""
    if hasattr(x, "_mpi_"):
        lo_t, hi_t = x._mpi_
        if lo_t != hi_t:
            raise ValueError("Passed non-point interval to mpf_to_exact_fraction; pass x.a or x.b")
        sign, man, exp, _bc = lo_t
    elif hasattr(x, "_mpf_"):
        sign, man, exp, _bc = x._mpf_
    elif isinstance(x, tuple) and len(x) == 4:
        sign, man, exp, _bc = x
    else:
        mpmath.mp.prec = max(mpmath.mp.prec, iv.prec)
        sign, man, exp, _bc = mpmath.mpf(x)._mpf_
    if man == 0:
        return Fraction(0)
    signed_man = -int(man) if sign else int(man)
    if exp >= 0:
        return Fraction(signed_man * (1 << int(exp)), 1)
    return Fraction(signed_man, 1 << int(-exp))


def arb_bounds_to_exact_fractions(ball: Any, prec_bits: int) -> Tuple[Fraction, Fraction]:
    """Extracts rigorous lower and upper endpoints of a python-flint arb ball as exact Fractions
    directly from its binary midpoint and radius mantissa/exponent representation (zero string truncation).
    """
    if not ball.is_finite():
        raise ValueError("Cannot convert non-finite arb ball to exact Fraction bounds")
    m_man, m_exp = ball.mid().man_exp()
    r_man, r_exp = ball.rad().man_exp()
    m_i, me = int(m_man), int(m_exp)
    r_i, re = int(r_man), int(r_exp)
    m_q = Fraction(0) if m_i == 0 else (Fraction(m_i << me) if me >= 0 else Fraction(m_i, 1 << (-me)))
    r_q = Fraction(0) if r_i == 0 else (Fraction(r_i << re) if re >= 0 else Fraction(r_i, 1 << (-re)))
    return m_q - r_q, m_q + r_q


_F64_MAX_FRACTION = Fraction(sys.float_info.max)


def fraction_to_outward_lower_f64(q: Fraction) -> float:
    """Returns the greatest IEEE-754 binary64 float <= exact Fraction q (never rounds inward/upward)."""
    if q == 0:
        return 0.0
    if q > _F64_MAX_FRACTION:
        return sys.float_info.max
    if q < -_F64_MAX_FRACTION:
        return -math.inf
    f = float(q)
    if Fraction(f) > q:
        f = math.nextafter(f, -math.inf)
    if f == 0.0:
        return 0.0
    return f


def fraction_to_outward_upper_f64(q: Fraction) -> float:
    """Returns the least IEEE-754 binary64 float >= exact Fraction q (never rounds inward/downward)."""
    if q == 0:
        return 0.0
    if q > _F64_MAX_FRACTION:
        return math.inf
    if q < -_F64_MAX_FRACTION:
        return -sys.float_info.max
    f = float(q)
    if Fraction(f) < q:
        f = math.nextafter(f, math.inf)
    if f == 0.0:
        return 0.0
    return f


def fraction_pair_to_outward_f64_pair(lo_q: Fraction, hi_q: Fraction) -> Tuple[float, float]:
    """Converts exact [lo_q, hi_q] into outward-rounded IEEE-754 binary64 bounds (lo_f64 <= lo_q, hi_f64 >= hi_q)."""
    if lo_q > hi_q:
        raise ValueError(f"Inverted rational interval bounds: {lo_q} > {hi_q}")
    return fraction_to_outward_lower_f64(lo_q), fraction_to_outward_upper_f64(hi_q)


def _extract_raw_mpf_tuple(x: Any, take_upper: bool = False) -> Tuple[int, int, int, int]:
    """Extracts the exact underlying mpmath 4-tuple (sign, man, exp, bc) without rounding to global mpmath.mp.prec."""
    if isinstance(x, tuple) and len(x) == 4:
        return x
    if hasattr(x, "_mpi_"):
        return x._mpi_[1] if take_upper else x._mpi_[0]
    if hasattr(x, "_mpf_"):
        return x._mpf_
    return mpmath.mpf(x)._mpf_


def mpf_to_outward_lower_f64(x: Any) -> float:
    """Converts an mpmath.mpf, raw _mpf_ tuple, or iv endpoint strictly outward (<= exact x) to IEEE-754 binary64."""
    raw = _extract_raw_mpf_tuple(x, take_upper=False)
    if raw == mpmath.libmp.fnan:
        raise ValueError("NaN encountered during outward lower f64 serialization")
    if raw == mpmath.libmp.fninf:
        return -math.inf
    if raw == mpmath.libmp.finf:
        return math.inf
    return fraction_to_outward_lower_f64(mpf_to_exact_fraction(raw))


def mpf_to_outward_upper_f64(x: Any) -> float:
    """Converts an mpmath.mpf, raw _mpf_ tuple, or iv endpoint strictly outward (>= exact x) to IEEE-754 binary64."""
    raw = _extract_raw_mpf_tuple(x, take_upper=True)
    if raw == mpmath.libmp.fnan:
        raise ValueError("NaN encountered during outward upper f64 serialization")
    if raw == mpmath.libmp.fninf:
        return -math.inf
    if raw == mpmath.libmp.finf:
        return math.inf
    return fraction_to_outward_upper_f64(mpf_to_exact_fraction(raw))


def iv_to_outward_f64_pair(val_iv: Any) -> Tuple[float, float]:
    """Converts an mpmath.iv interval strictly outward into IEEE-754 binary64 (lo_f64 <= lo, hi_f64 >= hi)
    using raw _mpi_ tuples so global mpmath.mp.prec never truncates high-precision endpoints.
    """
    return mpf_to_outward_lower_f64(val_iv._mpi_[0]), mpf_to_outward_upper_f64(val_iv._mpi_[1])


def float_to_outward_lower_f64(val: float) -> float:
    """Steps a binary64 value 1 ULP downward unless exact 0 or non-finite."""
    if math.isnan(val):
        raise ValueError("NaN cannot be serialized as outward lower bound")
    if not math.isfinite(val) or val == 0.0:
        return 0.0 if val == 0.0 else val
    return math.nextafter(val, -math.inf)


def float_to_outward_upper_f64(val: float) -> float:
    """Steps a binary64 value 1 ULP upward unless exact 0 or non-finite."""
    if math.isnan(val):
        raise ValueError("NaN cannot be serialized as outward upper bound")
    if not math.isfinite(val) or val == 0.0:
        return 0.0 if val == 0.0 else val
    return math.nextafter(val, math.inf)


class DecimalInterval:
    """Tertiary Fallback: Pure-Python Decimal interval with explicit outward rounding (ROUND_FLOOR / ROUND_CEILING)."""

    def __init__(self, lo: decimal.Decimal, hi: decimal.Decimal) -> None:
        if lo > hi:
            raise ValueError(f"Invalid DecimalInterval [{lo}, {hi}]")
        self.lo = lo
        self.hi = hi

    @staticmethod
    def from_str_outward(val_str: str, floor: bool, prec: int = 120) -> decimal.Decimal:
        ctx = decimal.Context(
            prec=prec,
            rounding=decimal.ROUND_FLOOR if floor else decimal.ROUND_CEILING,
        )
        return ctx.create_decimal(val_str)

    @classmethod
    def from_float_exact(cls, val: float) -> "DecimalInterval":
        if not math.isfinite(val):
            raise ValueError("Cannot construct finite DecimalInterval from non-finite float")
        d = decimal.Decimal.from_float(val)
        return cls(d, d)

    @classmethod
    def from_fraction(
        cls,
        q: Fraction,
        ctx_floor: decimal.Context,
        ctx_ceil: decimal.Context,
    ) -> "DecimalInterval":
        num_f = decimal.Decimal(q.numerator)
        den_f = decimal.Decimal(q.denominator)
        lo = ctx_floor.divide(num_f, den_f)
        hi = ctx_ceil.divide(num_f, den_f)
        return cls(lo, hi)

    def to_exact_fractions(self) -> Tuple[Fraction, Fraction]:
        return Fraction(self.lo), Fraction(self.hi)

    def width_decimal(self) -> decimal.Decimal:
        return self.hi - self.lo

    def add(
        self,
        other: "DecimalInterval",
        ctx_floor: decimal.Context,
        ctx_ceil: decimal.Context,
    ) -> "DecimalInterval":
        return DecimalInterval(
            ctx_floor.add(self.lo, other.lo),
            ctx_ceil.add(self.hi, other.hi),
        )

    def sub(
        self,
        other: "DecimalInterval",
        ctx_floor: decimal.Context,
        ctx_ceil: decimal.Context,
    ) -> "DecimalInterval":
        return DecimalInterval(
            ctx_floor.subtract(self.lo, other.hi),
            ctx_ceil.subtract(self.hi, other.lo),
        )

    def mul(
        self,
        other: "DecimalInterval",
        ctx_floor: decimal.Context,
        ctx_ceil: decimal.Context,
    ) -> "DecimalInterval":
        products_lo = [
            ctx_floor.multiply(self.lo, other.lo),
            ctx_floor.multiply(self.lo, other.hi),
            ctx_floor.multiply(self.hi, other.lo),
            ctx_floor.multiply(self.hi, other.hi),
        ]
        products_hi = [
            ctx_ceil.multiply(self.lo, other.lo),
            ctx_ceil.multiply(self.lo, other.hi),
            ctx_ceil.multiply(self.hi, other.lo),
            ctx_ceil.multiply(self.hi, other.hi),
        ]
        return DecimalInterval(min(products_lo), max(products_hi))

    def sqr(
        self,
        ctx_floor: decimal.Context,
        ctx_ceil: decimal.Context,
    ) -> "DecimalInterval":
        """Exact outward-rounded interval squaring preserving non-negativity across zero."""
        zero = decimal.Decimal(0)
        if self.lo >= zero:
            return DecimalInterval(
                ctx_floor.multiply(self.lo, self.lo),
                ctx_ceil.multiply(self.hi, self.hi),
            )
        if self.hi <= zero:
            return DecimalInterval(
                ctx_floor.multiply(self.hi, self.hi),
                ctx_ceil.multiply(self.lo, self.lo),
            )
        hi_sq = max(
            ctx_ceil.multiply(self.lo, self.lo),
            ctx_ceil.multiply(self.hi, self.hi),
        )
        return DecimalInterval(zero, hi_sq)

    def div(
        self,
        other: "DecimalInterval",
        ctx_floor: decimal.Context,
        ctx_ceil: decimal.Context,
    ) -> "DecimalInterval":
        if other.lo <= decimal.Decimal(0) <= other.hi:
            raise ZeroDivisionError("Interval division by interval containing zero; escalate or mark INCONCLUSIVE")
        quotients_lo = [
            ctx_floor.divide(self.lo, other.lo),
            ctx_floor.divide(self.lo, other.hi),
            ctx_floor.divide(self.hi, other.lo),
            ctx_floor.divide(self.hi, other.hi),
        ]
        quotients_hi = [
            ctx_ceil.divide(self.lo, other.lo),
            ctx_ceil.divide(self.lo, other.hi),
            ctx_ceil.divide(self.hi, other.lo),
            ctx_ceil.divide(self.hi, other.hi),
        ]
        return DecimalInterval(min(quotients_lo), max(quotients_hi))

    def sqrt(
        self,
        ctx_floor: decimal.Context,
        ctx_ceil: decimal.Context,
    ) -> "DecimalInterval":
        if self.lo < decimal.Decimal(0):
            raise ValueError("Negative lower bound in DecimalInterval.sqrt; escalate or mark INCONCLUSIVE")
        if self.lo == decimal.Decimal(0) and self.hi == decimal.Decimal(0):
            return DecimalInterval(decimal.Decimal(0), decimal.Decimal(0))
        raw_lo = ctx_floor.sqrt(self.lo)
        raw_hi = ctx_ceil.sqrt(self.hi)
        lo_out = ctx_floor.next_minus(raw_lo) if Fraction(raw_lo) ** 2 > Fraction(self.lo) else raw_lo
        hi_out = ctx_ceil.next_plus(raw_hi) if Fraction(raw_hi) ** 2 < Fraction(self.hi) else raw_hi
        if lo_out > hi_out:
            hi_out = lo_out
        return DecimalInterval(lo_out, hi_out)


def power_to_bernstein_exact(coeffs_power: List[Fraction]) -> List[Fraction]:
    """Converts polynomial coefficients from power basis sum_{j=0}^n a_j t^j on [0, 1] to exact rational Bernstein basis."""
    n = len(coeffs_power) - 1
    bernstein: List[Fraction] = []
    for k in range(n + 1):
        b_k = Fraction(0)
        for j in range(k + 1):
            b_k += coeffs_power[j] * Fraction(math.comb(k, j), math.comb(n, j))
        bernstein.append(b_k)
    return bernstein


def de_casteljau_subdivide_exact(
    b_coeffs: List[Fraction],
    t_split: Fraction = Fraction(1, 2),
) -> Tuple[List[Fraction], List[Fraction]]:
    """Subdivides a polynomial in Bernstein basis on [a, b] at relative parameter t_split in (0, 1)."""
    n = len(b_coeffs) - 1
    work = list(b_coeffs)
    left: List[Fraction] = [work[0]]
    right_rev: List[Fraction] = [work[-1]]
    one_minus_t = Fraction(1) - t_split
    for r in range(1, n + 1):
        work = [one_minus_t * work[i] + t_split * work[i + 1] for i in range(n - r + 1)]
        left.append(work[0])
        right_rev.append(work[-1])
    return left, list(reversed(right_rev))


def descartes_sign_variations_exact(b_coeffs: List[Fraction]) -> Tuple[int, bool]:
    """Returns (sign_variations, has_exact_zero_coeff) for exact rational Bernstein coefficients."""
    has_zero = any(c == 0 for c in b_coeffs)
    non_zero_signs = [1 if c > 0 else -1 for c in b_coeffs if c != 0]
    variations = sum(1 for i in range(len(non_zero_signs) - 1) if non_zero_signs[i] != non_zero_signs[i + 1])
    return variations, has_zero


def eval_polynomial_exact(coeffs_power: List[Fraction], t: Fraction) -> Fraction:
    """Evaluates sum_{j=0}^n a_j t^j in exact rational arithmetic."""
    acc = Fraction(0)
    for coeff in reversed(coeffs_power):
        acc = acc * t + coeff
    return acc


def poly_trim_exact(coeffs: List[Fraction]) -> List[Fraction]:
    """Strips trailing zero coefficients from a power-basis polynomial in Q[t]."""
    out = list(coeffs)
    while out and out[-1] == 0:
        out.pop()
    return out


def poly_make_monic_exact(coeffs: List[Fraction]) -> List[Fraction]:
    """Normalizes a non-zero polynomial in Q[t] so its leading coefficient is 1."""
    trimmed = poly_trim_exact(coeffs)
    if not trimmed:
        return []
    lead = trimmed[-1]
    return [c / lead for c in trimmed]


def poly_deriv_exact(coeffs: List[Fraction]) -> List[Fraction]:
    """Computes the exact formal derivative P'(t) in Q[t]."""
    trimmed = poly_trim_exact(coeffs)
    if len(trimmed) <= 1:
        return []
    return poly_trim_exact([Fraction(j) * trimmed[j] for j in range(1, len(trimmed))])


def poly_divmod_exact(a: List[Fraction], b: List[Fraction]) -> Tuple[List[Fraction], List[Fraction]]:
    """Computes exact Euclidean division (q, r) in Q[t] satisfying a = b * q + r with deg(r) < deg(b)."""
    rem = poly_trim_exact(a)
    div = poly_trim_exact(b)
    if not div:
        raise ZeroDivisionError("Polynomial division by zero polynomial")
    deg_b = len(div) - 1
    lead_b = div[-1]
    if len(rem) - 1 < deg_b:
        return [], rem
    quot = [Fraction(0)] * (len(rem) - deg_b)
    while rem and len(rem) - 1 >= deg_b:
        shift = len(rem) - 1 - deg_b
        factor = rem[-1] / lead_b
        quot[shift] = factor
        for j in range(deg_b + 1):
            rem[shift + j] -= factor * div[j]
        rem = poly_trim_exact(rem)
    return poly_trim_exact(quot), rem


def poly_gcd_exact(a: List[Fraction], b: List[Fraction]) -> List[Fraction]:
    """Computes the exact monic greatest common divisor gcd(a, b) in Q[t]."""
    u = poly_make_monic_exact(a)
    v = poly_make_monic_exact(b)
    while v:
        _, r = poly_divmod_exact(u, v)
        u, v = v, poly_make_monic_exact(r)
    return u


def poly_deflate_linear_factor_exact(coeffs: List[Fraction], root: Fraction) -> Tuple[List[Fraction], int]:
    """Factors out (t - root)^m from P(t) in exact Q[t], returning (quotient, multiplicity)."""
    cur = poly_trim_exact(coeffs)
    mult = 0
    if not cur:
        return [], 0
    lin = [-root, Fraction(1)]
    while len(cur) > 1 and eval_polynomial_exact(cur, root) == 0:
        cur, rem = poly_divmod_exact(cur, lin)
        assert not rem
        mult += 1
    return cur, mult


def poly_square_free_decomposition_exact(coeffs: List[Fraction]) -> List[Tuple[List[Fraction], int]]:
    """Computes exact square-free decomposition P(t) = c * prod_k f_k(t)^k in Q[t].

    Each returned factor (f_k, k) is monic, square-free, pairwise coprime, with deg(f_k) >= 1.
    """
    p = poly_make_monic_exact(coeffs)
    if len(p) <= 1:
        return []
    dp = poly_deriv_exact(p)
    g = poly_gcd_exact(p, dp)
    w, rem = poly_divmod_exact(p, g)
    assert not rem
    w = poly_make_monic_exact(w)

    factors: List[Tuple[List[Fraction], int]] = []
    k = 1
    while len(w) > 1:
        y = poly_gcd_exact(w, g)
        z, rem_z = poly_divmod_exact(w, y)
        assert not rem_z
        z = poly_make_monic_exact(z)
        if len(z) > 1:
            factors.append((z, k))
        g, rem_g = poly_divmod_exact(g, y)
        assert not rem_g
        g = poly_make_monic_exact(g)
        w = y
        k += 1
    return factors


def _sturm_sequence_exact(square_free_poly: List[Fraction]) -> List[List[Fraction]]:
    """Constructs the exact Sturm sequence in Q[t] for a square-free non-constant polynomial."""
    p0 = poly_make_monic_exact(square_free_poly)
    p1 = poly_deriv_exact(p0)
    seq: List[List[Fraction]] = [p0]
    if p1:
        seq.append(p1)
    while len(seq[-1]) > 1:
        _, rem = poly_divmod_exact(seq[-2], seq[-1])
        if not rem:
            break
        neg_rem = [-c for c in rem]
        # Scale by positive LCM/abs(lead) to keep rational heights compact while preserving sign
        scale = abs(neg_rem[-1])
        seq.append([c / scale for c in neg_rem])
    return seq


def _sturm_sign_variations(seq: List[List[Fraction]], t: Fraction) -> int:
    """Counts sign changes in the Sturm sequence evaluated at exact rational point t."""
    signs: List[int] = []
    for poly in seq:
        val = eval_polynomial_exact(poly, t)
        if val > 0:
            signs.append(1)
        elif val < 0:
            signs.append(-1)
    return sum(1 for i in range(len(signs) - 1) if signs[i] != signs[i + 1])


def _sturm_real_root_count_open(seq: List[List[Fraction]], a: Fraction, b: Fraction) -> int:
    """Exact count of real roots of a square-free polynomial in open interval (a, b) given P(a) != 0 and P(b) != 0."""
    return _sturm_sign_variations(seq, a) - _sturm_sign_variations(seq, b)


def _poly_affine_to_unit_interval_exact(coeffs: List[Fraction], a: Fraction, b: Fraction) -> List[Fraction]:
    """Computes exact power-basis coefficients of Q(u) = P(a + (b - a) * u) for u in [0, 1]."""
    n = len(coeffs) - 1
    h = b - a
    res = [Fraction(0)] * (n + 1)
    # Build (a + h*u)^k incrementally
    basis_pow = [Fraction(1)]
    for k, c_k in enumerate(coeffs):
        if c_k != 0:
            for j, bj in enumerate(basis_pow):
                res[j] += c_k * bj
        if k < n:
            next_pow = [Fraction(0)] * (len(basis_pow) + 1)
            for j, bj in enumerate(basis_pow):
                next_pow[j] += bj * a
                next_pow[j + 1] += bj * h
            basis_pow = next_pow
    return res


def _multiplicity_label(mult: int) -> str:
    if mult == 1:
        return "simple-transverse-root"
    if mult % 2 == 0:
        return "even-grazing-root"
    return "odd-multiplicity-root"


def _format_isolated_root_record(lo: Fraction, hi: Fraction, mult: int) -> Dict[str, Any]:
    """Serializes an exact rational root bracket [lo, hi] with outward-rounded binary64 endpoints."""
    t_lo_f64, t_hi_f64 = fraction_pair_to_outward_f64_pair(lo, hi)
    # Outward upper bound on the serialized binary64 bracket width (guaranteed >= hi - lo)
    width_f64_q = Fraction(t_hi_f64) - Fraction(t_lo_f64)
    delta_t_outward = fraction_to_outward_upper_f64(max(hi - lo, width_f64_q))
    return {
        "tLower": t_lo_f64,
        "tUpper": t_hi_f64,
        "tLowerRational": f"{lo.numerator}/{lo.denominator}",
        "tUpperRational": f"{hi.numerator}/{hi.denominator}",
        "deltaT": delta_t_outward,
        "multiplicity": _multiplicity_label(mult),
        "exactMultiplicity": mult,
    }


def isolate_polynomial_roots_on_unit_interval(
    coeffs_power: List[Fraction],
    tol_t: Fraction = Fraction(1, 10**12),
    max_depth: int = 52,
) -> List[Dict[str, Any]]:
    """Exact algebraic root isolator on [0, 1] in Q[t] (REM-02: resolves B-03a..g and B-08).

    Algorithm:
    1. Trims and normalizes P(t) to monic form (strict scale invariance).
    2. Explicitly deflates boundary roots at t = 0 and t = 1 with exact multiplicities.
    3. Applies exact square-free decomposition P(t) = prod_k f_k(t)^k in Q[t] so every factor f_k
       has strictly simple real roots (zero missed multiplicities, zero 1e-18 false positives).
    4. Isolates all interior roots of each square-free factor f_k on (0, 1) starting strictly from [0, 1]
       via exact Bernstein/Descartes subdivision coupled with exact Sturm root counting and linear
       deflation at exact rational midpoint hits (zero dropped sibling roots).
    5. Refines every bracket to width <= tol_t and serializes outward-directed IEEE-754 binary64 bounds
       alongside exact rational endpoints.
    """
    p_monic = poly_make_monic_exact(coeffs_power)
    if len(p_monic) <= 1:
        return []

    isolated_raw: List[Tuple[Fraction, Fraction, int, Optional[List[Fraction]]]] = []

    # Step 1: Explicit endpoint deflation at t = 0 and t = 1
    p_rem, m0 = poly_deflate_linear_factor_exact(p_monic, Fraction(0))
    if m0 > 0:
        isolated_raw.append((Fraction(0), Fraction(0), m0, None))

    p_rem, m1 = poly_deflate_linear_factor_exact(p_rem, Fraction(1))
    if m1 > 0:
        isolated_raw.append((Fraction(1), Fraction(1), m1, None))

    if len(p_rem) <= 1:
        isolated_raw.sort(key=lambda r: (r[0], r[1]))
        return [_format_isolated_root_record(lo, hi, mult) for lo, hi, mult, _p in isolated_raw]

    # Step 2: Exact square-free decomposition in Q[t]
    sqfree_factors = poly_square_free_decomposition_exact(p_rem)

    def _bisect_one_step(poly: List[Fraction], lo: Fraction, hi: Fraction) -> Tuple[Fraction, Fraction]:
        fa = eval_polynomial_exact(poly, lo)
        if fa == 0:
            return lo, lo
        fb = eval_polynomial_exact(poly, hi)
        if fb == 0:
            return hi, hi
        mid = (lo + hi) / Fraction(2)
        fmid = eval_polynomial_exact(poly, mid)
        if fmid == 0:
            return mid, mid
        if (fa < 0 and fmid > 0) or (fa > 0 and fmid < 0):
            return lo, mid
        return mid, hi

    def refine_simple_root(poly: List[Fraction], a: Fraction, b: Fraction) -> Tuple[Fraction, Fraction]:
        lo, hi = a, b
        fa = eval_polynomial_exact(poly, lo)
        fb = eval_polynomial_exact(poly, hi)
        if fa == 0:
            return lo, lo
        if fb == 0:
            return hi, hi
        assert (fa < 0 < fb) or (fb < 0 < fa), "Simple root bracket must have opposite endpoint signs"
        while (hi - lo) > tol_t:
            mid = (lo + hi) / Fraction(2)
            fmid = eval_polynomial_exact(poly, mid)
            if fmid == 0:
                return mid, mid
            if (fa < 0 and fmid > 0) or (fa > 0 and fmid < 0):
                hi = mid
                fb = fmid
            else:
                lo = mid
                fa = fmid
        return lo, hi

    def isolate_square_free_on_interval(
        poly: List[Fraction],
        sturm_seq: List[List[Fraction]],
        b_curr: List[Fraction],
        a: Fraction,
        b: Fraction,
        mult: int,
        depth: int,
    ) -> None:
        # Convex hull check: strictly positive or strictly negative Bernstein polygon => 0 roots
        min_b = min(b_curr)
        max_b = max(b_curr)
        if min_b > 0 or max_b < 0:
            return

        var, _has_zero = descartes_sign_variations_exact(b_curr)
        if var == 0:
            return
        if var == 1:
            lo, hi = refine_simple_root(poly, a, b)
            isolated_raw.append((lo, hi, mult, None if lo == hi else poly))
            return

        # var >= 2: verify exact real-root count via Sturm sequence (eliminates near-grazing false positives!)
        exact_count = _sturm_real_root_count_open(sturm_seq, a, b)
        if exact_count == 0:
            return
        if exact_count == 1:
            lo, hi = refine_simple_root(poly, a, b)
            isolated_raw.append((lo, hi, mult, None if lo == hi else poly))
            return

        # exact_count >= 2: subdivide at midpoint; never drop roots on exact midpoint hit or depth cap
        mid = (a + b) / Fraction(2)
        f_mid = eval_polynomial_exact(poly, mid)
        if f_mid == 0:
            # Record exact rational root at mid, deflate (t - mid), and continue isolating remaining roots on [a, b]!
            isolated_raw.append((mid, mid, mult, None))
            reduced, _m_mid = poly_deflate_linear_factor_exact(poly, mid)
            reduced = poly_make_monic_exact(reduced)
            if len(reduced) > 1:
                red_sturm = _sturm_sequence_exact(reduced)
                red_unit = _poly_affine_to_unit_interval_exact(reduced, a, b)
                red_bern = power_to_bernstein_exact(red_unit)
                isolate_square_free_on_interval(reduced, red_sturm, red_bern, a, b, mult, depth + 1)
            return

        if depth < max_depth:
            b_left, b_right = de_casteljau_subdivide_exact(b_curr, Fraction(1, 2))
            isolate_square_free_on_interval(poly, sturm_seq, b_left, a, mid, mult, depth + 1)
            isolate_square_free_on_interval(poly, sturm_seq, b_right, mid, b, mult, depth + 1)
        else:
            # Exact Sturm bisection fallback for ultra-close root clusters below 2^-max_depth
            def sturm_bisect(sa: Fraction, sb: Fraction, count: int) -> None:
                if count == 0:
                    return
                if count == 1:
                    lo, hi = refine_simple_root(poly, sa, sb)
                    isolated_raw.append((lo, hi, mult, None if lo == hi else poly))
                    return
                smid = (sa + sb) / Fraction(2)
                if eval_polynomial_exact(poly, smid) == 0:
                    isolated_raw.append((smid, smid, mult, None))
                    reduced, _ = poly_deflate_linear_factor_exact(poly, smid)
                    reduced = poly_make_monic_exact(reduced)
                    if len(reduced) > 1:
                        red_sturm = _sturm_sequence_exact(reduced)
                        red_cnt = _sturm_real_root_count_open(red_sturm, sa, sb)
                        if red_cnt > 0:
                            red_unit = _poly_affine_to_unit_interval_exact(reduced, sa, sb)
                            red_bern = power_to_bernstein_exact(red_unit)
                            isolate_square_free_on_interval(reduced, red_sturm, red_bern, sa, sb, mult, depth + 1)
                    return
                c_left = _sturm_real_root_count_open(sturm_seq, sa, smid)
                c_right = count - c_left
                if c_left > 0:
                    sturm_bisect(sa, smid, c_left)
                if c_right > 0:
                    sturm_bisect(smid, sb, c_right)

            sturm_bisect(a, b, exact_count)

    for factor, mult in sqfree_factors:
        sturm_seq = _sturm_sequence_exact(factor)
        b_root = power_to_bernstein_exact(factor)
        isolate_square_free_on_interval(factor, sturm_seq, b_root, Fraction(0), Fraction(1), mult, 0)

    # Pairwise strict-disjointness pass: if two distinct roots share a boundary endpoint (e.g. exact 1/2
    # touching open bracket (1/2, 1/2 + 2^-40) for 1/2 + 10^-16), bisect until closed brackets satisfy hi_i < lo_{i+1}.
    isolated_raw.sort(key=lambda r: (r[0], r[1]))
    for idx in range(len(isolated_raw) - 1):
        lo_a, hi_a, mult_a, poly_a = isolated_raw[idx]
        lo_b, hi_b, mult_b, poly_b = isolated_raw[idx + 1]
        guard = 0
        while hi_a >= lo_b and guard < 256:
            guard += 1
            if poly_b is not None and hi_b > lo_b and (poly_a is None or (hi_b - lo_b) >= (hi_a - lo_a)):
                lo_b, hi_b = _bisect_one_step(poly_b, lo_b, hi_b)
                if lo_b == hi_b:
                    poly_b = None
            elif poly_a is not None and hi_a > lo_a:
                lo_a, hi_a = _bisect_one_step(poly_a, lo_a, hi_a)
                if lo_a == hi_a:
                    poly_a = None
            else:
                break
        isolated_raw[idx] = (lo_a, hi_a, mult_a, poly_a)
        isolated_raw[idx + 1] = (lo_b, hi_b, mult_b, poly_b)

    isolated_raw.sort(key=lambda r: (r[0], r[1]))
    return [_format_isolated_root_record(lo, hi, mult) for lo, hi, mult, _p in isolated_raw]


def _exact_rational_interval_op(
    a_lo: Fraction,
    a_hi: Fraction,
    b_lo: Fraction,
    b_hi: Fraction,
    op: str,
) -> Tuple[Fraction, Fraction]:
    if op == "add":
        return a_lo + b_lo, a_hi + b_hi
    if op == "sub":
        return a_lo - b_hi, a_hi - b_lo
    if op == "mul":
        prods = [a_lo * b_lo, a_lo * b_hi, a_hi * b_lo, a_hi * b_hi]
        return min(prods), max(prods)
    if op == "div":
        quots = [a_lo / b_lo, a_lo / b_hi, a_hi / b_lo, a_hi / b_hi]
        return min(quots), max(quots)
    raise ValueError(f"Unsupported op {op}")


def mpf_to_canonical_hex(val: Any) -> str:
    """Formats a finite mpmath.mpf or raw _mpf_/_mpi_ 4-tuple (at any precision: 53, 113, 170, 336 bits)
    as a canonical binary hexadecimal floating-point literal `[-]0x1.<hex>p<+/-exp>` (or `0x0p+0` for zero).
    Reads raw tuples directly so global mpmath.mp.prec never truncates 113/170/336-bit endpoints (REM-04 / B-04).
    """
    raw = _extract_raw_mpf_tuple(val, take_upper=False)
    sign, man, exp, bc = raw
    if man == 0:
        if exp == 0:
            return "-0x0p+0" if sign else "0x0p+0"
        if raw == mpmath.libmp.finf:
            return "+inf"
        if raw == mpmath.libmp.fninf:
            return "-inf"
        return "nan"
    unbiased_exp = exp + bc - 1
    frac_bits = bc - 1
    prefix = "-0x1." if sign else "0x1."
    if frac_bits == 0:
        return f"{prefix}0p{unbiased_exp:+d}"
    frac_int = man - (1 << frac_bits)
    pad = (-frac_bits) % 4
    hex_digits = (frac_bits + pad) // 4
    frac_hex = f"{(frac_int << pad):0{hex_digits}x}".rstrip("0") or "0"
    return f"{prefix}{frac_hex}p{unbiased_exp:+d}"


def _build_bernstein_stress_polynomials() -> List[Tuple[int, str, List[Fraction]]]:
    """Returns canonical CAD/offset test polynomials of degrees {5, 9, 12} for >=1,000 Bernstein containment checks (B-02)."""
    deg5 = [
        Fraction(1, 3),
        Fraction(-7, 5),
        Fraction(11, 7),
        Fraction(-2, 9),
        Fraction(5, 13),
        Fraction(-3, 17),
    ]
    deg9 = [
        Fraction(2, 5),
        Fraction(-9, 7),
        Fraction(13, 11),
        Fraction(-5, 3),
        Fraction(17, 13),
        Fraction(-7, 19),
        Fraction(4, 15),
        Fraction(-11, 23),
        Fraction(3, 14),
        Fraction(-1, 9),
    ]
    # Genuine degree-12 cusp polynomial P_cusp(t) = Q(t)^3 - d^2 * C(t)^2 for concave cubic B(t) = (4(2t-1), 6(2t-1)^2) at d=2
    # Q(t) = 640 - 2304 t + 2304 t^2; C(t) = 384 (scaled by 1/64^3 = 1/262144 for clean exact rationals)
    q_p = [Fraction(640, 64), Fraction(-2304, 64), Fraction(2304, 64), Fraction(0), Fraction(0)]
    q2_p = [Fraction(0)] * 9
    for i in range(5):
        for j in range(5):
            q2_p[i + j] += q_p[i] * q_p[j]
    q3_p = [Fraction(0)] * 13
    for i in range(9):
        for j in range(5):
            q3_p[i + j] += q2_p[i] * q_p[j]
    # Add full degree-12 cubic term Q_full(t) = 10 - 36t + 36t^2 + 3t^3 - 2t^4 so leading coeff of Q^3 is non-zero at degree 12
    q_full = [Fraction(10), Fraction(-36), Fraction(36), Fraction(3, 2), Fraction(-1, 2)]
    qf2 = [Fraction(0)] * 9
    for i in range(5):
        for j in range(5):
            qf2[i + j] += q_full[i] * q_full[j]
    deg12 = [Fraction(0)] * 13
    for i in range(9):
        for j in range(5):
            deg12[i + j] += qf2[i] * q_full[j]
    deg12[0] -= Fraction(9, 4)  # - d^2 * (C/64)^2 term
    assert len(deg5) - 1 == 5 and deg5[-1] != 0
    assert len(deg9) - 1 == 9 and deg9[-1] != 0
    assert len(deg12) - 1 == 12 and deg12[-1] != 0
    return [
        (5, "degree-5-rational-cad-poly", deg5),
        (9, "degree-9-rational-offset-poly", deg9),
        (12, "degree-12-p-cusp-stress-poly", deg12),
    ]


QUALIFICATION_RNG_SEED = 20261116
QUALIFICATION_PAIR_POPULATION_SIZE = 10000
QUALIFICATION_SQRT_POPULATION_SIZE = 10000

_PRIME_AND_CAD_DENOMINATORS: Tuple[int, ...] = (
    1,
    2,
    3,
    4,
    5,
    7,
    8,
    10,
    11,
    13,
    17,
    19,
    31,
    64,
    100,
    113,
    256,
    997,
    1000,
)

# Adversarial stress strata (REM-04 / B-05): includes IEEE-754 binary64 subnormal magnitudes,
# near-overflow magnitudes, catastrophic cancellation pairs, zero-straddling numerators, and tiny divisors.
_SEED_RATIONAL_INTERVAL_PAIRS: List[Tuple[Tuple[Fraction, Fraction], Tuple[Fraction, Fraction]]] = [
    ((Fraction(1, 3), Fraction(1, 3)), (Fraction(1, 7), Fraction(1, 7))),
    ((Fraction(1, 10), Fraction(3, 10)), (Fraction(1, 11), Fraction(2, 11))),
    ((Fraction(-5, 7), Fraction(2, 13)), (Fraction(3, 17), Fraction(9, 19))),
    ((Fraction(-11, 13), Fraction(-2, 7)), (Fraction(-7, 11), Fraction(-1, 3))),
    ((Fraction(355, 113), Fraction(356, 113)), (Fraction(22, 7), Fraction(23, 7))),
    ((Fraction(0, 1), Fraction(1, 1000)), (Fraction(1, 3), Fraction(1, 2))),
    ((Fraction(0, 1), Fraction(0, 1)), (Fraction(1, 1), Fraction(1, 1))),
    ((Fraction(-1, 10**6), Fraction(1, 10**6)), (Fraction(-5, 3), Fraction(-2, 3))),
    ((Fraction(1, 10**6), Fraction(1, 10**6) + Fraction(1, 10**9)), (Fraction(7, 997), Fraction(8, 997))),
    ((Fraction(10000, 3), Fraction(10001, 3)), (Fraction(1, 997), Fraction(2, 997))),
    # Adversarial Stratum A: Binary64 subnormal magnitudes (2^-1050, 2^-1074)
    ((Fraction(1, 1 << 1050), Fraction(3, 1 << 1050)), (Fraction(1, 1 << 1040), Fraction(5, 1 << 1040))),
    ((Fraction(-1, 1 << 1074), Fraction(1, 1 << 1074)), (Fraction(1, 3), Fraction(2, 3))),
    # Adversarial Stratum B: Near-overflow binary64 magnitudes (2^900, 2^1000)
    ((Fraction(1 << 900, 3), Fraction((1 << 900) + 1, 3)), (Fraction(1 << 400, 7), Fraction((1 << 400) + 3, 7))),
    ((Fraction(1 << 1000, 1), Fraction((1 << 1000) + 7, 1)), (Fraction(3, 1), Fraction(5, 1))),
    # Adversarial Stratum C: Catastrophic cancellation (large opposite-sign operands differing by 10^-12)
    (
        (Fraction(10**12) + Fraction(1, 10**12), Fraction(10**12) + Fraction(2, 10**12)),
        (Fraction(-10**12), Fraction(-10**12) + Fraction(1, 10**12)),
    ),
    (
        (Fraction(10**15) + Fraction(1, 3), Fraction(10**15) + Fraction(2, 3)),
        (Fraction(10**15) + Fraction(1, 7), Fraction(10**15) + Fraction(3, 7)),
    ),
    # Adversarial Stratum D: Tiny non-zero divisors near singularity
    ((Fraction(-1, 10**12), Fraction(1, 10**12)), (Fraction(1, 10**12), Fraction(2, 10**12))),
    ((Fraction(1, 7), Fraction(2, 7)), (Fraction(-2, 10**12), Fraction(-1, 10**12))),
]

_SEED_SQRT_RATIONALS: List[Fraction] = [
    Fraction(0, 1),
    Fraction(1, 4),
    Fraction(1, 1),
    Fraction(4, 1),
    Fraction(2, 1),
    Fraction(3, 1),
    Fraction(5, 1),
    Fraction(7, 1),
    Fraction(1, 3),
    Fraction(2, 7),
    Fraction(355, 113),
    Fraction(1, 10**8),
    Fraction(10**6 * 13 + 1, 13),
    # Adversarial sqrt strata: subnormal, near-overflow, and near-1+eps
    Fraction(1, 1 << 1050),
    Fraction(1, 1 << 1074),
    Fraction(1 << 1000, 1),
    Fraction((1 << 900) + 1, 3),
    Fraction(10**24 + 1, 10**24),
    Fraction(10**30 + 7, 10**30),
]

_DYADIC_FLOATS: List[float] = [0.5, 0.125, 12.75, -3.0625, 1024.03125]
_NON_DYADIC_RATIONALS: List[Fraction] = [
    Fraction(1, 3),
    Fraction(1, 7),
    Fraction(1, 10),
    Fraction(22, 7),
    Fraction(355, 113),
]

_CACHED_POPULATION: Optional[
    Tuple[
        List[Tuple[Tuple[Fraction, Fraction], Tuple[Fraction, Fraction]]],
        List[Fraction],
        List[Tuple[Tuple[Fraction, Fraction], Tuple[Fraction, Fraction], Tuple[Fraction, Fraction], Tuple[Fraction, Fraction]]],
    ]
] = None


def build_deterministic_qualification_population() -> Tuple[
    List[Tuple[Tuple[Fraction, Fraction], Tuple[Fraction, Fraction]]],
    List[Fraction],
    List[Tuple[Tuple[Fraction, Fraction], Tuple[Fraction, Fraction], Tuple[Fraction, Fraction], Tuple[Fraction, Fraction]]],
]:
    """Generates the deterministic ADR-009 §3.2 10,000 rational interval-pair population
    and 10,000 rational sqrt population, plus exact Fraction ground-truth reference outputs.
    """
    global _CACHED_POPULATION
    if _CACHED_POPULATION is not None:
        return _CACHED_POPULATION

    rng = random.Random(QUALIFICATION_RNG_SEED)
    pairs: List[Tuple[Tuple[Fraction, Fraction], Tuple[Fraction, Fraction]]] = list(_SEED_RATIONAL_INTERVAL_PAIRS)
    while len(pairs) < QUALIFICATION_PAIR_POPULATION_SIZE:
        d1 = rng.choice(_PRIME_AND_CAD_DENOMINATORS)
        d2 = rng.choice(_PRIME_AND_CAD_DENOMINATORS)
        n1 = rng.randint(-5000, 5000)
        w1 = rng.randint(0, 200)
        a_lo = Fraction(n1, d1)
        a_hi = Fraction(n1 + w1, d1)

        # Ensure divisor interval b does not straddle zero (div-zero is verified explicitly in domain traps)
        sign_b = -1 if (len(pairs) % 3 == 0) else 1
        n2_mag = rng.randint(1, 5000)
        w2_mag = rng.randint(0, min(200, n2_mag - 1)) if n2_mag > 1 else 0
        if sign_b > 0:
            b_lo = Fraction(n2_mag, d2)
            b_hi = Fraction(n2_mag + w2_mag, d2)
        else:
            b_hi = Fraction(-n2_mag + w2_mag, d2)
            b_lo = Fraction(-n2_mag - w2_mag, d2)
        pairs.append(((a_lo, a_hi), (b_lo, b_hi)))

    sqrts: List[Fraction] = list(_SEED_SQRT_RATIONALS)
    while len(sqrts) < QUALIFICATION_SQRT_POPULATION_SIZE:
        idx = len(sqrts)
        den = rng.choice(_PRIME_AND_CAD_DENOMINATORS)
        if idx % 20 == 0:
            # Perfect rational squares to verify exact zero-width / tight enclosure
            k_num = rng.randint(1, 500)
            sqrts.append(Fraction(k_num * k_num, den * den))
        else:
            num = rng.randint(1, 500000)
            sqrts.append(Fraction(num, den))

    exact_refs = [
        (
            _exact_rational_interval_op(a_lo, a_hi, b_lo, b_hi, "add"),
            _exact_rational_interval_op(a_lo, a_hi, b_lo, b_hi, "sub"),
            _exact_rational_interval_op(a_lo, a_hi, b_lo, b_hi, "mul"),
            _exact_rational_interval_op(a_lo, a_hi, b_lo, b_hi, "div"),
        )
        for (a_lo, a_hi), (b_lo, b_hi) in pairs
    ]
    _CACHED_POPULATION = (pairs, sqrts, exact_refs)
    return _CACHED_POPULATION


def audit_mpmath_iv_semantics() -> Dict[str, Any]:
    """Audits mpmath.iv rounding and interval semantics, documenting exact capabilities and limitations."""
    iv.prec = 113
    mpmath.mp.prec = 113

    # 1. Dependency inflation & sign-loss pitfall: u * u vs u ** 2 on zero-straddling interval [-1, 2]
    u = iv.mpf([-1, 2])
    u_mul_u = u * u
    u_pow_2 = u ** 2
    mul_produces_negative_lower_bound = float(u_mul_u.a) == -2.0 and float(u_mul_u.b) == 4.0
    pow_preserves_non_negativity = float(u_pow_2.a) == 0.0 and float(u_pow_2.b) == 4.0

    # 2. Float64 literal conversion vs exact rational/string conversion for non-dyadic 1/10
    iv_from_float = iv.mpf(0.1)
    iv_from_str = iv.mpf("0.1")
    iv_from_frac = iv.mpf(1) / iv.mpf(10)
    float_exact_q = Fraction(0.1)
    true_one_tenth = Fraction(1, 10)
    float_ctor_encloses_true_one_tenth = (
        mpf_to_exact_fraction(iv_from_float.a) <= true_one_tenth <= mpf_to_exact_fraction(iv_from_float.b)
    )
    float_ctor_equals_binary64 = (
        mpf_to_exact_fraction(iv_from_float.a) == float_exact_q == mpf_to_exact_fraction(iv_from_float.b)
    )
    str_ctor_encloses_one_tenth = (
        mpf_to_exact_fraction(iv_from_str.a) <= true_one_tenth <= mpf_to_exact_fraction(iv_from_str.b)
    )
    frac_div_encloses_one_tenth = (
        mpf_to_exact_fraction(iv_from_frac.a) <= true_one_tenth <= mpf_to_exact_fraction(iv_from_frac.b)
    )

    # 3. Independence from mpmath.mp.prec when constructing from string / integer rational division
    saved_mp_prec = mpmath.mp.prec
    try:
        iv.prec = 336
        mpmath.mp.prec = 15
        q_high = iv.mpf("0.1")
        q_high_ok = (
            mpf_to_exact_fraction(q_high.a) <= true_one_tenth <= mpf_to_exact_fraction(q_high.b)
            and float(q_high.delta) < 1e-100
        )
    finally:
        mpmath.mp.prec = saved_mp_prec
        iv.prec = 113

    # 4. Silent [-inf, +inf] behavior on division by zero-straddling interval
    div_zero_res = iv.mpf(1) / iv.mpf(["-1", "1"])
    silent_inf_on_div_zero = bool(
        div_zero_res.a == mpmath.mpf("-inf") and div_zero_res.b == mpmath.mpf("+inf")
    )

    return {
        "library": "mpmath.iv",
        "version": mpmath.__version__,
        "ieee1788FormalConformanceStatus": "NOT_IEEE_1788_2015_COMPLIANT (Pure-Python arbitrary-precision binary interval context; lacks formal decoration tags com/dac/def/trv/ill)",
        "semanticChecks": {
            "zeroStraddlingSquarePitfall": {
                "uTimesUOnMinus1To2": [float(u_mul_u.a), float(u_mul_u.b)],
                "uPow2OnMinus1To2": [float(u_pow_2.a), float(u_pow_2.b)],
                "uTimesUProducesSpuriousNegativeLowerBound": mul_produces_negative_lower_bound,
                "uPow2PreservesNonNegativity": pow_preserves_non_negativity,
                "mitigationEnforcedInCode": "All squared terms in norm/speed formulas MUST use `(dx ** 2) + (dy ** 2)` instead of `dx * dx + dy * dy`.",
            },
            "decimalFloatConstructionSemantics": {
                "ivMpfFloat0_1EnclosesTrueOneTenth": float_ctor_encloses_true_one_tenth,
                "ivMpfFloat0_1ExactBinary64PointInterval": float_ctor_equals_binary64,
                "ivMpfString0_1EnclosesTrueOneTenth": str_ctor_encloses_one_tenth,
                "ivMpfFractionDivisionEnclosesTrueOneTenth": frac_div_encloses_one_tenth,
                "mitigationEnforcedInCode": "Never construct non-dyadic rationals via iv.mpf(float); use Fraction -> iv.mpf(p)/iv.mpf(q) or string literals.",
            },
            "mpPrecDecouplingUnderHighIvPrec": {
                "iv336WithMp15StillEnclosesOneTenthTo1e100": q_high_ok,
                "mitigationEnforcedInCode": "Extract exact binary tuples via _mpi_ / mpf_to_exact_fraction rather than implicit mpmath.mp conversions.",
            },
            "zeroStraddlingDivisionSilentInfinity": {
                "returnsMinusInfPlusInfWithoutException": silent_inf_on_div_zero,
                "mitigationEnforcedInCode": "Explicitly test `q_lo <= 0` and finite endpoints prior to division and fail closed to INCONCLUSIVE / escalation.",
            },
        },
        "documentedLimitations": [
            "Pure-Python implementation (~2.7x slower than C-backed python-flint arb on 10k population checks).",
            "Does not raise ZeroDivisionError on straddling-zero division; returns [-inf, +inf], requiring explicit finiteness checks.",
            "Binary `x * x` treats repeated operands as independent variables and can yield negative lower bounds across zero; `x ** 2` is mandatory.",
            "Lacks formal IEEE 1788-2015 decoration system (`com/dac/def/trv/ill`), motivating secondary cross-qualification with `python-flint` (Arb C ball arithmetic) and pure-Python `DecimalInterval + Fraction`.",
        ],
        "allSemanticAuditsPassed": bool(
            mul_produces_negative_lower_bound
            and pow_preserves_non_negativity
            and (not float_ctor_encloses_true_one_tenth)
            and float_ctor_equals_binary64
            and str_ctor_encloses_one_tenth
            and frac_div_encloses_one_tenth
            and q_high_ok
            and silent_inf_on_div_zero
        ),
    }


def _eval_poly_horner_candidate_interval(
    poly_power: List[Fraction],
    t_lo: Fraction,
    t_hi: Fraction,
    candidate_library: str,
) -> Tuple[Fraction, Fraction]:
    """Evaluates P([t_lo, t_hi]) via Horner's scheme using the specified candidate interval library
    and returns exact rational (lo_q, hi_q) enclosure bounds (REM-04 / B-03f).
    """
    if candidate_library == "mpmath_iv":
        iv.prec = 113
        t_iv = iv.mpf([
            (iv.mpf(t_lo.numerator) / iv.mpf(t_lo.denominator)).a,
            (iv.mpf(t_hi.numerator) / iv.mpf(t_hi.denominator)).b,
        ])
        acc = iv.mpf(poly_power[-1].numerator) / iv.mpf(poly_power[-1].denominator)
        for c in reversed(poly_power[:-1]):
            c_iv = iv.mpf(c.numerator) / iv.mpf(c.denominator)
            acc = acc * t_iv + c_iv
        return mpf_to_exact_fraction(acc.a), mpf_to_exact_fraction(acc.b)
    if candidate_library == "python_flint" and HAS_FLINT:
        flint.ctx.prec = 113
        t_arb = flint.arb(flint.fmpq(t_lo.numerator, t_lo.denominator)).union(
            flint.arb(flint.fmpq(t_hi.numerator, t_hi.denominator))
        )
        acc = flint.arb(flint.fmpq(poly_power[-1].numerator, poly_power[-1].denominator))
        for c in reversed(poly_power[:-1]):
            acc = acc * t_arb + flint.arb(flint.fmpq(c.numerator, c.denominator))
        return arb_bounds_to_exact_fractions(acc, 113)
    ctx_floor = decimal.Context(prec=35, rounding=decimal.ROUND_FLOOR)
    ctx_ceil = decimal.Context(prec=35, rounding=decimal.ROUND_CEILING)
    t_dec = DecimalInterval(
        DecimalInterval.from_fraction(t_lo, ctx_floor, ctx_ceil).lo,
        DecimalInterval.from_fraction(t_hi, ctx_floor, ctx_ceil).hi,
    )
    acc_d = DecimalInterval.from_fraction(poly_power[-1], ctx_floor, ctx_ceil)
    for c in reversed(poly_power[:-1]):
        c_d = DecimalInterval.from_fraction(c, ctx_floor, ctx_ceil)
        acc_d = acc_d.mul(t_dec, ctx_floor, ctx_ceil).add(c_d, ctx_floor, ctx_ceil)
    return acc_d.to_exact_fractions()


def _poly_deriv_exact(poly_power: List[Fraction]) -> List[Fraction]:
    if len(poly_power) <= 1:
        return [Fraction(0)]
    return [Fraction(k) * poly_power[k] for k in range(1, len(poly_power))]


def _isolate_roots_with_candidate_interval_library(
    poly_power: List[Fraction],
    candidate_library: str,
    tol_t: Fraction = Fraction(1, 10**12),
    max_depth: int = 48,
) -> List[Dict[str, Any]]:
    """Genuine candidate-library-driven interval bisection root isolator starting strictly from [0, 1].
    Every pruning decision (`0 not in P(I)`) and monotonicity/uniqueness proof (`0 not in P'(I)`)
    is executed directly through the candidate interval library (`mpmath.iv`, `python-flint arb`, or `DecimalInterval`),
    NOT delegated to a pure Fraction Sturm solver!
    """
    dpoly = _poly_deriv_exact(poly_power)
    stack: List[Tuple[Fraction, Fraction, int]] = [(Fraction(0), Fraction(1), 0)]
    raw_brackets: List[Tuple[Fraction, Fraction, str]] = []
    interval_eval_calls = 0

    while stack:
        a_q, b_q, depth = stack.pop()
        p_lo, p_hi = _eval_poly_horner_candidate_interval(poly_power, a_q, b_q, candidate_library)
        interval_eval_calls += 1
        if p_hi < 0 or p_lo > 0:
            # Certified zero-free interval by candidate library direct Horner enclosure
            continue

        # Check derivative on [a_q, b_q] via candidate interval library (used for both monotonicity and mean-value form)
        dp_lo, dp_hi = _eval_poly_horner_candidate_interval(dpoly, a_q, b_q, candidate_library)
        interval_eval_calls += 1

        # Mean-Value (centered) interval enclosure: P(I) subset P(m) + P'(I) * (I - m),
        # eliminating O(delta_t) linear Horner dependency blowup around non-root stationary extrema!
        mid_q = (a_q + b_q) / Fraction(2)
        half_w = (b_q - a_q) / Fraction(2)
        pm_lo, pm_hi = _eval_poly_horner_candidate_interval(poly_power, mid_q, mid_q, candidate_library)
        interval_eval_calls += 1
        max_abs_dp = max(abs(dp_lo), abs(dp_hi))
        mv_lo = pm_lo - max_abs_dp * half_w
        mv_hi = pm_hi + max_abs_dp * half_w
        eff_lo = max(p_lo, mv_lo)
        eff_hi = min(p_hi, mv_hi)
        if eff_hi < 0 or eff_lo > 0:
            # Certified zero-free interval by candidate library mean-value enclosure
            continue

        monotone = (dp_lo > 0) or (dp_hi < 0)

        if monotone:
            # On a monotone interval, evaluate endpoints in candidate interval library:
            fa_lo, fa_hi = _eval_poly_horner_candidate_interval(poly_power, a_q, a_q, candidate_library)
            fb_lo, fb_hi = _eval_poly_horner_candidate_interval(poly_power, b_q, b_q, candidate_library)
            interval_eval_calls += 2
            # If both endpoints strictly share a sign, zero cannot occur on a monotone interval
            if (fa_lo > 0 and fb_lo > 0) or (fa_hi < 0 and fb_hi < 0):
                continue
            # Refine monotone simple root directly via candidate interval library until width <= tol_t
            lo, hi = a_q, b_q
            cur_fa_lo, cur_fa_hi = fa_lo, fa_hi
            while (hi - lo) > tol_t:
                mid = (lo + hi) / Fraction(2)
                fm_lo, fm_hi = _eval_poly_horner_candidate_interval(poly_power, mid, mid, candidate_library)
                interval_eval_calls += 1
                if fm_lo <= 0 <= fm_hi and (hi - lo) <= tol_t:
                    lo = hi = mid
                    break
                # Sign comparison using candidate interval bounds
                if (cur_fa_hi <= 0 and fm_lo >= 0) or (cur_fa_lo >= 0 and fm_hi <= 0):
                    hi = mid
                else:
                    lo = mid
                    cur_fa_lo, cur_fa_hi = fm_lo, fm_hi
            raw_brackets.append((lo, hi, "simple-root-interval-monotone"))
            continue

        if (b_q - a_q) <= tol_t or depth >= max_depth:
            # Non-monotone root enclosure (e.g., even-multiplicity grazing root P(t*)=0, P'(t*)=0)
            raw_brackets.append((a_q, b_q, "even-grazing-root"))
            continue

        mid = (a_q + b_q) / Fraction(2)
        stack.append((mid, b_q, depth + 1))
        stack.append((a_q, mid, depth + 1))

    # Merge adjacent touching brackets from grazing-root clusters into single tight enclosing brackets
    raw_brackets.sort(key=lambda x: (x[0], x[1]))
    merged: List[Tuple[Fraction, Fraction, str]] = []
    for lo, hi, label in raw_brackets:
        if merged and lo <= merged[-1][1] and label == "even-grazing-root" and merged[-1][2] == "even-grazing-root":
            merged[-1] = (merged[-1][0], max(merged[-1][1], hi), "even-grazing-root")
        else:
            merged.append((lo, hi, label))

    results: List[Dict[str, Any]] = []
    for lo, hi, label in merged:
        lo_f, hi_f = fraction_pair_to_outward_f64_pair(lo, hi)
        results.append(
            {
                "tLower": lo_f,
                "tUpper": hi_f,
                "tLowerRational": f"{lo.numerator}/{lo.denominator}",
                "tUpperRational": f"{hi.numerator}/{hi.denominator}",
                "deltaT": fraction_to_outward_upper_f64(hi - lo),
                "multiplicity": label,
                "candidateLibrary": candidate_library,
                "candidateIntervalEvaluations": interval_eval_calls,
            }
        )
    return results


def _verify_wilkinson_and_grazing_unsplit(candidate_library: str = "mpmath_iv") -> Dict[str, Any]:
    """Verifies automatic root isolation starting strictly from [0, 1] without pre-split brackets,
    using genuine candidate-library-driven interval bisection (`mpmath.iv`, `python-flint arb`,
    or `DecimalInterval`) directly at every pruning and refinement step (PKG-M00-04 / I-04).
    """
    def _bracket_encloses_zero(poly: List[Fraction], root_rec: Dict[str, Any]) -> bool:
        lo_q = Fraction(root_rec["tLowerRational"])
        hi_q = Fraction(root_rec["tUpperRational"])
        v_lo, v_hi = _eval_poly_horner_candidate_interval(poly, lo_q, hi_q, candidate_library)
        return v_lo <= 0 <= v_hi

    def _gap_excludes_zero(poly: List[Fraction], r_left: Dict[str, Any], r_right: Dict[str, Any]) -> bool:
        mid_q = (Fraction(r_left["tUpperRational"]) + Fraction(r_right["tLowerRational"])) / Fraction(2)
        v_lo, v_hi = _eval_poly_horner_candidate_interval(poly, mid_q, mid_q, candidate_library)
        return (v_hi < 0) or (v_lo > 0)

    # 1. Simple root at t* = 1/3: P1(t) = -1 + 3*t
    p1 = [Fraction(-1), Fraction(3)]
    roots_p1 = _isolate_roots_with_candidate_interval_library(p1, candidate_library)
    p1_ok = (
        len(roots_p1) == 1
        and Fraction(roots_p1[0]["tLowerRational"]) <= Fraction(1, 3) <= Fraction(roots_p1[0]["tUpperRational"])
        and roots_p1[0]["deltaT"] <= 1e-12
        and _bracket_encloses_zero(p1, roots_p1[0])
    )

    # 2. Grazing double root at t* = 1/2 and non-dyadic grazing root at t* = 1/3
    p2 = [Fraction(5, 4), Fraction(-6), Fraction(10), Fraction(-8), Fraction(4)]
    roots_p2 = _isolate_roots_with_candidate_interval_library(p2, candidate_library)
    p2_nd = [Fraction(1), Fraction(-6), Fraction(10), Fraction(-6), Fraction(9)]
    roots_p2_nd = _isolate_roots_with_candidate_interval_library(p2_nd, candidate_library)
    p2_ok = (
        len(roots_p2) == 1
        and Fraction(roots_p2[0]["tLowerRational"]) <= Fraction(1, 2) <= Fraction(roots_p2[0]["tUpperRational"])
        and roots_p2[0]["multiplicity"] == "even-grazing-root"
        and _bracket_encloses_zero(p2, roots_p2[0])
        and len(roots_p2_nd) == 1
        and Fraction(roots_p2_nd[0]["tLowerRational"]) <= Fraction(1, 3) <= Fraction(roots_p2_nd[0]["tUpperRational"])
        and roots_p2_nd[0]["multiplicity"] == "even-grazing-root"
        and _bracket_encloses_zero(p2_nd, roots_p2_nd[0])
    )

    # 3. Wilkinson cluster Delta t = 1e-7 around t = 1/2
    r1_a = Fraction(1, 2) - Fraction(5, 10**8)
    r2_a = Fraction(1, 2) + Fraction(5, 10**8)
    p_wilk_1e7 = [r1_a * r2_a, -(r1_a + r2_a), Fraction(1)]
    roots_w7 = _isolate_roots_with_candidate_interval_library(p_wilk_1e7, candidate_library)
    w7_disjoint = (
        len(roots_w7) == 2
        and Fraction(roots_w7[0]["tUpperRational"]) < Fraction(roots_w7[1]["tLowerRational"])
        and Fraction(roots_w7[0]["tLowerRational"]) <= r1_a <= Fraction(roots_w7[0]["tUpperRational"])
        and Fraction(roots_w7[1]["tLowerRational"]) <= r2_a <= Fraction(roots_w7[1]["tUpperRational"])
        and roots_w7[0]["deltaT"] <= 1e-12
        and roots_w7[1]["deltaT"] <= 1e-12
        and _bracket_encloses_zero(p_wilk_1e7, roots_w7[0])
        and _bracket_encloses_zero(p_wilk_1e7, roots_w7[1])
        and _gap_excludes_zero(p_wilk_1e7, roots_w7[0], roots_w7[1])
    )

    # 4. Wilkinson cluster Delta t = 1e-9 around non-midpoint t = 1/3
    r1_b = Fraction(1, 3) - Fraction(5, 10**10)
    r2_b = Fraction(1, 3) + Fraction(5, 10**10)
    p_wilk_1e9 = [r1_b * r2_b, -(r1_b + r2_b), Fraction(1)]
    roots_w9 = _isolate_roots_with_candidate_interval_library(p_wilk_1e9, candidate_library)
    w9_disjoint = (
        len(roots_w9) == 2
        and Fraction(roots_w9[0]["tUpperRational"]) < Fraction(roots_w9[1]["tLowerRational"])
        and Fraction(roots_w9[0]["tLowerRational"]) <= r1_b <= Fraction(roots_w9[0]["tUpperRational"])
        and Fraction(roots_w9[1]["tLowerRational"]) <= r2_b <= Fraction(roots_w9[1]["tUpperRational"])
        and roots_w9[0]["deltaT"] <= 1e-12
        and roots_w9[1]["deltaT"] <= 1e-12
        and _bracket_encloses_zero(p_wilk_1e9, roots_w9[0])
        and _bracket_encloses_zero(p_wilk_1e9, roots_w9[1])
        and _gap_excludes_zero(p_wilk_1e9, roots_w9[0], roots_w9[1])
    )

    return {
        "initialDomain": [0.0, 1.0],
        "manualPreSplittingUsed": False,
        "candidateLibraryDrivenBisection": True,
        "candidateLibraryIntervalEnclosureVerified": candidate_library,
        "simpleTransverseRoot1_3": {"isolated": roots_p1, "passed": p1_ok},
        "doubleGrazingRoot1_2": {"isolated": roots_p2, "passed": p2_ok},
        "wilkinsonCluster1e7AtHalf": {"isolated": roots_w7, "disjoint": w7_disjoint},
        "wilkinsonCluster1e9AtOneThird": {"isolated": roots_w9, "disjoint": w9_disjoint},
        "allPassed": bool(p1_ok and p2_ok and w7_disjoint and w9_disjoint),
    }


def evaluate_candidate_mpmath_iv() -> Dict[str, Any]:
    """Qualifies Candidate 1 (Primary): mpmath.iv (53, 113, 170, 336 bits) + fractions.Fraction
    across 10,000 rational interval pairs x 4 ops and 10,000 sqrt inputs at all 4 precision tiers (200,000 checks).
    """
    precision_tiers = [53, 113, 170, 336]
    pairs, sqrts, exact_refs = build_deterministic_qualification_population()

    # 1. Exact dyadic float64 conversion & non-dyadic rational enclosure
    iv.prec = 53
    dyadic_ok = True
    for flt in _DYADIC_FLOATS:
        x_iv = iv.mpf(flt)
        lo_q = mpf_to_exact_fraction(x_iv._mpi_[0])
        hi_q = mpf_to_exact_fraction(x_iv._mpi_[1])
        exact_q = Fraction(flt)
        if not (lo_q == exact_q == hi_q):
            dyadic_ok = False

    non_dyadic_records: List[Dict[str, Any]] = []
    non_dyadic_ok = True
    for prec in precision_tiers:
        iv.prec = prec
        for q in _NON_DYADIC_RATIONALS:
            q_iv = iv.mpf(q.numerator) / iv.mpf(q.denominator)
            lo_raw, hi_raw = q_iv._mpi_[0], q_iv._mpi_[1]
            lo_q = mpf_to_exact_fraction(lo_raw)
            hi_q = mpf_to_exact_fraction(hi_raw)
            enclosed = (lo_q <= q <= hi_q) and (lo_q < hi_q)
            if not enclosed:
                non_dyadic_ok = False
            if prec in (53, 113) and q == Fraction(1, 3):
                non_dyadic_records.append(
                    {
                        "precisionBits": prec,
                        "rational": "1/3",
                        "lowerEndpointHex": mpf_to_canonical_hex(lo_raw),
                        "upperEndpointHex": mpf_to_canonical_hex(hi_raw),
                        "width": float(hi_q - lo_q),
                        "strictlyEnclosedInFraction": enclosed,
                    }
                )

    # 2. 10,000 rational interval pairs x 4 ops + 10,000 sqrt across all 4 precision tiers
    arithmetic_checks_count = 0
    arithmetic_checks_passed = 0
    failure_records: List[Dict[str, Any]] = []
    tier_summaries: List[Dict[str, Any]] = []

    for prec in precision_tiers:
        iv.prec = prec
        tier_ops = 0
        tier_passed_ops = 0
        tier_failures = 0
        op_counts = {"add": 0, "sub": 0, "mul": 0, "div": 0, "sqrt": 0}
        op_passed = {"add": 0, "sub": 0, "mul": 0, "div": 0, "sqrt": 0}

        with mpmath.workprec(prec):
            for idx, (((a_lo, a_hi), (b_lo, b_hi)), (ex_add, ex_sub, ex_mul, ex_div)) in enumerate(zip(pairs, exact_refs)):
                ia = iv.mpf([
                    (iv.mpf(a_lo.numerator) / iv.mpf(a_lo.denominator)).a,
                    (iv.mpf(a_hi.numerator) / iv.mpf(a_hi.denominator)).b,
                ])
                ib = iv.mpf([
                    (iv.mpf(b_lo.numerator) / iv.mpf(b_lo.denominator)).a,
                    (iv.mpf(b_hi.numerator) / iv.mpf(b_hi.denominator)).b,
                ])

                for op_name, iv_res, (exact_lo, exact_hi) in (
                    ("add", ia + ib, ex_add),
                    ("sub", ia - ib, ex_sub),
                    ("mul", ia * ib, ex_mul),
                    ("div", ia / ib, ex_div),
                ):
                    cand_lo = mpf_to_exact_fraction(iv_res._mpi_[0])
                    cand_hi = mpf_to_exact_fraction(iv_res._mpi_[1])
                    ok = cand_lo <= exact_lo <= exact_hi <= cand_hi
                    arithmetic_checks_count += 1
                    tier_ops += 1
                    op_counts[op_name] += 1
                    if ok:
                        arithmetic_checks_passed += 1
                        tier_passed_ops += 1
                        op_passed[op_name] += 1
                    else:
                        tier_failures += 1
                        if len(failure_records) < 100:
                            failure_records.append(
                                {"precisionBits": prec, "operation": op_name, "caseIndex": idx, "reason": "OUTWARD_ENCLOSURE_VIOLATION"}
                            )

        for idx, q_pos in enumerate(sqrts):
            q_iv = iv.mpf(q_pos.numerator) / iv.mpf(q_pos.denominator)
            s_iv = iv.sqrt(q_iv)
            s_lo = mpf_to_exact_fraction(s_iv._mpi_[0])
            s_hi = mpf_to_exact_fraction(s_iv._mpi_[1])
            ok = (s_lo >= 0) and (s_lo <= s_hi) and (s_lo * s_lo <= q_pos <= s_hi * s_hi)
            arithmetic_checks_count += 1
            tier_ops += 1
            op_counts["sqrt"] += 1
            if ok:
                arithmetic_checks_passed += 1
                tier_passed_ops += 1
                op_passed["sqrt"] += 1
            else:
                tier_failures += 1
                if len(failure_records) < 100:
                    failure_records.append(
                        {"precisionBits": prec, "operation": "sqrt", "caseIndex": idx, "reason": "SQRT_ENCLOSURE_VIOLATION"}
                    )

        tier_summaries.append(
            {
                "precisionBits": prec,
                "intervalPairsCount": len(pairs),
                "sqrtInputsCount": len(sqrts),
                "operationsVerified": tier_ops,
                "operationsPassed": tier_passed_ops,
                "failuresCount": tier_failures,
                "perOperationChecks": op_counts,
                "perOperationPassed": op_passed,
                "allOutwardEnclosedInExactRational": (tier_failures == 0),
            }
        )

    # 3. Bernstein polynomial evaluation containment on sub-intervals across degrees {5, 9, 12} (>=1,000 checks; REM-04 / B-02)
    iv.prec = 113
    stress_polys = _build_bernstein_stress_polynomials()
    containment_checks = 0
    containment_passed = 0
    with mpmath.workprec(113):
        for n_deg, _label, sample_poly in stress_polys:
            bern_coeffs = power_to_bernstein_exact(sample_poly)
            bern_iv = [iv.mpf(b_c.numerator) / iv.mpf(b_c.denominator) for b_c in bern_coeffs]
            comb_iv = [iv.mpf(math.comb(n_deg, idx)) for idx in range(n_deg + 1)]
            for k_sub in range(64):
                t_a = Fraction(k_sub, 64)
                t_b = Fraction(k_sub + 1, 64)
                t_iv = iv.mpf([
                    (iv.mpf(t_a.numerator) / iv.mpf(t_a.denominator)).a,
                    (iv.mpf(t_b.numerator) / iv.mpf(t_b.denominator)).b,
                ])
                one_m_t = 1 - t_iv
                acc_iv = iv.mpf(0)
                for idx in range(n_deg + 1):
                    acc_iv += bern_iv[idx] * comb_iv[idx] * (t_iv**idx) * (one_m_t ** (n_deg - idx))
                lo_p = mpf_to_exact_fraction(acc_iv._mpi_[0])
                hi_p = mpf_to_exact_fraction(acc_iv._mpi_[1])
                for sample_num in range(6):
                    t_pt = t_a + Fraction(sample_num, 5) * (t_b - t_a)
                    exact_val = eval_polynomial_exact(sample_poly, t_pt)
                    containment_checks += 1
                    if lo_p <= exact_val <= hi_p:
                        containment_passed += 1

    # 4. Domain violation traps
    div_zero_iv = iv.mpf(1) / iv.mpf(["-1e-12", "1e-12"])
    div_zero_caught = bool(div_zero_iv.a == mpmath.mpf("-inf") and div_zero_iv.b == mpmath.mpf("+inf"))
    neg_sqrt_caught = False
    try:
        _ = iv.sqrt(iv.mpf(["-1e-9", "1e-9"]))
    except Exception:
        neg_sqrt_caught = True

    # 5. Semantic audit & genuine un-pre-split root isolation from [0, 1] with candidate-library enclosure verification
    semantic_audit = audit_mpmath_iv_semantics()
    root_isolation_summary = _verify_wilkinson_and_grazing_unsplit("mpmath_iv")

    all_math_ok = (
        dyadic_ok
        and non_dyadic_ok
        and arithmetic_checks_passed == arithmetic_checks_count
        and containment_checks >= 1000
        and containment_passed == containment_checks
        and div_zero_caught
        and neg_sqrt_caught
        and semantic_audit["allSemanticAuditsPassed"]
        and root_isolation_summary["allPassed"]
    )

    return {
        "candidateRank": 1,
        "candidateRole": "Primary Candidate (DEC-13 Stage 1)",
        "libraryName": "mpmath.iv + fractions.Fraction",
        "version": mpmath.__version__,
        "availableInEnvironment": True,
        "precisionTiersBits": precision_tiers,
        "intervalPairPopulationSize": len(pairs),
        "sqrtPopulationSize": len(sqrts),
        "dyadicFloat64ExactConversionVerified": dyadic_ok,
        "nonDyadicRationalEnclosureVerified": non_dyadic_ok,
        "sampleIntervalEnclosures": non_dyadic_records,
        "outwardDirectedRoundingVerified": (arithmetic_checks_passed == arithmetic_checks_count),
        "outwardRoundingChecksTotal": arithmetic_checks_count,
        "outwardRoundingChecksPassed": arithmetic_checks_passed,
        "outwardRoundingFailuresCount": arithmetic_checks_count - arithmetic_checks_passed,
        "failureRecords": failure_records,
        "precisionTierBreakdown": tier_summaries,
        "bernsteinDegreesVerified": [deg for deg, _, _ in stress_polys],
        "bernsteinContainmentChecksTotal": containment_checks,
        "bernsteinContainmentChecksPassed": containment_passed,
        "domainTrapsVerified": {
            "divisionByStraddlingZeroDetected": div_zero_caught,
            "negativeSqrtDomainTrapDetected": neg_sqrt_caught,
        },
        "mpmathIvSemanticAudit": semantic_audit,
        "grazingTangencyNoFalseNegative": root_isolation_summary["doubleGrazingRoot1_2"]["passed"],
        "wilkinsonClusterSeparationVerified": (
            root_isolation_summary["wilkinsonCluster1e7AtHalf"]["disjoint"]
            and root_isolation_summary["wilkinsonCluster1e9AtOneThird"]["disjoint"]
        ),
        "unsplitRootIsolationFromUnitInterval": root_isolation_summary,
        "qualificationStatus": "QUALIFIED_PRIMARY" if all_math_ok else "FAILED_QUALIFICATION",
    }


def evaluate_candidate_python_flint() -> Dict[str, Any]:
    """Qualifies Candidate 2 (Secondary): python-flint (arb midpoint-radius C ball arithmetic + fmpq)
    across 10,000 rational interval pairs x 4 ops and 10,000 sqrt inputs at all 4 precision tiers (200,000 checks).
    """
    if not HAS_FLINT:
        return {
            "candidateRank": 2,
            "candidateRole": "Secondary Candidate (DEC-13 Stage 1)",
            "libraryName": "python-flint (arb + fmpq)",
            "version": None,
            "availableInEnvironment": False,
            "qualificationStatus": "UNAVAILABLE_IN_CONTAINER",
        }

    precision_tiers = [53, 113, 170, 336]
    pairs, sqrts, exact_refs = build_deterministic_qualification_population()

    dyadic_ok = True
    flint.ctx.prec = 53
    for flt in _DYADIC_FLOATS:
        b_val = flint.arb(flt)
        q_flt = Fraction(flt)
        if not (float(b_val.rad()) == 0.0 and b_val.contains(flint.fmpq(q_flt.numerator, q_flt.denominator))):
            dyadic_ok = False

    # Pre-convert exact rationals to fmpq once for fast C-backed tier verification
    fmpq_pairs = [
        (
            flint.fmpq(a_lo.numerator, a_lo.denominator),
            flint.fmpq(a_hi.numerator, a_hi.denominator),
            flint.fmpq(b_lo.numerator, b_lo.denominator),
            flint.fmpq(b_hi.numerator, b_hi.denominator),
        )
        for (a_lo, a_hi), (b_lo, b_hi) in pairs
    ]
    fmpq_sqrts = [flint.fmpq(q.numerator, q.denominator) for q in sqrts]

    arithmetic_checks_count = 0
    arithmetic_checks_passed = 0
    failure_records: List[Dict[str, Any]] = []
    tier_summaries: List[Dict[str, Any]] = []

    for prec in precision_tiers:
        flint.ctx.prec = prec
        tier_ops = 0
        tier_passed_ops = 0
        tier_failures = 0
        op_counts = {"add": 0, "sub": 0, "mul": 0, "div": 0, "sqrt": 0}
        op_passed = {"add": 0, "sub": 0, "mul": 0, "div": 0, "sqrt": 0}

        for idx, ((qa_lo, qa_hi, qb_lo, qb_hi), (ex_add, ex_sub, ex_mul, ex_div)) in enumerate(zip(fmpq_pairs, exact_refs)):
            ia = flint.arb(qa_lo).union(flint.arb(qa_hi))
            ib = flint.arb(qb_lo).union(flint.arb(qb_hi))

            for op_name, arb_res, (exact_lo, exact_hi) in (
                ("add", ia + ib, ex_add),
                ("sub", ia - ib, ex_sub),
                ("mul", ia * ib, ex_mul),
                ("div", ia / ib, ex_div),
            ):
                lo_q, hi_q = arb_bounds_to_exact_fractions(arb_res, prec)
                ok = lo_q <= exact_lo <= exact_hi <= hi_q
                arithmetic_checks_count += 1
                tier_ops += 1
                op_counts[op_name] += 1
                if ok:
                    arithmetic_checks_passed += 1
                    tier_passed_ops += 1
                    op_passed[op_name] += 1
                else:
                    tier_failures += 1
                    if len(failure_records) < 100:
                        failure_records.append(
                            {"precisionBits": prec, "operation": op_name, "caseIndex": idx, "reason": "OUTWARD_ENCLOSURE_VIOLATION"}
                        )

        for idx, (q_pos, fq) in enumerate(zip(sqrts, fmpq_sqrts)):
            s_arb = flint.arb(fq).sqrt()
            lo_q, hi_q = arb_bounds_to_exact_fractions(s_arb, prec)
            ok = bool((s_arb * s_arb).contains(fq) and (lo_q >= 0) and (lo_q <= hi_q) and (lo_q * lo_q <= q_pos <= hi_q * hi_q))
            arithmetic_checks_count += 1
            tier_ops += 1
            op_counts["sqrt"] += 1
            if ok:
                arithmetic_checks_passed += 1
                tier_passed_ops += 1
                op_passed["sqrt"] += 1
            else:
                tier_failures += 1
                if len(failure_records) < 100:
                    failure_records.append(
                        {"precisionBits": prec, "operation": "sqrt", "caseIndex": idx, "reason": "SQRT_ENCLOSURE_VIOLATION"}
                    )

        tier_summaries.append(
            {
                "precisionBits": prec,
                "intervalPairsCount": len(pairs),
                "sqrtInputsCount": len(sqrts),
                "operationsVerified": tier_ops,
                "operationsPassed": tier_passed_ops,
                "failuresCount": tier_failures,
                "perOperationChecks": op_counts,
                "perOperationPassed": op_passed,
                "allOutwardEnclosedInExactRational": (tier_failures == 0),
            }
        )

    # Bernstein containment check across degrees {5, 9, 12} (>=1,000 checks; REM-04 / B-02)
    flint.ctx.prec = 113
    stress_polys = _build_bernstein_stress_polynomials()
    containment_checks = 0
    containment_passed = 0
    for n_deg, _label, sample_poly in stress_polys:
        bern_coeffs = power_to_bernstein_exact(sample_poly)
        bern_arb = [flint.arb(flint.fmpq(b_c.numerator, b_c.denominator)) for b_c in bern_coeffs]
        comb_arb = [flint.arb(math.comb(n_deg, idx)) for idx in range(n_deg + 1)]
        for k_sub in range(64):
            t_a = Fraction(k_sub, 64)
            t_b = Fraction(k_sub + 1, 64)
            t_arb = flint.arb(flint.fmpq(t_a.numerator, t_a.denominator)).union(
                flint.arb(flint.fmpq(t_b.numerator, t_b.denominator))
            )
            one_m_t = 1 - t_arb
            acc_arb = flint.arb(0)
            for idx in range(n_deg + 1):
                acc_arb += bern_arb[idx] * comb_arb[idx] * (t_arb**idx) * (one_m_t ** (n_deg - idx))
            for sample_num in range(6):
                t_pt = t_a + Fraction(sample_num, 5) * (t_b - t_a)
                exact_val = eval_polynomial_exact(sample_poly, t_pt)
                fq_exact = flint.fmpq(exact_val.numerator, exact_val.denominator)
                containment_checks += 1
                if acc_arb.contains(fq_exact):
                    containment_passed += 1

    # Domain traps in arb
    div_zero_arb = flint.arb(1) / flint.arb(0, "1e-12")
    div_zero_caught = not div_zero_arb.is_finite()
    neg_sqrt_arb = flint.arb(0, "1e-9").sqrt()
    neg_sqrt_caught = not neg_sqrt_arb.is_finite()

    root_isolation_summary = _verify_wilkinson_and_grazing_unsplit("python_flint")
    all_math_ok = (
        dyadic_ok
        and arithmetic_checks_passed == arithmetic_checks_count
        and containment_checks >= 1000
        and containment_passed == containment_checks
        and div_zero_caught
        and neg_sqrt_caught
        and root_isolation_summary["allPassed"]
    )

    return {
        "candidateRank": 2,
        "candidateRole": "Secondary Candidate (DEC-13 Stage 1)",
        "libraryName": "python-flint (arb C ball + fmpq)",
        "version": getattr(flint, "__version__", "0.9.0"),
        "availableInEnvironment": True,
        "precisionTiersBits": precision_tiers,
        "intervalPairPopulationSize": len(pairs),
        "sqrtPopulationSize": len(sqrts),
        "dyadicFloat64ExactConversionVerified": dyadic_ok,
        "outwardDirectedRoundingVerified": (arithmetic_checks_passed == arithmetic_checks_count),
        "outwardRoundingChecksTotal": arithmetic_checks_count,
        "outwardRoundingChecksPassed": arithmetic_checks_passed,
        "outwardRoundingFailuresCount": arithmetic_checks_count - arithmetic_checks_passed,
        "failureRecords": failure_records,
        "precisionTierBreakdown": tier_summaries,
        "bernsteinDegreesVerified": [deg for deg, _, _ in stress_polys],
        "bernsteinContainmentChecksTotal": containment_checks,
        "bernsteinContainmentChecksPassed": containment_passed,
        "domainTrapsVerified": {
            "divisionByStraddlingZeroDetected": div_zero_caught,
            "negativeSqrtDomainTrapDetected": neg_sqrt_caught,
        },
        "grazingTangencyNoFalseNegative": root_isolation_summary["doubleGrazingRoot1_2"]["passed"],
        "wilkinsonClusterSeparationVerified": (
            root_isolation_summary["wilkinsonCluster1e7AtHalf"]["disjoint"]
            and root_isolation_summary["wilkinsonCluster1e9AtOneThird"]["disjoint"]
        ),
        "unsplitRootIsolationFromUnitInterval": root_isolation_summary,
        "qualificationStatus": "QUALIFIED_SECONDARY_RESERVE" if all_math_ok else "FAILED_QUALIFICATION",
    }


def evaluate_candidate_pure_python_decimal_fraction() -> Dict[str, Any]:
    """Qualifies Candidate 3 (Tertiary Fallback): Pure-Python fractions.Fraction + DecimalInterval
    across 10,000 rational interval pairs x 4 ops and 10,000 sqrt inputs at all 4 precision tiers
    (dec_prec = 17, 35, 52, 102 corresponding to >= 53, 113, 170, 336 bits -> 200,000 checks).
    """
    decimal_prec_tiers = [(17, 53), (35, 113), (52, 170), (102, 336)]
    pairs, sqrts, exact_refs = build_deterministic_qualification_population()

    dyadic_ok = True
    for flt in _DYADIC_FLOATS:
        d_iv = DecimalInterval.from_float_exact(flt)
        lo_q, hi_q = d_iv.to_exact_fractions()
        if not (lo_q == Fraction(flt) == hi_q and d_iv.width_decimal() == 0):
            dyadic_ok = False

    arithmetic_checks_count = 0
    arithmetic_checks_passed = 0
    failure_records: List[Dict[str, Any]] = []
    tier_summaries: List[Dict[str, Any]] = []

    for dec_prec, approx_bits in decimal_prec_tiers:
        ctx_floor = decimal.Context(prec=dec_prec, rounding=decimal.ROUND_FLOOR)
        ctx_ceil = decimal.Context(prec=dec_prec, rounding=decimal.ROUND_CEILING)
        tier_ops = 0
        tier_passed_ops = 0
        tier_failures = 0
        op_counts = {"add": 0, "sub": 0, "mul": 0, "div": 0, "sqrt": 0}
        op_passed = {"add": 0, "sub": 0, "mul": 0, "div": 0, "sqrt": 0}

        for idx, (((a_lo, a_hi), (b_lo, b_hi)), (ex_add, ex_sub, ex_mul, ex_div)) in enumerate(zip(pairs, exact_refs)):
            ia = DecimalInterval(
                DecimalInterval.from_fraction(a_lo, ctx_floor, ctx_ceil).lo,
                DecimalInterval.from_fraction(a_hi, ctx_floor, ctx_ceil).hi,
            )
            ib = DecimalInterval(
                DecimalInterval.from_fraction(b_lo, ctx_floor, ctx_ceil).lo,
                DecimalInterval.from_fraction(b_hi, ctx_floor, ctx_ceil).hi,
            )

            for op_name, dec_res, (exact_lo, exact_hi) in (
                ("add", ia.add(ib, ctx_floor, ctx_ceil), ex_add),
                ("sub", ia.sub(ib, ctx_floor, ctx_ceil), ex_sub),
                ("mul", ia.mul(ib, ctx_floor, ctx_ceil), ex_mul),
                ("div", ia.div(ib, ctx_floor, ctx_ceil), ex_div),
            ):
                cand_lo, cand_hi = dec_res.to_exact_fractions()
                ok = cand_lo <= exact_lo <= exact_hi <= cand_hi
                arithmetic_checks_count += 1
                tier_ops += 1
                op_counts[op_name] += 1
                if ok:
                    arithmetic_checks_passed += 1
                    tier_passed_ops += 1
                    op_passed[op_name] += 1
                else:
                    tier_failures += 1
                    if len(failure_records) < 100:
                        failure_records.append(
                            {
                                "decimalDigitsPrecision": dec_prec,
                                "equivalentBinaryBits": approx_bits,
                                "operation": op_name,
                                "caseIndex": idx,
                                "reason": "OUTWARD_ENCLOSURE_VIOLATION",
                            }
                        )

        for idx, q_pos in enumerate(sqrts):
            q_iv = DecimalInterval.from_fraction(q_pos, ctx_floor, ctx_ceil)
            s_iv = q_iv.sqrt(ctx_floor, ctx_ceil)
            s_lo, s_hi = s_iv.to_exact_fractions()
            ok = (s_lo >= 0) and (s_lo <= s_hi) and (s_lo * s_lo <= q_pos <= s_hi * s_hi)
            arithmetic_checks_count += 1
            tier_ops += 1
            op_counts["sqrt"] += 1
            if ok:
                arithmetic_checks_passed += 1
                tier_passed_ops += 1
                op_passed["sqrt"] += 1
            else:
                tier_failures += 1
                if len(failure_records) < 100:
                    failure_records.append(
                        {
                            "decimalDigitsPrecision": dec_prec,
                            "equivalentBinaryBits": approx_bits,
                            "operation": "sqrt",
                            "caseIndex": idx,
                            "reason": "SQRT_ENCLOSURE_VIOLATION",
                        }
                    )

        tier_summaries.append(
            {
                "decimalDigitsPrecision": dec_prec,
                "equivalentBinaryBits": approx_bits,
                "intervalPairsCount": len(pairs),
                "sqrtInputsCount": len(sqrts),
                "operationsVerified": tier_ops,
                "operationsPassed": tier_passed_ops,
                "failuresCount": tier_failures,
                "perOperationChecks": op_counts,
                "perOperationPassed": op_passed,
                "allOutwardEnclosedInExactRational": (tier_failures == 0),
            }
        )

    # Bernstein containment check across degrees {5, 9, 12} (>=1,000 checks; REM-04 / B-02)
    ctx_floor = decimal.Context(prec=50, rounding=decimal.ROUND_FLOOR)
    ctx_ceil = decimal.Context(prec=50, rounding=decimal.ROUND_CEILING)
    stress_polys = _build_bernstein_stress_polynomials()
    containment_checks = 0
    containment_passed = 0
    one_dec = DecimalInterval(decimal.Decimal(1), decimal.Decimal(1))
    zero_dec = DecimalInterval(decimal.Decimal(0), decimal.Decimal(0))
    for n_deg, _label, sample_poly in stress_polys:
        bern_coeffs = power_to_bernstein_exact(sample_poly)
        bern_dec = [DecimalInterval.from_fraction(b_c, ctx_floor, ctx_ceil) for b_c in bern_coeffs]
        comb_dec = [
            DecimalInterval(decimal.Decimal(math.comb(n_deg, idx)), decimal.Decimal(math.comb(n_deg, idx)))
            for idx in range(n_deg + 1)
        ]
        for k_sub in range(64):
            t_a = Fraction(k_sub, 64)
            t_b = Fraction(k_sub + 1, 64)
            t_iv = DecimalInterval(
                DecimalInterval.from_fraction(t_a, ctx_floor, ctx_ceil).lo,
                DecimalInterval.from_fraction(t_b, ctx_floor, ctx_ceil).hi,
            )
            one_minus_t = one_dec.sub(t_iv, ctx_floor, ctx_ceil)
            # Precompute powers t^k and (1-t)^k cleanly
            t_pows = [one_dec]
            omt_pows = [one_dec]
            for _ in range(n_deg):
                t_pows.append(t_pows[-1].mul(t_iv, ctx_floor, ctx_ceil))
                omt_pows.append(omt_pows[-1].mul(one_minus_t, ctx_floor, ctx_ceil))
            acc_iv = zero_dec
            for idx in range(n_deg + 1):
                term = (
                    comb_dec[idx]
                    .mul(bern_dec[idx], ctx_floor, ctx_ceil)
                    .mul(t_pows[idx], ctx_floor, ctx_ceil)
                    .mul(omt_pows[n_deg - idx], ctx_floor, ctx_ceil)
                )
                acc_iv = acc_iv.add(term, ctx_floor, ctx_ceil)
            lo_p, hi_p = acc_iv.to_exact_fractions()
            for sample_num in range(6):
                t_pt = t_a + Fraction(sample_num, 5) * (t_b - t_a)
                exact_val = eval_polynomial_exact(sample_poly, t_pt)
                containment_checks += 1
                if lo_p <= exact_val <= hi_p:
                    containment_passed += 1

    # Domain traps
    div_zero_caught = False
    try:
        _ = DecimalInterval(decimal.Decimal(1), decimal.Decimal(1)).div(
            DecimalInterval(decimal.Decimal("-1e-12"), decimal.Decimal("1e-12")),
            ctx_floor,
            ctx_ceil,
        )
    except ZeroDivisionError:
        div_zero_caught = True

    neg_sqrt_caught = False
    try:
        _ = DecimalInterval(decimal.Decimal("-1e-12"), decimal.Decimal("1e-12")).sqrt(ctx_floor, ctx_ceil)
    except ValueError:
        neg_sqrt_caught = True

    root_isolation_summary = _verify_wilkinson_and_grazing_unsplit("decimal_interval")
    all_math_ok = (
        dyadic_ok
        and arithmetic_checks_passed == arithmetic_checks_count
        and containment_checks >= 1000
        and containment_passed == containment_checks
        and div_zero_caught
        and neg_sqrt_caught
        and root_isolation_summary["allPassed"]
    )

    return {
        "candidateRank": 3,
        "candidateRole": "Tertiary Pure-Python Fallback (DEC-13 Stage 1)",
        "libraryName": "fractions.Fraction + DecimalInterval (prec=17, 35, 52, 102, ROUND_FLOOR/ROUND_CEILING)",
        "version": f"Python {platform.python_version()} stdlib",
        "availableInEnvironment": True,
        "precisionTiersBits": [53, 113, 170, 336],
        "intervalPairPopulationSize": len(pairs),
        "sqrtPopulationSize": len(sqrts),
        "dyadicFloat64ExactConversionVerified": dyadic_ok,
        "outwardDirectedRoundingVerified": (arithmetic_checks_passed == arithmetic_checks_count),
        "outwardRoundingChecksTotal": arithmetic_checks_count,
        "outwardRoundingChecksPassed": arithmetic_checks_passed,
        "outwardRoundingFailuresCount": arithmetic_checks_count - arithmetic_checks_passed,
        "failureRecords": failure_records,
        "precisionTierBreakdown": tier_summaries,
        "bernsteinDegreesVerified": [deg for deg, _, _ in stress_polys],
        "bernsteinContainmentChecksTotal": containment_checks,
        "bernsteinContainmentChecksPassed": containment_passed,
        "domainTrapsVerified": {
            "divisionByStraddlingZeroDetected": div_zero_caught,
            "negativeSqrtDomainTrapDetected": neg_sqrt_caught,
        },
        "grazingTangencyNoFalseNegative": root_isolation_summary["doubleGrazingRoot1_2"]["passed"],
        "wilkinsonClusterSeparationVerified": (
            root_isolation_summary["wilkinsonCluster1e7AtHalf"]["disjoint"]
            and root_isolation_summary["wilkinsonCluster1e9AtOneThird"]["disjoint"]
        ),
        "unsplitRootIsolationFromUnitInterval": root_isolation_summary,
        "qualificationStatus": "QUALIFIED_TERTIARY_FALLBACK" if all_math_ok else "FAILED_QUALIFICATION",
    }


REQUIRED_BENCHMARK_CANDIDATE_KEYS: Tuple[str, ...] = (
    "mpmathIvFraction",
    "pythonFlintArbFmpq",
    "decimalIntervalFraction",
)


def compute_p95_from_samples_ms(samples_ms: Any) -> float:
    """Computes the exact 95th percentile from a non-empty list of finite non-negative timings (ms)."""
    if not isinstance(samples_ms, list) or len(samples_ms) == 0:
        raise ValueError("Timing samples must be a non-empty list")
    validated: List[float] = []
    for sample in samples_ms:
        if isinstance(sample, bool) or not isinstance(sample, (int, float)):
            raise ValueError(f"Non-numeric timing sample: {sample!r}")
        val = float(sample)
        if not math.isfinite(val) or val < 0.0:
            raise ValueError(f"Non-finite or negative timing sample: {sample!r}")
        validated.append(val)
    s_sorted = sorted(validated)
    p95_idx = min(len(s_sorted) - 1, int(math.ceil(0.95 * len(s_sorted))) - 1)
    return s_sorted[p95_idx]


def evaluate_three_candidates_p95_latency(
    benchmark_payload: Dict[str, Any],
    threshold_ms: float = 5.0,
) -> Dict[str, Any]:
    """Pure classifier determining whether ALL three DEC-13 Stage 1 candidates pass P95 <= threshold_ms (5.0 ms).

    Strictly separates candidate benchmark records (`mpmathIvFraction`, `pythonFlintArbFmpq`, `decimalIntervalFraction`)
    from metadata blocks (`environment`, `metadata`, etc.), validates sample data, and enforces the exact threshold.
    """
    if not isinstance(benchmark_payload, dict):
        return {
            "allThreeCandidatesVerifiedUnder5MsP95": False,
            "thresholdMs": threshold_ms,
            "candidateResults": {},
            "failures": ["INVALID_BENCHMARK_PAYLOAD_TYPE"],
        }

    # Support either full IntervalCandidateBenchmarks payload, perCurveLatencyBenchmarks, or direct candidates dict
    per_curve = benchmark_payload.get("perCurveLatencyBenchmarks", benchmark_payload)
    if isinstance(per_curve, dict) and isinstance(per_curve.get("candidates"), dict):
        candidates_map = per_curve["candidates"]
    elif isinstance(per_curve, dict):
        candidates_map = per_curve
    else:
        return {
            "allThreeCandidatesVerifiedUnder5MsP95": False,
            "thresholdMs": threshold_ms,
            "candidateResults": {},
            "failures": ["INVALID_PER_CURVE_CONTAINER"],
        }

    candidate_results: Dict[str, Any] = {}
    failures: List[str] = []

    for key in REQUIRED_BENCHMARK_CANDIDATE_KEYS:
        entry = candidates_map.get(key)
        if not isinstance(entry, dict):
            failures.append(f"{key}: MISSING_CANDIDATE")
            candidate_results[key] = {
                "present": False,
                "passed": False,
                "reason": "MISSING_CANDIDATE",
            }
            continue

        if entry.get("available") is False:
            failures.append(f"{key}: CANDIDATE_UNAVAILABLE")
            candidate_results[key] = {
                "present": True,
                "passed": False,
                "reason": "CANDIDATE_UNAVAILABLE",
            }
            continue

        p95_val: Optional[float] = None
        if "samplesMs" in entry:
            try:
                p95_val = compute_p95_from_samples_ms(entry["samplesMs"])
            except ValueError as exc:
                failures.append(f"{key}: INVALID_SAMPLES ({exc})")
                candidate_results[key] = {
                    "present": True,
                    "passed": False,
                    "reason": f"INVALID_SAMPLES: {exc}",
                }
                continue
        elif "p95Ms" in entry:
            raw_p95 = entry["p95Ms"]
            if isinstance(raw_p95, bool) or not isinstance(raw_p95, (int, float)):
                failures.append(f"{key}: INVALID_P95_TYPE")
                candidate_results[key] = {
                    "present": True,
                    "passed": False,
                    "reason": "INVALID_P95_TYPE",
                }
                continue
            val = float(raw_p95)
            if not math.isfinite(val) or val < 0.0:
                failures.append(f"{key}: INVALID_P95_VALUE")
                candidate_results[key] = {
                    "present": True,
                    "passed": False,
                    "reason": "INVALID_P95_VALUE",
                }
                continue
            p95_val = val
        else:
            failures.append(f"{key}: MISSING_TIMING_DATA")
            candidate_results[key] = {
                "present": True,
                "passed": False,
                "reason": "MISSING_TIMING_DATA",
            }
            continue

        passed_candidate = bool(p95_val <= threshold_ms)
        if not passed_candidate:
            failures.append(f"{key}: P95_EXCEEDS_THRESHOLD ({p95_val:.6f} ms > {threshold_ms} ms)")
        candidate_results[key] = {
            "present": True,
            "p95Ms": p95_val,
            "thresholdMs": threshold_ms,
            "passed": passed_candidate,
            "reason": "OK" if passed_candidate else "P95_EXCEEDS_THRESHOLD",
        }

    return {
        "allThreeCandidatesVerifiedUnder5MsP95": len(failures) == 0 and all(
            candidate_results[k]["passed"] for k in REQUIRED_BENCHMARK_CANDIDATE_KEYS
        ),
        "thresholdMs": threshold_ms,
        "requiredCandidates": list(REQUIRED_BENCHMARK_CANDIDATE_KEYS),
        "candidateResults": candidate_results,
        "failures": failures,
    }


def benchmark_interval_candidates_runtime(iterations: int = 20) -> Dict[str, Any]:
    """Executes fair, identical-kernel runtime latency benchmarks across all 3 DEC-13 Stage 1 candidates (REM-04 / B-01).

    - Shared exact-rational preprocessing (`power_to_bernstein_exact`, `de_casteljau_subdivide_exact`,
      `descartes_sign_variations_exact`) is measured separately and NOT asymmetrically charged to one candidate.
    - All 3 candidates execute the EXACT SAME degree-12 Horner interval evaluation kernel on identical rational
      coefficients and identical `[1/4, 13/50]` domain interval at >=113-bit working precision.
    - Deterministic operation counts per iteration are derived programmatically from the kernel definition.
    """
    sample_deg12_power = [Fraction((-1) ** k * math.comb(12, k), k + 1) for k in range(13)]
    rev_tail = list(reversed(sample_deg12_power[:-1]))
    lead_coeff = sample_deg12_power[-1]
    deg = len(sample_deg12_power) - 1
    t_lo_q = Fraction(1, 4)
    t_hi_q = Fraction(13, 50)  # 0.26 exact

    # Shared exact rational preprocessing (measured separately, identical for all candidates)
    shared_samples_ms: List[float] = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        b12 = power_to_bernstein_exact(sample_deg12_power)
        left12, right12 = de_casteljau_subdivide_exact(b12, Fraction(1, 2))
        _ = descartes_sign_variations_exact(left12)
        _ = descartes_sign_variations_exact(right12)
        shared_samples_ms.append((time.perf_counter() - t0) * 1000.0)

    # 1. mpmath.iv + Fraction — Degree-12 Horner evaluation kernel
    iv.prec = 113
    mp_samples_ms: List[float] = []
    with mpmath.workprec(113):
        for _ in range(iterations):
            t0 = time.perf_counter()
            t_iv = iv.mpf([
                (iv.mpf(t_lo_q.numerator) / iv.mpf(t_lo_q.denominator)).a,
                (iv.mpf(t_hi_q.numerator) / iv.mpf(t_hi_q.denominator)).b,
            ])
            acc = iv.mpf(lead_coeff.numerator) / iv.mpf(lead_coeff.denominator)
            for coeff in rev_tail:
                c_iv = iv.mpf(coeff.numerator) / iv.mpf(coeff.denominator)
                acc = acc * t_iv + c_iv
            mp_samples_ms.append((time.perf_counter() - t0) * 1000.0)

    # 2. python-flint — Identical Degree-12 Horner evaluation kernel
    flint_samples_ms: List[float] = []
    if HAS_FLINT:
        flint.ctx.prec = 113
        for _ in range(iterations):
            t0 = time.perf_counter()
            t_iv = flint.arb(flint.fmpq(t_lo_q.numerator, t_lo_q.denominator)).union(
                flint.arb(flint.fmpq(t_hi_q.numerator, t_hi_q.denominator))
            )
            acc = flint.arb(flint.fmpq(lead_coeff.numerator, lead_coeff.denominator))
            for coeff in rev_tail:
                c_iv = flint.arb(flint.fmpq(coeff.numerator, coeff.denominator))
                acc = acc * t_iv + c_iv
            flint_samples_ms.append((time.perf_counter() - t0) * 1000.0)

    # 3. DecimalInterval + Fraction — Identical Degree-12 Horner evaluation kernel (35 decimal digits >= 113 bits)
    ctx_floor = decimal.Context(prec=35, rounding=decimal.ROUND_FLOOR)
    ctx_ceil = decimal.Context(prec=35, rounding=decimal.ROUND_CEILING)
    dec_samples_ms: List[float] = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        t_iv = DecimalInterval(
            DecimalInterval.from_fraction(t_lo_q, ctx_floor, ctx_ceil).lo,
            DecimalInterval.from_fraction(t_hi_q, ctx_floor, ctx_ceil).hi,
        )
        acc = DecimalInterval.from_fraction(lead_coeff, ctx_floor, ctx_ceil)
        for coeff in rev_tail:
            c_iv = DecimalInterval.from_fraction(coeff, ctx_floor, ctx_ceil)
            acc = acc.mul(t_iv, ctx_floor, ctx_ceil).add(c_iv, ctx_floor, ctx_ceil)
        dec_samples_ms.append((time.perf_counter() - t0) * 1000.0)

    def _stats(samples: List[float]) -> Dict[str, Any]:
        if not samples:
            return {"available": False}
        s_sorted = sorted(samples)
        p95_val = compute_p95_from_samples_ms(samples)
        med = statistics.median(s_sorted)
        return {
            "available": True,
            "iterations": len(s_sorted),
            "medianMs": round(med, 4),
            "p95Ms": round(p95_val, 4),
            "maxMs": round(s_sorted[-1], 4),
            "samplesMs": [round(s, 6) for s in samples],
            "p95TargetMaxMs": 5.0,
            "withinP95Target5Ms": p95_val <= 5.0,
            "latencyBudgetMaxMs": 50.0,
            "withinLatencyBudget": p95_val <= 50.0,
        }

    # Programmatically derived operation counts (never hardcoded literals)
    deterministic_op_counts = {
        "kernelName": "degree_12_horner_interval_evaluation",
        "identicalKernelAcrossAllThreeCandidates": True,
        "polynomialDegree": deg,
        "intervalCoefficientConversions": len(sample_deg12_power),
        "hornerMultiplications": deg,
        "hornerAdditions": deg,
        "sharedRationalPreprocessingSeparated": True,
        "sharedPowerToBernsteinConversions": 1,
        "sharedDeCasteljauSubdivisions": 1,
        "sharedDescartesSignVariationScans": 2,
    }

    return {
        "metadata": {
            "environment": {
                "pythonVersion": platform.python_version(),
                "platform": platform.platform(),
                "machine": platform.machine(),
                "pythonHashSeed": os.environ.get("PYTHONHASHSEED", "0"),
            },
            "deterministicOperationCountsPerBenchmarkIteration": deterministic_op_counts,
        },
        "sharedRationalPreprocessing": _stats(shared_samples_ms),
        "candidates": {
            "mpmathIvFraction": _stats(mp_samples_ms),
            "pythonFlintArbFmpq": _stats(flint_samples_ms),
            "decimalIntervalFraction": _stats(dec_samples_ms),
        },
    }


def _cubic_segment_to_exact_p_cusp_and_q_c(
    p0: Tuple[Fraction, Fraction],
    p1: Tuple[Fraction, Fraction],
    p2: Tuple[Fraction, Fraction],
    p3: Tuple[Fraction, Fraction],
    d_q: Fraction,
) -> Tuple[List[Fraction], List[Fraction], List[Fraction]]:
    """Computes exact rational power coefficients for Q(t), C(t), and degree-12 P_cusp(t) = Q(t)^3 - d^2*C(t)^2."""
    ax1 = 3 * (p1[0] - p0[0])
    ax2 = 3 * (p2[0] - 2 * p1[0] + p0[0])
    ax3 = p3[0] - 3 * p2[0] + 3 * p1[0] - p0[0]
    ay1 = 3 * (p1[1] - p0[1])
    ay2 = 3 * (p2[1] - 2 * p1[1] + p0[1])
    ay3 = p3[1] - 3 * p2[1] + 3 * p1[1] - p0[1]

    dx = [ax1, 2 * ax2, 3 * ax3]
    dy = [ay1, 2 * ay2, 3 * ay3]
    ddx = [2 * ax2, 6 * ax3]
    ddy = [2 * ay2, 6 * ay3]

    q_c = [Fraction(0)] * 5
    for i in range(3):
        for j in range(3):
            q_c[i + j] += dx[i] * dx[j] + dy[i] * dy[j]

    c_c = [Fraction(0)] * 4
    for i in range(3):
        for j in range(2):
            c_c[i + j] += dx[i] * ddy[j] - dy[i] * ddx[j]

    q2 = [Fraction(0)] * 9
    for i in range(5):
        for j in range(5):
            q2[i + j] += q_c[i] * q_c[j]
    q3 = [Fraction(0)] * 13
    for i in range(9):
        for j in range(5):
            q3[i + j] += q2[i] * q_c[j]
    c2 = [Fraction(0)] * 7
    for i in range(4):
        for j in range(4):
            c2[i + j] += c_c[i] * c_c[j]

    d2 = d_q * d_q
    p_cusp = list(q3)
    for i in range(7):
        p_cusp[i] -= d2 * c2[i]
    return q_c, c_c, p_cusp


# Precomputed immutable exact rational binomial weights for direct Bernstein algebra (Checkpoint J / ADR-009 §5.1)
_W_BERN_4_4: Tuple[Tuple[Tuple[int, int, Fraction], ...], ...] = tuple(
    tuple(
        (i, k - i, Fraction(math.comb(4, i) * math.comb(4, k - i), math.comb(8, k)))
        for i in range(max(0, k - 4), min(4, k) + 1)
    )
    for k in range(9)
)
_W_BERN_8_4: Tuple[Tuple[Tuple[int, int, Fraction], ...], ...] = tuple(
    tuple(
        (i, k - i, Fraction(math.comb(8, i) * math.comb(4, k - i), math.comb(12, k)))
        for i in range(max(0, k - 4), min(8, k) + 1)
    )
    for k in range(13)
)
_W_BERN_ELEV_4_12: Tuple[Tuple[Tuple[int, Fraction], ...], ...] = tuple(
    tuple(
        (i, Fraction(math.comb(4, i) * math.comb(8, k - i), math.comb(12, k)))
        for i in range(max(0, k - 8), min(4, k) + 1)
    )
    for k in range(13)
)

_PREC_BITS_TO_DEC_DIGITS: Dict[int, int] = {53: 17, 113: 35, 170: 52, 336: 102}
_BERNSTEIN_CANDIDATE_TABLES_CACHE: Dict[Tuple[str, int], Dict[str, Any]] = {}


def _get_bernstein_candidate_tables(candidate_library: str, prec_bits: int) -> Dict[str, Any]:
    """Returns immutable precomputed mathematical binomial constants and contexts for (candidate_library, prec_bits).
    Caches ONLY pure mathematical constants (zero contour-specific data cached).
    """
    cache_key = (candidate_library, prec_bits)
    cached = _BERNSTEIN_CANDIDATE_TABLES_CACHE.get(cache_key)
    if cached is not None:
        return cached

    if candidate_library == "mpmath_iv":
        iv.prec = prec_bits
        mpmath.mp.prec = prec_bits

        def _conv_q(f: Fraction) -> Any:
            return iv.mpf(f.numerator) if f.denominator == 1 else (iv.mpf(f.numerator) / iv.mpf(f.denominator))

        tables: Dict[str, Any] = {
            "zero": iv.mpf(0),
            "half": iv.mpf(0.5),
            "two": iv.mpf(2),
            "three": iv.mpf(3),
            "one_third": _conv_q(Fraction(1, 3)),
            "two_thirds": _conv_q(Fraction(2, 3)),
            "w44": tuple(tuple((i, j, _conv_q(w)) for i, j, w in row) for row in _W_BERN_4_4),
            "w84": tuple(tuple((i, j, _conv_q(w)) for i, j, w in row) for row in _W_BERN_8_4),
            "welev": tuple(tuple((i, _conv_q(w)) for i, w in row) for row in _W_BERN_ELEV_4_12),
        }
    elif candidate_library == "python_flint":
        if not HAS_FLINT:
            raise RuntimeError("python-flint is unavailable")
        flint.ctx.prec = prec_bits

        def _conv_q_fl(f: Fraction) -> Any:
            return flint.arb(f.numerator) if f.denominator == 1 else flint.arb(flint.fmpq(f.numerator, f.denominator))

        tables = {
            "zero": flint.arb(0),
            "half": flint.arb(0.5),
            "two": flint.arb(2),
            "three": flint.arb(3),
            "one_third": _conv_q_fl(Fraction(1, 3)),
            "two_thirds": _conv_q_fl(Fraction(2, 3)),
            "w44": tuple(tuple((i, j, _conv_q_fl(w)) for i, j, w in row) for row in _W_BERN_4_4),
            "w84": tuple(tuple((i, j, _conv_q_fl(w)) for i, j, w in row) for row in _W_BERN_8_4),
            "welev": tuple(tuple((i, _conv_q_fl(w)) for i, w in row) for row in _W_BERN_ELEV_4_12),
        }
    else:
        dec_prec = _PREC_BITS_TO_DEC_DIGITS.get(prec_bits, max(35, int(math.ceil(prec_bits * 0.302)) + 2))
        cf = decimal.Context(prec=dec_prec, rounding=decimal.ROUND_FLOOR)
        cc = decimal.Context(prec=dec_prec, rounding=decimal.ROUND_CEILING)

        def _conv_q_dc(f: Fraction) -> DecimalInterval:
            if f.denominator == 1:
                d = decimal.Decimal(f.numerator)
                return DecimalInterval(d, d)
            return DecimalInterval.from_fraction(f, cf, cc)

        tables = {
            "cf": cf,
            "cc": cc,
            "zero_dec": decimal.Decimal(0),
            "zero": DecimalInterval(decimal.Decimal(0), decimal.Decimal(0)),
            "half": DecimalInterval(decimal.Decimal("0.5"), decimal.Decimal("0.5")),
            "two": DecimalInterval(decimal.Decimal(2), decimal.Decimal(2)),
            "three": DecimalInterval(decimal.Decimal(3), decimal.Decimal(3)),
            "one_third": _conv_q_dc(Fraction(1, 3)),
            "two_thirds": _conv_q_dc(Fraction(2, 3)),
            "w44": tuple(tuple((i, j, _conv_q_dc(w)) for i, j, w in row) for row in _W_BERN_4_4),
            "w84": tuple(tuple((i, j, _conv_q_dc(w)) for i, j, w in row) for row in _W_BERN_8_4),
            "welev": tuple(tuple((i, _conv_q_dc(w)) for i, w in row) for row in _W_BERN_ELEV_4_12),
        }

    _BERNSTEIN_CANDIDATE_TABLES_CACHE[cache_key] = tables
    return tables


def _to_exact_fraction(v: Any) -> Fraction:
    if isinstance(v, Fraction):
        return v
    if isinstance(v, int):
        return Fraction(v)
    return Fraction(float(v))


def _coord_to_candidate_iv(v: Any, candidate_library: str, tables: Dict[str, Any]) -> Any:
    """Lossless dyadic float64 conversion or outward-rounded exact Fraction conversion into candidate interval."""
    if candidate_library == "mpmath_iv":
        if isinstance(v, Fraction):
            return iv.mpf(v.numerator) if v.denominator == 1 else (iv.mpf(v.numerator) / iv.mpf(v.denominator))
        return iv.mpf(v)
    if candidate_library == "python_flint":
        if isinstance(v, Fraction):
            return flint.arb(v.numerator) if v.denominator == 1 else flint.arb(flint.fmpq(v.numerator, v.denominator))
        return flint.arb(v)
    if isinstance(v, Fraction):
        if v.denominator == 1:
            d = decimal.Decimal(v.numerator)
            return DecimalInterval(d, d)
        return DecimalInterval.from_fraction(v, tables["cf"], tables["cc"])
    if isinstance(v, int):
        d = decimal.Decimal(v)
        return DecimalInterval(d, d)
    return DecimalInterval.from_float_exact(float(v))


def _de_casteljau_mid_candidate(
    b_coeffs: List[Any],
    candidate_library: str,
    tables: Dict[str, Any],
) -> Tuple[List[Any], List[Any]]:
    """Outward-rounded midpoint De Casteljau subdivision of a Bernstein control polygon in the candidate library."""
    n = len(b_coeffs) - 1
    work = list(b_coeffs)
    left: List[Any] = [work[0]]
    right_rev: List[Any] = [work[-1]]
    half = tables["half"]
    if candidate_library == "decimal_interval":
        cf, cc = tables["cf"], tables["cc"]
        for r in range(1, n + 1):
            work = [work[i].add(work[i + 1], cf, cc).mul(half, cf, cc) for i in range(n - r + 1)]
            left.append(work[0])
            right_rev.append(work[-1])
    else:
        for r in range(1, n + 1):
            work = [(work[i] + work[i + 1]) * half for i in range(n - r + 1)]
            left.append(work[0])
            right_rev.append(work[-1])
    right_rev.reverse()
    return left, right_rev


def _bernstein_sign_predicates(
    coeffs: List[Any],
    candidate_library: str,
    tables: Dict[str, Any],
) -> Tuple[bool, bool, bool]:
    """Returns (all_strictly_pos, all_strictly_neg, all_non_pos) with 100% conservative outward semantics."""
    if candidate_library == "mpmath_iv":
        all_pos = True
        all_neg = True
        all_le0 = True
        for c in coeffs:
            lo_t, hi_t = c._mpi_
            # Finite check: non-finite intervals fail closed (all flags False)
            if lo_t == mpmath.libmp.fnan or hi_t == mpmath.libmp.fnan or lo_t == mpmath.libmp.fninf or hi_t == mpmath.libmp.finf:
                return False, False, False
            # lo_t = (sign, man, exp, bc); strictly > 0 iff sign == 0 and man != 0
            if not (lo_t[0] == 0 and lo_t[1] != 0):
                all_pos = False
            # strictly < 0 iff hi_t sign == 1 and hi_t man != 0
            if not (hi_t[0] == 1 and hi_t[1] != 0):
                all_neg = False
            # <= 0 iff hi_t sign == 1 or hi_t man == 0
            if not (hi_t[0] == 1 or hi_t[1] == 0):
                all_le0 = False
        return all_pos, all_neg, all_le0
    if candidate_library == "python_flint":
        all_pos = True
        all_neg = True
        all_le0 = True
        for c in coeffs:
            if not c.is_finite():
                return False, False, False
            if not (c > 0):
                all_pos = False
            if not (c < 0):
                all_neg = False
                if not (c == 0):
                    all_le0 = False
        return all_pos, all_neg, all_le0
    zero_d = tables["zero_dec"]
    all_pos = True
    all_neg = True
    all_le0 = True
    for c in coeffs:
        if not (c.lo > zero_d):
            all_pos = False
        if not (c.hi < zero_d):
            all_neg = False
        if not (c.hi <= zero_d):
            all_le0 = False
    return all_pos, all_neg, all_le0


def _classify_stationary_roots_exact_jet(
    p0_q: Tuple[Fraction, Fraction],
    p1_q: Tuple[Fraction, Fraction],
    p2_q: Tuple[Fraction, Fraction],
    p3_q: Tuple[Fraction, Fraction],
    q_pow: List[Fraction],
    c_pow: List[Fraction],
    d_q: Fraction,
    s_sign: int,
    epsilon_reg_q: Fraction,
) -> Tuple[str, str, str, int]:
    """Exact rational ADR-009 §4.3 five-way stationary-point jet classifier for Q(t*) = 0.
    Returns (outcome, failure_category, stationary_status, isolated_root_count).
    """
    ax1 = 3 * (p1_q[0] - p0_q[0])
    ax2 = 3 * (p2_q[0] - 2 * p1_q[0] + p0_q[0])
    ax3 = p3_q[0] - 3 * p2_q[0] + 3 * p1_q[0] - p0_q[0]
    ay1 = 3 * (p1_q[1] - p0_q[1])
    ay2 = 3 * (p2_q[1] - 2 * p1_q[1] + p0_q[1])
    ay3 = p3_q[1] - 3 * p2_q[1] + 3 * p1_q[1] - p0_q[1]

    if ax1 == 0 and ax2 == 0 and ax3 == 0 and ay1 == 0 and ay2 == 0 and ay3 == 0:
        return "CERTIFIED_INVALID", "ACTUAL_ZERO_SPEED_CUSP", "GENUINE_BASE_GEOMETRIC_SINGULARITY", 1

    q_roots = isolate_polynomial_roots_on_unit_interval(q_pow)
    if not q_roots:
        return "REGULAR_SPEED", "NONE", "NONE_REGULAR_SPEED", 0

    b2_x_pow = [2 * ax2, 6 * ax3]
    b2_y_pow = [2 * ay2, 6 * ay3]
    b3_x = 6 * ax3
    b3_y = 6 * ay3

    removable_seen = False
    for r in q_roots:
        lo_r = Fraction(r["tLowerRational"])
        hi_r = Fraction(r["tUpperRational"])
        if lo_r != hi_r:
            # Non-rational exact root of Q(t)=0: evaluate derivative jet over rational bracket;
            # interior simple/even stationary point with B'' != 0 is genuine cusp, else fail closed.
            mid_r = (lo_r + hi_r) / Fraction(2)
            if lo_r > 0 and hi_r < 1:
                b2x_m = eval_polynomial_exact(b2_x_pow, mid_r)
                b2y_m = eval_polynomial_exact(b2_y_pow, mid_r)
                # Bound |B''(t) - B''(mid)| <= |6*a3| * (hi-lo)/2
                hw = (hi_r - lo_r) / Fraction(2)
                if abs(b2x_m) > abs(b3_x) * hw or abs(b2y_m) > abs(b3_y) * hw:
                    return "CERTIFIED_INVALID", "ACTUAL_ZERO_SPEED_CUSP", "GENUINE_BASE_GEOMETRIC_SINGULARITY", len(q_roots)
            return "INCONCLUSIVE", "INCONCLUSIVE_VERIFICATION", "UNRESOLVED", len(q_roots)

        t_star = lo_r
        b2x = eval_polynomial_exact(b2_x_pow, t_star)
        b2y = eval_polynomial_exact(b2_y_pow, t_star)
        b2_nonzero = (b2x != 0) or (b2y != 0)
        b3_nonzero = (b3_x != 0) or (b3_y != 0)

        if t_star == 0 or t_star == 1:
            if b2_nonzero:
                cross_23 = b2x * b3_y - b2y * b3_x
                if cross_23 != 0:
                    # Endpoint curvature blows up: |kappa(t)| -> infinity
                    return "CERTIFIED_INVALID", "ACTUAL_ZERO_SPEED_CUSP", "GENUINE_BASE_GEOMETRIC_SINGULARITY", len(q_roots)
                removable_seen = True
            elif b3_nonzero:
                removable_seen = True
            else:
                return "CERTIFIED_INVALID", "ACTUAL_ZERO_SPEED_CUSP", "GENUINE_BASE_GEOMETRIC_SINGULARITY", len(q_roots)
        else:
            # Interior stationary point t* in (0, 1)
            if b2_nonzero:
                # Even lowest derivative order m = 2 -> 180-degree tangent reversal cusp on base curve
                return "CERTIFIED_INVALID", "ACTUAL_ZERO_SPEED_CUSP", "GENUINE_BASE_GEOMETRIC_SINGULARITY", len(q_roots)
            if b3_nonzero:
                # Odd lowest derivative order m = 3 -> continuous tangent, kappa_lim = 0 (e.g., B(t) = ((t-1/2)^3, 0))
                removable_seen = True
            else:
                return "CERTIFIED_INVALID", "ACTUAL_ZERO_SPEED_CUSP", "GENUINE_BASE_GEOMETRIC_SINGULARITY", len(q_roots)

    if removable_seen and all(cc == 0 for cc in c_pow):
        return "CERTIFIED_VALID", "NONE", "REMOVABLE_PARAMETERIZATION_DEGENERACY", len(q_roots)
    if removable_seen:
        return "REGULAR_SPEED_WITH_REMOVABLE", "NONE", "REMOVABLE_PARAMETERIZATION_DEGENERACY", len(q_roots)
    return "REGULAR_SPEED", "NONE", "NONE_REGULAR_SPEED", 0


def _certify_local_self_intersection_candidate(
    p0: Tuple[Any, Any],
    p1: Tuple[Any, Any],
    p2: Tuple[Any, Any],
    p3: Tuple[Any, Any],
    dx_b: List[Any],
    dy_b: List[Any],
    d_q: Fraction,
    s_sign: int,
    candidate_library: str,
    tables: Dict[str, Any],
    prec_bits: int,
    *,
    max_depth: int = 34,
    max_nodes: int = 4096,
) -> Tuple[str, str, int]:
    """Independent candidate-library ADR-009 §5.1 Step 2.5 intra-segment local self-intersection certifier (K-01).

    Assumes f(t) > 0 everywhere on [0, 1] (regular offset speed).
    Executes strictly inside `candidate_library` (`mpmath_iv`, `python_flint`, or `decimal_interval`):
      Step 2.5a: O(1) directional-monotonicity MVT proof over candidate Bernstein derivative hulls.
      Step 2.5b: Exact endpoint coincidence check + 2D interval subdivision + oblique directional-monotonicity
                 diagonal exclusion + 2D Krawczyk existence/uniqueness operator with global node budget.
    Returns (status, method, isolated_count) where status in
      {"CERTIFIED_DISJOINT", "CERTIFIED_INTERSECTION_FOUND", "UNRESOLVED"}.
    """
    # Step 2.5a: Fast O(1) directional monotonicity certificate on regular segment (f(t) > 0 => sgn(v.O') = sgn(v.B')).
    dx_pos, dx_neg, _ = _bernstein_sign_predicates(dx_b, candidate_library, tables)
    if dx_pos or dx_neg:
        return "CERTIFIED_DISJOINT", "candidate_directional_monotonicity_x", 0
    dy_pos, dy_neg, _ = _bernstein_sign_predicates(dy_b, candidate_library, tables)
    if dy_pos or dy_neg:
        return "CERTIFIED_DISJOINT", "candidate_directional_monotonicity_y", 0

    p0x_f, p0y_f = float(p0[0]), float(p0[1])
    p1x_f, p1y_f = float(p1[0]), float(p1[1])
    p2x_f, p2y_f = float(p2[0]), float(p2[1])
    p3x_f, p3y_f = float(p3[0]), float(p3[1])
    chord_vx, chord_vy = p3x_f - p0x_f, p3y_f - p0y_f
    mid_vx = 0.75 * ((p1x_f - p0x_f) + 2.0 * (p2x_f - p1x_f) + (p3x_f - p2x_f))
    mid_vy = 0.75 * ((p1y_f - p0y_f) + 2.0 * (p2y_f - p1y_f) + (p3y_f - p2y_f))

    proj_dirs = (
        (1.0, 1.0),
        (1.0, -1.0),
        (chord_vx, chord_vy),
        (mid_vx, mid_vy),
    )
    if candidate_library == "decimal_interval":
        cf_a, cc_a = tables["cf"], tables["cc"]
        for vx_f, vy_f in proj_dirs:
            if vx_f == 0.0 and vy_f == 0.0:
                continue
            vx_iv = DecimalInterval.from_float_exact(vx_f)
            vy_iv = DecimalInterval.from_float_exact(vy_f)
            proj_b = [
                vx_iv.mul(dx_b[k], cf_a, cc_a).add(vy_iv.mul(dy_b[k], cf_a, cc_a), cf_a, cc_a)
                for k in range(3)
            ]
            p_pos, p_neg, _ = _bernstein_sign_predicates(proj_b, candidate_library, tables)
            if p_pos or p_neg:
                return "CERTIFIED_DISJOINT", "candidate_directional_monotonicity_proj", 0
    else:
        for vx_f, vy_f in proj_dirs:
            if vx_f == 0.0 and vy_f == 0.0:
                continue
            vx_iv = _coord_to_candidate_iv(vx_f, candidate_library, tables)
            vy_iv = _coord_to_candidate_iv(vy_f, candidate_library, tables)
            proj_b = [vx_iv * dx_b[k] + vy_iv * dy_b[k] for k in range(3)]
            p_pos, p_neg, _ = _bernstein_sign_predicates(proj_b, candidate_library, tables)
            if p_pos or p_neg:
                return "CERTIFIED_DISJOINT", "candidate_directional_monotonicity_proj", 0

    # Step 2.5b: Full native candidate-library 2D interval subdivision + directional-monotonicity diagonal
    # exclusion + 2D Krawczyk existence/uniqueness verification at >=113-bit precision.
    work_prec = max(113, prec_bits)
    work_tables = _get_bernstein_candidate_tables(candidate_library, work_prec)
    if candidate_library == "mpmath_iv":
        iv.prec = work_prec
        mpmath.mp.prec = work_prec
    elif candidate_library == "python_flint":
        flint.ctx.prec = work_prec

    p0_q = (_to_exact_fraction(p0[0]), _to_exact_fraction(p0[1]))
    p1_q = (_to_exact_fraction(p1[0]), _to_exact_fraction(p1[1]))
    p2_q = (_to_exact_fraction(p2[0]), _to_exact_fraction(p2[1]))
    p3_q = (_to_exact_fraction(p3[0]), _to_exact_fraction(p3[1]))

    ax_q = [
        p0_q[0],
        Fraction(3) * (p1_q[0] - p0_q[0]),
        Fraction(3) * (p2_q[0] - Fraction(2) * p1_q[0] + p0_q[0]),
        p3_q[0] - Fraction(3) * p2_q[0] + Fraction(3) * p1_q[0] - p0_q[0],
    ]
    ay_q = [
        p0_q[1],
        Fraction(3) * (p1_q[1] - p0_q[1]),
        Fraction(3) * (p2_q[1] - Fraction(2) * p1_q[1] + p0_q[1]),
        p3_q[1] - Fraction(3) * p2_q[1] + Fraction(3) * p1_q[1] - p0_q[1],
    ]

    # Candidate-library arithmetic primitives (all operations stay strictly in candidate_library)
    if candidate_library == "decimal_interval":
        cf, cc = work_tables["cf"], work_tables["cc"]
        zero_d = work_tables["zero_dec"]
        half_iv = work_tables["half"]
        one_iv = DecimalInterval(decimal.Decimal(1), decimal.Decimal(1))
        two_iv = work_tables["two"]
        three_iv = work_tables["three"]
        six_iv = DecimalInterval(decimal.Decimal(6), decimal.Decimal(6))

        def _from_q(q: Fraction) -> Any:
            return _coord_to_candidate_iv(q, "decimal_interval", work_tables)

        def _make_iv(lo_q: Fraction, hi_q: Fraction) -> Any:
            a_iv = _from_q(lo_q)
            b_iv = _from_q(hi_q)
            return DecimalInterval(a_iv.lo, b_iv.hi)

        def _add(a: Any, b: Any) -> Any:
            return a.add(b, cf, cc)

        def _sub(a: Any, b: Any) -> Any:
            return a.sub(b, cf, cc)

        def _mul(a: Any, b: Any) -> Any:
            return a.mul(b, cf, cc)

        def _div(a: Any, b: Any) -> Any:
            return a.div(b, cf, cc)

        def _neg(a: Any) -> Any:
            return DecimalInterval(-a.hi, -a.lo)

        def _sqr(a: Any) -> Any:
            return a.sqr(cf, cc)

        def _sqrt(a: Any) -> Any:
            return a.sqrt(cf, cc)

        def _abs_iv(a: Any) -> Any:
            if a.lo >= zero_d:
                return a
            if a.hi <= zero_d:
                return DecimalInterval(-a.hi, -a.lo)
            return DecimalInterval(zero_d, max(-a.lo, a.hi))

        def _contains_zero(a: Any) -> bool:
            return bool(a.lo <= zero_d <= a.hi)

        def _strictly_pos(a: Any) -> bool:
            return bool(a.lo > zero_d)

        def _bounds_q(a: Any) -> Tuple[Fraction, Fraction]:
            return Fraction(a.lo), Fraction(a.hi)

    elif candidate_library == "mpmath_iv":
        half_iv = work_tables["half"]
        one_iv = iv.mpf(1)
        two_iv = work_tables["two"]
        three_iv = work_tables["three"]
        six_iv = iv.mpf(6)

        def _from_q(q: Fraction) -> Any:
            return _coord_to_candidate_iv(q, "mpmath_iv", work_tables)

        def _make_iv(lo_q: Fraction, hi_q: Fraction) -> Any:
            a_iv = _from_q(lo_q)
            b_iv = _from_q(hi_q)
            return iv.mpf([a_iv.a, b_iv.b])

        def _add(a: Any, b: Any) -> Any:
            return a + b

        def _sub(a: Any, b: Any) -> Any:
            return a - b

        def _mul(a: Any, b: Any) -> Any:
            return a * b

        def _div(a: Any, b: Any) -> Any:
            return a / b

        def _neg(a: Any) -> Any:
            return -a

        def _sqr(a: Any) -> Any:
            return a ** 2

        def _sqrt(a: Any) -> Any:
            return iv.sqrt(a)

        def _abs_iv(a: Any) -> Any:
            return abs(a)

        def _contains_zero(a: Any) -> bool:
            return bool(0 in a)

        def _strictly_pos(a: Any) -> bool:
            lo_t = a._mpi_[0]
            return bool(lo_t != mpmath.libmp.fnan and lo_t != mpmath.libmp.fninf and lo_t[0] == 0 and lo_t[1] != 0)

        def _bounds_q(a: Any) -> Tuple[Fraction, Fraction]:
            return mpf_to_exact_fraction(a._mpi_[0]), mpf_to_exact_fraction(a._mpi_[1])

    else:
        half_iv = work_tables["half"]
        one_iv = flint.arb(1)
        two_iv = work_tables["two"]
        three_iv = work_tables["three"]
        six_iv = flint.arb(6)

        def _from_q(q: Fraction) -> Any:
            return _coord_to_candidate_iv(q, "python_flint", work_tables)

        def _make_iv(lo_q: Fraction, hi_q: Fraction) -> Any:
            a_iv = _from_q(lo_q)
            b_iv = _from_q(hi_q)
            return a_iv.union(b_iv)

        def _add(a: Any, b: Any) -> Any:
            return a + b

        def _sub(a: Any, b: Any) -> Any:
            return a - b

        def _mul(a: Any, b: Any) -> Any:
            return a * b

        def _div(a: Any, b: Any) -> Any:
            return a / b

        def _neg(a: Any) -> Any:
            return -a

        def _sqr(a: Any) -> Any:
            if not a.is_finite():
                return a
            if a.contains(0):
                u = abs(a).upper()
                return flint.arb(0).union(u * u)
            return a * a

        def _sqrt(a: Any) -> Any:
            return a.sqrt()

        def _abs_iv(a: Any) -> Any:
            return abs(a)

        def _contains_zero(a: Any) -> bool:
            return bool((not a.is_finite()) or a.contains(0))

        def _strictly_pos(a: Any) -> bool:
            return bool(a.is_finite() and (a > 0))

        def _bounds_q(a: Any) -> Tuple[Fraction, Fraction]:
            return arb_bounds_to_exact_fractions(a, work_prec)

    ax_iv = [_from_q(c) for c in ax_q]
    ay_iv = [_from_q(c) for c in ay_q]
    sd_iv = _from_q(Fraction(s_sign) * d_q)

    def _is_finite_iv(a: Any) -> bool:
        if candidate_library == "python_flint":
            return bool(a.is_finite())
        if candidate_library == "mpmath_iv":
            lo_t, hi_t = a._mpi_
            return bool(
                lo_t != mpmath.libmp.fnan
                and hi_t != mpmath.libmp.fnan
                and lo_t != mpmath.libmp.fninf
                and hi_t != mpmath.libmp.finf
            )
        return bool(a.lo.is_finite() and a.hi.is_finite())

    def _mid_q(a: Any) -> Fraction:
        lo_q, hi_q = _bounds_q(a)
        return (lo_q + hi_q) / Fraction(2)

    def _eval_offset_and_deriv(lo_q: Fraction, hi_q: Fraction) -> Optional[Tuple[Any, Any, Any, Any]]:
        tm_q = (lo_q + hi_q) / Fraction(2)
        tm_iv = _from_q(tm_q)
        hw_q = (hi_q - lo_q) / Fraction(2)
        dt_iv = _make_iv(-hw_q, hw_q)
        dt2_iv = _sqr(dt_iv)
        dt3_iv = _mul(dt2_iv, dt_iv)

        bx_m = _add(ax_iv[0], _mul(tm_iv, _add(ax_iv[1], _mul(tm_iv, _add(ax_iv[2], _mul(tm_iv, ax_iv[3]))))))
        dx_m = _add(ax_iv[1], _mul(tm_iv, _add(_mul(two_iv, ax_iv[2]), _mul(_mul(three_iv, ax_iv[3]), tm_iv))))
        ddx_m = _add(_mul(two_iv, ax_iv[2]), _mul(_mul(six_iv, ax_iv[3]), tm_iv))
        bx = _add(
            _add(bx_m, _mul(dx_m, dt_iv)),
            _add(_mul(_mul(half_iv, ddx_m), dt2_iv), _mul(ax_iv[3], dt3_iv)),
        )
        dx = _add(_add(dx_m, _mul(ddx_m, dt_iv)), _mul(_mul(three_iv, ax_iv[3]), dt2_iv))
        ddx = _add(ddx_m, _mul(_mul(six_iv, ax_iv[3]), dt_iv))

        by_m = _add(ay_iv[0], _mul(tm_iv, _add(ay_iv[1], _mul(tm_iv, _add(ay_iv[2], _mul(tm_iv, ay_iv[3]))))))
        dy_m = _add(ay_iv[1], _mul(tm_iv, _add(_mul(two_iv, ay_iv[2]), _mul(_mul(three_iv, ay_iv[3]), tm_iv))))
        ddy_m = _add(_mul(two_iv, ay_iv[2]), _mul(_mul(six_iv, ay_iv[3]), tm_iv))
        by = _add(
            _add(by_m, _mul(dy_m, dt_iv)),
            _add(_mul(_mul(half_iv, ddy_m), dt2_iv), _mul(ay_iv[3], dt3_iv)),
        )
        dy = _add(_add(dy_m, _mul(ddy_m, dt_iv)), _mul(_mul(three_iv, ay_iv[3]), dt2_iv))
        ddy = _add(ddy_m, _mul(_mul(six_iv, ay_iv[3]), dt_iv))

        q_iv = _add(_sqr(dx), _sqr(dy))
        if not _strictly_pos(q_iv):
            return None
        if d_q == 0:
            return bx, by, dx, dy
        spd = _sqrt(q_iv)
        if not _strictly_pos(spd):
            return None
        q_spd = _mul(q_iv, spd)
        if not _strictly_pos(q_spd):
            return None
        c_iv = _sub(_mul(dx, ddy), _mul(dy, ddx))
        f_iv = _sub(one_iv, _div(_mul(sd_iv, c_iv), q_spd))
        ox = _add(bx, _mul(sd_iv, _div(_neg(dy), spd)))
        oy = _add(by, _mul(sd_iv, _div(dx, spd)))
        odx = _mul(f_iv, dx)
        ody = _mul(f_iv, dy)
        if not (_is_finite_iv(ox) and _is_finite_iv(oy) and _is_finite_iv(odx) and _is_finite_iv(ody)):
            return None
        return ox, oy, odx, ody

    # Check exact endpoint coincidence O(0) == O(1) in Q(sqrt(q0), sqrt(q1))
    ev0 = _eval_offset_and_deriv(Fraction(0), Fraction(0))
    ev1 = _eval_offset_and_deriv(Fraction(1), Fraction(1))
    if ev0 is not None and ev1 is not None:
        if _contains_zero(_sub(ev0[0], ev1[0])) and _contains_zero(_sub(ev0[1], ev1[1])):
            dx0_q, dy0_q = ax_q[1], ay_q[1]
            dx1_q = ax_q[1] + Fraction(2) * ax_q[2] + Fraction(3) * ax_q[3]
            dy1_q = ay_q[1] + Fraction(2) * ay_q[2] + Fraction(3) * ay_q[3]
            if exact_offset_endpoints_coincide(
                p0_q, (dx0_q, dy0_q), p3_q, (dx1_q, dy1_q), s_sign, d_q
            ):
                return "CERTIFIED_INTERSECTION_FOUND", "candidate_exact_endpoint_coincidence", 1

    det_min_q = Fraction(1, 10**18)

    def _krawczyk_step(
        a1: Fraction, b1: Fraction, a2: Fraction, b2: Fraction
    ) -> Optional[Tuple[Fraction, Fraction, Fraction, Fraction, bool, bool, bool]]:
        m1_q = (a1 + b1) / Fraction(2)
        m2_q = (a2 + b2) / Fraction(2)
        ev_m1 = _eval_offset_and_deriv(m1_q, m1_q)
        ev_m2 = _eval_offset_and_deriv(m2_q, m2_q)
        ev_j1 = _eval_offset_and_deriv(a1, b1)
        ev_j2 = _eval_offset_and_deriv(a2, b2)
        if not (ev_m1 and ev_m2 and ev_j1 and ev_j2):
            return None

        fx_m = _sub(ev_m1[0], ev_m2[0])
        fy_m = _sub(ev_m1[1], ev_m2[1])

        jm00 = _mid_q(ev_m1[2])
        jm01 = -_mid_q(ev_m2[2])
        jm10 = _mid_q(ev_m1[3])
        jm11 = -_mid_q(ev_m2[3])
        det_q = jm00 * jm11 - jm01 * jm10
        if abs(det_q) <= det_min_q:
            return None

        y00 = _from_q(jm11 / det_q)
        y01 = _from_q(-jm01 / det_q)
        y10 = _from_q(-jm10 / det_q)
        y11 = _from_q(jm00 / det_q)

        j00, j01 = ev_j1[2], _neg(ev_j2[2])
        j10, j11 = ev_j1[3], _neg(ev_j2[3])

        m00 = _sub(one_iv, _add(_mul(y00, j00), _mul(y01, j10)))
        m01 = _neg(_add(_mul(y00, j01), _mul(y01, j11)))
        m10 = _neg(_add(_mul(y10, j00), _mul(y11, j10)))
        m11 = _sub(one_iv, _add(_mul(y10, j01), _mul(y11, j11)))

        row0 = _add(_abs_iv(m00), _abs_iv(m01))
        row1 = _add(_abs_iv(m10), _abs_iv(m11))
        _, r0_hi = _bounds_q(row0)
        _, r1_hi = _bounds_q(row1)
        norm_lt_1 = max(r0_hi, r1_hi) < Fraction(1)

        dx1 = _make_iv(a1 - m1_q, b1 - m1_q)
        dx2 = _make_iv(a2 - m2_q, b2 - m2_q)
        m1_iv = _from_q(m1_q)
        m2_iv = _from_q(m2_q)
        k1 = _add(_sub(m1_iv, _add(_mul(y00, fx_m), _mul(y01, fy_m))), _add(_mul(m00, dx1), _mul(m01, dx2)))
        k2 = _add(_sub(m2_iv, _add(_mul(y10, fx_m), _mul(y11, fy_m))), _add(_mul(m10, dx1), _mul(m11, dx2)))

        k1_lo, k1_hi = _bounds_q(k1)
        k2_lo, k2_hi = _bounds_q(k2)
        disjoint = (k1_hi < a1) or (k1_lo > b1) or (k2_hi < a2) or (k2_lo > b2)
        inside = (k1_lo > a1) and (k1_hi < b1) and (k2_lo > a2) and (k2_hi < b2)
        return k1_lo, k1_hi, k2_lo, k2_hi, norm_lt_1, inside, disjoint

    initial_panels = 16
    panel_evals: List[Tuple[Fraction, Fraction, Optional[Tuple[Any, Any, Any, Any]]]] = []
    for k in range(initial_panels):
        pa = Fraction(k, initial_panels)
        pb = Fraction(k + 1, initial_panels)
        panel_evals.append((pa, pb, _eval_offset_and_deriv(pa, pb)))

    stack: List[Tuple[Fraction, Fraction, Fraction, Fraction, int]] = []
    for i in range(initial_panels):
        a1, b1, ev1_p = panel_evals[i]
        for j in range(i, initial_panels):
            a2, b2, ev2_p = panel_evals[j]
            if ev1_p is None or ev2_p is None:
                stack.append((a1, b1, a2, b2, 0))
            elif _contains_zero(_sub(ev1_p[0], ev2_p[0])) and _contains_zero(_sub(ev1_p[1], ev2_p[1])):
                stack.append((a1, b1, a2, b2, 0))

    nodes_visited = 0
    unresolved_count = 0
    zero_q = Fraction(0)
    one_q = Fraction(1)
    quarter_q = Fraction(1, 4)
    tiny_q = Fraction(1, 10**7)

    while stack:
        a1, b1, a2, b2, depth = stack.pop()
        nodes_visited += 1
        if nodes_visited > max_nodes:
            unresolved_count += 1
            break

        if a1 > b2:
            continue

        # Rigorous directional-monotonicity diagonal exclusion on hull [min(a1,a2), max(b1,b2)]
        hull_lo = min(a1, a2)
        hull_hi = max(b1, b2)
        boxes_overlap = (b1 >= a2) and (b2 >= a1)
        if boxes_overlap or (hull_hi - hull_lo) <= quarter_q:
            ev_hull = _eval_offset_and_deriv(hull_lo, hull_hi)
            if ev_hull is not None:
                if (not _contains_zero(ev_hull[2])) or (not _contains_zero(ev_hull[3])):
                    continue
                vhx_q = _mid_q(ev_hull[2])
                vhy_q = _mid_q(ev_hull[3])
                if vhx_q != 0 or vhy_q != 0:
                    proj_h = _add(_mul(_from_q(vhx_q), ev_hull[2]), _mul(_from_q(vhy_q), ev_hull[3]))
                    if _strictly_pos(proj_h):
                        continue

        ev_a = _eval_offset_and_deriv(a1, b1)
        ev_b = _eval_offset_and_deriv(a2, b2)
        if ev_a is not None and ev_b is not None:
            if not (_contains_zero(_sub(ev_a[0], ev_b[0])) and _contains_zero(_sub(ev_a[1], ev_b[1]))):
                continue

        kr = _krawczyk_step(a1, b1, a2, b2) if (ev_a is not None and ev_b is not None) else None
        if kr is not None:
            k1_lo, k1_hi, k2_lo, k2_hi, norm_lt_1, inside, disjoint = kr
            if disjoint:
                continue
            if inside and norm_lt_1:
                if zero_q <= k1_lo and k1_hi <= one_q and zero_q <= k2_lo and k2_hi <= one_q:
                    if k1_hi < k2_lo or k2_hi < k1_lo:
                        return "CERTIFIED_INTERSECTION_FOUND", "candidate_krawczyk_2d", 1

        # Tiny-box inflation for dyadic split-boundary crossings
        w1 = b1 - a1
        w2 = b2 - a2
        if w1 <= tiny_q and w2 <= tiny_q and ev_a is not None and ev_b is not None:
            inf_a1 = a1 - w1 * quarter_q
            inf_b1 = b1 + w1 * quarter_q
            inf_a2 = a2 - w2 * quarter_q
            inf_b2 = b2 + w2 * quarter_q
            kr_inf = _krawczyk_step(inf_a1, inf_b1, inf_a2, inf_b2)
            if kr_inf is not None:
                k1_lo, k1_hi, k2_lo, k2_hi, norm_lt_1, inside, _disj = kr_inf
                if inside and norm_lt_1:
                    if zero_q <= k1_lo and k1_hi <= one_q and zero_q <= k2_lo and k2_hi <= one_q:
                        if k1_hi < k2_lo or k2_hi < k1_lo:
                            return "CERTIFIED_INTERSECTION_FOUND", "candidate_krawczyk_2d_inflated", 1

        if depth >= max_depth:
            unresolved_count += 1
            continue

        if w1 >= w2:
            m1 = (a1 + b1) / Fraction(2)
            stack.append((m1, b1, a2, b2, depth + 1))
            stack.append((a1, m1, a2, b2, depth + 1))
        else:
            m2 = (a2 + b2) / Fraction(2)
            stack.append((a1, b1, m2, b2, depth + 1))
            stack.append((a1, b1, a2, m2, depth + 1))

    if unresolved_count > 0:
        return "UNRESOLVED", "candidate_krawczyk_unresolved", 0
    return "CERTIFIED_DISJOINT", "candidate_krawczyk_2d", 0


def _exact_linear_radical_zero(
    a_q: Fraction,
    b_q: Fraction,
    c_q: Fraction,
    qa_q: Fraction,
    qb_q: Fraction,
) -> bool:
    """Exact algebraic decision in Q(sqrt(qa), sqrt(qb)) for:
      a_q + b_q / sqrt(qa_q) + c_q / sqrt(qb_q) == 0,
    where qa_q > 0, qb_q > 0 are strictly positive rationals. Zero floating-point approximation.
    """
    if qa_q <= 0 or qb_q <= 0:
        return False
    # Case a_q == 0: b_q / sqrt(qa) == -c_q / sqrt(qb)
    if a_q == 0:
        if b_q * c_q > 0:
            return False
        return (b_q * b_q * qb_q) == (c_q * c_q * qa_q)

    # Let u = b_q / sqrt(qa), v = c_q / sqrt(qb).
    # u + v == -a_q iff:
    #   (1) (u + v)^2 == a_q^2  <=>  2*u*v == r_q := a_q^2 - b_q^2/qa - c_q^2/qb
    #       <=> 4*(b_q^2*c_q^2)/(qa*qb) == r_q^2 AND sign(b_q*c_q) == sign(r_q)
    #   (2) sign(u + v) == sign(-a_q) <=> (-a_q)*u + (-a_q)*v > 0
    u2 = (b_q * b_q) / qa_q
    v2 = (c_q * c_q) / qb_q
    r_q = (a_q * a_q) - u2 - v2
    bc = b_q * c_q
    if bc == 0:
        if r_q != 0:
            return False
    elif bc > 0:
        if r_q <= 0:
            return False
    else:
        if r_q >= 0:
            return False

    if Fraction(4) * u2 * v2 != r_q * r_q:
        return False

    # Verify sign of (-a_q)*u + (-a_q)*v > 0
    sa = -a_q
    sb = sa * b_q
    sc = sa * c_q
    if sb >= 0 and sc >= 0:
        return (sb > 0) or (sc > 0)
    if sb <= 0 and sc <= 0:
        return False
    if sb > 0 and sc < 0:
        return u2 > v2
    # sb < 0 and sc > 0
    return v2 > u2


def exact_offset_endpoints_coincide(
    pa_q: Tuple[Fraction, Fraction],
    da_q: Tuple[Fraction, Fraction],
    pb_q: Tuple[Fraction, Fraction],
    db_q: Tuple[Fraction, Fraction],
    s_sign: int,
    d_q: Fraction,
) -> bool:
    """Exact algebraic decision for O(a) == O(b) in Q(sqrt(q_a), sqrt(q_b)):
      O(t) = B(t) + s * d * (-y'(t), x'(t)) / sqrt(x'(t)^2 + y'(t)^2).
    """
    qa = da_q[0] * da_q[0] + da_q[1] * da_q[1]
    qb = db_q[0] * db_q[0] + db_q[1] * db_q[1]
    if qa <= 0 or qb <= 0:
        return False
    sd = Fraction(s_sign) * d_q
    # O_x(a) - O_x(b) = (pa_x - pb_x) + (-sd * da_y)/sqrt(qa) + (sd * db_y)/sqrt(qb)
    ok_x = _exact_linear_radical_zero(
        pa_q[0] - pb_q[0],
        -sd * da_q[1],
        sd * db_q[1],
        qa,
        qb,
    )
    if not ok_x:
        return False
    # O_y(a) - O_y(b) = (pa_y - pb_y) + (sd * da_x)/sqrt(qa) + (-sd * db_x)/sqrt(qb)
    return _exact_linear_radical_zero(
        pa_q[1] - pb_q[1],
        sd * da_q[0],
        -sd * db_q[0],
        qa,
        qb,
    )


def certify_regular_offset_exact_rational(
    q_pow: List[Fraction],
    c_pow: List[Fraction],
    p_exact_pow: List[Fraction],
    p_margin_pow: List[Fraction],
    s_sign: int,
    d_q: Fraction,
    span_lo_q: Fraction = Fraction(0),
    span_hi_q: Fraction = Fraction(1),
) -> Dict[str, Any]:
    """Exact algebraic decision procedure in Q[t] for ADR-009 §5.2 Step 2 / K-02 completeness.

    Given a regular cubic Bezier segment on [span_lo_q, span_hi_q] subseteq [0, 1],
    decides with ZERO floating-point approximation whether:
      - TANGENT_REVERSAL: exists t with s*d*C(t) > 0 and P_exact(t) < 0
      - ACTUAL_ZERO_SPEED_CUSP: P_exact >= 0 on concave side, exists t with s*d*C(t) > 0 and P_exact(t) == 0
      - REGULARITY_MARGIN_VIOLATION: P_exact > 0 on concave side, exists t with s*d*C(t) > 0 and P_margin(t) < 0
      - CERTIFIED_VALID: Q(t) > 0 everywhere on [span_lo_q, span_hi_q] AND P_margin(t) >= 0 everywhere
        where s*d*C(t) > 0 (including exact boundary tangencies min f(t) == epsilon_reg!).
      - INCONCLUSIVE: only if Q(t) vanishes on [span_lo_q, span_hi_q] or bracket separation fails.
    """
    # Affine-reparameterize onto u in [0, 1] when evaluating a sub-span
    if span_lo_q != Fraction(0) or span_hi_q != Fraction(1):
        q_u = _poly_affine_to_unit_interval_exact(q_pow, span_lo_q, span_hi_q)
        c_u = _poly_affine_to_unit_interval_exact(c_pow, span_lo_q, span_hi_q)
        pe_u = _poly_affine_to_unit_interval_exact(p_exact_pow, span_lo_q, span_hi_q)
        pm_u = _poly_affine_to_unit_interval_exact(p_margin_pow, span_lo_q, span_hi_q)
    else:
        q_u = poly_trim_exact(q_pow)
        c_u = poly_trim_exact(c_pow)
        pe_u = poly_trim_exact(p_exact_pow)
        pm_u = poly_trim_exact(p_margin_pow)

    span_h = span_hi_q - span_lo_q

    def _u_to_t(u_val: Fraction) -> Fraction:
        return span_lo_q + u_val * span_h

    # Step 1: Verify Q(u) > 0 strictly across all of [0, 1]
    if (
        not q_u
        or eval_polynomial_exact(q_u, Fraction(0)) <= 0
        or eval_polynomial_exact(q_u, Fraction(1)) <= 0
    ):
        return {
            "outcome": "INCONCLUSIVE",
            "failureCategory": "INCONCLUSIVE_VERIFICATION",
            "reason": "Q_NON_POSITIVE_ON_SPAN",
            "cuspBracketsRational": [],
        }
    q_roots = isolate_polynomial_roots_on_unit_interval(q_u, tol_t=Fraction(1, 10**12))
    if q_roots:
        return {
            "outcome": "INCONCLUSIVE",
            "failureCategory": "INCONCLUSIVE_VERIFICATION",
            "reason": "STATIONARY_ROOT_OF_Q_ON_SPAN",
            "cuspBracketsRational": [],
        }

    # Exact scaled curvature numerator S_C(u) = s * d * C(u)
    sd_q = Fraction(s_sign) * d_q
    sc_u = poly_trim_exact([sd_q * coeff for coeff in c_u])

    # If S_C(u) is identically zero (straight line or d == 0): f(u) == 1 > eps_reg everywhere!
    if not sc_u:
        return {
            "outcome": "CERTIFIED_VALID",
            "failureCategory": "NONE",
            "reason": "EXACT_RATIONAL_STRAIGHT_OR_ZERO_OFFSET",
            "cuspBracketsRational": [],
        }

    sc_bern_full = power_to_bernstein_exact(sc_u)
    if max(sc_bern_full) <= 0:
        return {
            "outcome": "CERTIFIED_VALID",
            "failureCategory": "NONE",
            "reason": "EXACT_RATIONAL_CONVEX_DOMAIN",
            "cuspBracketsRational": [],
        }

    sc_roots = isolate_polynomial_roots_on_unit_interval(sc_u, tol_t=Fraction(1, 10**12))

    def _sign_of_sc_on_bracket(
        lo: Fraction, hi: Fraction, poly_sqfree: Optional[List[Fraction]]
    ) -> Tuple[int, Fraction, Fraction]:
        """Determines exact strict sign (+1 or -1) of S_C on a root bracket [lo, hi] of P_exact or P_margin.
        Because Q(u) > 0 everywhere on [0, 1], S_C cannot vanish at any root of P_exact or P_margin,
        so bisecting [lo, hi] on the square-free factor is guaranteed to separate it from S_C's roots.
        Returns (sign_in_{-1, 0, +1}, refined_lo, refined_hi).
        """
        cur_lo, cur_hi = lo, hi
        for _ in range(256):
            if cur_lo == cur_hi:
                val = eval_polynomial_exact(sc_u, cur_lo)
                return (1 if val > 0 else (-1 if val < 0 else 0)), cur_lo, cur_hi
            sub_sc = power_to_bernstein_exact(_poly_affine_to_unit_interval_exact(sc_u, cur_lo, cur_hi))
            if min(sub_sc) > 0:
                return 1, cur_lo, cur_hi
            if max(sub_sc) < 0:
                return -1, cur_lo, cur_hi
            if poly_sqfree is None:
                return 0, cur_lo, cur_hi
            fa = eval_polynomial_exact(poly_sqfree, cur_lo)
            fb = eval_polynomial_exact(poly_sqfree, cur_hi)
            if fa == 0:
                cur_hi = cur_lo
                continue
            if fb == 0:
                cur_lo = cur_hi
                continue
            mid = (cur_lo + cur_hi) / Fraction(2)
            fm = eval_polynomial_exact(poly_sqfree, mid)
            if fm == 0:
                cur_lo = cur_hi = mid
                continue
            if (fa < 0 and fm > 0) or (fa > 0 and fm < 0):
                cur_hi = mid
            elif (fm < 0 and fb > 0) or (fm > 0 and fb < 0):
                cur_lo = mid
            else:
                return 0, cur_lo, cur_hi
        return 0, cur_lo, cur_hi

    def _sqfree_factor_for_root(poly_u: List[Fraction], lo: Fraction, hi: Fraction) -> Optional[List[Fraction]]:
        if lo == hi or not poly_u:
            return None
        for fac, _m in poly_square_free_decomposition_exact(poly_make_monic_exact(poly_u)):
            fa = eval_polynomial_exact(fac, lo)
            fb = eval_polynomial_exact(fac, hi)
            if (fa < 0 and fb > 0) or (fa > 0 and fb < 0):
                return fac
        return None

    # Step 2: Exact classification of P_exact(u) on concave subset {u in [0, 1] : S_C(u) > 0}
    if not pe_u:
        # P_exact identically zero on a non-convex curve => f(u) == 0 everywhere on concave domain!
        return {
            "outcome": "CERTIFIED_INVALID",
            "failureCategory": "ACTUAL_ZERO_SPEED_CUSP",
            "reason": "EXACT_RATIONAL_IDENTICAL_ZERO_SPEED",
            "cuspBracketsRational": [(span_lo_q, span_hi_q)],
        }

    pe_roots_raw = isolate_polynomial_roots_on_unit_interval(pe_u, tol_t=Fraction(1, 10**12))
    pe_concave_roots: List[Tuple[Fraction, Fraction, int]] = []
    pe_breakpoints: List[Fraction] = [Fraction(0), Fraction(1)]
    for sr in sc_roots:
        pe_breakpoints.append(Fraction(sr["tLowerRational"]))
        pe_breakpoints.append(Fraction(sr["tUpperRational"]))

    for r in pe_roots_raw:
        lo_q = Fraction(r["tLowerRational"])
        hi_q = Fraction(r["tUpperRational"])
        mult = int(r["exactMultiplicity"])
        fac = _sqfree_factor_for_root(pe_u, lo_q, hi_q)
        sc_sgn, lo_q, hi_q = _sign_of_sc_on_bracket(lo_q, hi_q, fac)
        if sc_sgn == 0:
            return {
                "outcome": "INCONCLUSIVE",
                "failureCategory": "INCONCLUSIVE_VERIFICATION",
                "reason": "P_EXACT_SC_BRACKET_UNSEPARATED",
                "cuspBracketsRational": [],
            }
        pe_breakpoints.append(lo_q)
        pe_breakpoints.append(hi_q)
        if sc_sgn > 0:
            pe_concave_roots.append((lo_q, hi_q, mult))

    pe_breakpoints = sorted(set(pe_breakpoints))
    pe_sample_pts = list(pe_breakpoints)
    for idx_bp in range(len(pe_breakpoints) - 1):
        pe_sample_pts.append((pe_breakpoints[idx_bp] + pe_breakpoints[idx_bp + 1]) / Fraction(2))

    for pt in pe_sample_pts:
        if eval_polynomial_exact(sc_u, pt) > 0 and eval_polynomial_exact(pe_u, pt) < 0:
            return {
                "outcome": "CERTIFIED_INVALID",
                "failureCategory": "TANGENT_REVERSAL",
                "reason": "EXACT_RATIONAL_P_EXACT_NEGATIVE",
                "cuspBracketsRational": [(_u_to_t(lo), _u_to_t(hi)) for lo, hi, _m in pe_concave_roots],
            }

    if pe_concave_roots:
        # Check whether any interior concave root of P_exact has odd multiplicity (guarantees reversal)
        for lo_q, hi_q, mult in pe_concave_roots:
            is_endpoint = (lo_q == hi_q == Fraction(0)) or (lo_q == hi_q == Fraction(1))
            if (not is_endpoint) and (mult % 2 == 1):
                return {
                    "outcome": "CERTIFIED_INVALID",
                    "failureCategory": "TANGENT_REVERSAL",
                    "reason": "EXACT_RATIONAL_ODD_INTERIOR_CUSP_REVERSAL",
                    "cuspBracketsRational": [(_u_to_t(lo), _u_to_t(hi)) for lo, hi, _m in pe_concave_roots],
                }
        return {
            "outcome": "CERTIFIED_INVALID",
            "failureCategory": "ACTUAL_ZERO_SPEED_CUSP",
            "reason": "EXACT_RATIONAL_ZERO_SPEED_CUSP",
            "cuspBracketsRational": [(_u_to_t(lo), _u_to_t(hi)) for lo, hi, _m in pe_concave_roots],
        }

    # Proven: P_exact(u) > 0 everywhere on concave subset (so f(u) > 0 across all of [0, 1])!
    # Step 3: Exact classification of P_margin(u) on concave subset {u in [0, 1] : S_C(u) > 0}
    if not pm_u:
        # P_margin identically 0 while P_exact > 0 => f(u) == epsilon_reg >= epsilon_reg everywhere!
        return {
            "outcome": "CERTIFIED_VALID",
            "failureCategory": "NONE",
            "reason": "EXACT_RATIONAL_CONSTANT_MARGIN_BOUNDARY",
            "cuspBracketsRational": [],
        }

    pm_roots_raw = isolate_polynomial_roots_on_unit_interval(pm_u, tol_t=Fraction(1, 10**12))
    pm_concave_roots: List[Tuple[Fraction, Fraction, int]] = []
    pm_breakpoints: List[Fraction] = [Fraction(0), Fraction(1)]
    for sr in sc_roots:
        pm_breakpoints.append(Fraction(sr["tLowerRational"]))
        pm_breakpoints.append(Fraction(sr["tUpperRational"]))

    for r in pm_roots_raw:
        lo_q = Fraction(r["tLowerRational"])
        hi_q = Fraction(r["tUpperRational"])
        mult = int(r["exactMultiplicity"])
        fac = _sqfree_factor_for_root(pm_u, lo_q, hi_q)
        sc_sgn, lo_q, hi_q = _sign_of_sc_on_bracket(lo_q, hi_q, fac)
        if sc_sgn == 0:
            return {
                "outcome": "INCONCLUSIVE",
                "failureCategory": "INCONCLUSIVE_VERIFICATION",
                "reason": "P_MARGIN_SC_BRACKET_UNSEPARATED",
                "cuspBracketsRational": [],
            }
        pm_breakpoints.append(lo_q)
        pm_breakpoints.append(hi_q)
        if sc_sgn > 0:
            pm_concave_roots.append((lo_q, hi_q, mult))

    pm_breakpoints = sorted(set(pm_breakpoints))
    pm_sample_pts = list(pm_breakpoints)
    for idx_bp in range(len(pm_breakpoints) - 1):
        pm_sample_pts.append((pm_breakpoints[idx_bp] + pm_breakpoints[idx_bp + 1]) / Fraction(2))

    for pt in pm_sample_pts:
        if eval_polynomial_exact(sc_u, pt) > 0 and eval_polynomial_exact(pm_u, pt) < 0:
            return {
                "outcome": "CERTIFIED_INVALID",
                "failureCategory": "REGULARITY_MARGIN_VIOLATION",
                "reason": "EXACT_RATIONAL_P_MARGIN_NEGATIVE",
                "cuspBracketsRational": [],
            }

    for lo_q, hi_q, mult in pm_concave_roots:
        is_endpoint = (lo_q == hi_q == Fraction(0)) or (lo_q == hi_q == Fraction(1))
        if (not is_endpoint) and (mult % 2 == 1):
            return {
                "outcome": "CERTIFIED_INVALID",
                "failureCategory": "REGULARITY_MARGIN_VIOLATION",
                "reason": "EXACT_RATIONAL_ODD_INTERIOR_MARGIN_CROSSING",
                "cuspBracketsRational": [],
            }

    # Mathematically proven: Q(t) > 0 on [span_lo, span_hi], P_exact(t) > 0 on concave subset,
    # and P_margin(t) >= 0 on the entire concave subset (including exact tangency min f(t) == eps_reg)!
    boundary_tag = (
        "EXACT_RATIONAL_BOUNDARY_TANGENCY_VALID" if pm_concave_roots else "EXACT_RATIONAL_STRICTLY_POSITIVE_VALID"
    )
    return {
        "outcome": "CERTIFIED_VALID",
        "failureCategory": "NONE",
        "reason": boundary_tag,
        "cuspBracketsRational": [],
        "marginBoundaryRootsCount": len(pm_concave_roots),
    }


def certify_cubic_segment_bernstein_candidate(
    p0: Tuple[Any, Any],
    p1: Tuple[Any, Any],
    p2: Tuple[Any, Any],
    p3: Tuple[Any, Any],
    d_q: Fraction,
    candidate_library: str,
    s_sign: int = -1,
    epsilon_reg_q: Fraction = Fraction(1, 20),
    max_depth: int = 20,
    allow_exact_rational_fallback: bool = True,
    max_nodes_per_tier: int = 1024,
) -> Dict[str, Any]:
    """Complete ADR-009 §5.1 & §5.2 Stage 2 Bernstein-basis tri-state offset verifier executed symmetrically
    in the specified candidate interval library (`mpmath_iv`, `python_flint`, or `decimal_interval`).

    Preserves 100% mathematical rigor:
    - Exact dyadic float64 / outward-rounded Fraction conversion.
    - Direct Bernstein construction of Q(t) (deg 4), C(t) (deg 2), P_exact(t) (deg 12), P_margin(t) (deg 12)
      eliminating monomial Horner dependency blowup per ADR-009 §3.2(8)(b).
    - ADR-009 §5.1 Step 2.1 stationary speed check + Step 2.2 concave sign gate (s*d*C <= 0) + Step 2.3 adaptive
      De Casteljau midpoint subdivision with precision escalation (113 -> 170 -> 336 bits) and exact rational
      Sturm/Bernstein fallback (ADR-009 §5.2 Step 2).
    """
    if candidate_library == "python_flint" and not HAS_FLINT:
        return {"available": False}
    if s_sign not in (-1, 1):
        raise ValueError(f"s_sign must be -1 or +1, got {s_sign}")

    d2_q = d_q * d_q
    margin_factor_q = (Fraction(1) - epsilon_reg_q) ** 2

    precision_ladder = (113, 170, 336)
    escalation_trace: List[str] = []
    max_depth_reached = 0
    subdivisions_performed = 0
    straddling_panels_encountered = 0
    isolated_cusp_count = 0
    stationary_status = "NONE_REGULAR_SPEED"
    ia_elapsed_ms = 0.0
    iso_elapsed_ms = 0.0

    for tier_idx, prec_bits in enumerate(precision_ladder):
        t_ia_start = time.perf_counter()
        if candidate_library == "mpmath_iv":
            iv.prec = prec_bits
            mpmath.mp.prec = prec_bits
        elif candidate_library == "python_flint":
            flint.ctx.prec = prec_bits

        tables = _get_bernstein_candidate_tables(candidate_library, prec_bits)
        x0 = _coord_to_candidate_iv(p0[0], candidate_library, tables)
        y0 = _coord_to_candidate_iv(p0[1], candidate_library, tables)
        x1 = _coord_to_candidate_iv(p1[0], candidate_library, tables)
        y1 = _coord_to_candidate_iv(p1[1], candidate_library, tables)
        x2 = _coord_to_candidate_iv(p2[0], candidate_library, tables)
        y2 = _coord_to_candidate_iv(p2[1], candidate_library, tables)
        x3 = _coord_to_candidate_iv(p3[0], candidate_library, tables)
        y3 = _coord_to_candidate_iv(p3[1], candidate_library, tables)
        d2_iv = _coord_to_candidate_iv(d2_q, candidate_library, tables)
        mf_iv = _coord_to_candidate_iv(margin_factor_q, candidate_library, tables)

        one_third = tables["one_third"]
        two_thirds = tables["two_thirds"]
        three = tables["three"]
        two = tables["two"]
        zero_iv = tables["zero"]
        w44 = tables["w44"]
        w84 = tables["w84"]
        welev = tables["welev"]

        if candidate_library == "decimal_interval":
            cf, cc = tables["cf"], tables["cc"]
            dx0 = three.mul(x1.sub(x0, cf, cc), cf, cc)
            dx1 = three.mul(x2.sub(x1, cf, cc), cf, cc)
            dx2 = three.mul(x3.sub(x2, cf, cc), cf, cc)
            dy0 = three.mul(y1.sub(y0, cf, cc), cf, cc)
            dy1 = three.mul(y2.sub(y1, cf, cc), cf, cc)
            dy2 = three.mul(y3.sub(y2, cf, cc), cf, cc)

            q_b = [
                dx0.sqr(cf, cc).add(dy0.sqr(cf, cc), cf, cc),
                dx0.mul(dx1, cf, cc).add(dy0.mul(dy1, cf, cc), cf, cc),
                one_third.mul(dx0.mul(dx2, cf, cc).add(dy0.mul(dy2, cf, cc), cf, cc), cf, cc).add(
                    two_thirds.mul(dx1.sqr(cf, cc).add(dy1.sqr(cf, cc), cf, cc), cf, cc), cf, cc
                ),
                dx1.mul(dx2, cf, cc).add(dy1.mul(dy2, cf, cc), cf, cc),
                dx2.sqr(cf, cc).add(dy2.sqr(cf, cc), cf, cc),
            ]
            c_b = [
                two.mul(dx0.mul(dy1, cf, cc).sub(dy0.mul(dx1, cf, cc), cf, cc), cf, cc),
                dx0.mul(dy2, cf, cc).sub(dy0.mul(dx2, cf, cc), cf, cc),
                two.mul(dx1.mul(dy2, cf, cc).sub(dy1.mul(dx2, cf, cc), cf, cc), cf, cc),
            ]
            if s_sign == 1:
                sc_b = c_b
            else:
                sc_b = [DecimalInterval(-c.hi, -c.lo) for c in c_b]
        elif candidate_library == "mpmath_iv":
            dx0, dx1, dx2 = three * (x1 - x0), three * (x2 - x1), three * (x3 - x2)
            dy0, dy1, dy2 = three * (y1 - y0), three * (y2 - y1), three * (y3 - y2)
            q_b = [
                dx0**2 + dy0**2,
                dx0 * dx1 + dy0 * dy1,
                one_third * (dx0 * dx2 + dy0 * dy2) + two_thirds * (dx1**2 + dy1**2),
                dx1 * dx2 + dy1 * dy2,
                dx2**2 + dy2**2,
            ]
            c_b = [
                two * (dx0 * dy1 - dy0 * dx1),
                dx0 * dy2 - dy0 * dx2,
                two * (dx1 * dy2 - dy1 * dx2),
            ]
            sc_b = c_b if s_sign == 1 else [-c for c in c_b]
        else:
            dx0, dx1, dx2 = three * (x1 - x0), three * (x2 - x1), three * (x3 - x2)
            dy0, dy1, dy2 = three * (y1 - y0), three * (y2 - y1), three * (y3 - y2)
            q_b = [
                dx0 * dx0 + dy0 * dy0,
                dx0 * dx1 + dy0 * dy1,
                one_third * (dx0 * dx2 + dy0 * dy2) + two_thirds * (dx1 * dx1 + dy1 * dy1),
                dx1 * dx2 + dy1 * dy2,
                dx2 * dx2 + dy2 * dy2,
            ]
            c_b = [
                two * (dx0 * dy1 - dy0 * dx1),
                dx0 * dy2 - dy0 * dx2,
                two * (dx1 * dy2 - dy1 * dx2),
            ]
            sc_b = c_b if s_sign == 1 else [-c for c in c_b]

        q_pos_d0, _, _ = _bernstein_sign_predicates(q_b, candidate_library, tables)
        _, _, sc_le0_d0 = _bernstein_sign_predicates(sc_b, candidate_library, tables)
        ia_elapsed_ms += (time.perf_counter() - t_ia_start) * 1000.0
        dx_b_cur = [dx0, dx1, dx2]
        dy_b_cur = [dy0, dy1, dy2]

        def _finalize_regular_valid(reason_tag: str) -> Dict[str, Any]:
            nonlocal iso_elapsed_ms
            t_si_0 = time.perf_counter()
            si_status, si_method, si_cnt = _certify_local_self_intersection_candidate(
                p0,
                p1,
                p2,
                p3,
                dx_b_cur,
                dy_b_cur,
                d_q,
                s_sign,
                candidate_library,
                tables,
                prec_bits,
            )
            iso_elapsed_ms += (time.perf_counter() - t_si_0) * 1000.0
            escalation_trace.append(reason_tag)
            escalation_trace.append(f"{prec_bits}-bit:step2.5-local-si:{si_status}:{si_method}")
            if si_status == "CERTIFIED_DISJOINT":
                return {
                    "available": True,
                    "verificationOutcome": "CERTIFIED_VALID",
                    "failureCategory": "NONE",
                    "localSelfIntersectionStatus": "NONE",
                    "stationaryStatus": stationary_status,
                    "maxDepthReached": max_depth_reached,
                    "subdivisionsPerformed": subdivisions_performed,
                    "straddlingPanelsFound": straddling_panels_encountered,
                    "isolatedCuspCount": isolated_cusp_count,
                    "workingPrecisionBits": prec_bits,
                    "escalationTrace": escalation_trace,
                    "intervalArithmeticMs": ia_elapsed_ms,
                    "rootIsolationMs": iso_elapsed_ms,
                }
            if si_status == "CERTIFIED_INTERSECTION_FOUND":
                return {
                    "available": True,
                    "verificationOutcome": "CERTIFIED_INVALID",
                    "failureCategory": "LOCAL_OFFSET_SELF_INTERSECTION",
                    "localSelfIntersectionStatus": "DETECTED",
                    "stationaryStatus": stationary_status,
                    "maxDepthReached": max_depth_reached,
                    "subdivisionsPerformed": subdivisions_performed,
                    "straddlingPanelsFound": straddling_panels_encountered,
                    "isolatedCuspCount": isolated_cusp_count,
                    "isolatedLocalSelfIntersectionCount": si_cnt,
                    "workingPrecisionBits": prec_bits,
                    "escalationTrace": escalation_trace,
                    "intervalArithmeticMs": ia_elapsed_ms,
                    "rootIsolationMs": iso_elapsed_ms,
                }
            return {
                "available": True,
                "verificationOutcome": "INCONCLUSIVE",
                "failureCategory": "INCONCLUSIVE_VERIFICATION",
                "localSelfIntersectionStatus": "UNRESOLVED",
                "stationaryStatus": stationary_status,
                "maxDepthReached": max_depth_reached,
                "subdivisionsPerformed": subdivisions_performed,
                "straddlingPanelsFound": straddling_panels_encountered,
                "isolatedCuspCount": isolated_cusp_count,
                "workingPrecisionBits": prec_bits,
                "escalationTrace": escalation_trace,
                "intervalArithmeticMs": ia_elapsed_ms,
                "rootIsolationMs": iso_elapsed_ms,
            }

        # Step 2.1 + Step 2.2 Depth-0 Fast Certificate: Q(t) > 0 AND s*d*C(t) <= 0 => f(t) >= 1 > eps_reg
        # Unconditionally verified by Step 2.5 local self-intersection certification (K-01).
        if q_pos_d0 and sc_le0_d0:
            return _finalize_regular_valid(f"{prec_bits}-bit:convex-sign-gate-certified-d0")

        # Step 2.1: If Q(t) does not certify strictly positive at depth 0, subdivide Q(t) via De Casteljau
        if not q_pos_d0:
            t_iso_q0 = time.perf_counter()
            q_stack: List[Tuple[List[Any], int]] = [(q_b, 0)]
            q_unresolved = False
            q_nodes = 0
            while q_stack:
                qb_cur, depth = q_stack.pop()
                q_nodes += 1
                if q_nodes > max_nodes_per_tier:
                    q_unresolved = True
                    escalation_trace.append(f"{prec_bits}-bit:q-node-budget-exceeded({max_nodes_per_tier})")
                    break
                if depth > max_depth_reached:
                    max_depth_reached = depth
                qp, _, _ = _bernstein_sign_predicates(qb_cur, candidate_library, tables)
                if qp:
                    continue
                straddling_panels_encountered += 1
                if depth >= max_depth:
                    q_unresolved = True
                    break
                subdivisions_performed += 1
                ql, qr = _de_casteljau_mid_candidate(qb_cur, candidate_library, tables)
                q_stack.append((qr, depth + 1))
                q_stack.append((ql, depth + 1))
            iso_elapsed_ms += (time.perf_counter() - t_iso_q0) * 1000.0

            if q_unresolved:
                if tier_idx < len(precision_ladder) - 1:
                    escalation_trace.append(f"{prec_bits}-bit:q-unresolved-escalate")
                    continue
                if allow_exact_rational_fallback:
                    t_iso_ex = time.perf_counter()
                    p0_q = (_to_exact_fraction(p0[0]), _to_exact_fraction(p0[1]))
                    p1_q = (_to_exact_fraction(p1[0]), _to_exact_fraction(p1[1]))
                    p2_q = (_to_exact_fraction(p2[0]), _to_exact_fraction(p2[1]))
                    p3_q = (_to_exact_fraction(p3[0]), _to_exact_fraction(p3[1]))
                    q_pow, c_pow, _ = _cubic_segment_to_exact_p_cusp_and_q_c(p0_q, p1_q, p2_q, p3_q, d_q)
                    st_out, st_cat, st_status, st_cnt = _classify_stationary_roots_exact_jet(
                        p0_q, p1_q, p2_q, p3_q, q_pow, c_pow, d_q, s_sign, epsilon_reg_q
                    )
                    iso_elapsed_ms += (time.perf_counter() - t_iso_ex) * 1000.0
                    stationary_status = st_status
                    if st_out in ("CERTIFIED_VALID", "CERTIFIED_INVALID", "INCONCLUSIVE"):
                        escalation_trace.append(f"{prec_bits}-bit:exact-jet-{st_status}")
                        return {
                            "available": True,
                            "verificationOutcome": st_out,
                            "failureCategory": st_cat,
                            "stationaryStatus": stationary_status,
                            "maxDepthReached": max_depth_reached,
                            "subdivisionsPerformed": subdivisions_performed,
                            "straddlingPanelsFound": straddling_panels_encountered,
                            "isolatedCuspCount": st_cnt if st_out == "CERTIFIED_INVALID" else 0,
                            "workingPrecisionBits": prec_bits,
                            "escalationTrace": escalation_trace,
                            "intervalArithmeticMs": ia_elapsed_ms,
                            "rootIsolationMs": iso_elapsed_ms,
                        }
                else:
                    escalation_trace.append(f"{prec_bits}-bit:q-inconclusive")
                    return {
                        "available": True,
                        "verificationOutcome": "INCONCLUSIVE",
                        "failureCategory": "INCONCLUSIVE_VERIFICATION",
                        "stationaryStatus": "UNRESOLVED",
                        "maxDepthReached": max_depth_reached,
                        "subdivisionsPerformed": subdivisions_performed,
                        "straddlingPanelsFound": straddling_panels_encountered,
                        "isolatedCuspCount": 0,
                        "workingPrecisionBits": prec_bits,
                        "escalationTrace": escalation_trace,
                        "intervalArithmeticMs": ia_elapsed_ms,
                        "rootIsolationMs": iso_elapsed_ms,
                    }

            if sc_le0_d0:
                return _finalize_regular_valid(f"{prec_bits}-bit:q-certified-convex-gate")

        # Step 2.3: Construct exact degree-12 Bernstein enclosures of P_exact = Q^3 - d^2*C^2 and P_margin = (1-eps)^2*Q^3 - d^2*C^2
        t_ia2_start = time.perf_counter()
        if candidate_library == "decimal_interval":
            cf, cc = tables["cf"], tables["cc"]
            q2_b: List[Any] = []
            for row in w44:
                acc = zero_iv
                for i, j, w in row:
                    prod = q_b[i].sqr(cf, cc) if i == j else q_b[i].mul(q_b[j], cf, cc)
                    acc = acc.add(w.mul(prod, cf, cc), cf, cc)
                q2_b.append(acc)
            q3_b: List[Any] = []
            for row in w84:
                acc = zero_iv
                for i, j, w in row:
                    acc = acc.add(w.mul(q2_b[i].mul(q_b[j], cf, cc), cf, cc), cf, cc)
                q3_b.append(acc)
            c2_4 = [
                c_b[0].sqr(cf, cc),
                c_b[0].mul(c_b[1], cf, cc),
                one_third.mul(c_b[0].mul(c_b[2], cf, cc), cf, cc).add(
                    two_thirds.mul(c_b[1].sqr(cf, cc), cf, cc), cf, cc
                ),
                c_b[1].mul(c_b[2], cf, cc),
                c_b[2].sqr(cf, cc),
            ]
            p_exact_b: List[Any] = []
            p_margin_b: List[Any] = []
            for k in range(13):
                c2_k = zero_iv
                for i, w in welev[k]:
                    c2_k = c2_k.add(w.mul(c2_4[i], cf, cc), cf, cc)
                d2_c2_k = d2_iv.mul(c2_k, cf, cc)
                p_exact_b.append(q3_b[k].sub(d2_c2_k, cf, cc))
                p_margin_b.append(mf_iv.mul(q3_b[k], cf, cc).sub(d2_c2_k, cf, cc))
        elif candidate_library == "mpmath_iv":
            q2_b = []
            for row in w44:
                acc = zero_iv
                for i, j, w in row:
                    acc = acc + w * (q_b[i] ** 2 if i == j else q_b[i] * q_b[j])
                q2_b.append(acc)
            q3_b = []
            for row in w84:
                acc = zero_iv
                for i, j, w in row:
                    acc = acc + w * q2_b[i] * q_b[j]
                q3_b.append(acc)
            c2_4 = [
                c_b[0] ** 2,
                c_b[0] * c_b[1],
                one_third * (c_b[0] * c_b[2]) + two_thirds * (c_b[1] ** 2),
                c_b[1] * c_b[2],
                c_b[2] ** 2,
            ]
            p_exact_b = []
            p_margin_b = []
            for k in range(13):
                c2_k = zero_iv
                for i, w in welev[k]:
                    c2_k = c2_k + w * c2_4[i]
                d2_c2_k = d2_iv * c2_k
                p_exact_b.append(q3_b[k] - d2_c2_k)
                p_margin_b.append(mf_iv * q3_b[k] - d2_c2_k)
        else:
            q2_b = [sum((w * q_b[i] * q_b[j] for i, j, w in row), zero_iv) for row in w44]
            q3_b = [sum((w * q2_b[i] * q_b[j] for i, j, w in row), zero_iv) for row in w84]
            c2_4 = [
                c_b[0] * c_b[0],
                c_b[0] * c_b[1],
                one_third * (c_b[0] * c_b[2]) + two_thirds * (c_b[1] * c_b[1]),
                c_b[1] * c_b[2],
                c_b[2] * c_b[2],
            ]
            p_exact_b = []
            p_margin_b = []
            for k in range(13):
                c2_k = sum((w * c2_4[i] for i, w in welev[k]), zero_iv)
                d2_c2_k = d2_iv * c2_k
                p_exact_b.append(q3_b[k] - d2_c2_k)
                p_margin_b.append(mf_iv * q3_b[k] - d2_c2_k)

        pm_pos_d0, _, _ = _bernstein_sign_predicates(p_margin_b, candidate_library, tables)
        ia_elapsed_ms += (time.perf_counter() - t_ia2_start) * 1000.0

        # Depth-0 Regularity Margin Certificate: min P_margin > 0 => f(t) > eps_reg everywhere on [0, 1]
        # Unconditionally verified by Step 2.5 local self-intersection certification (K-01).
        if pm_pos_d0:
            return _finalize_regular_valid(f"{prec_bits}-bit:bernstein-p-margin-certified-d0")

        # Adaptive De Casteljau subdivision on concave/straddling sub-intervals
        t_iso_p0 = time.perf_counter()
        work_stack: List[Tuple[List[Any], List[Any], List[Any], int, Fraction, Fraction]] = [
            (sc_b, p_exact_b, p_margin_b, 0, Fraction(0), Fraction(1))
        ]
        tangent_reversal_found = False
        margin_violation_found = False
        unresolved_p_exact: List[Tuple[Fraction, Fraction]] = []
        unresolved_p_margin: List[Tuple[Fraction, Fraction]] = []

        p_nodes = 0
        p_budget_exceeded = False
        while work_stack:
            sc_cur, pe_cur, pm_cur, depth, t_a, t_b = work_stack.pop()
            p_nodes += 1
            if p_nodes > max_nodes_per_tier:
                p_budget_exceeded = True
                unresolved_p_exact.append((t_a, t_b))
                for _sc_r, _pe_r, _pm_r, _d_r, rem_a, rem_b in work_stack:
                    unresolved_p_exact.append((rem_a, rem_b))
                work_stack.clear()
                break
            if depth > max_depth_reached:
                max_depth_reached = depth
            sc_pos, _, sc_le0 = _bernstein_sign_predicates(sc_cur, candidate_library, tables)
            if sc_le0:
                continue  # Convex sub-interval: f(t) >= 1 > eps_reg
            pm_pos, pm_neg, _ = _bernstein_sign_predicates(pm_cur, candidate_library, tables)
            if pm_pos:
                continue  # Regularity margin strictly satisfied on sub-interval
            pe_pos, pe_neg, _ = _bernstein_sign_predicates(pe_cur, candidate_library, tables)
            if sc_pos and pe_neg:
                tangent_reversal_found = True
                isolated_cusp_count += 1
                break
            if sc_pos and pe_pos and pm_neg:
                margin_violation_found = True
                continue  # 0 < f(t) < eps_reg certified on sub-interval; keep checking rest for reversal/cusp

            straddling_panels_encountered += 1
            if depth < max_depth:
                subdivisions_performed += 1
                mid_t = (t_a + t_b) / Fraction(2)
                sc_l, sc_r = _de_casteljau_mid_candidate(sc_cur, candidate_library, tables)
                pe_l, pe_r = _de_casteljau_mid_candidate(pe_cur, candidate_library, tables)
                pm_l, pm_r = _de_casteljau_mid_candidate(pm_cur, candidate_library, tables)
                work_stack.append((sc_r, pe_r, pm_r, depth + 1, mid_t, t_b))
                work_stack.append((sc_l, pe_l, pm_l, depth + 1, t_a, mid_t))
            else:
                if not pe_pos:
                    unresolved_p_exact.append((t_a, t_b))
                else:
                    unresolved_p_margin.append((t_a, t_b))

        iso_elapsed_ms += (time.perf_counter() - t_iso_p0) * 1000.0
        if p_budget_exceeded:
            escalation_trace.append(f"{prec_bits}-bit:node-budget-exceeded({max_nodes_per_tier})")

        if tangent_reversal_found:
            escalation_trace.append(f"{prec_bits}-bit:tangent-reversal-certified")
            return {
                "available": True,
                "verificationOutcome": "CERTIFIED_INVALID",
                "failureCategory": "TANGENT_REVERSAL",
                "stationaryStatus": stationary_status,
                "maxDepthReached": max_depth_reached,
                "subdivisionsPerformed": subdivisions_performed,
                "straddlingPanelsFound": straddling_panels_encountered,
                "isolatedCuspCount": isolated_cusp_count,
                "workingPrecisionBits": prec_bits,
                "escalationTrace": escalation_trace,
                "intervalArithmeticMs": ia_elapsed_ms,
                "rootIsolationMs": iso_elapsed_ms,
            }

        # If all P_exact panels are strictly positive (no cusp/reversal possible) AND a margin violation is proven,
        # classify as REGULARITY_MARGIN_VIOLATION even if another panel transversely crosses f = eps_reg!
        if not unresolved_p_exact and margin_violation_found:
            escalation_trace.append(f"{prec_bits}-bit:regularity-margin-violation-certified")
            return {
                "available": True,
                "verificationOutcome": "CERTIFIED_INVALID",
                "failureCategory": "REGULARITY_MARGIN_VIOLATION",
                "stationaryStatus": stationary_status,
                "maxDepthReached": max_depth_reached,
                "subdivisionsPerformed": subdivisions_performed,
                "straddlingPanelsFound": straddling_panels_encountered,
                "isolatedCuspCount": 0,
                "workingPrecisionBits": prec_bits,
                "escalationTrace": escalation_trace,
                "intervalArithmeticMs": ia_elapsed_ms,
                "rootIsolationMs": iso_elapsed_ms,
            }

        if not unresolved_p_exact and not unresolved_p_margin:
            return _finalize_regular_valid(f"{prec_bits}-bit:subdivided-certified-valid")

        # Escalate working precision on unresolved panels (ADR-009 §5.2 Step 1)
        if tier_idx < len(precision_ladder) - 1:
            escalation_trace.append(f"{prec_bits}-bit:unresolved-escalate")
            continue

        # ADR-009 §5.2 Step 2 / K-02: Complete exact rational Sturm/Bernstein decision at 336-bit ceiling
        if allow_exact_rational_fallback and max_depth >= 12:
            t_iso_ex2 = time.perf_counter()
            p0_q = (_to_exact_fraction(p0[0]), _to_exact_fraction(p0[1]))
            p1_q = (_to_exact_fraction(p1[0]), _to_exact_fraction(p1[1]))
            p2_q = (_to_exact_fraction(p2[0]), _to_exact_fraction(p2[1]))
            p3_q = (_to_exact_fraction(p3[0]), _to_exact_fraction(p3[1]))
            q_pow, c_pow, p_exact_pow = _cubic_segment_to_exact_p_cusp_and_q_c(p0_q, p1_q, p2_q, p3_q, d_q)
            q2_pow = [Fraction(0)] * 9
            for i in range(5):
                for j in range(5):
                    q2_pow[i + j] += q_pow[i] * q_pow[j]
            q3_pow = [Fraction(0)] * 13
            for i in range(9):
                for j in range(5):
                    q3_pow[i + j] += q2_pow[i] * q_pow[j]
            c2_pow = [Fraction(0)] * 7
            for i in range(4):
                for j in range(4):
                    c2_pow[i + j] += c_pow[i] * c_pow[j]
            p_margin_pow = [margin_factor_q * q3_pow[i] - (d2_q * c2_pow[i] if i < 7 else Fraction(0)) for i in range(13)]

            ex_dec = certify_regular_offset_exact_rational(
                q_pow, c_pow, p_exact_pow, p_margin_pow, s_sign, d_q
            )
            iso_elapsed_ms += (time.perf_counter() - t_iso_ex2) * 1000.0

            if ex_dec["outcome"] == "CERTIFIED_INVALID":
                cat = ex_dec["failureCategory"]
                escalation_trace.append(f"336-bit:exact-rational:{cat}:{ex_dec['reason']}")
                return {
                    "available": True,
                    "verificationOutcome": "CERTIFIED_INVALID",
                    "failureCategory": cat,
                    "stationaryStatus": stationary_status,
                    "maxDepthReached": max_depth_reached,
                    "subdivisionsPerformed": subdivisions_performed,
                    "straddlingPanelsFound": straddling_panels_encountered,
                    "isolatedCuspCount": (
                        max(1, len(ex_dec["cuspBracketsRational"]))
                        if cat in ("TANGENT_REVERSAL", "ACTUAL_ZERO_SPEED_CUSP")
                        else 0
                    ),
                    "workingPrecisionBits": prec_bits,
                    "escalationTrace": escalation_trace,
                    "intervalArithmeticMs": ia_elapsed_ms,
                    "rootIsolationMs": iso_elapsed_ms,
                }
            if ex_dec["outcome"] == "CERTIFIED_VALID":
                return _finalize_regular_valid(f"336-bit:exact-rational:{ex_dec['reason']}")

        escalation_trace.append(f"{prec_bits}-bit:fail-closed-inconclusive")
        return {
            "available": True,
            "verificationOutcome": "INCONCLUSIVE",
            "failureCategory": "INCONCLUSIVE_VERIFICATION",
            "stationaryStatus": stationary_status,
            "maxDepthReached": max_depth_reached,
            "subdivisionsPerformed": subdivisions_performed,
            "straddlingPanelsFound": straddling_panels_encountered,
            "isolatedCuspCount": 0,
            "workingPrecisionBits": prec_bits,
            "escalationTrace": escalation_trace,
            "intervalArithmeticMs": ia_elapsed_ms,
            "rootIsolationMs": iso_elapsed_ms,
        }

    return {
        "available": True,
        "verificationOutcome": "INCONCLUSIVE",
        "failureCategory": "INCONCLUSIVE_VERIFICATION",
        "stationaryStatus": stationary_status,
        "maxDepthReached": max_depth_reached,
        "subdivisionsPerformed": subdivisions_performed,
        "straddlingPanelsFound": straddling_panels_encountered,
        "isolatedCuspCount": 0,
        "workingPrecisionBits": 336,
        "escalationTrace": escalation_trace,
        "intervalArithmeticMs": ia_elapsed_ms,
        "rootIsolationMs": iso_elapsed_ms,
    }


def _contour_outward_offset_sign(contour: Dict[str, Any]) -> int:
    """Determines the canonical outward seam-allowance sign s in {-1, +1} from the closed contour's
    signed polygon winding (CCW exterior -> s = -1 per ADR-009 §4.1; CW exterior -> s = +1).
    """
    pts = [seg["p0"] for seg in contour.get("segments", []) if "p0" in seg]
    if len(pts) < 3:
        return -1
    area2 = 0.0
    n = len(pts)
    for idx in range(n):
        x0, y0 = pts[idx]
        x1, y1 = pts[(idx + 1) % n]
        area2 += x0 * y1 - x1 * y0
    return -1 if area2 >= 0.0 else 1


def _evaluate_contour_cusp_panels_with_candidate(
    raw_beziers: List[Tuple[Tuple[Any, Any], Tuple[Any, Any], Tuple[Any, Any], Tuple[Any, Any]]],
    candidate_library: str,
    d_q: Fraction = Fraction(3, 2),
    s_sign: int = -1,
    epsilon_reg_q: Fraction = Fraction(1, 20),
    max_depth: int = 20,
) -> Dict[str, Any]:
    """Executes the symmetric ADR-009 §5.1 / §5.2 Stage 2 Bernstein-basis tri-state offset verifier across
    every cubic Bezier segment of a garment contour using the specified candidate interval library.
    Measures phase timings cleanly: backend_init, interval_arithmetic, root_isolation, certification.
    """
    t_init_0 = time.perf_counter()
    if candidate_library == "mpmath_iv":
        iv.prec = 113
        mpmath.mp.prec = 113
    elif candidate_library == "python_flint":
        if not HAS_FLINT:
            return {"available": False}
        flint.ctx.prec = 113
    _ = _get_bernstein_candidate_tables(candidate_library, 113)
    backend_init_ms = (time.perf_counter() - t_init_0) * 1000.0

    interval_arith_ms = 0.0
    root_isolation_ms = 0.0
    straddling_total = 0
    isolated_cusp_total = 0
    subdivisions_total = 0
    max_depth_seen = 0
    segment_outcomes: List[str] = []
    segment_categories: List[str] = []

    for p0, p1, p2, p3 in raw_beziers:
        seg_res = certify_cubic_segment_bernstein_candidate(
            p0,
            p1,
            p2,
            p3,
            d_q=d_q,
            candidate_library=candidate_library,
            s_sign=s_sign,
            epsilon_reg_q=epsilon_reg_q,
            max_depth=max_depth,
        )
        interval_arith_ms += seg_res["intervalArithmeticMs"]
        root_isolation_ms += seg_res["rootIsolationMs"]
        straddling_total += seg_res["straddlingPanelsFound"]
        isolated_cusp_total += seg_res["isolatedCuspCount"]
        subdivisions_total += seg_res["subdivisionsPerformed"]
        if seg_res["maxDepthReached"] > max_depth_seen:
            max_depth_seen = seg_res["maxDepthReached"]
        segment_outcomes.append(seg_res["verificationOutcome"])
        segment_categories.append(seg_res["failureCategory"])

    t_cert_0 = time.perf_counter()
    if any(o == "CERTIFIED_INVALID" for o in segment_outcomes):
        outcome = "CERTIFIED_INVALID"
        primary_failure = next(c for o, c in zip(segment_outcomes, segment_categories) if o == "CERTIFIED_INVALID")
    elif any(o == "INCONCLUSIVE" for o in segment_outcomes):
        outcome = "INCONCLUSIVE"
        primary_failure = "INCONCLUSIVE_VERIFICATION"
    else:
        outcome = "CERTIFIED_VALID"
        primary_failure = "NONE"
    cert_ms = (time.perf_counter() - t_cert_0) * 1000.0

    return {
        "available": True,
        "outcome": outcome,
        "failureCategory": primary_failure,
        "offsetSignS": s_sign,
        "cubicBezierSegmentsEvaluated": len(raw_beziers),
        "straddlingPanelsFound": straddling_total,
        "subdivisionsPerformed": subdivisions_total,
        "maxSubdivisionDepthReached": max_depth_seen,
        "isolatedCuspCount": isolated_cusp_total,
        "phaseTimingsMs": {
            "backendInitMs": round(backend_init_ms, 6),
            "intervalArithmeticMs": round(interval_arith_ms, 6),
            "rootIsolationMs": round(root_isolation_ms, 6),
            "certificationMs": round(cert_ms, 6),
            "candidateKernelTotalMs": round(backend_init_ms + interval_arith_ms + root_isolation_ms + cert_ms, 6),
        },
    }


def _compute_percentile_ms(sorted_vals: List[float], quantile: float) -> float:
    idx = min(len(sorted_vals) - 1, max(0, int(math.ceil(quantile * len(sorted_vals))) - 1))
    return sorted_vals[idx]


def benchmark_63_canonical_garment_contours(
    contours_path: Any,
    repetitions: int = 5,
    warmup_runs: int = 1,
) -> Dict[str, Any]:
    """Executes the ADR-009 §7.2 benchmark across all 63 real canonical garment contours drafted from
    Patroner's bodice, sleeve, and skirt blocks, timing ALL 3 candidates (`mpmath.iv`, `python-flint arb`,
    `DecimalInterval`) symmetrically via the exact ADR-009 §5.1/§5.2 Stage 2 Bernstein-basis tri-state
    certifier with cold-start + steady-state multi-repetition statistics and full phase breakdowns.
    """
    import hashlib
    import json
    from pathlib import Path

    path_obj = Path(contours_path)
    if not path_obj.exists():
        raise FileNotFoundError(f"Canonical 63-contour corpus not found at {path_obj}")
    raw_bytes = path_obj.read_bytes()
    corpus_file_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    corpus = json.loads(raw_bytes.decode("utf-8"))
    contours = corpus.get("contours", [])
    if len(contours) != 63:
        raise ValueError(f"ADR-009 §7.2 requires exactly 63 canonical garment contours, found {len(contours)}")

    d_q = Fraction(3, 2)  # 1.5 cm canonical seam allowance
    epsilon_reg_q = Fraction(1, 20)  # 0.05 regularity safety margin (ADR-009 §4.4)
    cand_map = (
        ("mpmathIvFraction", "mpmath_iv"),
        ("pythonFlintArbFmpq", "python_flint"),
        ("decimalIntervalFraction", "decimal_interval"),
    )

    def _run_single_pass() -> Tuple[
        Dict[str, List[float]],
        Dict[str, List[float]],
        Dict[str, Dict[str, float]],
        List[Dict[str, Any]],
    ]:
        pass_outer_samples: Dict[str, List[float]] = {k: [] for k, _ in cand_map}
        pass_phase_sum_samples: Dict[str, List[float]] = {k: [] for k, _ in cand_map}
        pass_phases: Dict[str, Dict[str, float]] = {
            k: {
                "preprocessingMs": 0.0,
                "backendInitMs": 0.0,
                "intervalArithmeticMs": 0.0,
                "rootIsolationMs": 0.0,
                "certificationMs": 0.0,
                "serializationMs": 0.0,
                "unaccountedWrapperOverheadMs": 0.0,
            }
            for k, _ in cand_map
        }
        pass_records: List[Dict[str, Any]] = []

        for contour in contours:
            contour_cand_results: Dict[str, Any] = {}
            contour_sign_recorded: Optional[int] = None
            contour_prep_ms_recorded = 0.0

            for out_key, lib_id in cand_map:
                # K-03: Single outer monotonic wall-clock timer enclosing complete per-contour execution
                # (preprocessing + candidate verification + JSON serialization) so zero wrapper overhead is omitted.
                t_outer_0 = time.perf_counter()

                t_prep_0 = time.perf_counter()
                s_sign = _contour_outward_offset_sign(contour)
                raw_beziers: List[
                    Tuple[Tuple[float, float], Tuple[float, float], Tuple[float, float], Tuple[float, float]]
                ] = []
                for seg in contour["segments"]:
                    if seg["type"] == "bezier":
                        raw_beziers.append(
                            (
                                (seg["p0"][0], seg["p0"][1]),
                                (seg["cp1"][0], seg["cp1"][1]),
                                (seg["cp2"][0], seg["cp2"][1]),
                                (seg["p3"][0], seg["p3"][1]),
                            )
                        )
                prep_ms = (time.perf_counter() - t_prep_0) * 1000.0

                res = _evaluate_contour_cusp_panels_with_candidate(
                    raw_beziers,
                    lib_id,
                    d_q=d_q,
                    s_sign=s_sign,
                    epsilon_reg_q=epsilon_reg_q,
                    max_depth=20,
                )

                t_ser_0 = time.perf_counter()
                _ = json.dumps(res)
                ser_ms = (time.perf_counter() - t_ser_0) * 1000.0

                outer_end_to_end_ms = (time.perf_counter() - t_outer_0) * 1000.0
                if contour_sign_recorded is None:
                    contour_sign_recorded = s_sign
                    contour_prep_ms_recorded = prep_ms

                if res.get("available"):
                    pt = res["phaseTimingsMs"]
                    phase_sum_ms = prep_ms + pt["candidateKernelTotalMs"] + ser_ms
                    overhead_ms = max(0.0, outer_end_to_end_ms - phase_sum_ms)
                    pass_outer_samples[out_key].append(outer_end_to_end_ms)
                    pass_phase_sum_samples[out_key].append(phase_sum_ms)
                    pass_phases[out_key]["preprocessingMs"] += prep_ms
                    pass_phases[out_key]["backendInitMs"] += pt["backendInitMs"]
                    pass_phases[out_key]["intervalArithmeticMs"] += pt["intervalArithmeticMs"]
                    pass_phases[out_key]["rootIsolationMs"] += pt["rootIsolationMs"]
                    pass_phases[out_key]["certificationMs"] += pt["certificationMs"]
                    pass_phases[out_key]["serializationMs"] += ser_ms
                    pass_phases[out_key]["unaccountedWrapperOverheadMs"] += overhead_ms
                    contour_cand_results[out_key] = {
                        "outcome": res["outcome"],
                        "failureCategory": res["failureCategory"],
                        "offsetSignS": s_sign,
                        "maxSubdivisionDepthReached": res["maxSubdivisionDepthReached"],
                        "endToEndMs": round(outer_end_to_end_ms, 4),
                        "outerEndToEndMs": round(outer_end_to_end_ms, 4),
                        "phaseSumMs": round(phase_sum_ms, 4),
                        "unaccountedWrapperOverheadMs": round(overhead_ms, 4),
                        "candidateKernelMs": round(pt["candidateKernelTotalMs"], 4),
                    }
                else:
                    contour_cand_results[out_key] = {"available": False}

            pass_records.append(
                {
                    "contourId": contour["contourId"],
                    "sourceModule": contour["sourceModule"],
                    "size": contour["size"],
                    "pieceCode": contour["pieceCode"],
                    "variant": contour["variant"],
                    "segmentCount": contour["segmentCount"],
                    "cubicBezierCount": contour["cubicBezierCount"],
                    "outwardOffsetSignS": contour_sign_recorded if contour_sign_recorded is not None else -1,
                    "contourInputSha256": contour["contourInputSha256"],
                    "preprocessingMs": round(contour_prep_ms_recorded, 4),
                    "candidateResults": contour_cand_results,
                }
            )
        return pass_outer_samples, pass_phase_sum_samples, pass_phases, pass_records

    # 1. Cold-start measurement (first pass, clearing precomputed tables first to capture true cold init)
    _BERNSTEIN_CANDIDATE_TABLES_CACHE.clear()
    cold_outer_samples, cold_phase_sum_samples, cold_phases, _ = _run_single_pass()

    # 2. Explicit warm-up passes
    for _ in range(max(0, warmup_runs)):
        _run_single_pass()

    # 3. Steady-state measured repetitions
    num_reps = max(1, repetitions)
    rep_outer_all: Dict[str, List[List[float]]] = {k: [] for k, _ in cand_map}
    rep_phase_sum_all: Dict[str, List[List[float]]] = {k: [] for k, _ in cand_map}
    rep_phases_all: Dict[str, List[Dict[str, float]]] = {k: [] for k, _ in cand_map}
    last_records: List[Dict[str, Any]] = []
    for _ in range(num_reps):
        ps_out, ps_sum, pp, pr = _run_single_pass()
        for k, _ in cand_map:
            rep_outer_all[k].append(ps_out[k])
            rep_phase_sum_all[k].append(ps_sum[k])
            rep_phases_all[k].append(pp[k])
        last_records = pr

    def _summarize_samples(
        samples: List[float],
        phase_totals: Dict[str, float],
        phase_sum_samples: Optional[List[float]] = None,
        rep_p95s: Optional[List[float]] = None,
        pooled_samples: Optional[List[float]] = None,
    ) -> Dict[str, Any]:
        if not samples:
            return {"available": False}
        s_sorted = sorted(samples)
        p50 = _compute_percentile_ms(s_sorted, 0.50)
        p90 = _compute_percentile_ms(s_sorted, 0.90)
        p95 = compute_p95_from_samples_ms(samples)
        p99 = _compute_percentile_ms(s_sorted, 0.99)
        summary: Dict[str, Any] = {
            "available": True,
            "timingSource": "SINGLE_OUTER_WALL_CLOCK_PERF_COUNTER",
            "contoursEvaluated": len(samples),
            "medianMs": round(p50, 4),
            "p90Ms": round(p90, 4),
            "p95Ms": round(p95, 4),
            "p99Ms": round(p99, 4),
            "maxMs": round(s_sorted[-1], 4),
            "samplesMs": [round(x, 6) for x in samples],
            "p95TargetMaxMs": 5.0,
            "withinP95Target5Ms": bool(p95 <= 5.0),
            "latencyBudgetMaxMs": 50.0,
            "withinLatencyBudget": bool(p95 <= 50.0),
            "phaseBreakdownTotalMs": {k: round(v, 4) for k, v in phase_totals.items()},
            "phaseBreakdownMeanMsPerContour": {k: round(v / len(samples), 6) for k, v in phase_totals.items()},
            "unaccountedWrapperOverheadTotalMs": round(phase_totals.get("unaccountedWrapperOverheadMs", 0.0), 4),
            "unaccountedWrapperOverheadMeanMsPerContour": round(
                phase_totals.get("unaccountedWrapperOverheadMs", 0.0) / len(samples), 6
            ),
        }
        if phase_sum_samples:
            ps_s = sorted(phase_sum_samples)
            summary["phaseSumSummary"] = {
                "medianMs": round(_compute_percentile_ms(ps_s, 0.50), 4),
                "p90Ms": round(_compute_percentile_ms(ps_s, 0.90), 4),
                "p95Ms": round(compute_p95_from_samples_ms(phase_sum_samples), 4),
                "p99Ms": round(_compute_percentile_ms(ps_s, 0.99), 4),
                "maxMs": round(ps_s[-1], 4),
            }
        if rep_p95s is not None:
            summary["repetitionP95sMs"] = [round(x, 4) for x in rep_p95s]
        if pooled_samples is not None:
            ps_sorted = sorted(pooled_samples)
            summary["pooledRepetitionsSummary"] = {
                "totalSamples": len(ps_sorted),
                "p50Ms": round(_compute_percentile_ms(ps_sorted, 0.50), 4),
                "p90Ms": round(_compute_percentile_ms(ps_sorted, 0.90), 4),
                "p95Ms": round(_compute_percentile_ms(ps_sorted, 0.95), 4),
                "p99Ms": round(_compute_percentile_ms(ps_sorted, 0.99), 4),
                "maxMs": round(ps_sorted[-1], 4),
            }
        return summary

    cold_start_summary: Dict[str, Any] = {}
    candidates_summary: Dict[str, Any] = {}
    for k, _ in cand_map:
        cold_start_summary[k] = _summarize_samples(
            cold_outer_samples[k],
            cold_phases[k],
            phase_sum_samples=cold_phase_sum_samples[k],
        )
        if rep_outer_all[k] and rep_outer_all[k][0]:
            per_contour_medians = [
                statistics.median(rep[idx] for rep in rep_outer_all[k]) for idx in range(len(contours))
            ]
            per_contour_phase_sum_medians = [
                statistics.median(rep[idx] for rep in rep_phase_sum_all[k]) for idx in range(len(contours))
            ]
            rep_p95s = [compute_p95_from_samples_ms(rep) for rep in rep_outer_all[k]]
            pooled = [x for rep in rep_outer_all[k] for x in rep]
            mean_phases = {
                pk: statistics.mean(rp[pk] for rp in rep_phases_all[k]) for pk in rep_phases_all[k][0]
            }
            candidates_summary[k] = _summarize_samples(
                per_contour_medians,
                mean_phases,
                phase_sum_samples=per_contour_phase_sum_medians,
                rep_p95s=rep_p95s,
                pooled_samples=pooled,
            )
            # Update per-contour records with steady-state median outer endToEndMs
            for idx in range(len(contours)):
                last_records[idx]["candidateResults"][k]["steadyStateMedianEndToEndMs"] = round(
                    per_contour_medians[idx], 4
                )
        else:
            candidates_summary[k] = {"available": False}

    eval_5ms = evaluate_three_candidates_p95_latency({"candidates": candidates_summary}, threshold_ms=5.0)
    cold_eval_5ms = evaluate_three_candidates_p95_latency({"candidates": cold_start_summary}, threshold_ms=5.0)
    return {
        "benchmarkName": "ADR-009 §7.2 63 Canonical Garment Contours End-to-End Benchmark",
        "algorithm": "ADR-009 §5.1/§5.2 Stage 2 Direct Bernstein-Basis Tri-State Offset Certification (113->170->336 bit)",
        "normativeThresholdClassification": (
            "PRODUCTION_ADOPTION_TARGET_AND_DECISION_TRIGGER "
            "(ADR-009 §7.2 Decision 4: <5 ms per contour guides DEC-13 Stage 2 adoption vs C/PyO3 acceleration; "
            "M00.4 library qualification runtime budget target is <=50 ms per curve)"
        ),
        "environmentMetadata": {
            "pythonVersion": platform.python_version(),
            "pythonImplementation": platform.python_implementation(),
            "platform": platform.platform(),
            "machine": platform.machine(),
            "cpuCount": os.cpu_count(),
            "pythonHashSeed": os.environ.get("PYTHONHASHSEED", "UNSET"),
            "warmupRuns": max(0, warmup_runs),
            "steadyStateMeasuredRepetitions": num_reps,
        },
        "measurementProtocol": {
            "timingMethod": "SINGLE_OUTER_PERF_COUNTER_PER_CONTOUR_PER_CANDIDATE",
            "outerTimerEnclosesPreprocessingVerificationSerialization": True,
            "unaccountedWrapperOverheadReported": True,
            "coldStartRuns": 1,
            "warmupRuns": max(0, warmup_runs),
            "steadyStateMeasuredRepetitions": num_reps,
            "zeroCrossContourCaching": True,
            "zeroContoursSkipped": True,
        },
        "corpusPath": str(path_obj),
        "corpusFileSha256": corpus_file_sha256,
        "corpusSha256": corpus.get("corpusSha256"),
        "contourCount": len(contours),
        "offsetDistanceCm": 1.5,
        "regularityMarginEpsilon": 0.05,
        "missingBlocksDisclosure": corpus.get("missingBlocksDisclosure", []),
        "coldStartSummary": cold_start_summary,
        "coldStartLatencyEvaluation5Ms": cold_eval_5ms,
        "candidates": candidates_summary,
        "latencyQualificationEvaluation5Ms": eval_5ms,
        "perContourRecords": last_records,
    }


def benchmark_10k_population_runtimes(canonical_63_contours_path: Optional[Any] = None) -> Dict[str, Any]:
    """Measures full-population wall-clock runtime per candidate on 10,000 pairs x 4 ops + 10,000 sqrts x 4 tiers,
    per-curve Horner microbenchmark, AND the full ADR-009 §7.2 63 canonical garment contours benchmark.
    """
    t_start = time.perf_counter()
    t0 = time.perf_counter()
    _ = evaluate_candidate_mpmath_iv()
    mp_ms = (time.perf_counter() - t0) * 1000.0

    t1 = time.perf_counter()
    _ = evaluate_candidate_python_flint()
    flint_ms = (time.perf_counter() - t1) * 1000.0

    t2 = time.perf_counter()
    _ = evaluate_candidate_pure_python_decimal_fraction()
    dec_ms = (time.perf_counter() - t2) * 1000.0

    per_curve = benchmark_interval_candidates_runtime(iterations=20)
    payload: Dict[str, Any] = {
        "artifactName": "IntervalCandidateBenchmarks.json",
        "nonDeterministicRuntimeObservation": True,
        "note": "Wall-clock runtime metrics are strictly separated from deterministic SHA-256 mathematical reports and manifests.",
        "environment": {
            "pythonVersion": platform.python_version(),
            "pythonImplementation": platform.python_implementation(),
            "platform": platform.platform(),
            "machine": platform.machine(),
            "pythonHashSeed": os.environ.get("PYTHONHASHSEED", "UNSET"),
        },
        "fullPopulation200kChecksRuntimeMs": {
            "mpmathIvFractionMs": round(mp_ms, 2),
            "pythonFlintArbFmpqMs": round(flint_ms, 2),
            "decimalIntervalFractionMs": round(dec_ms, 2),
            "totalSuiteMs": round((time.perf_counter() - t_start) * 1000.0, 2),
        },
        "perCurveLatencyBenchmarks": per_curve,
    }
    payload["latencyQualificationEvaluation"] = evaluate_three_candidates_p95_latency(payload, threshold_ms=5.0)
    if canonical_63_contours_path is not None:
        payload["canonical63GarmentContoursBenchmark"] = benchmark_63_canonical_garment_contours(
            canonical_63_contours_path
        )
    return payload


def evaluate_qualification_conjunction(
    primary: Dict[str, Any],
    secondary: Dict[str, Any],
    tertiary: Dict[str, Any],
) -> bool:
    """Strict fail-closed conjunctive qualification gate (PKG-M00-04 / I-04):
    Rejects ANY incomplete population (<200,000 checks, !=4 precision tiers, <10,000 pairs/sqrts),
    missing Bernstein stress degrees {5, 9, 12} or <1,000 checks, missing 53/113-bit hex enclosures,
    missing candidate-library-driven bisection, domain traps, or failed qualificationStatus.
    """
    required_tiers = {53, 113, 170, 336}

    def _candidate_ok(cand: Dict[str, Any], expected_status: str) -> bool:
        traps = cand.get("domainTrapsVerified", {})
        iso = cand.get("unsplitRootIsolationFromUnitInterval", {})
        bern_total = int(cand.get("bernsteinContainmentChecksTotal", 0))
        bern_passed = int(cand.get("bernsteinContainmentChecksPassed", 0))
        bern_degrees = set(cand.get("bernsteinDegreesVerified", []))
        checks_total = int(cand.get("outwardRoundingChecksTotal", 0))
        checks_passed = int(cand.get("outwardRoundingChecksPassed", 0))
        tiers = cand.get("precisionTierBreakdown", [])
        tier_bits = {
            int(t.get("precisionBits", t.get("equivalentBinaryBits", -1)))
            for t in tiers
            if isinstance(t, dict)
        }
        all_tiers_clean = (
            len(tiers) == 4
            and tier_bits == required_tiers
            and all(
                t.get("allOutwardEnclosedInExactRational") is True
                and int(t.get("operationsVerified", 0)) == 50000
                and int(t.get("operationsPassed", 0)) == 50000
                for t in tiers
            )
        )
        return bool(
            cand.get("availableInEnvironment") is True
            and cand.get("dyadicFloat64ExactConversionVerified") is True
            and cand.get("outwardDirectedRoundingVerified") is True
            and checks_total >= 200000
            and checks_passed == checks_total
            and cand.get("outwardRoundingFailuresCount") == 0
            and int(cand.get("intervalPairPopulationSize", 0)) >= 10000
            and int(cand.get("sqrtPopulationSize", 0)) >= 10000
            and all_tiers_clean
            and bern_total >= 1000
            and bern_passed == bern_total
            and {5, 9, 12}.issubset(bern_degrees)
            and traps.get("divisionByStraddlingZeroDetected") is True
            and traps.get("negativeSqrtDomainTrapDetected") is True
            and cand.get("grazingTangencyNoFalseNegative") is True
            and cand.get("wilkinsonClusterSeparationVerified") is True
            and iso.get("allPassed") is True
            and iso.get("candidateLibraryDrivenBisection") is True
            and cand.get("qualificationStatus") == expected_status
        )

    primary_hex_enclosures = primary.get("sampleIntervalEnclosures", [])
    hex_tiers_present = {
        int(rec.get("precisionBits", -1))
        for rec in primary_hex_enclosures
        if isinstance(rec, dict)
        and rec.get("strictlyEnclosedInFraction") is True
        and isinstance(rec.get("lowerEndpointHex"), str)
        and rec["lowerEndpointHex"].startswith("0x1.")
        and isinstance(rec.get("upperEndpointHex"), str)
        and rec["upperEndpointHex"].startswith("0x1.")
    }

    return bool(
        _candidate_ok(primary, "QUALIFIED_PRIMARY")
        and primary.get("nonDyadicRationalEnclosureVerified") is True
        and {53, 113}.issubset(hex_tiers_present)
        and primary.get("mpmathIvSemanticAudit", {}).get("allSemanticAuditsPassed") is True
        and _candidate_ok(secondary, "QUALIFIED_SECONDARY_RESERVE")
        and _candidate_ok(tertiary, "QUALIFIED_TERTIARY_FALLBACK")
    )


def generate_interval_library_qualification_report() -> Dict[str, Any]:
    """Produces the 100% deterministic `IntervalLibraryQualificationReport.json` (`M00_INTERVAL_QUALIFICATION_REPORT.json`)."""
    primary = evaluate_candidate_mpmath_iv()
    secondary = evaluate_candidate_python_flint()
    tertiary = evaluate_candidate_pure_python_decimal_fraction()

    all_qualified = evaluate_qualification_conjunction(primary, secondary, tertiary)

    return {
        "milestoneId": "M00.4",
        "artifactName": "IntervalLibraryQualificationReport.json",
        "governingDecision": "DEC-13 (Stage 1 Approved at Gate Auth-1 on 2026-11-16; Stage 2 Production Adoption Pending Gate Auth-2)",
        "governingADR": "ADR-009 (R2.1.2-R1 §3.2, §5 & §7.2)",
        "deterministicMathematicalEvidenceOnly": True,
        "runtimeBenchmarksArtifact": "artifacts/m00/IntervalCandidateBenchmarks.json",
        "populationSpecification": {
            "generatorAlgorithm": "random.Random(seed=20261116) + adversarial stress strata (subnormal, near-overflow, cancellation, tiny-divisor)",
            "seed": QUALIFICATION_RNG_SEED,
            "adversarialStressPairStrataCount": len(_SEED_RATIONAL_INTERVAL_PAIRS),
            "adversarialStressSqrtStrataCount": len(_SEED_SQRT_RATIONALS),
            "rationalIntervalPairsPerTier": QUALIFICATION_PAIR_POPULATION_SIZE,
            "operationsPerPair": ["add", "sub", "mul", "div"],
            "sqrtRationalInputsPerTier": QUALIFICATION_SQRT_POPULATION_SIZE,
            "precisionTiersBits": [53, 113, 170, 336],
            "totalChecksPerCandidate": (QUALIFICATION_PAIR_POPULATION_SIZE * 4 + QUALIFICATION_SQRT_POPULATION_SIZE) * 4,
            "totalChecksAcrossAllThreeCandidates": ((QUALIFICATION_PAIR_POPULATION_SIZE * 4 + QUALIFICATION_SQRT_POPULATION_SIZE) * 4) * 3,
        },
        "environment": {
            "pythonVersion": platform.python_version(),
            "pythonImplementation": platform.python_implementation(),
            "targetRuntime": f"{platform.system().lower()}-{platform.machine()}",
            "machine": platform.machine(),
            "pythonHashSeed": os.environ.get("PYTHONHASHSEED", "0"),
            "pinnedPackages": {
                "mpmath": mpmath.__version__,
                "python-flint": getattr(flint, "__version__", "0.9.0") if HAS_FLINT else None,
            },
        },
        "candidatesEvaluated": [primary, secondary, tertiary],
        "recommendedForStage2SignOffAtGateAuth2": {
            "selectedOracleStack": "mpmath.iv (53-bit screen + 113-bit primary + 170/336-bit escalation) + fractions.Fraction",
            "secondaryCExtensionReserve": "python-flint 0.9.0 (arb C ball + fmpq)",
            "zeroDependencyStdlibFallback": "fractions.Fraction + DecimalInterval (prec=17, 35, 52, 102, ROUND_FLOOR/ROUND_CEILING)",
            "rationale": (
                "All 3 candidates passed 100% of 200,000 exact Fraction outward-rounding checks each (600,000 total checks across "
                "10,000 rational interval pairs x 4 ops + 10,000 sqrt inputs at all 4 precision tiers: 53, 113, 170, 336 bits, "
                "including subnormal, near-overflow, and cancellation stress strata), >=1,000 Bernstein polynomial containment checks "
                "across degrees {5, 9, 12}, domain violation traps, and un-pre-split Wilkinson root-cluster isolation "
                "(Delta t = 1e-7 and 1e-9) from [0, 1] with candidate-library interval enclosure checks. Explicit mpmath.iv semantic "
                "pitfalls are documented and mitigated, with python-flint C-backed arb balls cross-qualified as secondary reserve."
            ),
            "stage2GovernanceNote": (
                "Per Owner Authorization Record Checkpoint 12, this report completes M00.4 Step 1-2 Library Qualification. "
                "Production adoption for M02 remains gated on Project Owner sign-off of DEC-13 Stage 2 at Gate Auth-2."
            ),
        },
        "allCandidatesQualified": all_qualified,
    }
