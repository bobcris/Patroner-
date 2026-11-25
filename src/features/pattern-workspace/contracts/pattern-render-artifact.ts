/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * UX-2.3.1 — Read-Only Pattern Artifact Presentation Contract
 *
 * Pure framework-agnostic view-model contract for rendering 2D pattern artifacts
 * in Pattern Atelier without moving computational geometry authority into the browser.
 *
 * Authority boundaries (ADR-001 / ADR-009):
 * - C0_LEGACY_TS_PROTOTYPE: Adapted from legacy client-side TS drafting (`src/engine/*`).
 *   Always non-authoritative (`isProductionReady: false`).
 * - C1_PYTHON_CERTIFIED: Validated projection of a Python `contracts.py` artifact whose
 *   every offset validation record and classification report passed contract checks and
 *   carried `verification_outcome === 'CERTIFIED_VALID'`.
 * - UNVERIFIED_EXTERNAL_ARTIFACT: A Python-shaped payload that failed contract checks,
 *   lacks certification records, or contains invalid/inconclusive verification outcomes.
 *   Never displayed as certified (`isProductionReady: false`).
 * - UNVERIFIED_VISUAL_PROPOSAL: Reserved for future client-side non-authoritative overlays.
 */

export type GeometryAuthorityTier =
  | 'C0_LEGACY_TS_PROTOTYPE'
  | 'C1_PYTHON_CERTIFIED'
  | 'UNVERIFIED_EXTERNAL_ARTIFACT'
  | 'UNVERIFIED_VISUAL_PROPOSAL';

export type CoordinateYAxisDirection = 'cartesian-y-up' | 'svg-y-down';

export interface RenderPoint2D {
  readonly x: number; // cm
  readonly y: number; // cm
}

export interface RenderBoundingBoxCm {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly widthCm: number;
  readonly heightCm: number;
}

export interface RenderCurveSegment {
  readonly id: string;
  readonly kind: 'line' | 'cubic-bezier';
  readonly seamId?: string;
  readonly role: 'stitching' | 'cutting' | 'miter' | 'bevel' | 'fold' | 'bridge';
  readonly p0: RenderPoint2D;
  readonly p1?: RenderPoint2D;
  readonly p2?: RenderPoint2D;
  readonly p3: RenderPoint2D;
  readonly reportedLengthCm?: number;
  readonly isFold?: boolean;
}

export interface RenderNotch {
  readonly id: string;
  readonly segmentId?: string;
  readonly position: RenderPoint2D;
  readonly normalVector: RenderPoint2D;
  readonly notchType: 'slit' | 'v-notch' | 't-notch' | 'single' | 'double' | 'fold';
  readonly label?: string;
  readonly targetArcLengthCm?: number;
  readonly parameterT?: number;
  readonly arcLengthResidualCm?: number;
}

export interface RenderDart {
  readonly id: string;
  readonly apex: RenderPoint2D;
  readonly legLeft: RenderPoint2D;
  readonly legRight: RenderPoint2D;
  readonly widthCm: number;
  readonly lengthCm: number;
}

export interface RenderSeamAllowanceRule {
  readonly segmentId: string;
  readonly distanceCm: number;
  readonly directionSign: -1 | 1;
  readonly joinStyle: 'miter' | 'bevel' | 'round' | 'fold';
  readonly miterLimit: number;
}

export interface RenderPieceSeamSummary {
  readonly id: string;
  readonly name: string;
  readonly lengthCm: number;
  readonly segmentIds: readonly string[];
  readonly pairedPieceId?: string;
  readonly pairedSeamName?: string;
}

export type DiagnosticContourScope = 'sew' | 'cut';

export type DiagnosticCoordinateSpace = 'piece-local' | 'board';

export type DiagnosticOrigin =
  | 'c0-validation'
  | 'c0-offset'
  | 'python-contract'
  | 'python-offset-validation'
  | 'python-offset-report'
  | 'python-warning';

export type DiagnosticParameterInterval = readonly [number, number];

