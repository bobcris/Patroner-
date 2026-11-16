"""M00.1 Canonical Coordinate Frame, Units & Contract Schemas (Pydantic v2 + JSON Schema Draft 2020-12 Parity).

Implements all canonical contracts required by M00.1 and ADR-009 (R2.1.2-R1):
- CoordinateFrameSpec, Point2D, BezierSegment
- CanonicalOffsetClassification (ADR-009 §4.3-4.4: 6 failure classifications + CERTIFIED_VALID)
- BaseCurveSingularityClassification (ADR-009 §2.2 & §4.2: 5-way base-curve singularity taxonomy)
- StationaryParameterizationStatus & OffsetFailureCategory (ADR-009 §5.3)
- BodyProfile (with anatomical range and covariance invariants)
- GarmentSpec
- PatternPiece
- Notch (and alias NotchSpec)
- SeamAllowance (and alias SeamAllowanceSpec)
- DxfExportManifest
- GeometryWarning
- NumericalVerificationRecord (ADR-009 §2.5)
- OffsetValidationRecord (ADR-009 §5.3)
- OffsetClassificationReport & RootBracketCertificate & SelfIntersectionCertificate
"""

from __future__ import annotations

import hashlib
import json
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

import jsonschema
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


class CanonicalOffsetClassification(str, Enum):
    """ADR-009 §4.3-4.4 Six Canonical Offset Classifications plus CERTIFIED_VALID."""

    CERTIFIED_VALID = "CERTIFIED_VALID"
    REGULARITY_MARGIN_VIOLATION = "REGULARITY_MARGIN_VIOLATION"
    ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP = "ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP"
    TANGENT_REVERSAL = "TANGENT_REVERSAL"
    LOCAL_SELF_INTERSECTION = "LOCAL_SELF_INTERSECTION"
    GLOBAL_SELF_INTERSECTION = "GLOBAL_SELF_INTERSECTION"
    INCONCLUSIVE = "INCONCLUSIVE"


# Alias for compatibility
OffsetClassificationCategory = CanonicalOffsetClassification


class BaseCurveSingularityClassification(str, Enum):
    """ADR-009 §2.2 & §4.2 Separate 5-Way Base-Curve Singularity Classification where Q(t*) = 0."""

    REGULAR_BASE_CURVE = "REGULAR_BASE_CURVE"
    GENUINE_ZERO_SPEED_GEOMETRIC_CUSP_OR_FOLD = "GENUINE_ZERO_SPEED_GEOMETRIC_CUSP_OR_FOLD"
    REMOVABLE_PARAMETERIZATION_DEGENERACY = "REMOVABLE_PARAMETERIZATION_DEGENERACY"
    ENDPOINT_TANGENTIAL_DEGENERACY = "ENDPOINT_TANGENTIAL_DEGENERACY"
    COLLAPSED_ZERO_LENGTH_CURVE = "COLLAPSED_ZERO_LENGTH_CURVE"


class StationaryParameterizationStatus(str, Enum):
    """ADR-009 §5.3 stationary_parameterization_status enum for OffsetValidationRecord."""

    NONE_REGULAR_SPEED = "NONE_REGULAR_SPEED"
    REMOVABLE_PARAMETERIZATION_DEGENERACY = "REMOVABLE_PARAMETERIZATION_DEGENERACY"
    GENUINE_BASE_GEOMETRIC_SINGULARITY = "GENUINE_BASE_GEOMETRIC_SINGULARITY"
    ENDPOINT_TANGENTIAL_DEGENERACY = "ENDPOINT_TANGENTIAL_DEGENERACY"
    COLLAPSED_ZERO_LENGTH_CURVE = "COLLAPSED_ZERO_LENGTH_CURVE"


class OffsetFailureCategory(str, Enum):
    """ADR-009 §5.3 failure_category enum for OffsetValidationRecord."""

    NONE = "NONE"
    REGULARITY_MARGIN_VIOLATION = "REGULARITY_MARGIN_VIOLATION"
    ACTUAL_ZERO_SPEED_CUSP = "ACTUAL_ZERO_SPEED_CUSP"
    ACTUAL_OFFSET_SINGULARITY_ZERO_SPEED_CUSP = "ACTUAL_OFFSET_SINGULARITY / ZERO_SPEED_CUSP"
    TANGENT_REVERSAL = "TANGENT_REVERSAL"
    LOCAL_OFFSET_SELF_INTERSECTION = "LOCAL_OFFSET_SELF_INTERSECTION"
    LOCAL_SELF_INTERSECTION = "LOCAL_SELF_INTERSECTION"
    GLOBAL_CONTOUR_SELF_INTERSECTION = "GLOBAL_CONTOUR_SELF_INTERSECTION"
    GLOBAL_SELF_INTERSECTION = "GLOBAL_SELF_INTERSECTION"
    INCONCLUSIVE_VERIFICATION = "INCONCLUSIVE_VERIFICATION"
    INCONCLUSIVE = "INCONCLUSIVE"


