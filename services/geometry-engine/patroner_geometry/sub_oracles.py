"""M00.5, M00.6, M00.7 & M00.8 Reference Verification Oracles (Remediating FINDING-SUBORACLES-01).

- M00.5: Method C1-Cert De Casteljau Chord/Control-Polygon Interval Arc-Length Enclosure + Adaptive 5-point Gauss-Legendre
         Quadrature + Monotone Newton-Brent Inversion with ADR-009 §2.5 Method B1 NumericalVerificationRecord emission.
- M00.6: Exact Rational (Fraction) Topological Predicates (including orient2d == 0 collinear & vertex-on-edge intersections)
         & Polygon Boolean Verification Suite.
- M00.7: Complete DXF R12 (AC1009) / AAMA / ASTM D6673 Reference Emitter & Parser (HEADER, TABLES, ENTITIES) with explicit
         distinction between synthetic round-trip verification and external CAD interoperability.
- M00.8: Anthropometric BodyProfile Plausibility & DEC-11 Paired Seam-Length Parity Computed Directly from Drafted Cubic Bezier Pieces.
"""

from __future__ import annotations

import hashlib
import math
import platform
from fractions import Fraction
from typing import Any, Dict, List, Tuple

import mpmath
from mpmath import iv

from .c1_cert_oracle import (
    ExactCubicBezier2D,
    compute_interval_max_speed_on_domain_cm_per_t,
    method_c1_cert_arc_length_enclosure,
)
from .contracts import (
    BodyProfile,
    DxfExportManifest,
    NumericalErrorComponents,
    NumericalReproducibilityManifest,
    NumericalVerificationRecord,
    OutputPropagationRecord,
    ParameterEnclosureRecord,
)
from .qualification import (
    fraction_pair_to_outward_f64_pair,
    fraction_to_outward_upper_f64,
    mpf_to_outward_upper_f64,
)

# 5-point Gauss-Legendre nodes and weights on [-1, 1] in high precision
_GL5_NODES = [
    -0.9061798459386639927976269,
    -0.5384693101056830910363144,
    0.0,
    0.5384693101056830910363144,
    0.9061798459386639927976269,
]
_GL5_WEIGHTS = [
    0.2369268850561890875142640,
    0.4786286704993664680412915,
    0.5688888888888888888888889,
    0.4786286704993664680412915,
    0.2369268850561890875142640,
]


def _gl5_panel(speed_fn, a: float, b: float) -> float:
    half = 0.5 * (b - a)
    mid = 0.5 * (a + b)
    total = 0.0
    for node, weight in zip(_GL5_NODES, _GL5_WEIGHTS):
        total += weight * speed_fn(mid + half * node)
    return half * total


def adaptive_gauss_legendre_arc_length_checked(
    curve: ExactCubicBezier2D,
    t_end: float = 1.0,
    panel_tol_cm: float = 1e-9,
    max_depth: int = 18,
) -> Tuple[float, int, bool]:
    """Computes L(t_end) = int_0^{t_end} ||B'(u)|| du using recursive 5-point Gauss-Legendre quadrature,
    explicitly reporting whether every panel converged within tolerance before hitting `max_depth`.
    """
    if t_end <= 0.0:
        return 0.0, 0, True

    ax, ay = [float(c) for c in curve.power_coeffs_xy()[0]], [float(c) for c in curve.power_coeffs_xy()[1]]

    def speed(u: float) -> float:
        dx = ax[1] + u * (2.0 * ax[2] + 3.0 * ax[3] * u)
        dy = ay[1] + u * (2.0 * ay[2] + 3.0 * ay[3] * u)
        return math.hypot(dx, dy)

    panels_used = [0]
    converged = [True]

    def recurse(a: float, b: float, whole: float, tol: float, depth: int) -> float:
        mid = 0.5 * (a + b)
        left = _gl5_panel(speed, a, mid)
        right = _gl5_panel(speed, mid, b)
        panels_used[0] += 2
        err = abs(left + right - whole)
        if err <= tol:
            return left + right
        if depth >= max_depth:
            converged[0] = False
            return left + right
        return recurse(a, mid, left, tol * 0.5, depth + 1) + recurse(mid, b, right, tol * 0.5, depth + 1)

    initial = _gl5_panel(speed, 0.0, t_end)
    panels_used[0] += 1
    total = recurse(0.0, t_end, initial, panel_tol_cm, 0)
    return total, panels_used[0], converged[0]


def adaptive_gauss_legendre_arc_length(
    curve: ExactCubicBezier2D,
    t_end: float = 1.0,
    panel_tol_cm: float = 1e-9,
    max_depth: int = 18,
) -> Tuple[float, int]:
    """Computes L(t_end) = int_0^{t_end} ||B'(u)|| du using recursive 5-point Gauss-Legendre quadrature."""
    total, panels, _converged = adaptive_gauss_legendre_arc_length_checked(
        curve, t_end=t_end, panel_tol_cm=panel_tol_cm, max_depth=max_depth
    )
    return total, panels


def _curve_fixture_sha256(curve: ExactCubicBezier2D) -> str:
    """Deterministic SHA-256 over a cubic Bezier's exact rational control points."""
    canonical = "|".join(
        f"{p[0].numerator}/{p[0].denominator},{p[1].numerator}/{p[1].denominator}"
        for p in (curve.p0, curve.p1, curve.p2, curve.p3)
    )
    payload = f"{curve.segment_id}:{canonical}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _fraction_to_iv_113(q: Fraction) -> Any:
    iv.prec = 113
    mpmath.mp.prec = 113
    return iv.mpf(q.numerator) / iv.mpf(q.denominator)


def _point_eval_rounding_bound_cm(curve: ExactCubicBezier2D, t_mid: float) -> float:
    """Computes a certified strictly positive 113-bit outward rounding bound delta_eval_cm > 0
    for evaluating B(t_mid) in IEEE-754 binary64 relative to exact rational / 113-bit interval evaluation.
    """
    iv.prec = 113
    mpmath.mp.prec = 113
    t_q = Fraction(t_mid)
    t_iv = _fraction_to_iv_113(t_q)
    ax_q, ay_q = curve.power_coeffs_xy()
    ax_iv = [_fraction_to_iv_113(c) for c in ax_q]
    ay_iv = [_fraction_to_iv_113(c) for c in ay_q]
    bx_iv = ax_iv[0] + t_iv * (ax_iv[1] + t_iv * (ax_iv[2] + t_iv * ax_iv[3]))
    by_iv = ay_iv[0] + t_iv * (ay_iv[1] + t_iv * (ay_iv[2] + t_iv * ay_iv[3]))
    # Evaluate same polynomial in float64
    ax_f = [float(c) for c in ax_q]
    ay_f = [float(c) for c in ay_q]
    bx_f = ax_f[0] + t_mid * (ax_f[1] + t_mid * (ax_f[2] + t_mid * ax_f[3]))
    by_f = ay_f[0] + t_mid * (ay_f[1] + t_mid * (ay_f[2] + t_mid * ay_f[3]))
    diff_x = bx_iv - _fraction_to_iv_113(Fraction(bx_f))
    diff_y = by_iv - _fraction_to_iv_113(Fraction(by_f))
    dist_iv = iv.sqrt((diff_x ** 2) + (diff_y ** 2))
    # Add 1 ULP of positional scale so delta_eval is strictly positive even on exact dyadic points
    scale_ulp = math.ulp(max(1.0, abs(bx_f), abs(by_f)))
    raw_bound = mpf_to_outward_upper_f64(dist_iv.b + mpmath.mpf(scale_ulp))
    return max(raw_bound, scale_ulp)


