#!/usr/bin/env python3
"""Independent Python Verification Harness for Workstream B:
Real Drafted Piece DXF-AAMA (AC1009) Export Round-Trip & DEC-11 Seam Parity.

Invokes `scripts/m00_export_canonical_pieces.ts` via `npx tsx` to draft genuine
Bodice (Front, Back), Sleeve, and Skirt (Front, Back) PatternPieces, then independently:
1. Parses every DXF-AAMA R12 (AC1009) payload (HEADER, TABLES, ENTITIES; Layers 1,2,4,7,8,11)
   and verifies round-trip vertex parity <= 0.001 cm and SHA-256 integrity.
2. Evaluates 113-bit mpmath arc length + Method C1-Cert De Casteljau chord/polygon enclosures
   on the actual drafted Bezier & line seam segments and checks DEC-11 <= 0.05 cm CAD parity.
3. Explicitly records `externalCadInteroperabilityVerified = False` and flags the missing
   `trouser-block.ts` dependency required for full Vertical Slice 1 coverage.
"""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
import sys
from fractions import Fraction
from pathlib import Path
from typing import Any, Dict, List, Tuple

import mpmath
from mpmath import iv

REPO_ROOT = Path(__file__).resolve().parents[1]
SYS_PATH_ENGINE = REPO_ROOT / "services" / "geometry-engine"
sys.path.insert(0, str(SYS_PATH_ENGINE))

from patroner_geometry.c1_cert_oracle import (  # noqa: E402
    ExactCubicBezier2D,
    method_c1_cert_arc_length_enclosure,
    mpf_to_exact_fraction,
)
from patroner_geometry.qualification import (  # noqa: E402
    fraction_pair_to_outward_f64_pair,
    fraction_to_outward_upper_f64,
)
from patroner_geometry.sub_oracles import parse_dxf_aama_strict  # noqa: E402

ARTIFACTS_DIR = REPO_ROOT / "artifacts" / "m00"
REQUIRED_LAYERS = {"1", "2", "4", "7", "8", "11"}


def _tsx_runner_cmd() -> List[str]:
    local_tsx = REPO_ROOT / "node_modules" / ".bin" / "tsx"
    if local_tsx.is_file():
        return [str(local_tsx)]
    return ["npx", "--yes", "tsx"]


def parse_dxf_aama_multi_piece(dxf_text: str) -> Dict[str, Any]:
    """Unified strict DXF-AAMA multi-piece parser delegating directly to `parse_dxf_aama_strict`."""
    return parse_dxf_aama_strict(dxf_text)


def _segment_c1_cert_arc_length(
    seg: Dict[str, Any],
    target_half_width_cm: float = 1e-4,
    min_depth: int = 6,
    max_depth: int = 12,
) -> Tuple[Fraction, Fraction]:
    """Computes exact rational enclosing (lower_bound_cm, upper_bound_cm) arc length on a line or cubic Bezier segment.

    - Line segments: exact Fraction coordinate conversion -> pinned 113-bit mpmath.iv sqrt (no str() decimal round-trip).
    - Cubic segments: adaptive tolerance-driven Method C1-Cert subdivision up to `max_depth`, failing closed if
      `certifiedHalfWidthCm > target_half_width_cm`.
    """
    if seg["type"] == "line":
        mpmath.mp.prec = 113
        iv.prec = 113
        dx_q = Fraction(float(seg["p3"]["x"])) - Fraction(float(seg["p0"]["x"]))
        dy_q = Fraction(float(seg["p3"]["y"])) - Fraction(float(seg["p0"]["y"]))
        dist_sq_q = dx_q * dx_q + dy_q * dy_q
        if dist_sq_q == 0:
            return Fraction(0), Fraction(0)
        dist_iv = iv.sqrt(iv.mpf(dist_sq_q.numerator) / iv.mpf(dist_sq_q.denominator))
        return mpf_to_exact_fraction(dist_iv.a), mpf_to_exact_fraction(dist_iv.b)

    curve = ExactCubicBezier2D.from_floats(
        seg["id"],
        (seg["p0"]["x"], seg["p0"]["y"]),
        (seg["cp1"]["x"], seg["cp1"]["y"]),
        (seg["cp2"]["x"], seg["cp2"]["y"]),
        (seg["p3"]["x"], seg["p3"]["y"]),
    )
    last_enc: Dict[str, Any] | None = None
    for depth in range(min_depth, max_depth + 1):
        enc = method_c1_cert_arc_length_enclosure(curve, subdivision_depth=depth)
        last_enc = enc
        if enc["certifiedHalfWidthCm"] <= target_half_width_cm and enc["nonStrictInequalityHolds"]:
            return Fraction(enc["lowerChordBoundRational"]), Fraction(enc["upperControlPolygonBoundRational"])

    raise RuntimeError(
        f"Adaptive Method C1-Cert arc-length enclosure failed to reach target half-width {target_half_width_cm} cm "
        f"on segment {seg['id']} by max_depth={max_depth}: last={last_enc}"
    )


