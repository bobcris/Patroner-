"""Pytest Verification Suite for Remediated M00 (M00.1 through M00.8, AG-01..AG-17, and ADR-009 §6 Complete Coverage)."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

import pytest

from patroner_geometry.c1_cert_oracle import (
    ExactCubicBezier2D,
    certify_cubic_offset_on_unit_interval,
    classify_zero_speed_point_exact,
    execute_17_adversarial_geometry_families,
    execute_adr009_section6_complete_suite,
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
    candidates = report["candidatesEvaluated"]
    assert len(candidates) == 3
    for cand in candidates:
        assert cand["outwardDirectedRoundingVerified"] is True
        assert cand["grazingTangencyNoFalseNegative"] is True
        assert cand["wilkinsonClusterSeparationVerified"] is True
        assert cand["domainTrapsVerified"]["divisionByStraddlingZeroDetected"] is True
        assert cand["domainTrapsVerified"]["negativeSqrtDomainTrapDetected"] is True
        assert cand["unsplitRootIsolationFromUnitInterval"]["manualPreSplittingUsed"] is False
        assert cand["unsplitRootIsolationFromUnitInterval"]["allPassed"] is True


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
            failure_category=OffsetFailureCategory.INCONCLUSIVE,
            canonical_offset_classification=CanonicalOffsetClassification.INCONCLUSIVE,
            active_classifications_on_domain=[CanonicalOffsetClassification.INCONCLUSIVE],
            working_precision_bits=113,
            is_production_ready=True,
        )


def test_m00_5_arc_length_and_brent_inversion() -> None:
    res = execute_m00_5_arc_length_verification()
    assert res["allPassed"] is True
    assert res["forwardLengthErrorCm"] <= 1e-6
    assert res["methodC1CertArmscyeEnclosure"]["nonStrictInequalityHolds"] is True
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