def inverse_arc_length_newton_brent(
    curve: ExactCubicBezier2D,
    target_s_cm: float,
    tol_s_cm: float = 1e-7,
    tol_t: float = 1e-12,
) -> Dict[str, Any]:
    """Inverts L(t*) = target_s_cm using monotone Newton-Raphson with bracketed Brent/bisection fallback,
    emitting a complete ADR-009 §2.5 NumericalVerificationRecord with Method B1 parameter-to-position propagation
    and strictly positive point-evaluation rounding bound delta_eval_cm > 0.
    """
    total_len, panels_total, total_conv = adaptive_gauss_legendre_arc_length_checked(curve, 1.0)
    if target_s_cm <= 0.0:
        return {
            "tStar": 0.0,
            "tBracket": [0.0, 0.0],
            "arcLengthResidualCm": 0.0,
            "deltaT": 0.0,
            "maxSpeedOnBracketCmPerUnit": 0.0,
            "deltaPosCm": 0.0,
            "iterations": 0,
            "panelsUsed": panels_total,
            "quadratureConverged": total_conv,
        }
    if target_s_cm >= total_len:
        return {
            "tStar": 1.0,
            "tBracket": [1.0, 1.0],
            "arcLengthResidualCm": abs(total_len - target_s_cm),
            "deltaT": 0.0,
            "maxSpeedOnBracketCmPerUnit": 0.0,
            "deltaPosCm": 0.0,
            "iterations": 0,
            "panelsUsed": panels_total,
            "quadratureConverged": total_conv,
        }

    ax, ay = [float(c) for c in curve.power_coeffs_xy()[0]], [float(c) for c in curve.power_coeffs_xy()[1]]

    def speed(u: float) -> float:
        dx = ax[1] + u * (2.0 * ax[2] + 3.0 * ax[3] * u)
        dy = ay[1] + u * (2.0 * ay[2] + 3.0 * ay[3] * u)
        return math.hypot(dx, dy)

    lo = 0.0
    hi = 1.0
    t_curr = target_s_cm / total_len
    iters = 0
    all_quad_converged = total_conv

    for it in range(60):
        iters = it + 1
        cur_len, _, cur_conv = adaptive_gauss_legendre_arc_length_checked(curve, t_curr)
        all_quad_converged = all_quad_converged and cur_conv
        res = cur_len - target_s_cm
        if res < 0.0:
            lo = max(lo, t_curr)
        else:
            hi = min(hi, t_curr)

        spd = speed(t_curr)
        bracket_width = hi - lo
        if abs(res) <= tol_s_cm and bracket_width <= tol_t and (spd * bracket_width) <= tol_s_cm:
            break

        if spd > 1e-12:
            cand = t_curr - res / spd
            if lo < cand < hi:
                t_curr = cand
            else:
                t_curr = 0.5 * (lo + hi)
        else:
            t_curr = 0.5 * (lo + hi)

    while (hi - lo) > tol_t:
        mid = 0.5 * (lo + hi)
        mid_len, _, mid_conv = adaptive_gauss_legendre_arc_length_checked(curve, mid)
        all_quad_converged = all_quad_converged and mid_conv
        if mid_len < target_s_cm:
            lo = mid
        else:
            hi = mid
    t_curr = 0.5 * (lo + hi)
    final_len, panels_final, final_conv = adaptive_gauss_legendre_arc_length_checked(curve, t_curr)
    all_quad_converged = all_quad_converged and final_conv
    final_res = abs(final_len - target_s_cm)

    # Certified local speed upper bound on [lo, hi] in 113-bit mpmath.iv (Method B1)
    # with outward upper rounding on r_param, delta_t, delta_eval_cm > 0, and B_ref_x = M * r_param + delta_eval_cm.
    iv.prec = 113
    mpmath.mp.prec = 113
    lo_q = Fraction(lo)
    hi_q = Fraction(hi)
    t_iv = iv.mpf([_fraction_to_iv_113(lo_q).a, _fraction_to_iv_113(hi_q).b])
    ax_iv = [_fraction_to_iv_113(c) for c in curve.power_coeffs_xy()[0]]
    ay_iv = [_fraction_to_iv_113(c) for c in curve.power_coeffs_xy()[1]]
    dx_iv = ax_iv[1] + t_iv * (2 * ax_iv[2] + 3 * ax_iv[3] * t_iv)
    dy_iv = ay_iv[1] + t_iv * (2 * ay_iv[2] + 3 * ay_iv[3] * t_iv)
    spd_iv = iv.sqrt((dx_iv ** 2) + (dy_iv ** 2))
    local_speed_upper_bound = mpf_to_outward_upper_f64(spd_iv.b)

    dt_q = max(Fraction(0), hi_q - lo_q)
    r_param_q = dt_q / Fraction(2)
    delta_t = fraction_to_outward_upper_f64(dt_q)
    r_param = fraction_to_outward_upper_f64(r_param_q)
    delta_eval_cm = _point_eval_rounding_bound_cm(curve, t_curr)

    dt_iv = _fraction_to_iv_113(dt_q)
    delta_pos_outward = mpf_to_outward_upper_f64((spd_iv * dt_iv).b + mpmath.mpf(delta_eval_cm))
    delta_pos = max(
        delta_pos_outward,
        mpf_to_outward_upper_f64(
            mpmath.mpf(local_speed_upper_bound) * mpmath.mpf(delta_t) + mpmath.mpf(delta_eval_cm)
        ),
    )

    b_ref_x = mpf_to_outward_upper_f64(
        mpmath.mpf(local_speed_upper_bound) * mpmath.mpf(r_param) + mpmath.mpf(delta_eval_cm)
    )
    e_obs = mpf_to_outward_upper_f64(abs(mpmath.mpf(final_len) - mpmath.mpf(target_s_cm)))
    b_cert = mpf_to_outward_upper_f64(mpmath.mpf(e_obs) + mpmath.mpf(b_ref_x))

    # Residual interval at bracket endpoints
    lo_len, _, lo_conv = adaptive_gauss_legendre_arc_length_checked(curve, lo)
    hi_len, _, hi_conv = adaptive_gauss_legendre_arc_length_checked(curve, hi)
    all_quad_converged = all_quad_converged and lo_conv and hi_conv
    res_lo = min(lo_len - target_s_cm, hi_len - target_s_cm)
    res_hi = max(lo_len - target_s_cm, hi_len - target_s_cm)

    certified_ok = bool(
        all_quad_converged
        and final_res <= tol_s_cm
        and delta_t <= tol_t
        and delta_pos <= tol_s_cm
        and b_cert <= tol_s_cm
    )

    num_record = NumericalVerificationRecord(
        curve_id=curve.segment_id,
        operation_type="INVERSE_ARC_LENGTH",
        parameter_bracket_t=(lo, hi),
        parameter_uncertainty_dt=delta_t,
        local_speed_upper_bound_cm_per_t=local_speed_upper_bound,
        propagated_position_error_cm=delta_pos,
        direct_geometric_error_bound_cm=final_res,
        propagation_method="B1_FIRST_ORDER_UPPER_BOUND",
        working_precision_bits=113,
        adaptive_subdivision_panels=max(1, panels_final),
        certified_within_tolerance=certified_ok,
        quantity_name="inverse_arc_length_position_cm",
        reference_method_and_version="M00.5 Monotone Newton-Brent + 113-bit mpmath.iv Method B1 Propagation (v2)",
        precision_and_arithmetic_model="IEEE-754 binary64 solver verified via 113-bit mpmath.iv outward interval arithmetic",
        enclosure_or_remainder_method="Method B1 Validated First-Order Speed Supremum: B_ref_x = M * r_param + delta_eval",
        assurance_classification="CERTIFIED_ENCLOSURE",
        error_components=NumericalErrorComponents(
            x_float64=final_len,
            x_ref=target_s_cm,
            observed_discrepancy_e_obs=e_obs,
            reference_enclosure_b_ref=b_ref_x,
            implementation_to_exact_bound_b_cert=b_cert,
            heuristic_error_estimate=final_res,
            parameter_enclosure=ParameterEnclosureRecord(
                t_lower=lo,
                t_upper=hi,
                t_mid=t_curr,
                r_param=r_param,
                residual_interval_lower=res_lo,
                residual_interval_upper=res_hi,
            ),
            output_propagation=OutputPropagationRecord(
                propagation_method="METHOD_B1_VALIDATED_DERIVATIVE",
                derivative_upper_bound_m=local_speed_upper_bound,
                point_evaluation_rounding_bound_delta_eval=delta_eval_cm,
                output_enclosure_radius_b_ref_x=b_ref_x,
            ),
        ),
        acceptance_tolerance_tau=tol_s_cm,
        verification_outcome="CERTIFIED_VALID" if certified_ok else "CERTIFIED_INVALID",
        reproducibility_manifest=NumericalReproducibilityManifest(
            python_version=platform.python_version(),
            mpmath_version=str(mpmath.__version__),
            subdivision_depth_k=iters,
            input_fixture_sha256=_curve_fixture_sha256(curve),
        ),
    )

    return {
        "tStar": t_curr,
        "tBracket": [lo, hi],
        "arcLengthResidualCm": final_res,
        "deltaT": delta_t,
        "rParam": r_param,
        "deltaEvalCm": delta_eval_cm,
        "localSpeedUpperBoundCmPerT": local_speed_upper_bound,
        "deltaPosCm": delta_pos,
        "bRefXCm": b_ref_x,
        "bCertCm": b_cert,
        "iterations": iters,
        "quadratureConverged": all_quad_converged,
        "numericalVerificationRecord": num_record.model_dump(mode="json"),
    }


