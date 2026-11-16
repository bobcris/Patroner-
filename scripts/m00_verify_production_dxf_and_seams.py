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
)

ARTIFACTS_DIR = REPO_ROOT / "artifacts" / "m00"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
REQUIRED_LAYERS = {"1", "2", "4", "7", "8", "11"}


def parse_dxf_aama_multi_piece(dxf_text: str) -> Dict[str, Any]:
    raw_lines = [ln.strip() for ln in dxf_text.strip().splitlines()]
    pairs = [(raw_lines[i], raw_lines[i + 1]) for i in range(0, len(raw_lines) - 1, 2)]

    sections_found: List[str] = []
    acad_ver = ""
    ins_units = ""
    table_layers = set()
    entity_layers = set()
    cut_polylines: List[List[Tuple[float, float]]] = []
    sew_polylines: List[List[Tuple[float, float]]] = []
    internal_polylines: List[List[Tuple[float, float]]] = []
    grain_lines: List[Tuple[Tuple[float, float], Tuple[float, float]]] = []
    notch_lines: List[Tuple[Tuple[float, float], Tuple[float, float]]] = []
    drill_points: List[Tuple[float, float]] = []
    texts: List[str] = []

    current_section: str | None = None
    poly_layer: str | None = None
    poly_pts: List[Tuple[float, float]] = []

    i = 0
    while i < len(pairs):
        code, val = pairs[i]
        if code == "0" and val == "SECTION" and i + 1 < len(pairs) and pairs[i + 1][0] == "2":
            current_section = pairs[i + 1][1]
            sections_found.append(current_section)
            i += 2
            continue
        if code == "0" and val == "ENDSEC":
            current_section = None
            i += 1
            continue

        if current_section == "HEADER":
            if code == "9" and val == "$ACADVER" and i + 1 < len(pairs):
                acad_ver = pairs[i + 1][1]
            elif code == "9" and val == "$INSUNITS" and i + 1 < len(pairs):
                ins_units = pairs[i + 1][1]
            i += 1
            continue

        if current_section == "TABLES":
            if code == "0" and val == "LAYER":
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    if pairs[i][0] == "2":
                        table_layers.add(pairs[i][1])
                    i += 1
                continue
            i += 1
            continue

        if current_section == "ENTITIES":
            if code == "0" and val == "POLYLINE":
                layer = "0"
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    if pairs[i][0] == "8":
                        layer = pairs[i][1]
                    i += 1
                entity_layers.add(layer)
                poly_layer = layer
                poly_pts = []
                continue
            if code == "0" and val == "VERTEX" and poly_layer is not None:
                vx, vy = 0.0, 0.0
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    if pairs[i][0] == "10":
                        vx = float(pairs[i][1])
                    elif pairs[i][0] == "20":
                        vy = float(pairs[i][1])
                    i += 1
                poly_pts.append((vx, vy))
                continue
            if code == "0" and val == "SEQEND" and poly_layer is not None:
                if poly_layer == "1":
                    cut_polylines.append(poly_pts)
                elif poly_layer == "8":
                    sew_polylines.append(poly_pts)
                elif poly_layer == "11":
                    internal_polylines.append(poly_pts)
                poly_layer = None
                poly_pts = []
                i += 1
                continue
            if code == "0" and val == "LINE":
                layer = "0"
                x1 = y1 = x2 = y2 = 0.0
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    c, v = pairs[i]
                    if c == "8":
                        layer = v
                    elif c == "10":
                        x1 = float(v)
                    elif c == "20":
                        y1 = float(v)
                    elif c == "11":
                        x2 = float(v)
                    elif c == "21":
                        y2 = float(v)
                    i += 1
                entity_layers.add(layer)
                if layer == "7":
                    grain_lines.append(((x1, y1), (x2, y2)))
                elif layer == "4":
                    notch_lines.append(((x1, y1), (x2, y2)))
                continue
            if code == "0" and val == "POINT":
                layer = "0"
                px = py = 0.0
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    c, v = pairs[i]
                    if c == "8":
                        layer = v
                    elif c == "10":
                        px = float(v)
                    elif c == "20":
                        py = float(v)
                    i += 1
                entity_layers.add(layer)
                if layer == "2":
                    drill_points.append((px, py))
                continue
            if code == "0" and val == "TEXT":
                layer = "0"
                tval = ""
                i += 1
                while i < len(pairs) and pairs[i][0] != "0":
                    c, v = pairs[i]
                    if c == "8":
                        layer = v
                    elif c == "1":
                        tval = v
                    i += 1
                entity_layers.add(layer)
                texts.append(tval)
                continue
        i += 1

    return {
        "sectionsRecovered": sections_found,
        "acadVersionHeader": acad_ver,
        "insUnitsHeader": ins_units,
        "tableLayersDefined": sorted(table_layers),
        "entityLayersFound": sorted(entity_layers),
        "cutPolylines": cut_polylines,
        "sewPolylines": sew_polylines,
        "internalPolylines": internal_polylines,
        "grainLines": grain_lines,
        "notchLines": notch_lines,
        "drillPoints": drill_points,
        "texts": texts,
        "sha256Digest": hashlib.sha256(dxf_text.encode("utf-8")).hexdigest(),
    }


