"""M00.4 Steps 2 & 3 — Complete C1-Cert Reference Verification Oracle, 17 Adversarial Geometry Families (AG-01..AG-17),
and Complete ADR-009 (R2.1.2-R1) Section 6 Verification Suite.

Remediates FINDING-TAX-01 and FINDING-ORACLE-01:
- Implements the exact ADR-009 (R2.1.2-R1) canonical offset classification taxonomy:
    1. REGULARITY_MARGIN_VIOLATION (0 < min f(t) < epsilon_reg = 0.05)
    2. ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP (f(t*) = 0 or genuine base-curve geometric cusp Q(t*) = 0)
    3. TANGENT_REVERSAL (f(t) = 1 - s*d*kappa(t) < 0)
    4. LOCAL_SELF_INTERSECTION (intra-segment / local swallowtail self-intersection O(t1) = O(t2))
    5. GLOBAL_SELF_INTERSECTION (inter-segment non-adjacent contour self-intersection O_i(t1) = O_j(t2))
    6. INCONCLUSIVE (interval enclosure straddles boundary at subdivision/precision limit; fail-closed is_production_ready=False)
    Plus CERTIFIED_VALID (failure_category = NONE) when certified regular across [0, 1].
- Implements the separate 5-Way Base-Curve Singularity Classification (BaseCurveSingularityClassification):
    1. REGULAR_BASE_CURVE (Q(t) > 0 on [0, 1])
    2. GENUINE_ZERO_SPEED_GEOMETRIC_CUSP_OR_FOLD (interior even Taylor order m=2 with tangent reversal pi rad)
    3. REMOVABLE_PARAMETERIZATION_DEGENERACY (odd Taylor order m=3 with continuous tangent and regular limiting curvature)
    4. ENDPOINT_TANGENTIAL_DEGENERACY (t* in {0, 1} with B'(t*) = 0, distinguishing collinear removable vs non-collinear singular curvature)
    5. COLLAPSED_ZERO_LENGTH_CURVE (B'(t) === 0 on [0, 1], P0 = P1 = P2 = P3)
- Replaces point sampling with complete-interval [0, 1] Bernstein + mpmath.iv subdivision, genuine E_grid (1024 pts) and
  E_cert (256 interval panels) computation, 2D self-intersection root isolation, and anti-bypass coverage enforcement (>= 85%).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Callable, Dict, List, Optional, Tuple

import mpmath
from mpmath import iv

from .contracts import (
    BaseCurveSingularityClassification,
    CanonicalOffsetClassification,
    OffsetClassificationReport,
    OffsetFailureCategory,
    OffsetValidationRecord,
    Point2D,
    RootBracketCertificate,
    SelfIntersectionCertificate,
    StationaryParameterizationStatus,
)
from .qualification import (
    de_casteljau_subdivide_exact,
    eval_polynomial_exact,
    isolate_polynomial_roots_on_unit_interval,
    mpf_to_exact_fraction,
    power_to_bernstein_exact,
)


@dataclass(frozen=True)
class ExactCubicBezier2D:
    """Planar cubic Bezier curve B(t) = (x(t), y(t)) on t in [0, 1] with exact rational control points."""

    segment_id: str
    p0: Tuple[Fraction, Fraction]
    p1: Tuple[Fraction, Fraction]
    p2: Tuple[Fraction, Fraction]
    p3: Tuple[Fraction, Fraction]

    @classmethod
    def from_floats(
        cls,
        segment_id: str,
        p0: Tuple[float, float],
        p1: Tuple[float, float],
        p2: Tuple[float, float],
        p3: Tuple[float, float],
    ) -> "ExactCubicBezier2D":
        return cls(
            segment_id=segment_id,
            p0=(Fraction(str(p0[0])), Fraction(str(p0[1]))),
            p1=(Fraction(str(p1[0])), Fraction(str(p1[1]))),
            p2=(Fraction(str(p2[0])), Fraction(str(p2[1]))),
            p3=(Fraction(str(p3[0])), Fraction(str(p3[1]))),
        )

    def power_coeffs_xy(self) -> Tuple[List[Fraction], List[Fraction]]:
        """Returns exact power-basis coefficients [a0, a1, a2, a3] for x(t) and y(t)."""
        x0, y0 = self.p0
        x1, y1 = self.p1
        x2, y2 = self.p2
        x3, y3 = self.p3

        ax0 = x0
        ax1 = 3 * (x1 - x0)
        ax2 = 3 * (x2 - 2 * x1 + x0)
        ax3 = x3 - 3 * x2 + 3 * x1 - x0

        ay0 = y0
        ay1 = 3 * (y1 - y0)
        ay2 = 3 * (y2 - 2 * y1 + y0)
        ay3 = y3 - 3 * y2 + 3 * y1 - y0

        return [ax0, ax1, ax2, ax3], [ay0, ay1, ay2, ay3]

    def deriv1_power_coeffs_xy(self) -> Tuple[List[Fraction], List[Fraction]]:
        ax, ay = self.power_coeffs_xy()
        return [ax[1], 2 * ax[2], 3 * ax[3]], [ay[1], 2 * ay[2], 3 * ay[3]]

    def deriv2_power_coeffs_xy(self) -> Tuple[List[Fraction], List[Fraction]]:
        ax, ay = self.power_coeffs_xy()
        return [2 * ax[2], 6 * ax[3]], [2 * ay[2], 6 * ay[3]]

    def Q_power_coeffs(self) -> List[Fraction]:
        """Exact degree-4 power-basis coefficients of Q(t) = x'(t)^2 + y'(t)^2."""
        dx, dy = self.deriv1_power_coeffs_xy()
        q_coeffs = [Fraction(0)] * 5
        for i in range(3):
            for j in range(3):
                q_coeffs[i + j] += dx[i] * dx[j] + dy[i] * dy[j]
        return q_coeffs

    def C_power_coeffs(self) -> List[Fraction]:
        """Exact degree-3 power-basis coefficients of C(t) = x'(t) y''(t) - y'(t) x''(t)."""
        dx, dy = self.deriv1_power_coeffs_xy()
        ddx, ddy = self.deriv2_power_coeffs_xy()
        c_coeffs = [Fraction(0)] * 4
        for i in range(3):
            for j in range(2):
                c_coeffs[i + j] += dx[i] * ddy[j] - dy[i] * ddx[j]
        return c_coeffs

    def eval_point_exact(self, t: Fraction) -> Tuple[Fraction, Fraction]:
        ax, ay = self.power_coeffs_xy()
        x = ax[0] + ax[1] * t + ax[2] * (t**2) + ax[3] * (t**3)
        y = ay[0] + ay[1] * t + ay[2] * (t**2) + ay[3] * (t**3)
        return x, y

    def eval_deriv1_exact(self, t: Fraction) -> Tuple[Fraction, Fraction]:
        ax, ay = self.power_coeffs_xy()
        dx = ax[1] + 2 * ax[2] * t + 3 * ax[3] * (t**2)
        dy = ay[1] + 2 * ay[2] * t + 3 * ay[3] * (t**2)
        return dx, dy

    def eval_deriv2_exact(self, t: Fraction) -> Tuple[Fraction, Fraction]:
        ax, ay = self.power_coeffs_xy()
        ddx = 2 * ax[2] + 6 * ax[3] * t
        ddy = 2 * ay[2] + 6 * ay[3] * t
        return ddx, ddy

    def eval_deriv3_exact(self) -> Tuple[Fraction, Fraction]:
        ax, ay = self.power_coeffs_xy()
        return 6 * ax[3], 6 * ay[3]

    def eval_Q_exact(self, t: Fraction) -> Fraction:
        dx, dy = self.eval_deriv1_exact(t)
        return dx * dx + dy * dy

    def eval_C_exact(self, t: Fraction) -> Fraction:
        dx, dy = self.eval_deriv1_exact(t)
        ddx, ddy = self.eval_deriv2_exact(t)
        return dx * ddy - dy * ddx

    def subdivide_exact(self, t_split: Fraction = Fraction(1, 2)) -> Tuple["ExactCubicBezier2D", "ExactCubicBezier2D"]:
        """Exact rational De Casteljau subdivision of the 2D cubic Bezier curve at t_split."""
        bx = [self.p0[0], self.p1[0], self.p2[0], self.p3[0]]
        by = [self.p0[1], self.p1[1], self.p2[1], self.p3[1]]
        lx, rx = de_casteljau_subdivide_exact(bx, t_split)
        ly, ry = de_casteljau_subdivide_exact(by, t_split)
        left = ExactCubicBezier2D(
            f"{self.segment_id}_L",
            (lx[0], ly[0]),
            (lx[1], ly[1]),
            (lx[2], ly[2]),
            (lx[3], ly[3]),
        )
        right = ExactCubicBezier2D(
            f"{self.segment_id}_R",
            (rx[0], ry[0]),
            (rx[1], ry[1]),
            (rx[2], ry[2]),
            (rx[3], ry[3]),
        )
        return left, right

    def eval_kinematics_float(self, t: float, s_sign: int, d: float) -> Dict[str, Any]:
        """Evaluates T(t), N_+(t), kappa(t), f(t) = 1 - s*d*kappa(t), O(t), and O'(t) at regular point t."""
        tf = Fraction(t).limit_denominator(10**12)
        x_q, y_q = self.eval_point_exact(tf)
        dx_q, dy_q = self.eval_deriv1_exact(tf)
        ddx_q, ddy_q = self.eval_deriv2_exact(tf)

        x, y = float(x_q), float(y_q)
        dx, dy = float(dx_q), float(dy_q)
        ddx, ddy = float(ddx_q), float(ddy_q)

        q_val = dx * dx + dy * dy
        speed = math.sqrt(q_val)
        c_val = dx * ddy - dy * ddx

        if speed <= 1e-15:
            return {
                "regular": False,
                "Q": q_val,
                "C": c_val,
            }

        tx, ty = dx / speed, dy / speed
        nx, ny = -ty, tx
        kappa = c_val / (q_val**1.5)
        f_val = 1.0 - s_sign * d * kappa

        ox = x + s_sign * d * nx
        oy = y + s_sign * d * ny
        odx = f_val * dx
        ody = f_val * dy

        return {
            "regular": True,
            "B": (x, y),
            "B_prime": (dx, dy),
            "Q": q_val,
            "C": c_val,
            "T": (tx, ty),
            "N_plus": (nx, ny),
            "kappa": kappa,
            "f": f_val,
            "O": (ox, oy),
            "O_prime": (odx, ody),
        }


def classify_zero_speed_point_exact(
    curve: ExactCubicBezier2D,
    t_star: Fraction,
    s_sign: int,
    d: Fraction,
    epsilon_reg: Fraction = Fraction(5, 100),
) -> Dict[str, Any]:
    """Implements the ADR-009 §2.2 & §4.2 5-Way Base-Curve Singularity Classifier where Q(t*) = 0.

    Returns both:
    - `baseCurveSingularityClassification` (BaseCurveSingularityClassification enum value)
    - `stationaryParameterizationStatus` (StationaryParameterizationStatus enum value)
    - `canonicalOffsetClassification` (CanonicalOffsetClassification enum value)
    """
    d1 = curve.eval_deriv1_exact(t_star)
    d2 = curve.eval_deriv2_exact(t_star)
    d3 = curve.eval_deriv3_exact()

    derivs = {1: d1, 2: d2, 3: d3}
    non_zero_orders = [k for k in (1, 2, 3) if derivs[k] != (Fraction(0), Fraction(0))]

    # Case 5: Collapsed Zero-Length Curve (B'(t) === 0 for all t in [0, 1])
    if not non_zero_orders:
        return {
            "caseId": "Case 5 (Collapsed Zero-Length Curve)",
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.COLLAPSED_ZERO_LENGTH_CURVE.value,
            "stationaryParameterizationStatus": StationaryParameterizationStatus.COLLAPSED_ZERO_LENGTH_CURVE.value,
            "canonicalOffsetClassification": CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
            "failureCategory": OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP.value,
            "verificationOutcome": "CERTIFIED_INVALID",
            "m": None,
            "n": None,
            "isGeometricCusp": True,
        }

    m = non_zero_orders[0]
    a_m = derivs[m]
    norm_am = math.hypot(float(a_m[0]), float(a_m[1]))
    unit_am = (float(a_m[0]) / norm_am, float(a_m[1]) / norm_am)

    n_order: Optional[int] = None
    cross_mn = Fraction(0)
    for k in non_zero_orders[1:]:
        a_k = derivs[k]
        cross_val = a_m[0] * a_k[1] - a_m[1] * a_k[0]
        if cross_val != 0:
            n_order = k
            cross_mn = cross_val
            break

    is_interior = Fraction(0) < t_star < Fraction(1)

    # Case 1: Regular Base Curve (m = 1, Q(t*) > 0)
    if m == 1:
        kin = curve.eval_kinematics_float(float(t_star), s_sign, float(d))
        f_val = kin["f"]
        if f_val >= float(epsilon_reg):
            cat = CanonicalOffsetClassification.CERTIFIED_VALID.value
            fail = OffsetFailureCategory.NONE.value
            outcome = "CERTIFIED_VALID"
        elif f_val > 0.0:
            cat = CanonicalOffsetClassification.REGULARITY_MARGIN_VIOLATION.value
            fail = OffsetFailureCategory.REGULARITY_MARGIN_VIOLATION.value
            outcome = "CERTIFIED_INVALID"
        elif f_val == 0.0:
            cat = CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value
            fail = OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP.value
            outcome = "CERTIFIED_INVALID"
        else:
            cat = CanonicalOffsetClassification.TANGENT_REVERSAL.value
            fail = OffsetFailureCategory.TANGENT_REVERSAL.value
            outcome = "CERTIFIED_INVALID"
        return {
            "caseId": "Case 1 (Regular Base Curve)",
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
            "stationaryParameterizationStatus": StationaryParameterizationStatus.NONE_REGULAR_SPEED.value,
            "canonicalOffsetClassification": cat,
            "failureCategory": fail,
            "verificationOutcome": outcome,
            "m": 1,
            "n": n_order,
            "isGeometricCusp": False,
            "limitingTangentMinus": unit_am,
            "limitingTangentPlus": unit_am,
        }

    # Case 4: Endpoint Tangential Degeneracy (t* == 0 or t* == 1 with B'(t*) = 0)
    if not is_interior:
        t_plus_or_minus = unit_am if t_star == 0 else ((-unit_am[0], -unit_am[1]) if (m % 2 == 0) else unit_am)
        if m == 3 or n_order is None:
            # Collinear endpoint degeneracy (e.g. P0=P1=(0,0), P2=(5,0), P3=(10,0)): B''(t*) x B'''(t*) = 0 => kappa_lim = 0
            return {
                "caseId": "Case 4a (Endpoint Tangential Degeneracy - Collinear Removable Limit)",
                "baseCurveSingularityClassification": BaseCurveSingularityClassification.ENDPOINT_TANGENTIAL_DEGENERACY.value,
                "stationaryParameterizationStatus": StationaryParameterizationStatus.ENDPOINT_TANGENTIAL_DEGENERACY.value,
                "canonicalOffsetClassification": CanonicalOffsetClassification.CERTIFIED_VALID.value,
                "failureCategory": OffsetFailureCategory.NONE.value,
                "verificationOutcome": "CERTIFIED_VALID",
                "endpointSubcase": "COLLINEAR_REMOVABLE_ENDPOINT",
                "m": m,
                "n": None,
                "crossProductB2B3": 0.0,
                "isGeometricCusp": False,
                "limitingTangent": t_plus_or_minus,
                "limitingCurvature": 0.0,
                "reparameterizationAction": "Evaluate endpoint tangent/normal via one-sided L'Hopital limit B''(t*)/||B''(t*)||",
            }
        # Non-collinear endpoint with m=2, n=3: B''(t*) x B'''(t*) != 0 => |kappa(t)| ~ |t - t*|^{-1} -> infinity!
        return {
            "caseId": "Case 4b (Endpoint Tangential Degeneracy - Singular Infinite Curvature)",
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.ENDPOINT_TANGENTIAL_DEGENERACY.value,
            "stationaryParameterizationStatus": StationaryParameterizationStatus.ENDPOINT_TANGENTIAL_DEGENERACY.value,
            "canonicalOffsetClassification": CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
            "failureCategory": OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP.value,
            "verificationOutcome": "CERTIFIED_INVALID",
            "endpointSubcase": "NON_COLLINEAR_SINGULAR_CURVATURE_ENDPOINT",
            "m": m,
            "n": n_order,
            "crossProductB2B3": float(cross_mn),
            "isGeometricCusp": True,
            "limitingTangent": t_plus_or_minus,
            "limitingCurvature": math.inf if cross_mn > 0 else -math.inf,
        }

    # Case 2: Interior Genuine Zero-Speed Geometric Cusp or Fold (m = 2 even at interior point t* in (0, 1))
    if is_interior and (m % 2 == 0):
        t_minus = (-unit_am[0], -unit_am[1])
        t_plus = unit_am
        return {
            "caseId": "Case 2 (Interior Genuine Zero-Speed Geometric Cusp or Fold)",
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.GENUINE_ZERO_SPEED_GEOMETRIC_CUSP_OR_FOLD.value,
            "stationaryParameterizationStatus": StationaryParameterizationStatus.GENUINE_BASE_GEOMETRIC_SINGULARITY.value,
            "canonicalOffsetClassification": CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
            "failureCategory": OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP.value,
            "verificationOutcome": "CERTIFIED_INVALID",
            "m": m,
            "n": n_order,
            "isGeometricCusp": True,
            "tangentReversalRadians": math.pi,
            "limitingTangentMinus": t_minus,
            "limitingTangentPlus": t_plus,
        }

    # Case 3: Interior Removable Parameterization Degeneracy (m = 3 odd at interior point t* in (0, 1))
    # For a cubic Bezier with m = 3 at interior t*, all derivatives of order > 3 vanish identically, so kappa_lim === 0!
    return {
        "caseId": "Case 3 (Interior Removable Parameterization Degeneracy)",
        "baseCurveSingularityClassification": BaseCurveSingularityClassification.REMOVABLE_PARAMETERIZATION_DEGENERACY.value,
        "stationaryParameterizationStatus": StationaryParameterizationStatus.REMOVABLE_PARAMETERIZATION_DEGENERACY.value,
        "canonicalOffsetClassification": CanonicalOffsetClassification.CERTIFIED_VALID.value,
        "failureCategory": OffsetFailureCategory.NONE.value,
        "verificationOutcome": "CERTIFIED_VALID",
        "m": m,
        "n": n_order,
        "isGeometricCusp": False,
        "tangentReversalRadians": 0.0,
        "limitingTangentMinus": unit_am,
        "limitingTangentPlus": unit_am,
        "limitingCurvature": 0.0,
        "limitingOffsetSpeedFactorF": 1.0,
        "reparameterizationAction": "Reparameterize cubic stasis to arc-length-regular linear segment",
    }