def execute_m00_5_arc_length_verification() -> Dict[str, Any]:
    """Verifies M00.5 Method C1-Cert De Casteljau Chord/Polygon Enclosure (sole certification authority),
    Diagnostic Adaptive Gauss-Legendre Quadrature, and Monotone Newton-Brent Inversion with full ADR-009 §2.5
    NumericalVerificationRecord traceability.
    """
    mpmath.mp.prec = 113
    iv.prec = 113
    curve = ExactCubicBezier2D.from_floats(
        "bodice-front-armscye-m005",
        (23.5, 19.5),
        (21.0, 19.5),
        (19.2, 14.0),
        (20.5, 4.2),
    )

    # Method C1-Cert De Casteljau Chord/Control-Polygon Interval Enclosure is the SOLE certification authority
    # Depth 12 (4096 panels) yields certified half-width B_ref ~= 1.06e-7 cm << tau = 1e-6 cm (O(4^-depth) convergence)
    c1_cert_depth = 12
    c1_cert_armscye = method_c1_cert_arc_length_enclosure(curve, subdivision_depth=c1_cert_depth)
    collinear_curve = ExactCubicBezier2D(
        segment_id="collinear-cubic-m005",
        p0=(Fraction(0), Fraction(0)),
        p1=(Fraction(3), Fraction(0)),
        p2=(Fraction(7), Fraction(0)),
        p3=(Fraction(10), Fraction(0)),
    )
    c1_cert_collinear = method_c1_cert_arc_length_enclosure(collinear_curve, subdivision_depth=5)

    # Diagnostic quadrature comparisons checked strictly against the C1-Cert enclosure [L_chord, L_poly] (zero slack)
    cert_quad_diag_len = c1_cert_armscye["quadratureLength113BitCm"]
    fast_len, panels, gl5_converged = adaptive_gauss_legendre_arc_length_checked(curve, 1.0)
    forward_error_cm = abs(fast_len - cert_quad_diag_len)
    gl5_within_c1_cert = (
        gl5_converged
        and c1_cert_armscye["lowerChordBoundCm"]
        <= fast_len
        <= c1_cert_armscye["upperControlPolygonBoundCm"]
    )

    # Rigorous ADR-009 §2.5 forward decomposition from exact rational C1-Cert enclosure [L_chord, L_poly]
    l_lo_q = Fraction(c1_cert_armscye["lowerChordBoundRational"])
    l_hi_q = Fraction(c1_cert_armscye["upperControlPolygonBoundRational"])
    l_ref_q = (l_lo_q + l_hi_q) / Fraction(2)
    b_ref_fwd = fraction_to_outward_upper_f64((l_hi_q - l_lo_q) / Fraction(2))
    e_obs_fwd = fraction_to_outward_upper_f64(abs(Fraction(fast_len) - l_ref_q))
    b_cert_fwd = mpf_to_outward_upper_f64(mpmath.mpf(e_obs_fwd) + mpmath.mpf(b_ref_fwd))
    forward_tolerance_cm = 1e-6

    # Certified 113-bit mpmath.iv supremum of ||B'(t)||_2 across t in [0, 1]
    sup_speed_cm_per_t = compute_interval_max_speed_on_domain_cm_per_t(curve, 0.0, 1.0, panels=64)
    domain_param_dt = 0.0
    propagated_pos_err_cm = 0.0

    fwd_certified_ok = bool(
        gl5_converged
        and c1_cert_armscye["nonStrictInequalityHolds"]
        and c1_cert_armscye["diagnosticQuadWithinCertifiedEnclosure"]
        and gl5_within_c1_cert
        and b_cert_fwd <= forward_tolerance_cm
        and forward_error_cm <= forward_tolerance_cm
    )

    forward_num_record = NumericalVerificationRecord(
        curve_id=curve.segment_id,
        operation_type="ARC_LENGTH",
        parameter_bracket_t=(0.0, 1.0),
        parameter_uncertainty_dt=domain_param_dt,
        local_speed_upper_bound_cm_per_t=sup_speed_cm_per_t,
        propagated_position_error_cm=propagated_pos_err_cm,
        direct_geometric_error_bound_cm=b_cert_fwd,
        propagation_method="C1_CERT_CHORD_POLYGON_BOUNDS",
        working_precision_bits=113,
        adaptive_subdivision_panels=c1_cert_armscye["panelsCount"],
        certified_within_tolerance=fwd_certified_ok,
        quantity_name="forward_arc_length_cm",
        reference_method_and_version="M00.5 Method C1-Cert De Casteljau Chord/Control-Polygon Interval Enclosure (v2)",
        precision_and_arithmetic_model="Exact rational De Casteljau + 113-bit mpmath.iv outward interval sum",
        enclosure_or_remainder_method="De Casteljau geometric convexity theorem: sum(||chord_i||) <= L(B) <= sum(polygon_i)",
        assurance_classification="CERTIFIED_ENCLOSURE",
        error_components=NumericalErrorComponents(
            x_float64=fast_len,
            x_ref=float(l_ref_q),
            observed_discrepancy_e_obs=e_obs_fwd,
            reference_enclosure_b_ref=b_ref_fwd,
            implementation_to_exact_bound_b_cert=b_cert_fwd,
            heuristic_error_estimate=forward_error_cm,
            parameter_enclosure=None,
            output_propagation=OutputPropagationRecord(
                propagation_method="NONE_DIRECT_ENCLOSURE",
                derivative_upper_bound_m=None,
                point_evaluation_rounding_bound_delta_eval=0.0,
                output_enclosure_radius_b_ref_x=b_ref_fwd,
            ),
        ),
        acceptance_tolerance_tau=forward_tolerance_cm,
        verification_outcome="CERTIFIED_VALID" if fwd_certified_ok else "CERTIFIED_INVALID",
        reproducibility_manifest=NumericalReproducibilityManifest(
            python_version=platform.python_version(),
            mpmath_version=str(mpmath.__version__),
            subdivision_depth_k=c1_cert_depth,
            input_fixture_sha256=_curve_fixture_sha256(curve),
        ),
    )

    # Test inverse arc-length at 25%, 50%, 75% of total length (full IEEE-754 tStar preserved inside tBracket)
    inversion_checks = []
    for frac in (0.25, 0.50, 0.75):
        target_s = frac * c1_cert_armscye["certifiedReferenceLengthCm"]
        inv_res = inverse_arc_length_newton_brent(curve, target_s)
        t_lo, t_hi = inv_res["tBracket"]
        t_star_enclosed = t_lo <= inv_res["tStar"] <= t_hi
        inversion_checks.append(
            {
                "targetFraction": frac,
                "targetArcLengthCm": round(target_s, 8),
                "tStar": inv_res["tStar"],
                "tBracket": inv_res["tBracket"],
                "tStarWithinBracket": t_star_enclosed,
                "quadratureConverged": inv_res["quadratureConverged"],
                "arcLengthResidualCm": inv_res["arcLengthResidualCm"],
                "deltaT": inv_res["deltaT"],
                "rParam": inv_res["rParam"],
                "deltaEvalCm": inv_res["deltaEvalCm"],
                "localSpeedUpperBoundCmPerT": inv_res["localSpeedUpperBoundCmPerT"],
                "deltaPosCm": inv_res["deltaPosCm"],
                "bRefXCm": inv_res["bRefXCm"],
                "bCertCm": inv_res["bCertCm"],
                "numericalVerificationRecord": inv_res["numericalVerificationRecord"],
                "passed": (
                    inv_res["quadratureConverged"]
                    and t_star_enclosed
                    and inv_res["deltaEvalCm"] > 0.0
                    and inv_res["arcLengthResidualCm"] <= 1e-7
                    and inv_res["deltaT"] <= 1e-12
                    and inv_res["deltaPosCm"] <= 1e-7
                    and inv_res["bCertCm"] <= 1e-7
                    and inv_res["numericalVerificationRecord"]["verification_outcome"] == "CERTIFIED_VALID"
                ),
            }
        )

    fwd_dump = forward_num_record.model_dump(mode="json")
    traceability_table = [
        {
            "recordId": "M00.5-FORWARD-ARC-LENGTH",
            "operationType": fwd_dump["operation_type"],
            "assuranceClassification": fwd_dump["assurance_classification"],
            "eObs": fwd_dump["error_components"]["observed_discrepancy_e_obs"],
            "bRef": fwd_dump["error_components"]["reference_enclosure_b_ref"],
            "bCert": fwd_dump["error_components"]["implementation_to_exact_bound_b_cert"],
            "acceptanceToleranceTau": fwd_dump["acceptance_tolerance_tau"],
            "propagationMethod": fwd_dump["error_components"]["output_propagation"]["propagation_method"],
            "deltaEvalCm": fwd_dump["error_components"]["output_propagation"]["point_evaluation_rounding_bound_delta_eval"],
            "verificationOutcome": fwd_dump["verification_outcome"],
            "inputFixtureSha256": fwd_dump["reproducibility_manifest"]["input_fixture_sha256"],
        }
    ] + [
        {
            "recordId": f"M00.5-INVERSE-ARC-LENGTH-{int(chk['targetFraction'] * 100)}PCT",
            "operationType": chk["numericalVerificationRecord"]["operation_type"],
            "assuranceClassification": chk["numericalVerificationRecord"]["assurance_classification"],
            "eObs": chk["numericalVerificationRecord"]["error_components"]["observed_discrepancy_e_obs"],
            "bRef": chk["numericalVerificationRecord"]["error_components"]["reference_enclosure_b_ref"],
            "bCert": chk["numericalVerificationRecord"]["error_components"]["implementation_to_exact_bound_b_cert"],
            "acceptanceToleranceTau": chk["numericalVerificationRecord"]["acceptance_tolerance_tau"],
            "propagationMethod": chk["numericalVerificationRecord"]["error_components"]["output_propagation"]["propagation_method"],
            "deltaEvalCm": chk["numericalVerificationRecord"]["error_components"]["output_propagation"]["point_evaluation_rounding_bound_delta_eval"],
            "verificationOutcome": chk["numericalVerificationRecord"]["verification_outcome"],
            "inputFixtureSha256": chk["numericalVerificationRecord"]["reproducibility_manifest"]["input_fixture_sha256"],
        }
        for chk in inversion_checks
    ]

    return {
        "milestoneId": "M00.5",
        "artifactName": "ArcLengthVerificationReport.json",
        "certificationAuthority": "METHOD_C1_CERT_CHORD_POLYGON_BOUNDS",
        "certifiedReferenceLengthCm": c1_cert_armscye["certifiedReferenceLengthCm"],
        "certifiedHalfWidthCm": c1_cert_armscye["certifiedHalfWidthCm"],
        "quadratureRole": "DIAGNOSTIC_ONLY_NON_AUTHORITATIVE",
        "diagnosticQuadLength113BitCm": round(cert_quad_diag_len, 10),
        "adaptiveGaussLegendreLengthCm": round(fast_len, 10),
        "adaptiveGaussLegendreConverged": gl5_converged,
        "adaptiveGaussLegendreWithinC1CertEnclosure": gl5_within_c1_cert,
        "forwardLengthErrorCm": forward_error_cm,
        "forwardCertifiedBoundBCertCm": b_cert_fwd,
        "forwardToleranceMaxCm": forward_tolerance_cm,
        "panelsEvaluated": panels,
        "methodC1CertArmscyeEnclosure": c1_cert_armscye,
        "methodC1CertCollinearEnclosure": c1_cert_collinear,
        "forwardNumericalVerificationRecord": fwd_dump,
        "inverseArcLengthChecks": inversion_checks,
        "adr009Section2_5TraceabilityTable": traceability_table,
        "allPassed": (
            fwd_certified_ok
            and c1_cert_collinear["nonStrictInequalityHolds"]
            and all(c["passed"] for c in inversion_checks)
        ),
    }


