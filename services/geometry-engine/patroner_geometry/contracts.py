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
import math
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
    """ADR-009 §5.3 & §4.2 stationary_parameterization_status enum for OffsetValidationRecord.

    Includes ADR-009 §5.3 `UNRESOLVED` alongside the §4.2 5-way taxonomy states
    (`ENDPOINT_TANGENTIAL_DEGENERACY`, `COLLAPSED_ZERO_LENGTH_CURVE`); documented in
    `SchemasLockReport.json` contract reconciliation notes.
    """

    NONE_REGULAR_SPEED = "NONE_REGULAR_SPEED"
    REMOVABLE_PARAMETERIZATION_DEGENERACY = "REMOVABLE_PARAMETERIZATION_DEGENERACY"
    GENUINE_BASE_GEOMETRIC_SINGULARITY = "GENUINE_BASE_GEOMETRIC_SINGULARITY"
    ENDPOINT_TANGENTIAL_DEGENERACY = "ENDPOINT_TANGENTIAL_DEGENERACY"
    COLLAPSED_ZERO_LENGTH_CURVE = "COLLAPSED_ZERO_LENGTH_CURVE"
    UNRESOLVED = "UNRESOLVED"


class OffsetFailureCategory(str, Enum):
    """ADR-009 §5.3 exact 7-value failure_category enum for OffsetValidationRecord and OffsetClassificationReport."""

    NONE = "NONE"
    REGULARITY_MARGIN_VIOLATION = "REGULARITY_MARGIN_VIOLATION"
    ACTUAL_ZERO_SPEED_CUSP = "ACTUAL_ZERO_SPEED_CUSP"
    TANGENT_REVERSAL = "TANGENT_REVERSAL"
    LOCAL_OFFSET_SELF_INTERSECTION = "LOCAL_OFFSET_SELF_INTERSECTION"
    GLOBAL_CONTOUR_SELF_INTERSECTION = "GLOBAL_CONTOUR_SELF_INTERSECTION"
    INCONCLUSIVE_VERIFICATION = "INCONCLUSIVE_VERIFICATION"


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


class ParameterEnclosureRecord(BaseModel):
    """ADR-009 §2.5 parameter_enclosure sub-record."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    t_lower: float = Field(..., ge=0.0, le=1.0)
    t_upper: float = Field(..., ge=0.0, le=1.0)
    t_mid: float = Field(..., ge=0.0, le=1.0)
    r_param: float = Field(..., ge=0.0)
    residual_interval_lower: Optional[float] = None
    residual_interval_upper: Optional[float] = None

    @model_validator(mode="after")
    def validate_param_enclosure(self) -> "ParameterEnclosureRecord":
        if not (self.t_lower <= self.t_mid <= self.t_upper):
            raise ValueError("parameter_enclosure requires t_lower <= t_mid <= t_upper")
        if self.r_param + 1e-18 < 0.5 * (self.t_upper - self.t_lower):
            raise ValueError("parameter_enclosure r_param must bound half-width (t_upper - t_lower)/2")
        if (
            self.residual_interval_lower is not None
            and self.residual_interval_upper is not None
            and self.residual_interval_upper < self.residual_interval_lower
        ):
            raise ValueError("residual_interval_upper must be >= residual_interval_lower")
        return self


class OutputPropagationRecord(BaseModel):
    """ADR-009 §2.5 output_propagation sub-record."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    propagation_method: Literal[
        "NONE_DIRECT_ENCLOSURE",
        "METHOD_B1_VALIDATED_DERIVATIVE",
        "METHOD_B2_DIRECT_INTERVAL_IMAGE",
    ]
    derivative_upper_bound_m: Optional[float] = Field(None, ge=0.0)
    point_evaluation_rounding_bound_delta_eval: float = Field(0.0, ge=0.0)
    output_enclosure_radius_b_ref_x: float = Field(..., ge=0.0)