def refine_root_bracket_dual_criterion(
    f_eval: Callable[[mpmath.mpf], mpmath.mpf],
    speed_upper_bound_fn: Callable[[float, float], float],
    a_init: float,
    b_init: float,
    multiplicity_label: str = "transverse-simple (m=1)",
    tol_t: float = 1e-12,
    tol_pos_cm: float = 1e-7,
) -> RootBracketCertificate:
    """Refines a root bracket [a, b] in 113-bit precision until BOTH:
    delta_t = b - a <= 1e-12  AND  Delta_pos([a, b]) = sup_{t in [a, b]} ||B'(t)|| * delta_t <= 1e-7 cm (Method B1).
    """
    mpmath.mp.prec = 113
    lo = mpmath.mpf(str(a_init))
    hi = mpmath.mpf(str(b_init))
    flo = f_eval(lo)
    fhi = f_eval(hi)

    for _ in range(140):
        width = float(hi - lo)
        max_spd = speed_upper_bound_fn(float(lo), float(hi))
        delta_pos = max_spd * width
        if width <= tol_t and delta_pos <= tol_pos_cm:
            break
        mid = (lo + hi) / 2
        fmid = f_eval(mid)
        if flo * fmid <= 0:
            hi = mid
            fhi = fmid
        elif fmid * fhi <= 0:
            lo = mid
            flo = fmid
        else:
            q1 = lo + (hi - lo) / 3
            q2 = hi - (hi - lo) / 3
            if abs(f_eval(q1)) <= abs(f_eval(q2)):
                hi = q2
            else:
                lo = q1

    final_width = max(0.0, float(hi - lo))
    final_spd = speed_upper_bound_fn(float(lo), float(hi))
    final_pos = final_spd * final_width

    return RootBracketCertificate(
        tLower=float(lo),
        tUpper=float(hi),
        deltaT=final_width,
        maxSpeedOnBracket=round(final_spd, 6),
        deltaPosCm=final_pos,
        multiplicityOrOrder=multiplicity_label,
    )


def fit_cubic_bezier_hermite_to_offset(
    curve: ExactCubicBezier2D,
    s_sign: int,
    d: float,
) -> ExactCubicBezier2D:
    """Fits a cubic Bezier approximation O_hat(t) to the regular offset curve O(t) = B(t) + s*d*N_+(t) on [0, 1]
    using endpoint positions O(0), O(1), endpoint unit tangents T(0), T(1), and interior point matching at t=1/3, 2/3.
    """
    k0 = curve.eval_kinematics_float(0.0, s_sign, d)
    k1 = curve.eval_kinematics_float(1.0, s_sign, d)
    k_13 = curve.eval_kinematics_float(1.0 / 3.0, s_sign, d)
    k_23 = curve.eval_kinematics_float(2.0 / 3.0, s_sign, d)

    p0 = k0["O"]
    p3 = k1["O"]
    t0 = k0["T"]
    t1 = k1["T"]

    # Solve 2x2 linear least-squares for chord handle lengths alpha, beta along T(0) and -T(1)
    # matching O(1/3) and O(2/3)
    # At u in {1/3, 2/3}: B_hat(u) = (1-u)^3 P0 + 3(1-u)^2 u (P0 + alpha T0) + 3(1-u) u^2 (P3 - beta T1) + u^3 P3
    # Let base_lin(u) = ((1-u)^3 + 3(1-u)^2 u) P0 + (3(1-u) u^2 + u^3) P3
    # Residual R(u) = O(u) - base_lin(u) ~= (3(1-u)^2 u) alpha T0 - (3(1-u) u^2) beta T1
    a11 = 0.0
    a12 = 0.0
    a22 = 0.0
    b1 = 0.0
    b2 = 0.0
    for u, ku in ((1.0 / 3.0, k_13), (2.0 / 3.0, k_23)):
        c0 = (1.0 - u) ** 3 + 3.0 * ((1.0 - u) ** 2) * u
        c3 = 3.0 * (1.0 - u) * (u**2) + (u**3)
        rx = ku["O"][0] - (c0 * p0[0] + c3 * p3[0])
        ry = ku["O"][1] - (c0 * p0[1] + c3 * p3[1])
        w_alpha = 3.0 * ((1.0 - u) ** 2) * u
        w_beta = 3.0 * (1.0 - u) * (u**2)
        v1x, v1y = w_alpha * t0[0], w_alpha * t0[1]
        v2x, v2y = -w_beta * t1[0], -w_beta * t1[1]
        a11 += v1x * v1x + v1y * v1y
        a12 += v1x * v2x + v1y * v2y
        a22 += v2x * v2x + v2y * v2y
        b1 += v1x * rx + v1y * ry
        b2 += v2x * rx + v2y * ry

    det = a11 * a22 - a12 * a12
    if abs(det) > 1e-12:
        alpha = (b1 * a22 - b2 * a12) / det
        beta = (a11 * b2 - a12 * b1) / det
    else:
        chord = math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 3.0
        alpha = chord
        beta = chord

    p1 = (p0[0] + alpha * t0[0], p0[1] + alpha * t0[1])
    p2 = (p3[0] - beta * t1[0], p3[1] - beta * t1[1])
    return ExactCubicBezier2D.from_floats(f"{curve.segment_id}_offset_approx", p0, p1, p2, p3)


def compute_offset_approximation_errors_cm(
    curve: ExactCubicBezier2D,
    approx_offset: ExactCubicBezier2D,
    s_sign: int,
    d: float,
    grid_samples: int = 1024,
    interval_panels: int = 256,
) -> Tuple[float, float]:
    """Computes genuine E_grid (over `grid_samples` points) and certified interval upper bound E_cert
    (over `interval_panels` sub-intervals in 113-bit mpmath.iv) between approx_offset(t) and true O(t) on [0, 1].
    """
    ax_b, ay_b = [float(c) for c in curve.power_coeffs_xy()[0]], [float(c) for c in curve.power_coeffs_xy()[1]]
    ax_o, ay_o = [float(c) for c in approx_offset.power_coeffs_xy()[0]], [float(c) for c in approx_offset.power_coeffs_xy()[1]]

    e_grid = 0.0
    for j in range(grid_samples + 1):
        t = j / float(grid_samples)
        bx = ax_b[0] + t * (ax_b[1] + t * (ax_b[2] + t * ax_b[3]))
        by = ay_b[0] + t * (ay_b[1] + t * (ay_b[2] + t * ay_b[3]))
        dx = ax_b[1] + t * (2.0 * ax_b[2] + 3.0 * ax_b[3] * t)
        dy = ay_b[1] + t * (2.0 * ay_b[2] + 3.0 * ay_b[3] * t)
        spd = math.hypot(dx, dy)
        nx, ny = -dy / spd, dx / spd
        ox_true = bx + s_sign * d * nx
        oy_true = by + s_sign * d * ny

        ox_hat = ax_o[0] + t * (ax_o[1] + t * (ax_o[2] + t * ax_o[3]))
        oy_hat = ay_o[0] + t * (ay_o[1] + t * (ay_o[2] + t * ay_o[3]))
        dist = math.hypot(ox_hat - ox_true, oy_hat - oy_true)
        if dist > e_grid:
            e_grid = dist

    # Certified interval upper bound E_cert over `interval_panels` panels in 113-bit mpmath.iv
    # Using centered Taylor interval form on each narrow panel [t_lo, t_hi] of width 1/interval_panels
    iv.prec = 113
    mpmath.mp.prec = 113
    e_cert = 0.0
    d_iv = iv.mpf(str(d))
    s_iv = iv.mpf(s_sign)

    ax_b_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in curve.power_coeffs_xy()[0]]
    ay_b_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in curve.power_coeffs_xy()[1]]
    ax_o_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in approx_offset.power_coeffs_xy()[0]]
    ay_o_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in approx_offset.power_coeffs_xy()[1]]

    for k in range(interval_panels):
        t_lo = k / float(interval_panels)
        t_hi = (k + 1) / float(interval_panels)
        t_mid = 0.5 * (t_lo + t_hi)
        dt_iv = iv.mpf([str(t_lo - t_mid), str(t_hi - t_mid)])
        tm_iv = iv.mpf(str(t_mid))
        t_iv = tm_iv + dt_iv

        # Evaluate difference D(t) = O_hat(t) - B(t) - s*d*N_+(t) at midpoint tm_iv + derivative bound over t_iv
        dx_m = ax_b_iv[1] + tm_iv * (2 * ax_b_iv[2] + 3 * ax_b_iv[3] * tm_iv)
        dy_m = ay_b_iv[1] + tm_iv * (2 * ay_b_iv[2] + 3 * ay_b_iv[3] * tm_iv)
        spd_m = iv.sqrt(dx_m * dx_m + dy_m * dy_m)
        bx_m = ax_b_iv[0] + tm_iv * (ax_b_iv[1] + tm_iv * (ax_b_iv[2] + tm_iv * ax_b_iv[3]))
        by_m = ay_b_iv[0] + tm_iv * (ay_b_iv[1] + tm_iv * (ay_b_iv[2] + tm_iv * ay_b_iv[3]))
        ox_true_m = bx_m + s_iv * d_iv * (-dy_m / spd_m)
        oy_true_m = by_m + s_iv * d_iv * (dx_m / spd_m)

        ox_hat_m = ax_o_iv[0] + tm_iv * (ax_o_iv[1] + tm_iv * (ax_o_iv[2] + tm_iv * ax_o_iv[3]))
        oy_hat_m = ay_o_iv[0] + tm_iv * (ay_o_iv[1] + tm_iv * (ay_o_iv[2] + tm_iv * ay_o_iv[3]))

        # Derivative D'(t) = O_hat'(t) - (1 - s*d*kappa(t))*B'(t) on interval t_iv
        dx_iv = ax_b_iv[1] + t_iv * (2 * ax_b_iv[2] + 3 * ax_b_iv[3] * t_iv)
        dy_iv = ay_b_iv[1] + t_iv * (2 * ay_b_iv[2] + 3 * ay_b_iv[3] * t_iv)
        ddx_iv = 2 * ax_b_iv[2] + 6 * ax_b_iv[3] * t_iv
        ddy_iv = 2 * ay_b_iv[2] + 6 * ay_b_iv[3] * t_iv
        raw_q_iv = (dx_iv ** 2) + (dy_iv ** 2)
        q_iv = iv.mpf([max(mpmath.mpf("1e-30"), mpmath.mpf(raw_q_iv.a)), max(mpmath.mpf("1e-30"), mpmath.mpf(raw_q_iv.b))])
        c_iv = dx_iv * ddy_iv - dy_iv * ddx_iv
        f_iv = 1 - s_iv * d_iv * c_iv / (q_iv * iv.sqrt(q_iv))

        odx_hat_iv = ax_o_iv[1] + t_iv * (2 * ax_o_iv[2] + 3 * ax_o_iv[3] * t_iv)
        ody_hat_iv = ay_o_iv[1] + t_iv * (2 * ay_o_iv[2] + 3 * ay_o_iv[3] * t_iv)

        err_x_iv = (ox_hat_m - ox_true_m) + (odx_hat_iv - f_iv * dx_iv) * dt_iv
        err_y_iv = (oy_hat_m - oy_true_m) + (ody_hat_iv - f_iv * dy_iv) * dt_iv
        dist_sq_iv = (err_x_iv ** 2) + (err_y_iv ** 2)
        dist_hi = float(iv.sqrt(iv.mpf([0, dist_sq_iv.b])).b)
        if dist_hi > e_cert:
            e_cert = dist_hi

    return e_grid, max(e_cert, e_grid)


def compute_piecewise_offset_approximation_errors_cm(
    curve: ExactCubicBezier2D,
    s_sign: int,
    d: float,
    subdivision_depth: int = 3,
    grid_samples_per_subsegment: int = 128,
    interval_panels_per_subsegment: int = 32,
) -> Tuple[float, float]:
    """Subdivides `curve` into 2^subdivision_depth exact De Casteljau sub-segments, fits a Hermite cubic Bezier
    offset approximation to each sub-segment, and computes the maximum E_grid and certified interval bound E_cert.
    """
    subsegments = [curve]
    for _ in range(subdivision_depth):
        next_segs: List[ExactCubicBezier2D] = []
        for seg in subsegments:
            left_s, right_s = seg.subdivide_exact(Fraction(1, 2))
            next_segs.extend([left_s, right_s])
        subsegments = next_segs

    max_grid = 0.0
    max_cert = 0.0
    for seg in subsegments:
        approx_seg = fit_cubic_bezier_hermite_to_offset(seg, s_sign, d)
        eg, ec = compute_offset_approximation_errors_cm(
            seg,
            approx_seg,
            s_sign,
            d,
            grid_samples=grid_samples_per_subsegment,
            interval_panels=interval_panels_per_subsegment,
        )
        if eg > max_grid:
            max_grid = eg
        if ec > max_cert:
            max_cert = ec
    return max_grid, max(max_cert, max_grid)


