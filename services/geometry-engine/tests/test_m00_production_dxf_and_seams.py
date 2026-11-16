"""Pytest suite for Workstream B: Real Drafted Piece DXF-AAMA (AC1009) & DEC-11 Seam Parity."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from m00_verify_production_dxf_and_seams import verify_exported_bundle  # noqa: E402


def test_production_dxf_aama_and_dec11_seam_parity() -> None:
    dxf_report, seam_report = verify_exported_bundle()

    assert dxf_report["allPassed"] is True
    assert dxf_report["syntheticRoundTripVerified"] is True
    assert dxf_report["externalCadInteroperabilityVerified"] is False
    assert len(dxf_report["missingDependenciesForVerticalSlice1"]) == 1
    assert "trouser-block" in dxf_report["missingDependenciesForVerticalSlice1"][0]["dependency"]

    assert len(dxf_report["sizeReports"]) == 3
    for rep in dxf_report["sizeReports"]:
        assert rep["acadVersionHeader"] == "AC1009"
        assert rep["insUnitsHeader"] == "5"
        assert rep["missingTableLayers"] == []
        assert rep["missingEntityLayers"] == []
        assert rep["cutPolylinesRecovered"] == 5  # Bodice F/B, Sleeve, Skirt F/B
        assert rep["sewPolylinesRecovered"] == 5
        assert rep["maxVertexRoundTripErrorCm"] <= 0.001

    assert seam_report["allPassed"] is True
    assert len(seam_report["sizeReports"]) == 3
    for srep in seam_report["sizeReports"]:
        assert len(srep["pairedSeamChecks"]) == 4
        assert all(c["withinTier1CadTolerance0_05Cm"] for c in srep["pairedSeamChecks"])
        assert srep["bodiceSleeveAssemblyEase"]["isValid"] is True
        assert srep["bodiceSleeveAssemblyEase"]["isTotalEasePermitted"] is True
        assert srep["bodiceSleeveAssemblyEase"]["isDistributionBalanced"] is True
        assert srep["bodiceSleeveAssemblyEase"]["isTargetCompliant"] is False
        assert srep["bodiceSleeveAssemblyEase"]["inseamParityDeltaCm"] <= 0.05
