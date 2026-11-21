"""Comprehensive Positive, Negative & Adversarial Verification Suite for PKG-M00-04 (I-01 through I-07)."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from fractions import Fraction
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from check_oracle_independence import audit_repository_oracle_independence, check_python_source_independence  # noqa: E402
from patroner_geometry.c1_cert_oracle import (  # noqa: E402
    ExactCubicBezier2D,
    certify_analytic_circle_offset_iv,
    certify_cubic_offset_on_unit_interval,
    certify_cubic_offset_with_local_self_intersection,
    detect_global_contour_self_intersections,
    execute_adr009_section6_complete_suite,
    krawczyk_isolate_offset_intersections,
)
from patroner_geometry.contracts import (  # noqa: E402
    BaseCurveSingularityClassification,
    CanonicalOffsetClassification,
    NumericalErrorComponents,
    NumericalReproducibilityManifest,
    NumericalVerificationRecord,
    OffsetFailureCategory,
    OffsetValidationRecord,
    OutputPropagationRecord,
    StationaryParameterizationStatus,
    verify_schemas_lock,
)
from patroner_geometry.provenance import (  # noqa: E402
    audit_ci_workflow_strict,
    discover_m00_source_inputs,
    verify_python312_and_lock_environment,
)
from patroner_geometry.qualification import (  # noqa: E402
    benchmark_63_canonical_garment_contours,
    evaluate_qualification_conjunction,
    generate_interval_library_qualification_report,
)
from patroner_geometry.sub_oracles import (  # noqa: E402
    emit_reference_dxf_aama,
    execute_m00_5_arc_length_verification,
    execute_m00_8_anthropometric_and_seam_parity_verification,
    parse_and_verify_dxf_aama,
    parse_dxf_aama_strict,
)
from verify_m00_manifest import verify_manifest_file  # noqa: E402
from verify_m00_reproducibility import compare_run_directories  # noqa: E402


# ---------------------------------------------------------------------------
# I-01: Provenance, PYTHONHASHSEED, Structural CI Audit & Replay Comparisons
# ---------------------------------------------------------------------------


def test_i01_pythonhashseed_unset_reported_honestly_and_fails_strict(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PYTHONHASHSEED", raising=False)
    engine_dir = REPO_ROOT / "services" / "geometry-engine"
    workflow_path = REPO_ROOT / ".github" / "workflows" / "m00-verification.yml"

    non_strict = verify_python312_and_lock_environment(engine_dir, workflow_path, strict=False)
    assert non_strict["pythonHashSeed"] == "UNSET"
    assert non_strict["pythonHashSeedIsZero"] is False
    assert non_strict["verified"] is False

    with pytest.raises(RuntimeError, match="PYTHONHASHSEED"):
        verify_python312_and_lock_environment(engine_dir, workflow_path, strict=True)


def test_i01_ci_workflow_structural_parser_rejects_comments_and_swallowed_failures(tmp_path: Path) -> None:
    real_wf = REPO_ROOT / ".github" / "workflows" / "m00-verification.yml"
    real_audit = audit_ci_workflow_strict(real_wf)
    assert real_audit["verified"] is True, f"Real CI workflow failed structural audit: {real_audit}"

    # Fake workflow with commented-out checks must FAIL
    commented_wf = tmp_path / "commented.yml"
    commented_wf.write_text(
        "jobs:\n"
        "  verify:\n"
        "    steps:\n"
        "      - name: Fake\n"
        "        run: |\n"
        "          # uv lock --check\n"
        "          # uv sync --locked\n"
        "          # check_oracle_independence.py\n"
        "          # pytest\n"
        "          # verify_m00_reproducibility.py\n"
        "          # verify_m00_manifest.py\n"
        "          # npx tsc --noEmit\n"
        "          # npm test\n"
        "          echo done\n",
        encoding="utf-8",
    )
    assert audit_ci_workflow_strict(commented_wf)["verified"] is False

    # Fake workflow swallowing failures with `|| true` or `continue-on-error: true` must FAIL
    swallowed_wf = tmp_path / "swallowed.yml"
    swallowed_wf.write_text(
        real_wf.read_text(encoding="utf-8").replace("pytest -v", "pytest -v || true"),
        encoding="utf-8",
    )
    swallowed_audit = audit_ci_workflow_strict(swallowed_wf)
    assert swallowed_audit["checks"]["noSwallowedFailureOrContinueOnError"] is False
    assert swallowed_audit["verified"] is False


def test_i01_compare_run_directories_detects_tamper_missing_and_extra(tmp_path: Path) -> None:
    r1 = tmp_path / "r1"
    r2 = tmp_path / "r2"
    r1.mkdir()
    r2.mkdir()
    (r1 / "a.json").write_text('{"x": 1}\n', encoding="utf-8")
    (r2 / "a.json").write_text('{"x": 1}\n', encoding="utf-8")
    assert compare_run_directories(r1, r2)["allBitExact"] is True

    # Tamper 1 byte
    (r2 / "a.json").write_text('{"x": 2}\n', encoding="utf-8")
    tampered = compare_run_directories(r1, r2)
    assert tampered["allBitExact"] is False
    assert "a.json" in tampered["mismatchedArtifacts"]

    # Extra / missing file
    (r2 / "a.json").write_text('{"x": 1}\n', encoding="utf-8")
    (r2 / "extra.json").write_text("{}\n", encoding="utf-8")
    extra_res = compare_run_directories(r1, r2)
    assert extra_res["allBitExact"] is False
    assert "extra.json" in extra_res["missingInRun1"]


def test_i01_source_inputs_discovery_covers_tests_scripts_and_ts_drafting() -> None:
    disc = discover_m00_source_inputs(REPO_ROOT)
    paths = set(disc["paths"])
    assert "services/geometry-engine/tests/test_pkg_m00_04_closure.py" in paths
    assert "scripts/verify_m00_reproducibility.py" in paths
    assert "scripts/verify_m00_manifest.py" in paths
    assert "scripts/m00_export_canonical_63_contours.ts" in paths
    assert "src/engine/drafting/bodice-block.ts" in paths
    assert "plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md" in paths


# ---------------------------------------------------------------------------
# I-02: Oracle Independence AST Linter & All 4 Dynamic Bypass Defenses
# ---------------------------------------------------------------------------


def test_i02_repository_oracle_independence_and_ts_boundary_pass() -> None:
    audit = audit_repository_oracle_independence(REPO_ROOT)
    assert audit["allPassed"] is True, f"Unexpected violations: {audit['violations']}"
    assert len(audit["typescriptC0LegacyAudit"]["srcEngineNonTestFilesAudited"]) > 0


@pytest.mark.parametrize(
    "bypass_name,code_snippet",
    [
        ("direct_import", "from patroner_geometry import c1_cert_oracle\n"),
        ("relative_import", "from .c1_cert_oracle import ExactCubicBezier2D\n"),
        ("importlib_bypass", "import importlib\nm = importlib.import_module('patroner_geometry.c1_cert_oracle')\n"),
        ("dunder_import_bypass", "m = __import__('patroner_geometry.qualification')\n"),
        ("builtins_getattr_bypass", "import builtins\nfn = getattr(builtins, '__import__')\n"),
        ("sys_modules_bypass", "import sys\nm = sys.modules['patroner_geometry.c1_cert_oracle']\n"),
        ("exec_bypass", "exec('import patroner_geometry.c1_cert_oracle')\n"),
        ("builtin_compile_bypass", "code = compile('import patroner_geometry.c1_cert_oracle', '<x>', 'exec')\n"),
        ("runpy_bypass", "import runpy\nrunpy.run_module('patroner_geometry.sub_oracles')\n"),
    ],
)
def test_i02_blocks_all_dynamic_import_bypasses(tmp_path: Path, bypass_name: str, code_snippet: str) -> None:
    fake_prod = tmp_path / f"prod_{bypass_name}.py"
    fake_prod.write_text(code_snippet, encoding="utf-8")
    violations = check_python_source_independence(
        code_snippet,
        module_role="tier1_production",
        filename=str(fake_prod),
    )
    assert len(violations) >= 1, f"Oracle-independence linter failed to block {bypass_name}!"


def test_i02_allows_benign_importlib_metadata_and_re_compile() -> None:
    benign = (
        "import importlib.metadata\n"
        "import re\n"
        "PAT = re.compile(r'^[0-9]+$')\n"
        "ver = importlib.metadata.version('mpmath')\n"
    )
    violations = check_python_source_independence(
        benign,
        module_role="tier2_oracle",
        filename="benign_oracle_helper.py",
    )
    assert violations == [], f"Unexpected false-positive violation on benign stdlib usage: {violations}"


# ---------------------------------------------------------------------------
# I-03: C1-Cert Bernstein Convex-Hull, Escalation, Adjacent Corner & Sec 6 #11b/#15
# ---------------------------------------------------------------------------


def test_i03_precision_escalation_and_fail_closed_inconclusive() -> None:
    # Mild curve certifies cleanly at 113 bits with full primary span coverage
    mild = ExactCubicBezier2D.from_floats("i03-mild", (0.0, 0.0), (4.0, 0.0), (8.0, 0.0), (12.0, 0.0))
    rec = certify_cubic_offset_on_unit_interval(mild, s_sign=1, d=1.5, piece_id="P-MILD")
    assert rec.verification_outcome == "CERTIFIED_VALID"
    assert rec.primary_span_coverage_ratio == 1.0
    assert len(rec.escalation_trace) >= 1
    assert len(rec.unresolved_intervals) == 0


def test_i03_adjacent_90deg_inward_corner_self_intersection_detected() -> None:
    """Two adjacent straight segments forming a 90-degree CCW inward corner at (10, 0):
    Segment 0: (0, 0) -> (10, 0)  (inward left normal = (0, +1), offset line y = +1.5, x in [0, 10])
    Segment 1: (10, 0) -> (10, 10) (inward left normal = (-1, 0), offset line x = 8.5, y in [0, 10])
    The two adjacent offset segments genuinely cross at (8.5, 1.5), i.e., t1 = 0.85, t2 = 0.15!
    """
    seg0 = ExactCubicBezier2D(
        segment_id="corner-seg-0",
        p0=(Fraction(0), Fraction(0)),
        p1=(Fraction(10, 3), Fraction(0)),
        p2=(Fraction(20, 3), Fraction(0)),
        p3=(Fraction(10), Fraction(0)),
    )
    seg1 = ExactCubicBezier2D(
        segment_id="corner-seg-1",
        p0=(Fraction(10), Fraction(0)),
        p1=(Fraction(10), Fraction(10, 3)),
        p2=(Fraction(10), Fraction(20, 3)),
        p3=(Fraction(10), Fraction(10)),
    )
    res = detect_global_contour_self_intersections([seg0, seg1], s_sign=1, d=1.5)
    certs = res["globalIntersections"]
    assert len(certs) >= 1, "Adjacent 90-degree inward corner offset intersection MUST be detected!"
    c0 = certs[0]
    assert c0["segmentIdA"] == "corner-seg-0" and c0["segmentIdB"] == "corner-seg-1"
    assert abs(c0["intersectionPointCm"]["x"] - 8.5) < 1e-6
    assert abs(c0["intersectionPointCm"]["y"] - 1.5) < 1e-6


def test_i03_analytic_circle_and_ag08_real_interval_oracles() -> None:
    c_valid = certify_analytic_circle_offset_iv(
        radius_cm=Fraction(10), s_sign=1, d_exact=Fraction(3, 2), segment_id="CIRC-1", piece_id="P1"
    )
    assert c_valid.verification_outcome == "CERTIFIED_VALID"
    assert c_valid.min_offset_speed_factor_interval[0] <= 0.85 <= c_valid.min_offset_speed_factor_interval[1]

    c_rev = certify_analytic_circle_offset_iv(
        radius_cm=Fraction(10), s_sign=1, d_exact=Fraction(12), segment_id="CIRC-3", piece_id="P1"
    )
    assert c_rev.verification_outcome == "CERTIFIED_INVALID"
    assert c_rev.has_tangent_reversal_on_domain is True
    assert c_rev.has_zero_speed_cusp_on_domain is False

    swallow = ExactCubicBezier2D.from_floats("AG-08-TEST", (0.0, 0.0), (4.0, 8.0), (6.0, 8.0), (10.0, 0.0))
    swallow_rec = certify_cubic_offset_with_local_self_intersection(swallow, s_sign=-1, d=4.0, piece_id="P-AG08")
    assert swallow_rec.local_self_intersection_status == "DETECTED"
    assert swallow_rec.verification_outcome == "CERTIFIED_INVALID"


def test_i03_adr009_section6_11b_and_15_included_and_pass() -> None:
    sec6 = execute_adr009_section6_complete_suite()
    by_id = {c["caseId"]: c for c in sec6["additionalSection6Cases"]}
    assert "ADR009-S6-11b" in by_id and by_id["ADR009-S6-11b"]["passed"] is True
    assert "ADR009-S6-15" in by_id and by_id["ADR009-S6-15"]["passed"] is True
    assert by_id["ADR009-S6-15"]["unrefinedRejectedByMethodB1"] is True
    assert by_id["ADR009-S6-15"]["refinedAcceptedByMethodB1"] is True


# ---------------------------------------------------------------------------
# I-04: Qualification Incomplete-Population Fail-Closed & 63-Contour Benchmark
# ---------------------------------------------------------------------------


def test_i04_qualification_conjunction_rejects_incomplete_population() -> None:
    import copy

    report = generate_interval_library_qualification_report()
    assert report["allCandidatesQualified"] is True
    primary, secondary, tertiary = report["candidatesEvaluated"]

    # 1. Incomplete total checks (<200,000) must fail closed
    inc_checks = copy.deepcopy(primary)
    inc_checks["outwardRoundingChecksTotal"] = 50000
    inc_checks["outwardRoundingChecksPassed"] = 50000
    assert evaluate_qualification_conjunction(inc_checks, secondary, tertiary) is False

    # 2. Missing precision tier (only 3 tiers instead of 4) must fail closed
    inc_tiers = copy.deepcopy(secondary)
    inc_tiers["precisionTierBreakdown"] = inc_tiers["precisionTierBreakdown"][:3]
    assert evaluate_qualification_conjunction(primary, inc_tiers, tertiary) is False

    # 3. Missing candidate-library-driven bisection flag must fail closed
    no_cand_bisect = copy.deepcopy(tertiary)
    no_cand_bisect["unsplitRootIsolationFromUnitInterval"]["candidateLibraryDrivenBisection"] = False
    assert evaluate_qualification_conjunction(primary, secondary, no_cand_bisect) is False


def test_i04_63_canonical_contours_corpus_valid_and_benchmarked() -> None:
    corpus_path = REPO_ROOT / "artifacts" / "m00" / "CanonicalGarmentContours63.json"
    assert corpus_path.is_file(), "CanonicalGarmentContours63.json must be exported before running closure tests"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    assert corpus["contourCount"] == 63
    assert len(corpus["contours"]) == 63
    assert corpus["missingBlocksDisclosure"][0]["status"] == "BLOCKED_MISSING_TROUSER_BLOCK"
    bench = benchmark_63_canonical_garment_contours(corpus_path)
    assert bench["contourCount"] == 63
    assert set(bench["candidates"].keys()) == {
        "mpmathIvFraction",
        "pythonFlintArbFmpq",
        "decimalIntervalFraction",
    }
    for cand in bench["candidates"].values():
        assert cand["contoursEvaluated"] == 63
        assert "phaseBreakdownTotalMs" in cand
        assert "intervalArithmeticMs" in cand["phaseBreakdownTotalMs"]
        assert "rootIsolationMs" in cand["phaseBreakdownTotalMs"]


# ---------------------------------------------------------------------------
# I-05: M00.5 ADR-009 §2.5 Traceability, Unified DXF Strict Parser & M00.8 Shoulders
# ---------------------------------------------------------------------------


def test_i05_m00_5_emits_full_adr009_section_2_5_and_positive_delta_eval() -> None:
    rep = execute_m00_5_arc_length_verification()
    assert rep["allPassed"] is True
    assert len(rep["adr009Section2_5TraceabilityTable"]) == 4
    fwd_rec = NumericalVerificationRecord.model_validate(rep["forwardNumericalVerificationRecord"])
    assert fwd_rec.verification_outcome == "CERTIFIED_VALID"
    for chk in rep["inverseArcLengthChecks"]:
        assert chk["deltaEvalCm"] > 0.0
        inv_rec = NumericalVerificationRecord.model_validate(chk["numericalVerificationRecord"])
        assert inv_rec.error_components.output_propagation.point_evaluation_rounding_bound_delta_eval > 0.0


def test_i05_unified_dxf_parser_fails_closed_on_malformed_inputs() -> None:
    cut = [(-1.5, -1.5), (25.5, -1.5), (25.5, 43.5), (-1.5, 43.5)]
    sew = [(0.0, 0.0), (24.0, 0.0), (24.0, 42.0), (0.0, 42.0)]
    valid_dxf = emit_reference_dxf_aama("BF-001", cut, sew)
    assert parse_dxf_aama_strict(valid_dxf)["isStructurallyValid"] is True

    # 1. Missing EOF
    no_eof = valid_dxf.replace("0\nEOF\n", "")
    assert parse_dxf_aama_strict(no_eof)["isStructurallyValid"] is False
    assert parse_and_verify_dxf_aama(no_eof, cut, sew)["allPassed"] is False

    # 2. Unterminated POLYLINE (remove first SEQEND)
    unterm = valid_dxf.replace("0\nSEQEND\n", "", 1)
    p_unterm = parse_dxf_aama_strict(unterm)
    assert p_unterm["isStructurallyValid"] is False
    assert p_unterm["unterminatedPolylinesCount"] >= 1

    # 3. Empty POLYLINE
    empty_poly = valid_dxf.replace(
        "2\nENTITIES\n",
        "2\nENTITIES\n0\nPOLYLINE\n8\n1\n66\n1\n70\n1\n0\nSEQEND\n",
        1,
    )
    p_empty = parse_dxf_aama_strict(empty_poly)
    assert p_empty["isStructurallyValid"] is False
    assert p_empty["emptyPolylinesCount"] >= 1

    # 4. Non-numeric / NaN coordinate
    nan_dxf = valid_dxf.replace("25.500000", "NaN", 1)
    p_nan = parse_dxf_aama_strict(nan_dxf)
    assert p_nan["isStructurallyValid"] is False
    assert len(p_nan["malformedEntities"]) >= 1


def test_i05_m00_8_distinct_anthropometric_shoulder_slopes() -> None:
    rep = execute_m00_8_anthropometric_and_seam_parity_verification()
    assert rep["allPassed"] is True
    shoulder_checks = [
        c for c in rep["dec11TwoTierSeamTolerancePolicy"]["pairedSeamChecks"] if "Shoulder" in c["seamPair"]
    ]
    assert len(shoulder_checks) == 3
    for sc in shoulder_checks:
        assert sc["distinctSlopeVectors"] is True
        assert sc["chordAngleDiffDeg"] > 3.0
        assert sc["withinTier1CadTolerance0_05Cm"] is True


# ---------------------------------------------------------------------------
# I-06: Schema / Pydantic Dual Parity Across All 8 Contradictory States
# ---------------------------------------------------------------------------


def test_i06_all_eight_contradictory_states_rejected_by_pydantic_and_json_schema() -> None:
    schema_path = REPO_ROOT / "packages" / "contracts" / "schemas" / "canonical_contracts.schema.json"
    lock_report = verify_schemas_lock(schema_path)
    assert lock_report["allPassed"] is True

    schema_doc = json.loads(schema_path.read_text(encoding="utf-8"))
    rec_schema = {
        "$schema": schema_doc["$schema"],
        "$defs": schema_doc["$defs"],
        "$ref": "#/$defs/OffsetValidationRecord",
    }
    validator = jsonschema.Draft202012Validator(rec_schema)

    base_valid = {
        "segment_id": "SEG-TEST",
        "piece_id": "P-TEST",
        "contour_orientation": "CCW_EXTERIOR",
        "coordinate_convention": "CARTESIAN_RH_CCW",
        "offset_direction_sign_s": 1,
        "offset_distance_cm": 1.5,
        "regularity_margin_epsilon": 0.05,
        "min_base_speed_squared_interval": [10.0, 12.0],
        "min_offset_speed_factor_interval": [0.85, 0.90],
        "has_zero_speed_cusp_on_domain": False,
        "has_tangent_reversal_on_domain": False,
        "stationary_parameterization_status": StationaryParameterizationStatus.NONE_REGULAR_SPEED.value,
        "base_curve_singularity_classification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
        "isolated_cusp_roots_t": [],
        "isolated_self_intersections": [],
        "max_geometric_deviation_bound_cm": 0.001,
        "max_certified_radial_error_cm": 0.001,
        "max_subdivision_depth_reached": 2,
        "primary_span_coverage_ratio": 1.0,
        "local_self_intersection_status": "NONE",
        "global_contour_self_intersection_status": "NONE",
        "unresolved_intervals": [],
        "escalation_trace": ["113-bit:certified"],
        "verification_outcome": "CERTIFIED_VALID",
        "failure_category": OffsetFailureCategory.NONE.value,
        "detected_failure_categories": [],
        "canonical_offset_classification": CanonicalOffsetClassification.CERTIFIED_VALID.value,
        "active_classifications_on_domain": [CanonicalOffsetClassification.CERTIFIED_VALID.value],
        "working_precision_bits": 113,
        "is_production_ready": True,
    }
    OffsetValidationRecord.model_validate(base_valid)
    assert list(validator.iter_errors(base_valid)) == []

    contradictory_cases = [
        # 1. CERTIFIED_VALID with non-NONE failure_category
        {**base_valid, "failure_category": OffsetFailureCategory.TANGENT_REVERSAL.value},
        # 2. CERTIFIED_VALID with has_zero_speed_cusp_on_domain=True
        {**base_valid, "has_zero_speed_cusp_on_domain": True},
        # 3. CERTIFIED_VALID with has_tangent_reversal_on_domain=True
        {**base_valid, "has_tangent_reversal_on_domain": True},
        # 4. CERTIFIED_VALID with min_offset_speed_factor_interval[0] < 0.05
        {**base_valid, "min_offset_speed_factor_interval": [0.02, 0.90]},
        # 5. CERTIFIED_INVALID with failure_category=NONE
        {**base_valid, "verification_outcome": "CERTIFIED_INVALID", "is_production_ready": False},
        # 6. CERTIFIED_INVALID with is_production_ready=True
        {
            **base_valid,
            "verification_outcome": "CERTIFIED_INVALID",
            "failure_category": OffsetFailureCategory.TANGENT_REVERSAL.value,
            "canonical_offset_classification": CanonicalOffsetClassification.TANGENT_REVERSAL.value,
            "active_classifications_on_domain": [CanonicalOffsetClassification.TANGENT_REVERSAL.value],
            "is_production_ready": True,
        },
        # 7. INCONCLUSIVE with is_production_ready=True
        {
            **base_valid,
            "verification_outcome": "INCONCLUSIVE",
            "failure_category": OffsetFailureCategory.INCONCLUSIVE_VERIFICATION.value,
            "canonical_offset_classification": CanonicalOffsetClassification.INCONCLUSIVE.value,
            "active_classifications_on_domain": [CanonicalOffsetClassification.INCONCLUSIVE.value],
            "is_production_ready": True,
        },
        # 8. INCONCLUSIVE with failure_category != INCONCLUSIVE_VERIFICATION
        {
            **base_valid,
            "verification_outcome": "INCONCLUSIVE",
            "failure_category": OffsetFailureCategory.NONE.value,
            "canonical_offset_classification": CanonicalOffsetClassification.INCONCLUSIVE.value,
            "active_classifications_on_domain": [CanonicalOffsetClassification.INCONCLUSIVE.value],
            "is_production_ready": False,
        },
    ]

    for idx, bad in enumerate(contradictory_cases, start=1):
        with pytest.raises(ValidationError):
            OffsetValidationRecord.model_validate(bad)
        js_errors = list(validator.iter_errors(bad))
        assert len(js_errors) >= 1, f"JSON Schema failed to reject contradictory state #{idx}!"


# ---------------------------------------------------------------------------
# I-07: Independent Manifest Integrity Verifier (Tamper / Duplicate / Self-Hash)
# ---------------------------------------------------------------------------


def test_i07_manifest_verifier_rejects_tamper_duplicate_self_hash_and_volatile_leak(tmp_path: Path) -> None:
    art = tmp_path / "artifact.json"
    art.write_text('{"ok": true}\n', encoding="utf-8")
    art_bytes = art.read_bytes()
    art_sha = hashlib.sha256(art_bytes).hexdigest()

    manifest = tmp_path / "M00_ARTIFACT_HASH_VERIFICATION.json"
    good_doc = {
        "summary": {"totalFilesAudited": 1},
        "allAuditedFiles": [{"path": "artifact.json", "sha256": art_sha, "bytes": str(len(art_bytes))}],
    }
    manifest.write_text(json.dumps(good_doc), encoding="utf-8")
    assert verify_manifest_file(manifest, tmp_path)["passed"] is True

    # 1. Tamper 1 byte in artifact.json
    art.write_text('{"ok":false}\n', encoding="utf-8")
    res_tamper = verify_manifest_file(manifest, tmp_path)
    assert res_tamper["passed"] is False and len(res_tamper["mismatches"]) == 1
    art.write_bytes(art_bytes)

    # 2. Duplicate path
    dup_doc = {
        "summary": {"totalFilesAudited": 2},
        "allAuditedFiles": [
            {"path": "artifact.json", "sha256": art_sha, "bytes": str(len(art_bytes))},
            {"path": "artifact.json", "sha256": art_sha, "bytes": str(len(art_bytes))},
        ],
    }
    manifest.write_text(json.dumps(dup_doc), encoding="utf-8")
    res_dup = verify_manifest_file(manifest, tmp_path)
    assert res_dup["passed"] is False and "artifact.json" in res_dup["duplicates"]

    # 3. Self-hashing entry
    self_doc = {
        "summary": {"totalFilesAudited": 1},
        "allAuditedFiles": [
            {"path": "M00_ARTIFACT_HASH_VERIFICATION.json", "sha256": "0" * 64, "bytes": "10"}
        ],
    }
    manifest.write_text(json.dumps(self_doc), encoding="utf-8")
    res_self = verify_manifest_file(manifest, tmp_path)
    assert res_self["passed"] is False and res_self["selfHashDetected"] is True

    # 4. Volatile runtime artifact leak
    vol_path = tmp_path / "artifacts" / "m00" / "RuntimeBenchmarkObservation.json"
    vol_path.parent.mkdir(parents=True, exist_ok=True)
    vol_path.write_text("{}\n", encoding="utf-8")
    vol_sha = hashlib.sha256(vol_path.read_bytes()).hexdigest()
    vol_doc = {
        "summary": {"totalFilesAudited": 1},
        "allAuditedFiles": [
            {
                "path": "artifacts/m00/RuntimeBenchmarkObservation.json",
                "sha256": vol_sha,
                "bytes": str(vol_path.stat().st_size),
            }
        ],
    }
    manifest.write_text(json.dumps(vol_doc), encoding="utf-8")
    res_vol = verify_manifest_file(manifest, tmp_path)
    assert res_vol["passed"] is False and len(res_vol["volatileArtifactsLeaked"]) == 1