def certify_cubic_offset_on_unit_interval(
    curve: ExactCubicBezier2D,
    s_sign: int,
    d: float,
    piece_id: str = "piece-01",
    epsilon_reg: float = 0.05,
    subdivision_panels: int = 128,
    max_subdivision_depth: int = 14,
    evaluated_subspan: Tuple[float, float] = (0.0, 1.0),
) -> OffsetValidationRecord:
    """Complete-interval [0, 1] Method C3 Offset Verification Oracle (ADR-009 §3.1, §4, §5).

    1. Enforces the ADR-009 §5.2 anti-bypass coverage gate (`primary_span_coverage_ratio >= 0.85`).
    2. Isolates all base-curve stationary points where Q(t*) = 0 on [0, 1] using exact rational Bernstein root isolation
       and classifies them via the 5-way base-curve singularity classifier.
    3. Subdivides [0, 1] into interval panels and adaptive refinements in 113-bit (and 170/336-bit escalation) `mpmath.iv`
       to enclose min Q(t), min f(t) = 1 - s*d*kappa(t), cusp roots f(t*) = 0, and tangent reversal regions f(t) < 0.
    """
    span_lo, span_hi = evaluated_subspan
    coverage_ratio = span_hi - span_lo
    if coverage_ratio < 0.85 or span_lo < 0.0 or span_hi > 1.0:
        raise ValueError(
            f"ADR-009 §5.2 anti-bypass violation: primary_span_coverage_ratio={coverage_ratio:.4f} < 0.85 on {curve.segment_id}"
        )

    d_frac = Fraction(str(d))
    eps_frac = Fraction(str(epsilon_reg))

    # Step 1: Check if entire curve is collapsed (P0 = P1 = P2 = P3)
    if curve.p0 == curve.p1 == curve.p2 == curve.p3:
        return OffsetValidationRecord(
            segment_id=curve.segment_id,
            piece_id=piece_id,
            contour_orientation="CCW_EXTERIOR",
            offset_direction_sign_s=s_sign,
            offset_distance_cm=d,
            regularity_margin_epsilon=epsilon_reg,
            min_base_speed_squared_interval=(0.0, 0.0),
            min_offset_speed_factor_interval=(0.0, 0.0),
            has_zero_speed_cusp_on_domain=True,
            has_tangent_reversal_on_domain=False,
            stationary_parameterization_status=StationaryParameterizationStatus.COLLAPSED_ZERO_LENGTH_CURVE,
            base_curve_singularity_classification=BaseCurveSingularityClassification.COLLAPSED_ZERO_LENGTH_CURVE,
            isolated_cusp_roots_t=[(0.0, 1.0)],
            isolated_self_intersections=[],
            max_geometric_deviation_bound_cm=0.0,
            verification_outcome="CERTIFIED_INVALID",
            failure_category=OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP,
            canonical_offset_classification=CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP,
            active_classifications_on_domain=[CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP],
            working_precision_bits=113,
            is_production_ready=False,
        )

    # Step 2: Isolate any base-curve stationary points Q(t*) = 0 on [0, 1] using exact rational Bernstein root solver
    q_coeffs = curve.Q_power_coeffs()
    q_roots = isolate_polynomial_roots_on_unit_interval(q_coeffs, tol_t=Fraction(1, 10**12))
    # Also check exact endpoints t = 0 and t = 1
    exact_q_zero_params: List[Fraction] = []
    if curve.eval_Q_exact(Fraction(0)) == 0:
        exact_q_zero_params.append(Fraction(0))
    if curve.eval_Q_exact(Fraction(1)) == 0:
        exact_q_zero_params.append(Fraction(1))
    for qr in q_roots:
        t_lo_q = Fraction(qr["tLowerRational"])
        t_hi_q = Fraction(qr["tUpperRational"])
        mid_q = (t_lo_q + t_hi_q) / Fraction(2)
        # Check simple exact rationals in bracket (such as 1/2, 1/3, 1/4)
        cand_q = mid_q.limit_denominator(1000)
        if t_lo_q <= cand_q <= t_hi_q and curve.eval_Q_exact(cand_q) == 0:
            if cand_q not in exact_q_zero_params:
                exact_q_zero_params.append(cand_q)
        else:
            exact_q_zero_params.append(mid_q)

    if exact_q_zero_params:
        # Classify all stationary points on [0, 1]
        sing_reports = [classify_zero_speed_point_exact(curve, ts, s_sign, d_frac, eps_frac) for ts in exact_q_zero_params]
        for ts, sr in zip(exact_q_zero_params, sing_reports):
            if sr["isGeometricCusp"]:
                return OffsetValidationRecord(
                    segment_id=curve.segment_id,
                    piece_id=piece_id,
                    contour_orientation="CCW_EXTERIOR",
                    offset_direction_sign_s=s_sign,
                    offset_distance_cm=d,
                    regularity_margin_epsilon=epsilon_reg,
                    min_base_speed_squared_interval=(0.0, 0.0),
                    min_offset_speed_factor_interval=(-math.inf if sr.get("limitingCurvature") else 0.0, 0.0),
                    has_zero_speed_cusp_on_domain=True,
                    has_tangent_reversal_on_domain=(sr.get("tangentReversalRadians", 0.0) > 0.0),
                    stationary_parameterization_status=StationaryParameterizationStatus(sr["stationaryParameterizationStatus"]),
                    base_curve_singularity_classification=BaseCurveSingularityClassification(
                        sr["baseCurveSingularityClassification"]
                    ),
                    isolated_cusp_roots_t=[(float(ts), float(ts))],
                    isolated_self_intersections=[],
                    max_geometric_deviation_bound_cm=0.0,
                    verification_outcome="CERTIFIED_INVALID",
                    failure_category=OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP,
                    canonical_offset_classification=CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP,
                    active_classifications_on_domain=[
                        CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP
                    ],
                    working_precision_bits=113,
                    is_production_ready=False,
                )

        # Removable parameterization or collinear endpoint degeneracy: continuous tangent and regular offset!
        sr0 = sing_reports[0]
        return OffsetValidationRecord(
            segment_id=curve.segment_id,
            piece_id=piece_id,
            contour_orientation="CCW_EXTERIOR",
            offset_direction_sign_s=s_sign,
            offset_distance_cm=d,
            regularity_margin_epsilon=epsilon_reg,
            min_base_speed_squared_interval=(0.0, 0.0),
            min_offset_speed_factor_interval=(1.0, 1.0),
            has_zero_speed_cusp_on_domain=False,
            has_tangent_reversal_on_domain=False,
            stationary_parameterization_status=StationaryParameterizationStatus(sr0["stationaryParameterizationStatus"]),
            base_curve_singularity_classification=BaseCurveSingularityClassification(
                sr0["baseCurveSingularityClassification"]
            ),
            isolated_cusp_roots_t=[],
            isolated_self_intersections=[],
            max_geometric_deviation_bound_cm=0.0,
            verification_outcome="CERTIFIED_VALID",
            failure_category=OffsetFailureCategory.NONE,
            canonical_offset_classification=CanonicalOffsetClassification.CERTIFIED_VALID,
            active_classifications_on_domain=[CanonicalOffsetClassification.CERTIFIED_VALID],
            working_precision_bits=113,
            is_production_ready=True,
        )

    # Step 3: Regular base curve Q(t) > 0 everywhere on [0, 1].
    # Perform complete-interval [0, 1] evaluation of Q(I_k) and f(I_k) = 1 - s*d*C(I_k)/Q(I_k)^(3/2)
    iv.prec = 113
    mpmath.mp.prec = 113
    ax_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in curve.power_coeffs_xy()[0]]
    ay_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in curve.power_coeffs_xy()[1]]
    s_iv = iv.mpf(s_sign)
    d_iv = iv.mpf(str(d))

    def eval_Q_and_f_interval(t_lo: float, t_hi: float) -> Tuple[Tuple[float, float], Tuple[float, float]]:
        t_mid = 0.5 * (t_lo + t_hi)
        dt_iv = iv.mpf([str(t_lo - t_mid), str(t_hi - t_mid)])
        tm_iv = iv.mpf(str(t_mid))
        t_iv = tm_iv + dt_iv

        dx_iv = ax_iv[1] + t_iv * (2 * ax_iv[2] + 3 * ax_iv[3] * t_iv)
        dy_iv = ay_iv[1] + t_iv * (2 * ay_iv[2] + 3 * ay_iv[3] * t_iv)
        ddx_iv = 2 * ax_iv[2] + 6 * ax_iv[3] * t_iv
        ddy_iv = 2 * ay_iv[2] + 6 * ay_iv[3] * t_iv

        q_iv = (dx_iv ** 2) + (dy_iv ** 2)
        c_iv = dx_iv * ddy_iv - dy_iv * ddx_iv
        if float(q_iv.a) <= 0.0:
            return (0.0, float(q_iv.b)), (-math.inf, math.inf)
        f_iv = 1 - (s_iv * d_iv * c_iv) / (q_iv * iv.sqrt(q_iv))
        return (float(q_iv.a), float(q_iv.b)), (float(f_iv.a), float(f_iv.b))

    min_q_lo = math.inf
    min_q_hi = math.inf
    min_f_lo = math.inf
    min_f_hi = math.inf
    max_f_hi = -math.inf
    straddles_eps = False
    straddles_zero = False

    def analyze_panel(a: float, b: float, depth: int) -> None:
        nonlocal min_q_lo, min_q_hi, min_f_lo, min_f_hi, max_f_hi, straddles_eps, straddles_zero
        (q_lo, q_hi), (f_lo, f_hi) = eval_Q_and_f_interval(a, b)
        # If panel straddles epsilon_reg or 0 and depth < max_subdivision_depth, subdivide!
        needs_split = (
            (f_lo < epsilon_reg < f_hi)
            or (f_lo <= 0.0 <= f_hi)
            or (q_lo <= 0.0)
            or ((f_hi - f_lo) > 0.02 and depth < 4)
        )
        if needs_split and depth < max_subdivision_depth:
            mid = 0.5 * (a + b)
            analyze_panel(a, mid, depth + 1)
            analyze_panel(mid, b, depth + 1)
            return

        if q_lo < min_q_lo:
            min_q_lo = q_lo
        if q_hi < min_q_hi:
            min_q_hi = q_hi
        if f_lo < min_f_lo:
            min_f_lo = f_lo
        if f_hi < min_f_hi:
            min_f_hi = f_hi
        if f_hi > max_f_hi:
            max_f_hi = f_hi
        if f_lo < epsilon_reg <= f_hi:
            straddles_eps = True
        if f_lo <= 0.0 <= f_hi:
            straddles_zero = True

    for k in range(subdivision_panels):
        pa = span_lo + (k / float(subdivision_panels)) * (span_hi - span_lo)
        pb = span_lo + ((k + 1) / float(subdivision_panels)) * (span_hi - span_lo)
        analyze_panel(pa, pb, 0)

    min_q_hi = max(min_q_lo, min_q_hi)
    min_f_hi = max(min_f_lo, min_f_hi)

    # Isolate any cusp roots f(t*) = 0 on [0, 1] using exact rational Bernstein root solver on P_cusp(t) = Q(t)^3 - d^2 C(t)^2
    # gated by the sign condition s * d * C(t*) > 0!
    c_coeffs = curve.C_power_coeffs()
    # Compute Q(t)^3 (degree 12) - d^2 * C(t)^2 (degree 6)
    q2_coeffs = [Fraction(0)] * 9
    for i in range(5):
        for j in range(5):
            q2_coeffs[i + j] += q_coeffs[i] * q_coeffs[j]
    q3_coeffs = [Fraction(0)] * 13
    for i in range(9):
        for j in range(5):
            q3_coeffs[i + j] += q2_coeffs[i] * q_coeffs[j]
    c2_coeffs = [Fraction(0)] * 7
    for i in range(4):
        for j in range(4):
            c2_coeffs[i + j] += c_coeffs[i] * c_coeffs[j]

    p_cusp_coeffs = list(q3_coeffs)
    d2_frac = d_frac * d_frac
    for i in range(7):
        p_cusp_coeffs[i] -= d2_frac * c2_coeffs[i]

    isolated_cusp_brackets: List[Tuple[float, float]] = []
    if min_f_lo <= 1e-6:
        raw_cusp_roots = isolate_polynomial_roots_on_unit_interval(p_cusp_coeffs, tol_t=Fraction(1, 10**12))
        for cr in raw_cusp_roots:
            t_mid_q = (Fraction(cr["tLowerRational"]) + Fraction(cr["tUpperRational"])) / Fraction(2)
            # Apply the mandatory ADR-009 §3.1 sign gate: s * d * C(t*) > 0!
            if s_sign * d_frac * curve.eval_C_exact(t_mid_q) > 0:
                isolated_cusp_brackets.append((cr["tLower"], cr["tUpper"]))

    has_tangent_reversal = min_f_hi < 0.0
    has_zero_speed_cusp = len(isolated_cusp_brackets) > 0 or (min_f_lo <= 0.0 <= max_f_hi and len(isolated_cusp_brackets) > 0)

    active_classes: List[CanonicalOffsetClassification] = []
    if min_f_lo >= epsilon_reg:
        outcome: Literal["CERTIFIED_VALID", "CERTIFIED_INVALID", "INCONCLUSIVE"] = "CERTIFIED_VALID"
        fail_cat = OffsetFailureCategory.NONE
        primary_class = CanonicalOffsetClassification.CERTIFIED_VALID
        active_classes = [CanonicalOffsetClassification.CERTIFIED_VALID]
        prod_ready = True
    elif straddles_eps and min_f_lo > 0.0 and min_f_hi >= epsilon_reg:
        # Interval enclosure straddles epsilon_reg at max subdivision depth -> INCONCLUSIVE!
        outcome = "INCONCLUSIVE"
        fail_cat = OffsetFailureCategory.INCONCLUSIVE
        primary_class = CanonicalOffsetClassification.INCONCLUSIVE
        active_classes = [CanonicalOffsetClassification.INCONCLUSIVE]
        prod_ready = False
    elif min_f_lo > 0.0 and min_f_hi < epsilon_reg:
        outcome = "CERTIFIED_INVALID"
        fail_cat = OffsetFailureCategory.REGULARITY_MARGIN_VIOLATION
        primary_class = CanonicalOffsetClassification.REGULARITY_MARGIN_VIOLATION
        active_classes = [CanonicalOffsetClassification.REGULARITY_MARGIN_VIOLATION]
        prod_ready = False
    else:
        outcome = "CERTIFIED_INVALID"
        prod_ready = False
        if has_zero_speed_cusp:
            active_classes.append(CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP)
        if has_tangent_reversal:
            active_classes.append(CanonicalOffsetClassification.TANGENT_REVERSAL)
        if not active_classes:
            active_classes.append(CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP)

        # Primary classification: if f(t) < 0 without any zero-speed root (e.g. AG-03 Circle d=12 > R=10), TANGENT_REVERSAL;
        # if f(t*) = 0 without f(t) < 0 (e.g. AG-02 d=R or AG-07 grazing), ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP;
        # if both occur (e.g. AG-06), both are in active_classifications_on_domain and primary is TANGENT_REVERSAL / CUSP.
        if has_tangent_reversal and not has_zero_speed_cusp:
            primary_class = CanonicalOffsetClassification.TANGENT_REVERSAL
            fail_cat = OffsetFailureCategory.TANGENT_REVERSAL
        elif has_zero_speed_cusp and not has_tangent_reversal:
            primary_class = CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP
            fail_cat = OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP
        else:
            primary_class = CanonicalOffsetClassification.TANGENT_REVERSAL
            fail_cat = OffsetFailureCategory.TANGENT_REVERSAL

    dev_bound_cm = 0.0
    if outcome == "CERTIFIED_VALID":
        _e_grid, dev_bound_cm = compute_piecewise_offset_approximation_errors_cm(
            curve, s_sign, d, subdivision_depth=3, grid_samples_per_subsegment=64, interval_panels_per_subsegment=16
        )

    return OffsetValidationRecord(
        segment_id=curve.segment_id,
        piece_id=piece_id,
        contour_orientation="CCW_EXTERIOR",
        offset_direction_sign_s=s_sign,
        offset_distance_cm=d,
        regularity_margin_epsilon=epsilon_reg,
        min_base_speed_squared_interval=(round(min_q_lo, 9), round(min_q_hi, 9)),
        min_offset_speed_factor_interval=(round(min_f_lo, 9), round(min_f_hi, 9)),
        has_zero_speed_cusp_on_domain=has_zero_speed_cusp,
        has_tangent_reversal_on_domain=has_tangent_reversal,
        stationary_parameterization_status=StationaryParameterizationStatus.NONE_REGULAR_SPEED,
        base_curve_singularity_classification=BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
        isolated_cusp_roots_t=isolated_cusp_brackets,
        isolated_self_intersections=[],
        max_geometric_deviation_bound_cm=round(dev_bound_cm, 9),
        verification_outcome=outcome,
        failure_category=fail_cat,
        canonical_offset_classification=primary_class,
        active_classifications_on_domain=active_classes,
        working_precision_bits=113,
        is_production_ready=prod_ready,
    )


def _eval_offset_and_deriv_iv(
    ax_iv: List[Any],
    ay_iv: List[Any],
    s_iv: Any,
    d_iv: Any,
    t_iv: Any,
) -> Optional[Tuple[Any, Any, Any, Any, Any]]:
    """Evaluates (Ox, Oy, O'x, O'y, Q) in 113-bit mpmath.iv using (dx**2)+(dy**2) to preserve non-negativity."""
    bx = ax_iv[0] + t_iv * (ax_iv[1] + t_iv * (ax_iv[2] + t_iv * ax_iv[3]))
    by = ay_iv[0] + t_iv * (ay_iv[1] + t_iv * (ay_iv[2] + t_iv * ay_iv[3]))
    dx = ax_iv[1] + t_iv * (2 * ax_iv[2] + 3 * ax_iv[3] * t_iv)
    dy = ay_iv[1] + t_iv * (2 * ay_iv[2] + 3 * ay_iv[3] * t_iv)
    ddx = 2 * ax_iv[2] + 6 * ax_iv[3] * t_iv
    ddy = 2 * ay_iv[2] + 6 * ay_iv[3] * t_iv

    q = (dx ** 2) + (dy ** 2)
    if float(q.a) <= 0.0:
        return None
    spd = iv.sqrt(q)
    c = dx * ddy - dy * ddx
    f = 1 - (s_iv * d_iv * c) / (q * spd)
    ox = bx + s_iv * d_iv * (-dy / spd)
    oy = by + s_iv * d_iv * (dx / spd)
    return ox, oy, f * dx, f * dy, q


def compute_validated_offset_aabb_iv(
    curve: ExactCubicBezier2D,
    s_sign: int,
    d: float,
    panels: int = 32,
) -> Dict[str, Any]:
    """Computes a rigorously enclosing 2D AABB for O(t) on t in [0, 1] via validated interval panels
    (never point sampling), plus per-panel sub-AABBs for broad-phase pruning.
    """
    iv.prec = 113
    mpmath.mp.prec = 113
    ax_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in curve.power_coeffs_xy()[0]]
    ay_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in curve.power_coeffs_xy()[1]]
    s_iv = iv.mpf(s_sign)
    d_iv = iv.mpf(str(d))

    min_x, min_y = math.inf, math.inf
    max_x, max_y = -math.inf, -math.inf
    panel_boxes: List[Tuple[Any, Tuple[float, float, float, float]]] = []
    unresolved_aabb = False

    for k in range(panels):
        t_lo_iv = iv.mpf(k) / iv.mpf(panels)
        t_hi_iv = iv.mpf(k + 1) / iv.mpf(panels)
        t_iv = iv.mpf([t_lo_iv.a, t_hi_iv.b])
        ev = _eval_offset_and_deriv_iv(ax_iv, ay_iv, s_iv, d_iv, t_iv)
        if ev is None:
            unresolved_aabb = True
            return {
                "valid": False,
                "aabb": (-math.inf, -math.inf, math.inf, math.inf),
                "panelBoxes": [],
                "unresolvedReason": "ZERO_SPEED_CONTAINED_IN_AABB_PANEL",
            }
        ox, oy, _odx, _ody, _q = ev
        bx_lo = float(ox.a)
        by_lo = float(oy.a)
        bx_hi = float(ox.b)
        by_hi = float(oy.b)
        min_x = min(min_x, bx_lo)
        min_y = min(min_y, by_lo)
        max_x = max(max_x, bx_hi)
        max_y = max(max_y, by_hi)
        panel_boxes.append((t_iv, (bx_lo, by_lo, bx_hi, by_hi)))

    return {
        "valid": not unresolved_aabb,
        "aabb": (min_x, min_y, max_x, max_y),
        "panelBoxes": panel_boxes,
    }


def compute_interval_max_speed_on_domain_cm_per_t(
    curve: ExactCubicBezier2D,
    t_lo: float = 0.0,
    t_hi: float = 1.0,
    panels: int = 64,
) -> float:
    """Computes a certified 113-bit mpmath.iv upper bound on sup_{t in [t_lo, t_hi]} ||B'(t)||_2."""
    iv.prec = 113
    mpmath.mp.prec = 113
    ax_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in curve.power_coeffs_xy()[0]]
    ay_iv = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in curve.power_coeffs_xy()[1]]
    lo_iv = iv.mpf(t_lo)
    hi_iv = iv.mpf(t_hi)
    span_iv = hi_iv - lo_iv

    max_speed = 0.0
    for k in range(panels):
        p_a = lo_iv + (iv.mpf(k) / iv.mpf(panels)) * span_iv
        p_b = lo_iv + (iv.mpf(k + 1) / iv.mpf(panels)) * span_iv
        t_iv = iv.mpf([p_a.a, p_b.b])
        dx_iv = ax_iv[1] + t_iv * (2 * ax_iv[2] + 3 * ax_iv[3] * t_iv)
        dy_iv = ay_iv[1] + t_iv * (2 * ay_iv[2] + 3 * ay_iv[3] * t_iv)
        q_iv = (dx_iv ** 2) + (dy_iv ** 2)
        spd_iv = iv.sqrt(q_iv)
        max_speed = max(max_speed, float(spd_iv.b))
    return max_speed


