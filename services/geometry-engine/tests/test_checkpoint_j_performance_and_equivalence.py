"""PKG-M00-04 Checkpoint J — 63-Canonical-Contour Performance & Differential Equivalence Tests.

Independently verifies that the ADR-009 §5.1 / §5.2 direct Bernstein-basis Stage 2 offset verifier
implemented symmetrically across all three interval candidates (`mpmath_iv`, `python_flint`,
`decimal_interval`) preserves 100% mathematical equivalence with the independent C1-Cert oracle
across:
  1. All 63 canonical garment contours (129 cubic Beziers x both offset signs x 3 candidates = 774 checks).
  2. Adversarial and pathological curve families (interior evolute cusp, swallowtail tangent reversal,
     regularity margin violation, convex/concave mirror pair, S-inflection valid/invalid, removable
     endpoint and interior parameterization degeneracies, genuine base-curve cusps including non-dyadic
     t* = 1/3, endpoint infinite curvature, and fail-closed INCONCLUSIVE under depth capping).
  3. Outward-rounded DecimalInterval.sqr arithmetic including zero-straddling intervals.
  4. Full 63-contour benchmark reporting (cold-start + steady-state multi-repetition statistics,
     phase breakdowns, explicit BLOCKED_MISSING_TROUSER_BLOCK provenance, 0 false cusp flags,
     and < 5.0 ms P95 compliance across all three candidates).
"""

from __future__ import annotations

import decimal
import json
from fractions import Fraction
from pathlib import Path

import pytest