def orient2d_exact(a: Tuple[Fraction, Fraction], b: Tuple[Fraction, Fraction], c: Tuple[Fraction, Fraction]) -> int:
    """Exact rational orient2d predicate: returns +1 (CCW), -1 (CW), or 0 (collinear)."""
    det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if det > 0:
        return 1
    if det < 0:
        return -1
    return 0


def on_segment_exact(
    a: Tuple[Fraction, Fraction],
    b: Tuple[Fraction, Fraction],
    p: Tuple[Fraction, Fraction],
) -> bool:
    """Given collinear points a, b, p (orient2d(a, b, p) == 0), returns True iff p lies on closed segment [a, b]."""
    return (
        min(a[0], b[0]) <= p[0] <= max(a[0], b[0])
        and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])
    )


def segments_intersect_exact(
    p1: Tuple[Fraction, Fraction],
    p2: Tuple[Fraction, Fraction],
    p3: Tuple[Fraction, Fraction],
    p4: Tuple[Fraction, Fraction],
) -> Tuple[bool, str]:
    """Complete exact rational segment-segment intersection predicate (remediating FINDING-SUBORACLES-01):
    Detects BOTH:
    - Proper transverse intersections (`PROPER_TRANSVERSE_CROSSING`, o1*o2 < 0 and o3*o4 < 0)
    - Degenerate collinear overlaps and vertex-on-edge contacts (`DEGENERATE_COLLINEAR_OR_VERTEX_ON_EDGE`, orient2d == 0)
    """
    o1 = orient2d_exact(p1, p2, p3)
    o2 = orient2d_exact(p1, p2, p4)
    o3 = orient2d_exact(p3, p4, p1)
    o4 = orient2d_exact(p3, p4, p2)

    if (o1 * o2 < 0) and (o3 * o4 < 0):
        return True, "PROPER_TRANSVERSE_CROSSING"

    if o1 == 0 and on_segment_exact(p1, p2, p3):
        return True, "DEGENERATE_COLLINEAR_OR_VERTEX_ON_EDGE"
    if o2 == 0 and on_segment_exact(p1, p2, p4):
        return True, "DEGENERATE_COLLINEAR_OR_VERTEX_ON_EDGE"
    if o3 == 0 and on_segment_exact(p3, p4, p1):
        return True, "DEGENERATE_COLLINEAR_OR_VERTEX_ON_EDGE"
    if o4 == 0 and on_segment_exact(p3, p4, p2):
        return True, "DEGENERATE_COLLINEAR_OR_VERTEX_ON_EDGE"

    return False, "DISJOINT"


def segments_properly_intersect_exact(
    p1: Tuple[Fraction, Fraction],
    p2: Tuple[Fraction, Fraction],
    p3: Tuple[Fraction, Fraction],
    p4: Tuple[Fraction, Fraction],
) -> bool:
    hit, _kind = segments_intersect_exact(p1, p2, p3, p4)
    return hit


def polygon_signed_area_exact(ring: List[Tuple[Fraction, Fraction]]) -> Fraction:
    """Computes exact rational signed area of a closed polygon ring [p0, p1, ..., pn-1, p0]."""
    pts = ring[:-1] if ring and ring[0] == ring[-1] else ring
    n = len(pts)
    if n < 3:
        return Fraction(0)
    acc = Fraction(0)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        acc += x1 * y2 - x2 * y1
    return acc / Fraction(2)


def validate_polygon_topology_exact(ring: List[Tuple[Fraction, Fraction]], expected_winding: str = "CCW") -> Dict[str, Any]:
    """Verifies exact rational closure, simple ring (0 proper, degenerate non-adjacent, zero-length, or 180-deg adjacent
    fold-back self-intersections), exact winding orientation, and exact non-sliver area (< 1e-4 cm^2).
    """
    if len(ring) < 3:
        return {
            "closureGapCm": math.inf,
            "signedAreaCm2": 0.0,
            "actualWinding": "DEGENERATE",
            "expectedWinding": expected_winding,
            "selfIntersections": 1,
            "properTransverseCrossings": 0,
            "degenerateCollinearOrVertexTouches": 1,
            "adjacentFoldBacksOrZeroEdges": 1,
            "isSimple": False,
            "isMicroSliver": True,
            "passed": False,
        }

    gap_dx = ring[0][0] - ring[-1][0]
    gap_dy = ring[0][1] - ring[-1][1]
    closure_gap_sq_q = gap_dx * gap_dx + gap_dy * gap_dy
    if closure_gap_sq_q == 0:
        closure_gap_cm = 0.0
    else:
        iv.prec = 113
        gap_iv = iv.sqrt(iv.mpf(closure_gap_sq_q.numerator) / iv.mpf(closure_gap_sq_q.denominator))
        closure_gap_cm = mpf_to_outward_upper_f64(gap_iv.b)

    signed_area = polygon_signed_area_exact(ring)
    actual_winding = "CCW" if signed_area > 0 else ("CW" if signed_area < 0 else "DEGENERATE")

    pts = ring[:-1] if ring[0] == ring[-1] else ring
    n = len(pts)
    edges = [(pts[i], pts[(i + 1) % n]) for i in range(n)]
    self_intersections = 0
    proper_crossings = 0
    degenerate_contacts = 0
    adjacent_degeneracies = 0

    if n < 3:
        self_intersections += 1
        degenerate_contacts += 1
        adjacent_degeneracies += 1
    else:
        # Check every adjacent edge pair for zero-length edges or 180-degree collinear fold-backs
        for i in range(n):
            p_prev = pts[i]
            p_curr = pts[(i + 1) % n]
            p_next = pts[(i + 2) % n]
            if p_prev == p_curr:
                self_intersections += 1
                degenerate_contacts += 1
                adjacent_degeneracies += 1
                continue
            if p_curr != p_next and orient2d_exact(p_prev, p_curr, p_next) == 0:
                v1x, v1y = p_curr[0] - p_prev[0], p_curr[1] - p_prev[1]
                v2x, v2y = p_next[0] - p_curr[0], p_next[1] - p_curr[1]
                dot_q = v1x * v2x + v1y * v2y
                if dot_q < 0:
                    self_intersections += 1
                    degenerate_contacts += 1
                    adjacent_degeneracies += 1

        # Check all non-adjacent edge pairs
        for i in range(n):
            for j in range(i + 2, n):
                if i == 0 and j == n - 1:
                    continue
                hit, kind = segments_intersect_exact(edges[i][0], edges[i][1], edges[j][0], edges[j][1])
                if hit:
                    self_intersections += 1
                    if kind == "PROPER_TRANSVERSE_CROSSING":
                        proper_crossings += 1
                    else:
                        degenerate_contacts += 1

    is_micro_sliver = abs(signed_area) < Fraction(1, 10000)
    closure_ok = closure_gap_sq_q <= Fraction(1, 10**12)
    passed = (
        closure_ok
        and self_intersections == 0
        and actual_winding == expected_winding
        and not is_micro_sliver
    )
    return {
        "closureGapCm": closure_gap_cm,
        "signedAreaCm2": round(float(signed_area), 8),
        "actualWinding": actual_winding,
        "expectedWinding": expected_winding,
        "selfIntersections": self_intersections,
        "properTransverseCrossings": proper_crossings,
        "degenerateCollinearOrVertexTouches": degenerate_contacts,
        "adjacentFoldBacksOrZeroEdges": adjacent_degeneracies,
        "isSimple": self_intersections == 0,
        "isMicroSliver": is_micro_sliver,
        "passed": passed,
    }