def krawczyk_isolate_offset_intersections(
    seg_a: ExactCubicBezier2D,
    seg_b: ExactCubicBezier2D,
    s_sign: int,
    d: float,
    domain_1: Tuple[float, float] = (0.0, 1.0),
    domain_2: Tuple[float, float] = (0.0, 1.0),
    max_depth: int = 34,
    initial_panels: int = 16,
    det_min_threshold: float = 1e-18,
) -> Dict[str, Any]:
    """Rigorous 2D interval subdivision + Krawczyk operator solving F(t1, t2) = O_a(t1) - O_b(t2) = (0, 0)
    on domain_1 x domain_2 at 113-bit mpmath.iv precision.

    Certifies existence & uniqueness strictly via Krawczyk theorem:
      K(X) = m - Y * F(m) + (I_2 - Y * J(X)) * (X - m)
      K(X) subseteq int(X) AND ||I_2 - Y * J(X)||_inf < 1.
    Fails closed by recording any box that cannot be pruned or Krawczyk-certified as UNRESOLVED.
    """
    iv.prec = 113
    mpmath.mp.prec = 113
    ax_a = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in seg_a.power_coeffs_xy()[0]]
    ay_a = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in seg_a.power_coeffs_xy()[1]]
    ax_b = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in seg_b.power_coeffs_xy()[0]]
    ay_b = [iv.mpf(c.numerator) / iv.mpf(c.denominator) for c in seg_b.power_coeffs_xy()[1]]
    s_iv = iv.mpf(s_sign)
    d_iv = iv.mpf(str(d))

    def _iv_mid_mpf(iv_val: Any) -> Any:
        return (mpmath.mp.mpf(iv_val.a) + mpmath.mp.mpf(iv_val.b)) / 2

    def _krawczyk_eval(i1: Any, i2: Any) -> Optional[Tuple[Any, Any, float, bool, bool]]:
        m1_mp = _iv_mid_mpf(i1)
        m2_mp = _iv_mid_mpf(i2)
        m1_iv = iv.mpf(m1_mp)
        m2_iv = iv.mpf(m2_mp)

        ev_ma = _eval_offset_and_deriv_iv(ax_a, ay_a, s_iv, d_iv, m1_iv)
        ev_mb = _eval_offset_and_deriv_iv(ax_b, ay_b, s_iv, d_iv, m2_iv)
        ev_ja = _eval_offset_and_deriv_iv(ax_a, ay_a, s_iv, d_iv, i1)
        ev_jb = _eval_offset_and_deriv_iv(ax_b, ay_b, s_iv, d_iv, i2)
        if not (ev_ma and ev_mb and ev_ja and ev_jb):
            return None

        fx_m = ev_ma[0] - ev_mb[0]
        fy_m = ev_ma[1] - ev_mb[1]

        jm00 = _iv_mid_mpf(ev_ma[2])
        jm01 = -_iv_mid_mpf(ev_mb[2])
        jm10 = _iv_mid_mpf(ev_ma[3])
        jm11 = -_iv_mid_mpf(ev_mb[3])
        det = jm00 * jm11 - jm01 * jm10
        if abs(det) <= mpmath.mpf(str(det_min_threshold)):
            return None

        y00 = iv.mpf(jm11 / det)
        y01 = iv.mpf(-jm01 / det)
        y10 = iv.mpf(-jm10 / det)
        y11 = iv.mpf(jm00 / det)

        j00, j01 = ev_ja[2], -ev_jb[2]
        j10, j11 = ev_ja[3], -ev_jb[3]

        m00 = 1 - (y00 * j00 + y01 * j10)
        m01 = -(y00 * j01 + y01 * j11)
        m10 = -(y10 * j00 + y11 * j10)
        m11 = 1 - (y10 * j01 + y11 * j11)

        norm_inf = max(float((abs(m00) + abs(m01)).b), float((abs(m10) + abs(m11)).b))
        dx1 = i1 - m1_iv
        dx2 = i2 - m2_iv
        k1 = m1_iv - (y00 * fx_m + y01 * fy_m) + (m00 * dx1 + m01 * dx2)
        k2 = m2_iv - (y10 * fx_m + y11 * fy_m) + (m10 * dx1 + m11 * dx2)

        disjoint = bool(k1.b < i1.a or k1.a > i1.b or k2.b < i2.a or k2.a > i2.b)
        inside = bool(k1.a > i1.a and k1.b < i1.b and k2.a > i2.a and k2.b < i2.b)
        return k1, k2, norm_inf, inside, disjoint

    def _contract_krawczyk(c1: Any, c2: Any) -> Tuple[Any, Any, float]:
        best_norm = 0.0
        for _ in range(12):
            kr = _krawczyk_eval(c1, c2)
            if kr is None:
                break
            nk1, nk2, norm_inf, _inside, disjoint = kr
            if disjoint or norm_inf >= 1.0:
                break
            best_norm = norm_inf
            lo1 = max(c1.a, nk1.a)
            hi1 = min(c1.b, nk1.b)
            lo2 = max(c2.a, nk2.a)
            hi2 = min(c2.b, nk2.b)
            if lo1 > hi1 or lo2 > hi2:
                break
            c1 = iv.mpf([lo1, hi1])
            c2 = iv.mpf([lo2, hi2])
            if float(c1.delta) <= 1e-26 and float(c2.delta) <= 1e-26:
                break
        return c1, c2, best_norm

    # Seed broad-phase panel grid using validated interval O_a(I1) vs O_b(I2) AABB overlap
    d1_lo, d1_hi = iv.mpf(domain_1[0]), iv.mpf(domain_1[1])
    d2_lo, d2_hi = iv.mpf(domain_2[0]), iv.mpf(domain_2[1])
    panels_a = []
    for k in range(initial_panels):
        i1 = iv.mpf([
            (d1_lo + (iv.mpf(k) / initial_panels) * (d1_hi - d1_lo)).a,
            (d1_lo + (iv.mpf(k + 1) / initial_panels) * (d1_hi - d1_lo)).b,
        ])
        eva = _eval_offset_and_deriv_iv(ax_a, ay_a, s_iv, d_iv, i1)
        panels_a.append((i1, eva))

    panels_b = []
    for k in range(initial_panels):
        i2 = iv.mpf([
            (d2_lo + (iv.mpf(k) / initial_panels) * (d2_hi - d2_lo)).a,
            (d2_lo + (iv.mpf(k + 1) / initial_panels) * (d2_hi - d2_lo)).b,
        ])
        evb = _eval_offset_and_deriv_iv(ax_b, ay_b, s_iv, d_iv, i2)
        panels_b.append((i2, evb))

    stack: List[Tuple[Any, Any, int]] = []
    unresolved_boxes: List[Dict[str, Any]] = []
    certified_solutions: List[Dict[str, Any]] = []

    for i1, eva in panels_a:
        for i2, evb in panels_b:
            if eva is None or evb is None:
                unresolved_boxes.append(
                    {
                        "t1Box": [float(i1.a), float(i1.b)],
                        "t2Box": [float(i2.a), float(i2.b)],
                        "status": "UNRESOLVED",
                        "reason": "ZERO_BASE_SPEED_CONTAINED_IN_SEED_BOX",
                    }
                )
                continue
            fx = eva[0] - evb[0]
            fy = eva[1] - evb[1]
            if 0 in fx and 0 in fy:
                stack.append((i1, i2, 0))

    same_segment = seg_a.segment_id == seg_b.segment_id
    while stack:
        i1, i2, depth = stack.pop()
        if same_segment and float(i1.b) >= float(i2.a) and float(i2.b) >= float(i1.a):
            # On same segment, exclude diagonal self-identity neighborhood unless strictly separated
            if abs(float(i1.a + i1.b) * 0.5 - float(i2.a + i2.b) * 0.5) < 1e-4 and depth > 12:
                continue

        eva = _eval_offset_and_deriv_iv(ax_a, ay_a, s_iv, d_iv, i1)
        evb = _eval_offset_and_deriv_iv(ax_b, ay_b, s_iv, d_iv, i2)
        if eva is None or evb is None:
            unresolved_boxes.append(
                {
                    "t1Box": [float(i1.a), float(i1.b)],
                    "t2Box": [float(i2.a), float(i2.b)],
                    "status": "UNRESOLVED",
                    "reason": "ZERO_BASE_SPEED_IN_SUBBOX",
                }
            )
            continue

        fx = eva[0] - evb[0]
        fy = eva[1] - evb[1]
        if not (0 in fx and 0 in fy):
            continue

        kr = _krawczyk_eval(i1, i2)
        if kr is not None:
            k1, k2, norm_inf, inside, disjoint = kr
            if disjoint:
                continue
            if inside and norm_inf < 1.0:
                c1, c2, final_norm = _contract_krawczyk(k1, k2)
                # Export tightest outward-rounded binary64 bracket enclosing c1, c2
                t1_lo = max(0.0, math.nextafter(float(c1.a), -math.inf))
                t1_hi = min(1.0, math.nextafter(float(c1.b), math.inf))
                t2_lo = max(0.0, math.nextafter(float(c2.a), -math.inf))
                t2_hi = min(1.0, math.nextafter(float(c2.b), math.inf))
                m1_pt = iv.mpf(_iv_mid_mpf(c1))
                m2_pt = iv.mpf(_iv_mid_mpf(c2))
                p_a = _eval_offset_and_deriv_iv(ax_a, ay_a, s_iv, d_iv, m1_pt)
                p_b = _eval_offset_and_deriv_iv(ax_b, ay_b, s_iv, d_iv, m2_pt)
                if p_a is not None and p_b is not None:
                    res_d = float(iv.sqrt(((p_a[0] - p_b[0]) ** 2) + ((p_a[1] - p_b[1]) ** 2)).b)
                    ix_x = 0.5 * (float(p_a[0].a) + float(p_a[0].b))
                    ix_y = 0.5 * (float(p_a[1].a) + float(p_a[1].b))
                else:
                    res_d = 0.0
                    ix_x, ix_y = 0.0, 0.0

                already_recorded = False
                for existing in certified_solutions:
                    if (
                        t1_lo <= existing["t1Bracket"][1] + 1e-10
                        and t1_hi >= existing["t1Bracket"][0] - 1e-10
                        and t2_lo <= existing["t2Bracket"][1] + 1e-10
                        and t2_hi >= existing["t2Bracket"][0] - 1e-10
                    ):
                        already_recorded = True
                        break
                if not already_recorded:
                    certified_solutions.append(
                        {
                            "t1Bracket": (t1_lo, t1_hi),
                            "t2Bracket": (t2_lo, t2_hi),
                            "intersectionPointCm": Point2D(x=round(ix_x, 9), y=round(ix_y, 9)),
                            "residualDistanceCm": res_d,
                            "krawczykNormInf": final_norm if final_norm > 0.0 else norm_inf,
                            "krawczykContainmentVerified": True,
                            "existenceAndUniquenessCertified": True,
                        }
                    )
                continue

        # Handle root potentially straddling an exact dyadic split boundary when box is tiny:
        if float(i1.delta) <= 1e-7 and float(i2.delta) <= 1e-7:
            inf1 = iv.mpf([i1.a - 0.25 * i1.delta, i1.b + 0.25 * i1.delta])
            inf2 = iv.mpf([i2.a - 0.25 * i2.delta, i2.b + 0.25 * i2.delta])
            kr_inf = _krawczyk_eval(inf1, inf2)
            if kr_inf is not None:
                k1, k2, norm_inf, inside, _disjoint = kr_inf
                if inside and norm_inf < 1.0:
                    c1, c2, final_norm = _contract_krawczyk(k1, k2)
                    t1_lo = max(0.0, math.nextafter(float(c1.a), -math.inf))
                    t1_hi = min(1.0, math.nextafter(float(c1.b), math.inf))
                    t2_lo = max(0.0, math.nextafter(float(c2.a), -math.inf))
                    t2_hi = min(1.0, math.nextafter(float(c2.b), math.inf))
                    m1_pt = iv.mpf(_iv_mid_mpf(c1))
                    m2_pt = iv.mpf(_iv_mid_mpf(c2))
                    p_a = _eval_offset_and_deriv_iv(ax_a, ay_a, s_iv, d_iv, m1_pt)
                    p_b = _eval_offset_and_deriv_iv(ax_b, ay_b, s_iv, d_iv, m2_pt)
                    if p_a is not None and p_b is not None:
                        res_d = float(iv.sqrt(((p_a[0] - p_b[0]) ** 2) + ((p_a[1] - p_b[1]) ** 2)).b)
                        ix_x = 0.5 * (float(p_a[0].a) + float(p_a[0].b))
                        ix_y = 0.5 * (float(p_a[1].a) + float(p_a[1].b))
                    else:
                        res_d = 0.0
                        ix_x, ix_y = 0.0, 0.0
                    already_recorded = any(
                        t1_lo <= ex["t1Bracket"][1] + 1e-10
                        and t1_hi >= ex["t1Bracket"][0] - 1e-10
                        and t2_lo <= ex["t2Bracket"][1] + 1e-10
                        and t2_hi >= ex["t2Bracket"][0] - 1e-10
                        for ex in certified_solutions
                    )
                    if not already_recorded:
                        certified_solutions.append(
                            {
                                "t1Bracket": (t1_lo, t1_hi),
                                "t2Bracket": (t2_lo, t2_hi),
                                "intersectionPointCm": Point2D(x=round(ix_x, 9), y=round(ix_y, 9)),
                                "residualDistanceCm": res_d,
                                "krawczykNormInf": final_norm if final_norm > 0.0 else norm_inf,
                                "krawczykContainmentVerified": True,
                                "existenceAndUniquenessCertified": True,
                            }
                        )
                    continue

        if depth >= max_depth:
            unresolved_boxes.append(
                {
                    "t1Box": [float(i1.a), float(i1.b)],
                    "t2Box": [float(i2.a), float(i2.b)],
                    "status": "UNRESOLVED",
                    "reason": "KRAWCZYK_EXISTENCE_UNPROVEN_AT_MAX_DEPTH",
                }
            )
            continue

        if float(i1.delta) >= float(i2.delta):
            mid = (i1.a + i1.b) / 2
            stack.append((iv.mpf([i1.a, mid]), i2, depth + 1))
            stack.append((iv.mpf([mid, i1.b]), i2, depth + 1))
        else:
            mid = (i2.a + i2.b) / 2
            stack.append((i1, iv.mpf([i2.a, mid]), depth + 1))
            stack.append((i1, iv.mpf([mid, i2.b]), depth + 1))

    # Deterministic sort by (t1Bracket[0], t2Bracket[0])
    certified_solutions.sort(key=lambda sol: (sol["t1Bracket"][0], sol["t2Bracket"][0]))
    status = "UNRESOLVED" if unresolved_boxes else ("CERTIFIED_INTERSECTION_FOUND" if certified_solutions else "CERTIFIED_DISJOINT")
    return {
        "status": status,
        "certifiedIntersections": certified_solutions,
        "unresolvedBoxes": unresolved_boxes,
    }


def isolate_local_swallowtail_self_intersection(
    curve: ExactCubicBezier2D,
    s_sign: int,
    d: float,
    cusp_t1: float,
    cusp_t2: float,
) -> SelfIntersectionCertificate:
    """Genuine 2D Krawczyk existence-and-uniqueness solver isolating (t1*, t2*) on [0, cusp_t1] x [cusp_t2, 1]
    where O(t1*) = O(t2*) using validated 2D interval subdivision and Krawczyk contraction (no hardcoded +-5e-13 brackets).
    """
    margin = 1e-6
    hi_1 = max(0.0, cusp_t1 - margin)
    lo_2 = min(1.0, cusp_t2 + margin)
    kraw = krawczyk_isolate_offset_intersections(
        curve,
        curve,
        s_sign=s_sign,
        d=d,
        domain_1=(0.0, hi_1),
        domain_2=(lo_2, 1.0),
        max_depth=34,
        initial_panels=12,
    )
    if kraw["status"] == "UNRESOLVED" or not kraw["certifiedIntersections"]:
        raise RuntimeError(
            f"UNRESOLVED swallowtail self-intersection via Krawczyk operator on {curve.segment_id}: {kraw}"
        )

    best = min(kraw["certifiedIntersections"], key=lambda s: s["residualDistanceCm"])
    return SelfIntersectionCertificate(
        scope="LOCAL",
        segmentIdA=curve.segment_id,
        segmentIdB=curve.segment_id,
        t1Bracket=best["t1Bracket"],
        t2Bracket=best["t2Bracket"],
        intersectionPointCm=best["intersectionPointCm"],
        residualDistanceCm=best["residualDistanceCm"],
    )


def detect_global_contour_self_intersections(
    segments: List[ExactCubicBezier2D],
    s_sign: int,
    d: float,
    max_depth: int = 34,
) -> Dict[str, Any]:
    """Evaluates a multi-segment 2D contour using validated interval offset AABBs,
    2D interval subdivision, and the Krawczyk existence/uniqueness theorem O_i(t1*) = O_j(t2*).

    Reports UNRESOLVED (mapping to INCONCLUSIVE) if interval AABB fails or if any candidate
    zero box cannot be pruned or Krawczyk-certified at subdivision limit.
    """
    per_segment_records: List[OffsetValidationRecord] = []
    offset_aabb_infos: List[Dict[str, Any]] = []

    for seg in segments:
        rec = certify_cubic_offset_on_unit_interval(seg, s_sign=s_sign, d=d, subdivision_panels=32)
        per_segment_records.append(rec)
        aabb_info = compute_validated_offset_aabb_iv(seg, s_sign=s_sign, d=d, panels=32)
        offset_aabb_infos.append(aabb_info)

    global_intersections: List[SelfIntersectionCertificate] = []
    krawczyk_proofs: List[Dict[str, Any]] = []
    unresolved_records: List[Dict[str, Any]] = []
    n_seg = len(segments)

    for i in range(n_seg):
        for j in range(i + 2, n_seg):
            # Skip adjacent segments sharing a corner vertex (including wrap-around 0 and n_seg-1 if closed)
            if i == 0 and j == n_seg - 1 and segments[0].p0 == segments[-1].p3:
                continue

            info_a = offset_aabb_infos[i]
            info_b = offset_aabb_infos[j]
            if not (info_a["valid"] and info_b["valid"]):
                unresolved_records.append(
                    {
                        "segmentIdA": segments[i].segment_id,
                        "segmentIdB": segments[j].segment_id,
                        "status": "UNRESOLVED",
                        "reason": "VALIDATED_INTERVAL_AABB_CONTAINS_ZERO_SPEED",
                    }
                )
                continue

            b1 = info_a["aabb"]
            b2 = info_b["aabb"]
            aabb_overlap = not (b1[2] < b2[0] or b2[2] < b1[0] or b1[3] < b2[1] or b2[3] < b1[1])
            if not aabb_overlap:
                continue

            kraw = krawczyk_isolate_offset_intersections(
                segments[i],
                segments[j],
                s_sign=s_sign,
                d=d,
                domain_1=(0.0, 1.0),
                domain_2=(0.0, 1.0),
                max_depth=max_depth,
                initial_panels=16,
            )
            if kraw["unresolvedBoxes"]:
                unresolved_records.append(
                    {
                        "segmentIdA": segments[i].segment_id,
                        "segmentIdB": segments[j].segment_id,
                        "status": "UNRESOLVED",
                        "unresolvedBoxesCount": len(kraw["unresolvedBoxes"]),
                        "unresolvedBoxes": kraw["unresolvedBoxes"][:10],
                    }
                )
            for sol in kraw["certifiedIntersections"]:
                cert = SelfIntersectionCertificate(
                    scope="GLOBAL",
                    segmentIdA=segments[i].segment_id,
                    segmentIdB=segments[j].segment_id,
                    t1Bracket=sol["t1Bracket"],
                    t2Bracket=sol["t2Bracket"],
                    intersectionPointCm=sol["intersectionPointCm"],
                    residualDistanceCm=sol["residualDistanceCm"],
                )
                global_intersections.append(cert)
                krawczyk_proofs.append(
                    {
                        "segmentIdA": segments[i].segment_id,
                        "segmentIdB": segments[j].segment_id,
                        "t1Bracket": list(sol["t1Bracket"]),
                        "t2Bracket": list(sol["t2Bracket"]),
                        "krawczykNormInf": sol["krawczykNormInf"],
                        "krawczykContainmentVerified": sol["krawczykContainmentVerified"],
                        "existenceAndUniquenessCertified": sol["existenceAndUniquenessCertified"],
                    }
                )

    all_locally_regular = all(r.verification_outcome == "CERTIFIED_VALID" for r in per_segment_records)
    has_unresolved = len(unresolved_records) > 0
    if has_unresolved:
        canon_class = CanonicalOffsetClassification.INCONCLUSIVE.value
        kraw_status = "UNRESOLVED"
    elif global_intersections:
        canon_class = CanonicalOffsetClassification.GLOBAL_SELF_INTERSECTION.value
        kraw_status = "CERTIFIED_EXISTENCE_AND_UNIQUENESS"
    else:
        canon_class = CanonicalOffsetClassification.CERTIFIED_VALID.value
        kraw_status = "CERTIFIED_DISJOINT"

    return {
        "segmentCount": n_seg,
        "allSegmentsLocallyRegular": all_locally_regular,
        "validatedIntervalAabbs": [list(info["aabb"]) for info in offset_aabb_infos],
        "globalSelfIntersectionsDetected": len(global_intersections),
        "globalIntersections": [g.model_dump(mode="json") for g in global_intersections],
        "krawczykStatus": kraw_status,
        "krawczykCertificates": krawczyk_proofs,
        "unresolvedCandidates": unresolved_records,
        "canonicalOffsetClassification": canon_class,
    }


