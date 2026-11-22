#!/usr/bin/env python3
"""Master M00 Remediation Execution & Deterministic Evidence Generator (PKG-M00-04).

Supports two modes:
1. `--single-run --output-dir <dir>`:
   Executes one clean deterministic pass of M00.1–M00.8, Workstream B DXF/seams, C0-Legacy snapshot,
   and the ADR-009 §7.2 63-contour corpus into `<output-dir>` without running volatile benchmarks or
   mutating repo-root manifests. Used by `scripts/verify_m00_reproducibility.py` to verify true
   two-subprocess OS-isolated bit-exact determinism.
2. Default full mode:
   - Enforces live Python 3.12 + PYTHONHASHSEED=0 + uv.lock + structural CI workflow provenance.
   - Enforces static AST oracle-independence + TypeScript ADR-001 boundary audit.
   - Executes all deterministic M00 artifacts and verifies true two-subprocess OS-isolated replay.
   - Isolates ALL wall-clock benchmarks (10k population + ADR-009 §7.2 63 canonical garment contours)
     and timing-derived pass/fail booleans strictly inside `IntervalCandidateBenchmarks.json` and
     `RuntimeBenchmarkObservation.json` (never inside deterministic manifests!).
   - Builds a clean, non-self-hashing, duplicate-free `M00_ARTIFACT_HASH_VERIFICATION.json` with
     explicit separation between active PKG-M00-04 artifacts, compatibility mirrors, config/schemas,
     historical preserved Checkpoint 13A/15 reports, and M00 evidence/prep documentation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]
SYS_PATH_ENGINE = REPO_ROOT / "services" / "geometry-engine"
sys.path.insert(0, str(SYS_PATH_ENGINE))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from check_oracle_independence import audit_repository_oracle_independence  # noqa: E402
from m00_verify_production_dxf_and_seams import verify_exported_bundle  # noqa: E402
from patroner_geometry.c1_cert_oracle import (  # noqa: E402
    execute_17_adversarial_geometry_families,
    execute_adr009_section6_complete_suite,
)
from patroner_geometry.contracts import (  # noqa: E402
    BaseCurveSingularityClassification,
    CanonicalOffsetClassification,
    verify_schemas_lock,
)
from patroner_geometry.provenance import (  # noqa: E402
    compute_file_sha256,
    compute_source_inputs_digest,
    discover_m00_source_inputs,
    verify_python312_and_lock_environment,
)
from patroner_geometry.qualification import (  # noqa: E402
    benchmark_10k_population_runtimes,
    benchmark_63_canonical_garment_contours,
    evaluate_three_candidates_p95_latency,
    generate_interval_library_qualification_report,
)
from patroner_geometry.sub_oracles import (  # noqa: E402
    execute_m00_5_arc_length_verification,
    execute_m00_6_topology_verification,
    execute_m00_7_dxf_roundtrip_verification,
    execute_m00_8_anthropometric_and_seam_parity_verification,
)
from verify_m00_reproducibility import run_two_subprocess_reproducibility_check  # noqa: E402

HISTORICAL_ROOT_MARKDOWN_REPORTS: List[str] = [
    "M00_EVIDENCE_RECONCILIATION_REPORT.md",
    "M00_GATE_AUTH2_READINESS_MATRIX.md",
    "M00_GATE_AUTH2_READINESS_REPORT.md",
    "M00_NUMERICAL_QUALIFICATION_AUDIT.md",
    "M00_REMEDIATION_CHANGELOG.md",
]

ARTIFACTS_DIR = REPO_ROOT / "artifacts" / "m00"


def _tsx_runner_cmd() -> List[str]:
    local_tsx = REPO_ROOT / "node_modules" / ".bin" / "tsx"
    if local_tsx.is_file():
        return [str(local_tsx)]
    return ["npx", "--yes", "tsx"]


def serialize_deterministic_json(payload: Dict[str, Any]) -> Tuple[str, str]:
    serialized = json.dumps(payload, indent=2, sort_keys=False) + "\n"
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return serialized, digest


def write_json_file(path: Path, payload: Dict[str, Any], rel_root: Path = REPO_ROOT) -> Dict[str, str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized, digest = serialize_deterministic_json(payload)
    path.write_text(serialized, encoding="utf-8")
    try:
        rel = path.resolve().relative_to(rel_root.resolve()).as_posix()
    except ValueError:
        rel = path.name
    return {
        "artifact": path.name,
        "path": rel,
        "sha256": digest,
        "bytes": str(len(serialized.encode("utf-8"))),
    }


def _digest_existing_file(path: Path, category: str | None = None) -> Dict[str, str]:
    raw = path.read_bytes()
    entry: Dict[str, str] = {
        "artifact": path.name,
        "path": path.resolve().relative_to(REPO_ROOT.resolve()).as_posix(),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": str(len(raw)),
    }
    if category is not None:
        entry["category"] = category
    return entry


def build_adr009_section6_coverage_report(
    adv_report: Dict[str, Any],
    sec6_extra: Dict[str, Any],
) -> Dict[str, Any]:
    """Builds `M00_ADR009_SECTION6_COVERAGE_REPORT.json` mapping all 18 mandatory items of ADR-009 §6."""
    fam_by_id = {f["familyId"]: f for f in adv_report["families"]}
    extra_by_id = {c["caseId"]: c for c in sec6_extra["additionalSection6Cases"]}

    items_matrix: List[Dict[str, Any]] = [
        {
            "adr009Section6Item": 1,
            "specificationRequirement": "CCW Circle Case 1: Inward sub-critical offset (R=10, s=+1, d=1.5 < R -> f=0.85 >= 0.05)",
            "implementedByIds": ["AG-01"],
            "canonicalOffsetClassification": fam_by_id["AG-01"]["canonicalOffsetClassification"],
            "verificationOutcome": fam_by_id["AG-01"]["verificationOutcome"],
            "computedMetrics": {
                "offsetSpeedFactorF": fam_by_id["AG-01"]["offsetSpeedFactorF"],
                "gridErrorCm": fam_by_id["AG-01"]["gridErrorCm"],
                "certifiedIntervalErrorCm": fam_by_id["AG-01"]["certifiedIntervalErrorCm"],
            },
            "status": "PASS" if fam_by_id["AG-01"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 2,
            "specificationRequirement": "CCW Circle Case 2: Inward critical focal collapse (R=10, s=+1, d=10.0 = R -> f=0.0, O'(t)=0)",
            "implementedByIds": ["AG-02"],
            "canonicalOffsetClassification": fam_by_id["AG-02"]["canonicalOffsetClassification"],
            "verificationOutcome": fam_by_id["AG-02"]["verificationOutcome"],
            "computedMetrics": {
                "offsetSpeedFactorF": fam_by_id["AG-02"]["offsetSpeedFactorF"],
                "hasZeroSpeedCuspOnDomain": fam_by_id["AG-02"]["hasZeroSpeedCuspOnDomain"],
                "hasTangentReversalOnDomain": fam_by_id["AG-02"]["hasTangentReversalOnDomain"],
            },
            "status": "PASS" if fam_by_id["AG-02"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 3,
            "specificationRequirement": "CCW Circle Case 3: Inward super-critical tangent reversal (R=10, s=+1, d=12.0 > R -> f=-0.20 < 0, ||O'||=2 > 0)",
            "implementedByIds": ["AG-03"],
            "canonicalOffsetClassification": fam_by_id["AG-03"]["canonicalOffsetClassification"],
            "verificationOutcome": fam_by_id["AG-03"]["verificationOutcome"],
            "computedMetrics": {
                "offsetSpeedFactorF": fam_by_id["AG-03"]["offsetSpeedFactorF"],
                "offsetSpeedMagnitudeCmPerRad": fam_by_id["AG-03"]["offsetSpeedMagnitudeCmPerRad"],
                "hasZeroSpeedCuspOnDomain": fam_by_id["AG-03"]["hasZeroSpeedCuspOnDomain"],
                "hasTangentReversalOnDomain": fam_by_id["AG-03"]["hasTangentReversalOnDomain"],
            },
            "status": "PASS" if fam_by_id["AG-03"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 4,
            "specificationRequirement": "CCW Circle Case 4: Outward convex offset for both d=1.5 cm < R and d=12.0 cm > R (s=-1 -> f=1.15 and f=2.20)",
            "implementedByIds": ["AG-04"],
            "canonicalOffsetClassification": fam_by_id["AG-04"]["canonicalOffsetClassification"],
            "verificationOutcome": fam_by_id["AG-04"]["verificationOutcome"],
            "computedMetrics": {
                "subcase_d1_5_F": fam_by_id["AG-04"]["offsetSpeedFactorF"],
                "subcase_d12_0_F": fam_by_id["AG-04"]["outwardSuperRadiusSubcase_d12cm"]["offsetSpeedFactorF"],
            },
            "status": "PASS" if fam_by_id["AG-04"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 5,
            "specificationRequirement": "Interior removable parameterization degeneracy counterexample B(t) = (t^3, 0) at t*=0 (u*=0.5, m=3 odd)",
            "implementedByIds": ["AG-11"],
            "canonicalOffsetClassification": fam_by_id["AG-11"]["canonicalOffsetClassification"],
            "baseCurveSingularityClassification": fam_by_id["AG-11"]["baseCurveSingularityClassification"],
            "verificationOutcome": fam_by_id["AG-11"]["verificationOutcome"],
            "computedMetrics": {
                "taylorOrderM": fam_by_id["AG-11"]["taylorOrderM"],
                "limitingTangentMinus": fam_by_id["AG-11"]["limitingTangentMinus"],
                "limitingTangentPlus": fam_by_id["AG-11"]["limitingTangentPlus"],
                "limitingCurvature": fam_by_id["AG-11"]["limitingCurvature"],
            },
            "status": "PASS" if fam_by_id["AG-11"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 6,
            "specificationRequirement": "Interior genuine zero-speed base-curve geometric cusp B(t) = (t^2, t^3) at t*=0 (u*=0.5, m=2 even, n=3)",
            "implementedByIds": ["AG-09"],
            "canonicalOffsetClassification": fam_by_id["AG-09"]["canonicalOffsetClassification"],
            "baseCurveSingularityClassification": fam_by_id["AG-09"]["baseCurveSingularityClassification"],
            "verificationOutcome": fam_by_id["AG-09"]["verificationOutcome"],
            "computedMetrics": {
                "taylorOrdersMN": fam_by_id["AG-09"]["taylorOrdersMN"],
                "tangentReversalRadians": fam_by_id["AG-09"]["tangentReversalRadians"],
            },
            "status": "PASS" if fam_by_id["AG-09"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 7,
            "specificationRequirement": "Endpoint tangential degeneracy P1=P0 at t*=0: both collinear removable limit (B''x B'''=0) and non-collinear curvature blow-up (B''x B'''!=0)",
            "implementedByIds": ["AG-10", "AG-10a", "AG-10b"],
            "canonicalOffsetClassification": fam_by_id["AG-10"]["canonicalOffsetClassification"],
            "baseCurveSingularityClassification": fam_by_id["AG-10"]["baseCurveSingularityClassification"],
            "computedMetrics": {
                "collinearSubcase10aOutcome": fam_by_id["AG-10"]["collinearSubcase10a"]["verificationOutcome"],
                "nonCollinearSubcase10bOutcome": fam_by_id["AG-10"]["nonCollinearSingularSubcase10b"]["verificationOutcome"],
                "nonCollinearCrossProductB2B3": fam_by_id["AG-10"]["nonCollinearSingularSubcase10b"]["crossProductB2B3"],
            },
            "status": "PASS" if fam_by_id["AG-10"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 8,
            "specificationRequirement": "Coincident interior control points P1=P2 (AG-12) and Collapsed zero-length curve P0=P1=P2=P3 (ADR009-CASE5-COLLAPSED)",
            "implementedByIds": ["AG-12", "ADR009-CASE5-COLLAPSED"],
            "canonicalOffsetClassification": fam_by_id["AG-12"]["canonicalOffsetClassification"],
            "baseCurveSingularityClassification": extra_by_id["ADR009-CASE5-COLLAPSED"]["baseCurveSingularityClassification"],
            "computedMetrics": {
                "ag12MinQInterval": fam_by_id["AG-12"]["minBaseSpeedSquaredIntervalOnUnitDomain"],
                "collapsedOutcome": extra_by_id["ADR009-CASE5-COLLAPSED"]["verificationOutcome"],
            },
            "status": (
                "PASS"
                if (fam_by_id["AG-12"]["passed"] and extra_by_id["ADR009-CASE5-COLLAPSED"]["passed"])
                else "FAIL"
            ),
        },
        {
            "adr009Section6Item": 9,
            "specificationRequirement": "Regularity margin violation (0 < min f(t) = 0.02 < epsilon_reg = 0.05 -> REGULARITY_MARGIN_VIOLATION)",
            "implementedByIds": ["ADR009-S6-09"],
            "canonicalOffsetClassification": extra_by_id["ADR009-S6-09"]["canonicalOffsetClassification"],
            "verificationOutcome": extra_by_id["ADR009-S6-09"]["verificationOutcome"],
            "computedMetrics": {
                "minOffsetSpeedFactorInterval": extra_by_id["ADR009-S6-09"]["minOffsetSpeedFactorInterval"],
                "regularityMarginEpsilon": extra_by_id["ADR009-S6-09"]["regularityMarginEpsilon"],
            },
            "status": "PASS" if extra_by_id["ADR009-S6-09"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 10,
            "specificationRequirement": "Convex vs concave mirror-image sign discrimination with identical |kappa(t)| = 1.2/d and sign gate s*d*C(t)",
            "implementedByIds": ["ADR009-S6-10"],
            "canonicalOffsetClassification": extra_by_id["ADR009-S6-10"]["canonicalOffsetClassification"],
            "computedMetrics": {
                "convexOutcome": extra_by_id["ADR009-S6-10"]["convexOutcome"],
                "concaveOutcome": extra_by_id["ADR009-S6-10"]["concaveOutcome"],
                "concaveClassification": extra_by_id["ADR009-S6-10"]["concaveClassification"],
                "signBlindSquaredPolynomialAtHalf": extra_by_id["ADR009-S6-10"]["signBlindSquaredPolynomialAtHalf"],
            },
            "status": "PASS" if extra_by_id["ADR009-S6-10"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 11,
            "specificationRequirement": "Grazing tangential curvature extremum (AG-07), high-curvature transverse cusp pair (AG-06), and S-curve inflection + concave super-critical half (#11b)",
            "implementedByIds": ["AG-06", "AG-07", "ADR009-S6-11b"],
            "canonicalOffsetClassification": fam_by_id["AG-07"]["canonicalOffsetClassification"],
            "computedMetrics": {
                "ag06IsolatedRootsCount": len(fam_by_id["AG-06"]["isolatedRoots"]),
                "ag07IsolatedGrazingRoot": fam_by_id["AG-07"]["isolatedRoots"][0],
                "sCurve11bInflectionCAtHalf": extra_by_id["ADR009-S6-11b"]["C_at_0_5"],
                "sCurve11bMinOffsetSpeedFactorInterval": extra_by_id["ADR009-S6-11b"]["minOffsetSpeedFactorInterval"],
                "sCurve11bIsolatedCuspRootsCount": extra_by_id["ADR009-S6-11b"]["isolatedCuspRootsCount"],
                "sCurve11bOutcome": extra_by_id["ADR009-S6-11b"]["verificationOutcome"],
            },
            "status": (
                "PASS"
                if (
                    fam_by_id["AG-06"]["passed"]
                    and fam_by_id["AG-07"]["passed"]
                    and extra_by_id["ADR009-S6-11b"]["passed"]
                )
                else "FAIL"
            ),
        },
        {
            "adr009Section6Item": 12,
            "specificationRequirement": "Local swallowtail self-intersection O(t1*) = O(t2*) isolation & trimming",
            "implementedByIds": ["AG-08"],
            "canonicalOffsetClassification": fam_by_id["AG-08"]["canonicalOffsetClassification"],
            "computedMetrics": {
                "selfIntersectionCertificate": fam_by_id["AG-08"]["selfIntersectionCertificate"],
                "swallowtailTrimParameters": fam_by_id["AG-08"]["swallowtailTrimParameters"],
            },
            "status": "PASS" if fam_by_id["AG-08"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 13,
            "specificationRequirement": "Global non-local contour self-intersection O_i(t1*) = O_j(t2*) where individual segments are locally regular",
            "implementedByIds": ["AG-15"],
            "canonicalOffsetClassification": fam_by_id["AG-15"]["canonicalOffsetClassification"],
            "computedMetrics": {
                "locallyRegularEverywhere": fam_by_id["AG-15"]["locallyRegularEverywhere"],
                "globalSelfIntersectionsDetected": fam_by_id["AG-15"]["globalSelfIntersectionsDetected"],
                "globalIntersections": fam_by_id["AG-15"]["globalIntersections"],
            },
            "status": "PASS" if fam_by_id["AG-15"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 14,
            "specificationRequirement": "Collinear & near-flat (1e-7 cm deflection) cubic Bezier Method C1-Cert non-strict arc-length enclosure (L_chord <= L_exact <= L_poly)",
            "implementedByIds": ["ADR009-S6-14"],
            "canonicalOffsetClassification": extra_by_id["ADR009-S6-14"]["canonicalOffsetClassification"],
            "computedMetrics": {
                "collinearEnclosure": extra_by_id["ADR009-S6-14"]["collinearEnclosure"],
                "nearFlat1e7Enclosure": extra_by_id["ADR009-S6-14"]["nearFlat1e7Enclosure"],
            },
            "status": "PASS" if extra_by_id["ADR009-S6-14"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 15,
            "specificationRequirement": "Extreme parametric speed ratio (AG-13) & Method B1 steep-parameterization ||B'|| >= 50 cm/t unrefined reject vs refined accept (#15)",
            "implementedByIds": ["AG-13", "ADR009-S6-15"],
            "canonicalOffsetClassification": fam_by_id["AG-13"]["canonicalOffsetClassification"],
            "computedMetrics": {
                "speedSquaredRatioMaxOverMin": fam_by_id["AG-13"]["speedSquaredRatioMaxOverMin"],
                "maxSpeedOnRootBracketCmPerUnit": fam_by_id["AG-13"]["maxSpeedOnRootBracketCmPerUnit"],
                "bracketDeltaT": fam_by_id["AG-13"]["bracketDeltaT"],
                "bracketDeltaPosCm": fam_by_id["AG-13"]["bracketDeltaPosCm"],
                "steepParamMaxSpeedCmPerT": extra_by_id["ADR009-S6-15"]["unrefinedMaxSpeedCmPerT"],
                "steepParamUnrefinedRejected": extra_by_id["ADR009-S6-15"]["unrefinedRejectedByMethodB1"],
                "steepParamRefinedAccepted": extra_by_id["ADR009-S6-15"]["refinedAcceptedByMethodB1"],
            },
            "status": (
                "PASS"
                if (fam_by_id["AG-13"]["passed"] and extra_by_id["ADR009-S6-15"]["passed"])
                else "FAIL"
            ),
        },
        {
            "adr009Section6Item": 16,
            "specificationRequirement": "INCONCLUSIVE boundary-straddling fail-closed handling (f(I_k) straddles epsilon_reg at depth limit -> INCONCLUSIVE, is_production_ready=False)",
            "implementedByIds": ["ADR009-S6-16"],
            "canonicalOffsetClassification": extra_by_id["ADR009-S6-16"]["canonicalOffsetClassification"],
            "verificationOutcome": extra_by_id["ADR009-S6-16"]["verificationOutcome"],
            "computedMetrics": {
                "minOffsetSpeedFactorInterval": extra_by_id["ADR009-S6-16"]["minOffsetSpeedFactorInterval"],
                "isProductionReady": extra_by_id["ADR009-S6-16"]["isProductionReady"],
            },
            "status": "PASS" if extra_by_id["ADR009-S6-16"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 17,
            "specificationRequirement": "Whole-interval [0, 1] coverage & anti-bypass guard (interior cusp at t*=0.25, non-dyadic cusp at t*=1/3, and 2% short-span bypass rejection)",
            "implementedByIds": ["ADR009-S6-17"],
            "canonicalOffsetClassification": extra_by_id["ADR009-S6-17"]["canonicalOffsetClassification"],
            "computedMetrics": {
                "naive3PointSamplerFalselyRegularAt0_05_1": extra_by_id["ADR009-S6-17"]["naive3PointSamplerFalselyRegularAt0_05_1"],
                "wholeIntervalOracleCaught025Cusp": extra_by_id["ADR009-S6-17"]["wholeIntervalOracleCaught025Cusp"],
                "wholeIntervalOracleCaughtNonDyadicOneThirdCusp": extra_by_id["ADR009-S6-17"]["wholeIntervalOracleCaughtNonDyadicOneThirdCusp"],
                "shortSpan2PercentBypassRejected": extra_by_id["ADR009-S6-17"]["shortSpan2PercentBypassRejected"],
            },
            "status": "PASS" if extra_by_id["ADR009-S6-17"]["passed"] else "FAIL",
        },
        {
            "adr009Section6Item": 18,
            "specificationRequirement": "Wilkinson near-multiple root clusters (Delta t = 1e-7 and 1e-9) unsplit isolation from [0, 1], inflection point (AG-05), acute miter bevel (AG-14), and full bodice integration (AG-17)",
            "implementedByIds": ["AG-05", "AG-14", "AG-16", "AG-17"],
            "canonicalOffsetClassification": fam_by_id["AG-16"]["canonicalOffsetClassification"],
            "computedMetrics": {
                "ag16ManualPreSplittingUsed": fam_by_id["AG-16"]["manualPreSplittingUsed"],
                "ag16Disjoint1e7": fam_by_id["AG-16"]["disjointBracketsVerified1e7"],
                "ag16Disjoint1e9": fam_by_id["AG-16"]["disjointBracketsVerified1e9"],
                "ag17GridErrorCm": fam_by_id["AG-17"]["offsetClassificationReport"]["gridErrorCm"],
                "ag17CertifiedIntervalErrorCm": fam_by_id["AG-17"]["offsetClassificationReport"]["certifiedIntervalErrorCm"],
            },
            "status": (
                "PASS"
                if all(fam_by_id[k]["passed"] for k in ("AG-05", "AG-14", "AG-16", "AG-17"))
                else "FAIL"
            ),
        },
    ]

    all_passed = all(item["status"] == "PASS" for item in items_matrix)
    return {
        "deliverable": "M00_ADR009_SECTION6_COVERAGE_REPORT.json",
        "checkpoint": "PKG-M00-04",
        "packageId": "PKG-M00-04",
        "governingADR": "ADR-009 (R2.1.2-R1 §6 Mandatory Test Cases)",
        "totalSpecificationItemsRequired": 18,
        "totalSpecificationItemsImplemented": len(items_matrix),
        "totalSpecificationItemsPassed": sum(1 for item in items_matrix if item["status"] == "PASS"),
        "extendedSection6CasesAddedInPkgM0004": ["ADR009-S6-11B", "ADR009-S6-15"],
        "coverageMatrix": items_matrix,
        "allPassed": all_passed,
    }


def build_classification_conformance_report(
    adv_report: Dict[str, Any],
    sec6_extra: Dict[str, Any],
) -> Dict[str, Any]:
    """Builds `M00_CLASSIFICATION_CONFORMANCE_REPORT.json` with programmatically derived conformance checks."""
    fam_by_id = {f["familyId"]: f for f in adv_report["families"]}
    extra_by_id = {c["caseId"]: c for c in sec6_extra["additionalSection6Cases"]}

    canonical_offset_taxonomy = [
        {
            "classification": CanonicalOffsetClassification.CERTIFIED_VALID.value,
            "adr009Section": "§4.3 / §5.3 (verification_outcome = CERTIFIED_VALID, failure_category = NONE)",
            "mathematicalCondition": "Q(t) > 0 (or removable degeneracy) and f(t) = 1 - s*d*kappa(t) >= epsilon_reg = 0.05 across [0, 1], zero local/global self-intersections",
            "verifiedByCases": ["AG-01", "AG-04", "AG-05", "AG-10a", "AG-11", "AG-12", "AG-13", "AG-14", "AG-17", "ADR009-S6-10 (convex)"],
        },
        {
            "classification": CanonicalOffsetClassification.REGULARITY_MARGIN_VIOLATION.value,
            "adr009Section": "§4.4 Category 1",
            "mathematicalCondition": "Q(t) > 0 and 0 < min_{t in [0,1]} f(t) < epsilon_reg = 0.05",
            "verifiedByCases": ["ADR009-S6-09"],
        },
        {
            "classification": CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value,
            "adr009Section": "§4.4 Category 2 (ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP)",
            "mathematicalCondition": "(Q(t*) > 0 and f(t*) = 1 - s*d*kappa(t*) = 0, including complete focal collapse d=R and grazing f=0, f'=0) OR genuine base-curve geometric cusp Q(t*) = 0",
            "verifiedByCases": ["AG-02", "AG-06 (at cusp roots t1*, t2*)", "AG-07", "AG-09", "AG-10b", "AG-16", "ADR009-S6-17", "ADR009-CASE5-COLLAPSED"],
        },
        {
            "classification": CanonicalOffsetClassification.TANGENT_REVERSAL.value,
            "adr009Section": "§4.4 Category 3",
            "mathematicalCondition": "Q(t) > 0 and f(t) = 1 - s*d*kappa(t) < 0 (unit tangent of O(t) reverses relative to B(t))",
            "verifiedByCases": ["AG-03 (f=-0.20 < 0 everywhere without zero-speed cusp)", "AG-06 (on (t1*, t2*) alongside cusp roots)", "AG-08", "ADR009-S6-10 (concave)", "ADR009-S6-11B"],
        },
        {
            "classification": CanonicalOffsetClassification.LOCAL_SELF_INTERSECTION.value,
            "adr009Section": "§4.4 Category 4",
            "mathematicalCondition": "O(t1*) = O(t2*) for t1* != t2* within a local swallowtail or corner neighborhood",
            "verifiedByCases": ["AG-08"],
        },
        {
            "classification": CanonicalOffsetClassification.GLOBAL_SELF_INTERSECTION.value,
            "adr009Section": "§4.4 Category 5",
            "mathematicalCondition": "O_i(t1*) = O_j(t2*) between contour segments where each segment is locally regular f_i(t) >= epsilon_reg",
            "verifiedByCases": ["AG-15"],
        },
        {
            "classification": CanonicalOffsetClassification.INCONCLUSIVE.value,
            "adr009Section": "§4.4 Category 6 & §5.3 Fail-Closed Rule",
            "mathematicalCondition": "Interval enclosure straddles threshold at subdivision/precision ceiling; sets verification_outcome=INCONCLUSIVE and is_production_ready=False",
            "verifiedByCases": ["ADR009-S6-16"],
        },
    ]

    base_curve_singularity_taxonomy = [
        {
            "classification": BaseCurveSingularityClassification.REGULAR_BASE_CURVE.value,
            "stationaryParameterizationStatus": "NONE_REGULAR_SPEED",
            "mathematicalCondition": "Q(t) = ||B'(t)||_2^2 > 0 for all t in [0, 1]",
            "verifiedByCases": ["AG-01..AG-08", "AG-12..AG-17"],
        },
        {
            "classification": BaseCurveSingularityClassification.GENUINE_ZERO_SPEED_GEOMETRIC_CUSP_OR_FOLD.value,
            "stationaryParameterizationStatus": "GENUINE_BASE_GEOMETRIC_SINGULARITY",
            "mathematicalCondition": "Interior Q(t*) = 0 with even first non-vanishing Taylor order m = 2 (T_-(t*) = -T_+(t*), reversal = pi rad)",
            "verifiedByCases": ["AG-09", "ADR009-S6-17"],
        },
        {
            "classification": BaseCurveSingularityClassification.REMOVABLE_PARAMETERIZATION_DEGENERACY.value,
            "stationaryParameterizationStatus": "REMOVABLE_PARAMETERIZATION_DEGENERACY",
            "mathematicalCondition": "Q(t*) = 0 with odd first non-vanishing Taylor order m = 3 (T_-(t*) = T_+(t*) and regular limiting curvature kappa_lim = 0)",
            "verifiedByCases": ["AG-11"],
        },
        {
            "classification": BaseCurveSingularityClassification.ENDPOINT_TANGENTIAL_DEGENERACY.value,
            "stationaryParameterizationStatus": "ENDPOINT_TANGENTIAL_DEGENERACY",
            "mathematicalCondition": "Endpoint t* in {0, 1} with B'(t*) = 0 (P1=P0 or P2=P3); collinear B''x B'''=0 is removable (AG-10a), non-collinear B''x B'''!=0 has |kappa|->inf (AG-10b)",
            "verifiedByCases": ["AG-10a", "AG-10b"],
        },
        {
            "classification": BaseCurveSingularityClassification.COLLAPSED_ZERO_LENGTH_CURVE.value,
            "stationaryParameterizationStatus": "COLLAPSED_ZERO_LENGTH_CURVE",
            "mathematicalCondition": "B'(t) === 0 for all t in [0, 1] (P0 = P1 = P2 = P3)",
            "verifiedByCases": ["ADR009-CASE5-COLLAPSED"],
        },
    ]

    # Programmatically derive allConforming (ZERO hardcoded True literals)
    ag02_ok = (
        fam_by_id["AG-02"]["passed"]
        and fam_by_id["AG-02"]["hasZeroSpeedCuspOnDomain"] is True
        and fam_by_id["AG-02"]["hasTangentReversalOnDomain"] is False
        and fam_by_id["AG-02"]["canonicalOffsetClassification"]
        == CanonicalOffsetClassification.ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP.value
    )
    ag03_ok = (
        fam_by_id["AG-03"]["passed"]
        and fam_by_id["AG-03"]["hasZeroSpeedCuspOnDomain"] is False
        and fam_by_id["AG-03"]["hasTangentReversalOnDomain"] is True
        and fam_by_id["AG-03"]["canonicalOffsetClassification"] == CanonicalOffsetClassification.TANGENT_REVERSAL.value
    )
    ag06_ok = (
        fam_by_id["AG-06"]["passed"]
        and fam_by_id["AG-06"]["hasZeroSpeedCuspOnDomain"] is True
        and fam_by_id["AG-06"]["hasTangentReversalOnDomain"] is True
    )
    ag11_ok = (
        fam_by_id["AG-11"]["passed"]
        and fam_by_id["AG-11"]["baseCurveSingularityClassification"]
        == BaseCurveSingularityClassification.REMOVABLE_PARAMETERIZATION_DEGENERACY.value
        and fam_by_id["AG-11"]["verificationOutcome"] == "CERTIFIED_VALID"
    )
    s6_16_ok = (
        extra_by_id["ADR009-S6-16"]["passed"]
        and extra_by_id["ADR009-S6-16"]["verificationOutcome"] == "INCONCLUSIVE"
        and extra_by_id["ADR009-S6-16"]["isProductionReady"] is False
    )
    all_conforming = bool(
        adv_report["allPassed"]
        and sec6_extra["allPassed"]
        and len(canonical_offset_taxonomy) == len(CanonicalOffsetClassification)
        and len(base_curve_singularity_taxonomy) == len(BaseCurveSingularityClassification)
        and ag02_ok
        and ag03_ok
        and ag06_ok
        and ag11_ok
        and s6_16_ok
    )

    return {
        "deliverable": "M00_CLASSIFICATION_CONFORMANCE_REPORT.json",
        "checkpoint": "PKG-M00-04",
        "packageId": "PKG-M00-04",
        "remediatedFinding": "FINDING-TAX-01 / I-03 / I-06",
        "governingADR": "ADR-009 (R2.1.2-R1 §2.2, §4.2, §4.3, §4.4, §5.3)",
        "canonicalOffsetClassificationsVerifiedCount": len(canonical_offset_taxonomy),
        "canonicalOffsetTaxonomy": canonical_offset_taxonomy,
        "baseCurveSingularityClassificationsVerifiedCount": len(base_curve_singularity_taxonomy),
        "baseCurveSingularityTaxonomy": base_curve_singularity_taxonomy,
        "keyMathematicalDistinctionsVerified": {
            "ag02FocalCollapseVsAg03TangentReversal": {
                "ag02_d10_equals_R10": {
                    "f": fam_by_id["AG-02"]["offsetSpeedFactorF"],
                    "offsetSpeedNorm": fam_by_id["AG-02"]["offsetSpeedMagnitudeCmPerRad"],
                    "hasZeroSpeedCuspOnDomain": fam_by_id["AG-02"]["hasZeroSpeedCuspOnDomain"],
                    "hasTangentReversalOnDomain": fam_by_id["AG-02"]["hasTangentReversalOnDomain"],
                    "classification": fam_by_id["AG-02"]["canonicalOffsetClassification"],
                },
                "ag03_d12_exceeds_R10": {
                    "f": fam_by_id["AG-03"]["offsetSpeedFactorF"],
                    "offsetSpeedNorm": fam_by_id["AG-03"]["offsetSpeedMagnitudeCmPerRad"],
                    "hasZeroSpeedCuspOnDomain": fam_by_id["AG-03"]["hasZeroSpeedCuspOnDomain"],
                    "hasTangentReversalOnDomain": fam_by_id["AG-03"]["hasTangentReversalOnDomain"],
                    "classification": fam_by_id["AG-03"]["canonicalOffsetClassification"],
                },
            },
            "ag06TransverseCuspAndTangentReversalBothRecorded": {
                "activeClassificationsOnDomain": fam_by_id["AG-06"]["activeClassificationsOnDomain"],
                "hasZeroSpeedCuspOnDomain": fam_by_id["AG-06"]["hasZeroSpeedCuspOnDomain"],
                "hasTangentReversalOnDomain": fam_by_id["AG-06"]["hasTangentReversalOnDomain"],
            },
            "ag11RemovableParameterizationDegeneracySeparatedFromFailure": {
                "baseCurveSingularityClassification": fam_by_id["AG-11"]["baseCurveSingularityClassification"],
                "stationaryParameterizationStatus": fam_by_id["AG-11"]["stationaryParameterizationStatus"],
                "canonicalOffsetClassification": fam_by_id["AG-11"]["canonicalOffsetClassification"],
                "verificationOutcome": fam_by_id["AG-11"]["verificationOutcome"],
            },
            "s6_16InconclusiveFailClosedEnforced": {
                "verificationOutcome": extra_by_id["ADR009-S6-16"]["verificationOutcome"],
                "canonicalOffsetClassification": extra_by_id["ADR009-S6-16"]["canonicalOffsetClassification"],
                "isProductionReady": extra_by_id["ADR009-S6-16"]["isProductionReady"],
            },
        },
        "allConforming": all_conforming,
    }


def build_canonical_ag01_ag17_registry(
    adv_report: Dict[str, Any],
    sec6_coverage: Dict[str, Any],
) -> Dict[str, Any]:
    """Builds `M00_CANONICAL_AG01_AG17_REGISTRY.json` with programmatically computed summary flags."""
    hist_path = ARTIFACTS_DIR / "checkpoint_13a_audit" / "M00_CANONICAL_AG01_AG17_REGISTRY.json"
    hist_snapshot = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else {}

    hist_families = hist_snapshot.get("families", [])
    hist_status_counts = dict(sorted(Counter(f.get("testExecutionStatus", "UNKNOWN") for f in hist_families).items()))
    pre_remediation_summary = {
        "auditCheckpoint": hist_snapshot.get("auditCheckpoint", "13A"),
        "totalFamilies": len(hist_families),
        "reconciliationSummary": hist_snapshot.get("reconciliationSummary", {}),
        "testExecutionStatusCounts": hist_status_counts,
        "untestedADR009Section6Families": hist_snapshot.get("untestedADR009Section6Families", []),
        "checkpoint13aAuditVerdict": "BLOCKED_PRE_REMEDIATION",
    }

    remediated_entries: List[Dict[str, Any]] = []
    for fam in adv_report["families"]:
        rec = fam.get("offsetValidationRecord") or {}
        coverage_ratio = rec.get("primary_span_coverage_ratio", 1.0)
        whole_interval = bool(coverage_ratio >= 1.0 - 1e-12)
        remediated_entries.append(
            {
                "familyId": fam["familyId"],
                "title": fam["title"],
                "canonicalOffsetClassification": fam["canonicalOffsetClassification"],
                "activeClassificationsOnDomain": fam["activeClassificationsOnDomain"],
                "baseCurveSingularityClassification": fam["baseCurveSingularityClassification"],
                "verificationOutcome": fam.get("verificationOutcome", "INCONCLUSIVE"),
                "primarySpanCoverageRatio": coverage_ratio,
                "wholeIntervalEvaluated": whole_interval,
                "postRemediationAuditStatus": "PASS" if fam["passed"] else "FAIL",
            }
        )

    passing_ag_count = sum(1 for e in remediated_entries if e["postRemediationAuditStatus"] == "PASS")
    all_ag_and_sec6_passing = bool(
        passing_ag_count == len(remediated_entries)
        and len(remediated_entries) == 17
        and sec6_coverage["allPassed"]
        and all(e["wholeIntervalEvaluated"] for e in remediated_entries)
    )

    return {
        "deliverable": "M00_CANONICAL_AG01_AG17_REGISTRY.json",
        "checkpoint": "PKG-M00-04",
        "governingBaseline": {
            "blueprint": "R2.1.2-R1 (R2.2 Documentation Overlay)",
            "gateAuth1Commit": "6938f808629276fd1b0860fba407b42f5cb40aaf",
            "checkpoint13aAuditCommit": "0f89b292d402a4c829fdfa78a07b8dc4143df2cb",
            "mainBaselineCommit": "1221eb05497a59e52c4af851614085748c92a2d1",
            "integrationReviewCommit": "d2977ccc868c7c8152282477c597044e3ca07556",
            "packageId": "PKG-M00-04",
            "executionBranch": "fix/m00-integrated-consolidation",
        },
        "summary": {
            "totalCanonicalAGFamilies": len(remediated_entries),
            "agFamiliesPassingPostRemediation": passing_ag_count,
            "adr009Section6MandatoryItemsTotal": sec6_coverage["totalSpecificationItemsRequired"],
            "adr009Section6MandatoryItemsPassing": sec6_coverage["totalSpecificationItemsPassed"],
            "allAgAndSection6ChecksPassed": all_ag_and_sec6_passing,
        },
        "remediatedCanonicalAG01ToAG17Registry": remediated_entries,
        "adr009Section6ExtendedCases": adv_report["adr009Section6ExtendedCases"],
        "checkpoint13aHistoricalAuditSnapshotPreserved": {
            "archivedCopyPath": "artifacts/m00/checkpoint_13a_audit/M00_CANONICAL_AG01_AG17_REGISTRY.json",
            "preRemediationSummary": pre_remediation_summary,
        },
    }


def _execute_deterministic_core_to_dir(output_dir: Path) -> Dict[str, Any]:
    """Executes one clean deterministic pass of all 11 deterministic M00 artifacts into `output_dir`."""
    output_dir.mkdir(parents=True, exist_ok=True)
    schema_path = REPO_ROOT / "packages" / "contracts" / "schemas" / "canonical_contracts.schema.json"

    m00_1 = verify_schemas_lock(schema_path)
    m00_4_qual = generate_interval_library_qualification_report()
    m00_4_adv = execute_17_adversarial_geometry_families()
    m00_4_sec6 = execute_adr009_section6_complete_suite()
    m00_5 = execute_m00_5_arc_length_verification()
    m00_6 = execute_m00_6_topology_verification()
    m00_7 = execute_m00_7_dxf_roundtrip_verification()
    m00_8 = execute_m00_8_anthropometric_and_seam_parity_verification()
    prod_dxf, prod_seam = verify_exported_bundle()

    # Run M00.2 C0-Legacy Behavioral Snapshot & Divergence Registry strictly into output_dir (K-05)
    c0_out_path = output_dir / "BaselineDivergenceRegistry.json"
    subprocess.run(
        [*_tsx_runner_cmd(), str(REPO_ROOT / "scripts" / "m00_capture_c0_legacy.ts"), "--out", str(c0_out_path)],
        cwd=str(REPO_ROOT),
        check=True,
    )
    m00_2_bytes = c0_out_path.read_bytes()

    # Run ADR-009 §7.2 63 Canonical Garment Contours Exporter strictly into output_dir (K-05)
    contours63_out_path = output_dir / "CanonicalGarmentContours63.json"
    subprocess.run(
        [
            *_tsx_runner_cmd(),
            str(REPO_ROOT / "scripts" / "m00_export_canonical_63_contours.ts"),
            "--out",
            str(contours63_out_path),
        ],
        cwd=str(REPO_ROOT),
        check=True,
    )
    contours63_bytes = contours63_out_path.read_bytes()

    write_json_file(output_dir / "SchemasLockReport.json", m00_1, rel_root=output_dir)
    write_json_file(output_dir / "IntervalLibraryQualificationReport.json", m00_4_qual, rel_root=output_dir)
    write_json_file(output_dir / "AdversarialGeometryVerificationReport.json", m00_4_adv, rel_root=output_dir)
    write_json_file(output_dir / "ArcLengthVerificationReport.json", m00_5, rel_root=output_dir)
    write_json_file(output_dir / "TopologyVerificationReport.json", m00_6, rel_root=output_dir)
    write_json_file(output_dir / "DxfRoundTripVerificationReport.json", m00_7, rel_root=output_dir)
    write_json_file(output_dir / "AnthropometricVerificationReport.json", m00_8, rel_root=output_dir)
    write_json_file(output_dir / "ProductionDxfRoundTripReport.json", prod_dxf, rel_root=output_dir)
    write_json_file(output_dir / "ProductionSeamParityReport.json", prod_seam, rel_root=output_dir)

    return {
        "m00_1": m00_1,
        "m00_2_bytes": m00_2_bytes,
        "contours63_bytes": contours63_bytes,
        "m00_4_qual": m00_4_qual,
        "m00_4_adv": m00_4_adv,
        "m00_4_sec6": m00_4_sec6,
        "m00_5": m00_5,
        "m00_6": m00_6,
        "m00_7": m00_7,
        "m00_8": m00_8,
        "prod_dxf": prod_dxf,
        "prod_seam": prod_seam,
    }


def _discover_evidence_and_prep_docs() -> List[Dict[str, str]]:
    """Collects deterministic M00 evidence & preparation markdown files for complete manifest coverage."""
    paths: List[Path] = []
    evidence_dir = REPO_ROOT / "docs" / "evidence"
    if evidence_dir.is_dir():
        for p in sorted(evidence_dir.glob("M00_*.md")):
            if p.is_file():
                paths.append(p)
        for pkg_sub in ("pkg_m00_04", "pkg_m00_05"):
            pkg_dir = evidence_dir / pkg_sub
            if pkg_dir.is_dir():
                for p in sorted(pkg_dir.rglob("*")):
                    if p.is_file():
                        paths.append(p)
    prep_dir = REPO_ROOT / "docs" / "prep"
    if prep_dir.is_dir():
        for p in sorted(prep_dir.rglob("*.md")):
            if p.is_file():
                paths.append(p)
    return [_digest_existing_file(p, category="EVIDENCE_AND_PREP_DOCUMENTATION") for p in paths]


def _discover_historical_reports() -> List[Dict[str, str]]:
    """Segregates preserved historical Checkpoint 13A/15 reports away from active PKG-M00-04 outputs."""
    entries: List[Dict[str, str]] = []
    for md_name in HISTORICAL_ROOT_MARKDOWN_REPORTS:
        p = REPO_ROOT / md_name
        if p.is_file():
            entries.append(_digest_existing_file(p, category="HISTORICAL_PRESERVED_ROOT_REPORT"))
    hist_dir = ARTIFACTS_DIR / "checkpoint_13a_audit"
    if hist_dir.is_dir():
        for p in sorted(hist_dir.rglob("*")):
            if p.is_file():
                entries.append(_digest_existing_file(p, category="HISTORICAL_CHECKPOINT_13A_ARCHIVE"))
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description="Patroner M00 Deterministic Verification & Evidence Generator")
    parser.add_argument(
        "--single-run",
        action="store_true",
        help="Execute one isolated deterministic pass into --output-dir (used by verify_m00_reproducibility.py).",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="",
        help="Target output directory for --single-run mode.",
    )
    args = parser.parse_args()

    workflow_path = REPO_ROOT / ".github" / "workflows" / "m00-verification.yml"
    env_check = verify_python312_and_lock_environment(SYS_PATH_ENGINE, workflow_path, strict=True)

    if args.single_run:
        if not args.output_dir:
            raise SystemExit("--single-run requires --output-dir <path>")
        out_dir = Path(args.output_dir).resolve()
        _execute_deterministic_core_to_dir(out_dir)
        print(f"[SINGLE-RUN] Wrote 11 deterministic artifacts cleanly to {out_dir}")
        return

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    print("=== EXECUTING PATRONER M00 INTEGRATED VERIFICATION SUITE (PKG-M00-05) ===")

    # 1. Dynamic source-inputs discovery & digest (REM-01 / I-01)
    discovered = discover_m00_source_inputs(REPO_ROOT)
    source_inputs = compute_source_inputs_digest(REPO_ROOT, discovered["paths"])
    source_inputs["discoveryPolicy"] = discovered["discoveryPolicy"]
    assert source_inputs["allSourceInputsPresent"], f"Missing M00 source inputs: {source_inputs['missingFiles']}"

    # 2. Static AST oracle-independence + TypeScript ADR-001 boundary verification (REM-02 / I-02)
    oracle_independence_audit = audit_repository_oracle_independence(REPO_ROOT)
    assert oracle_independence_audit["allPassed"], (
        f"ADR-009/ADR-001 oracle independence audit failed: {oracle_independence_audit['violations']}"
    )

    # 3. Execute deterministic core artifacts directly into artifacts/m00/
    core = _execute_deterministic_core_to_dir(ARTIFACTS_DIR)
    m00_1 = core["m00_1"]
    contours63_bytes = core["contours63_bytes"]
    m00_4_qual = core["m00_4_qual"]
    m00_4_adv = core["m00_4_adv"]
    m00_4_sec6 = core["m00_4_sec6"]
    m00_5 = core["m00_5"]
    m00_6 = core["m00_6"]
    m00_7 = core["m00_7"]
    m00_8 = core["m00_8"]
    prod_dxf = core["prod_dxf"]
    prod_seam = core["prod_seam"]

    # 4. Execute TRUE TWO-SUBPROCESS OS-ISOLATED REPRODUCIBILITY CHECK (I-01)
    replay_result = run_two_subprocess_reproducibility_check(REPO_ROOT, sys.executable)
    assert replay_result["allBitExact"], f"Two-subprocess reproducibility check failed: {replay_result}"

    # Deterministic digests of artifacts/m00/*
    meta_m00_1 = _digest_existing_file(ARTIFACTS_DIR / "SchemasLockReport.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_m00_2 = _digest_existing_file(ARTIFACTS_DIR / "BaselineDivergenceRegistry.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_contours63 = _digest_existing_file(ARTIFACTS_DIR / "CanonicalGarmentContours63.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_m00_4_qual = _digest_existing_file(ARTIFACTS_DIR / "IntervalLibraryQualificationReport.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_m00_4_adv = _digest_existing_file(ARTIFACTS_DIR / "AdversarialGeometryVerificationReport.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_m00_5 = _digest_existing_file(ARTIFACTS_DIR / "ArcLengthVerificationReport.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_m00_6 = _digest_existing_file(ARTIFACTS_DIR / "TopologyVerificationReport.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_m00_7 = _digest_existing_file(ARTIFACTS_DIR / "DxfRoundTripVerificationReport.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_m00_8 = _digest_existing_file(ARTIFACTS_DIR / "AnthropometricVerificationReport.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_prod_dxf = _digest_existing_file(ARTIFACTS_DIR / "ProductionDxfRoundTripReport.json", "ACTIVE_DETERMINISTIC_ARTIFACT")
    meta_prod_seam = _digest_existing_file(ARTIFACTS_DIR / "ProductionSeamParityReport.json", "ACTIVE_DETERMINISTIC_ARTIFACT")

    # 5. Generate root deterministic JSON deliverables
    sec6_cov_report = build_adr009_section6_coverage_report(m00_4_adv, m00_4_sec6)
    class_conf_report = build_classification_conformance_report(m00_4_adv, m00_4_sec6)
    canon_reg_report = build_canonical_ag01_ag17_registry(m00_4_adv, sec6_cov_report)

    contract_parity_report = {
        "deliverable": "M00_CONTRACT_PARITY_REPORT.json",
        "checkpoint": "PKG-M00-04",
        "packageId": "PKG-M00-04",
        "remediatedFinding": "FINDING-CONTRACTS-01 / I-06",
        "schemasLockReport": m00_1,
    }
    suboracle_report = {
        "deliverable": "M00_SUBORACLE_VERIFICATION_REPORT.json",
        "checkpoint": "PKG-M00-04",
        "packageId": "PKG-M00-04",
        "remediatedFinding": "FINDING-SUBORACLES-01 / I-05",
        "m00_5_arcLength": m00_5,
        "m00_6_topology": m00_6,
        "m00_7_dxfRoundTrip": m00_7,
        "m00_8_anthropometricsAndSeamParity": m00_8,
        "workstreamB_productionDxfAndSeams": {
            "productionDxfRoundTripReport": prod_dxf,
            "productionSeamParityReport": prod_seam,
        },
        "allSubOraclesPassed": bool(
            m00_5["allPassed"]
            and m00_6["allPassed"]
            and m00_7["allPassed"]
            and m00_8["allPassed"]
            and prod_dxf["allPassed"]
            and prod_seam["allPassed"]
        ),
    }

    # 6. Execute NON-DETERMINISTIC wall-clock benchmarks STRICTLY isolated from deterministic manifests!
    runtime_10k = benchmark_10k_population_runtimes()
    runtime_63_contours = benchmark_63_canonical_garment_contours(ARTIFACTS_DIR / "CanonicalGarmentContours63.json")
    combined_benchmarks = {
        **runtime_10k,
        "packageId": "PKG-M00-04",
        "canonical63ContourBenchmarks": runtime_63_contours,
    }
    meta_benchmarks = write_json_file(ARTIFACTS_DIR / "IntervalCandidateBenchmarks.json", combined_benchmarks)

    latency_eval_10k = runtime_10k.get("latencyQualificationEvaluation") or evaluate_three_candidates_p95_latency(
        runtime_10k, threshold_ms=5.0
    )

    runtime_observation_record = {
        "artifactName": "RuntimeBenchmarkObservation.json",
        "nonDeterministicRuntimeObservation": True,
        "packageId": "PKG-M00-04",
        "hostObservation": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "pythonVersion": platform.python_version(),
        },
        "twoSubprocessReplayPids": {
            "run1Pid": replay_result["run1Pid"],
            "run2Pid": replay_result["run2Pid"],
            "distinctSubprocessesExecuted": replay_result["distinctSubprocessesExecuted"],
        },
        "intervalCandidateBenchmarksDigest": meta_benchmarks,
        "synthetic10kLatencyQualificationEvaluation": latency_eval_10k,
        "canonical63ContourLatencyQualificationEvaluation": runtime_63_contours["latencyQualificationEvaluation5Ms"],
    }
    write_json_file(ARTIFACTS_DIR / "RuntimeBenchmarkObservation.json", runtime_observation_record)

    per_curve_meta = runtime_10k.get("perCurveLatencyBenchmarks", {}).get("metadata", {})
    deterministic_op_counts = per_curve_meta.get("deterministicOperationCountsPerBenchmarkIteration")
    assert isinstance(deterministic_op_counts, dict) and deterministic_op_counts, (
        "Missing deterministicOperationCountsPerBenchmarkIteration in runtime benchmarks"
    )

    # ZERO volatile wall-clock timings, ZERO timing-derived booleans, and ZERO OS PIDs in deterministic manifests
    reproducibility_report = {
        "deliverable": "M00_REPRODUCIBILITY_REPORT.json",
        "checkpoint": "PKG-M00-04",
        "packageId": "PKG-M00-04",
        "replayMethod": replay_result["replayMethod"],
        "distinctSubprocessesExecuted": replay_result["distinctSubprocessesExecuted"],
        "pythonHashSeed": env_check["pythonHashSeed"],
        "sourceInputsDigest": source_inputs["sourceInputsDigest"],
        "consecutiveRunsCompared": 2,
        "deterministicArtifactsVerifiedCount": replay_result["artifactsComparedCount"],
        "allMathematicalArtifactsBitExactAcrossRuns": replay_result["allBitExact"],
        "artifactRunComparisons": replay_result["artifactRunComparisons"],
        "runtimeBenchmarksArtifact": "artifacts/m00/IntervalCandidateBenchmarks.json",
        "runtimeObservationArtifact": "artifacts/m00/RuntimeBenchmarkObservation.json",
        "latencyQualificationPolicy": {
            "wallClockTimestampsTimingValuesAndTimingBooleansExcludedFromDeterministicManifests": True,
            "p95ThresholdMs": 5.0,
            "authoritativeLatencyObservationPath": "artifacts/m00/RuntimeBenchmarkObservation.json",
            "canonical63ContourCorpusPath": "artifacts/m00/CanonicalGarmentContours63.json",
            "canonical63ContourCorpusSha256": hashlib.sha256(contours63_bytes).hexdigest(),
            "deterministicOperationCountsPerBenchmarkIteration": deterministic_op_counts,
        },
    }

    meta_root_reg = write_json_file(REPO_ROOT / "M00_CANONICAL_AG01_AG17_REGISTRY.json", canon_reg_report)
    meta_root_sec6 = write_json_file(REPO_ROOT / "M00_ADR009_SECTION6_COVERAGE_REPORT.json", sec6_cov_report)
    meta_root_class = write_json_file(REPO_ROOT / "M00_CLASSIFICATION_CONFORMANCE_REPORT.json", class_conf_report)
    meta_root_qual = write_json_file(REPO_ROOT / "M00_INTERVAL_QUALIFICATION_REPORT.json", m00_4_qual)
    meta_root_contracts = write_json_file(REPO_ROOT / "M00_CONTRACT_PARITY_REPORT.json", contract_parity_report)
    meta_root_sub = write_json_file(REPO_ROOT / "M00_SUBORACLE_VERIFICATION_REPORT.json", suboracle_report)
    meta_root_repro = write_json_file(REPO_ROOT / "M00_REPRODUCIBILITY_REPORT.json", reproducibility_report)

    meta_root_reg["category"] = "ACTIVE_ROOT_DELIVERABLE"
    meta_root_sec6["category"] = "ACTIVE_ROOT_DELIVERABLE"
    meta_root_class["category"] = "ACTIVE_ROOT_DELIVERABLE"
    meta_root_qual["category"] = "COMPATIBILITY_MIRROR"
    meta_root_contracts["category"] = "ACTIVE_ROOT_DELIVERABLE"
    meta_root_sub["category"] = "ACTIVE_ROOT_DELIVERABLE"
    meta_root_repro["category"] = "ACTIVE_ROOT_DELIVERABLE"

    deterministic_artifact_digests = [
        meta_m00_1,
        meta_m00_2,
        meta_contours63,
        meta_m00_4_qual,
        meta_m00_4_adv,
        meta_m00_5,
        meta_m00_6,
        meta_m00_7,
        meta_m00_8,
        meta_prod_dxf,
        meta_prod_seam,
    ]
    active_root_deliverables = [
        meta_root_reg,
        meta_root_sec6,
        meta_root_class,
        meta_root_contracts,
        meta_root_sub,
        meta_root_repro,
    ]

    replay_verified = bool(replay_result["allBitExact"])
    env_verified = bool(env_check["verified"])
    oracle_ind_ok = bool(oracle_independence_audit["allPassed"])

    deterministic_checks_passed = bool(
        m00_1["allPassed"]
        and m00_4_qual["allCandidatesQualified"]
        and m00_4_adv["allPassed"]
        and m00_4_sec6["allPassed"]
        and sec6_cov_report["allPassed"]
        and class_conf_report["allConforming"]
        and oracle_ind_ok
        and m00_5["allPassed"]
        and m00_6["allPassed"]
        and m00_7["allPassed"]
        and m00_8["allPassed"]
        and prod_dxf["allPassed"]
        and prod_seam["allPassed"]
        and env_verified
        and replay_verified
    )

    env_manifest = {
        "milestoneId": "M00.9-M00.10",
        "artifactName": "ReproducibleEnvironmentManifest.json",
        "checkpoint": "PKG-M00-04",
        "packageId": "PKG-M00-04",
        "governingAuthorization": {
            "checkpoint12Date": "2026-11-16",
            "baselineBlueprint": "R2.1.2-R1 (R2.2 Documentation Overlay)",
            "mainBaselineCommitSha": "1221eb05497a59e52c4af851614085748c92a2d1",
            "integrationReviewCommitSha": "d2977ccc868c7c8152282477c597044e3ca07556",
            "executionBranch": "fix/m00-integrated-consolidation",
            "preRestartGateAuth1CommitSha": "6938f808629276fd1b0860fba407b42f5cb40aaf",
            "recoveryAnchorCommitSha": "282a303ea1126fb3b1da368e4e8e4ddbeb59c552",
            "synchronizedM00SubmissionCommitSha": "edafe5e9e6994233daeaedf5826c691a934bc013",
            "checkpoint13aAuditCommitSha": "0f89b292d402a4c829fdfa78a07b8dc4143df2cb",
            "approvedDecisionsAtGateAuth1": ["Gate Auth-1", "DEC-01", "DEC-13 Stage 1"],
            "m00AcceptanceStatus": "NOT_ACCEPTED",
            "mandatoryNextGate": "Gate Auth-2 / DEC-13 Stage 2 (CLOSED - Pending Owner Sign-Off; Blocks M01/M02/M03 Production Implementation)",
            "gateAuth2Status": "CLOSED",
            "gateAuth3Status": "CLOSED",
            "gateAuth4Status": "CLOSED",
            "dec13Stage2Status": "CLOSED",
            "ac09PhysicalValidationStatus": "PENDING",
            "externalCadInteroperabilityVerified": False,
        },
        "runtimeEnvironment": {
            "pythonVersion": env_check["pythonVersion"],
            "pythonVersionInfo": env_check["pythonVersionInfo"],
            "pythonIs312": env_check["pythonIs312"],
            "pythonRequiresSpec": env_check["pythonRequiresSpec"],
            "targetRuntime": env_check["targetRuntime"],
            "machine": env_check["machine"],
            "pythonHashSeed": env_check["pythonHashSeed"],
            "pythonHashSeedIsZero": env_check["pythonHashSeedIsZero"],
            "pyprojectPresent": env_check["pyprojectPresent"],
            "pyprojectSha256": env_check["pyprojectSha256"],
            "uvLockPresent": env_check["uvLockPresent"],
            "uvLockSha256": env_check["uvLockSha256"],
            "pinnedPackages": env_check["pinnedPackages"],
            "allPinnedPackagesMatch": env_check["allPinnedPackagesMatch"],
            "ciWorkflowChecks": env_check["ciWorkflowChecks"],
            "ciWorkflowStepsAudited": env_check["ciWorkflowStepsAudited"],
            "ciWorkflowVerified": env_check["ciWorkflowVerified"],
        },
        "sourceInputsProvenance": source_inputs,
        "oracleIndependenceAudit": {
            "tier2OracleFilesChecked": oracle_independence_audit["tier2OracleFilesChecked"],
            "tier1ProductionFilesChecked": oracle_independence_audit["tier1ProductionFilesChecked"],
            "typescriptLegacyFilesChecked": oracle_independence_audit["typescriptC0LegacyAudit"]["srcEngineNonTestFilesAudited"],
            "violationsCount": len(oracle_independence_audit["violations"]),
            "allPassed": oracle_ind_ok,
        },
        "requirementStatusTaxonomy": {
            "M00.1_schemasLock": "VERIFIED" if m00_1["allPassed"] else "BLOCKED",
            "M00.4_step1_10kX4Tiers": "VERIFIED" if m00_4_qual["allCandidatesQualified"] else "BLOCKED",
            "M00.4_step2_3_ag17_krawczyk": "VERIFIED" if (m00_4_adv["allPassed"] and m00_4_sec6["allPassed"]) else "BLOCKED",
            "M00.4_oracleIndependence": "VERIFIED" if oracle_ind_ok else "BLOCKED",
            "M00.5_c1CertArcLength": "VERIFIED" if m00_5["allPassed"] else "BLOCKED",
            "M00.6_exactTopology": "VERIFIED" if m00_6["allPassed"] else "BLOCKED",
            "M00.7_productionSyntheticDxf": "VERIFIED" if (m00_7["allPassed"] and prod_dxf["allPassed"]) else "BLOCKED",
            "M00.7_externalCadInteroperability": "DEFERRED_TO_M05",
            "M00.8_productionSeamParity": "VERIFIED" if (m00_8["allPassed"] and prod_seam["allPassed"]) else "BLOCKED",
            "M00.8_sleeveTargetEase_ClassB_M02b": "OPEN_CLASS_B_TRACKED_M02b",
            "M00.7_M00.8_verticalSlice1TrouserBlock": "INCOMPLETE_MISSING_TROUSER_BLOCK_M02",
            "M00.9_python312CiLock": "VERIFIED" if env_verified else "BLOCKED",
            "M00.10_twoSubprocessDeterministicReplay": "VERIFIED" if replay_verified else "BLOCKED",
            "M00_acceptance": "NOT_ACCEPTED",
            "GateAuth2_DEC13Stage2": "CLOSED",
        },
        "deterministicReplayVerified": replay_verified,
        "runtimeBenchmarkObservationPolicy": {
            "runtimeBenchmarksSourceArtifact": "artifacts/m00/IntervalCandidateBenchmarks.json",
            "separateNonDeterministicObservationArtifact": "artifacts/m00/RuntimeBenchmarkObservation.json",
            "excludedFromDeterministicManifestHashing": True,
            "timingDerivedBooleansExcludedFromDeterministicManifest": True,
            "rationale": (
                "Wall-clock timings, OS PIDs, host kernel strings, and timing-derived latency booleans vary per host "
                "execution and are strictly isolated inside RuntimeBenchmarkObservation.json and IntervalCandidateBenchmarks.json."
            ),
        },
        "artifactDigests": deterministic_artifact_digests,
        "activeRootDeliverableDigests": active_root_deliverables,
        "pkgM0004DeterministicChecksPassed": deterministic_checks_passed,
    }
    meta_m00_10 = write_json_file(ARTIFACTS_DIR / "ReproducibleEnvironmentManifest.json", env_manifest)
    meta_root_manifest = write_json_file(REPO_ROOT / "ReproducibleEnvironmentManifest.json", env_manifest)
    meta_m00_10["category"] = "ACTIVE_DETERMINISTIC_ARTIFACT"
    meta_root_manifest["category"] = "COMPATIBILITY_MIRROR"

    schema_path = REPO_ROOT / "packages" / "contracts" / "schemas" / "canonical_contracts.schema.json"
    schema_sha256 = compute_file_sha256(schema_path)
    config_and_schema_digests = [
        _digest_existing_file(schema_path, "CONFIG_AND_SCHEMA"),
        _digest_existing_file(SYS_PATH_ENGINE / "pyproject.toml", "CONFIG_AND_SCHEMA"),
        _digest_existing_file(SYS_PATH_ENGINE / "uv.lock", "CONFIG_AND_SCHEMA"),
        _digest_existing_file(workflow_path, "CONFIG_AND_SCHEMA"),
    ]

    compatibility_mirrors = [
        {
            "primaryPath": meta_m00_4_qual["path"],
            "mirrorPath": meta_root_qual["path"],
            "sha256": meta_root_qual["sha256"],
            "bytes": meta_root_qual["bytes"],
            "identicalToPrimary": meta_m00_4_qual["sha256"] == meta_root_qual["sha256"],
        },
        {
            "primaryPath": meta_m00_10["path"],
            "mirrorPath": meta_root_manifest["path"],
            "sha256": meta_root_manifest["sha256"],
            "bytes": meta_root_manifest["bytes"],
            "identicalToPrimary": meta_m00_10["sha256"] == meta_root_manifest["sha256"],
        },
    ]

    historical_preserved_reports = _discover_historical_reports()
    evidence_and_prep_docs = _discover_evidence_and_prep_docs()

    active_primary_artifacts = deterministic_artifact_digests + [meta_m00_10] + active_root_deliverables
    mirror_file_entries = [meta_root_qual, meta_root_manifest]

    combined_entries = (
        active_primary_artifacts
        + mirror_file_entries
        + config_and_schema_digests
        + historical_preserved_reports
        + evidence_and_prep_docs
    )
    dedup_by_path: Dict[str, Dict[str, str]] = {}
    for entry in combined_entries:
        p = entry["path"]
        assert p != "M00_ARTIFACT_HASH_VERIFICATION.json", "Manifest must never self-hash!"
        assert p not in dedup_by_path, f"Duplicate path detected while building manifest: {p}"
        dedup_by_path[p] = entry
    all_audited_files = [dedup_by_path[k] for k in sorted(dedup_by_path.keys())]

    hash_verification_report = {
        "auditCheckpoint": "PKG-M00-04",
        "auditTitle": "Patroner M00 Consolidated Deterministic Artifact Hash Verification (PKG-M00-04 Complete Manifest)",
        "packageId": "PKG-M00-04",
        "selfHashExcluded": True,
        "historicalCheckpoint13aArchivePath": "artifacts/m00/checkpoint_13a_audit/M00_ARTIFACT_HASH_VERIFICATION.json",
        "governingBaseline": env_manifest["governingAuthorization"],
        "summary": {
            "uniqueActiveArtifactCount": len(active_primary_artifacts),
            "compatibilityMirrorCount": len(mirror_file_entries),
            "configAndSchemaFilesAudited": len(config_and_schema_digests),
            "historicalPreservedReportsAudited": len(historical_preserved_reports),
            "evidenceAndPrepDocsAudited": len(evidence_and_prep_docs),
            "totalFilesAudited": len(all_audited_files),
            "referencedSchemaSha256": schema_sha256,
            "sourceInputsDigest": source_inputs["sourceInputsDigest"],
            "oracleIndependenceVerified": oracle_ind_ok,
            "python312LockEnvironmentVerified": env_verified,
            "twoSubprocessDeterministicReplayVerified": replay_verified,
            "nonDeterministicRuntimeObservationArtifactsExcludedFromDeterminismGate": [
                "artifacts/m00/IntervalCandidateBenchmarks.json",
                "artifacts/m00/RuntimeBenchmarkObservation.json",
            ],
        },
        "activePrimaryArtifacts": active_primary_artifacts,
        "compatibilityMirrorFiles": compatibility_mirrors,
        "configAndSchemaFiles": config_and_schema_digests,
        "historicalPreservedReports": historical_preserved_reports,
        "evidenceAndPrepDocumentation": evidence_and_prep_docs,
        "reproducibleEnvironmentManifest": {
            "artifactsCopySha256": meta_m00_10["sha256"],
            "rootCopySha256": meta_root_manifest["sha256"],
            "copiesIdentical": meta_m00_10["sha256"] == meta_root_manifest["sha256"],
        },
        "allAuditedFiles": all_audited_files,
    }
    meta_hash_verify = write_json_file(REPO_ROOT / "M00_ARTIFACT_HASH_VERIFICATION.json", hash_verification_report)
    print(f"[M00.10] ReproducibleEnvironmentManifest.json -> SHA-256: {meta_m00_10['sha256']}")
    print(f"[M00.10] M00_ARTIFACT_HASH_VERIFICATION.json    -> SHA-256: {meta_hash_verify['sha256']}")
    print(
        f"[M00.10] Audited {len(all_audited_files)} unique files "
        f"({len(active_primary_artifacts)} active primary + {len(mirror_file_entries)} mirrors + "
        f"{len(config_and_schema_digests)} config/schema + {len(historical_preserved_reports)} historical + "
        f"{len(evidence_and_prep_docs)} evidence/prep)."
    )
    print(
        f"[BENCH-63] ADR-009 §7.2 63-contour latency verdict (isolated observation): "
        f"{runtime_63_contours['latencyQualificationEvaluation5Ms']}"
    )
    print("=== ALL DETERMINISTIC ARTIFACTS GENERATED AND VERIFIED ===")


if __name__ == "__main__":
    main()