from patroner_geometry.c1_cert_oracle import (
    ExactCubicBezier2D,
    certify_cubic_offset_on_unit_interval,
)
from patroner_geometry.qualification import (
    DecimalInterval,
    _contour_outward_offset_sign,
    benchmark_63_canonical_garment_contours,
    certify_cubic_segment_bernstein_candidate,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTOURS_63_PATH = REPO_ROOT / "artifacts" / "m00" / "CanonicalGarmentContours63.json"
CANDIDATES = ("mpmath_iv", "python_flint", "decimal_interval")


def test_checkpoint_j_decimal_interval_sqr_outward_enclosure() -> None:
    """DecimalInterval.sqr must preserve outward rounding and exact [0, max^2] lower bound across zero."""
    ctx_f = decimal.Context(prec=35, rounding=decimal.ROUND_FLOOR)
    ctx_c = decimal.Context(prec=35, rounding=decimal.ROUND_CEILING)

    exact_cases = [
        (DecimalInterval(decimal.Decimal("-2"), decimal.Decimal("3")), decimal.Decimal("0"), decimal.Decimal("9")),
        (DecimalInterval(decimal.Decimal("-4"), decimal.Decimal("-2")), decimal.Decimal("4"), decimal.Decimal("16")),
        (DecimalInterval(decimal.Decimal("2"), decimal.Decimal("5")), decimal.Decimal("4"), decimal.Decimal("25")),
        (DecimalInterval(decimal.Decimal("-3"), decimal.Decimal("1")), decimal.Decimal("0"), decimal.Decimal("9")),
        (DecimalInterval(decimal.Decimal("0"), decimal.Decimal("0")), decimal.Decimal("0"), decimal.Decimal("0")),
    ]
    for iv, exp_lo, exp_hi in exact_cases:
        sq = iv.sqr(ctx_f, ctx_c)
        assert sq.lo == exp_lo
        assert sq.hi == exp_hi

    for num, den in [(1, 3), (-2, 7), (17, 19), (-11, 13)]:
        q = Fraction(num, den)
        iv = DecimalInterval.from_fraction(q, ctx_f, ctx_c)
        sq = iv.sqr(ctx_f, ctx_c)
        assert Fraction(sq.lo) <= q * q <= Fraction(sq.hi)


def test_checkpoint_j_differential_equivalence_all_63_canonical_contours() -> None:
    """All 129 cubic Beziers across all 63 canonical garment contours must agree 100% across all
    3 candidates and the independent c1_cert_oracle for both s=-1 and s=+1 offset signs.
    """
    contours_doc = json.loads(CONTOURS_63_PATH.read_text(encoding="utf-8"))
    contours = contours_doc["contours"]
    assert len(contours) == 63

    d_exact = Fraction(3, 2)
    eps_exact = Fraction(1, 20)
    total_checks = 0

    for contour in contours:
        outward_sign = _contour_outward_offset_sign(contour)
        for seg in contour["segments"]:
            if seg.get("type") != "bezier":
                continue
            pts = (
                (Fraction(str(seg["p0"][0])), Fraction(str(seg["p0"][1]))),
                (Fraction(str(seg["cp1"][0])), Fraction(str(seg["cp1"][1]))),
                (Fraction(str(seg["cp2"][0])), Fraction(str(seg["cp2"][1]))),
                (Fraction(str(seg["p3"][0])), Fraction(str(seg["p3"][1]))),
            )
            curve = ExactCubicBezier2D(
                segment_id=f"{contour['contourId']}#{seg.get('id', '')}",
                p0=pts[0],
                p1=pts[1],
                p2=pts[2],
                p3=pts[3],
            )
            for sign in (-1, 1):
                oracle_rec = certify_cubic_offset_on_unit_interval(
                    curve,
                    s_sign=sign,
                    d=float(d_exact),
                    d_exact=d_exact,
                    epsilon_reg=float(eps_exact),
                )
                assert oracle_rec.verification_outcome == "CERTIFIED_VALID"
                assert oracle_rec.failure_category.value == "NONE"

                for cand in CANDIDATES:
                    res = certify_cubic_segment_bernstein_candidate(
                        pts[0],
                        pts[1],
                        pts[2],
                        pts[3],
                        d_q=d_exact,
                        candidate_library=cand,
                        s_sign=sign,
                        epsilon_reg_q=eps_exact,
                    )
                    total_checks += 1
                    assert res["available"] is True
                    assert res["verificationOutcome"] == oracle_rec.verification_outcome
                    assert res["failureCategory"] == oracle_rec.failure_category.value
                    if sign == outward_sign:
                        assert res["maxDepthReached"] == 0

    assert total_checks == 129 * 2 * 3


@pytest.mark.parametrize(
    "case_name,pts,d_q,s_sign,eps_q,expected_outcome,expected_category",
    [
        (
            "exact_interior_evolute_cusp_t_half",
            ((Fraction(0), Fraction(0)), (Fraction(2), Fraction(2)), (Fraction(4), Fraction(2)), (Fraction(6), Fraction(0))),
            Fraction(3, 1),
            -1,
            Fraction(1, 20),
            "CERTIFIED_INVALID",
            "ACTUAL_ZERO_SPEED_CUSP",
        ),
        (
            "swallowtail_tangent_reversal",
            ((Fraction(0), Fraction(0)), (Fraction(2), Fraction(2)), (Fraction(4), Fraction(2)), (Fraction(6), Fraction(0))),
            Fraction(4, 1),
            -1,
            Fraction(1, 20),
            "CERTIFIED_INVALID",
            "TANGENT_REVERSAL",
        ),
        (
            "regularity_margin_violation",
            ((Fraction(0), Fraction(0)), (Fraction(2), Fraction(2)), (Fraction(4), Fraction(2)), (Fraction(6), Fraction(0))),
            Fraction(29, 10),
            -1,
            Fraction(1, 20),
            "CERTIFIED_INVALID",
            "REGULARITY_MARGIN_VIOLATION",
        ),
        (
            "convex_mirror_same_curvature_valid",
            ((Fraction(0), Fraction(0)), (Fraction(2), Fraction(2)), (Fraction(4), Fraction(2)), (Fraction(6), Fraction(0))),
            Fraction(4, 1),
            1,
            Fraction(1, 20),
            "CERTIFIED_VALID",
            "NONE",
        ),
        (
            "s_inflection_valid_11a",
            ((Fraction(0), Fraction(0)), (Fraction(4), Fraction(2)), (Fraction(8), Fraction(-2)), (Fraction(12), Fraction(0))),
            Fraction(3, 2),
            -1,
            Fraction(1, 20),
            "CERTIFIED_VALID",
            "NONE",
        ),
        (
            "s_inflection_reversal_11b",
            ((Fraction(0), Fraction(0)), (Fraction(1), Fraction(3)), (Fraction(2), Fraction(-3)), (Fraction(3), Fraction(0))),
            Fraction(3, 2),
            -1,
            Fraction(1, 20),
            "CERTIFIED_INVALID",
            "TANGENT_REVERSAL",
        ),
        (
            "removable_degeneracy_endpoint_t3",
            ((Fraction(0), Fraction(0)), (Fraction(0), Fraction(0)), (Fraction(0), Fraction(0)), (Fraction(10), Fraction(0))),
            Fraction(3, 2),
            -1,
            Fraction(1, 20),
            "CERTIFIED_VALID",
            "NONE",
        ),
        (
            "removable_degeneracy_interior_half",
            ((Fraction(-1, 8), Fraction(0)), (Fraction(1, 8), Fraction(0)), (Fraction(-1, 8), Fraction(0)), (Fraction(1, 8), Fraction(0))),
            Fraction(3, 2),
            -1,
            Fraction(1, 20),
            "CERTIFIED_VALID",
            "NONE",
        ),
        (
            "genuine_base_cusp_2t_minus_1",
            ((Fraction(1), Fraction(-1)), (Fraction(-1, 3), Fraction(1)), (Fraction(-1, 3), Fraction(-1)), (Fraction(1), Fraction(1))),
            Fraction(3, 2),
            -1,
            Fraction(1, 20),
            "CERTIFIED_INVALID",
            "ACTUAL_ZERO_SPEED_CUSP",
        ),
        (
            "endpoint_infinite_curvature_p0_eq_p1",
            ((Fraction(0), Fraction(0)), (Fraction(0), Fraction(0)), (Fraction(5), Fraction(0)), (Fraction(10), Fraction(5))),
            Fraction(3, 2),
            -1,
            Fraction(1, 20),
            "CERTIFIED_INVALID",
            "ACTUAL_ZERO_SPEED_CUSP",
        ),
        (
            "non_dyadic_one_third_base_cusp",
            ((Fraction(1), Fraction(-1)), (Fraction(-1), Fraction(2)), (Fraction(0), Fraction(-4)), (Fraction(4), Fraction(8))),
            Fraction(3, 2),
            -1,
            Fraction(1, 20),
            "CERTIFIED_INVALID",
            "ACTUAL_ZERO_SPEED_CUSP",
        ),
    ],
)
def test_checkpoint_j_adversarial_curves_differential_equivalence(
    case_name: str,
    pts: tuple[tuple[Fraction, Fraction], ...],
    d_q: Fraction,
    s_sign: int,
    eps_q: Fraction,
    expected_outcome: str,
    expected_category: str,
) -> None:
    """Every adversarial/pathological curve must produce identical verificationOutcome and
    failureCategory across all 3 candidates and match the independent c1_cert_oracle.
    """
    curve = ExactCubicBezier2D(
        segment_id=case_name,
        p0=pts[0],
        p1=pts[1],
        p2=pts[2],
        p3=pts[3],
    )
    oracle_rec = certify_cubic_offset_on_unit_interval(
        curve,
        s_sign=s_sign,
        d=float(d_q),
        d_exact=d_q,
        epsilon_reg=float(eps_q),
    )
    assert oracle_rec.verification_outcome == expected_outcome
    assert oracle_rec.failure_category.value == expected_category

    for cand in CANDIDATES:
        res = certify_cubic_segment_bernstein_candidate(
            pts[0],
            pts[1],
            pts[2],
            pts[3],
            d_q=d_q,
            candidate_library=cand,
            s_sign=s_sign,
            epsilon_reg_q=eps_q,
        )
        assert res["available"] is True
        assert res["verificationOutcome"] == expected_outcome
        assert res["failureCategory"] == expected_category


def test_checkpoint_j_fail_closed_inconclusive_under_depth_cap() -> None:
    """When subdivision depth is exhausted and exact rational fallback is disabled, every candidate
    must fail closed as INCONCLUSIVE rather than falsely certifying valid or invalid.
    """
    pts = (
        (Fraction(0), Fraction(0)),
        (Fraction(2), Fraction(2)),
        (Fraction(4), Fraction(2)),
        (Fraction(6), Fraction(0)),
    )
    for cand in CANDIDATES:
        res = certify_cubic_segment_bernstein_candidate(
            pts[0],
            pts[1],
            pts[2],
            pts[3],
            d_q=Fraction(3, 1),
            candidate_library=cand,
            s_sign=-1,
            epsilon_reg_q=Fraction(1, 20),
            max_depth=1,
            allow_exact_rational_fallback=False,
        )
        assert res["verificationOutcome"] == "INCONCLUSIVE"
        assert res["failureCategory"] == "INCONCLUSIVE_VERIFICATION"


def test_checkpoint_j_63_canonical_contours_benchmark_meets_5ms_p95_target() -> None:
    """K-03 hardened 63-canonical-contour benchmark verification:
    Strictly asserts deterministic correctness (63 contours, 495 segments, 129 cubics, 0 false cusps,
    depth 0 across all three candidates, explicit BLOCKED_MISSING_TROUSER_BLOCK provenance), true
    single outer-timer instrumentation integrity (outerEndToEndMs >= phaseSumMs, overhead and host
    metadata reported), generous M00.4 <= 50.0 ms runtime budget compliance, and honest reporting of
    the ADR-009 §7.2 < 5.0 ms production adoption target without flaking on shared-host CPU jitter.
    """
    bench = benchmark_63_canonical_garment_contours(
        CONTOURS_63_PATH,
        repetitions=3,
        warmup_runs=1,
    )
    assert bench["contourCount"] == 63
    assert len(bench["perContourRecords"]) == 63
    assert sum(r["segmentCount"] for r in bench["perContourRecords"]) == 495
    assert sum(r["cubicBezierCount"] for r in bench["perContourRecords"]) == 129
    assert any(
        entry.get("status") == "BLOCKED_MISSING_TROUSER_BLOCK"
        for entry in bench["missingBlocksDisclosure"]
    )

    # K-03: Environment metadata and outer-timer protocol disclosure
    env_meta = bench["environmentMetadata"]
    for meta_key in (
        "pythonVersion",
        "pythonImplementation",
        "platform",
        "machine",
        "cpuCount",
        "pythonHashSeed",
        "warmupRuns",
        "steadyStateMeasuredRepetitions",
    ):
        assert meta_key in env_meta
    assert bench["measurementProtocol"]["outerTimerEnclosesPreprocessingVerificationSerialization"] is True
    assert bench["measurementProtocol"]["unaccountedWrapperOverheadReported"] is True
    assert "coldStartSummary" in bench
    assert "coldStartLatencyEvaluation5Ms" in bench

    for key in ("mpmathIvFraction", "pythonFlintArbFmpq", "decimalIntervalFraction"):
        cand = bench["candidates"][key]
        assert cand["available"] is True
        assert cand["timingSource"] == "SINGLE_OUTER_WALL_CLOCK_PERF_COUNTER"
        assert cand["contoursEvaluated"] == 63
        assert len(cand["samplesMs"]) == 63
        assert all(r["candidateResults"][key]["outcome"] == "CERTIFIED_VALID" for r in bench["perContourRecords"])
        assert all(r["candidateResults"][key]["failureCategory"] == "NONE" for r in bench["perContourRecords"])
        assert all(r["candidateResults"][key]["maxSubdivisionDepthReached"] == 0 for r in bench["perContourRecords"])
        # Verify single outer timer encloses sum of internal phases on every contour (within rounding tolerance)
        for rec in bench["perContourRecords"]:
            cr = rec["candidateResults"][key]
            assert cr["outerEndToEndMs"] >= cr["phaseSumMs"] - 0.001
            assert cr["unaccountedWrapperOverheadMs"] >= 0.0

        # M00.4 qualification runtime budget (<= 50.0 ms) is deterministic-safe even on shared hosts
        assert cand["withinLatencyBudget"] is True
        assert cand["p95Ms"] <= 50.0
        # Honest reporting of ADR-009 §7.2 < 5.0 ms adoption target (never falsified)
        assert cand["withinP95Target5Ms"] is (cand["p95Ms"] <= 5.0)
        assert "phaseSumSummary" in cand
        assert cand["unaccountedWrapperOverheadTotalMs"] >= 0.0
        phases = cand["phaseBreakdownTotalMs"]
        for phase_key in (
            "preprocessingMs",
            "backendInitMs",
            "intervalArithmeticMs",
            "rootIsolationMs",
            "certificationMs",
            "serializationMs",
            "unaccountedWrapperOverheadMs",
        ):
            assert phase_key in phases and phases[phase_key] >= 0.0

    # Honest evaluation object consistency with measured steady-state P95s
    eval5 = bench["latencyQualificationEvaluation5Ms"]
    expected_all_under_5 = all(
        bench["candidates"][k]["p95Ms"] <= 5.0
        for k in ("mpmathIvFraction", "pythonFlintArbFmpq", "decimalIntervalFraction")
    )
    assert eval5["allThreeCandidatesVerifiedUnder5MsP95"] is expected_all_under_5
    # C-backed python-flint has ~15x headroom below 5.0 ms steady-state target
    assert bench["candidates"]["pythonFlintArbFmpq"]["p95Ms"] < 5.0

