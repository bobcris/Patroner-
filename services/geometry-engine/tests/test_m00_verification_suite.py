"""Pytest Verification Suite for M00 (M00.1 through M00.8, including all 17 Adversarial Geometry Families AG-01..AG-17)."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

from patroner_geometry.c1_cert_oracle import (
    ExactCubicBezier2D,
    classify_zero_speed_point_exact,
    execute_17_adversarial_geometry_families,
    verify_four_circle_sanity_cases,
)
from patroner_geometry.contracts import OffsetClassificationCategory, verify_schemas_lock
from patroner_geometry.qualification import generate_interval_library_qualification_report
from patroner_geometry.sub_oracles import (
    execute_m00_5_arc_length_verification,
    execute_m00_6_topology_verification,
    execute_m00_7_dxf_roundtrip_verification,
    execute_m00_8_anthropometric_and_seam_parity_verification,
)


def test_m00_1_canonical_schemas_lock() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    schema_path = repo_root / "packages" / "contracts" / "schemas" / "canonical_contracts.schema.json"
    res = verify_schemas_lock(schema_path)
    assert res["allPassed"] is True
    assert res["entitiesVerifiedCount"] == 7


def test_m00_4_step1_interval_library_qualification_report() -> None:
    report = generate_interval_library_qualification_report()
    assert report["allCandidatesQualified"] is True
    candidates = report["candidatesEvaluated"]
    assert len(candidates) == 3
    for cand in candidates:
        assert cand["outwardDirectedRoundingVerified"] is True
        assert cand["grazingTangencyNoFalseNegative"] is True
        assert cand["wilkinsonClusterSeparationVerified"] is True
        assert cand["withinLatencyBudget"] is True


def test_m00_4_four_circle_sanity_cases() -> None:
    circles = verify_four_circle_sanity_cases()
    assert len(circles) == 4
    assert circles[0]["offsetSpeedFactorF"] == 0.85
    assert circles[0]["classifiedCategory"] == OffsetClassificationCategory.CERTIFIED_REGULAR.value
    assert circles[1]["offsetSpeedFactorF"] == 0.0
    assert circles[1]["classifiedCategory"] == OffsetClassificationCategory.TANGENTIAL_CUSP_DEGENERACY.value
    assert circles[2]["offsetSpeedFactorF"] == -0.2
    assert circles[2]["classifiedCategory"] == OffsetClassificationCategory.ACTUAL_CURVATURE_CUSP.value
    assert circles[3]["offsetSpeedFactorF"] == 1.15
    assert circles[3]["classifiedCategory"] == OffsetClassificationCategory.CERTIFIED_REGULAR.value


def test_m00_4_removable_parameterization_degeneracy_counterexample_b_t3_0() -> None:
    """Explicitly tests ADR-009 §2.2 counterexample B(t) = (t^3, 0) on [-1, 1] (reparameterized on [0, 1] at u*=0.5)."""
    curve = ExactCubicBezier2D(
        segment_id="test-t3-0",
        p0=(Fraction(-1), Fraction(0)),
        p1=(Fraction(1), Fraction(0)),
        p2=(Fraction(-1), Fraction(0)),
        p3=(Fraction(1), Fraction(0)),
    )
    assert curve.eval_Q_exact(Fraction(1, 2)) == 0
    res = classify_zero_speed_point_exact(curve, Fraction(1, 2), s_sign=+1, d=Fraction(3, 2))
    assert res["classification"] == OffsetClassificationCategory.REMOVABLE_PARAMETERIZATION_DEGENERACY.value
    assert res["m"] == 3
    assert res["isGeometricCusp"] is False
    assert res["limitingTangentMinus"] == (1.0, 0.0)
    assert res["limitingTangentPlus"] == (1.0, 0.0)
    assert res["limitingCurvature"] == 0.0


def test_m00_4_all_17_adversarial_geometry_families() -> None:
    report = execute_17_adversarial_geometry_families()
    assert report["totalFamiliesRequired"] == 17
    assert report["totalFamiliesExecuted"] == 17
    assert report["totalFamiliesPassed"] == 17
    assert report["offsetCategoriesCount"] == 6
    assert report["allPassed"] is True


def test_m00_5_arc_length_and_brent_inversion() -> None:
    res = execute_m00_5_arc_length_verification()
    assert res["allPassed"] is True
    assert res["forwardLengthErrorCm"] <= 1e-6


def test_m00_6_exact_topology_predicates() -> None:
    res = execute_m00_6_topology_verification()
    assert res["allPassed"] is True
    assert res["bowtieSelfIntersectionDetected"] is True
    assert res["microSliverDetected"] is True


def test_m00_7_dxf_aama_roundtrip() -> None:
    res = execute_m00_7_dxf_roundtrip_verification()
    assert res["allPassed"] is True
    assert res["maxVertexRoundTripErrorCm"] <= 0.001


def test_m00_8_anthropometrics_and_dec11_seam_parity() -> None:
    res = execute_m00_8_anthropometric_and_seam_parity_verification()
    assert res["allPassed"] is True
    assert res["invalidAnatomicalCovarianceRejected"] is True