export interface RenderSpatialDiagnostic {
  readonly id: string;
  readonly code: string;
  readonly severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL_BLOCKING';
  readonly pieceId?: string;
  readonly segmentId?: string;
  readonly secondarySegmentIds?: readonly string[];
  readonly contour?: DiagnosticContourScope;
  readonly parameterT?: number;
  readonly parameterIntervals?: readonly DiagnosticParameterInterval[];
  readonly anchorPointCm?: RenderPoint2D;
  readonly anchorCoordinateSpace?: DiagnosticCoordinateSpace;
  readonly message: string;
  readonly remediationAction?: string;
  readonly verificationOutcome?: 'CERTIFIED_VALID' | 'CERTIFIED_INVALID' | 'INCONCLUSIVE';
  readonly canonicalOffsetClassification?: string;
  readonly failureCategory?: string;
  readonly diagnosticOrigin?: DiagnosticOrigin;
  readonly maxGeometricDeviationBoundCm?: number;
  readonly workingPrecisionBits?: number;
  readonly residualDistanceCm?: number;
}

export interface PatternPieceRenderModel {
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly name: string;
  readonly description?: string;
  readonly material: 'self' | 'lining' | 'interfacing';
  readonly cutCount: number;
  readonly onFold: boolean;
  readonly seamAllowanceWidthCm: number;
  readonly boundingBoxCm: RenderBoundingBoxCm;
  readonly sewSegments: readonly RenderCurveSegment[];
  readonly cutSegments: readonly RenderCurveSegment[];
  readonly fallbackSewSvgPath?: string;
  readonly fallbackCutSvgPath?: string;
  readonly seams: readonly RenderPieceSeamSummary[];
  readonly seamAllowances: readonly RenderSeamAllowanceRule[];
  readonly darts: readonly RenderDart[];
  readonly notches: readonly RenderNotch[];
  readonly grainline?: {
    readonly start: RenderPoint2D;
    readonly end: RenderPoint2D;
    readonly direction: 'vertical' | 'horizontal' | 'bias';
  };
  readonly drillHoles?: readonly RenderPoint2D[];
  readonly hasBlockingError: boolean;
}

export interface PatternArtifactCoordinateFrame {
  readonly geometryUnit: 'cm';
  readonly yAxisDirection: CoordinateYAxisDirection;
  readonly handedness: 'right-handed-cartesian' | 'screen-y-down';
  readonly exteriorWinding: 'CCW' | 'CW';
}

export interface PatternArtifactProvenance {
  readonly specificationRevisionId: string;
  readonly measurementRevisionId: string;
  readonly artifactDigestSha256?: string;
  readonly engineVersion: string;
  readonly disclosureLabel: string;
}

export interface PatternArtifactBundle {
  readonly schemaVersion: 'patroner.pattern-render-artifact.v1';
  readonly authorityTier: GeometryAuthorityTier;
  readonly isCertified: boolean;
  readonly isProductionReady: boolean;
  readonly externalCadInteroperabilityVerified: boolean;
  readonly coordinateFrame: PatternArtifactCoordinateFrame;
  readonly provenance: PatternArtifactProvenance;
  readonly pieces: readonly PatternPieceRenderModel[];
  readonly diagnostics: readonly RenderSpatialDiagnostic[];
}

/**
 * TypeScript mirror of the existing Python Pydantic v2 contracts in
 * `services/geometry-engine/patroner_geometry/contracts.py` (M00.1).
 *
 * Used strictly as an input contract for `python-artifact-adapter.ts` without
 * implying a live backend service or network API.
 */
export interface PythonCoordinateFrameSpec {
  readonly geometryUnit: 'cm';
  readonly clearanceUnit: 'mm';
  readonly internalAngleUnit: 'rad';
  readonly displayAngleUnit: 'deg';
  readonly handedness: 'right-handed-cartesian';
  readonly exteriorWinding: 'CCW';
  readonly interiorCutoutWinding: 'CW';
  readonly leftNormalDirectionOnExterior: 'inward';
}

export interface PythonPoint2D {
  readonly x: number;
  readonly y: number;
}

export interface PythonBezierSegment {
  readonly id: string;
  readonly p0: PythonPoint2D;
  readonly p1: PythonPoint2D;
  readonly p2: PythonPoint2D;
  readonly p3: PythonPoint2D;
}

export interface PythonSeamAllowance {
  readonly segmentId: string;
  readonly distanceCm: number;
  readonly directionSign: -1 | 1;
  readonly joinStyle: 'miter' | 'bevel' | 'round' | 'fold';
  readonly miterLimit: number;
}

export interface PythonNotch {
  readonly id: string;
  readonly segmentId: string;
  readonly targetArcLengthCm: number;
  readonly parameterT: number;
  readonly position: PythonPoint2D;
  readonly normalVector: PythonPoint2D;
  readonly notchType: 'slit' | 'v-notch' | 't-notch' | 'double';
  readonly arcLengthResidualCm: number;
}