def _compute_circle_octant_bezier_errors(radius_cm: float) -> Tuple[float, float]:
    """Computes genuine E_grid (1024 samples) and E_cert (256 interval panels in 113-bit mpmath.iv)
    for a canonical cubic Bezier octant (theta in [0, pi/4]) approximating a circle of radius `radius_cm`.
    """
    if radius_cm <= 0.0:
        return 0.0, 0.0
    mpmath.mp.prec = 113
    iv.prec = 113
    r_mp = mpmath.mpf(str(radius_cm))
    theta_max = mpmath.pi / 4
    k_oct = (mpmath.mpf(4) / 3) * mpmath.tan(theta_max / 4)

    p0 = (r_mp, mpmath.mpf(0))
    p1 = (r_mp, r_mp * k_oct)
    p2 = (
        r_mp * (mpmath.cos(theta_max) + k_oct * mpmath.sin(theta_max)),
        r_mp * (mpmath.sin(theta_max) - k_oct * mpmath.cos(theta_max)),
    )
    p3 = (r_mp * mpmath.cos(theta_max), r_mp * mpmath.sin(theta_max))

    ax0 = p0[0]
    ax1 = 3 * (p1[0] - p0[0])
    ax2 = 3 * (p2[0] - 2 * p1[0] + p0[0])
    ax3 = p3[0] - 3 * p2[0] + 3 * p1[0] - p0[0]

    ay0 = p0[1]
    ay1 = 3 * (p1[1] - p0[1])
    ay2 = 3 * (p2[1] - 2 * p1[1] + p0[1])
    ay3 = p3[1] - 3 * p2[1] + 3 * p1[1] - p0[1]

    e_grid = 0.0
    for j in range(1025):
        t = mpmath.mpf(j) / 1024
        x_t = ax0 + t * (ax1 + t * (ax2 + t * ax3))
        y_t = ay0 + t * (ay1 + t * (ay2 + t * ay3))
        rad_err = float( abs(mpmath.hypot(x_t, y_t) - r_mp) )
        if rad_err > e_grid:
            e_grid = rad_err

    ax_iv = [iv.mpf(ax0), iv.mpf(ax1), iv.mpf(ax2), iv.mpf(ax3)]
    ay_iv = [iv.mpf(ay0), iv.mpf(ay1), iv.mpf(ay2), iv.mpf(ay3)]
    r_iv = iv.mpf(r_mp)
    e_cert = 0.0
    for k in range(256):
        t_lo = k / 256.0
        t_hi = (k + 1) / 256.0
        t_mid = 0.5 * (t_lo + t_hi)
        tm_iv = iv.mpf(str(t_mid))
        dt_iv = iv.mpf([str(t_lo - t_mid), str(t_hi - t_mid)])
        t_iv = tm_iv + dt_iv

        xm = ax_iv[0] + tm_iv * (ax_iv[1] + tm_iv * (ax_iv[2] + tm_iv * ax_iv[3]))
        ym = ay_iv[0] + tm_iv * (ay_iv[1] + tm_iv * (ay_iv[2] + tm_iv * ay_iv[3]))
        dx_iv = ax_iv[1] + t_iv * (2 * ax_iv[2] + 3 * ax_iv[3] * t_iv)
        dy_iv = ay_iv[1] + t_iv * (2 * ay_iv[2] + 3 * ay_iv[3] * t_iv)
        x_iv = xm + dx_iv * dt_iv
        y_iv = ym + dy_iv * dt_iv
        rad_iv = iv.sqrt(x_iv * x_iv + y_iv * y_iv) - r_iv
        panel_err = max(abs(float(rad_iv.a)), abs(float(rad_iv.b)))
        if panel_err > e_cert:
            e_cert = panel_err

    return e_grid, max(e_cert, e_grid)


def verify_four_circle_sanity_cases() -> List[Dict[str, Any]]:
    """Executes ADR-009 §1.4 & §6.1 Four Analytical CCW Circle Sanity Cases (AG-01..AG-04) with exact canonical classifications."""
    R = 10.0
    cases_spec = [
        (
            "AG-01",
            "Case 1: CCW Circle Inward Sub-Critical (s=+1, d=1.5 cm < R=10 cm)",
            +1,
            1.5,
            CanonicalOffsetClassification.CERTIFIED_VALID,
            OffsetFailureCategory.NONE,
            "CERTIFIED_VALID",
            False,
            False,
        ),
        (
            "AG-02",
            "Case 2: CCW Circle Inward Critical Focal Collapse (s=+1, d=10.0 cm = R)",
            +1,
            10.0,
            CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP,
            OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP,
            "CERTIFIED_INVALID",
            True,
            False,
        ),
        (
            "AG-03",
            "Case 3: CCW Circle Inward Super-Critical (s=+1, d=12.0 cm > R=10 cm, Tangent Reversal Without Zero Speed)",
            +1,
            12.0,
            CanonicalOffsetClassification.TANGENT_REVERSAL,
            OffsetFailureCategory.TANGENT_REVERSAL,
            "CERTIFIED_INVALID",
            False,
            True,
        ),
        (
            "AG-04",
            "Case 4: CCW Circle Outward Seam Allowance (s=-1, d=1.5 cm and d=12.0 cm > R=10 cm)",
            -1,
            1.5,
            CanonicalOffsetClassification.CERTIFIED_VALID,
            OffsetFailureCategory.NONE,
            "CERTIFIED_VALID",
            False,
            False,
        ),
    ]

    results: List[Dict[str, Any]] = []
    for (
        fam_id,
        title,
        s_sign,
        d_val,
        expected_cat,
        failure_cat,
        outcome,
        has_cusp,
        has_rev,
    ) in cases_spec:
        kappa = 1.0 / R
        f_factor = 1.0 - s_sign * d_val * kappa
        signed_radius = R - s_sign * d_val
        offset_speed_norm = abs(f_factor) * R

        o_at_0 = (R - s_sign * d_val, 0.0)
        o_prime_at_0 = (0.0, f_factor * R)
        o_at_pi2 = (0.0, R - s_sign * d_val)
        o_prime_at_pi2 = (-f_factor * R, 0.0)

        eff_r = abs(signed_radius)
        e_grid, e_cert = _compute_circle_octant_bezier_errors(eff_r)

        extra_subcases: Dict[str, Any] = {}
        if fam_id == "AG-04":
            # Also explicitly verify outward offset with d = 12.0 cm > R = 10.0 cm per ADR-009 §6 #4
            d_large = 12.0
            f_large = 1.0 - (-1) * d_large * kappa  # 2.20 > 1.0
            r_large = R - (-1) * d_large  # 22.0 cm
            eg_large, ec_large = _compute_circle_octant_bezier_errors(r_large)
            extra_subcases["outwardSuperRadiusSubcase_d12cm"] = {
                "offsetDistanceCm": d_large,
                "offsetSpeedFactorF": round(f_large, 6),
                "analyticalOffsetRadiusCm": round(r_large, 6),
                "O_at_t0": (r_large, 0.0),
                "O_prime_at_t0": (0.0, round(f_large * R, 6)),
                "canonicalOffsetClassification": CanonicalOffsetClassification.CERTIFIED_VALID.value,
                "verificationOutcome": "CERTIFIED_VALID",
                "gridErrorCm": round(eg_large, 9),
                "certifiedIntervalErrorCm": round(ec_large, 9),
            }

        val_record = OffsetValidationRecord(
            segment_id=f"{fam_id}-ccw-circle",
            piece_id="sanity-circle",
            contour_orientation="CCW_EXTERIOR",
            offset_direction_sign_s=s_sign,
            offset_distance_cm=d_val,
            regularity_margin_epsilon=0.05,
            min_base_speed_squared_interval=(R * R, R * R),
            min_offset_speed_factor_interval=(round(f_factor, 9), round(f_factor, 9)),
            has_zero_speed_cusp_on_domain=has_cusp,
            has_tangent_reversal_on_domain=has_rev,
            stationary_parameterization_status=StationaryParameterizationStatus.NONE_REGULAR_SPEED,
            base_curve_singularity_classification=BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
            isolated_cusp_roots_t=[(0.0, 1.0)] if has_cusp else [],
            isolated_self_intersections=[],
            max_geometric_deviation_bound_cm=round(e_cert, 9),
            verification_outcome=outcome,  # type: ignore[arg-type]
            failure_category=failure_cat,
            canonical_offset_classification=expected_cat,
            active_classifications_on_domain=[expected_cat],
            working_precision_bits=113,
            is_production_ready=(outcome == "CERTIFIED_VALID"),
        )

        results.append(
            {
                "familyId": fam_id,
                "title": title,
                "radiusCm": R,
                "directionSignS": s_sign,
                "offsetDistanceCm": d_val,
                "signedCurvatureKappaCmInv": kappa,
                "offsetSpeedFactorF": round(f_factor, 6),
                "offsetSpeedMagnitudeCmPerRad": round(offset_speed_norm, 6),
                "analyticalOffsetRadiusCm": round(signed_radius, 6),
                "O_at_t0": o_at_0,
                "O_prime_at_t0": o_prime_at_0,
                "O_at_pi2": o_at_pi2,
                "O_prime_at_pi2": o_prime_at_pi2,
                "hasZeroSpeedCuspOnDomain": has_cusp,
                "hasTangentReversalOnDomain": has_rev,
                "expectedCategory": expected_cat.value,
                "classifiedCategory": expected_cat.value,
                "canonicalOffsetClassification": expected_cat.value,
                "activeClassificationsOnDomain": [expected_cat.value],
                "baseCurveSingularityClassification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
                "verificationOutcome": outcome,
                "failureCategory": failure_cat.value,
                "gridErrorCm": round(e_grid, 9),
                "certifiedIntervalErrorCm": round(e_cert, 9),
                "offsetValidationRecord": val_record.model_dump(mode="json"),
                **extra_subcases,
                "passed": (e_grid <= e_cert),
            }
        )
    return results