def verify_exported_bundle() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    raw = subprocess.check_output(
        [*_tsx_runner_cmd(), str(REPO_ROOT / "scripts" / "m00_export_canonical_pieces.ts")],
        cwd=str(REPO_ROOT),
        text=True,
    )
    exported = json.loads(raw)

    dxf_results: List[Dict[str, Any]] = []
    seam_results: List[Dict[str, Any]] = []

    for bundle in exported["sizeBundles"]:
        size_label = bundle["sizeLabel"]
        combined = bundle["combinedDxf"]
        parsed = parse_dxf_aama_multi_piece(combined["dxfText"])

        missing_table = sorted(REQUIRED_LAYERS - set(parsed["tableLayersDefined"]))
        missing_entity = sorted(REQUIRED_LAYERS - set(parsed["entityLayersFound"]))

        max_err = 0.0
        pieces_meta = combined["pieces"]
        if len(parsed["cutPolylines"]) != len(pieces_meta) or len(parsed["sewPolylines"]) != len(pieces_meta):
            max_err = math.inf
        else:
            for idx, pm in enumerate(pieces_meta):
                exp_cut = [(p["x"], p["y"]) for p in pm["expectedCutVerticesCm"]]
                got_cut = parsed["cutPolylines"][idx]
                if len(exp_cut) != len(got_cut):
                    max_err = math.inf
                else:
                    for (x1, y1), (x2, y2) in zip(exp_cut, got_cut):
                        max_err = max(max_err, math.hypot(x1 - x2, y1 - y2))

                exp_sew = [(p["x"], p["y"]) for p in pm["expectedSewVerticesCm"]]
                got_sew = parsed["sewPolylines"][idx]
                if len(exp_sew) != len(got_sew):
                    max_err = math.inf
                else:
                    for (x1, y1), (x2, y2) in zip(exp_sew, got_sew):
                        max_err = max(max_err, math.hypot(x1 - x2, y1 - y2))

        size_dxf_ok = (
            parsed["isStructurallyValid"]
            and parsed["sectionsRecovered"] == ["HEADER", "TABLES", "ENTITIES"]
            and parsed["acadVersionHeader"] == "AC1009"
            and parsed["insUnitsHeader"] == "5"
            and len(missing_table) == 0
            and len(missing_entity) == 0
            and len(parsed["grainLines"]) >= len(pieces_meta)
            and len(parsed["notchLines"]) >= 1
            and len(parsed["drillPoints"]) >= 1
            and len(parsed["internalPolylines"]) >= 1
            and parsed["sha256Digest"] == combined["sha256Digest"]
            and math.isfinite(max_err)
            and max_err <= 0.001
        )
        dxf_results.append(
            {
                "sizeLabel": size_label,
                "exportId": combined["exportId"],
                "pieceCodes": combined["pieceCodes"],
                "parserAuthority": "UNIFIED_STRICT_PARSE_DXF_AAMA_STRICT",
                "isStructurallyValid": parsed["isStructurallyValid"],
                "hasEofMarker": parsed["hasEofMarker"],
                "unterminatedPolylinesCount": parsed["unterminatedPolylinesCount"],
                "emptyPolylinesCount": parsed["emptyPolylinesCount"],
                "structuralErrors": parsed["structuralErrors"],
                "sectionsRecovered": parsed["sectionsRecovered"],
                "acadVersionHeader": parsed["acadVersionHeader"],
                "insUnitsHeader": parsed["insUnitsHeader"],
                "tableLayersDefined": parsed["tableLayersDefined"],
                "entityLayersFound": parsed["entityLayersFound"],
                "missingTableLayers": missing_table,
                "missingEntityLayers": missing_entity,
                "cutPolylinesRecovered": len(parsed["cutPolylines"]),
                "sewPolylinesRecovered": len(parsed["sewPolylines"]),
                "grainLinesRecovered": len(parsed["grainLines"]),
                "notchLinesRecovered": len(parsed["notchLines"]),
                "drillPointsRecovered": len(parsed["drillPoints"]),
                "internalPolylinesRecovered": len(parsed["internalPolylines"]),
                "totalCutVertices": combined["totalCutVertices"],
                "totalSewVertices": combined["totalSewVertices"],
                "maxVertexRoundTripErrorCm": max_err,
                "dxfPayloadSha256": parsed["sha256Digest"],
                "tsRoundTripAllPassed": bundle["combinedTsRoundTrip"]["allPassed"],
                "syntheticRoundTripVerified": size_dxf_ok,
                "externalCadInteroperabilityVerified": False,
                "allPassed": size_dxf_ok and bundle["combinedTsRoundTrip"]["allPassed"],
            }
        )

        # Seam Parity Verification via Python Method C1-Cert on actual drafted curves
        py_paired_checks: List[Dict[str, Any]] = []
        for check in bundle["seamAudit"]["pairedSeamChecks"]:
            a_pairs = [_segment_c1_cert_arc_length(s) for s in check["edgeASegments"]]
            b_pairs = [_segment_c1_cert_arc_length(s) for s in check["edgeBSegments"]]
            a_lo_q = sum((p[0] for p in a_pairs), Fraction(0))
            a_hi_q = sum((p[1] for p in a_pairs), Fraction(0))
            b_lo_q = sum((p[0] for p in b_pairs), Fraction(0))
            b_hi_q = sum((p[1] for p in b_pairs), Fraction(0))
            a_lo, a_hi = fraction_pair_to_outward_f64_pair(a_lo_q, a_hi_q)
            b_lo, b_hi = fraction_pair_to_outward_f64_pair(b_lo_q, b_hi_q)

            ease_q = Fraction(str(check["targetEaseCm"]))
            worst_case_q = max(abs((a_hi_q - b_lo_q) - ease_q), abs((b_hi_q - a_lo_q) - ease_q))
            worst_case_delta = fraction_to_outward_upper_f64(worst_case_q)

            a_mid = 0.5 * (a_lo + a_hi)
            b_mid = 0.5 * (b_lo + b_hi)
            delta_mid = abs((a_mid - b_mid) - check["targetEaseCm"])
            py_paired_checks.append(
                {
                    "seamPair": check["seamPair"],
                    "tsEdgeACm": check["edgeALengthCm"],
                    "tsEdgeBCm": check["edgeBLengthCm"],
                    "tsCadDeltaCm": check["cadDeltaCm"],
                    "pythonC1CertEdgeAIntervalCm": [a_lo, a_hi],
                    "pythonC1CertEdgeBIntervalCm": [b_lo, b_hi],
                    "pythonMidpointDeltaCm": delta_mid,
                    "pythonWorstCaseIntervalDeltaCm": worst_case_delta,
                    "diagnosticFields": ["tsEdgeACm", "tsEdgeBCm", "tsCadDeltaCm", "pythonMidpointDeltaCm"],
                    "certificationFields": [
                        "pythonC1CertEdgeAIntervalCm",
                        "pythonC1CertEdgeBIntervalCm",
                        "pythonWorstCaseIntervalDeltaCm",
                    ],
                    "withinTier1CadTolerance0_05Cm": worst_case_delta <= 0.05 and check["withinTier1CadTolerance0_05Cm"],
                }
            )

        ease_info = bundle["seamAudit"]["bodiceSleeveAssemblyEase"]
        size_seam_ok = (
            all(c["withinTier1CadTolerance0_05Cm"] for c in py_paired_checks)
            and bundle["seamAudit"]["allPassed"]
            and ease_info["isValid"]
            and ease_info["isTotalEasePermitted"]
            and ease_info["isDistributionBalanced"]
            and ease_info["inseamParityDeltaCm"] <= 0.05
        )
        seam_results.append(
            {
                "sizeLabel": size_label,
                "pairedSeamChecks": py_paired_checks,
                "bodiceSleeveAssemblyEase": ease_info,
                "allPassed": size_seam_ok,
            }
        )

    dxf_report = {
        "artifactName": "ProductionDxfRoundTripReport.json",
        "packageId": "PKG-M00-04",
        "sourceDraftingModules": exported["draftedModulesUsed"],
        "missingDependenciesForVerticalSlice1": exported["missingDependencies"],
        "toleranceMaxCm": 0.001,
        "syntheticRoundTripVerified": all(r["syntheticRoundTripVerified"] for r in dxf_results),
        "externalCadInteroperabilityVerified": False,
        "interoperabilityPolicyNote": (
            "Synthetic DXF R12 (AC1009) round-trip verification passes against actual drafted Bodice (Front, Back), "
            "Sleeve, and Skirt (Front, Back) contours. External third-party CAD software interoperability remains "
            "unverified (scheduled under M05). Vertical Slice 1 remains incomplete until src/engine/drafting/trouser-block.ts is built."
        ),
        "sizeReports": dxf_results,
        "allPassed": all(r["allPassed"] for r in dxf_results),
    }

    seam_report = {
        "artifactName": "ProductionSeamParityReport.json",
        "packageId": "PKG-M00-04",
        "governingDecision": "DEC-11 (Two-Tier Seam Tolerance: Tier 1 CAD <= 0.05 cm; Tier 2 Physical <= 0.20 cm)",
        "sourceDraftingModules": exported["draftedModulesUsed"],
        "missingDependenciesForVerticalSlice1": exported["missingDependencies"],
        "dec11Tier1CadToleranceCm": 0.05,
        "dec11Tier2PhysicalToleranceCm": 0.20,
        "serializationAssuranceMetadata": {
            "certificationAuthority": "METHOD_C1_CERT_ADAPTIVE_EXACT_RATIONAL_SUM_OUTWARD_F64",
            "diagnosticOnlyFields": ["tsEdgeACm", "tsEdgeBCm", "tsCadDeltaCm", "pythonMidpointDeltaCm"],
            "certificationBearingFields": [
                "pythonC1CertEdgeAIntervalCm",
                "pythonC1CertEdgeBIntervalCm",
                "pythonWorstCaseIntervalDeltaCm",
            ],
        },
        "sizeReports": seam_results,
        "allPassed": all(r["allPassed"] for r in seam_results),
    }
    return dxf_report, seam_report


def main() -> None:
    dxf_report, seam_report = verify_exported_bundle()
    dxf_bytes = (json.dumps(dxf_report, indent=2) + "\n").encode("utf-8")
    seam_bytes = (json.dumps(seam_report, indent=2) + "\n").encode("utf-8")

    dxf_path = ARTIFACTS_DIR / "ProductionDxfRoundTripReport.json"
    seam_path = ARTIFACTS_DIR / "ProductionSeamParityReport.json"
    dxf_path.write_bytes(dxf_bytes)
    seam_path.write_bytes(seam_bytes)

    dxf_sha = hashlib.sha256(dxf_bytes).hexdigest()
    seam_sha = hashlib.sha256(seam_bytes).hexdigest()
    assert dxf_report["allPassed"], "ProductionDxfRoundTripReport verification failed!"
    assert seam_report["allPassed"], "ProductionSeamParityReport verification failed!"
    assert dxf_report["externalCadInteroperabilityVerified"] is False

    print(f"ProductionDxfRoundTripReport.json -> SHA-256: {dxf_sha}")
    print(f"ProductionSeamParityReport.json   -> SHA-256: {seam_sha}")


if __name__ == "__main__":
    main()