export interface PythonRootBracketCertificate {
  readonly tLower: number;
  readonly tUpper: number;
  readonly deltaT: number;
  readonly maxSpeedOnBracket: number;
  readonly deltaPosCm: number;
  readonly multiplicityOrOrder: string;
}

export interface PythonSelfIntersectionCertificate {
  readonly scope: 'LOCAL' | 'GLOBAL';
  readonly segmentIdA: string;
  readonly segmentIdB: string;
  readonly t1Bracket: readonly [number, number];
  readonly t2Bracket: readonly [number, number];
  readonly intersectionPointCm: PythonPoint2D;
  readonly residualDistanceCm: number;
}

export interface PythonOffsetValidationRecord {
  readonly segment_id: string;
  readonly piece_id: string;
  readonly contour_orientation: 'CCW_EXTERIOR' | 'CW_CUTOUT';
  readonly coordinate_convention: 'CARTESIAN_RH_CCW';
  readonly offset_direction_sign_s: -1 | 1;
  readonly offset_distance_cm: number;
  readonly regularity_margin_epsilon: number;
  readonly min_base_speed_squared_interval: readonly [number, number];
  readonly min_offset_speed_factor_interval: readonly [number, number];
  readonly has_zero_speed_cusp_on_domain: boolean;
  readonly has_tangent_reversal_on_domain: boolean;
  readonly stationary_parameterization_status: string;
  readonly base_curve_singularity_classification: string;
  readonly isolated_cusp_roots_t?: readonly (readonly [number, number])[];
  readonly isolated_self_intersections?: readonly PythonSelfIntersectionCertificate[];
  readonly max_geometric_deviation_bound_cm: number;
  readonly max_certified_radial_error_cm?: number | null;
  readonly primary_span_coverage_ratio: number;
  readonly local_self_intersection_status: 'NONE' | 'DETECTED' | 'UNRESOLVED' | 'NOT_EVALUATED';
  readonly global_contour_self_intersection_status: 'NONE' | 'DETECTED' | 'UNRESOLVED' | 'NOT_EVALUATED';
  readonly unresolved_intervals: readonly (readonly [number, number])[];
  readonly verification_outcome: 'CERTIFIED_VALID' | 'CERTIFIED_INVALID' | 'INCONCLUSIVE';
  readonly failure_category: string;
  readonly detected_failure_categories?: readonly string[];
  readonly canonical_offset_classification: string;
  readonly active_classifications_on_domain: readonly string[];
  readonly working_precision_bits: number;
  readonly is_production_ready: boolean;
}

export interface PythonOffsetClassificationReport {
  readonly segmentId: string;
  readonly canonicalOffsetClassification: string;
  readonly activeClassificationsOnDomain: readonly string[];
  readonly baseCurveSingularityClassification: string;
  readonly verificationOutcome: 'CERTIFIED_VALID' | 'CERTIFIED_INVALID' | 'INCONCLUSIVE';
  readonly failureCategory: string;
  readonly directionSign: -1 | 1;
  readonly offsetDistanceCm: number;
  readonly minBaseSpeedSquaredQ: number;
  readonly minOffsetSpeedFactorF: number;
  readonly hasZeroSpeedCuspOnDomain: boolean;
  readonly hasTangentReversalOnDomain: boolean;
  readonly gridErrorCm: number;
  readonly certifiedIntervalErrorCm: number;
  readonly maxJoinTangentDeltaDeg: number;
  readonly reparameterized: boolean;
  readonly trimmed: boolean;
  readonly isolatedRoots?: readonly PythonRootBracketCertificate[];
  readonly oracleTierUsed: string;
  readonly isProductionReady: boolean;
}

export interface PythonGeometryWarning {
  readonly warningId: string;
  readonly code: string;
  readonly severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL_BLOCKING';
  readonly classification: string;
  readonly pieceId: string;
  readonly segmentId: string;
  readonly parameterT?: number | null;
  readonly message: string;
  readonly remediationAction: string;
}

export interface PythonPatternPieceContract {
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly name: string;
  readonly coordinateFrame: PythonCoordinateFrameSpec;
  readonly sewBoundarySegments: readonly PythonBezierSegment[];
  readonly cutBoundarySegments: readonly PythonBezierSegment[];
  readonly notches: readonly PythonNotch[];
  readonly seamAllowances: readonly PythonSeamAllowance[];
  readonly offsetReports: readonly PythonOffsetClassificationReport[];
  readonly offsetValidationRecords: readonly PythonOffsetValidationRecord[];
  readonly warnings: readonly PythonGeometryWarning[];
}