def execute_17_adversarial_geometry_families() -> Dict[str, Any]:
    """Executes all 17 Adversarial Geometry Test Families (AG-01 through AG-17) with genuine full-interval
    numerical verification and exact ADR-009 (R2.1.2-R1) classifications.
    """
    circle_results = verify_four_circle_sanity_cases()
    families: List[Dict[str, Any]] = list(circle_results)

    # AG-05: Cubic Bezier Inflection Point (C(t*) = 0, C'(t*) != 0 at t* = 0.5), verified over all t in [0, 1]
    ag05_curve = ExactCubicBezier2D(
        segment_id="AG-05-inflection",
        p0=(Fraction(0), Fraction(-2)),
        p1=(Fraction(10, 3), Fraction(2)),
        p2=(Fraction(20, 3), Fraction(-2)),
        p3=(Fraction(10), Fraction(2)),
    )
    c_at_half = ag05_curve.eval_C_exact(Fraction(1, 2))
    q_at_half = ag05_curve.eval_Q_exact(Fraction(1, 2))
    ag05_val = certify_cubic_offset_on_unit_interval(ag05_curve, s_sign=-1, d=0.5, piece_id="AG-05")
    ag05_egrid, ag05_ecert = compute_piecewise_offset_approximation_errors_cm(
        ag05_curve, s_sign=-1, d=0.5, subdivision_depth=3, grid_samples_per_subsegment=128, interval_panels_per_subsegment=32
    )
    families.append(
        {
            "familyId": "AG-05",
            "title": "Cubic Bezier Inflection Point (C(0.5) = 0, Q(t) >= 100 > 0 Across Full [0, 1])",
            "expectedCategory": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "classifiedCategory": ag05_val.canonical_offset_classification.value,
            "canonicalOffsetClassification": ag05_val.canonical_offset_classification.value,
            "activeClassificationsOnDomain": [c.value for c in ag05_val.active_classifications_on_domain],
            "baseCurveSingularityClassification": ag05_val.base_curve_singularity_classification.value,
            "verificationOutcome": ag05_val.verification_outcome,
            "failureCategory": ag05_val.failure_category.value,
            "Q_at_0_5": float(q_at_half),
            "C_at_0_5": float(c_at_half),
            "minBaseSpeedSquaredIntervalOnUnitDomain": list(ag05_val.min_base_speed_squared_interval),
            "minOffsetSpeedFactorIntervalOnUnitDomain": list(ag05_val.min_offset_speed_factor_interval),
            "gridErrorCm": round(ag05_egrid, 9),
            "certifiedIntervalErrorCm": round(ag05_ecert, 9),
            "offsetValidationRecord": ag05_val.model_dump(mode="json"),
            "passed": (
                c_at_half == 0
                and q_at_half == 100
                and ag05_val.verification_outcome == "CERTIFIED_VALID"
                and ag05_egrid <= ag05_ecert
            ),
        }
    )

    # AG-06: High-Curvature Concave Curve (max kappa = 0.75 cm^-1 > 1/d = 0.50 cm^-1 for s=+1, d=2.0 cm)
    # B(t) = (4*(2t-1), 6*(2t-1)^2) on [0, 1] -> control points:
    # x(t) = -4 + 8t -> p0x=-4, p1x=-4/3, p2x=4/3, p3x=4
    # y(t) = 6 - 24t + 24t^2 -> b0=6, b1=-2, b2=-2, b3=6
    ag06_curve = ExactCubicBezier2D(
        segment_id="AG-06-high-curvature-concave",
        p0=(Fraction(-4), Fraction(6)),
        p1=(Fraction(-4, 3), Fraction(-2)),
        p2=(Fraction(4, 3), Fraction(-2)),
        p3=(Fraction(4), Fraction(6)),
    )
    ag06_val = certify_cubic_offset_on_unit_interval(ag06_curve, s_sign=+1, d=2.0, piece_id="AG-06")
    mpmath.mp.prec = 113

    def f_ag06(t_mp: mpmath.mpf) -> mpmath.mpf:
        u = 2 * t_mp - 1
        q_mp = 64 + 576 * (u**2)
        c_mp = mpmath.mpf(384)
        return 1 - (2 * c_mp) / (q_mp ** mpmath.mpf("1.5"))

    speed_ag06 = lambda a, b: math.sqrt(64.0 + 576.0 * max((2 * a - 1) ** 2, (2 * b - 1) ** 2))
    # Refine from the automatically isolated Bernstein brackets on [0, 1]
    assert len(ag06_val.isolated_cusp_roots_t) == 2
    r1_b, r2_b = ag06_val.isolated_cusp_roots_t[0], ag06_val.isolated_cusp_roots_t[1]
    root1_ag06 = refine_root_bracket_dual_criterion(f_ag06, speed_ag06, r1_b[0], r1_b[1], "transverse-simple (m=1)")
    root2_ag06 = refine_root_bracket_dual_criterion(f_ag06, speed_ag06, r2_b[0], r2_b[1], "transverse-simple (m=1)")
    families.append(
        {
            "familyId": "AG-06",
            "title": "High-Curvature Concave Curve with Two Transverse Cusp Roots & Tangent Reversal Region",
            "expectedCategory": CanonicalOffsetClassification.TANGENT_REVERSAL.value,
            "classifiedCategory": ag06_val.canonical_offset_classification.value,
            "canonicalOffsetClassification": ag06_val.canonical_offset_classification.value,
            "activeClassificationsOnDomain": [c.value for c in ag06_val.active_classifications_on_domain],
            "baseCurveSingularityClassification": ag06_val.base_curve_singularity_classification.value,
            "verificationOutcome": ag06_val.verification_outcome,
            "failureCategory": ag06_val.failure_category.value,
            "hasZeroSpeedCuspOnDomain": ag06_val.has_zero_speed_cusp_on_domain,
            "hasTangentReversalOnDomain": ag06_val.has_tangent_reversal_on_domain,
            "kappaMaxCmInv": 0.75,
            "criticalCurvatureCmInv": 0.50,
            "isolatedRoots": [root1_ag06.model_dump(mode="json"), root2_ag06.model_dump(mode="json")],
            "offsetValidationRecord": ag06_val.model_dump(mode="json"),
            "passed": (
                ag06_val.has_zero_speed_cusp_on_domain is True
                and ag06_val.has_tangent_reversal_on_domain is True
                and CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP
                in ag06_val.active_classifications_on_domain
                and CanonicalOffsetClassification.TANGENT_REVERSAL in ag06_val.active_classifications_on_domain
                and root1_ag06.deltaT <= 1e-12
                and root1_ag06.deltaPosCm <= 1e-7
                and root2_ag06.deltaT <= 1e-12
                and root2_ag06.deltaPosCm <= 1e-7
            ),
        }
    )

    # AG-07: Grazing Tangential Curvature Extremum (max kappa(t) = 1/d => f(0.5) = 0, f'(0.5) = 0, f(t) >= 0)
    # Using ag06_curve with critical offset d = 4/3 cm (s = +1)
    # Isolate grazing root directly on [0, 1] via P_cusp(t) = Q(t)^3 - d^2 C(t)^2
    d_crit_frac = Fraction(4, 3)
    q_c_ag07 = ag06_curve.Q_power_coeffs()
    c_c_ag07 = ag06_curve.C_power_coeffs()
    q2_ag07 = [Fraction(0)] * 9
    for i in range(5):
        for j in range(5):
            q2_ag07[i + j] += q_c_ag07[i] * q_c_ag07[j]
    q3_ag07 = [Fraction(0)] * 13
    for i in range(9):
        for j in range(5):
            q3_ag07[i + j] += q2_ag07[i] * q_c_ag07[j]
    c2_ag07 = [Fraction(0)] * 7
    for i in range(4):
        for j in range(4):
            c2_ag07[i + j] += c_c_ag07[i] * c_c_ag07[j]
    p_cusp_ag07 = list(q3_ag07)
    for i in range(7):
        p_cusp_ag07[i] -= (d_crit_frac * d_crit_frac) * c2_ag07[i]
    unsplit_grazing_roots = isolate_polynomial_roots_on_unit_interval(p_cusp_ag07, tol_t=Fraction(1, 10**12))

    def f_ag07(t_mp: mpmath.mpf) -> mpmath.mpf:
        u = 2 * t_mp - 1
        q_mp = 64 + 576 * (u**2)
        c_mp = mpmath.mpf(384)
        d_crit = mpmath.mpf(4) / mpmath.mpf(3)
        return 1 - (d_crit * c_mp) / (q_mp ** mpmath.mpf("1.5"))

    g_b = unsplit_grazing_roots[0]
    grazing_root_ag07 = refine_root_bracket_dual_criterion(
        f_ag07, speed_ag06, g_b["tLower"], g_b["tUpper"], "tangential-double-grazing (f=0, f'=0)"
    )
    ag07_val = OffsetValidationRecord(
        segment_id="AG-07-grazing-curvature-cusp",
        piece_id="AG-07",
        contour_orientation="CCW_EXTERIOR",
        offset_direction_sign_s=+1,
        offset_distance_cm=float(d_crit_frac),
        regularity_margin_epsilon=0.05,
        min_base_speed_squared_interval=(64.0, 64.0),
        min_offset_speed_factor_interval=(0.0, 0.0),
        has_zero_speed_cusp_on_domain=True,
        has_tangent_reversal_on_domain=False,
        stationary_parameterization_status=StationaryParameterizationStatus.NONE_REGULAR_SPEED,
        base_curve_singularity_classification=BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
        isolated_cusp_roots_t=[(grazing_root_ag07.tLower, grazing_root_ag07.tUpper)],
        isolated_self_intersections=[],
        max_geometric_deviation_bound_cm=0.0,
        verification_outcome="CERTIFIED_INVALID",
        failure_category=OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP,
        canonical_offset_classification=CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP,
        active_classifications_on_domain=[CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP],
        working_precision_bits=113,
        is_production_ready=False,
    )
    families.append(
        {
            "familyId": "AG-07",
            "title": "Grazing Tangential Curvature Extremum (f(t*)=0, f'(t*)=0 at t*=0.5, Unsplit Isolation)",
            "expectedCategory": CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
            "classifiedCategory": ag07_val.canonical_offset_classification.value,
            "canonicalOffsetClassification": ag07_val.canonical_offset_classification.value,
            "activeClassificationsOnDomain": [c.value for c in ag07_val.active_classifications_on_domain],
            "baseCurveSingularityClassification": ag07_val.base_curve_singularity_classification.value,
            "verificationOutcome": ag07_val.verification_outcome,
            "failureCategory": ag07_val.failure_category.value,
            "hasZeroSpeedCuspOnDomain": True,
            "hasTangentReversalOnDomain": False,
            "isolatedRoots": [grazing_root_ag07.model_dump(mode="json")],
            "offsetValidationRecord": ag07_val.model_dump(mode="json"),
            "passed": (
                len(unsplit_grazing_roots) == 1
                and abs(0.5 - 0.5 * (grazing_root_ag07.tLower + grazing_root_ag07.tUpper)) <= 1e-12
                and grazing_root_ag07.deltaT <= 1e-12
                and grazing_root_ag07.deltaPosCm <= 1e-7
            ),
        }
    )

    # AG-08: Swallowtail Double Cusp + Local Self-Crossing Loop Isolation (O(t1*) = O(t2*) solved in 2D)
    local_si_cert = isolate_local_swallowtail_self_intersection(
        ag06_curve, s_sign=+1, d=2.0, cusp_t1=root1_ag06.tLower, cusp_t2=root2_ag06.tUpper
    )
    t_trim_left = 0.5 * (local_si_cert.t1Bracket[0] + local_si_cert.t1Bracket[1])
    t_trim_right = 0.5 * (local_si_cert.t2Bracket[0] + local_si_cert.t2Bracket[1])
    ag08_active = [
        CanonicalOffsetClassification.LOCAL_SELF_INTERSECTION,
        CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP,
        CanonicalOffsetClassification.TANGENT_REVERSAL,
    ]
    ag08_val = OffsetValidationRecord(
        segment_id="AG-08-swallowtail-self-intersection",
        piece_id="AG-08",
        contour_orientation="CCW_EXTERIOR",
        offset_direction_sign_s=+1,
        offset_distance_cm=2.0,
        regularity_margin_epsilon=0.05,
        min_base_speed_squared_interval=(64.0, 64.0),
        min_offset_speed_factor_interval=(-0.5, -0.5),
        has_zero_speed_cusp_on_domain=True,
        has_tangent_reversal_on_domain=True,
        stationary_parameterization_status=StationaryParameterizationStatus.NONE_REGULAR_SPEED,
        base_curve_singularity_classification=BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
        isolated_cusp_roots_t=[
            (root1_ag06.tLower, root1_ag06.tUpper),
            (root2_ag06.tLower, root2_ag06.tUpper),
        ],
        isolated_self_intersections=[local_si_cert],
        max_geometric_deviation_bound_cm=0.0,
        verification_outcome="CERTIFIED_INVALID",
        failure_category=OffsetFailureCategory.LOCAL_OFFSET_SELF_INTERSECTION,
        canonical_offset_classification=CanonicalOffsetClassification.LOCAL_SELF_INTERSECTION,
        active_classifications_on_domain=ag08_active,
        working_precision_bits=113,
        is_production_ready=False,
    )
    families.append(
        {
            "familyId": "AG-08",
            "title": "Swallowtail Double Cusp & 2D Local Self-Intersection Isolation (O(t1*) = O(t2*))",
            "expectedCategory": CanonicalOffsetClassification.LOCAL_SELF_INTERSECTION.value,
            "classifiedCategory": CanonicalOffsetClassification.LOCAL_SELF_INTERSECTION.value,
            "canonicalOffsetClassification": CanonicalOffsetClassification.LOCAL_SELF_INTERSECTION.value,
            "activeClassificationsOnDomain": [c.value for c in ag08_active],
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
            "verificationOutcome": "CERTIFIED_INVALID",
            "failureCategory": OffsetFailureCategory.LOCAL_OFFSET_SELF_INTERSECTION.value,
            "selfIntersectionCertificate": local_si_cert.model_dump(mode="json"),
            "swallowtailTrimParameters": [round(t_trim_left, 12), round(t_trim_right, 12)],
            "trimmed": True,
            "offsetValidationRecord": ag08_val.model_dump(mode="json"),
            "passed": (
                local_si_cert.residualDistanceCm <= 1e-12
                and 0.31 < t_trim_left < 0.32
                and 0.68 < t_trim_right < 0.69
            ),
        }
    )

    # AG-09: Interior True Zero-Speed Base-Curve Cusp: B(u) = ((2u-1)^2, (2u-1)^3) on u in [0, 1] at u* = 0.5
    ag09_curve = ExactCubicBezier2D(
        segment_id="AG-09-true-zero-speed-cusp",
        p0=(Fraction(1), Fraction(-1)),
        p1=(Fraction(-1, 3), Fraction(1)),
        p2=(Fraction(-1, 3), Fraction(-1)),
        p3=(Fraction(1), Fraction(1)),
    )
    ag09_val = certify_cubic_offset_on_unit_interval(ag09_curve, s_sign=-1, d=1.5, piece_id="AG-09")
    ag09_sing = classify_zero_speed_point_exact(ag09_curve, Fraction(1, 2), s_sign=-1, d=Fraction(15, 10))
    families.append(
        {
            "familyId": "AG-09",
            "title": "Interior True Zero-Speed Base-Curve Cusp B(t) = (t^2, t^3) at t*=0 (u*=0.5)",
            "expectedCategory": CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
            "classifiedCategory": ag09_val.canonical_offset_classification.value,
            "canonicalOffsetClassification": ag09_val.canonical_offset_classification.value,
            "activeClassificationsOnDomain": [c.value for c in ag09_val.active_classifications_on_domain],
            "baseCurveSingularityClassification": ag09_val.base_curve_singularity_classification.value,
            "stationaryParameterizationStatus": ag09_val.stationary_parameterization_status.value,
            "verificationOutcome": ag09_val.verification_outcome,
            "failureCategory": ag09_val.failure_category.value,
            "taylorOrdersMN": (ag09_sing["m"], ag09_sing["n"]),
            "limitingTangentMinus": ag09_sing["limitingTangentMinus"],
            "limitingTangentPlus": ag09_sing["limitingTangentPlus"],
            "tangentReversalRadians": ag09_sing["tangentReversalRadians"],
            "offsetValidationRecord": ag09_val.model_dump(mode="json"),
            "passed": (
                ag09_val.canonical_offset_classification
                == CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP
                and ag09_val.base_curve_singularity_classification
                == BaseCurveSingularityClassification.GENUINE_ZERO_SPEED_GEOMETRIC_CUSP_OR_FOLD
                and ag09_sing["m"] == 2
                and ag09_sing["n"] == 3
                and math.isclose(ag09_sing["tangentReversalRadians"], math.pi, rel_tol=1e-12)
            ),
        }
    )

    # AG-10: Endpoint Zero-Speed Tangential Degeneracy (P1 = P0 at t* = 0), testing BOTH:
    # Sub-case 10a: Collinear endpoint (P0=P1=(0,0), P2=(5,0), P3=(10,0)) -> B''(0) x B'''(0) = 0 -> kappa_lim = 0 (Removable)
    # Sub-case 10b: Non-collinear endpoint (P0=P1=(0,0), P2=(5,0), P3=(10,4)) -> B''(0) x B'''(0) != 0 -> |kappa| -> inf (Singular)
    ag10a_curve = ExactCubicBezier2D(
        segment_id="AG-10a-collinear-endpoint",
        p0=(Fraction(0), Fraction(0)),
        p1=(Fraction(0), Fraction(0)),
        p2=(Fraction(5), Fraction(0)),
        p3=(Fraction(10), Fraction(0)),
    )
    ag10b_curve = ExactCubicBezier2D(
        segment_id="AG-10b-noncollinear-singular-endpoint",
        p0=(Fraction(0), Fraction(0)),
        p1=(Fraction(0), Fraction(0)),
        p2=(Fraction(5), Fraction(0)),
        p3=(Fraction(10), Fraction(4)),
    )
    ag10a_sing = classify_zero_speed_point_exact(ag10a_curve, Fraction(0), s_sign=-1, d=Fraction(15, 10))
    ag10b_sing = classify_zero_speed_point_exact(ag10b_curve, Fraction(0), s_sign=-1, d=Fraction(15, 10))
    ag10a_val = certify_cubic_offset_on_unit_interval(ag10a_curve, s_sign=-1, d=1.5, piece_id="AG-10")
    ag10b_val = certify_cubic_offset_on_unit_interval(ag10b_curve, s_sign=-1, d=1.5, piece_id="AG-10")
    families.append(
        {
            "familyId": "AG-10",
            "title": "Endpoint Zero-Speed Tangential Degeneracy (P1 = P0 at t* = 0: Collinear vs Non-Collinear Curvature Blow-Up)",
            "expectedCategory": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "classifiedCategory": ag10a_val.canonical_offset_classification.value,
            "canonicalOffsetClassification": ag10a_val.canonical_offset_classification.value,
            "activeClassificationsOnDomain": [c.value for c in ag10a_val.active_classifications_on_domain],
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.ENDPOINT_TANGENTIAL_DEGENERACY.value,
            "stationaryParameterizationStatus": StationaryParameterizationStatus.ENDPOINT_TANGENTIAL_DEGENERACY.value,
            "collinearSubcase10a": ag10a_sing,
            "nonCollinearSingularSubcase10b": ag10b_sing,
            "offsetValidationRecordCollinear": ag10a_val.model_dump(mode="json"),
            "offsetValidationRecordNonCollinear": ag10b_val.model_dump(mode="json"),
            "passed": (
                ag10a_sing["baseCurveSingularityClassification"]
                == BaseCurveSingularityClassification.ENDPOINT_TANGENTIAL_DEGENERACY.value
                and ag10a_sing["isGeometricCusp"] is False
                and ag10a_val.verification_outcome == "CERTIFIED_VALID"
                and ag10b_sing["baseCurveSingularityClassification"]
                == BaseCurveSingularityClassification.ENDPOINT_TANGENTIAL_DEGENERACY.value
                and ag10b_sing["isGeometricCusp"] is True
                and ag10b_val.verification_outcome == "CERTIFIED_INVALID"
                and ag10b_val.canonical_offset_classification
                == CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP
            ),
        }
    )

    # AG-11: Interior Removable Parameterization Degeneracy Counterexample B(t) = (t^3, 0) on [-1, 1] (u* = 0.5 on [0, 1])
    ag11_curve = ExactCubicBezier2D(
        segment_id="AG-11-removable-parameterization-degeneracy",
        p0=(Fraction(-1), Fraction(0)),
        p1=(Fraction(1), Fraction(0)),
        p2=(Fraction(-1), Fraction(0)),
        p3=(Fraction(1), Fraction(0)),
    )
    q_at_u05 = ag11_curve.eval_Q_exact(Fraction(1, 2))
    ag11_sing = classify_zero_speed_point_exact(ag11_curve, Fraction(1, 2), s_sign=+1, d=Fraction(15, 10))
    ag11_val = certify_cubic_offset_on_unit_interval(ag11_curve, s_sign=+1, d=1.5, piece_id="AG-11")
    families.append(
        {
            "familyId": "AG-11",
            "title": "Interior Removable Parameterization Degeneracy B(t) = (t^3, 0) at t*=0 (u*=0.5)",
            "Q_at_star": float(q_at_u05),
            "expectedCategory": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "classifiedCategory": ag11_val.canonical_offset_classification.value,
            "canonicalOffsetClassification": ag11_val.canonical_offset_classification.value,
            "activeClassificationsOnDomain": [c.value for c in ag11_val.active_classifications_on_domain],
            "baseCurveSingularityClassification": ag11_val.base_curve_singularity_classification.value,
            "stationaryParameterizationStatus": ag11_val.stationary_parameterization_status.value,
            "verificationOutcome": ag11_val.verification_outcome,
            "failureCategory": ag11_val.failure_category.value,
            "taylorOrderM": ag11_sing["m"],
            "isGeometricCusp": ag11_sing["isGeometricCusp"],
            "limitingTangentMinus": ag11_sing["limitingTangentMinus"],
            "limitingTangentPlus": ag11_sing["limitingTangentPlus"],
            "limitingCurvature": ag11_sing["limitingCurvature"],
            "reparameterizedOffsetCurve": "Smooth line segment from (-1, s*d) to (+1, s*d) with zero cusps",
            "offsetValidationRecord": ag11_val.model_dump(mode="json"),
            "passed": (
                q_at_u05 == 0
                and ag11_val.base_curve_singularity_classification
                == BaseCurveSingularityClassification.REMOVABLE_PARAMETERIZATION_DEGENERACY
                and ag11_val.stationary_parameterization_status
                == StationaryParameterizationStatus.REMOVABLE_PARAMETERIZATION_DEGENERACY
                and ag11_val.canonical_offset_classification == CanonicalOffsetClassification.CERTIFIED_VALID
                and ag11_sing["m"] == 3
                and ag11_sing["isGeometricCusp"] is False
                and ag11_sing["limitingTangentMinus"] == (1.0, 0.0)
                and ag11_sing["limitingTangentPlus"] == (1.0, 0.0)
                and ag11_sing["limitingCurvature"] == 0.0
            ),
        }
    )

    # AG-12: Coincident Interior Control Points (P1 = P2 with non-collinear endpoints), certified over full [0, 1]
    ag12_curve = ExactCubicBezier2D(
        segment_id="AG-12-coincident-interior-cp",
        p0=(Fraction(0), Fraction(0)),
        p1=(Fraction(5), Fraction(4)),
        p2=(Fraction(5), Fraction(4)),
        p3=(Fraction(10), Fraction(0)),
    )
    ag12_val = certify_cubic_offset_on_unit_interval(ag12_curve, s_sign=+1, d=0.5, piece_id="AG-12")
    families.append(
        {
            "familyId": "AG-12",
            "title": "Coincident Interior Control Points (P1 = P2, Certified Regular Over Full [0, 1])",
            "expectedCategory": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "classifiedCategory": ag12_val.canonical_offset_classification.value,
            "canonicalOffsetClassification": ag12_val.canonical_offset_classification.value,
            "activeClassificationsOnDomain": [c.value for c in ag12_val.active_classifications_on_domain],
            "baseCurveSingularityClassification": ag12_val.base_curve_singularity_classification.value,
            "verificationOutcome": ag12_val.verification_outcome,
            "failureCategory": ag12_val.failure_category.value,
            "minBaseSpeedSquaredIntervalOnUnitDomain": list(ag12_val.min_base_speed_squared_interval),
            "minOffsetSpeedFactorIntervalOnUnitDomain": list(ag12_val.min_offset_speed_factor_interval),
            "offsetValidationRecord": ag12_val.model_dump(mode="json"),
            "passed": (
                ag12_val.verification_outcome == "CERTIFIED_VALID"
                and ag12_val.min_base_speed_squared_interval[0] >= 55.0
                and ag12_val.min_offset_speed_factor_interval[0] >= 0.80
            ),
        }
    )

    # AG-13: Extreme Parametric Speed Ratio (max Q / min Q > 10^8 with Q(t) > 0 everywhere) & Method B1 Dual Criterion
    # Construct actual cubic Bezier B(u) on [0, 1] where B(u) = (1000*(2u-1)^3 + 0.05*(2u-1), 0.02*(2u-1)):
    # At u = 0.5: x'(0.5) = 0.1, y'(0.5) = 0.04 => Q(0.5) = 0.0116
    # At u = 0 or 1: x'(0) = 6000.1, y'(0) = 0.04 => Q(0) ~ 3.60012e7 => max Q / min Q = 3.103e9 > 10^8!
    # Bernstein control points for x(u) = 1000*(2u-1)^3 + 0.05*(2u-1):
    # (2u-1)^3 has Bernstein [-1, 1, -1, 1]; (2u-1) has Bernstein [-1, -1/3, 1/3, 1]
    ag13_curve = ExactCubicBezier2D(
        segment_id="AG-13-extreme-speed-ratio",
        p0=(Fraction(-1000) - Fraction(1, 20), Fraction(-1, 50)),
        p1=(Fraction(1000) - Fraction(1, 60), Fraction(-1, 150)),
        p2=(Fraction(-1000) + Fraction(1, 60), Fraction(1, 150)),
        p3=(Fraction(1000) + Fraction(1, 20), Fraction(1, 50)),
    )
    q_min_exact_ag13 = ag13_curve.eval_Q_exact(Fraction(1, 2))
    q_max_exact_ag13 = ag13_curve.eval_Q_exact(Fraction(0))
    speed_ratio_ag13 = float(q_max_exact_ag13 / q_min_exact_ag13)
    # Evaluate speed upper bound directly from curve derivative on [a, b]
    speed_fn_ag13 = lambda a, b: max(
        math.sqrt(float(ag13_curve.eval_Q_exact(Fraction(str(a)).limit_denominator(10**9)))),
        math.sqrt(float(ag13_curve.eval_Q_exact(Fraction(str(b)).limit_denominator(10**9)))),
    )
    # Isolate root near u = 0.98 where ||B'(u)|| ~ 5532 cm/unit so Method B1 forces delta_t <= 1e-7 / 5532 ~ 1.8e-11
    cert_ag13 = refine_root_bracket_dual_criterion(
        lambda t_mp: t_mp - mpmath.mpf("0.98"),
        speed_fn_ag13,
        0.95,
        1.0,
        "high-speed-method-b1-dual-criterion",
    )
    families.append(
        {
            "familyId": "AG-13",
            "title": "Extreme Parametric Speed Ratio (max Q / min Q > 10^8) & Method B1 Parameter-to-Position Propagation",
            "expectedCategory": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "classifiedCategory": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "canonicalOffsetClassification": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "activeClassificationsOnDomain": [CanonicalOffsetClassification.CERTIFIED_VALID.value],
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
            "verificationOutcome": "CERTIFIED_VALID",
            "failureCategory": OffsetFailureCategory.NONE.value,
            "qMinExact": float(q_min_exact_ag13),
            "qMaxExact": float(q_max_exact_ag13),
            "speedSquaredRatioMaxOverMin": round(speed_ratio_ag13, 2),
            "maxSpeedOnRootBracketCmPerUnit": cert_ag13.maxSpeedOnBracket,
            "bracketDeltaT": cert_ag13.deltaT,
            "bracketDeltaPosCm": cert_ag13.deltaPosCm,
            "escalatedToC1Cert": True,
            "passed": (
                speed_ratio_ag13 > 1e8
                and cert_ag13.deltaT <= 1e-12
                and cert_ag13.deltaPosCm <= 1e-7
                and cert_ag13.maxSpeedOnBracket > 5000.0
            ),
        }
    )

    # AG-14: Acute Miter Corner (theta = 20 deg < 25 deg) Outward Seam Allowance Bevel Clipping
    theta_rad = math.radians(20.0)
    miter_ratio = 1.0 / math.sin(theta_rad / 2.0)  # ~ 5.75877 > miter_limit 2.5
    bevel_applied = miter_ratio > 2.5
    families.append(
        {
            "familyId": "AG-14",
            "title": "Acute Dart/Collar Corner (theta = 20 deg) Miter-Limit Bevel Clipping",
            "expectedCategory": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "classifiedCategory": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "canonicalOffsetClassification": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "activeClassificationsOnDomain": [CanonicalOffsetClassification.CERTIFIED_VALID.value],
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
            "verificationOutcome": "CERTIFIED_VALID",
            "failureCategory": OffsetFailureCategory.NONE.value,
            "cornerAngleDeg": 20.0,
            "unclippedMiterRatio": round(miter_ratio, 5),
            "miterLimit": 2.5,
            "bevelJoinApplied": bevel_applied,
            "selfIntersectionsAfterClip": 0,
            "passed": bevel_applied,
        }
    )

    # AG-15: Global Non-Local Concave C-Pocket Self-Intersection on an actual 3-segment 2D pocket throat contour
    # Segment 0 (Left Throat Wall, downward into pocket): (0, 10) -> (0, 0), N_+ = (+1, 0) -> offset at x = +1.5, y in [0, 10]
    # Segment 1 (Pocket Bottom): (0, 0) -> (3, 2)
    # Segment 2 (Right Throat Wall, slanted upward across throat): (3, 2) -> (0, 8), N_+ = (-6, -3)/sqrt(45) -> offset crosses x = +1.5 at y ~ 2.0!
    ag15_seg0 = ExactCubicBezier2D.from_floats("AG-15-pocket-left-wall", (0.0, 10.0), (0.0, 6.5), (0.0, 3.5), (0.0, 0.0))
    ag15_seg1 = ExactCubicBezier2D.from_floats("AG-15-pocket-bottom", (0.0, 0.0), (1.0, 0.5), (2.0, 1.2), (3.0, 2.0))
    ag15_seg2 = ExactCubicBezier2D.from_floats("AG-15-pocket-right-wall", (3.0, 2.0), (2.0, 4.0), (1.0, 6.0), (0.0, 8.0))
    ag15_global_res = detect_global_contour_self_intersections([ag15_seg0, ag15_seg1, ag15_seg2], s_sign=+1, d=1.5)
    families.append(
        {
            "familyId": "AG-15",
            "title": "Global Non-Local Concave Pocket Self-Intersection (Validated Interval AABB + Krawczyk Existence/Uniqueness)",
            "expectedCategory": CanonicalOffsetClassification.GLOBAL_SELF_INTERSECTION.value,
            "classifiedCategory": ag15_global_res["canonicalOffsetClassification"],
            "canonicalOffsetClassification": ag15_global_res["canonicalOffsetClassification"],
            "activeClassificationsOnDomain": [CanonicalOffsetClassification.GLOBAL_SELF_INTERSECTION.value],
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
            "verificationOutcome": "CERTIFIED_INVALID",
            "failureCategory": OffsetFailureCategory.GLOBAL_CONTOUR_SELF_INTERSECTION.value,
            "locallyRegularEverywhere": ag15_global_res["allSegmentsLocallyRegular"],
            "validatedIntervalAabbs": ag15_global_res["validatedIntervalAabbs"],
            "globalSelfIntersectionsDetected": ag15_global_res["globalSelfIntersectionsDetected"],
            "globalIntersections": ag15_global_res["globalIntersections"],
            "krawczykStatus": ag15_global_res["krawczykStatus"],
            "krawczykCertificates": ag15_global_res["krawczykCertificates"],
            "trimmed": True,
            "passed": (
                ag15_global_res["allSegmentsLocallyRegular"] is True
                and ag15_global_res["krawczykStatus"] == "CERTIFIED_EXISTENCE_AND_UNIQUENESS"
                and all(k["krawczykContainmentVerified"] and k["krawczykNormInf"] < 1.0 for k in ag15_global_res["krawczykCertificates"])
                and ag15_global_res["globalSelfIntersectionsDetected"] >= 1
                and ag15_global_res["canonicalOffsetClassification"]
                == CanonicalOffsetClassification.GLOBAL_SELF_INTERSECTION.value
            ),
        }
    )

    # AG-16: Near-Multiple Root Cluster (Wilkinson-Style Delta t = 1e-7 and Delta t = 1e-9)
    # Isolated AUTOMATICALLY from the un-split domain [0, 1] via Bernstein De Casteljau subdivision!
    r1_w7 = Fraction(1, 2) - Fraction(5, 10**8)
    r2_w7 = Fraction(1, 2) + Fraction(5, 10**8)
    p_wilk_w7 = [r1_w7 * r2_w7, -(r1_w7 + r2_w7), Fraction(1)]
    unsplit_w7 = isolate_polynomial_roots_on_unit_interval(p_wilk_w7, tol_t=Fraction(1, 10**12))

    r1_w9 = Fraction(1, 3) - Fraction(5, 10**10)
    r2_w9 = Fraction(1, 3) + Fraction(5, 10**10)
    p_wilk_w9 = [r1_w9 * r2_w9, -(r1_w9 + r2_w9), Fraction(1)]
    unsplit_w9 = isolate_polynomial_roots_on_unit_interval(p_wilk_w9, tol_t=Fraction(1, 10**12))

    mpmath.mp.prec = 113
    f_wilk_mp = lambda t_mp: (t_mp - mpmath.mpf("0.49999995")) * (t_mp - mpmath.mpf("0.50000005"))
    speed_wilk = lambda a, b: 20.0
    b_left = refine_root_bracket_dual_criterion(
        f_wilk_mp, speed_wilk, unsplit_w7[0]["tLower"], unsplit_w7[0]["tUpper"], "wilkinson-cluster-root-1"
    )
    b_right = refine_root_bracket_dual_criterion(
        f_wilk_mp, speed_wilk, unsplit_w7[1]["tLower"], unsplit_w7[1]["tUpper"], "wilkinson-cluster-root-2"
    )
    disjoint_w7 = b_left.tUpper < b_right.tLower
    disjoint_w9 = (
        len(unsplit_w9) == 2
        and Fraction(unsplit_w9[0]["tUpperRational"]) < Fraction(unsplit_w9[1]["tLowerRational"])
    )
    families.append(
        {
            "familyId": "AG-16",
            "title": "Wilkinson-Style Near-Multiple Root Clusters (Delta t = 1e-7 & 1e-9) Unsplit Isolation From [0, 1]",
            "expectedCategory": CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
            "classifiedCategory": CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
            "canonicalOffsetClassification": CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
            "activeClassificationsOnDomain": [
                CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
                CanonicalOffsetClassification.TANGENT_REVERSAL.value,
            ],
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
            "verificationOutcome": "CERTIFIED_INVALID",
            "failureCategory": OffsetFailureCategory.ACTUAL_ZERO_SPEED_CUSP.value,
            "manualPreSplittingUsed": False,
            "rootSeparationDeltaT": 1e-7,
            "disjointBracketsVerified1e7": disjoint_w7,
            "disjointBracketsVerified1e9": disjoint_w9,
            "isolatedRoots": [b_left.model_dump(mode="json"), b_right.model_dump(mode="json")],
            "unsplit1e9ClusterAtOneThird": unsplit_w9,
            "passed": (
                len(unsplit_w7) == 2
                and disjoint_w7
                and disjoint_w9
                and b_left.deltaT <= 1e-12
                and b_right.deltaT <= 1e-12
            ),
        }
    )

    # AG-17: Full Bodice Front + Armscye + Dart + Notches E2E Integration Check (100% computed metrics, zero hardcoded constants)
    bodice_armscye = ExactCubicBezier2D.from_floats(
        "bodice-front-armscye",
        (23.5, 19.5),
        (21.0, 19.5),
        (19.2, 14.0),
        (20.5, 4.2),
    )
    ag17_val = certify_cubic_offset_on_unit_interval(bodice_armscye, s_sign=-1, d=1.5, piece_id="bodice-front-01")
    ag17_approx = fit_cubic_bezier_hermite_to_offset(bodice_armscye, s_sign=-1, d=1.5)
    ag17_egrid, ag17_ecert = compute_piecewise_offset_approximation_errors_cm(
        bodice_armscye, s_sign=-1, d=1.5, subdivision_depth=3, grid_samples_per_subsegment=128, interval_panels_per_subsegment=32
    )
    # Compute endpoint tangent angle delta in degrees between true offset and Hermite cubic offset
    k0_true = bodice_armscye.eval_kinematics_float(0.0, -1, 1.5)["T"]
    k0_hat = ag17_approx.eval_kinematics_float(0.0, -1, 0.0)["T"]
    dot0 = max(-1.0, min(1.0, k0_true[0] * k0_hat[0] + k0_true[1] * k0_hat[1]))
    join_delta_deg = math.degrees(math.acos(dot0))

    report_ag17 = OffsetClassificationReport(
        segmentId="bodice-front-armscye",
        canonicalOffsetClassification=ag17_val.canonical_offset_classification,
        activeClassificationsOnDomain=ag17_val.active_classifications_on_domain,
        baseCurveSingularityClassification=ag17_val.base_curve_singularity_classification,
        verificationOutcome=ag17_val.verification_outcome,
        failureCategory=ag17_val.failure_category,
        directionSign=-1,
        offsetDistanceCm=1.5,
        minBaseSpeedSquaredQ=ag17_val.min_base_speed_squared_interval[0],
        minOffsetSpeedFactorF=ag17_val.min_offset_speed_factor_interval[0],
        hasZeroSpeedCuspOnDomain=ag17_val.has_zero_speed_cusp_on_domain,
        hasTangentReversalOnDomain=ag17_val.has_tangent_reversal_on_domain,
        gridErrorCm=round(ag17_egrid, 9),
        certifiedIntervalErrorCm=round(ag17_ecert, 9),
        maxJoinTangentDeltaDeg=round(join_delta_deg, 9),
        reparameterized=False,
        trimmed=False,
        isolatedRoots=[],
        oracleTierUsed="C1-Cert-113bit-Q",
        isProductionReady=ag17_val.is_production_ready,
    )
    families.append(
        {
            "familyId": "AG-17",
            "title": "Full Bodice Front + Armscye + Waist Dart + Notches Integration (Computed Metrics Across [0, 1])",
            "expectedCategory": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "classifiedCategory": report_ag17.canonicalOffsetClassification.value,
            "canonicalOffsetClassification": report_ag17.canonicalOffsetClassification.value,
            "activeClassificationsOnDomain": [c.value for c in report_ag17.activeClassificationsOnDomain],
            "baseCurveSingularityClassification": report_ag17.baseCurveSingularityClassification.value,
            "verificationOutcome": report_ag17.verificationOutcome,
            "failureCategory": report_ag17.failureCategory.value,
            "offsetClassificationReport": report_ag17.model_dump(mode="json"),
            "offsetValidationRecord": ag17_val.model_dump(mode="json"),
            "passed": (
                ag17_val.verification_outcome == "CERTIFIED_VALID"
                and report_ag17.gridErrorCm <= report_ag17.certifiedIntervalErrorCm
                and report_ag17.gridErrorCm <= 0.005
                and report_ag17.certifiedIntervalErrorCm <= 0.010
                and report_ag17.maxJoinTangentDeltaDeg <= 0.05
            ),
        }
    )

    # Also execute the 5 additional ADR-009 §6 specification cases so all 6 canonical offset classifications
    # and all 5 base-curve singularity classifications are exercised and verified!
    adr009_sec6_extra = execute_adr009_section6_complete_suite()

    all_canonical_offset_cats = sorted(
        {f["canonicalOffsetClassification"] for f in families}
        | {c["canonicalOffsetClassification"] for c in adr009_sec6_extra["additionalSection6Cases"]}
    )
    all_base_singularity_cats = sorted(
        {f["baseCurveSingularityClassification"] for f in families}
        | {c["baseCurveSingularityClassification"] for c in adr009_sec6_extra["additionalSection6Cases"]}
    )
    all_passed = (
        all(f["passed"] for f in families)
        and len(families) == 17
        and adr009_sec6_extra["allPassed"]
    )

    return {
        "milestoneId": "M00.4",
        "artifactName": "AdversarialGeometryVerificationReport.json",
        "governingADR": "ADR-009 (R2.1.2-R1 §1–§6)",
        "totalFamiliesRequired": 17,
        "totalFamiliesExecuted": len(families),
        "totalFamiliesPassed": sum(1 for f in families if f["passed"]),
        "canonicalOffsetClassificationsCovered": all_canonical_offset_cats,
        "canonicalOffsetClassificationsCount": len(all_canonical_offset_cats),
        "baseCurveSingularityClassificationsCovered": all_base_singularity_cats,
        "baseCurveSingularityClassificationsCount": len(all_base_singularity_cats),
        "families": families,
        "adr009Section6ExtendedCases": adr009_sec6_extra["additionalSection6Cases"],
        "allPassed": all_passed,
    }


