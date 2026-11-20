"""Comprehensive Positive & Negative Verification Tests for PKG-M00-03 Stage 2 (REM-01 through REM-06).

Covers every defect and adversarial counterexample reproduced in PKG-M00-03 Stage 1:
- REM-01: Live Python 3.12 + uv.lock provenance, importlib.metadata pin parity, fail-closed pin mismatch, source-input digest.
- REM-02: Exact Q[t] polynomial root isolation (monic scale invariance, endpoint deflation, exact square-free decomposition,
          Sturm/Bernstein isolation, rational midpoint deflation, irrational roots, outward binary64 enclosure).
- REM-03: C1-Cert exact Q[t] GCD stationary-point detection (non-dyadic 1/1001, irrational 1/sqrt(2), removable degeneracy),
          Step 3 fail-closed INCONCLUSIVE on wrapping/depth cap, zero-speed clamp removal, static AST oracle independence.
- REM-04: Fair degree-12 Horner benchmark parity, >= 1,000 Bernstein checks across degrees {5, 9, 12}, canonical 113-bit
          hex-float endpoints, adversarial stress population, strict conjunctive qualification evaluator.
- REM-05: M00.5 quadrature convergence tracking + zero slack + full-precision tStar; M00.6 3-vertex folded triangle detection;
          M00.7 strict DXF vertex count parity (rejects truncated/empty polylines); M00.8 distinct side-seam curves across
          all 3 golden profiles.
- REM-06: Exact 7-value OffsetFailureCategory enum parity, OffsetClassificationReport fail-closed validator, complete
          PROV-04 SHA-256 manifest verification.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import sys
from fractions import Fraction
from pathlib import Path

import pytest
from pydantic import ValidationError

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from check_oracle_independence import (  # noqa: E402
    audit_repository_oracle_independence,
    check_python_source_independence,
)
from patroner_geometry.c1_cert_oracle import (  # noqa: E402
    ExactCubicBezier2D,
    certify_cubic_offset_on_unit_interval,
    compute_offset_approximation_errors_cm,
    execute_17_adversarial_geometry_families,
    fit_cubic_bezier_hermite_to_offset,
)
from patroner_geometry.contracts import (  # noqa: E402
    BaseCurveSingularityClassification,
    CanonicalOffsetClassification,
    OffsetClassificationReport,
    OffsetFailureCategory,
    verify_schemas_lock,
)
from patroner_geometry.provenance import (  # noqa: E402
    compute_source_inputs_digest,
    introspect_runtime_packages,
    parse_pyproject_pinned_packages,
    verify_python312_and_lock_environment,
)
from patroner_geometry.qualification import (  # noqa: E402
    benchmark_interval_candidates_runtime,
    build_deterministic_qualification_population,
    evaluate_qualification_conjunction,
    generate_interval_library_qualification_report,
    isolate_polynomial_roots_on_unit_interval,
)
from patroner_geometry.sub_oracles import (  # noqa: E402
    adaptive_gauss_legendre_arc_length_checked,
    emit_reference_dxf_aama,
    execute_m00_5_arc_length_verification,
    execute_m00_6_topology_verification,
    execute_m00_8_anthropometric_and_seam_parity_verification,
    parse_and_verify_dxf_aama,
    validate_polygon_topology_exact,
)

HEX_FLOAT_RE = re.compile(r"^-?0x[0-9a-f]+(\.[0-9a-f]+)?p[+-]\d+$")


# ---------------------------------------------------------------------------
# REM-01: Reproducible Environment & Live Runtime Provenance
# ---------------------------------------------------------------------------
def test_rem01_live_python312_lock_and_pin_parity() -> None:
    engine_dir = REPO_ROOT / "services" / "geometry-engine"
    workflow_path = REPO_ROOT / ".github" / "workflows" / "m00-verification.yml"
    pins = parse_pyproject_pinned_packages(engine_dir / "pyproject.toml")
    assert pins["mpmath"] == "1.4.1"
    assert pins["python-flint"] == "0.9.0"

    live = introspect_runtime_packages(pins, strict=True)
    assert live["allPinnedPackagesMatch"] is True
    assert live["mismatches"] == []

    env = verify_python312_and_lock_environment(engine_dir, workflow_path, strict=True)
    assert env["verified"] is True
    assert env["pythonIs312"] is True
    assert env["uvLockPresent"] is True
    assert env["ciWorkflowVerified"] is True

    # Negative check: mismatched pin must raise RuntimeError when strict=True
    bad_pins = {**pins, "mpmath": "9.9.9"}
    with pytest.raises(RuntimeError, match="provenance mismatch"):
        introspect_runtime_packages(bad_pins, strict=True)

    # Deterministic source-inputs digest across repeated invocations
    paths = [
        "services/geometry-engine/pyproject.toml",
        "services/geometry-engine/uv.lock",
        "packages/contracts/schemas/canonical_contracts.schema.json",
    ]
    d1 = compute_source_inputs_digest(REPO_ROOT, paths)
    d2 = compute_source_inputs_digest(REPO_ROOT, list(reversed(paths)))
    assert d1["allSourceInputsPresent"] is True
    assert d1["sourceInputsDigest"] == d2["sourceInputsDigest"]


# ---------------------------------------------------------------------------
# REM-02: Exact Algebraic Polynomial Root Isolation in Q[t] (B-03a..g, B-08)
# ---------------------------------------------------------------------------
def _poly_mul(a: list[Fraction], b: list[Fraction]) -> list[Fraction]:
    out = [Fraction(0)] * (len(a) + len(b) - 1)
    for i, ca in enumerate(a):
        for j, cb in enumerate(b):
            out[i + j] += ca * cb
    return out


def test_rem02_stage1_counterexamples_and_scale_invariance() -> None:
    # B-03a / p2 = (t - 1/2)^2 * (t - 1/4) -> exact distinct roots 1/4 (mult 1) and 1/2 (mult 2)
    p_mult = _poly_mul(_poly_mul([Fraction(-1, 2), Fraction(1)], [Fraction(-1, 2), Fraction(1)]), [Fraction(-1, 4), Fraction(1)])
    roots_mult = isolate_polynomial_roots_on_unit_interval(p_mult)
    assert len(roots_mult) == 2
    assert Fraction(roots_mult[0]["tLowerRational"]) == Fraction(1, 4)
    assert roots_mult[0]["exactMultiplicity"] == 1
    assert Fraction(roots_mult[1]["tLowerRational"]) == Fraction(1, 2)
    assert roots_mult[1]["exactMultiplicity"] == 2

    # B-03b: (t - 1/2)(t - 1/4) -> exact roots 1/4 and 1/2
    p_pair = _poly_mul([Fraction(-1, 2), Fraction(1)], [Fraction(-1, 4), Fraction(1)])
    roots_pair = isolate_polynomial_roots_on_unit_interval(p_pair)
    assert [Fraction(r["tLowerRational"]) for r in roots_pair] == [Fraction(1, 4), Fraction(1, 2)]

    # B-03c: strictly positive (t - 1/3)^2 + 10^-26 -> ZERO real roots (must NOT emit phantom root!)
    p_pos = [Fraction(1, 9) + Fraction(1, 10**26), Fraction(-2, 3), Fraction(1)]
    assert isolate_polynomial_roots_on_unit_interval(p_pos) == []

    # B-03d: endpoint root at t = 0 with no interior root: t(1 + t) -> single root at 0
    roots_t0 = isolate_polynomial_roots_on_unit_interval([Fraction(0), Fraction(1), Fraction(1)])
    assert len(roots_t0) == 1
    assert Fraction(roots_t0[0]["tLowerRational"]) == Fraction(0)
    assert Fraction(roots_t0[0]["tUpperRational"]) == Fraction(0)

    # B-03e: endpoint root t = 0 AND interior root t = 1/2: t(1 - 2t) -> both roots isolated
    roots_both = isolate_polynomial_roots_on_unit_interval([Fraction(0), Fraction(1), Fraction(-2)])
    assert [Fraction(r["tLowerRational"]) for r in roots_both] == [Fraction(0), Fraction(1, 2)]

    # B-03g: monic scale invariance under 10^-20 and 10^20
    scale_lo = [c * Fraction(1, 10**20) for c in p_mult]
    scale_hi = [c * Fraction(10**20) for c in p_mult]
    r_lo = isolate_polynomial_roots_on_unit_interval(scale_lo)
    r_hi = isolate_polynomial_roots_on_unit_interval(scale_hi)
    assert [(r["tLowerRational"], r["tUpperRational"], r["exactMultiplicity"]) for r in r_lo] == [
        (r["tLowerRational"], r["tUpperRational"], r["exactMultiplicity"]) for r in roots_mult
    ]
    assert [(r["tLowerRational"], r["tUpperRational"], r["exactMultiplicity"]) for r in r_hi] == [
        (r["tLowerRational"], r["tUpperRational"], r["exactMultiplicity"]) for r in roots_mult
    ]

    # Irrational root: 2t^2 - 1 = 0 -> t* = 1/sqrt(2) in (0, 1)
    roots_irr = isolate_polynomial_roots_on_unit_interval([Fraction(-1), Fraction(0), Fraction(2)])
    assert len(roots_irr) == 1
    lo_q = Fraction(roots_irr[0]["tLowerRational"])
    hi_q = Fraction(roots_irr[0]["tUpperRational"])
    assert 2 * lo_q * lo_q < 1 < 2 * hi_q * hi_q
    assert Fraction(roots_irr[0]["tLower"]) <= lo_q <= hi_q <= Fraction(roots_irr[0]["tUpper"])
    assert roots_irr[0]["deltaT"] <= 1e-12

    # B-08: Non-dyadic rational root t* = 1/3 must have tight exact rational bracket & outward binary64 enclosure
    roots_third = isolate_polynomial_roots_on_unit_interval([Fraction(-1, 3), Fraction(1)])
    assert len(roots_third) == 1
    lo_third = Fraction(roots_third[0]["tLowerRational"])
    hi_third = Fraction(roots_third[0]["tUpperRational"])
    assert lo_third <= Fraction(1, 3) <= hi_third
    assert (hi_third - lo_third) <= Fraction(1, 10**12)
    assert Fraction(roots_third[0]["tLower"]) <= lo_third <= Fraction(1, 3) <= hi_third <= Fraction(roots_third[0]["tUpper"])
    assert roots_third[0]["tLower"] < roots_third[0]["tUpper"]

    # Extreme Wilkinson cluster separation: Delta t = 1e-16
    r1 = Fraction(1, 2)
    r2 = Fraction(1, 2) + Fraction(1, 10**16)
    p_wilk = _poly_mul([-r1, Fraction(1)], [-r2, Fraction(1)])
    roots_wilk = isolate_polynomial_roots_on_unit_interval(p_wilk)
    assert len(roots_wilk) == 2
    assert Fraction(roots_wilk[0]["tUpperRational"]) < Fraction(roots_wilk[1]["tLowerRational"])


# ---------------------------------------------------------------------------
# REM-03: C1-Cert Exact GCD Stationary Points, Fail-Closed Step 3 & AST Audit
# ---------------------------------------------------------------------------
def _curve_from_power_coeffs(seg_id: str, ax: list[Fraction], ay: list[Fraction]) -> ExactCubicBezier2D:
    # Convert exact power basis [c0, c1, c2, c3] to cubic Bernstein control points
    def to_bern(c: list[Fraction]) -> list[Fraction]:
        b0 = c[0]
        b1 = c[0] + c[1] / 3
        b2 = c[0] + Fraction(2, 3) * c[1] + c[2] / 3
        b3 = c[0] + c[1] + c[2] + c[3]
        return [b0, b1, b2, b3]

    bx = to_bern(ax)
    by = to_bern(ay)
    return ExactCubicBezier2D(
        segment_id=seg_id,
        p0=(bx[0], by[0]),
        p1=(bx[1], by[1]),
        p2=(bx[2], by[2]),
        p3=(bx[3], by[3]),
    )


def test_rem03_non_dyadic_and_irrational_base_curve_singularities() -> None:
    # B-09a / B-09b: Non-dyadic cusp at t* = 1/1001: B(t) = ((1001t - 1)^2, (1001t - 1)^3)
    # (1001t - 1)^2 = 1 - 2002 t + 1002001 t^2
    # (1001t - 1)^3 = -1 + 3003 t - 3006003 t^2 + 1003003001 t^3
    cusp_1001 = _curve_from_power_coeffs(
        "cusp-1-over-1001",
        [Fraction(1), Fraction(-2002), Fraction(1002001), Fraction(0)],
        [Fraction(-1), Fraction(3003), Fraction(-3006003), Fraction(1003003001)],
    )
    rec = certify_cubic_offset_on_unit_interval(cusp_1001, s_sign=+1, d=1.0)
    assert rec.verification_outcome == "CERTIFIED_INVALID"
    assert rec.is_production_ready is False
    assert rec.has_zero_speed_cusp_on_domain is True
    assert rec.base_curve_singularity_classification == BaseCurveSingularityClassification.GENUINE_ZERO_SPEED_GEOMETRIC_CUSP_OR_FOLD
    assert len(rec.isolated_cusp_roots_t) == 1
    lo_f, hi_f = rec.isolated_cusp_roots_t[0]
    assert Fraction(lo_f) <= Fraction(1, 1001) <= Fraction(hi_f)

    # B-09c: Irrational stationary point at t* = 1/sqrt(2):
    # Choose x'(t) = 2t^2 - 1 -> x(t) = (2/3)t^3 - t, y(t) = (2/3)t^3 - t (collinear fold back at 1/sqrt(2)!)
    irr_fold = _curve_from_power_coeffs(
        "irrational-fold-1-over-sqrt2",
        [Fraction(0), Fraction(-1), Fraction(0), Fraction(2, 3)],
        [Fraction(0), Fraction(-1), Fraction(0), Fraction(2, 3)],
    )
    rec_irr = certify_cubic_offset_on_unit_interval(irr_fold, s_sign=+1, d=1.0)
    assert rec_irr.verification_outcome in ("CERTIFIED_INVALID", "INCONCLUSIVE")
    assert rec_irr.is_production_ready is False
    assert rec_irr.has_zero_speed_cusp_on_domain is True
    assert len(rec_irr.isolated_cusp_roots_t) == 1
    lo_i, hi_i = rec_irr.isolated_cusp_roots_t[0]
    assert 2 * (Fraction(lo_i) ** 2) <= 1 <= 2 * (Fraction(hi_i) ** 2)


def test_rem03_step3_fail_closed_inconclusive_and_zero_speed_error_clamp_removed() -> None:
    # Step 3 depth cap: with subdivision_panels=1, max_subdivision_depth=0 on a curved arc where coarse interval f(I)
    # straddles epsilon_reg or 0, oracle MUST fail closed to INCONCLUSIVE (never silently CERTIFY_VALID or misclassify!).
    curved = ExactCubicBezier2D.from_floats(
        "depth-cap-test", (0.0, 0.0), (0.0, 5.0), (5.0, 5.0), (5.0, 0.0)
    )
    rec_cap = certify_cubic_offset_on_unit_interval(
        curved, s_sign=+1, d=1.0, subdivision_panels=1, max_subdivision_depth=0
    )
    assert rec_cap.verification_outcome == "INCONCLUSIVE"
    assert rec_cap.failure_category == OffsetFailureCategory.INCONCLUSIVE_VERIFICATION
    assert rec_cap.canonical_offset_classification == CanonicalOffsetClassification.INCONCLUSIVE
    assert rec_cap.is_production_ready is False

    # Zero-speed clamp removal: compute_offset_approximation_errors_cm must raise ValueError on a zero-speed cusp curve
    cusp = ExactCubicBezier2D(
        segment_id="zero-speed-err-test",
        p0=(Fraction(1), Fraction(-1)),
        p1=(Fraction(-1, 3), Fraction(1)),
        p2=(Fraction(-1, 3), Fraction(-1)),
        p3=(Fraction(1), Fraction(1)),
    )
    approx = fit_cubic_bezier_hermite_to_offset(
        ExactCubicBezier2D.from_floats("dummy", (0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)),
        s_sign=-1,
        d=1.0,
    )
    with pytest.raises(ValueError, match="Zero or non-positive base speed squared"):
        compute_offset_approximation_errors_cm(cusp, approx, s_sign=-1, d=1.0, grid_samples=1024, interval_panels=16)
    with pytest.raises(ValueError, match=r"non-positive Q\(t\) lower bound"):
        compute_offset_approximation_errors_cm(cusp, approx, s_sign=-1, d=1.0, grid_samples=3, interval_panels=16)


def test_rem03_static_ast_oracle_independence_positive_and_negative() -> None:
    audit = audit_repository_oracle_independence(REPO_ROOT)
    assert audit["allPassed"] is True
    assert audit["violations"] == []

    # Negative AST tests: forbidden imports in both directions must be caught
    bad_oracle_source = "from patroner_geometry.solvers.offset_solver import fast_offset\n"
    violations = check_python_source_independence(
        bad_oracle_source,
        module_role="tier2_oracle",
        filename="patroner_geometry/c1_cert_oracle.py",
    )
    assert len(violations) == 1
    assert "Tier-2 verification oracle" in violations[0]["rule"]

    bad_prod_source = "import mpmath\nfrom patroner_geometry.c1_cert_oracle import certify_cubic_offset_on_unit_interval\n"
    violations_2 = check_python_source_independence(
        bad_prod_source,
        module_role="tier1_production",
        filename="patroner_geometry/solvers/offset_solver.py",
    )
    assert len(violations_2) == 2
    assert all("Tier-1 production module" in v["rule"] for v in violations_2)


def test_rem03_ag07_uses_genuine_oracle_not_hand_constructed_record() -> None:
    adv = execute_17_adversarial_geometry_families()
    fam_by_id = {f["familyId"]: f for f in adv["families"]}
    ag07 = fam_by_id["AG-07"]
    assert ag07["passed"] is True
    assert ag07["offsetValidationRecord"]["verification_outcome"] == "CERTIFIED_INVALID"
    assert ag07["offsetValidationRecord"]["has_zero_speed_cusp_on_domain"] is True
    # AG-01..AG-04 include genuine cubic-Bezier circle octant oracle cross-check
    for fid in ("AG-01", "AG-02", "AG-03", "AG-04"):
        assert "bezierOctantOracleCrossCheck" in fam_by_id[fid]


# ---------------------------------------------------------------------------
# REM-04: Fair Benchmark, >=1,000 Bernstein Checks, Canonical Hex, Stress & Conjunction
# ---------------------------------------------------------------------------
def test_rem04_fair_horner_benchmark_and_programmatic_op_counts() -> None:
    bench = benchmark_interval_candidates_runtime(iterations=5)
    meta = bench["metadata"]
    assert "sharedRationalPreprocessing" in bench
    op_counts = meta["deterministicOperationCountsPerBenchmarkIteration"]
    assert op_counts["identicalKernelAcrossAllThreeCandidates"] is True
    assert op_counts["sharedRationalPreprocessingSeparated"] is True
    assert op_counts["polynomialDegree"] == 12
    assert op_counts["hornerMultiplications"] == 12
    assert op_counts["hornerAdditions"] == 12
    assert op_counts["intervalCoefficientConversions"] == 13
    for cand_key in ("mpmathIvFraction", "pythonFlintArbFmpq", "decimalIntervalFraction"):
        assert bench["candidates"][cand_key]["available"] is True
        assert len(bench["candidates"][cand_key]["samplesMs"]) == 5


def test_rem04_qualification_bernstein_hex_stress_and_conjunction() -> None:
    pairs, sqrts, exact_refs = build_deterministic_qualification_population()
    assert len(pairs) == 10000
    assert len(sqrts) == 10000
    assert len(exact_refs) == 10000
    # Verify adversarial stress strata (subnormal, near-overflow, cancellation, tiny divisor) are present
    has_subnormal = any(abs(a_lo) > 0 and abs(a_lo) < Fraction(1, 2**1000) for (a_lo, _a_hi), (_b_lo, _b_hi) in pairs)
    has_near_overflow = any(abs(a_hi) >= Fraction(2**850) for (_a_lo, a_hi), (_b_lo, _b_hi) in pairs)
    assert has_subnormal is True
    assert has_near_overflow is True

    import mpmath
    mpmath.mp.prec = 53
    report = generate_interval_library_qualification_report()
    assert report["allCandidatesQualified"] is True
    for cand in report["candidatesEvaluated"]:
        assert cand["bernsteinContainmentChecksTotal"] >= 1000
        assert cand["bernsteinContainmentChecksPassed"] == cand["bernsteinContainmentChecksTotal"]
        assert set(cand["bernsteinDegreesVerified"]) == {5, 9, 12}

    # Canonical 53-bit & 113-bit binary hex-float verification on Primary candidate
    primary, secondary, tertiary = report["candidatesEvaluated"]
    enclosures = primary["sampleIntervalEnclosures"]
    assert {e["precisionBits"] for e in enclosures} == {53, 113}
    for nd in enclosures:
        assert HEX_FLOAT_RE.match(nd["lowerEndpointHex"])
        assert HEX_FLOAT_RE.match(nd["upperEndpointHex"])
        assert nd["lowerEndpointHex"] != nd["upperEndpointHex"]
        if nd["precisionBits"] == 113:
            assert len(nd["lowerEndpointHex"]) > 22
        assert nd["strictlyEnclosedInFraction"] is True

    # Negative conjunctive qualification test: flipping ANY single gate must fail allCandidatesQualified
    mutated = copy.deepcopy(secondary)
    mutated["bernsteinContainmentChecksPassed"] = 0
    assert evaluate_qualification_conjunction(primary, mutated, tertiary) is False

    mutated2 = copy.deepcopy(tertiary)
    mutated2["domainTrapsVerified"]["negativeSqrtDomainTrapDetected"] = False
    assert evaluate_qualification_conjunction(primary, secondary, mutated2) is False


# ---------------------------------------------------------------------------
# REM-05: Sub-Oracles Hardening (M00.5, M00.6, M00.7, M00.8)
# ---------------------------------------------------------------------------
def test_rem05_m00_5_quadrature_non_convergence_and_full_precision_tstar() -> None:
    # A sharp cusp curve with max_depth=1 and tight tol must explicitly report converged=False
    cusp = ExactCubicBezier2D(
        segment_id="stiff-cusp",
        p0=(Fraction(1), Fraction(-1)),
        p1=(Fraction(-1, 3), Fraction(1)),
        p2=(Fraction(-1, 3), Fraction(-1)),
        p3=(Fraction(1), Fraction(1)),
    )
    _val, _panels, converged = adaptive_gauss_legendre_arc_length_checked(
        cusp, t_end=1.0, panel_tol_cm=1e-12, max_depth=1
    )
    assert converged is False

    res5 = execute_m00_5_arc_length_verification()
    assert res5["allPassed"] is True
    assert res5["adaptiveGaussLegendreConverged"] is True
    for chk in res5["inverseArcLengthChecks"]:
        assert chk["tStarWithinBracket"] is True
        assert chk["tBracket"][0] <= chk["tStar"] <= chk["tBracket"][1]
        assert chk["quadratureConverged"] is True


def test_rem05_m00_6_folded_3_vertex_triangle_rejected() -> None:
    folded = [
        (Fraction(0), Fraction(0)),
        (Fraction(10), Fraction(0)),
        (Fraction(5), Fraction(0)),
        (Fraction(0), Fraction(0)),
    ]
    res = validate_polygon_topology_exact(folded, expected_winding="CCW")
    assert res["isSimple"] is False
    assert res["adjacentFoldBacksOrZeroEdges"] > 0
    assert res["passed"] is False

    m00_6 = execute_m00_6_topology_verification()
    assert m00_6["allPassed"] is True
    assert m00_6["foldedTriangle3VertexDegeneracyDetected"] is True


def test_rem05_m00_7_dxf_rejects_truncated_and_empty_polylines() -> None:
    cut_pts = [(-1.5, -1.5), (25.5, -1.5), (25.5, 43.5), (-1.5, 43.5)]
    sew_pts = [(0.0, 0.0), (24.0, 0.0), (24.0, 42.0), (0.0, 42.0)]

    # Truncated to 3 of 4 vertices on Layer 1 -> MUST FAIL (previously silently passed via zip!)
    truncated_dxf = emit_reference_dxf_aama("BF-001", cut_pts[:3], sew_pts)
    res_trunc = parse_and_verify_dxf_aama(truncated_dxf, cut_pts, sew_pts)
    assert res_trunc["allPassed"] is False
    assert res_trunc["vertexCountParityMatched"] is False
    assert res_trunc["syntheticRoundTripVerified"] is False
    assert res_trunc["dxfExportManifest"] is None

    # Empty Layer 1 polyline (0 vertices) -> MUST FAIL
    empty_cut_dxf = emit_reference_dxf_aama("BF-001", [], sew_pts)
    res_empty = parse_and_verify_dxf_aama(empty_cut_dxf, cut_pts, sew_pts)
    assert res_empty["allPassed"] is False
    assert res_empty["vertexCountParityMatched"] is False


def test_rem05_m00_8_distinct_side_seams_across_all_three_golden_profiles() -> None:
    res8 = execute_m00_8_anthropometric_and_seam_parity_verification()
    assert res8["allPassed"] is True
    assert res8["goldenProfilesEvaluatedForSeamParity"] == ["STD-XS", "STD-M", "PLUS-XXL"]
    seams = res8["dec11TwoTierSeamTolerancePolicy"]["pairedSeamChecks"]
    assert len(seams) == 9
    assert all(s["distinctControlPoints"] is True for s in seams)
    assert all(s["withinTier1CadTolerance0_05Cm"] is True for s in seams)


# ---------------------------------------------------------------------------
# REM-06: Exact 7-Value OffsetFailureCategory & OffsetClassificationReport Validator
# ---------------------------------------------------------------------------
def test_rem06_exact_7_value_enum_and_classification_report_fail_closed() -> None:
    schema_path = REPO_ROOT / "packages" / "contracts" / "schemas" / "canonical_contracts.schema.json"
    schema_doc = json.loads(schema_path.read_text(encoding="utf-8"))
    schema_enum = schema_doc["$defs"]["OffsetFailureCategory"]["enum"]
    py_enum = [e.value for e in OffsetFailureCategory]
    assert len(py_enum) == 7
    assert py_enum == schema_enum

    lock = verify_schemas_lock(schema_path)
    assert lock["allPassed"] is True
    assert len(lock["semanticInvariantChecks"]) >= 5

    # OffsetClassificationReport must reject INCONCLUSIVE + isProductionReady=True
    with pytest.raises(ValidationError, match="INCONCLUSIVE"):
        OffsetClassificationReport(
            segmentId="bad-rep",
            canonicalOffsetClassification=CanonicalOffsetClassification.INCONCLUSIVE,
            activeClassificationsOnDomain=[CanonicalOffsetClassification.INCONCLUSIVE],
            baseCurveSingularityClassification=BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
            verificationOutcome="INCONCLUSIVE",
            failureCategory=OffsetFailureCategory.INCONCLUSIVE_VERIFICATION,
            directionSign=-1,
            offsetDistanceCm=1.5,
            minBaseSpeedSquaredQ=10.0,
            minOffsetSpeedFactorF=0.04,
            hasZeroSpeedCuspOnDomain=False,
            hasTangentReversalOnDomain=False,
            gridErrorCm=0.0,
            certifiedIntervalErrorCm=0.0,
            maxJoinTangentDeltaDeg=0.0,
            reparameterized=False,
            trimmed=False,
            isolatedRoots=[],
            oracleTierUsed="C1-Cert-113bit-Q",
            isProductionReady=True,
        )

    # OffsetClassificationReport must reject gridErrorCm > certifiedIntervalErrorCm
    with pytest.raises(ValidationError, match="gridErrorCm"):
        OffsetClassificationReport(
            segmentId="bad-err-order",
            canonicalOffsetClassification=CanonicalOffsetClassification.CERTIFIED_VALID,
            activeClassificationsOnDomain=[CanonicalOffsetClassification.CERTIFIED_VALID],
            baseCurveSingularityClassification=BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
            verificationOutcome="CERTIFIED_VALID",
            failureCategory=OffsetFailureCategory.NONE,
            directionSign=-1,
            offsetDistanceCm=1.5,
            minBaseSpeedSquaredQ=10.0,
            minOffsetSpeedFactorF=1.1,
            hasZeroSpeedCuspOnDomain=False,
            hasTangentReversalOnDomain=False,
            gridErrorCm=0.01,
            certifiedIntervalErrorCm=0.001,
            maxJoinTangentDeltaDeg=0.0,
            reparameterized=False,
            trimmed=False,
            isolatedRoots=[],
            oracleTierUsed="C1-Cert-113bit-Q",
            isProductionReady=True,
        )