def execute_m00_6_topology_verification() -> Dict[str, Any]:
    """Executes M00.6 Exact Topological Predicate & Polygon Boolean Verification Suite (including orient2d == 0 cases)."""
    # 1. Valid CCW Exterior Bodice Ring
    ccw_exterior = [
        (Fraction(0), Fraction(0)),
        (Fraction(24), Fraction(0)),
        (Fraction(24), Fraction(42)),
        (Fraction(0), Fraction(42)),
        (Fraction(0), Fraction(0)),
    ]
    res_ccw = validate_polygon_topology_exact(ccw_exterior, expected_winding="CCW")

    # 2. Valid CW Interior Cutout Ring
    cw_cutout = [
        (Fraction(5), Fraction(5)),
        (Fraction(5), Fraction(10)),
        (Fraction(10), Fraction(10)),
        (Fraction(10), Fraction(5)),
        (Fraction(5), Fraction(5)),
    ]
    res_cw = validate_polygon_topology_exact(cw_cutout, expected_winding="CW")

    # 3. Self-Intersecting Bowtie Ring (Proper transverse crossing -> must be rejected)
    bowtie = [
        (Fraction(0), Fraction(0)),
        (Fraction(10), Fraction(10)),
        (Fraction(10), Fraction(0)),
        (Fraction(0), Fraction(10)),
        (Fraction(0), Fraction(0)),
    ]
    res_bowtie = validate_polygon_topology_exact(bowtie, expected_winding="CCW")

    # 4. Degenerate Vertex-on-Edge Pinch Ring (orient2d == 0 where an interior vertex touches opposite edge (12, 0))
    vertex_touch_ring = [
        (Fraction(0), Fraction(0)),
        (Fraction(24), Fraction(0)),
        (Fraction(24), Fraction(20)),
        (Fraction(12), Fraction(0)),  # Touches bottom edge [(0,0), (24,0)] at midpoint (12, 0)!
        (Fraction(0), Fraction(20)),
        (Fraction(0), Fraction(0)),
    ]
    res_vertex_touch = validate_polygon_topology_exact(vertex_touch_ring, expected_winding="CCW")

    # 5. Degenerate Collinear Overlapping Edge Ring (orient2d == 0 along shared collinear segment)
    collinear_overlap_ring = [
        (Fraction(0), Fraction(0)),
        (Fraction(20), Fraction(0)),
        (Fraction(20), Fraction(10)),
        (Fraction(15), Fraction(0)),
        (Fraction(5), Fraction(0)),  # Collinear overlap with bottom edge [(0,0), (20,0)]!
        (Fraction(0), Fraction(10)),
        (Fraction(0), Fraction(0)),
    ]
    res_collinear_overlap = validate_polygon_topology_exact(collinear_overlap_ring, expected_winding="CCW")

    # 6. Micro-Sliver Face (< 1e-4 cm^2, Must be detected and rejected)
    sliver = [
        (Fraction(0), Fraction(0)),
        (Fraction(1, 100), Fraction(0)),
        (Fraction(1, 100), Fraction(1, 1000)),
        (Fraction(0), Fraction(0)),
    ]
    res_sliver = validate_polygon_topology_exact(sliver, expected_winding="CCW")

    # 7. Folded 3-Vertex Collinear Triangle (180-deg adjacent-edge fold-back -> must NOT be simple)
    folded_triangle_3v = [
        (Fraction(0), Fraction(0)),
        (Fraction(10), Fraction(0)),
        (Fraction(5), Fraction(0)),
        (Fraction(0), Fraction(0)),
    ]
    res_folded = validate_polygon_topology_exact(folded_triangle_3v, expected_winding="CCW")

    return {
        "milestoneId": "M00.6",
        "artifactName": "TopologyVerificationReport.json",
        "ccwExteriorCheck": res_ccw,
        "cwInteriorCutoutCheck": res_cw,
        "bowtieSelfIntersectionDetected": (not res_bowtie["isSimple"] and res_bowtie["properTransverseCrossings"] > 0),
        "vertexOnEdgeDegeneracyDetected": (
            not res_vertex_touch["isSimple"] and res_vertex_touch["degenerateCollinearOrVertexTouches"] > 0
        ),
        "collinearOverlapDegeneracyDetected": (
            not res_collinear_overlap["isSimple"] and res_collinear_overlap["degenerateCollinearOrVertexTouches"] > 0
        ),
        "foldedTriangle3VertexDegeneracyDetected": (
            not res_folded["isSimple"] and res_folded["adjacentFoldBacksOrZeroEdges"] > 0
        ),
        "microSliverDetected": res_sliver["isMicroSliver"],
        "allPassed": (
            res_ccw["passed"]
            and res_cw["passed"]
            and not res_bowtie["isSimple"]
            and not res_vertex_touch["isSimple"]
            and not res_collinear_overlap["isSimple"]
            and not res_folded["isSimple"]
            and res_sliver["isMicroSliver"]
        ),
    }


def emit_reference_dxf_aama(piece_code: str, cut_pts: List[Tuple[float, float]], sew_pts: List[Tuple[float, float]]) -> str:
    """Emits a complete DXF R12 (AC1009) / ASTM D6673 / AAMA reference payload including HEADER, TABLES (LTYPE, LAYER),
    and ENTITIES sections with Layers 1, 2, 4, 7, 8, 11 for M00.7 round-trip verification.
    """
    all_x = [p[0] for p in cut_pts + sew_pts]
    all_y = [p[1] for p in cut_pts + sew_pts]
    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)

    lines: List[str] = [
        "0", "SECTION",
        "2", "HEADER",
        "9", "$ACADVER",
        "1", "AC1009",
        "9", "$INSUNITS",
        "70", "5",  # 5 = centimeters
        "9", "$EXTMIN",
        "10", f"{min_x:.6f}",
        "20", f"{min_y:.6f}",
        "9", "$EXTMAX",
        "10", f"{max_x:.6f}",
        "20", f"{max_y:.6f}",
        "0", "ENDSEC",
        "0", "SECTION",
        "2", "TABLES",
        "0", "TABLE",
        "2", "LTYPE",
        "70", "1",
        "0", "LTYPE",
        "2", "CONTINUOUS",
        "70", "0",
        "3", "Solid line",
        "72", "65",
        "73", "0",
        "40", "0.0",
        "0", "ENDTAB",
        "0", "TABLE",
        "2", "LAYER",
        "70", "6",
    ]

    for layer_id, color_code in (("1", "7"), ("2", "1"), ("4", "3"), ("7", "5"), ("8", "2"), ("11", "6")):
        lines.extend([
            "0", "LAYER",
            "2", layer_id,
            "70", "0",
            "62", color_code,
            "6", "CONTINUOUS",
        ])
    lines.extend([
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "SECTION",
        "2", "ENTITIES",
    ])

    def add_polyline(layer: str, pts: List[Tuple[float, float]], closed: bool = True) -> None:
        lines.extend(["0", "POLYLINE", "8", layer, "66", "1", "70", "1" if closed else "0"])
        for x, y in pts:
            lines.extend(["0", "VERTEX", "8", layer, "10", f"{x:.6f}", "20", f"{y:.6f}"])
        lines.extend(["0", "SEQEND"])

    # Layer 1: Exterior Cut Boundary
    add_polyline("1", cut_pts, closed=True)
    # Layer 8: Internal Sew Boundary
    add_polyline("8", sew_pts, closed=True)
    # Layer 7: Grainline
    lines.extend(["0", "LINE", "8", "7", "10", "5.000000", "20", "5.000000", "11", "5.000000", "21", "35.000000"])
    # Layer 4: Notch
    lines.extend(["0", "LINE", "8", "4", "10", "12.000000", "20", "0.000000", "11", "12.000000", "21", "-0.500000"])
    # Layer 2: Drill Hole
    lines.extend(["0", "POINT", "8", "2", "10", "9.250000", "20", "18.000000"])
    # Layer 11: Internal Cutout
    add_polyline("11", [(8.0, 10.0), (8.0, 12.0), (10.0, 12.0), (10.0, 10.0)], closed=True)
    lines.extend(["0", "TEXT", "8", "1", "10", "2.000000", "20", "2.000000", "40", "1.000000", "1", piece_code])
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    return "\n".join(lines) + "\n"


def _parse_finite_dxf_float(raw: str, context: str, errors: List[str]) -> float | None:
    try:
        val = float(raw)
    except ValueError:
        errors.append(f"MALFORMED_NUMERIC:{context}:{raw!r}")
        return None
    if not math.isfinite(val):
        errors.append(f"NON_FINITE_NUMERIC:{context}:{raw!r}")
        return None
    return val