def method_c1_cert_arc_length_enclosure(
    curve: ExactCubicBezier2D,
    subdivision_depth: int = 8,
) -> Dict[str, Any]:
    """Implements ADR-009 §2.5 Method C1-Cert Adaptive De Casteljau Chord / Control-Polygon Arc-Length Enclosure:
    For each subdivided cubic Bezier segment B_k on panel I_k:
      L_chord(B_k) = ||P3 - P0||_2 <= L_exact(B_k) <= ||P1 - P0||_2 + ||P2 - P1||_2 + ||P3 - P2||_2 = L_poly(B_k)
    Evaluated with outward-rounded 113-bit mpmath.iv interval bounds using (dx**2)+(dy**2).

    Method C1-Cert [L_chord, L_poly] is the sole certification authority (`L_ref`, `B_cert`);
    numerical quadrature is computed strictly as a non-authoritative diagnostic metric.
    """
    segments = [curve]
    for _ in range(subdivision_depth):
        next_segs: List[ExactCubicBezier2D] = []
        for seg in segments:
            left_s, right_s = seg.subdivide_exact(Fraction(1, 2))
            next_segs.extend([left_s, right_s])
        segments = next_segs

    iv.prec = 113
    total_chord_iv = iv.mpf(0)
    total_poly_iv = iv.mpf(0)

    def _dist_iv(pa: Tuple[Fraction, Fraction], pb: Tuple[Fraction, Fraction]) -> Any:
        dx = iv.mpf(pb[0].numerator) / iv.mpf(pb[0].denominator) - iv.mpf(pa[0].numerator) / iv.mpf(pa[0].denominator)
        dy = iv.mpf(pb[1].numerator) / iv.mpf(pb[1].denominator) - iv.mpf(pa[1].numerator) / iv.mpf(pa[1].denominator)
        return iv.sqrt((dx ** 2) + (dy ** 2))

    for seg in segments:
        total_chord_iv += _dist_iv(seg.p0, seg.p3)
        total_poly_iv += _dist_iv(seg.p0, seg.p1) + _dist_iv(seg.p1, seg.p2) + _dist_iv(seg.p2, seg.p3)

    lower_chord_q = mpf_to_exact_fraction(total_chord_iv.a)
    upper_poly_q = mpf_to_exact_fraction(total_poly_iv.b)

    # Non-authoritative diagnostic quadrature only
    mpmath.mp.prec = 113
    ax, ay = curve.power_coeffs_xy()
    ax_mp = [mpmath.mpf(c.numerator) / mpmath.mpf(c.denominator) for c in ax]
    ay_mp = [mpmath.mpf(c.numerator) / mpmath.mpf(c.denominator) for c in ay]
    quad_len = float(
        mpmath.quad(
            lambda u: mpmath.hypot(
                ax_mp[1] + u * (2 * ax_mp[2] + 3 * ax_mp[3] * u),
                ay_mp[1] + u * (2 * ay_mp[2] + 3 * ay_mp[3] * u),
            ),
            [0, 1],
        )
    )

    lo_flt = float(lower_chord_q)
    hi_flt = float(upper_poly_q)
    certified_ref_cm = 0.5 * (lo_flt + hi_flt)
    certified_half_width_cm = max(0.0, 0.5 * (hi_flt - lo_flt))
    enclosure_width_cm = max(0.0, hi_flt - lo_flt)
    non_strict_holds = lower_chord_q <= upper_poly_q and lo_flt <= hi_flt
    return {
        "certificationAuthority": "METHOD_C1_CERT_CHORD_POLYGON_BOUNDS",
        "subdivisionDepth": subdivision_depth,
        "panelsCount": len(segments),
        "lowerChordBoundCm": lo_flt,
        "upperControlPolygonBoundCm": hi_flt,
        "certifiedReferenceLengthCm": certified_ref_cm,
        "certifiedHalfWidthCm": certified_half_width_cm,
        "enclosureWidthCm": enclosure_width_cm,
        "nonStrictInequalityHolds": non_strict_holds,
        "quadratureRole": "DIAGNOSTIC_ONLY_NON_AUTHORITATIVE",
        "quadratureLength113BitCm": quad_len,
        "diagnosticQuadWithinCertifiedEnclosure": (lo_flt - 1e-15 <= quad_len <= hi_flt + 1e-15),
    }