class Point2D(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    x: float = Field(..., description="X coordinate in cm (right-handed Cartesian plane)")
    y: float = Field(..., description="Y coordinate in cm (right-handed Cartesian plane)")


class CoordinateFrameSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    geometryUnit: Literal["cm"] = "cm"
    clearanceUnit: Literal["mm"] = "mm"
    internalAngleUnit: Literal["rad"] = "rad"
    displayAngleUnit: Literal["deg"] = "deg"
    handedness: Literal["right-handed-cartesian"] = "right-handed-cartesian"
    exteriorWinding: Literal["CCW"] = "CCW"
    interiorCutoutWinding: Literal["CW"] = "CW"
    leftNormalDirectionOnExterior: Literal["inward"] = "inward"


class BezierSegment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(..., min_length=1)
    p0: Point2D
    p1: Point2D
    p2: Point2D
    p3: Point2D


class SeamAllowance(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    segmentId: str = Field(..., min_length=1)
    distanceCm: float = Field(..., ge=0.0, le=10.0)
    directionSign: Literal[-1, 1] = Field(
        ...,
        description="+1 along +N_+(t) (inward on CCW exterior); -1 along -N_+(t) (outward on CCW exterior)",
    )
    joinStyle: Literal["miter", "bevel", "round", "fold"] = "miter"
    miterLimit: float = Field(2.5, ge=1.0, le=10.0)


SeamAllowanceSpec = SeamAllowance


class Notch(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(..., min_length=1)
    segmentId: str = Field(..., min_length=1)
    targetArcLengthCm: float = Field(..., ge=0.0)
    parameterT: float = Field(..., ge=0.0, le=1.0)
    position: Point2D
    normalVector: Point2D
    notchType: Literal["slit", "v-notch", "t-notch", "double"]
    arcLengthResidualCm: float = Field(0.0, ge=0.0, le=1e-7)


NotchSpec = Notch


class RootBracketCertificate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    tLower: float = Field(..., ge=-1.0, le=2.0)
    tUpper: float = Field(..., ge=-1.0, le=2.0)
    deltaT: float = Field(..., ge=0.0, le=1e-12)
    maxSpeedOnBracket: float = Field(..., ge=0.0)
    deltaPosCm: float = Field(..., ge=0.0, le=1e-7)
    multiplicityOrOrder: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_bracket_order(self) -> "RootBracketCertificate":
        if self.tUpper < self.tLower:
            raise ValueError("tUpper must be >= tLower")
        return self


class SelfIntersectionCertificate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    scope: Literal["LOCAL", "GLOBAL"]
    segmentIdA: str = Field(..., min_length=1)
    segmentIdB: str = Field(..., min_length=1)
    t1Bracket: Tuple[float, float]
    t2Bracket: Tuple[float, float]
    intersectionPointCm: Point2D
    residualDistanceCm: float = Field(..., ge=0.0, le=1e-6)


class NumericalVerificationRecord(BaseModel):
    """ADR-009 §2.5 Mandatory Numerical Verification Record separating parameter uncertainty from geometric error."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    curve_id: str = Field(..., min_length=1)
    operation_type: Literal[
        "ARC_LENGTH",
        "INVERSE_ARC_LENGTH",
        "OFFSET_CURVE",
        "CURVE_INTERSECTION",
        "ROOT_ISOLATION",
    ]
    parameter_bracket_t: Tuple[float, float]
    parameter_uncertainty_dt: float = Field(..., ge=0.0, le=1e-12)
    local_speed_upper_bound_cm_per_t: float = Field(..., ge=0.0)
    propagated_position_error_cm: float = Field(..., ge=0.0)
    direct_geometric_error_bound_cm: float = Field(..., ge=0.0)
    propagation_method: Literal[
        "B1_FIRST_ORDER_UPPER_BOUND",
        "B2_INTERVAL_IMAGE_ENCLOSURE",
        "C1_CERT_CHORD_POLYGON_BOUNDS",
    ]
    working_precision_bits: int = Field(..., ge=53, le=336)
    adaptive_subdivision_panels: int = Field(..., ge=1)
    certified_within_tolerance: bool

    @model_validator(mode="after")
    def validate_propagation_consistency(self) -> "NumericalVerificationRecord":
        lo, hi = self.parameter_bracket_t
        if not (0.0 <= lo <= hi <= 1.0):
            raise ValueError(f"Invalid parameter_bracket_t [{lo}, {hi}] outside [0, 1]")
        if self.propagation_method == "B1_FIRST_ORDER_UPPER_BOUND":
            expected = self.local_speed_upper_bound_cm_per_t * self.parameter_uncertainty_dt
            if self.propagated_position_error_cm + 1e-15 < expected:
                raise ValueError(
                    "Method B1 violation: propagated_position_error_cm must bound local_speed_upper_bound * dt"
                )
        return self


class OffsetValidationRecord(BaseModel):
    """ADR-009 §5.3 Mandatory Offset Validation Record produced by the C1-Cert oracle."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    segment_id: str = Field(..., min_length=1)
    piece_id: str = Field(..., min_length=1)
    contour_orientation: Literal["CCW_EXTERIOR", "CW_CUTOUT"]
    offset_direction_sign_s: Literal[-1, 1]
    offset_distance_cm: float = Field(..., ge=0.0)
    regularity_margin_epsilon: float = Field(0.05, gt=0.0, le=0.5)
    min_base_speed_squared_interval: Tuple[float, float]
    min_offset_speed_factor_interval: Tuple[float, float]
    has_zero_speed_cusp_on_domain: bool
    has_tangent_reversal_on_domain: bool
    stationary_parameterization_status: StationaryParameterizationStatus
    base_curve_singularity_classification: BaseCurveSingularityClassification
    isolated_cusp_roots_t: List[Tuple[float, float]] = Field(default_factory=list)
    isolated_self_intersections: List[SelfIntersectionCertificate] = Field(default_factory=list)
    max_geometric_deviation_bound_cm: float = Field(..., ge=0.0)
    verification_outcome: Literal["CERTIFIED_VALID", "CERTIFIED_INVALID", "INCONCLUSIVE"]
    failure_category: OffsetFailureCategory
    canonical_offset_classification: CanonicalOffsetClassification
    active_classifications_on_domain: List[CanonicalOffsetClassification] = Field(..., min_length=1)
    working_precision_bits: int = Field(..., ge=53, le=336)
    is_production_ready: bool

    @model_validator(mode="after")
    def validate_adr009_invariants(self) -> "OffsetValidationRecord":
        q_lo, q_hi = self.min_base_speed_squared_interval
        f_lo, f_hi = self.min_offset_speed_factor_interval
        if q_hi < q_lo:
            raise ValueError("min_base_speed_squared_interval upper bound < lower bound")
        if f_hi < f_lo:
            raise ValueError("min_offset_speed_factor_interval upper bound < lower bound")
        if self.verification_outcome == "INCONCLUSIVE" and self.is_production_ready:
            raise ValueError("INCONCLUSIVE verification outcome cannot set is_production_ready=True")
        if self.verification_outcome == "CERTIFIED_INVALID" and self.is_production_ready:
            raise ValueError("CERTIFIED_INVALID verification outcome cannot set is_production_ready=True")
        if self.verification_outcome == "CERTIFIED_VALID" and self.failure_category != OffsetFailureCategory.NONE:
            raise ValueError("CERTIFIED_VALID record must have failure_category == NONE")
        return self


class OffsetClassificationReport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    segmentId: str = Field(..., min_length=1)
    canonicalOffsetClassification: CanonicalOffsetClassification
    activeClassificationsOnDomain: List[CanonicalOffsetClassification] = Field(..., min_length=1)
    baseCurveSingularityClassification: BaseCurveSingularityClassification
    verificationOutcome: Literal["CERTIFIED_VALID", "CERTIFIED_INVALID", "INCONCLUSIVE"]
    failureCategory: OffsetFailureCategory
    directionSign: Literal[-1, 1]
    offsetDistanceCm: float = Field(..., ge=0.0)
    minBaseSpeedSquaredQ: float = Field(..., ge=0.0)
    minOffsetSpeedFactorF: float
    hasZeroSpeedCuspOnDomain: bool
    hasTangentReversalOnDomain: bool
    gridErrorCm: float = Field(..., ge=0.0)
    certifiedIntervalErrorCm: float = Field(..., ge=0.0)
    maxJoinTangentDeltaDeg: float = Field(..., ge=0.0)
    reparameterized: bool
    trimmed: bool
    isolatedRoots: List[RootBracketCertificate] = Field(default_factory=list)
    oracleTierUsed: Literal[
        "C1-Fast",
        "C1-Cert-53bit",
        "C1-Cert-113bit-Q",
        "C1-Cert-170bit-Q",
        "C1-Cert-336bit-Q",
    ]
    isProductionReady: bool


class GeometryWarning(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    warningId: str = Field(..., min_length=1)
    code: str = Field(..., min_length=1)
    severity: Literal["INFO", "WARNING", "ERROR", "CRITICAL_BLOCKING"]
    classification: CanonicalOffsetClassification
    pieceId: str = Field(..., min_length=1)
    segmentId: str = Field(..., min_length=1)
    parameterT: Optional[float] = Field(None, ge=0.0, le=1.0)
    message: str = Field(..., min_length=1)
    remediationAction: str = Field(..., min_length=1)


class DxfExportManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    exportId: str = Field(..., min_length=1)
    standard: Literal["DXF-AAMA / ASTM D6673"] = "DXF-AAMA / ASTM D6673"
    dxfVersion: Literal["AC1009"] = "AC1009"
    geometryUnit: Literal["cm"] = "cm"
    requiredLayers: List[Literal["1", "2", "4", "7", "8", "11"]] = Field(..., min_length=6)
    recoveredLayers: List[str] = Field(..., min_length=6)
    pieceCodes: List[str] = Field(..., min_length=1)
    totalVertexCount: int = Field(..., ge=3)
    maxRoundTripCoordinateErrorCm: float = Field(..., ge=0.0, le=0.001)
    sha256Digest: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    syntheticRoundTripVerified: bool
    externalCadInteroperabilityVerified: bool


class BodyProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    profileId: str = Field(..., min_length=1)
    unit: Literal["cm"] = "cm"
    heightCm: Optional[float] = Field(168.0, ge=130.0, le=210.0)
    bustCm: float = Field(..., ge=70.0, le=150.0)
    waistCm: float = Field(..., ge=52.0, le=140.0)
    highHipCm: float = Field(..., ge=68.0, le=155.0)
    lowHipCm: float = Field(..., ge=75.0, le=165.0)
    waistToHipCm: float = Field(..., ge=14.0, le=28.0)
    skirtLengthCm: Optional[float] = Field(65.0, ge=30.0, le=120.0)
    backWaistLengthCm: float = Field(..., ge=34.0, le=50.0)
    frontWaistLengthCm: float = Field(..., ge=34.0, le=54.0)
    acrossBackCm: float = Field(..., ge=28.0, le=50.0)
    shoulderLengthCm: float = Field(..., ge=9.0, le=18.0)
    neckCircumferenceCm: float = Field(..., ge=30.0, le=50.0)
    bustSpanCm: float = Field(..., ge=14.0, le=28.0)
    bustHeightCm: float = Field(..., ge=18.0, le=36.0)
    armholeDepthCm: float = Field(..., ge=16.0, le=30.0)
    bicepsCircumferenceCm: Optional[float] = Field(29.0, ge=22.0, le=50.0)
    wristCircumferenceCm: Optional[float] = Field(16.0, ge=13.0, le=24.0)
    sleeveLengthCm: float = Field(..., ge=48.0, le=72.0)

    @model_validator(mode="after")
    def validate_anatomical_covariance(self) -> "BodyProfile":
        if self.lowHipCm < self.highHipCm - 2.0:
            raise ValueError("Anatomical covariance violation: lowHipCm cannot be >2 cm smaller than highHipCm")
        if self.bustSpanCm >= self.bustCm * 0.35:
            raise ValueError("Anatomical covariance violation: bustSpanCm exceeds plausible fraction of bustCm")
        if self.acrossBackCm >= self.bustCm * 0.55:
            raise ValueError("Anatomical covariance violation: acrossBackCm exceeds plausible fraction of bustCm")
        if self.waistCm > self.lowHipCm + 12.0:
            raise ValueError("Anatomical covariance violation: waistCm exceeds plausible bound relative to lowHipCm")
        return self


class GarmentSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    garmentId: str = Field(..., min_length=1)
    garmentCategory: Literal["bodice_block", "skirt_block", "sleeve_block", "trouser_block", "dress_block"]
    blockSystem: Literal["ISO_INDUSTRIAL_V1", "MULLER_SOHN", "ALDRICH"] = "ISO_INDUSTRIAL_V1"
    bodyProfileId: str = Field(..., min_length=1)
    coordinateFrame: CoordinateFrameSpec = Field(default_factory=CoordinateFrameSpec)
    bustEaseCm: float = Field(..., ge=0.0, le=25.0)
    waistEaseCm: float = Field(..., ge=0.0, le=20.0)
    hipEaseCm: float = Field(..., ge=0.0, le=25.0)
    defaultSeamAllowanceCm: float = Field(1.5, ge=0.0, le=5.0)
    hemAllowanceCm: float = Field(3.0, ge=0.0, le=10.0)
    grainlineAngleDeg: float = Field(0.0, ge=-90.0, le=90.0)


class PatternPiece(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    pieceId: str = Field(..., min_length=1)
    pieceCode: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    coordinateFrame: CoordinateFrameSpec = Field(default_factory=CoordinateFrameSpec)
    sewBoundarySegments: List[BezierSegment] = Field(..., min_length=1)
    cutBoundarySegments: List[BezierSegment] = Field(..., min_length=1)
    notches: List[Notch] = Field(default_factory=list)
    seamAllowances: List[SeamAllowance] = Field(default_factory=list)
    offsetReports: List[OffsetClassificationReport] = Field(default_factory=list)
    offsetValidationRecords: List[OffsetValidationRecord] = Field(default_factory=list)
    warnings: List[GeometryWarning] = Field(default_factory=list)


def verify_schemas_lock(schema_path: Path) -> Dict[str, Any]:
    """Verifies round-trip positive & negative parity between JSON Schema Draft 2020-12 and Pydantic v2 models."""
    raw_bytes = schema_path.read_bytes()
    schema_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    schema_doc = json.loads(raw_bytes.decode("utf-8"))

    # Validate Draft 2020-12 meta-schema compliance
    jsonschema.Draft202012Validator.check_schema(schema_doc)

    sample_coord = CoordinateFrameSpec()
    sample_seg = BezierSegment(
        id="seg-armscye-01",
        p0=Point2D(x=0.0, y=0.0),
        p1=Point2D(x=3.0, y=1.5),
        p2=Point2D(x=6.0, y=4.5),
        p3=Point2D(x=8.0, y=9.0),
    )
    sample_seam = SeamAllowance(
        segmentId="seg-armscye-01",
        distanceCm=1.5,
        directionSign=-1,
        joinStyle="miter",
        miterLimit=2.5,
    )
    sample_notch = Notch(
        id="notch-01",
        segmentId="seg-armscye-01",
        targetArcLengthCm=5.0,
        parameterT=0.4821934,
        position=Point2D(x=4.12, y=2.68),
        normalVector=Point2D(x=0.68, y=-0.733),
        notchType="slit",
        arcLengthResidualCm=2.1e-9,
    )
    sample_num_rec = NumericalVerificationRecord(
        curve_id="seg-armscye-01",
        operation_type="INVERSE_ARC_LENGTH",
        parameter_bracket_t=(0.4821933999995, 0.4821934000001),
        parameter_uncertainty_dt=6.0e-13,
        local_speed_upper_bound_cm_per_t=14.2,
        propagated_position_error_cm=8.52e-12,
        direct_geometric_error_bound_cm=2.1e-9,
        propagation_method="B1_FIRST_ORDER_UPPER_BOUND",
        working_precision_bits=113,
        adaptive_subdivision_panels=16,
        certified_within_tolerance=True,
    )
    sample_val_rec = OffsetValidationRecord(
        segment_id="seg-armscye-01",
        piece_id="bodice-front-01",
        contour_orientation="CCW_EXTERIOR",
        offset_direction_sign_s=-1,
        offset_distance_cm=1.5,
        regularity_margin_epsilon=0.05,
        min_base_speed_squared_interval=(68.249999, 68.250001),
        min_offset_speed_factor_interval=(1.083999, 1.084001),
        has_zero_speed_cusp_on_domain=False,
        has_tangent_reversal_on_domain=False,
        stationary_parameterization_status=StationaryParameterizationStatus.NONE_REGULAR_SPEED,
        base_curve_singularity_classification=BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
        isolated_cusp_roots_t=[],
        isolated_self_intersections=[],
        max_geometric_deviation_bound_cm=0.00118,
        verification_outcome="CERTIFIED_VALID",
        failure_category=OffsetFailureCategory.NONE,
        canonical_offset_classification=CanonicalOffsetClassification.CERTIFIED_VALID,
        active_classifications_on_domain=[CanonicalOffsetClassification.CERTIFIED_VALID],
        working_precision_bits=113,
        is_production_ready=True,
    )
    sample_report = OffsetClassificationReport(
        segmentId="seg-armscye-01",
        canonicalOffsetClassification=CanonicalOffsetClassification.CERTIFIED_VALID,
        activeClassificationsOnDomain=[CanonicalOffsetClassification.CERTIFIED_VALID],
        baseCurveSingularityClassification=BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
        verificationOutcome="CERTIFIED_VALID",
        failureCategory=OffsetFailureCategory.NONE,
        directionSign=-1,
        offsetDistanceCm=1.5,
        minBaseSpeedSquaredQ=68.25,
        minOffsetSpeedFactorF=1.084,
        hasZeroSpeedCuspOnDomain=False,
        hasTangentReversalOnDomain=False,
        gridErrorCm=0.00042,
        certifiedIntervalErrorCm=0.00118,
        maxJoinTangentDeltaDeg=0.004,
        reparameterized=False,
        trimmed=False,
        isolatedRoots=[],
        oracleTierUsed="C1-Cert-113bit-Q",
        isProductionReady=True,
    )
    sample_warning = GeometryWarning(
        warningId="warn-ag06-01",
        code="ADR009_TANGENT_REVERSAL",
        severity="CRITICAL_BLOCKING",
        classification=CanonicalOffsetClassification.TANGENT_REVERSAL,
        pieceId="bodice-front-01",
        segmentId="seg-armscye-01",
        parameterT=0.5,
        message="Signed curvature exceeds 1/(s*d) threshold on inward offset; local loop trimmed.",
        remediationAction="Trim swallowtail loop at self-intersection parameter or reduce seam allowance d.",
    )
    sample_dxf_manifest = DxfExportManifest(
        exportId="dxf-exp-bf-001",
        standard="DXF-AAMA / ASTM D6673",
        dxfVersion="AC1009",
        geometryUnit="cm",
        requiredLayers=["1", "2", "4", "7", "8", "11"],
        recoveredLayers=["1", "2", "4", "7", "8", "11"],
        pieceCodes=["BF-001", "BB-001"],
        totalVertexCount=48,
        maxRoundTripCoordinateErrorCm=0.0,
        sha256Digest="a" * 64,
        syntheticRoundTripVerified=True,
        externalCadInteroperabilityVerified=False,
    )
    sample_body = BodyProfile(
        profileId="ISO-SIZE-M",
        bustCm=92.0,
        waistCm=74.0,
        highHipCm=90.0,
        lowHipCm=98.0,
        waistToHipCm=20.0,
        backWaistLengthCm=41.5,
        frontWaistLengthCm=43.0,
        acrossBackCm=36.5,
        shoulderLengthCm=12.8,
        neckCircumferenceCm=37.0,
        bustSpanCm=18.5,
        bustHeightCm=26.5,
        armholeDepthCm=21.0,
        sleeveLengthCm=59.5,
    )
    sample_garment = GarmentSpec(
        garmentId="garment-bodice-iso-m",
        garmentCategory="bodice_block",
        blockSystem="ISO_INDUSTRIAL_V1",
        bodyProfileId="ISO-SIZE-M",
        coordinateFrame=sample_coord,
        bustEaseCm=4.0,
        waistEaseCm=2.0,
        hipEaseCm=4.0,
        defaultSeamAllowanceCm=1.5,
        hemAllowanceCm=3.0,
        grainlineAngleDeg=0.0,
    )
    sample_piece = PatternPiece(
        pieceId="bodice-front-01",
        pieceCode="BF-001",
        name="Bodice Front Block",
        coordinateFrame=sample_coord,
        sewBoundarySegments=[sample_seg],
        cutBoundarySegments=[sample_seg],
        notches=[sample_notch],
        seamAllowances=[sample_seam],
        offsetReports=[sample_report],
        offsetValidationRecords=[sample_val_rec],
        warnings=[],
    )

    entities_checked: Dict[str, Tuple[Any, Dict[str, Any]]] = {
        "CoordinateFrameSpec": (CoordinateFrameSpec, sample_coord.model_dump(mode="json")),
        "BezierSegment": (BezierSegment, sample_seg.model_dump(mode="json")),
        "SeamAllowance": (SeamAllowance, sample_seam.model_dump(mode="json")),
        "Notch": (Notch, sample_notch.model_dump(mode="json")),
        "NumericalVerificationRecord": (NumericalVerificationRecord, sample_num_rec.model_dump(mode="json")),
        "OffsetValidationRecord": (OffsetValidationRecord, sample_val_rec.model_dump(mode="json")),
        "OffsetClassificationReport": (OffsetClassificationReport, sample_report.model_dump(mode="json")),
        "GeometryWarning": (GeometryWarning, sample_warning.model_dump(mode="json")),
        "DxfExportManifest": (DxfExportManifest, sample_dxf_manifest.model_dump(mode="json")),
        "BodyProfile": (BodyProfile, sample_body.model_dump(mode="json")),
        "GarmentSpec": (GarmentSpec, sample_garment.model_dump(mode="json")),
        "PatternPiece": (PatternPiece, sample_piece.model_dump(mode="json")),
    }

    parity_results: List[Dict[str, Any]] = []
    for def_name, (model_cls, payload) in entities_checked.items():
        sub_schema = {
            "$schema": schema_doc["$schema"],
            "$defs": schema_doc["$defs"],
            "$ref": f"#/$defs/{def_name}",
        }
        jsonschema.validate(instance=payload, schema=sub_schema)
        roundtrip_inst = model_cls.model_validate(payload)
        assert roundtrip_inst.model_dump(mode="json") == payload
        parity_results.append(
            {
                "entity": def_name,
                "jsonSchemaDraft202012Valid": True,
                "pydanticV2RoundTripValid": True,
            }
        )

    # Negative validation tests: verify both JSON Schema and Pydantic v2 reject invalid payloads
    negative_cases: List[Dict[str, Any]] = [
        {
            "caseId": "NEG-01-WRONG-GEOMETRY-UNIT",
            "entity": "CoordinateFrameSpec",
            "model": CoordinateFrameSpec,
            "payload": {**sample_coord.model_dump(mode="json"), "geometryUnit": "mm"},
            "reason": "Must reject non-cm geometryUnit",
        },
        {
            "caseId": "NEG-02-WRONG-EXTERIOR-WINDING",
            "entity": "CoordinateFrameSpec",
            "model": CoordinateFrameSpec,
            "payload": {**sample_coord.model_dump(mode="json"), "exteriorWinding": "CW"},
            "reason": "Must reject CW exteriorWinding (CCW required)",
        },
        {
            "caseId": "NEG-03-EXTRA-UNDECLARED-PROPERTY",
            "entity": "SeamAllowance",
            "model": SeamAllowance,
            "payload": {**sample_seam.model_dump(mode="json"), "undeclaredField": 123},
            "reason": "Must reject additionalProperties",
        },
        {
            "caseId": "NEG-04-OUT-OF-RANGE-SEAM-DISTANCE",
            "entity": "SeamAllowance",
            "model": SeamAllowance,
            "payload": {**sample_seam.model_dump(mode="json"), "distanceCm": -0.5},
            "reason": "Must reject negative seam allowance distanceCm",
        },
        {
            "caseId": "NEG-05-INVALID-NOTCH-RESIDUAL",
            "entity": "Notch",
            "model": Notch,
            "payload": {**sample_notch.model_dump(mode="json"), "arcLengthResidualCm": 1e-3},
            "reason": "Must reject arcLengthResidualCm > 1e-7 cm",
        },
        {
            "caseId": "NEG-06-INVALID-OFFSET-CLASSIFICATION-ENUM",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {
                **sample_val_rec.model_dump(mode="json"),
                "canonical_offset_classification": "NON_CANONICAL_INVENTED_CATEGORY",
            },
            "reason": "Must reject non-canonical offset classification enum value",
        },
        {
            "caseId": "NEG-07-MISSING-REQUIRED-BODY-FIELD",
            "entity": "BodyProfile",
            "model": BodyProfile,
            "payload": {k: v for k, v in sample_body.model_dump(mode="json").items() if k != "bustCm"},
            "reason": "Must reject BodyProfile missing required bustCm",
        },
        {
            "caseId": "NEG-08-INVALID-GARMENT-EASE-RANGE",
            "entity": "GarmentSpec",
            "model": GarmentSpec,
            "payload": {**sample_garment.model_dump(mode="json"), "bustEaseCm": 45.0},
            "reason": "Must reject GarmentSpec with bustEaseCm > 25.0 cm",
        },
        {
            "caseId": "NEG-09-INVALID-DXF-VERSION",
            "entity": "DxfExportManifest",
            "model": DxfExportManifest,
            "payload": {**sample_dxf_manifest.model_dump(mode="json"), "dxfVersion": "AC1027"},
            "reason": "Must reject non-AC1009 DXF-AAMA version",
        },
        {
            "caseId": "NEG-10-INVALID-NUMERICAL-DT-BOUND",
            "entity": "NumericalVerificationRecord",
            "model": NumericalVerificationRecord,
            "payload": {**sample_num_rec.model_dump(mode="json"), "parameter_uncertainty_dt": 1e-6},
            "reason": "Must reject parameter_uncertainty_dt > 1e-12",
        },
    ]

    negative_results: List[Dict[str, Any]] = []
    for neg in negative_cases:
        def_name = neg["entity"]
        model_cls = neg["model"]
        bad_payload = neg["payload"]
        sub_schema = {
            "$schema": schema_doc["$schema"],
            "$defs": schema_doc["$defs"],
            "$ref": f"#/$defs/{def_name}",
        }
        js_rejected = False
        try:
            jsonschema.validate(instance=bad_payload, schema=sub_schema)
        except jsonschema.ValidationError:
            js_rejected = True

        pyd_rejected = False
        try:
            model_cls.model_validate(bad_payload)
        except ValidationError:
            pyd_rejected = True

        negative_results.append(
            {
                "caseId": neg["caseId"],
                "entity": def_name,
                "reason": neg["reason"],
                "jsonSchemaRejected": js_rejected,
                "pydanticV2Rejected": pyd_rejected,
                "bothRejected": js_rejected and pyd_rejected,
            }
        )

    # Semantic invariant negative tests enforced by Pydantic v2 model validators
    semantic_invariant_checks: List[Dict[str, Any]] = []

    def _expect_pydantic_error(case_id: str, description: str, fn: Callable[[], Any]) -> None:
        rejected = False
        err_msg = ""
        try:
            fn()
        except ValidationError as exc:
            rejected = True
            err_msg = str(exc.errors()[0].get("msg", ""))
        semantic_invariant_checks.append(
            {
                "caseId": case_id,
                "description": description,
                "pydanticSemanticValidatorRejected": rejected,
                "errorMessage": err_msg,
            }
        )

    _expect_pydantic_error(
        "SEM-01-INCONCLUSIVE-PRODUCTION-READY-FORBIDDEN",
        "ADR-009 §5.3: verification_outcome=INCONCLUSIVE must reject is_production_ready=True",
        lambda: OffsetValidationRecord.model_validate(
            {
                **sample_val_rec.model_dump(mode="json"),
                "verification_outcome": "INCONCLUSIVE",
                "failure_category": "INCONCLUSIVE",
                "canonical_offset_classification": "INCONCLUSIVE",
                "active_classifications_on_domain": ["INCONCLUSIVE"],
                "is_production_ready": True,
            }
        ),
    )
    _expect_pydantic_error(
        "SEM-02-METHOD-B1-UNDERESTIMATED-GEOMETRIC-ERROR",
        "ADR-009 §2.5: Method B1 propagated_position_error_cm < local_speed_upper_bound * dt must be rejected",
        lambda: NumericalVerificationRecord.model_validate(
            {
                **sample_num_rec.model_dump(mode="json"),
                "parameter_uncertainty_dt": 1e-12,
                "local_speed_upper_bound_cm_per_t": 50.0,
                "propagated_position_error_cm": 1e-13,
            }
        ),
    )
    _expect_pydantic_error(
        "SEM-03-ANATOMICAL-COVARIANCE-LOW-HIP-LT-HIGH-HIP",
        "M00.8: BodyProfile with lowHipCm < highHipCm - 2.0 must be rejected",
        lambda: BodyProfile.model_validate(
            {
                **sample_body.model_dump(mode="json"),
                "highHipCm": 96.0,
                "lowHipCm": 80.0,
            }
        ),
    )

    all_passed = (
        all(r["jsonSchemaDraft202012Valid"] and r["pydanticV2RoundTripValid"] for r in parity_results)
        and all(n["bothRejected"] for n in negative_results)
        and all(s["pydanticSemanticValidatorRejected"] for s in semantic_invariant_checks)
    )

    return {
        "milestoneId": "M00.1",
        "artifactName": "SchemasLockReport.json",
        "schemaPath": "packages/contracts/schemas/canonical_contracts.schema.json",
        "schemaSha256": schema_sha256,
        "draftVersion": "https://json-schema.org/draft/2020-12/schema",
        "canonicalCoordinateFrame": sample_coord.model_dump(mode="json"),
        "canonicalOffsetClassifications": [c.value for c in CanonicalOffsetClassification],
        "baseCurveSingularityClassifications": [c.value for c in BaseCurveSingularityClassification],
        "entitiesVerifiedCount": len(parity_results),
        "entityParityResults": parity_results,
        "negativeValidationCount": len(negative_results),
        "negativeValidationResults": negative_results,
        "semanticInvariantChecks": semantic_invariant_checks,
        "allPassed": all_passed,
    }