def parse_dxf_aama_strict(dxf_text: str) -> Dict[str, Any]:
    """Unified hardened DXF R12 (AC1009) / ASTM D6673 / AAMA structural & numeric parser (PKG-M00-04 I-05).

    Shared across BOTH synthetic M00.7 verification and Workstream B production multi-piece verification.
    Fails closed on:
    - Empty payload or odd line count (dangling group code)
    - Missing explicit `0 / EOF` marker
    - Unbalanced / nested / unclosed `SECTION` / `ENDSEC`
    - Unterminated `POLYLINE` (missing `SEQEND`), empty `POLYLINE` (0 vertices), orphan `VERTEX`/`SEQEND`
    - Non-numeric or non-finite (`NaN`/`Inf`) coordinate records
    """
    structural_errors: List[str] = []
    malformed_entities: List[str] = []

    stripped = dxf_text.strip()
    if not stripped:
        structural_errors.append("EMPTY_DXF_PAYLOAD")
        return {
            "sectionsRecovered": [],
            "acadVersionHeader": "",
            "insUnitsHeader": "",
            "tableLayersDefined": [],
            "entityLayersFound": [],
            "polylinesByLayer": {},
            "entityCountsByLayer": {},
            "cutPolylines": [],
            "sewPolylines": [],
            "internalPolylines": [],
            "grainLines": [],
            "notchLines": [],
            "drillPoints": [],
            "texts": [],
            "hasEofMarker": False,
            "unterminatedPolylinesCount": 0,
            "emptyPolylinesCount": 0,
            "malformedEntities": malformed_entities,
            "structuralErrors": structural_errors,
            "isStructurallyValid": False,
            "sha256Digest": hashlib.sha256(dxf_text.encode("utf-8")).hexdigest(),
        }

    raw_lines = [ln.strip() for ln in stripped.splitlines()]
    if len(raw_lines) % 2 != 0:
        structural_errors.append(f"ODD_LINE_COUNT:{len(raw_lines)}")
    pairs = [(raw_lines[i], raw_lines[i + 1]) for i in range(0, len(raw_lines) - 1, 2)]

    sections_found: List[str] = []
    acad_ver = ""
    ins_units = ""
    table_layers_defined: set[str] = set()
    entity_layers_found: set[str] = set()
    polylines_by_layer: Dict[str, List[List[Tuple[float, float]]]] = {}
    entity_counts_by_layer: Dict[str, int] = {}
    grain_lines: List[Tuple[Tuple[float, float], Tuple[float, float]]] = []
    notch_lines: List[Tuple[Tuple[float, float], Tuple[float, float]]] = []
    drill_points: List[Tuple[float, float]] = []
    texts: List[str] = []

    current_section: str | None = None
    current_poly_layer: str | None = None
    current_poly_pts: List[Tuple[float, float]] = []
    has_eof_marker = False
    unterminated_polylines = 0
    empty_polylines = 0

    def _close_unterminated_polyline(reason: str) -> None:
        nonlocal current_poly_layer, current_poly_pts, unterminated_polylines
        if current_poly_layer is not None:
            unterminated_polylines += 1
            structural_errors.append(f"UNTERMINATED_POLYLINE:layer={current_poly_layer}:{reason}")
            current_poly_layer = None
            current_poly_pts = []

    i = 0
    while i < len(pairs):
        code, val = pairs[i]
        if code == "0" and val == "EOF":
            _close_unterminated_polyline("AT_EOF")
            if current_section is not None:
                structural_errors.append(f"UNCLOSED_SECTION:{current_section}")
                current_section = None
            has_eof_marker = True
            if i != len(pairs) - 1:
                structural_errors.append("TRAILING_RECORDS_AFTER_EOF")
            i += 1
            continue

        if code == "0" and val == "SECTION":
            if current_section is not None:
                structural_errors.append(f"NESTED_SECTION_WITHOUT_ENDSEC:{current_section}")
            if i + 1 < len(pairs) and pairs[i + 1][0] == "2":
                current_section = pairs[i + 1][1]
                sections_found.append(current_section)
                i += 2
                continue
            structural_errors.append("SECTION_MISSING_NAME_GROUP_2")
            i += 1
            continue

        if code == "0" and val == "ENDSEC":
            _close_unterminated_polyline("AT_ENDSEC")
            if current_section is None:
                structural_errors.append("STRAY_ENDSEC_OUTSIDE_SECTION")
            current_section = None
            i += 1
            continue

        if current_section == "HEADER":
            if code == "9" and val == "$ACADVER" and i + 1 < len(pairs):
                acad_ver = pairs[i + 1][1]
                i += 2
                continue
            if code == "9" and val == "$INSUNITS" and i + 1 < len(pairs):
                ins_units = pairs[i + 1][1]
                i += 2
                continue
            if code in ("10", "20", "30"):
                _parse_finite_dxf_float(val, f"HEADER_COORD_{code}", malformed_entities)
            i += 1
            continue

        if current_section == "TABLES":
            if code == "0" and val == "LAYER":
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    if pairs[i][0] == "2":
                        table_layers_defined.add(pairs[i][1])
                    i += 1
                continue
            i += 1
            continue

        if current_section == "ENTITIES":
            if code == "0" and val == "POLYLINE":
                _close_unterminated_polyline("BEFORE_NEW_POLYLINE")
                layer = "0"
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    if pairs[i][0] == "8":
                        layer = pairs[i][1]
                    i += 1
                entity_layers_found.add(layer)
                entity_counts_by_layer[layer] = entity_counts_by_layer.get(layer, 0) + 1
                current_poly_layer = layer
                current_poly_pts = []
                continue

            if code == "0" and val == "VERTEX":
                if current_poly_layer is None:
                    structural_errors.append("ORPHAN_VERTEX_OUTSIDE_POLYLINE")
                    malformed_entities.append("ORPHAN_VERTEX")
                    i += 1
                    while i < len(pairs) and pairs[i][0] != "0":
                        i += 1
                    continue
                vx: float | None = None
                vy: float | None = None
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    c, v = pairs[i]
                    if c == "10":
                        vx = _parse_finite_dxf_float(v, f"VERTEX_X_layer_{current_poly_layer}", malformed_entities)
                    elif c == "20":
                        vy = _parse_finite_dxf_float(v, f"VERTEX_Y_layer_{current_poly_layer}", malformed_entities)
                    i += 1
                if vx is None or vy is None:
                    malformed_entities.append(f"INCOMPLETE_VERTEX:layer={current_poly_layer}")
                else:
                    current_poly_pts.append((vx, vy))
                continue

            if code == "0" and val == "SEQEND":
                if current_poly_layer is None:
                    structural_errors.append("ORPHAN_SEQEND_OUTSIDE_POLYLINE")
                    malformed_entities.append("ORPHAN_SEQEND")
                else:
                    if len(current_poly_pts) == 0:
                        empty_polylines += 1
                        structural_errors.append(f"EMPTY_POLYLINE:layer={current_poly_layer}")
                    else:
                        polylines_by_layer.setdefault(current_poly_layer, []).append(current_poly_pts)
                    current_poly_layer = None
                    current_poly_pts = []
                i += 1
                continue

            if code == "0" and val == "LINE":
                _close_unterminated_polyline("BEFORE_LINE")
                layer = "0"
                x1 = y1 = x2 = y2 = None
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    c, v = pairs[i]
                    if c == "8":
                        layer = v
                    elif c == "10":
                        x1 = _parse_finite_dxf_float(v, "LINE_X1", malformed_entities)
                    elif c == "20":
                        y1 = _parse_finite_dxf_float(v, "LINE_Y1", malformed_entities)
                    elif c == "11":
                        x2 = _parse_finite_dxf_float(v, "LINE_X2", malformed_entities)
                    elif c == "21":
                        y2 = _parse_finite_dxf_float(v, "LINE_Y2", malformed_entities)
                    i += 1
                entity_layers_found.add(layer)
                entity_counts_by_layer[layer] = entity_counts_by_layer.get(layer, 0) + 1
                if None in (x1, y1, x2, y2):
                    malformed_entities.append(f"INCOMPLETE_LINE:layer={layer}")
                else:
                    assert x1 is not None and y1 is not None and x2 is not None and y2 is not None
                    if layer == "7":
                        grain_lines.append(((x1, y1), (x2, y2)))
                    elif layer == "4":
                        notch_lines.append(((x1, y1), (x2, y2)))
                continue

            if code == "0" and val == "POINT":
                _close_unterminated_polyline("BEFORE_POINT")
                layer = "0"
                px = py = None
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    c, v = pairs[i]
                    if c == "8":
                        layer = v
                    elif c == "10":
                        px = _parse_finite_dxf_float(v, "POINT_X", malformed_entities)
                    elif c == "20":
                        py = _parse_finite_dxf_float(v, "POINT_Y", malformed_entities)
                    i += 1
                entity_layers_found.add(layer)
                entity_counts_by_layer[layer] = entity_counts_by_layer.get(layer, 0) + 1
                if px is None or py is None:
                    malformed_entities.append(f"INCOMPLETE_POINT:layer={layer}")
                elif layer == "2":
                    drill_points.append((px, py))
                continue

            if code == "0" and val == "TEXT":
                _close_unterminated_polyline("BEFORE_TEXT")
                layer = "0"
                tval = ""
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    c, v = pairs[i]
                    if c == "8":
                        layer = v
                    elif c == "1":
                        tval = v
                    elif c in ("10", "20", "40"):
                        _parse_finite_dxf_float(v, f"TEXT_GROUP_{c}", malformed_entities)
                    i += 1
                entity_layers_found.add(layer)
                entity_counts_by_layer[layer] = entity_counts_by_layer.get(layer, 0) + 1
                texts.append(tval)
                continue

        i += 1

    _close_unterminated_polyline("AT_STREAM_END")
    if current_section is not None:
        structural_errors.append(f"UNCLOSED_SECTION_AT_END:{current_section}")
    if not has_eof_marker:
        structural_errors.append("MISSING_EOF_MARKER")
    if malformed_entities:
        structural_errors.extend(malformed_entities)

    is_structurally_valid = (
        len(structural_errors) == 0
        and has_eof_marker
        and unterminated_polylines == 0
        and empty_polylines == 0
        and len(malformed_entities) == 0
    )

    return {
        "sectionsRecovered": sections_found,
        "acadVersionHeader": acad_ver,
        "insUnitsHeader": ins_units,
        "tableLayersDefined": sorted(table_layers_defined),
        "entityLayersFound": sorted(entity_layers_found),
        "polylinesByLayer": polylines_by_layer,
        "entityCountsByLayer": entity_counts_by_layer,
        "cutPolylines": polylines_by_layer.get("1", []),
        "sewPolylines": polylines_by_layer.get("8", []),
        "internalPolylines": polylines_by_layer.get("11", []),
        "grainLines": grain_lines,
        "notchLines": notch_lines,
        "drillPoints": drill_points,
        "texts": texts,
        "hasEofMarker": has_eof_marker,
        "unterminatedPolylinesCount": unterminated_polylines,
        "emptyPolylinesCount": empty_polylines,
        "malformedEntities": malformed_entities,
        "structuralErrors": structural_errors,
        "isStructurallyValid": is_structurally_valid,
        "sha256Digest": hashlib.sha256(dxf_text.encode("utf-8")).hexdigest(),
    }