class NumericalErrorComponents(BaseModel):
    """ADR-009 §2.5 error_components separating E_obs, B_ref, and B_cert = E_obs + B_ref."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    x_float64: float
    x_ref: float
    observed_discrepancy_e_obs: float = Field(..., ge=0.0)
    reference_enclosure_b_ref: float = Field(..., ge=0.0)
    implementation_to_exact_bound_b_cert: float = Field(..., ge=0.0)
    heuristic_error_estimate: Optional[float] = Field(None, ge=0.0)
    parameter_enclosure: Optional[ParameterEnclosureRecord] = None
    output_propagation: OutputPropagationRecord

    @model_validator(mode="after")
    def validate_error_components(self) -> "NumericalErrorComponents":
        # Triangle inequality: B_cert >= E_obs + B_ref
        if self.implementation_to_exact_bound_b_cert + 1e-15 < (
            self.observed_discrepancy_e_obs + self.reference_enclosure_b_ref
        ):
            raise ValueError(
                "ADR-009 §2.5 violation: implementation_to_exact_bound_b_cert must be >= E_obs + B_ref"
            )
        if self.parameter_enclosure is not None:
            if self.output_propagation.propagation_method == "NONE_DIRECT_ENCLOSURE":
                raise ValueError(
                    "ADR-009 §2.5 violation: non-null parameter_enclosure requires METHOD_B1_VALIDATED_DERIVATIVE "
                    "or METHOD_B2_DIRECT_INTERVAL_IMAGE"
                )
            if abs(self.reference_enclosure_b_ref - self.output_propagation.output_enclosure_radius_b_ref_x) > 1e-15:
                raise ValueError(
                    "ADR-009 §2.5 violation: reference_enclosure_b_ref must equal output_enclosure_radius_b_ref_x"
                )
            if self.output_propagation.propagation_method == "METHOD_B1_VALIDATED_DERIVATIVE":
                if self.output_propagation.derivative_upper_bound_m is None:
                    raise ValueError("METHOD_B1_VALIDATED_DERIVATIVE requires derivative_upper_bound_m")
                min_b_ref_x = (
                    self.output_propagation.derivative_upper_bound_m * self.parameter_enclosure.r_param
                    + self.output_propagation.point_evaluation_rounding_bound_delta_eval
                )
                if self.output_propagation.output_enclosure_radius_b_ref_x + 1e-15 < min_b_ref_x:
                    raise ValueError(
                        "ADR-009 §2.5 Method B1 violation: output_enclosure_radius_b_ref_x must bound M * r_param + delta_eval"
                    )
        return self


class NumericalReproducibilityManifest(BaseModel):
    """ADR-009 §2.5 reproducibility_manifest sub-record."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    python_version: str = Field(..., min_length=1)
    mpmath_version: str = Field(..., min_length=1)
    subdivision_depth_k: int = Field(..., ge=0)
    input_fixture_sha256: str = Field(..., pattern=r"^[a-f0-9]{64}$")


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
    # Full ADR-009 §2.5 canonical fields
    quantity_name: str = Field(..., min_length=1)
    reference_method_and_version: str = Field(..., min_length=1)
    precision_and_arithmetic_model: str = Field(..., min_length=1)
    enclosure_or_remainder_method: str = Field(..., min_length=1)
    assurance_classification: Literal[
        "CERTIFIED_ENCLOSURE",
        "HIGH_PRECISION_NUMERICAL_REFERENCE",
        "CONSERVATIVE_ENGINEERING_ESTIMATE",
    ]
    error_components: NumericalErrorComponents
    acceptance_tolerance_tau: float = Field(..., gt=0.0)
    verification_outcome: Literal["CERTIFIED_VALID", "CERTIFIED_INVALID", "INCONCLUSIVE"]
    reproducibility_manifest: NumericalReproducibilityManifest

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
        if self.verification_outcome == "CERTIFIED_VALID":
            if not self.certified_within_tolerance:
                raise ValueError("CERTIFIED_VALID NumericalVerificationRecord requires certified_within_tolerance=True")
            if self.error_components.implementation_to_exact_bound_b_cert > self.acceptance_tolerance_tau + 1e-15:
                raise ValueError(
                    "ADR-009 §2.5 violation: CERTIFIED_VALID requires B_cert <= acceptance_tolerance_tau"
                )
        else:
            if self.certified_within_tolerance:
                raise ValueError(
                    f"{self.verification_outcome} NumericalVerificationRecord cannot set certified_within_tolerance=True"
                )
        return self


