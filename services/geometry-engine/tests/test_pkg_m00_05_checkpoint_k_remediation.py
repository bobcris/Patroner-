"""PKG-M00-05 — Adversarial & Regression Verification Suite for Checkpoint K (K-01 through K-07).

Independently verifies all seven Checkpoint K technical remediations:
- K-01: Intra-segment local self-intersection certification soundness (pinched crossings, exact closed-endpoint
        loops, non-crossing valid curves, and fail-closed unresolved/grazing handling across oracle & candidates).
- K-02: Exact-boundary completeness and bounded termination (K1..K5 curves across oracle & all 3 candidates,
        plus node-budget exhaustion fail-closed INCONCLUSIVE).
- K-03: Benchmark timing integrity (single outer end-to-end perf_counter timer >= phaseSumMs, wrapper overhead
        disclosure, complete host/environment metadata, honest withinP95Target5Ms consistency).
- K-04: Oracle-independence exact-module allowlist & dynamic/obfuscated import enforcement (12+ bypass vectors,
        benign stdlib patterns, and live repository audit).
- K-05: Strict single-run output isolation (--single-run --output-dir produces all 11 deterministic artifacts
        with zero workspace writes verified via SHA-256 and st_mtime_ns).
- K-06: 16-case Pydantic v2 and JSON Schema Draft 2020-12 certification-state parity for OffsetValidationRecord
        and contradictory OffsetClassificationReport enforcement.
- K-07: Historical report supersession notice, authoritative M02a-M02h reconciliation, and PKG-M00-05 evidence pack.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from fractions import Fraction
from pathlib import Path
from typing import Any, Dict, List, Tuple

import jsonschema
import pytest
from pydantic import ValidationError

from patroner_geometry.c1_cert_oracle import (
    ExactCubicBezier2D,
    certify_cubic_offset_on_unit_interval,
    certify_intra_segment_local_self_intersection,
)
from patroner_geometry.contracts import (
    OffsetClassificationReport,
    OffsetFailureCategory,
    verify_schemas_lock,
)
from patroner_geometry.qualification import (
    _certify_local_self_intersection_candidate,
    _coord_to_candidate_iv,
    _get_bernstein_candidate_tables,
    benchmark_63_canonical_garment_contours,
    certify_cubic_segment_bernstein_candidate,
    exact_offset_endpoints_coincide,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "packages" / "contracts" / "schemas" / "canonical_contracts.schema.json"
CANONICAL_63_PATH = REPO_ROOT / "artifacts" / "m00" / "CanonicalGarmentContours63.json"

if str(REPO_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "scripts"))

from check_oracle_independence import (  # noqa: E402
    audit_repository_oracle_independence,
    check_python_source_independence,
)

ALL_CANDIDATES = ("mpmath_iv", "python_flint", "decimal_interval")


# ---------------------------------------------------------------------------
# K-01: Local self-intersection certification soundness
# ---------------------------------------------------------------------------


def test_k01_pinched_regular_offset_crossing_detected_across_oracle_and_all_candidates() -> None:
    """Checkpoint K K-01 witness: regular cubic with zero cusps/reversals whose offset crosses itself."""
    pts_crossing = (
        (Fraction(0), Fraction(0)),
        (Fraction(-8), Fraction(20)),
        (Fraction(19, 2), Fraction(20)),
        (Fraction(3, 2), Fraction(0)),
    )
    curve = ExactCubicBezier2D(
        segment_id="k01-pinched-crossing",
        p0=pts_crossing[0],
        p1=pts_crossing[1],
        p2=pts_crossing[2],
        p3=pts_crossing[3],
    )

    # d=1.0, s=-1: pinched local self-intersection must be CERTIFIED_INVALID / LOCAL_OFFSET_SELF_INTERSECTION
    oracle_rec = certify_cubic_offset_on_unit_interval(
        curve,
        s_sign=-1,
        d=1.0,
        d_exact=Fraction(1),
        epsilon_reg=0.05,
    )
    assert oracle_rec.verification_outcome == "CERTIFIED_INVALID"
    assert oracle_rec.failure_category == OffsetFailureCategory.LOCAL_OFFSET_SELF_INTERSECTION
    assert oracle_rec.local_self_intersection_status == "DETECTED"
    assert len(oracle_rec.isolated_self_intersections) >= 1

    for cand in ALL_CANDIDATES:
        res = certify_cubic_segment_bernstein_candidate(
            pts_crossing[0],
            pts_crossing[1],
            pts_crossing[2],
            pts_crossing[3],
            d_q=Fraction(1),
            candidate_library=cand,
            s_sign=-1,
            epsilon_reg_q=Fraction(1, 20),
        )
        assert res["available"] is True
        assert res["verificationOutcome"] == "CERTIFIED_INVALID", f"{cand}: {res}"
        assert res["failureCategory"] == "LOCAL_OFFSET_SELF_INTERSECTION", f"{cand}: {res}"
        assert res["localSelfIntersectionStatus"] == "DETECTED", f"{cand}: {res}"
        assert res["isolatedLocalSelfIntersectionCount"] >= 1, f"{cand}: {res}"

    # d=0.1, s=-1: sufficiently small offset has no self-intersection -> CERTIFIED_VALID / NONE
    oracle_valid = certify_cubic_offset_on_unit_interval(
        curve,
        s_sign=-1,
        d=0.1,
        d_exact=Fraction(1, 10),
        epsilon_reg=0.05,
    )
    assert oracle_valid.verification_outcome == "CERTIFIED_VALID"
    assert oracle_valid.failure_category == OffsetFailureCategory.NONE
    assert oracle_valid.local_self_intersection_status == "NONE"
    assert oracle_valid.isolated_self_intersections == []

    for cand in ALL_CANDIDATES:
        res_v = certify_cubic_segment_bernstein_candidate(
            pts_crossing[0],
            pts_crossing[1],
            pts_crossing[2],
            pts_crossing[3],
            d_q=Fraction(1, 10),
            candidate_library=cand,
            s_sign=-1,
            epsilon_reg_q=Fraction(1, 20),
        )
        assert res_v["verificationOutcome"] == "CERTIFIED_VALID", f"{cand}: {res_v}"
        assert res_v["failureCategory"] == "NONE", f"{cand}: {res_v}"
        assert res_v["localSelfIntersectionStatus"] == "NONE", f"{cand}: {res_v}"


def test_k01_exact_closed_endpoint_loop_detected_across_oracle_and_all_candidates() -> None:
    """Exact algebraic coincidence O(0) == O(1) must be certified as LOCAL_OFFSET_SELF_INTERSECTION."""
    pts_closed = (
        (Fraction(0), Fraction(0)),
        (Fraction(-30), Fraction(40)),
        (Fraction(158, 5), Fraction(40)),
        (Fraction(8, 5), Fraction(0)),
    )
    da0 = (3 * (pts_closed[1][0] - pts_closed[0][0]), 3 * (pts_closed[1][1] - pts_closed[0][1]))
    db1 = (3 * (pts_closed[3][0] - pts_closed[2][0]), 3 * (pts_closed[3][1] - pts_closed[2][1]))
    assert exact_offset_endpoints_coincide(
        pts_closed[0], da0, pts_closed[3], db1, s_sign=-1, d_q=Fraction(1)
    )

    curve = ExactCubicBezier2D(
        segment_id="k01-exact-closed-loop",
        p0=pts_closed[0],
        p1=pts_closed[1],
        p2=pts_closed[2],
        p3=pts_closed[3],
    )
    oracle_rec = certify_cubic_offset_on_unit_interval(
        curve,
        s_sign=-1,
        d=1.0,
        d_exact=Fraction(1),
        epsilon_reg=0.05,
    )
    assert oracle_rec.verification_outcome == "CERTIFIED_INVALID"
    assert oracle_rec.failure_category == OffsetFailureCategory.LOCAL_OFFSET_SELF_INTERSECTION
    assert oracle_rec.local_self_intersection_status == "DETECTED"

    for cand in ALL_CANDIDATES:
        res = certify_cubic_segment_bernstein_candidate(
            pts_closed[0],
            pts_closed[1],
            pts_closed[2],
            pts_closed[3],
            d_q=Fraction(1),
            candidate_library=cand,
            s_sign=-1,
            epsilon_reg_q=Fraction(1, 20),
        )
        assert res["verificationOutcome"] == "CERTIFIED_INVALID", f"{cand}: {res}"
        assert res["failureCategory"] == "LOCAL_OFFSET_SELF_INTERSECTION", f"{cand}: {res}"
        assert res["localSelfIntersectionStatus"] == "DETECTED", f"{cand}: {res}"


def test_k01_unresolved_local_self_intersection_fails_closed_never_valid() -> None:
    """When local self-intersection cannot be certified separated or crossing (tight budget), fail closed."""
    pts_crossing = (
        (Fraction(0), Fraction(0)),
        (Fraction(-8), Fraction(20)),
        (Fraction(19, 2), Fraction(20)),
        (Fraction(3, 2), Fraction(0)),
    )
    curve = ExactCubicBezier2D(
        segment_id="k01-tight-budget",
        p0=pts_crossing[0],
        p1=pts_crossing[1],
        p2=pts_crossing[2],
        p3=pts_crossing[3],
    )
    oracle_res = certify_intra_segment_local_self_intersection(
        curve,
        s_sign=-1,
        d=1.0,
        d_exact=Fraction(1),
        max_depth=2,
        max_nodes=4,
    )
    assert oracle_res["status"] == "UNRESOLVED", oracle_res
    assert oracle_res["certifiedIntersections"] == []
    assert len(oracle_res["unresolvedBoxes"]) >= 1

    # Candidate helper with tight node budget
    dx_q = [3 * (pts_crossing[i + 1][0] - pts_crossing[i][0]) for i in range(3)]
    dy_q = [3 * (pts_crossing[i + 1][1] - pts_crossing[i][1]) for i in range(3)]
    for cand in ALL_CANDIDATES:
        tables = _get_bernstein_candidate_tables(cand, 113)
        dx_b = [_coord_to_candidate_iv(v, cand, tables) for v in dx_q]
        dy_b = [_coord_to_candidate_iv(v, cand, tables) for v in dy_q]
        status, _method, cnt = _certify_local_self_intersection_candidate(
            pts_crossing[0],
            pts_crossing[1],
            pts_crossing[2],
            pts_crossing[3],
            dx_b,
            dy_b,
            Fraction(1),
            -1,
            cand,
            tables,
            113,
            max_depth=2,
            max_nodes=4,
        )
        assert status == "UNRESOLVED", f"{cand}: expected UNRESOLVED under tight budget, got {status}"
        assert cnt == 0


# ---------------------------------------------------------------------------
# K-02: Exact-boundary completeness & bounded oracle termination
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("case_id", "d_q", "expected_outcome", "expected_cat"),
    [
        ("K1_just_below_margin", Fraction(57, 20) - Fraction(3, 10**38), "CERTIFIED_VALID", "NONE"),
        (
            "K2_just_above_margin",
            Fraction(57, 20) + Fraction(3, 10**38),
            "CERTIFIED_INVALID",
            "REGULARITY_MARGIN_VIOLATION",
        ),
        ("K3_exact_margin_boundary", Fraction(57, 20), "CERTIFIED_VALID", "NONE"),
        ("K4_exact_cusp_boundary", Fraction(3, 1), "CERTIFIED_INVALID", "ACTUAL_ZERO_SPEED_CUSP"),
        (
            "K5_micro_tangent_reversal",
            Fraction(3, 1) + Fraction(1, 10**30),
            "CERTIFIED_INVALID",
            "TANGENT_REVERSAL",
        ),
    ],
)
def test_k02_exact_and_near_boundary_k1_through_k5_complete_and_bounded(
    case_id: str,
    d_q: Fraction,
    expected_outcome: str,
    expected_cat: str,
) -> None:
    """All five Checkpoint K K-02 exact/near-boundary cases must match across oracle & all 3 candidates within < 5s."""
    pts = (
        (Fraction(0), Fraction(0)),
        (Fraction(2), Fraction(2)),
        (Fraction(4), Fraction(2)),
        (Fraction(6), Fraction(0)),
    )
    curve = ExactCubicBezier2D(
        segment_id=f"k02-{case_id}",
        p0=pts[0],
        p1=pts[1],
        p2=pts[2],
        p3=pts[3],
    )

    t0 = time.perf_counter()
    oracle_rec = certify_cubic_offset_on_unit_interval(
        curve,
        s_sign=-1,
        d=float(d_q),
        d_exact=d_q,
        epsilon_reg=0.05,
    )
    oracle_elapsed = time.perf_counter() - t0
    assert oracle_elapsed < 5.0, f"{case_id} oracle took {oracle_elapsed:.3f}s"
    assert oracle_rec.verification_outcome == expected_outcome, f"{case_id} oracle: {oracle_rec}"
    assert oracle_rec.failure_category.value == expected_cat, f"{case_id} oracle: {oracle_rec}"

    for cand in ALL_CANDIDATES:
        tc0 = time.perf_counter()
        res = certify_cubic_segment_bernstein_candidate(
            pts[0],
            pts[1],
            pts[2],
            pts[3],
            d_q=d_q,
            candidate_library=cand,
            s_sign=-1,
            epsilon_reg_q=Fraction(1, 20),
        )
        cand_elapsed = time.perf_counter() - tc0
        assert cand_elapsed < 5.0, f"{case_id} {cand} took {cand_elapsed:.3f}s"
        assert res["verificationOutcome"] == expected_outcome, f"{case_id} {cand}: {res}"
        assert res["failureCategory"] == expected_cat, f"{case_id} {cand}: {res}"


def test_k02_node_budget_exhaustion_fails_closed_inconclusive() -> None:
    """With exact rational fallback disabled and a strict node budget, boundary curves terminate fast and fail closed."""
    pts = (
        (Fraction(0), Fraction(0)),
        (Fraction(2), Fraction(2)),
        (Fraction(4), Fraction(2)),
        (Fraction(6), Fraction(0)),
    )
    d_q = Fraction(57, 20)
    curve = ExactCubicBezier2D(
        segment_id="k02-budget-fail-closed",
        p0=pts[0],
        p1=pts[1],
        p2=pts[2],
        p3=pts[3],
    )

    t0 = time.perf_counter()
    oracle_rec = certify_cubic_offset_on_unit_interval(
        curve,
        s_sign=-1,
        d=float(d_q),
        d_exact=d_q,
        epsilon_reg=0.05,
        max_subdivision_depth=3,
        max_nodes_per_tier=8,
        allow_exact_rational_fallback=False,
    )
    assert time.perf_counter() - t0 < 2.0
    assert oracle_rec.verification_outcome == "INCONCLUSIVE"
    assert oracle_rec.failure_category == OffsetFailureCategory.INCONCLUSIVE_VERIFICATION

    for cand in ALL_CANDIDATES:
        tc0 = time.perf_counter()
        res = certify_cubic_segment_bernstein_candidate(
            pts[0],
            pts[1],
            pts[2],
            pts[3],
            d_q=d_q,
            candidate_library=cand,
            s_sign=-1,
            epsilon_reg_q=Fraction(1, 20),
            max_depth=3,
            max_nodes_per_tier=8,
            allow_exact_rational_fallback=False,
        )
        assert time.perf_counter() - tc0 < 2.0
        assert res["verificationOutcome"] == "INCONCLUSIVE", f"{cand}: {res}"
        assert res["failureCategory"] == "INCONCLUSIVE_VERIFICATION", f"{cand}: {res}"


# ---------------------------------------------------------------------------
# K-03: Benchmark timing integrity & host-jitter robustness
# ---------------------------------------------------------------------------


def test_k03_outer_timer_integrity_and_environment_metadata() -> None:
    """Outer end-to-end perf_counter timer must enclose all phases, disclose overhead, and include host metadata."""
    assert CANONICAL_63_PATH.exists()
    bench = benchmark_63_canonical_garment_contours(
        CANONICAL_63_PATH,
        repetitions=1,
        warmup_runs=0,
    )
    assert bench["contourCount"] == 63
    proto = bench["measurementProtocol"]
    assert proto["timingMethod"] == "SINGLE_OUTER_PERF_COUNTER_PER_CONTOUR_PER_CANDIDATE"
    assert proto["outerTimerEnclosesPreprocessingVerificationSerialization"] is True
    assert proto["unaccountedWrapperOverheadReported"] is True

    env_meta = bench["environmentMetadata"]
    for req_key in (
        "pythonVersion",
        "platform",
        "cpuCount",
        "pythonHashSeed",
        "warmupRuns",
        "steadyStateMeasuredRepetitions",
    ):
        assert req_key in env_meta, f"Missing environmentMetadata.{req_key}"

    for cand_key in ("mpmathIvFraction", "pythonFlintArbFmpq", "decimalIntervalFraction"):
        cand = bench["candidates"][cand_key]
        assert cand["available"] is True
        assert cand["timingSource"] == "SINGLE_OUTER_WALL_CLOCK_PERF_COUNTER"
        assert cand["withinP95Target5Ms"] is (cand["p95Ms"] <= 5.0)
        assert "phaseSumSummary" in cand
        assert "unaccountedWrapperOverheadMeanMsPerContour" in cand
        assert cand["p95Ms"] >= cand["phaseSumSummary"]["p95Ms"] - 0.01

    for row in bench["perContourRecords"]:
        for cand_key in ("mpmathIvFraction", "pythonFlintArbFmpq", "decimalIntervalFraction"):
            cres = row["candidateResults"][cand_key]
            assert cres["outerEndToEndMs"] >= cres["phaseSumMs"] - 0.001
            assert cres["unaccountedWrapperOverheadMs"] >= -0.001

    assert bench["candidates"]["pythonFlintArbFmpq"]["p95Ms"] < 5.0


# ---------------------------------------------------------------------------
# K-04: Oracle-independence allowlist & dynamic/obfuscated import enforcement
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("bypass_id", "code_snippet"),
    [
        ("relative_sibling_import", "from .offset_kernel import fast_offset\n"),
        ("bare_package_import", "import patroner_geometry\n"),
        ("package_from_non_allowlisted_member", "from patroner_geometry import offset_kernel\n"),
        ("dunder_builtins_concat", "fn = getattr(__builtins__, '__imp' + 'ort__')\n"),
        ("vars_builtins_subscript", "import builtins\nfn = vars(builtins)['__import__']\n"),
        ("globals_builtins_subscript", "fn = globals()['__builtins__']['__import__']\n"),
        ("fstring_builtins_getattr", "import builtins\nfn = getattr(builtins, f'{\"__imp\"}{\"ort__\"}')\n"),
        ("dynamic_getattr_attr", "def load(mod, name):\n    return getattr(mod, name)\n"),
        ("sys_modules_dynamic_lookup", "import sys\ndef grab(k):\n    return sys.modules[k]\n"),
        ("subclasses_reflection", "subs = ().__class__.__base__.__subclasses__()\n"),
        ("importlib_util_loader", "import importlib.util\nspec = importlib.util.spec_from_file_location('x', 'x.py')\n"),
        ("dunder_import_concat", "m = __import__('patroner_geometry.' + 'c1_cert_oracle')\n"),
    ],
)
def test_k04_blocks_all_checkpoint_k_allowlist_and_dynamic_bypasses(
    bypass_id: str,
    code_snippet: str,
) -> None:
    """Every Checkpoint K K-04 allowlist or dynamic/obfuscated import bypass must be rejected."""
    violations = check_python_source_independence(
        code_snippet,
        module_role="tier2_oracle",
        filename="services/geometry-engine/patroner_geometry/c1_cert_oracle.py",
    )
    assert len(violations) >= 1, f"{bypass_id} bypassed oracle-independence audit!"


def test_k04_allows_exact_allowlist_and_benign_stdlib_patterns() -> None:
    """Exact allowlisted modules and legitimate stdlib idioms (importlib.metadata, re.compile) must pass."""
    clean_code = (
        "import importlib.metadata\n"
        "import re\n"
        "from patroner_geometry.contracts import OffsetValidationRecord\n"
        "from .contracts import CanonicalOffsetClassification\n"
        "PAT = re.compile(r'^[a-z]+$')\n"
        "VER = importlib.metadata.version('mpmath')\n"
        "def read_value(obj):\n"
        "    return getattr(obj, 'value', None)\n"
    )
    violations = check_python_source_independence(
        clean_code,
        module_role="tier2_oracle",
        filename="services/geometry-engine/patroner_geometry/c1_cert_oracle.py",
    )
    assert violations == [], f"Unexpected false-positive violations: {violations}"


def test_k04_live_repository_audit_passes_with_zero_violations() -> None:
    """The real Patroner workspace must pass oracle-independence and TS boundary audits with zero violations."""
    report = audit_repository_oracle_independence(REPO_ROOT)
    assert report["allPassed"] is True, report
    assert report["violationsCount"] == 0, report


# ---------------------------------------------------------------------------
# K-05: Strict single-run output isolation
# ---------------------------------------------------------------------------


def _snapshot_tree(paths: List[Path]) -> Dict[str, Tuple[str, int]]:
    snap: Dict[str, Tuple[str, int]] = {}
    for p in paths:
        if p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file():
                    rel = f.relative_to(REPO_ROOT).as_posix()
                    snap[rel] = (hashlib.sha256(f.read_bytes()).hexdigest(), f.stat().st_mtime_ns)
        elif p.is_file():
            rel = p.relative_to(REPO_ROOT).as_posix()
            snap[rel] = (hashlib.sha256(f.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
    return snap


def test_k05_single_run_output_dir_strictly_isolated_zero_workspace_writes(tmp_path: Path) -> None:
    """Executing m00_execute_all.py --single-run --output-dir <tmp> must not write or touch any workspace file."""
    watched = [REPO_ROOT / "artifacts" / "m00", *sorted(REPO_ROOT.glob("M00_*.json"))]
    before = _snapshot_tree(watched)

    out_dir = tmp_path / "isolated_run"
    env = dict(os.environ)
    env["PYTHONHASHSEED"] = "0"
    proc = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "m00_execute_all.py"), "--single-run", "--output-dir", str(out_dir)],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, f"stdout={proc.stdout}\nstderr={proc.stderr}"

    produced = sorted(p.name for p in out_dir.iterdir() if p.is_file())
    assert len(produced) == 11, f"Expected 11 isolated deterministic artifacts, got {produced}"

    after = _snapshot_tree(watched)
    assert after == before, "Workspace files were created, modified, or touched during --single-run --output-dir!"


# ---------------------------------------------------------------------------
# K-06: Contradictory certification states in Pydantic v2 & JSON Schema
# ---------------------------------------------------------------------------


def test_k06_all_16_contradictory_validation_records_rejected_by_pydantic_and_json_schema() -> None:
    """All 16 contradictory OffsetValidationRecord cases must be rejected identically by Pydantic and JSON Schema."""
    report = verify_schemas_lock(SCHEMA_PATH)
    assert report["allPassed"] is True, report
    assert report["contradictoryCertificationStateCount"] == 16
    for case in report["contradictoryCertificationStateResults"]:
        assert case["pydanticV2Rejected"] is True, case
        assert case["jsonSchemaRejected"] is True, case
        assert case["bothRejected"] is True, case


def test_k06_contradictory_classification_reports_rejected_by_pydantic_and_json_schema() -> None:
    """Contradictory OffsetClassificationReport states must be rejected by both Pydantic v2 and JSON Schema."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    report_schema = {
        "$schema": schema["$schema"],
        "$defs": schema["$defs"],
        "$ref": "#/$defs/OffsetClassificationReport",
    }
    validator = jsonschema.Draft202012Validator(report_schema)

    base_report: Dict[str, Any] = {
        "segmentId": "seg-k06",
        "canonicalOffsetClassification": "CERTIFIED_VALID",
        "activeClassificationsOnDomain": ["CERTIFIED_VALID"],
        "baseCurveSingularityClassification": "REGULAR_BASE_CURVE",
        "verificationOutcome": "CERTIFIED_VALID",
        "failureCategory": "NONE",
        "directionSign": -1,
        "offsetDistanceCm": 1.0,
        "minBaseSpeedSquaredQ": 10.0,
        "minOffsetSpeedFactorF": 0.5,
        "hasZeroSpeedCuspOnDomain": False,
        "hasTangentReversalOnDomain": False,
        "gridErrorCm": 0.001,
        "certifiedIntervalErrorCm": 0.002,
        "maxJoinTangentDeltaDeg": 0.1,
        "reparameterized": False,
        "trimmed": False,
        "isolatedRoots": [],
        "oracleTierUsed": "C1-Cert-113bit-Q",
        "isProductionReady": False,
    }
    # Sanity check: valid report passes both
    OffsetClassificationReport.model_validate(base_report)
    assert list(validator.iter_errors(base_report)) == []

    contradictory_reports = [
        # CERTIFIED_VALID with failureCategory != NONE
        {**base_report, "failureCategory": "TANGENT_REVERSAL"},
        # CERTIFIED_VALID with hasZeroSpeedCuspOnDomain = True
        {**base_report, "hasZeroSpeedCuspOnDomain": True},
        # CERTIFIED_VALID with GENUINE_BASE_CUSP
        {**base_report, "baseCurveSingularityClassification": "GENUINE_BASE_CUSP"},
        # CERTIFIED_VALID with minOffsetSpeedFactorF < 0.05
        {**base_report, "minOffsetSpeedFactorF": 0.02},
        # INCONCLUSIVE with non-INCONCLUSIVE activeClassificationsOnDomain
        {
            **base_report,
            "verificationOutcome": "INCONCLUSIVE",
            "canonicalOffsetClassification": "INCONCLUSIVE",
            "failureCategory": "INCONCLUSIVE_VERIFICATION",
            "activeClassificationsOnDomain": ["CERTIFIED_VALID"],
        },
        # CERTIFIED_INVALID with isProductionReady=True
        {
            **base_report,
            "verificationOutcome": "CERTIFIED_INVALID",
            "canonicalOffsetClassification": "TANGENT_REVERSAL",
            "activeClassificationsOnDomain": ["TANGENT_REVERSAL"],
            "failureCategory": "TANGENT_REVERSAL",
            "isProductionReady": True,
        },
    ]

    for idx, bad in enumerate(contradictory_reports, start=1):
        with pytest.raises(ValidationError):
            OffsetClassificationReport.model_validate(bad)
        js_errors = list(validator.iter_errors(bad))
        assert len(js_errors) >= 1, f"JSON Schema accepted contradictory OffsetClassificationReport #{idx}: {bad}"