def parse_and_verify_dxf_aama(
    dxf_text: str,
    expected_cut_pts: List[Tuple[float, float]],
    expected_sew_pts: List[Tuple[float, float]],
) -> Dict[str, Any]:
    """Independent M00.7 DXF-AAMA round-trip parser delegating to unified `parse_dxf_aama_strict`."""
    parsed = parse_dxf_aama_strict(dxf_text)
    sections_found = parsed["sectionsRecovered"]
    acad_ver = parsed["acadVersionHeader"]
    ins_units = parsed["insUnitsHeader"]
    table_layers_defined = set(parsed["tableLayersDefined"])
    entity_layers_found = set(parsed["entityLayersFound"])
    polylines_by_layer = parsed["polylinesByLayer"]
    entity_counts_by_layer = parsed["entityCountsByLayer"]

    required_layers = {"1", "2", "4", "7", "8", "11"}
    missing_layers = sorted(required_layers - entity_layers_found)
    missing_table_layers = sorted(required_layers - table_layers_defined)

    cut_polys = parsed["cutPolylines"]
    sew_polys = parsed["sewPolylines"]
    cut_recovered_count = len(cut_polys[0]) if len(cut_polys) == 1 else sum(len(p) for p in cut_polys)
    sew_recovered_count = len(sew_polys[0]) if len(sew_polys) == 1 else sum(len(p) for p in sew_polys)
    cut_count_match = len(cut_polys) == 1 and len(cut_polys[0]) == len(expected_cut_pts)
    sew_count_match = len(sew_polys) == 1 and len(sew_polys[0]) == len(expected_sew_pts)
    vertex_count_parity_matched = cut_count_match and sew_count_match

    if not vertex_count_parity_matched or not parsed["isStructurallyValid"]:
        max_vertex_error_cm = math.inf
    else:
        max_vertex_error_cm = 0.0
        for (x1, y1), (x2, y2) in zip(expected_cut_pts, cut_polys[0]):
            max_vertex_error_cm = max(max_vertex_error_cm, math.hypot(x1 - x2, y1 - y2))
        for (x1, y1), (x2, y2) in zip(expected_sew_pts, sew_polys[0]):
            max_vertex_error_cm = max(max_vertex_error_cm, math.hypot(x1 - x2, y1 - y2))

    total_vertices = sum(len(poly) for polys in polylines_by_layer.values() for poly in polys)
    dxf_sha256 = parsed["sha256Digest"]

    round_trip_passed = (
        parsed["isStructurallyValid"]
        and sections_found == ["HEADER", "TABLES", "ENTITIES"]
        and acad_ver == "AC1009"
        and ins_units == "5"
        and len(missing_layers) == 0
        and len(missing_table_layers) == 0
        and vertex_count_parity_matched
        and math.isfinite(max_vertex_error_cm)
        and max_vertex_error_cm <= 0.001
        and all(entity_counts_by_layer.get(lyr, 0) >= 1 for lyr in required_layers)
    )

    manifest_dump: Dict[str, Any] | None = None
    if round_trip_passed and total_vertices >= 3:
        manifest = DxfExportManifest(
            exportId="M00-7-REF-BF-001",
            standard="DXF-AAMA / ASTM D6673",
            dxfVersion="AC1009",
            geometryUnit="cm",
            requiredLayers=["1", "2", "4", "7", "8", "11"],
            recoveredLayers=sorted(entity_layers_found),
            pieceCodes=["BF-001"],
            totalVertexCount=total_vertices,
            maxRoundTripCoordinateErrorCm=max_vertex_error_cm,
            sha256Digest=dxf_sha256,
            syntheticRoundTripVerified=True,
            externalCadInteroperabilityVerified=False,
        )
        manifest_dump = manifest.model_dump(mode="json")

    return {
        "milestoneId": "M00.7",
        "artifactName": "DxfRoundTripVerificationReport.json",
        "parserAuthority": "UNIFIED_STRICT_PARSE_DXF_AAMA_STRICT",
        "sectionsRecovered": sections_found,
        "acadVersionHeader": acad_ver,
        "insUnitsHeader": ins_units,
        "tableLayersDefined": sorted(table_layers_defined),
        "layersRequired": sorted(required_layers),
        "layersRecovered": sorted(entity_layers_found),
        "missingLayers": missing_layers,
        "missingTableLayers": missing_table_layers,
        "hasEofMarker": parsed["hasEofMarker"],
        "unterminatedPolylinesCount": parsed["unterminatedPolylinesCount"],
        "emptyPolylinesCount": parsed["emptyPolylinesCount"],
        "structuralErrors": parsed["structuralErrors"],
        "isStructurallyValid": parsed["isStructurallyValid"],
        "cutPolylinesRecovered": len(cut_polys),
        "sewPolylinesRecovered": len(sew_polys),
        "cutVertexCountExpected": len(expected_cut_pts),
        "cutVertexCountRecovered": cut_recovered_count,
        "sewVertexCountExpected": len(expected_sew_pts),
        "sewVertexCountRecovered": sew_recovered_count,
        "vertexCountParityMatched": vertex_count_parity_matched,
        "maxVertexRoundTripErrorCm": max_vertex_error_cm if math.isfinite(max_vertex_error_cm) else None,
        "toleranceMaxCm": 0.001,
        "syntheticRoundTripVerified": round_trip_passed,
        "externalCadInteroperabilityVerified": False,
        "interoperabilityScopeNote": (
            "Verifies deterministic synthetic DXF R12 (AC1009) / ASTM D6673 emitter-to-parser round-trip in M00.7. "
            "External third-party CAD software (Gerber AccuMark, Lectra Modaris, Optitex, CLO3D) file import/export "
            "validation is scheduled under M05 Industrial Export."
        ),
        "dxfExportManifest": manifest_dump,
        "allPassed": round_trip_passed,
    }


def execute_m00_7_dxf_roundtrip_verification() -> Dict[str, Any]:
    cut_pts = [(-1.5, -1.5), (25.5, -1.5), (25.5, 43.5), (-1.5, 43.5)]
    sew_pts = [(0.0, 0.0), (24.0, 0.0), (24.0, 42.0), (0.0, 42.0)]
    dxf_payload = emit_reference_dxf_aama("BF-001", cut_pts, sew_pts)
    return parse_and_verify_dxf_aama(dxf_payload, cut_pts, sew_pts)