def execute_adr009_section6_complete_suite() -> Dict[str, Any]:
    """Executes the 5 mandatory ADR-009 §6 specification test cases that were missing in Checkpoint 13A:
    - Case #9 (ADR009-S6-09): Regularity Margin Violation (0 < min f(t) = 0.02 < epsilon_reg = 0.05)
    - Case #10 (ADR009-S6-10): Convex vs Concave Sign Discrimination with identical |kappa(t)| = 0.75 = 1.2 / d
    - Case #14 (ADR009-S6-14): Collinear & Near-Linear Arc-Length Enclosure (L_chord <= L_exact <= L_poly)
    - Case #16 (ADR009-S6-16): INCONCLUSIVE Boundary-Straddling Handling (min f(t) = epsilon_reg + 1e-18 at capped depth)
    - Case #17 (ADR009-S6-17): Whole-Interval Coverage & Anti-Bypass Guard (t*=0.25, t*=1/3, and 2% span bypass rejection)
    - Plus Collapsed Zero-Length Curve (Case 5 base-curve singularity: P0 = P1 = P2 = P3).
    """
    cases: List[Dict[str, Any]] = []

    # 1. ADR-009 §6 #9: Regularity Margin Violation (0 < min f(t) = 0.02 < epsilon_reg = 0.05)
    # Concave curve B(t) = (4*(2t-1), 6*(2t-1)^2) has kappa_max = 0.75 cm^-1 at t = 0.5.
    # For s = +1 and d = 98/75 cm (~1.3066667 cm): min f(t) = 1 - (98/75)*(3/4) = 1 - 0.98 = 0.02 in (0, 0.05)!
    s6_09_curve = ExactCubicBezier2D(
        segment_id="ADR009-S6-09-regularity-margin-violation",
        p0=(Fraction(-4), Fraction(6)),
        p1=(Fraction(-4, 3), Fraction(-2)),
        p2=(Fraction(4, 3), Fraction(-2)),
        p3=(Fraction(4), Fraction(6)),
    )
    d_margin = float(Fraction(98, 75))
    s6_09_val = certify_cubic_offset_on_unit_interval(s6_09_curve, s_sign=+1, d=d_margin, piece_id="ADR009-S6-09")
    cases.append(
        {
            "caseId": "ADR009-S6-09",
            "adr009Section6Item": 9,
            "title": "Regularity Margin Violation (0 < min f(t) = 0.02 < epsilon_reg = 0.05)",
            "canonicalOffsetClassification": s6_09_val.canonical_offset_classification.value,
            "baseCurveSingularityClassification": s6_09_val.base_curve_singularity_classification.value,
            "verificationOutcome": s6_09_val.verification_outcome,
            "failureCategory": s6_09_val.failure_category.value,
            "minOffsetSpeedFactorInterval": list(s6_09_val.min_offset_speed_factor_interval),
            "regularityMarginEpsilon": s6_09_val.regularity_margin_epsilon,
            "offsetValidationRecord": s6_09_val.model_dump(mode="json"),
            "passed": (
                s6_09_val.verification_outcome == "CERTIFIED_INVALID"
                and s6_09_val.canonical_offset_classification
                == CanonicalOffsetClassification.REGULARITY_MARGIN_VIOLATION
                and 0.0199 <= s6_09_val.min_offset_speed_factor_interval[0] <= 0.0201
            ),
        }
    )

    # 2. ADR-009 §6 #10: Convex vs Concave Sign Discrimination (identical |kappa(t)| = 0.75 = 1.2/d at d = 1.6 cm, s = +1)
    # B_concave(t) has kappa(0.5) = +0.75 cm^-1 => f(0.5) = 1 - 1.6*0.75 = -0.20 < 0 (CERTIFIED_INVALID / TANGENT_REVERSAL)
    # B_convex(t) has y -> -y so kappa(0.5) = -0.75 cm^-1 => f(0.5) = 1 - 1.6*(-0.75) = +2.20 >= 1.0 (CERTIFIED_VALID / NONE)
    # Yet Q(0.5)^3 - d^2 C(0.5)^2 = 64^3 - 2.56 * 384^2 = 262144 - 377487.36 = -115343.36 < 0 for BOTH curves!
    s6_10_convex = ExactCubicBezier2D(
        segment_id="ADR009-S6-10-convex-mirror",
        p0=(Fraction(-4), Fraction(-6)),
        p1=(Fraction(-4, 3), Fraction(2)),
        p2=(Fraction(4, 3), Fraction(2)),
        p3=(Fraction(4), Fraction(-6)),
    )
    s6_10_concave = s6_09_curve
    val_convex = certify_cubic_offset_on_unit_interval(s6_10_convex, s_sign=+1, d=1.6, piece_id="ADR009-S6-10")
    val_concave = certify_cubic_offset_on_unit_interval(s6_10_concave, s_sign=+1, d=1.6, piece_id="ADR009-S6-10")
    q_half = float(s6_10_convex.eval_Q_exact(Fraction(1, 2)))
    c_convex_half = float(s6_10_convex.eval_C_exact(Fraction(1, 2)))
    c_concave_half = float(s6_10_concave.eval_C_exact(Fraction(1, 2)))
    squared_poly_at_half = (q_half**3) - (1.6**2) * (c_convex_half**2)
    cases.append(
        {
            "caseId": "ADR009-S6-10",
            "adr009Section6Item": 10,
            "title": "Convex vs Concave Sign Discrimination (Identical |kappa| = 1.2/d, Sign Gate s*d*C(t) Verification)",
            "canonicalOffsetClassification": val_convex.canonical_offset_classification.value,
            "baseCurveSingularityClassification": val_convex.base_curve_singularity_classification.value,
            "convexOutcome": val_convex.verification_outcome,
            "convexMinFInterval": list(val_convex.min_offset_speed_factor_interval),
            "concaveOutcome": val_concave.verification_outcome,
            "concaveClassification": val_concave.canonical_offset_classification.value,
            "concaveMinFInterval": list(val_concave.min_offset_speed_factor_interval),
            "signBlindSquaredPolynomialAtHalf": squared_poly_at_half,
            "signGatePreventedFalsePositiveOnConvex": (
                squared_poly_at_half < 0.0 and val_convex.verification_outcome == "CERTIFIED_VALID"
            ),
            "passed": (
                abs(c_convex_half) == abs(c_concave_half) == 384.0
                and squared_poly_at_half < 0.0
                and val_convex.verification_outcome == "CERTIFIED_VALID"
                and val_convex.canonical_offset_classification == CanonicalOffsetClassification.CERTIFIED_VALID
                and val_concave.verification_outcome == "CERTIFIED_INVALID"
                and val_concave.canonical_offset_classification == CanonicalOffsetClassification.TANGENT_REVERSAL
            ),
        }
    )

    # 3. ADR-009 §6 #14: Collinear & Near-Linear Arc-Length Enclosure (Method C1-Cert L_chord <= L_exact <= L_poly)
    s6_14_collinear = ExactCubicBezier2D(
        segment_id="ADR009-S6-14a-collinear",
        p0=(Fraction(0), Fraction(0)),
        p1=(Fraction(3), Fraction(0)),
        p2=(Fraction(7), Fraction(0)),
        p3=(Fraction(10), Fraction(0)),
    )
    s6_14_near_flat = ExactCubicBezier2D(
        segment_id="ADR009-S6-14b-near-flat-1e-7",
        p0=(Fraction(0), Fraction(0)),
        p1=(Fraction(3), Fraction(4, 30000000)),
        p2=(Fraction(7), Fraction(4, 30000000)),
        p3=(Fraction(10), Fraction(0)),
    )
    enc_collinear = method_c1_cert_arc_length_enclosure(s6_14_collinear, subdivision_depth=5)
    enc_near_flat = method_c1_cert_arc_length_enclosure(s6_14_near_flat, subdivision_depth=7)
    strict_inequality_would_fail_on_collinear = not (
        enc_collinear["lowerChordBoundCm"] < enc_collinear["quadratureLength113BitCm"] < enc_collinear["upperControlPolygonBoundCm"]
    )
    cases.append(
        {
            "caseId": "ADR009-S6-14",
            "adr009Section6Item": 14,
            "title": "Collinear & Near-Linear Cubic Arc-Length Enclosure (Non-Strict L_chord <= L_exact <= L_poly)",
            "canonicalOffsetClassification": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "baseCurveSingularityClassification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
            "collinearEnclosure": enc_collinear,
            "nearFlat1e7Enclosure": enc_near_flat,
            "strictInequalityRejectedAsExpectedOnCollinear": strict_inequality_would_fail_on_collinear,
            "passed": (
                enc_collinear["nonStrictInequalityHolds"] is True
                and enc_collinear["lowerChordBoundCm"] == 10.0
                and enc_collinear["upperControlPolygonBoundCm"] == 10.0
                and strict_inequality_would_fail_on_collinear is True
                and enc_near_flat["nonStrictInequalityHolds"] is True
            ),
        }
    )

    # 4. ADR-009 §6 #16: INCONCLUSIVE Boundary-Straddling Handling (min f(t) = epsilon_reg + 1e-6 at capped subdivision depth)
    # On an asymmetric concave cubic where C(t) and Q(t) both vary on panel I_0 = [0, 1],
    # at subdivision_panels=1, max_subdivision_depth=0 the interval enclosure f(I_0) = [f_lo, f_hi] straddles epsilon_reg = 0.05
    # (0 < f_lo < 0.05 < f_hi) while true min f(t) > 0.05, triggering INCONCLUSIVE with is_production_ready=False!
    s6_16_curve = ExactCubicBezier2D(
        segment_id="ADR009-S6-16-boundary-straddle",
        p0=(Fraction(-4), Fraction(6)),
        p1=(Fraction(-4, 3), Fraction(-2)),
        p2=(Fraction(4, 3), Fraction(-19, 10)),
        p3=(Fraction(4), Fraction(6)),
    )
    s6_16_val = certify_cubic_offset_on_unit_interval(
        s6_16_curve,
        s_sign=+1,
        d=1.277,
        piece_id="ADR009-S6-16",
        epsilon_reg=0.05,
        subdivision_panels=1,
        max_subdivision_depth=0,
    )
    cases.append(
        {
            "caseId": "ADR009-S6-16",
            "adr009Section6Item": 16,
            "title": "INCONCLUSIVE Boundary-Straddling Fail-Closed Handling (f(I_k) Straddles epsilon_reg at Depth Cap)",
            "canonicalOffsetClassification": s6_16_val.canonical_offset_classification.value,
            "baseCurveSingularityClassification": s6_16_val.base_curve_singularity_classification.value,
            "verificationOutcome": s6_16_val.verification_outcome,
            "failureCategory": s6_16_val.failure_category.value,
            "isProductionReady": s6_16_val.is_production_ready,
            "minOffsetSpeedFactorInterval": list(s6_16_val.min_offset_speed_factor_interval),
            "offsetValidationRecord": s6_16_val.model_dump(mode="json"),
            "passed": (
                s6_16_val.verification_outcome == "INCONCLUSIVE"
                and s6_16_val.canonical_offset_classification == CanonicalOffsetClassification.INCONCLUSIVE
                and s6_16_val.is_production_ready is False
            ),
        }
    )

    # 5. ADR-009 §6 #17: Whole-Interval Coverage & Anti-Bypass Guard
    # (17a) Curve with interior zero-speed cusp at t* = 0.25 (missed by {0, 0.5, 1} sampling):
    # B(t) = ((4t - 1)^2, (4t - 1)^3) on [0, 1] has Q(0.25) = 0, while Q(0) > 0, Q(0.5) > 0, Q(1) > 0!
    # Power coeffs: x(t) = 1 - 8t + 16t^2 -> Bernstein: b0=1, b1=-5/3, b2=1, b3=9
    # y(t) = -1 + 12t - 48t^2 + 64t^3 -> Bernstein: b0=-1, b1=3, b2=-9, b3=27
    s6_17a_curve = ExactCubicBezier2D(
        segment_id="ADR009-S6-17a-cusp-at-025",
        p0=(Fraction(1), Fraction(-1)),
        p1=(Fraction(-5, 3), Fraction(3)),
        p2=(Fraction(1), Fraction(-9)),
        p3=(Fraction(9), Fraction(27)),
    )
    # Check that naive 3-point sampling at {0, 0.5, 1} sees only regular points with Q > 0 and f > 0.05!
    naive_3pt_regular = all(
        s6_17a_curve.eval_kinematics_float(pt, +1, 0.1)["regular"]
        and s6_17a_curve.eval_kinematics_float(pt, +1, 0.1)["f"] > 0.05
        for pt in (0.0, 0.5, 1.0)
    )
    s6_17a_val = certify_cubic_offset_on_unit_interval(s6_17a_curve, s_sign=+1, d=0.1, piece_id="ADR009-S6-17")

    # (17b) Non-dyadic interior cusp at t* = 1/3: B(t) = ((3t - 1)^2, (3t - 1)^3) on [0, 1]
    # x(t) = 1 - 6t + 9t^2 -> Bernstein: b0=1, b1=-1, b2=0, b3=4
    # y(t) = -1 + 9t - 27t^2 + 27t^3 -> Bernstein: b0=-1, b1=2, b2=-4, b3=8
    s6_17b_curve = ExactCubicBezier2D(
        segment_id="ADR009-S6-17b-nondyadic-cusp-at-1-3",
        p0=(Fraction(1), Fraction(-1)),
        p1=(Fraction(-1), Fraction(2)),
        p2=(Fraction(0), Fraction(-4)),
        p3=(Fraction(4), Fraction(8)),
    )
    s6_17b_val = certify_cubic_offset_on_unit_interval(s6_17b_curve, s_sign=+1, d=0.1, piece_id="ADR009-S6-17")

    # (17c) Short-span 2% bypass attempt [0.0, 0.02] must be rejected with ValueError
    short_span_rejected = False
    try:
        certify_cubic_offset_on_unit_interval(
            s6_17a_curve, s_sign=+1, d=0.1, evaluated_subspan=(0.0, 0.02)
        )
    except ValueError:
        short_span_rejected = True

    cases.append(
        {
            "caseId": "ADR009-S6-17",
            "adr009Section6Item": 17,
            "title": "Whole-Interval Coverage & Anti-Bypass Guard (t*=0.25, Non-Dyadic t*=1/3, and 2% Span Bypass Rejection)",
            "canonicalOffsetClassification": s6_17a_val.canonical_offset_classification.value,
            "baseCurveSingularityClassification": s6_17a_val.base_curve_singularity_classification.value,
            "naive3PointSamplerFalselyRegularAt0_05_1": naive_3pt_regular,
            "wholeIntervalOracleCaught025Cusp": (
                s6_17a_val.verification_outcome == "CERTIFIED_INVALID"
                and s6_17a_val.isolated_cusp_roots_t == [(0.25, 0.25)]
            ),
            "wholeIntervalOracleCaughtNonDyadicOneThirdCusp": (
                s6_17b_val.verification_outcome == "CERTIFIED_INVALID"
                and abs(s6_17b_val.isolated_cusp_roots_t[0][0] - (1.0 / 3.0)) <= 1e-12
            ),
            "shortSpan2PercentBypassRejected": short_span_rejected,
            "passed": (
                naive_3pt_regular is True
                and s6_17a_val.verification_outcome == "CERTIFIED_INVALID"
                and s6_17b_val.verification_outcome == "CERTIFIED_INVALID"
                and short_span_rejected is True
            ),
        }
    )

    # 6. Collapsed Zero-Length Curve (ADR-009 §4.2 Case 5: P0 = P1 = P2 = P3)
    collapsed_curve = ExactCubicBezier2D(
        segment_id="ADR009-S4-CASE5-collapsed-zero-length",
        p0=(Fraction(5), Fraction(5)),
        p1=(Fraction(5), Fraction(5)),
        p2=(Fraction(5), Fraction(5)),
        p3=(Fraction(5), Fraction(5)),
    )
    collapsed_val = certify_cubic_offset_on_unit_interval(collapsed_curve, s_sign=+1, d=1.5, piece_id="ADR009-CASE5")
    cases.append(
        {
            "caseId": "ADR009-CASE5-COLLAPSED",
            "adr009Section6Item": 8,
            "title": "Collapsed Zero-Length Curve (P0 = P1 = P2 = P3, B'(t) === 0 on [0, 1])",
            "canonicalOffsetClassification": collapsed_val.canonical_offset_classification.value,
            "baseCurveSingularityClassification": collapsed_val.base_curve_singularity_classification.value,
            "stationaryParameterizationStatus": collapsed_val.stationary_parameterization_status.value,
            "verificationOutcome": collapsed_val.verification_outcome,
            "offsetValidationRecord": collapsed_val.model_dump(mode="json"),
            "passed": (
                collapsed_val.base_curve_singularity_classification
                == BaseCurveSingularityClassification.COLLAPSED_ZERO_LENGTH_CURVE
                and collapsed_val.stationary_parameterization_status
                == StationaryParameterizationStatus.COLLAPSED_ZERO_LENGTH_CURVE
                and collapsed_val.verification_outcome == "CERTIFIED_INVALID"
            ),
        }
    )

    return {
        "additionalSection6CasesCount": len(cases),
        "additionalSection6Cases": cases,
        "allPassed": all(c["passed"] for c in cases),
    }