# ---------------------------------------------------------------------------
# K-07: Evidence & report accuracy
# ---------------------------------------------------------------------------


def test_k07_supersession_notice_m02_reconciliation_and_evidence_pack() -> None:
    """Verify K-07 supersession notice, authoritative M02a-M02h table, and PKG-M00-05 evidence pack."""
    m04_report = (REPO_ROOT / "docs" / "evidence" / "pkg_m00_04" / "FINAL_VERIFICATION_REPORT.md").read_text(
        encoding="utf-8"
    )
    assert "SUPERSESSION NOTICE" in m04_report
    assert "docs/evidence/pkg_m00_05/FINAL_VERIFICATION_REPORT.md" in m04_report
    assert "# PATRONER — `PKG-M00-04` FINAL VERIFICATION REPORT" in m04_report

    track_b = (REPO_ROOT / "docs" / "prep" / "TRACK_B_ORIGINAL_ROADMAP_READINESS.md").read_text(encoding="utf-8")
    assert "## 5. PKG-M00-05 Reconciliation of `M02` Sub-Workload Labels" in track_b
    for required_token in (
        "`M02a`",
        "`M02b`",
        "`M02c`",
        "Adaptive Gauss-Legendre Arc-Length & Monotone Brent Inversion Kernel",
        "`M02d`",
        "`M02e`",
        "Certified Offset Curve Synthesis, Singularity Classification & Seam Allowance Trimming",
        "`M02f`",
        "`M02g`",
        "`M02h`",
    ):
        assert required_token in track_b, f"Missing {required_token} in TRACK_B_ORIGINAL_ROADMAP_READINESS.md"

    for doc_name in (
        "00_BASELINE_AND_TRACEABILITY_MATRIX.md",
        "K01_THROUGH_K07_REMEDIATION_DOSSIER.md",
        "FINAL_VERIFICATION_REPORT.md",
    ):
        doc_path = REPO_ROOT / "docs" / "evidence" / "pkg_m00_05" / doc_name
        assert doc_path.exists() and doc_path.stat().st_size > 500, f"Missing or empty {doc_path}"