def _segment_c1_cert_arc_length(seg: Dict[str, Any]) -> Tuple[float, float]:
    """Computes (lower_bound_cm, upper_bound_cm) arc length on a line or cubic Bezier segment."""
    if seg["type"] == "line":
        iv.prec = 113
        dx = iv.mpf(str(seg["p3"]["x"])) - iv.mpf(str(seg["p0"]["x"]))
        dy = iv.mpf(str(seg["p3"]["y"])) - iv.mpf(str(seg["p0"]["y"]))
        dist_iv = iv.sqrt((dx ** 2) + (dy ** 2))
        return float(dist_iv.a), float(dist_iv.b)

    curve = ExactCubicBezier2D.from_floats(
        seg["id"],
        (seg["p0"]["x"], seg["p0"]["y"]),
        (seg["cp1"]["x"], seg["cp1"]["y"]),
        (seg["cp2"]["x"], seg["cp2"]["y"]),
        (seg["p3"]["x"], seg["p3"]["y"]),
    )
    enc = method_c1_cert_arc_length_enclosure(curve, subdivision_depth=8)
    return float(enc["lowerChordBoundCm"]), float(enc["upperControlPolygonBoundCm"])


def verify_exported_bundle() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    raw = subprocess.check_output(
        ["npx", "--yes", "tsx", str(REPO_ROOT / "scripts" / "m00_export_canonical_pieces.ts")],
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
            parsed["sectionsRecovered"] == ["HEADER", "TABLES", "ENTITIES"]
            and parsed["acadVersionHeader"] == "AC1009"
            and parsed["insUnitsHeader"] == "5"
            and len(missing_table) == 0
            and len(missing_entity) == 0
            and parsed["sha256Digest"] == combined["sha256Digest"]
            and math.isfinite(max_err)
            and max_err <= 0.001
        )
        dxf_results.append(
            {
                "sizeLabel": size_label,
                "exportId": combined["exportId"],
                "pieceCodes": combined["pieceCodes"],
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
                "maxVertexRoundTripErrorCm": round(max_err, 9),
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
            a_lo = sum(_segment_c1_cert_arc_length(s)[0] for s in check["edgeASegments"])
            a_hi = sum(_segment_c1_cert_arc_length(s)[1] for s in check["edgeASegments"])
            b_lo = sum(_segment_c1_cert_arc_length(s)[0] for s in check["edgeBSegments"])
            b_hi = sum(_segment_c1_cert_arc_length(s)[1] for s in check["edgeBSegments"])
            a_mid = 0.5 * (a_lo + a_hi)
            b_mid = 0.5 * (b_lo + b_hi)
            delta_mid = abs((a_mid - b_mid) - check["targetEaseCm"])
            worst_case_delta = max(
                abs((a_hi - b_lo) - check["targetEaseCm"]),
                abs((b_hi - a_lo) - check["targetEaseCm"]),
            )
            py_paired_checks.append(
                {
                    "seamPair": check["seamPair"],
                    "tsEdgeACm": check["edgeALengthCm"],
                    "tsEdgeBCm": check["edgeBLengthCm"],
                    "tsCadDeltaCm": check["cadDeltaCm"],
                    "pythonC1CertEdgeAIntervalCm": [round(a_lo, 6), round(a_hi, 6)],
                    "pythonC1CertEdgeBIntervalCm": [round(b_lo, 6), round(b_hi, 6)],
                    "pythonMidpointDeltaCm": round(delta_mid, 6),
                    "pythonWorstCaseIntervalDeltaCm": round(worst_case_delta, 6),
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
        "packageId": "PKG-DXF-SEAM-WORKSTREAM-B",
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
        "packageId": "PKG-DXF-SEAM-WORKSTREAM-B",
        "governingDecision": "DEC-11 (Two-Tier Seam Tolerance: Tier 1 CAD <= 0.05 cm; Tier 2 Physical <= 0.20 cm)",
        "sourceDraftingModules": exported["draftedModulesUsed"],
        "missingDependenciesForVerticalSlice1": exported["missingDependencies"],
        "dec11Tier1CadToleranceCm": 0.05,
        "dec11Tier2PhysicalToleranceCm": 0.20,
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