class OffsetValidationRecord(BaseModel):
    """ADR-009 §5.3 Mandatory Offset Validation Record produced by the C1-Cert oracle."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    segment_id: str = Field(..., min_length=1)
    piece_id: str = Field(..., min_length=1)
    contour_orientation: Literal["CCW_EXTERIOR", "CW_CUTOUT"]
    coordinate_convention: Literal["CARTESIAN_RH_CCW"] = "CARTESIAN_RH_CCW"
    offset_direction_sign_s: Literal[-1, 1]
    offset_distance_cm: float = Field(..., ge=0.0)
    regularity_margin_epsilon: float = Field(0.05, ge=0.05, le=0.5)
    min_base_speed_squared_interval: Tuple[float, float]
    min_offset_speed_factor_interval: Tuple[float, float]
    has_zero_speed_cusp_on_domain: bool
    has_tangent_reversal_on_domain: bool
    stationary_parameterization_status: StationaryParameterizationStatus
    base_curve_singularity_classification: BaseCurveSingularityClassification
    isolated_cusp_roots_t: List[Tuple[float, float]] = Field(default_factory=list)
    isolated_self_intersections: List[SelfIntersectionCertificate] = Field(default_factory=list)
    max_geometric_deviation_bound_cm: float = Field(..., ge=0.0)
    max_certified_radial_error_cm: Optional[float] = Field(None, ge=0.0)
    max_subdivision_depth_reached: int = Field(0, ge=0, le=64)
    primary_span_coverage_ratio: float = Field(1.0, ge=0.0, le=1.0)
    local_self_intersection_status: Literal["NONE", "DETECTED", "UNRESOLVED", "NOT_EVALUATED"] = "NONE"
    global_contour_self_intersection_status: Literal["NONE", "DETECTED", "UNRESOLVED", "NOT_EVALUATED"] = "NOT_EVALUATED"
    unresolved_intervals: List[Tuple[float, float]] = Field(default_factory=list)
    escalation_trace: List[str] = Field(default_factory=list)
    verification_outcome: Literal["CERTIFIED_VALID", "CERTIFIED_INVALID", "INCONCLUSIVE"]
    failure_category: OffsetFailureCategory
    detected_failure_categories: List[OffsetFailureCategory] = Field(default_factory=list)
    canonical_offset_classification: CanonicalOffsetClassification
    active_classifications_on_domain: List[CanonicalOffsetClassification] = Field(..., min_length=1)
    working_precision_bits: int = Field(..., ge=53, le=336)
    is_production_ready: bool

    @model_validator(mode="after")
    def validate_adr009_invariants(self) -> "OffsetValidationRecord":
        q_lo, q_hi = self.min_base_speed_squared_interval
        f_lo, f_hi = self.min_offset_speed_factor_interval
        for field_name, val in (
            ("offset_distance_cm", self.offset_distance_cm),
            ("regularity_margin_epsilon", self.regularity_margin_epsilon),
            ("max_geometric_deviation_bound_cm", self.max_geometric_deviation_bound_cm),
            ("primary_span_coverage_ratio", self.primary_span_coverage_ratio),
            ("min_base_speed_squared_interval[0]", q_lo),
            ("min_base_speed_squared_interval[1]", q_hi),
        ):
            if not math.isfinite(val):
                raise ValueError(f"OffsetValidationRecord field '{field_name}' must be finite (got {val!r})")
        if math.isnan(f_lo) or math.isnan(f_hi):
            raise ValueError(
                f"OffsetValidationRecord field 'min_offset_speed_factor_interval' cannot contain NaN "
                f"(got {(f_lo, f_hi)!r})"
            )
        if self.verification_outcome == "CERTIFIED_VALID":
            if not (math.isfinite(f_lo) and math.isfinite(f_hi)):
                raise ValueError(
                    f"CERTIFIED_VALID OffsetValidationRecord requires finite min_offset_speed_factor_interval "
                    f"(got {(f_lo, f_hi)!r})"
                )
        else:
            # CERTIFIED_INVALID (e.g., infinite-curvature zero-speed cusp AG-10b) and INCONCLUSIVE
            # (zero-straddling base speed interval) may carry extended-real lower=-inf / upper=+inf,
            # but never degenerate (+inf, *) lower or (*, -inf) upper endpoints.
            if f_lo == math.inf or f_hi == -math.inf:
                raise ValueError(
                    f"OffsetValidationRecord min_offset_speed_factor_interval cannot have +inf lower or -inf upper "
                    f"endpoint (got {(f_lo, f_hi)!r})"
                )
        if self.max_certified_radial_error_cm is not None and not math.isfinite(self.max_certified_radial_error_cm):
            raise ValueError(
                f"OffsetValidationRecord field 'max_certified_radial_error_cm' must be finite "
                f"(got {self.max_certified_radial_error_cm!r})"
            )
        for idx, (r_lo, r_hi) in enumerate(self.isolated_cusp_roots_t):
            if not (math.isfinite(r_lo) and math.isfinite(r_hi)):
                raise ValueError(f"isolated_cusp_roots_t[{idx}] bounds must be finite (got {(r_lo, r_hi)!r})")
        for idx, (u_lo, u_hi) in enumerate(self.unresolved_intervals):
            if not (math.isfinite(u_lo) and math.isfinite(u_hi)):
                raise ValueError(f"unresolved_intervals[{idx}] bounds must be finite (got {(u_lo, u_hi)!r})")
        if q_lo < 0.0:
            raise ValueError("min_base_speed_squared_interval lower bound must be >= 0")
        if q_hi < q_lo:
            raise ValueError("min_base_speed_squared_interval upper bound < lower bound")
        if f_hi < f_lo:
            raise ValueError("min_offset_speed_factor_interval upper bound < lower bound")

        # Complete ADR-009 §5.3 & K-06 contradictory certification-state enforcement
        # (100% parity with JSON Schema Draft 2020-12 on all 16 discrete/enum/structural states;
        # the 3 cross-field numeric inequalities q_hi >= q_lo, f_hi >= f_lo, and
        # CERTIFIED_VALID => f_lo >= regularity_margin_epsilon exceed Draft 2020-12 native
        # expressiveness and are enforced at runtime by Pydantic v2 and packages/contracts/src/cross-field-validators.ts):
        if self.verification_outcome == "CERTIFIED_VALID":
            if self.failure_category != OffsetFailureCategory.NONE:
                raise ValueError("CERTIFIED_VALID record must have failure_category == NONE")
            if self.canonical_offset_classification != CanonicalOffsetClassification.CERTIFIED_VALID:
                raise ValueError(
                    "CERTIFIED_VALID record must have canonical_offset_classification == CERTIFIED_VALID"
                )
            if self.active_classifications_on_domain != [CanonicalOffsetClassification.CERTIFIED_VALID]:
                raise ValueError(
                    "CERTIFIED_VALID record must have active_classifications_on_domain == ['CERTIFIED_VALID']"
                )
            if any(fc != OffsetFailureCategory.NONE for fc in self.detected_failure_categories):
                raise ValueError("CERTIFIED_VALID record cannot contain non-NONE detected_failure_categories")
            if self.unresolved_intervals:
                raise ValueError("CERTIFIED_VALID record cannot contain unresolved_intervals")
            if self.primary_span_coverage_ratio != 1.0:
                raise ValueError(
                    f"CERTIFIED_VALID record requires complete [0, 1] span coverage "
                    f"(primary_span_coverage_ratio == 1.0, got {self.primary_span_coverage_ratio})"
                )
            if self.stationary_parameterization_status not in (
                StationaryParameterizationStatus.NONE_REGULAR_SPEED,
                StationaryParameterizationStatus.REMOVABLE_PARAMETERIZATION_DEGENERACY,
                StationaryParameterizationStatus.ENDPOINT_TANGENTIAL_DEGENERACY,
            ):
                raise ValueError(
                    f"CERTIFIED_VALID record cannot have stationary_parameterization_status="
                    f"{self.stationary_parameterization_status.value}"
                )
            if self.base_curve_singularity_classification not in (
                BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
                BaseCurveSingularityClassification.REMOVABLE_PARAMETERIZATION_DEGENERACY,
                BaseCurveSingularityClassification.ENDPOINT_TANGENTIAL_DEGENERACY,
            ):
                raise ValueError(
                    f"CERTIFIED_VALID record cannot have base_curve_singularity_classification="
                    f"{self.base_curve_singularity_classification.value}"
                )
            if self.isolated_cusp_roots_t:
                raise ValueError("CERTIFIED_VALID record cannot contain isolated_cusp_roots_t")
            if self.isolated_self_intersections:
                raise ValueError("CERTIFIED_VALID record cannot contain isolated_self_intersections")
            if self.has_zero_speed_cusp_on_domain:
                raise ValueError("CERTIFIED_VALID record cannot have has_zero_speed_cusp_on_domain=True")
            if self.has_tangent_reversal_on_domain:
                raise ValueError("CERTIFIED_VALID record cannot have has_tangent_reversal_on_domain=True")
            if f_lo < self.regularity_margin_epsilon - 1e-15:
                raise ValueError(
                    f"CERTIFIED_VALID record requires min_offset_speed_factor_interval[0] ({f_lo}) "
                    f">= regularity_margin_epsilon ({self.regularity_margin_epsilon})"
                )
            if self.local_self_intersection_status != "NONE":
                raise ValueError(
                    f"CERTIFIED_VALID record requires local_self_intersection_status == 'NONE' "
                    f"(got {self.local_self_intersection_status!r})"
                )
            if self.global_contour_self_intersection_status in ("DETECTED", "UNRESOLVED"):
                raise ValueError("CERTIFIED_VALID record cannot have global self-intersection DETECTED/UNRESOLVED")

        elif self.verification_outcome == "CERTIFIED_INVALID":
            if self.failure_category in (
                OffsetFailureCategory.NONE,
                OffsetFailureCategory.INCONCLUSIVE_VERIFICATION,
            ):
                raise ValueError(
                    "CERTIFIED_INVALID record must specify a concrete failure_category "
                    "(not NONE or INCONCLUSIVE_VERIFICATION)"
                )
            if self.canonical_offset_classification in (
                CanonicalOffsetClassification.CERTIFIED_VALID,
                CanonicalOffsetClassification.INCONCLUSIVE,
            ):
                raise ValueError(
                    "CERTIFIED_INVALID record cannot have canonical_offset_classification CERTIFIED_VALID or INCONCLUSIVE"
                )
            if self.is_production_ready:
                raise ValueError("CERTIFIED_INVALID verification outcome cannot set is_production_ready=True")

        elif self.verification_outcome == "INCONCLUSIVE":
            if self.failure_category != OffsetFailureCategory.INCONCLUSIVE_VERIFICATION:
                raise ValueError("INCONCLUSIVE record must have failure_category == INCONCLUSIVE_VERIFICATION")
            if self.canonical_offset_classification != CanonicalOffsetClassification.INCONCLUSIVE:
                raise ValueError("INCONCLUSIVE record must have canonical_offset_classification == INCONCLUSIVE")
            if self.active_classifications_on_domain != [CanonicalOffsetClassification.INCONCLUSIVE]:
                raise ValueError(
                    "INCONCLUSIVE record must have active_classifications_on_domain == ['INCONCLUSIVE']"
                )
            if self.is_production_ready:
                raise ValueError("INCONCLUSIVE verification outcome cannot set is_production_ready=True")

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

    @model_validator(mode="after")
    def validate_adr009_classification_invariants(self) -> "OffsetClassificationReport":
        for field_name, val in (
            ("offsetDistanceCm", self.offsetDistanceCm),
            ("minBaseSpeedSquaredQ", self.minBaseSpeedSquaredQ),
            ("minOffsetSpeedFactorF", self.minOffsetSpeedFactorF),
            ("gridErrorCm", self.gridErrorCm),
            ("certifiedIntervalErrorCm", self.certifiedIntervalErrorCm),
            ("maxJoinTangentDeltaDeg", self.maxJoinTangentDeltaDeg),
        ):
            if not math.isfinite(val):
                raise ValueError(f"OffsetClassificationReport field '{field_name}' must be finite (got {val!r})")
        if self.gridErrorCm > self.certifiedIntervalErrorCm + 1e-15:
            raise ValueError(
                "OffsetClassificationReport violation: gridErrorCm cannot exceed certifiedIntervalErrorCm"
            )
        if self.verificationOutcome == "CERTIFIED_VALID":
            if self.failureCategory != OffsetFailureCategory.NONE:
                raise ValueError("CERTIFIED_VALID OffsetClassificationReport must have failureCategory == NONE")
            if self.canonicalOffsetClassification != CanonicalOffsetClassification.CERTIFIED_VALID:
                raise ValueError(
                    "CERTIFIED_VALID OffsetClassificationReport must have canonicalOffsetClassification == CERTIFIED_VALID"
                )
            if self.activeClassificationsOnDomain != [CanonicalOffsetClassification.CERTIFIED_VALID]:
                raise ValueError(
                    "CERTIFIED_VALID OffsetClassificationReport must have activeClassificationsOnDomain == ['CERTIFIED_VALID']"
                )
            if self.baseCurveSingularityClassification not in (
                BaseCurveSingularityClassification.REGULAR_BASE_CURVE,
                BaseCurveSingularityClassification.REMOVABLE_PARAMETERIZATION_DEGENERACY,
                BaseCurveSingularityClassification.ENDPOINT_TANGENTIAL_DEGENERACY,
            ):
                raise ValueError(
                    f"CERTIFIED_VALID OffsetClassificationReport cannot have baseCurveSingularityClassification="
                    f"{self.baseCurveSingularityClassification.value}"
                )
            if self.hasZeroSpeedCuspOnDomain:
                raise ValueError("CERTIFIED_VALID OffsetClassificationReport cannot have hasZeroSpeedCuspOnDomain=True")
            if self.hasTangentReversalOnDomain:
                raise ValueError(
                    "CERTIFIED_VALID OffsetClassificationReport cannot have hasTangentReversalOnDomain=True"
                )
            if self.minOffsetSpeedFactorF < 0.05 - 1e-15:
                raise ValueError(
                    "CERTIFIED_VALID OffsetClassificationReport requires minOffsetSpeedFactorF >= 0.05"
                )
            if self.isolatedRoots:
                raise ValueError("CERTIFIED_VALID OffsetClassificationReport cannot contain isolatedRoots")
        elif self.verificationOutcome == "CERTIFIED_INVALID":
            if self.failureCategory in (
                OffsetFailureCategory.NONE,
                OffsetFailureCategory.INCONCLUSIVE_VERIFICATION,
            ):
                raise ValueError(
                    "CERTIFIED_INVALID OffsetClassificationReport must specify a concrete failureCategory"
                )
            if self.canonicalOffsetClassification in (
                CanonicalOffsetClassification.CERTIFIED_VALID,
                CanonicalOffsetClassification.INCONCLUSIVE,
            ):
                raise ValueError(
                    "CERTIFIED_INVALID OffsetClassificationReport cannot have CERTIFIED_VALID or INCONCLUSIVE classification"
                )
            if self.isProductionReady:
                raise ValueError("CERTIFIED_INVALID OffsetClassificationReport cannot set isProductionReady=True")
        elif self.verificationOutcome == "INCONCLUSIVE":
            if self.failureCategory != OffsetFailureCategory.INCONCLUSIVE_VERIFICATION:
                raise ValueError(
                    "INCONCLUSIVE OffsetClassificationReport must have failureCategory == INCONCLUSIVE_VERIFICATION"
                )
            if self.canonicalOffsetClassification != CanonicalOffsetClassification.INCONCLUSIVE:
                raise ValueError(
                    "INCONCLUSIVE OffsetClassificationReport must have canonicalOffsetClassification == INCONCLUSIVE"
                )
            if self.activeClassificationsOnDomain != [CanonicalOffsetClassification.INCONCLUSIVE]:
                raise ValueError(
                    "INCONCLUSIVE OffsetClassificationReport must have activeClassificationsOnDomain == ['INCONCLUSIVE']"
                )
            if self.isProductionReady:
                raise ValueError("INCONCLUSIVE OffsetClassificationReport cannot set isProductionReady=True")
        return self


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
        propagated_position_error_cm=8.7e-12,
        direct_geometric_error_bound_cm=2.1e-9,
        propagation_method="B1_FIRST_ORDER_UPPER_BOUND",
        working_precision_bits=113,
        adaptive_subdivision_panels=16,
        certified_within_tolerance=True,
        quantity_name="inverse_arc_length_notch_position_cm",
        reference_method_and_version="C1-Cert Method B1 + Method C1-Cert v2.1.2-R1",
        precision_and_arithmetic_model="IEEE-754 binary128 (113-bit mpmath.iv) + exact Fraction",
        enclosure_or_remainder_method="METHOD_B1_VALIDATED_DERIVATIVE",
        assurance_classification="CERTIFIED_ENCLOSURE",
        error_components=NumericalErrorComponents(
            x_float64=4.12,
            x_ref=4.12,
            observed_discrepancy_e_obs=2.1e-9,
            reference_enclosure_b_ref=8.7e-12,
            implementation_to_exact_bound_b_cert=2.1087e-9,
            heuristic_error_estimate=None,
            parameter_enclosure=ParameterEnclosureRecord(
                t_lower=0.4821933999995,
                t_upper=0.4821934000001,
                t_mid=0.4821933999998,
                r_param=3.1e-13,
                residual_interval_lower=-1.0e-12,
                residual_interval_upper=1.0e-12,
            ),
            output_propagation=OutputPropagationRecord(
                propagation_method="METHOD_B1_VALIDATED_DERIVATIVE",
                derivative_upper_bound_m=14.2,
                point_evaluation_rounding_bound_delta_eval=4.26e-12,
                output_enclosure_radius_b_ref_x=8.7e-12,
            ),
        ),
        acceptance_tolerance_tau=1.0e-6,
        verification_outcome="CERTIFIED_VALID",
        reproducibility_manifest=NumericalReproducibilityManifest(
            python_version="3.12.16",
            mpmath_version="1.4.1",
            subdivision_depth_k=8,
            input_fixture_sha256="a" * 64,
        ),
    )
    sample_val_rec = OffsetValidationRecord(
        segment_id="seg-armscye-01",
        piece_id="bodice-front-01",
        contour_orientation="CCW_EXTERIOR",
        coordinate_convention="CARTESIAN_RH_CCW",
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
        max_certified_radial_error_cm=0.00118,
        max_subdivision_depth_reached=4,
        primary_span_coverage_ratio=1.0,
        local_self_intersection_status="NONE",
        global_contour_self_intersection_status="NONE",
        unresolved_intervals=[],
        escalation_trace=["113-bit Bernstein hull certified regular"],
        verification_outcome="CERTIFIED_VALID",
        failure_category=OffsetFailureCategory.NONE,
        detected_failure_categories=[],
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

    def _run_dual_negative(cases: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for neg in cases:
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

            out.append(
                {
                    "caseId": neg["caseId"],
                    "entity": def_name,
                    "reason": neg["reason"],
                    "jsonSchemaRejected": js_rejected,
                    "pydanticV2Rejected": pyd_rejected,
                    "bothRejected": js_rejected and pyd_rejected,
                }
            )
        return out

    negative_results = _run_dual_negative(negative_cases)

    # All 8 contradictory certification states enforced identically in BOTH JSON Schema Draft 2020-12 and Pydantic v2
    val_base = sample_val_rec.model_dump(mode="json")
    contradictory_cases: List[Dict[str, Any]] = [
        {
            "caseId": "CONTRA-01-VALID-WITH-NON-NONE-FAILURE",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "failure_category": "TANGENT_REVERSAL"},
            "reason": "CERTIFIED_VALID with non-NONE failure_category must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-02-VALID-WITH-ZERO-SPEED-CUSP",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "has_zero_speed_cusp_on_domain": True},
            "reason": "CERTIFIED_VALID with has_zero_speed_cusp_on_domain=True must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-03-VALID-WITH-TANGENT-REVERSAL",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "has_tangent_reversal_on_domain": True},
            "reason": "CERTIFIED_VALID with has_tangent_reversal_on_domain=True must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-04-VALID-WITH-SPEED-FACTOR-BELOW-EPS",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "min_offset_speed_factor_interval": [0.01, 0.02]},
            "reason": "CERTIFIED_VALID with min_offset_speed_factor_interval below epsilon must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-05-INVALID-WITH-NONE-FAILURE",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {
                **val_base,
                "verification_outcome": "CERTIFIED_INVALID",
                "failure_category": "NONE",
                "canonical_offset_classification": "TANGENT_REVERSAL",
                "active_classifications_on_domain": ["TANGENT_REVERSAL"],
                "is_production_ready": False,
            },
            "reason": "CERTIFIED_INVALID with failure_category=NONE must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-06-INVALID-WITH-PRODUCTION-READY-TRUE",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {
                **val_base,
                "verification_outcome": "CERTIFIED_INVALID",
                "failure_category": "TANGENT_REVERSAL",
                "canonical_offset_classification": "TANGENT_REVERSAL",
                "active_classifications_on_domain": ["TANGENT_REVERSAL"],
                "is_production_ready": True,
            },
            "reason": "CERTIFIED_INVALID with is_production_ready=True must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-07-INCONCLUSIVE-WITH-NON-INCONCLUSIVE-FAILURE",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {
                **val_base,
                "verification_outcome": "INCONCLUSIVE",
                "failure_category": "NONE",
                "canonical_offset_classification": "INCONCLUSIVE",
                "active_classifications_on_domain": ["INCONCLUSIVE"],
                "is_production_ready": False,
            },
            "reason": "INCONCLUSIVE with failure_category!=INCONCLUSIVE_VERIFICATION must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-08-INCONCLUSIVE-WITH-PRODUCTION-READY-TRUE",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {
                **val_base,
                "verification_outcome": "INCONCLUSIVE",
                "failure_category": "INCONCLUSIVE_VERIFICATION",
                "canonical_offset_classification": "INCONCLUSIVE",
                "active_classifications_on_domain": ["INCONCLUSIVE"],
                "is_production_ready": True,
            },
            "reason": "INCONCLUSIVE with is_production_ready=True must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-09-VALID-WITH-PARTIAL-SPAN-COVERAGE-ZERO",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "primary_span_coverage_ratio": 0.0},
            "reason": "K-06: CERTIFIED_VALID with primary_span_coverage_ratio < 1.0 (0.0) must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-10-VALID-WITH-PARTIAL-SPAN-COVERAGE-SUBUNIT",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "primary_span_coverage_ratio": 0.9},
            "reason": "K-06: CERTIFIED_VALID with primary_span_coverage_ratio < 1.0 (0.9) must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-11-VALID-WITH-UNRESOLVED-STATIONARY-STATUS",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "stationary_parameterization_status": "UNRESOLVED"},
            "reason": "K-06: CERTIFIED_VALID with stationary_parameterization_status=UNRESOLVED must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-12-VALID-WITH-GENUINE-BASE-SINGULARITY",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {
                **val_base,
                "stationary_parameterization_status": "GENUINE_BASE_GEOMETRIC_SINGULARITY",
                "base_curve_singularity_classification": "GENUINE_ZERO_SPEED_GEOMETRIC_CUSP_OR_FOLD",
            },
            "reason": "K-06: CERTIFIED_VALID with genuine base geometric singularity must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-13-VALID-WITH-ISOLATED-CUSP-ROOTS",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "isolated_cusp_roots_t": [[0.49, 0.51]]},
            "reason": "K-06: CERTIFIED_VALID with non-empty isolated_cusp_roots_t must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-14-VALID-WITH-ISOLATED-SELF-INTERSECTIONS",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {
                **val_base,
                "isolated_self_intersections": [
                    {
                        "scope": "LOCAL",
                        "segmentIdA": "seg-1",
                        "segmentIdB": "seg-1",
                        "t1Bracket": [0.1, 0.11],
                        "t2Bracket": [0.89, 0.9],
                        "intersectionPointCm": {"x": 1.0, "y": 2.0},
                        "residualDistanceCm": 0.0,
                    }
                ],
            },
            "reason": "K-06: CERTIFIED_VALID with non-empty isolated_self_intersections must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-15-VALID-WITH-LOCAL-SI-NOT-EVALUATED",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "local_self_intersection_status": "NOT_EVALUATED"},
            "reason": "K-06/K-01: CERTIFIED_VALID with local_self_intersection_status=NOT_EVALUATED must be rejected by both validators",
        },
        {
            "caseId": "CONTRA-16-VALID-WITH-UNRESOLVED-INTERVALS",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "payload": {**val_base, "unresolved_intervals": [[0.45, 0.55]]},
            "reason": "K-06: CERTIFIED_VALID with non-empty unresolved_intervals must be rejected by both validators",
        },
    ]
    contradictory_results = _run_dual_negative(contradictory_cases)

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
                **val_base,
                "verification_outcome": "INCONCLUSIVE",
                "failure_category": "INCONCLUSIVE_VERIFICATION",
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
    _expect_pydantic_error(
        "SEM-04-CLASSIFICATION-REPORT-INCONCLUSIVE-PRODUCTION-READY-FORBIDDEN",
        "ADR-009 §5.3: OffsetClassificationReport with verificationOutcome=INCONCLUSIVE must reject isProductionReady=True",
        lambda: OffsetClassificationReport.model_validate(
            {
                **sample_report.model_dump(mode="json"),
                "verificationOutcome": "INCONCLUSIVE",
                "failureCategory": "INCONCLUSIVE_VERIFICATION",
                "canonicalOffsetClassification": "INCONCLUSIVE",
                "activeClassificationsOnDomain": ["INCONCLUSIVE"],
                "isProductionReady": True,
            }
        ),
    )
    _expect_pydantic_error(
        "SEM-05-CLASSIFICATION-REPORT-GRID-EXCEEDS-CERTIFIED-ERROR",
        "ADR-009 §5.3: OffsetClassificationReport must reject gridErrorCm > certifiedIntervalErrorCm",
        lambda: OffsetClassificationReport.model_validate(
            {
                **sample_report.model_dump(mode="json"),
                "gridErrorCm": 0.005,
                "certifiedIntervalErrorCm": 0.001,
            }
        ),
    )
    _expect_pydantic_error(
        "SEM-06-NUMERICAL-RECORD-PARAM-ENCLOSURE-WITHOUT-PROPAGATION",
        "ADR-009 §2.5: non-null parameter_enclosure with NONE_DIRECT_ENCLOSURE must be rejected",
        lambda: NumericalVerificationRecord.model_validate(
            {
                **sample_num_rec.model_dump(mode="json"),
                "error_components": {
                    **sample_num_rec.error_components.model_dump(mode="json"),
                    "output_propagation": {
                        "propagation_method": "NONE_DIRECT_ENCLOSURE",
                        "derivative_upper_bound_m": None,
                        "point_evaluation_rounding_bound_delta_eval": 0.0,
                        "output_enclosure_radius_b_ref_x": 8.52e-12,
                    },
                },
            }
        ),
    )

    # L-03: Explicit cross-field numeric inequalities enforced by Pydantic v2 (Python) and
    # packages/contracts/src/cross-field-validators.ts (TypeScript) that exceed JSON Schema Draft 2020-12
    # native expressiveness (Draft 2020-12 has no dynamic cross-property numeric comparison keywords).
    report_base = sample_report.model_dump(mode="json")
    cross_field_cases: List[Dict[str, Any]] = [
        {
            "caseId": "CF-01-SPEED-FACTOR-LOWER-BELOW-DYNAMIC-EPSILON",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "invariant": "verification_outcome == 'CERTIFIED_VALID' => min_offset_speed_factor_interval[0] >= regularity_margin_epsilon",
            "payload": {
                **val_base,
                "regularity_margin_epsilon": 0.25,
                "min_offset_speed_factor_interval": [0.18, 0.30],
            },
            "reason": "L-03: Dynamic comparison f_lo (0.18) < regularity_margin_epsilon (0.25) when CERTIFIED_VALID exceeds Draft 2020-12 static floors",
        },
        {
            "caseId": "CF-02-BASE-SPEED-SQUARED-INTERVAL-INVERTED",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "invariant": "min_base_speed_squared_interval[1] >= min_base_speed_squared_interval[0]",
            "payload": {
                **val_base,
                "min_base_speed_squared_interval": [5.0, 2.0],
            },
            "reason": "L-03: Cross-element numeric order q_hi (2.0) < q_lo (5.0) is not natively expressible in Draft 2020-12",
        },
        {
            "caseId": "CF-03-OFFSET-SPEED-FACTOR-INTERVAL-INVERTED",
            "entity": "OffsetValidationRecord",
            "model": OffsetValidationRecord,
            "invariant": "min_offset_speed_factor_interval[1] >= min_offset_speed_factor_interval[0]",
            "payload": {
                **val_base,
                "min_offset_speed_factor_interval": [0.90, 0.50],
            },
            "reason": "L-03: Cross-element numeric order f_hi (0.50) < f_lo (0.90) is not natively expressible in Draft 2020-12",
        },
        {
            "caseId": "CF-04-CLASSIFICATION-REPORT-GRID-EXCEEDS-CERTIFIED-ERROR",
            "entity": "OffsetClassificationReport",
            "model": OffsetClassificationReport,
            "invariant": "gridErrorCm <= certifiedIntervalErrorCm",
            "payload": {
                **report_base,
                "gridErrorCm": 0.005,
                "certifiedIntervalErrorCm": 0.001,
            },
            "reason": "L-03: Cross-field numeric bound gridErrorCm (0.005) > certifiedIntervalErrorCm (0.001) is not natively expressible in Draft 2020-12",
        },
    ]

    cross_field_results: List[Dict[str, Any]] = []
    for cf in cross_field_cases:
        def_name = cf["entity"]
        model_cls = cf["model"]
        bad_payload = cf["payload"]
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
        pyd_err = ""
        try:
            model_cls.model_validate(bad_payload)
        except ValidationError as exc:
            pyd_rejected = True
            pyd_err = str(exc.errors()[0].get("msg", ""))

        cross_field_results.append(
            {
                "caseId": cf["caseId"],
                "entity": def_name,
                "invariant": cf["invariant"],
                "reason": cf["reason"],
                "pydanticV2Rejected": pyd_rejected,
                "pydanticErrorMessage": pyd_err,
                "jsonSchemaDraft202012Rejected": js_rejected,
                "jsonSchemaDraft202012NativeExpressible": False,
                "requiresRuntimeCrossFieldValidator": True,
                "nonPythonRuntimeValidator": "packages/contracts/src/cross-field-validators.ts",
            }
        )

    all_passed = (
        all(r["jsonSchemaDraft202012Valid"] and r["pydanticV2RoundTripValid"] for r in parity_results)
        and all(n["bothRejected"] for n in negative_results)
        and all(c["bothRejected"] for c in contradictory_results)
        and all(s["pydanticSemanticValidatorRejected"] for s in semantic_invariant_checks)
        and all(cf["pydanticV2Rejected"] for cf in cross_field_results)
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
        "stationaryParameterizationStatuses": [c.value for c in StationaryParameterizationStatus],
        "offsetFailureCategories": [c.value for c in OffsetFailureCategory],
        "adr009EnumReconciliationNote": (
            "StationaryParameterizationStatus includes ADR-009 §5.3 UNRESOLVED alongside the §4.2 5-way taxonomy states "
            "(ENDPOINT_TANGENTIAL_DEGENERACY, COLLAPSED_ZERO_LENGTH_CURVE) in both Pydantic v2 and JSON Schema Draft 2020-12."
        ),
        "schemaExpressivenessBoundary": {
            "findingId": "L-03",
            "jsonSchemaAcceptanceAloneIsCompleteCertification": False,
            "discreteAndStructuralParity": "100% parity between Pydantic v2 and JSON Schema Draft 2020-12 on all 16 discrete/enum/structural contradictory certification states and 10 structural negative cases.",
            "crossFieldNumericInequalitiesBeyondDraft202012": [
                "OffsetValidationRecord: verification_outcome == 'CERTIFIED_VALID' => min_offset_speed_factor_interval[0] >= regularity_margin_epsilon",
                "OffsetValidationRecord: min_base_speed_squared_interval[1] >= min_base_speed_squared_interval[0]",
                "OffsetValidationRecord: min_offset_speed_factor_interval[1] >= min_offset_speed_factor_interval[0]",
                "OffsetClassificationReport: gridErrorCm <= certifiedIntervalErrorCm",
            ],
            "authoritativeRuntimeValidators": {
                "python": "services/geometry-engine/patroner_geometry/contracts.py (Pydantic v2 model_validator)",
                "typescript": "packages/contracts/src/cross-field-validators.ts",
            },
        },
        "entitiesVerifiedCount": len(parity_results),
        "entityParityResults": parity_results,
        "negativeValidationCount": len(negative_results),
        "negativeValidationResults": negative_results,
        "contradictoryCertificationStateCount": len(contradictory_results),
        "contradictoryCertificationStateResults": contradictory_results,
        "semanticInvariantChecks": semantic_invariant_checks,
        "crossFieldNumericInequalityCount": len(cross_field_results),
        "crossFieldNumericInequalityChecks": cross_field_results,
        "allPassed": all_passed,
    }
