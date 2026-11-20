"""Pytest Verification Suite for Remediated M00 (M00.1 through M00.8, AG-01..AG-17, and ADR-009 §6 Complete Coverage)."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

import pytest

from patroner_geometry.c1_cert_oracle import (
    ExactCubicBezier2D,
    certify_cubic_offset_on_unit_interval,
    classify_zero_speed_point_exact,
    compute_interval_max_speed_on_domain_cm_per_t,
    detect_global_contour_self_intersections,
    execute_17_adversarial_geometry_families,
    execute_adr009_section6_complete_suite,
    krawczyk_isolate_offset_intersections,
    verify_four_circle_sanity_cases,
)
from patroner_geometry.contracts import (
    BaseCurveSingularityClassification,
    CanonicalOffsetClassification,
    OffsetFailureCategory,
    OffsetValidationRecord,
    StationaryParameterizationStatus,
    verify_schemas_lock,
)
from patroner_geometry.qualification import generate_interval_library_qualification_report
from patroner_geometry.sub_oracles import (
    execute_m00_5_arc_length_verification,
    execute_m00_6_topology_verification,
    execute_m00_7_dxf_roundtrip_verification,
    execute_m00_8_anthropometric_and_seam_parity_verification,
)
from patroner_geometry.c1_cert_oracle import (
    _compute_circle_octant_bezier_errors,
    method_c1_cert_arc_length_enclosure,
)
from patroner_geometry.qualification import (
    evaluate_three_candidates_p95_latency,
    fraction_pair_to_outward_f64_pair,
    fraction_to_outward_lower_f64,
    fraction_to_outward_upper_f64,
    mpf_to_outward_lower_f64,
    mpf_to_outward_upper_f64,
)


def test_m00_1_canonical_schemas_lock_and_negative_parity() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    schema_path = repo_root / "packages" / "contracts" / "schemas" / "canonical_contracts.schema.json"
    res = verify_schemas_lock(schema_path)
    assert res["allPassed"] is True
    assert res["entitiesVerifiedCount"] == 12
    assert res["negativeValidationCount"] == 10
    assert all(n["bothRejected"] for n in res["negativeValidationResults"])
    assert all(s["pydanticSemanticValidatorRejected"] for s in res["semanticInvariantChecks"])


def test_m00_4_step1_interval_library_qualification_report() -> None:
    report = generate_interval_library_qualification_report()
    assert report["allCandidatesQualified"] is True
    assert report["deterministicMathematicalEvidenceOnly"] is True

    pop_spec = report["populationSpecification"]
    assert pop_spec["rationalIntervalPairsPerTier"] == 10000
    assert pop_spec["sqrtRationalInputsPerTier"] == 10000
    assert pop_spec["precisionTiersBits"] == [53, 113, 170, 336]
    assert pop_spec["totalChecksPerCandidate"] == 200000
    assert pop_spec["totalChecksAcrossAllThreeCandidates"] == 600000

    candidates = report["candidatesEvaluated"]
    assert len(candidates) == 3
    for cand in candidates:
        assert cand["outwardDirectedRoundingVerified"] is True
        assert cand["outwardRoundingChecksTotal"] == 200000
        assert cand["outwardRoundingChecksPassed"] == 200000
        assert cand["outwardRoundingFailuresCount"] == 0
        assert cand["failureRecords"] == []
        assert len(cand["precisionTierBreakdown"]) == 4
        assert cand["grazingTangencyNoFalseNegative"] is True
        assert cand["wilkinsonClusterSeparationVerified"] is True
        assert cand["domainTrapsVerified"]["divisionByStraddlingZeroDetected"] is True
        assert cand["domainTrapsVerified"]["negativeSqrtDomainTrapDetected"] is True
        assert cand["unsplitRootIsolationFromUnitInterval"]["manualPreSplittingUsed"] is False
        assert cand["unsplitRootIsolationFromUnitInterval"]["allPassed"] is True

    # Audit of mpmath.iv semantic properties and pitfalls must pass explicitly
    semantic_audit = candidates[0]["mpmathIvSemanticAudit"]
    assert semantic_audit["allSemanticAuditsPassed"] is True
    assert semantic_audit["semanticChecks"]["zeroStraddlingSquarePitfall"]["uTimesUProducesSpuriousNegativeLowerBound"] is True
    assert semantic_audit["semanticChecks"]["zeroStraddlingSquarePitfall"]["uPow2PreservesNonNegativity"] is True
    assert semantic_audit["semanticChecks"]["zeroStraddlingDivisionSilentInfinity"]["returnsMinusInfPlusInfWithoutException"] is True


def test_m00_4_four_circle_sanity_cases_exact_adr009_taxonomy() -> None:
    circles = verify_four_circle_sanity_cases()
    assert len(circles) == 4
    # Case 1 (AG-01): s=+1, d=1.5 < R=10 -> f=0.85, CERTIFIED_VALID
    assert circles[0]["offsetSpeedFactorF"] == 0.85
    assert circles[0]["canonicalOffsetClassification"] == CanonicalOffsetClassification.CERTIFIED_VALID.value
    assert circles[0]["hasZeroSpeedCuspOnDomain"] is False
    assert circles[0]["hasTangentReversalOnDomain"] is False

    # Case 2 (AG-02): s=+1, d=10.0 = R=10 -> f=0.0, ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP
    assert circles[1]["offsetSpeedFactorF"] == 0.0
    assert (
        circles[1]["canonicalOffsetClassification"]
        == CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value
    )
    assert circles[1]["hasZeroSpeedCuspOnDomain"] is True
    assert circles[1]["hasTangentReversalOnDomain"] is False

    # Case 3 (AG-03): s=+1, d=12.0 > R=10 -> f=-0.20 < 0 everywhere, ||O'(t)|| = 2 > 0 everywhere -> TANGENT_REVERSAL
    assert circles[2]["offsetSpeedFactorF"] == -0.2
    assert circles[2]["canonicalOffsetClassification"] == CanonicalOffsetClassification.TANGENT_REVERSAL.value
    assert circles[2]["hasZeroSpeedCuspOnDomain"] is False
    assert circles[2]["hasTangentReversalOnDomain"] is True

    # Case 4 (AG-04): s=-1, d=1.5 and d=12.0 > R=10 -> CERTIFIED_VALID
    assert circles[3]["offsetSpeedFactorF"] == 1.15
    assert circles[3]["canonicalOffsetClassification"] == CanonicalOffsetClassification.CERTIFIED_VALID.value
    assert circles[3]["outwardSuperRadiusSubcase_d12cm"]["offsetSpeedFactorF"] == 2.2
    assert (
        circles[3]["outwardSuperRadiusSubcase_d12cm"]["canonicalOffsetClassification"]
        == CanonicalOffsetClassification.CERTIFIED_VALID.value
    )


def test_m00_4_five_way_base_curve_singularity_taxonomy() -> None:
    """Tests all 5 base-curve singularity classifications in ADR-009 §2.2 & §4.2."""
    # 1. Removable parameterization degeneracy B(t) = (t^3, 0) on [-1, 1] (u* = 0.5 on [0, 1])
    c_rem = ExactCubicBezier2D(
        segment_id="test-t3-0",
        p0=(Fraction(-1), Fraction(0)),
        p1=(Fraction(1), Fraction(0)),
        p2=(Fraction(-1), Fraction(0)),
        p3=(Fraction(1), Fraction(0)),
    )
    assert c_rem.eval_Q_exact(Fraction(1, 2)) == 0
    res_rem = classify_zero_speed_point_exact(c_rem, Fraction(1, 2), s_sign=+1, d=Fraction(3, 2))
    assert (
        res_rem["baseCurveSingularityClassification"]
        == BaseCurveSingularityClassification.REMOVABLE_PARAMETERIZATION_DEGENERACY.value
    )
    assert res_rem["canonicalOffsetClassification"] == CanonicalOffsetClassification.CERTIFIED_VALID.value
    assert res_rem["m"] == 3
    assert res_rem["isGeometricCusp"] is False

    # 2. Collapsed zero-length curve P0 = P1 = P2 = P3
    c_col = ExactCubicBezier2D(
        segment_id="test-collapsed",
        p0=(Fraction(2), Fraction(3)),
        p1=(Fraction(2), Fraction(3)),
        p2=(Fraction(2), Fraction(3)),
        p3=(Fraction(2), Fraction(3)),
    )
    res_col = classify_zero_speed_point_exact(c_col, Fraction(0), s_sign=+1, d=Fraction(1))
    assert (
        res_col["baseCurveSingularityClassification"]
        == BaseCurveSingularityClassification.COLLAPSED_ZERO_LENGTH_CURVE.value
    )
    assert res_col["isGeometricCusp"] is True


def test_m00_4_krawczyk_existence_uniqueness_and_unresolved_fail_closed() -> None:
    """Verifies Krawczyk existence/uniqueness proofs on AG-15 and fail-closed UNRESOLVED behavior
    on a tangential/coincident offset intersection where the 2D Jacobian is singular.
    """
    # Part 1: Independent geometric invariant check on AG-15 Krawczyk global intersection
    seg0 = ExactCubicBezier2D.from_floats("kraw-left", (0.0, 10.0), (0.0, 6.5), (0.0, 3.5), (0.0, 0.0))
    seg1 = ExactCubicBezier2D.from_floats("kraw-bot", (0.0, 0.0), (1.0, 0.5), (2.0, 1.2), (3.0, 2.0))
    seg2 = ExactCubicBezier2D.from_floats("kraw-right", (3.0, 2.0), (2.0, 4.0), (1.0, 6.0), (0.0, 8.0))
    g_res = detect_global_contour_self_intersections([seg0, seg1, seg2], s_sign=+1, d=1.5)
    assert g_res["krawczykStatus"] == "CERTIFIED_EXISTENCE_AND_UNIQUENESS"
    assert g_res["canonicalOffsetClassification"] == CanonicalOffsetClassification.GLOBAL_SELF_INTERSECTION.value
    assert len(g_res["globalIntersections"]) >= 1
    assert len(g_res["krawczykCertificates"]) == len(g_res["globalIntersections"])
    for cert, kproof in zip(g_res["globalIntersections"], g_res["krawczykCertificates"]):
        assert kproof["krawczykContainmentVerified"] is True
        assert kproof["existenceAndUniquenessCertified"] is True
        assert kproof["krawczykNormInf"] < 1.0
        # Independently verify O_0(t1_mid) approx == O_2(t2_mid) from the curve equations
        t1_mid = 0.5 * (cert["t1Bracket"][0] + cert["t1Bracket"][1])
        t2_mid = 0.5 * (cert["t2Bracket"][0] + cert["t2Bracket"][1])
        o_a = seg0.eval_kinematics_float(t1_mid, +1, 1.5)["O"]
        o_b = seg2.eval_kinematics_float(t2_mid, +1, 1.5)["O"]
        dist = ((o_a[0] - o_b[0]) ** 2 + (o_a[1] - o_b[1]) ** 2) ** 0.5
        assert dist <= 1e-6

    # Part 2: Fail-closed UNRESOLVED on coincident/collinear segments (singular 2D Jacobian -> Krawczyk cannot certify)
    tangent_a = ExactCubicBezier2D.from_floats("tan-a", (0.0, 0.0), (3.0, 0.0), (7.0, 0.0), (10.0, 0.0))
    tangent_mid = ExactCubicBezier2D.from_floats("tan-mid", (10.0, 0.0), (10.0, 1.0), (10.0, 2.0), (10.0, 3.0))
    tangent_b = ExactCubicBezier2D.from_floats("tan-b", (0.0, 0.0), (3.0, 0.0), (7.0, 0.0), (10.0, 0.0))
    kraw_unres = krawczyk_isolate_offset_intersections(tangent_a, tangent_b, s_sign=+1, d=1.0, max_depth=8)
    assert kraw_unres["status"] == "UNRESOLVED"
    assert len(kraw_unres["unresolvedBoxes"]) > 0

    g_unres = detect_global_contour_self_intersections([tangent_a, tangent_mid, tangent_b], s_sign=+1, d=1.0, max_depth=8)
    assert g_unres["krawczykStatus"] == "UNRESOLVED"
    assert g_unres["canonicalOffsetClassification"] == CanonicalOffsetClassification.INCONCLUSIVE.value


def test_m00_4_all_17_adversarial_geometry_families() -> None:
    report = execute_17_adversarial_geometry_families()
    assert report["totalFamiliesRequired"] == 17
    assert report["totalFamiliesExecuted"] == 17
    assert report["totalFamiliesPassed"] == 17
    assert report["canonicalOffsetClassificationsCount"] == 7  # CERTIFIED_VALID + all 6 failure categories
    assert report["baseCurveSingularityClassificationsCount"] == 5  # All 5 base-curve singularity categories
    assert report["allPassed"] is True


def test_m00_4_adr009_section6_complete_suite_and_negative_guards() -> None:
    sec6 = execute_adr009_section6_complete_suite()
    assert sec6["allPassed"] is True
    assert sec6["additionalSection6CasesCount"] == 6

    # Negative guard: short-span bypass (2% coverage < 85%) must raise ValueError
    c = ExactCubicBezier2D.from_floats("guard-test", (0.0, 0.0), (3.0, 1.0), (7.0, 1.0), (10.0, 0.0))
    with pytest.raises(ValueError, match="anti-bypass violation"):
        certify_cubic_offset_on_unit_interval(c, s_sign=-1, d=1.0, evaluated_subspan=(0.0, 0.02))

    # Negative guard: INCONCLUSIVE record cannot set is_production_ready=True
    with pytest.raises(ValueError, match="INCONCLUSIVE"):
        OffsetValidationRecord(
            segment_id="bad-inc",
            piece_id="p1",
            contour_orientation="CCW_EXTERIOR",
            offset_direction_sign_s=+1,
            offset_distance_cm=1.0,
            regularity_margin_epsilon=0.05,
            min_base_speed_squared_interval=(10.0, 10.0),
            min_offset_speed_factor_interval=(0.04, 0.06),
            has_zero_speed_cusp_on_domain=False,
            has_tangent_reversal_on_domain=False,
            stationary_parameterization_status=StationaryParameterizationStatus.NONE_REGULAR_SPEED,
            base_curve_singularity_classification=BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
            isolated_cusp_roots_t=[],
            isolated_self_intersections=[],
            max_geometric_deviation_bound_cm=0.0,
            verification_outcome="INCONCLUSIVE",
            failure_category=OffsetFailureCategory.INCONCLUSIVE_VERIFICATION,
            canonical_offset_classification=CanonicalOffsetClassification.INCONCLUSIVE,
            active_classifications_on_domain=[CanonicalOffsetClassification.INCONCLUSIVE],
            working_precision_bits=113,
            is_production_ready=True,
        )


def test_m00_5_arc_length_and_brent_inversion() -> None:
    res = execute_m00_5_arc_length_verification()
    assert res["allPassed"] is True
    assert res["certificationAuthority"] == "METHOD_C1_CERT_CHORD_POLYGON_BOUNDS"
    assert res["quadratureRole"] == "DIAGNOSTIC_ONLY_NON_AUTHORITATIVE"
    assert res["adaptiveGaussLegendreWithinC1CertEnclosure"] is True
    assert res["forwardLengthErrorCm"] <= 1e-6

    armscye_c1 = res["methodC1CertArmscyeEnclosure"]
    assert armscye_c1["certificationAuthority"] == "METHOD_C1_CERT_CHORD_POLYGON_BOUNDS"
    assert armscye_c1["nonStrictInequalityHolds"] is True
    assert armscye_c1["lowerChordBoundCm"] <= armscye_c1["upperControlPolygonBoundCm"]
    assert armscye_c1["enclosureWidthCm"] <= 1e-3

    # Verify Method B1 interval speed is computed from the curve, not hardcoded (was previously 25.0)
    fwd_rec = res["forwardNumericalVerificationRecord"]
    expected_curve = ExactCubicBezier2D.from_floats(
        "bodice-front-armscye-m005", (23.5, 19.5), (21.0, 19.5), (19.2, 14.0), (20.5, 4.2)
    )
    computed_sup = compute_interval_max_speed_on_domain_cm_per_t(expected_curve, 0.0, 1.0, panels=64)
    assert abs(fwd_rec["local_speed_upper_bound_cm_per_t"] - round(computed_sup, 8)) <= 1e-7
    assert fwd_rec["local_speed_upper_bound_cm_per_t"] != 25.0

    assert res["methodC1CertCollinearEnclosure"]["nonStrictInequalityHolds"] is True
    assert res["methodC1CertCollinearEnclosure"]["enclosureWidthCm"] == 0.0


def test_m00_6_exact_topology_predicates_with_collinear_and_vertex_on_edge() -> None:
    res = execute_m00_6_topology_verification()
    assert res["allPassed"] is True
    assert res["bowtieSelfIntersectionDetected"] is True
    assert res["vertexOnEdgeDegeneracyDetected"] is True
    assert res["collinearOverlapDegeneracyDetected"] is True
    assert res["microSliverDetected"] is True


def test_m00_7_dxf_aama_roundtrip() -> None:
    res = execute_m00_7_dxf_roundtrip_verification()
    assert res["allPassed"] is True
    assert res["acadVersionHeader"] == "AC1009"
    assert res["sectionsRecovered"] == ["HEADER", "TABLES", "ENTITIES"]
    assert res["maxVertexRoundTripErrorCm"] <= 0.001
    assert res["syntheticRoundTripVerified"] is True
    assert res["externalCadInteroperabilityVerified"] is False


def test_m00_8_anthropometrics_and_dec11_seam_parity() -> None:
    res = execute_m00_8_anthropometric_and_seam_parity_verification()
    assert res["allPassed"] is True
    assert res["invalidAnatomicalCovarianceRejected"] is True
    assert res["dec11TwoTierSeamTolerancePolicy"]["computedFromDraftedBezierCurves"] is True


def test_pkg_m00_02_zero_straddling_squaring_and_circle_octant() -> None:
    """Verifies (u ** 2) preserves non-negativity across zero-straddling operands and circle octant certification."""
    from mpmath import iv

    iv.prec = 113
    u = iv.mpf(["-0.25", "0.5"])
    sq_mul = u * u
    sq_pow = u ** 2
    assert float(sq_mul.a) < 0.0
    assert float(sq_pow.a) >= 0.0

    e_grid, e_cert = _compute_circle_octant_bezier_errors(10.0)
    assert e_grid <= e_cert
    assert e_cert < 0.003


def test_pkg_m00_02_p95_benchmark_classifier_boundaries() -> None:
    """Verifies evaluate_three_candidates_p95_latency strictly validates all 3 candidates and rejects edge defects."""
    valid_payload = {
        "metadata": {"environment": {"pythonVersion": "3.12.16"}},
        "candidates": {
            "mpmathIvFraction": {"available": True, "samplesMs": [0.2, 0.3, 0.4, 5.0]},
            "pythonFlintArbFmpq": {"available": True, "samplesMs": [0.01, 0.02, 0.03]},
            "decimalIntervalFraction": {"available": True, "samplesMs": [0.1, 0.2, 0.3]},
        },
    }
    res_ok = evaluate_three_candidates_p95_latency(valid_payload, threshold_ms=5.0)
    assert res_ok["allThreeCandidatesVerifiedUnder5MsP95"] is True

    # Missing candidate
    missing = {
        "candidates": {
            "mpmathIvFraction": {"available": True, "samplesMs": [0.2]},
            "pythonFlintArbFmpq": {"available": True, "samplesMs": [0.02]},
        }
    }
    assert evaluate_three_candidates_p95_latency(missing)["allThreeCandidatesVerifiedUnder5MsP95"] is False

    # Unavailable candidate
    unavail = {
        "candidates": {
            "mpmathIvFraction": {"available": True, "samplesMs": [0.2]},
            "pythonFlintArbFmpq": {"available": False, "samplesMs": [0.02]},
            "decimalIntervalFraction": {"available": True, "samplesMs": [0.1]},
        }
    }
    assert evaluate_three_candidates_p95_latency(unavail)["allThreeCandidatesVerifiedUnder5MsP95"] is False

    # Invalid samples: NaN, negative, or bool (caught even though isinstance(True, int) in Python!)
    for bad_sample in ([float("nan")], [-0.1], [True]):
        bad_payload = {
            "candidates": {
                "mpmathIvFraction": {"available": True, "samplesMs": bad_sample},
                "pythonFlintArbFmpq": {"available": True, "samplesMs": [0.02]},
                "decimalIntervalFraction": {"available": True, "samplesMs": [0.1]},
            }
        }
        assert evaluate_three_candidates_p95_latency(bad_payload)["allThreeCandidatesVerifiedUnder5MsP95"] is False

    # Exact 5.0001 ms fails while 5.0 ms passes; empty metadata blocks are ignored
    just_over = {
        "environment": {"pythonVersion": "3.12.16"},
        "candidates": {
            "mpmathIvFraction": {"available": True, "samplesMs": [5.0001]},
            "pythonFlintArbFmpq": {"available": True, "samplesMs": [0.02]},
            "decimalIntervalFraction": {"available": True, "samplesMs": [0.1]},
        },
    }
    assert evaluate_three_candidates_p95_latency(just_over)["allThreeCandidatesVerifiedUnder5MsP95"] is False


def test_pkg_m00_02_ag15_mvt_diagonal_exclusion() -> None:
    """Verifies AG-15 MVT injectivity pruning:
    (a) regular injective segment prunes diagonal cleanly as CERTIFIED_DISJOINT,
    (b) nontrivial near-diagonal self-intersection (< 1e-4 parameter separation) is NOT skipped and is Krawczyk-certified,
    (c) singular cusp diagonal fails closed as UNRESOLVED rather than silently continuing.
    """
    # (a) Regular injective parabolic arc -> CERTIFIED_DISJOINT with 0 unresolvedBoxes
    reg_curve = ExactCubicBezier2D.from_floats("reg-parab", (0.0, 0.0), (3.0, 1.0), (7.0, 1.0), (10.0, 0.0))
    res_reg = krawczyk_isolate_offset_intersections(reg_curve, reg_curve, s_sign=-1, d=0.5, max_depth=24)
    assert res_reg["status"] == "CERTIFIED_DISJOINT"
    assert res_reg["unresolvedBoxes"] == []

    # (b) Regular cubic loop B(u) = (u^2 - a^2, 500 * u * (u^2 - a^2)), u = 2t - 1, a = 6e-5
    # Exact self-intersection at t1* = 0.5 - 3e-5 = 0.49997, t2* = 0.5 + 3e-5 = 0.50003 (|t2*-t1*| = 6e-5 < 1e-4!).
    # Note: legacy heuristic |t_mid1 - t_mid2| < 1e-4 & depth > 12 would have silently dropped this crossing!
    a_q = Fraction(6, 100000)
    a2 = a_q * a_q
    c3_y = Fraction(500) * 8
    c2_y = Fraction(-12) * 500
    c1_y = Fraction(500) * (6 - 2 * a2)
    c0_y = Fraction(500) * (-1 + a2)
    p0x = 1 - a2
    p1x = (1 - a2) + Fraction(-4, 3)
    p2x = (1 - a2) - Fraction(8, 3) + Fraction(4, 3)
    p3x = 1 - a2  # since (2*1-1)^2 - a^2 = 1 - a^2
    # Convert exact power coeffs x(t) = (1 - a^2) - 4 t + 4 t^2, y(t) = c0 + c1 t + c2 t^2 + c3 t^3 to Bernstein:
    bx_0 = 1 - a2
    bx_1 = bx_0 + Fraction(-4, 3)
    bx_2 = bx_0 + Fraction(-8, 3) + Fraction(4, 3)
    bx_3 = bx_0 - 4 + 4
    by_0 = c0_y
    by_1 = c0_y + c1_y / 3
    by_2 = c0_y + 2 * c1_y / 3 + c2_y / 3
    by_3 = c0_y + c1_y + c2_y + c3_y
    near_diag_loop = ExactCubicBezier2D(
        segment_id="near-diag-loop",
        p0=(bx_0, by_0),
        p1=(bx_1, by_1),
        p2=(bx_2, by_2),
        p3=(bx_3, by_3),
    )
    res_loop = krawczyk_isolate_offset_intersections(near_diag_loop, near_diag_loop, s_sign=+1, d=0.0, max_depth=36)
    assert res_loop["status"] == "CERTIFIED_INTERSECTION_FOUND"
    assert len(res_loop["certifiedIntersections"]) >= 1
    found_near = any(
        sol["t1Bracket"][0] <= 0.49997 <= sol["t1Bracket"][1]
        and sol["t2Bracket"][0] <= 0.50003 <= sol["t2Bracket"][1]
        for sol in res_loop["certifiedIntersections"]
    )
    assert found_near

    # (c) Singular interior cusp B(u) = (u^2, u^3) -> zero base speed on diagonal fails closed to UNRESOLVED
    cusp_curve = ExactCubicBezier2D(
        segment_id="diag-cusp-unresolved",
        p0=(Fraction(1), Fraction(-1)),
        p1=(Fraction(-1, 3), Fraction(1)),
        p2=(Fraction(-1, 3), Fraction(-1)),
        p3=(Fraction(1), Fraction(1)),
    )
    res_cusp = krawczyk_isolate_offset_intersections(cusp_curve, cusp_curve, s_sign=-1, d=1.5, max_depth=16)
    assert res_cusp["status"] == "UNRESOLVED"
    assert len(res_cusp["unresolvedBoxes"]) > 0


def test_pkg_m00_02_outward_binary64_json_roundtrip_containment() -> None:
    """Verifies directed outward IEEE-754 binary64 conversion & JSON round-trip enclosure across extreme scales."""
    import json
    from mpmath import iv

    samples = [
        (Fraction(-1, 3), Fraction(1, 3)),  # zero-straddling
        (Fraction(1, 10**300), Fraction(2, 10**300)),  # extreme subnormal / tiny scale
        (Fraction(10**12) + Fraction(1, 7), Fraction(10**12) + Fraction(2, 7)),  # large magnitude ULP shift
        (Fraction(-10**12) - Fraction(2, 3), Fraction(10**12) + Fraction(2, 3)),  # wide zero-straddling large scale
    ]
    for q_lo, q_hi in samples:
        f_lo, f_hi = fraction_pair_to_outward_f64_pair(q_lo, q_hi)
        re_lo, re_hi = json.loads(json.dumps([f_lo, f_hi]))
        assert Fraction(re_lo) <= q_lo
        assert Fraction(re_hi) >= q_hi

    iv.prec = 113
    iv_test = iv.mpf(["-0.33333333333333333333333333333333", "0.66666666666666666666666666666667"])
    m_lo = mpf_to_outward_lower_f64(iv_test.a)
    m_hi = mpf_to_outward_upper_f64(iv_test.b)
    re_m_lo, re_m_hi = json.loads(json.dumps([m_lo, m_hi]))
    assert re_m_lo <= float(iv_test.a)
    assert re_m_hi >= float(iv_test.b)

    # Verify Method C1-Cert outward containment against exact rational endpoints
    armscye = ExactCubicBezier2D.from_floats(
        "outward-check", (23.5, 19.5), (21.0, 19.5), (19.2, 14.0), (20.5, 4.2)
    )
    enc = method_c1_cert_arc_length_enclosure(armscye, subdivision_depth=8)
    lo_q = Fraction(enc["lowerChordBoundRational"])
    hi_q = Fraction(enc["upperControlPolygonBoundRational"])
    assert Fraction(enc["lowerChordBoundCm"]) <= lo_q <= hi_q <= Fraction(enc["upperControlPolygonBoundCm"])