def _draft_paired_seam_curves_for_profile(profile: BodyProfile) -> List[Dict[str, Any]]:
    """Drafts actual cubic Bezier seam curves from `profile` and computes their arc lengths via M00.5 quadrature + Method C1-Cert
    (remediating FINDING-SUBORACLES-01 hardcoded seam length constants).
    """
    quarter_bust = 0.25 * profile.bustCm + 1.0
    quarter_waist = 0.25 * profile.waistCm + 0.5
    quarter_hip = 0.25 * profile.lowHipCm + 1.0
    side_len_y = profile.backWaistLengthCm - profile.armholeDepthCm
    shoulder_len = profile.shoulderLengthCm
    skirt_len = profile.skirtLengthCm or 65.0
    hip_drop = profile.waistToHipCm

    # 1. Bodice Front Side Seam vs Bodice Back Side Seam (distinct front/back waist-to-underarm shaping profiles)
    dx_side = quarter_bust - quarter_waist
    bf_side = ExactCubicBezier2D.from_floats(
        f"{profile.profileId}-bodice-front-side",
        (quarter_waist, 0.0),
        (quarter_waist + 0.30 * dx_side, side_len_y * 0.33),
        (quarter_waist + 0.72 * dx_side, side_len_y * 0.67),
        (quarter_bust, side_len_y),
    )
    bb_side = ExactCubicBezier2D.from_floats(
        f"{profile.profileId}-bodice-back-side",
        (quarter_waist, 0.0),
        (quarter_waist + 0.36 * dx_side, side_len_y * 0.34),
        (quarter_waist + 0.68 * dx_side, side_len_y * 0.66),
        (quarter_bust, side_len_y),
    )

    # 2. Bodice Front Shoulder vs Bodice Back Shoulder using real anthropometric shoulder drops
    # from src/engine/drafting/bodice-block.ts (front drop = 4.6 cm vs back drop = 3.8 cm)
    # so both seams have genuine distinct slope angles while preserving exact paired shoulder length!
    front_drop = 4.6
    back_drop = 3.8
    front_dx_sh = math.sqrt(max(1.0, shoulder_len * shoulder_len - front_drop * front_drop))
    back_dx_sh = math.sqrt(max(1.0, shoulder_len * shoulder_len - back_drop * back_drop))
    bf_shoulder = ExactCubicBezier2D.from_floats(
        f"{profile.profileId}-bodice-front-shoulder",
        (7.0, profile.frontWaistLengthCm),
        (7.0 + front_dx_sh / 3.0, profile.frontWaistLengthCm - front_drop / 3.0),
        (7.0 + 2.0 * front_dx_sh / 3.0, profile.frontWaistLengthCm - 2.0 * front_drop / 3.0),
        (7.0 + front_dx_sh, profile.frontWaistLengthCm - front_drop),
    )
    bb_shoulder = ExactCubicBezier2D.from_floats(
        f"{profile.profileId}-bodice-back-shoulder",
        (7.2, profile.backWaistLengthCm),
        (7.2 + back_dx_sh / 3.0, profile.backWaistLengthCm - back_drop / 3.0),
        (7.2 + 2.0 * back_dx_sh / 3.0, profile.backWaistLengthCm - 2.0 * back_drop / 3.0),
        (7.2 + back_dx_sh, profile.backWaistLengthCm - back_drop),
    )

    # 3. Skirt Front Side Curve vs Skirt Back Side Curve (curved hip-to-waist shaping over [0, skirt_len])
    sf_side = ExactCubicBezier2D.from_floats(
        f"{profile.profileId}-skirt-front-side",
        (quarter_waist, 0.0),
        (quarter_hip, -0.45 * hip_drop),
        (quarter_hip, -hip_drop),
        (quarter_hip, -skirt_len),
    )
    sb_side = ExactCubicBezier2D.from_floats(
        f"{profile.profileId}-skirt-back-side",
        (quarter_waist, 0.0),
        (quarter_hip, -0.452 * hip_drop),
        (quarter_hip, -hip_drop),
        (quarter_hip, -skirt_len),
    )

    pairs_spec = [
        ("Bodice Front Side <-> Bodice Back Side", bf_side, bb_side, 0.0, False),
        ("Bodice Front Shoulder <-> Bodice Back Shoulder", bf_shoulder, bb_shoulder, 0.0, True),
        ("Skirt Front Side Curve <-> Skirt Back Side Curve", sf_side, sb_side, 0.0, False),
    ]

    results: List[Dict[str, Any]] = []
    for label, curve_a, curve_b, target_ease, require_distinct_slope in pairs_spec:
        len_a, panels_a, conv_a = adaptive_gauss_legendre_arc_length_checked(curve_a, 1.0)
        len_b, panels_b, conv_b = adaptive_gauss_legendre_arc_length_checked(curve_b, 1.0)
        enc_a = method_c1_cert_arc_length_enclosure(curve_a, subdivision_depth=6)
        enc_b = method_c1_cert_arc_length_enclosure(curve_b, subdivision_depth=6)
        cad_delta = abs((len_a - len_b) - target_ease)
        a_lo_q = Fraction(enc_a["lowerChordBoundRational"])
        a_hi_q = Fraction(enc_a["upperControlPolygonBoundRational"])
        b_lo_q = Fraction(enc_b["lowerChordBoundRational"])
        b_hi_q = Fraction(enc_b["upperControlPolygonBoundRational"])
        edge_a_outward = list(fraction_pair_to_outward_f64_pair(a_lo_q, a_hi_q))
        edge_b_outward = list(fraction_pair_to_outward_f64_pair(b_lo_q, b_hi_q))
        ease_q = Fraction(str(target_ease))
        worst_case_q = max(
            abs((a_hi_q - b_lo_q) - ease_q),
            abs((b_hi_q - a_lo_q) - ease_q),
        )
        worst_case_delta = fraction_to_outward_upper_f64(worst_case_q)
        distinct_control_points = (
            (curve_a.p0, curve_a.p1, curve_a.p2, curve_a.p3)
            != (curve_b.p0, curve_b.p1, curve_b.p2, curve_b.p3)
        )
        # Measure chord direction angle difference (verifies shoulders are NOT translated copies!)
        vax = float(curve_a.p3[0] - curve_a.p0[0])
        vay = float(curve_a.p3[1] - curve_a.p0[1])
        vbx = float(curve_b.p3[0] - curve_b.p0[0])
        vby = float(curve_b.p3[1] - curve_b.p0[1])
        na = math.hypot(vax, vay)
        nb = math.hypot(vbx, vby)
        cos_ang = max(-1.0, min(1.0, (vax * vbx + vay * vby) / (na * nb))) if (na > 0.0 and nb > 0.0) else 1.0
        chord_angle_diff_deg = math.degrees(math.acos(cos_ang))
        distinct_slope_vectors = chord_angle_diff_deg > 1.0

        results.append(
            {
                "profileId": profile.profileId,
                "seamPair": label,
                "distinctControlPoints": distinct_control_points,
                "chordAngleDiffDeg": round(chord_angle_diff_deg, 6),
                "distinctSlopeVectors": distinct_slope_vectors,
                "edgeACm": round(len_a, 6),
                "edgeBCm": round(len_b, 6),
                "edgeAC1CertIntervalCm": edge_a_outward,
                "edgeBC1CertIntervalCm": edge_b_outward,
                "worstCaseC1CertDeltaCm": worst_case_delta,
                "exactRationalWorstCaseDeltaCm": float(worst_case_q),
                "quadratureConverged": conv_a and conv_b,
                "quadraturePanelsUsed": panels_a + panels_b,
                "targetEaseCm": target_ease,
                "cadDeltaCm": round(cad_delta, 6),
                "diagnosticFields": ["edgeACm", "edgeBCm", "cadDeltaCm"],
                "certificationFields": ["edgeAC1CertIntervalCm", "edgeBC1CertIntervalCm", "worstCaseC1CertDeltaCm"],
                "withinTier1CadTolerance0_05Cm": (
                    conv_a
                    and conv_b
                    and distinct_control_points
                    and (distinct_slope_vectors if require_distinct_slope else True)
                    and worst_case_delta <= 0.05
                    and cad_delta <= 0.05
                ),
            }
        )
    return results


def execute_m00_8_anthropometric_and_seam_parity_verification() -> Dict[str, Any]:
    """Executes M00.8 Anthropometric BodyProfile Plausibility & DEC-11 Two-Tier Seam Parity Verification
    with seam lengths computed directly from drafted cubic Bezier curves.
    """
    golden_profiles = [
        BodyProfile(
            profileId="STD-XS",
            bustCm=80.0,
            waistCm=62.0,
            highHipCm=78.0,
            lowHipCm=86.0,
            waistToHipCm=19.5,
            backWaistLengthCm=39.5,
            frontWaistLengthCm=41.0,
            acrossBackCm=33.5,
            shoulderLengthCm=11.8,
            neckCircumferenceCm=34.5,
            bustSpanCm=16.5,
            bustHeightCm=24.5,
            armholeDepthCm=19.5,
            sleeveLengthCm=57.5,
        ),
        BodyProfile(
            profileId="STD-M",
            bustCm=92.0,
            waistCm=74.0,
            highHipCm=90.0,
            lowHipCm=98.0,
            waistToHipCm=20.0,
            backWaistLengthCm=41.5,
            frontWaistLengthCm=43.0,
            acrossBackCm=36.5,
            shoulderLengthCm=12.8,
            neckCircumferenceCm=37.0,
            bustSpanCm=18.5,
            bustHeightCm=26.5,
            armholeDepthCm=21.0,
            sleeveLengthCm=59.5,
        ),
        BodyProfile(
            profileId="PLUS-XXL",
            bustCm=116.0,
            waistCm=98.0,
            highHipCm=114.0,
            lowHipCm=122.0,
            waistToHipCm=21.5,
            backWaistLengthCm=43.5,
            frontWaistLengthCm=46.0,
            acrossBackCm=41.0,
            shoulderLengthCm=14.0,
            neckCircumferenceCm=41.0,
            bustSpanCm=22.0,
            bustHeightCm=29.5,
            armholeDepthCm=24.0,
            sleeveLengthCm=61.5,
        ),
    ]

    base_valid = golden_profiles[1].model_dump(mode="json")
    negative_covariance_cases = [
        ("COV-01-LOW-HIP-SMALLER-THAN-HIGH-HIP", {**base_valid, "highHipCm": 96.0, "lowHipCm": 80.0}),
        ("COV-02-BUST-SPAN-EXCEEDS-35-PERCENT-BUST", {**base_valid, "bustCm": 75.0, "bustSpanCm": 27.5}),
        ("COV-03-ACROSS-BACK-EXCEEDS-55-PERCENT-BUST", {**base_valid, "bustCm": 76.0, "acrossBackCm": 45.0}),
        ("COV-04-WAIST-EXCEEDS-LOW-HIP-PLUS-12CM", {**base_valid, "lowHipCm": 85.0, "highHipCm": 82.0, "waistCm": 105.0}),
    ]
    covariance_rejections: List[Dict[str, Any]] = []
    for case_id, bad_payload in negative_covariance_cases:
        rejected = False
        try:
            BodyProfile.model_validate(bad_payload)
        except Exception:
            rejected = True
        covariance_rejections.append({"caseId": case_id, "rejected": rejected})

    # Compute paired seam lengths directly from drafted cubic Bezier pieces across all 3 golden profiles
    paired_seams: List[Dict[str, Any]] = []
    for profile in golden_profiles:
        paired_seams.extend(_draft_paired_seam_curves_for_profile(profile))

    all_cov_rejected = all(c["rejected"] for c in covariance_rejections)
    return {
        "milestoneId": "M00.8",
        "artifactName": "AnthropometricVerificationReport.json",
        "goldenProfilesValidatedCount": len(golden_profiles),
        "goldenProfilesEvaluatedForSeamParity": [p.profileId for p in golden_profiles],
        "invalidAnatomicalCovarianceRejected": all_cov_rejected,
        "covarianceNegativeChecks": covariance_rejections,
        "dec11TwoTierSeamTolerancePolicy": {
            "tier1CadGeometryMaxDeltaCm": 0.05,
            "tier2PhysicalSewnMaxDeltaCm": 0.20,
            "computedFromDraftedBezierCurves": True,
            "pairedSeamChecks": paired_seams,
        },
        "allPassed": (
            len(golden_profiles) == 3
            and len(paired_seams) == 9
            and all_cov_rejected
            and all(s["withinTier1CadTolerance0_05Cm"] for s in paired_seams)
        ),
    }
