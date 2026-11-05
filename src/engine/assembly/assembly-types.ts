/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BoundingBox,
  DesignSpecification,
  BodyMeasurements,
  FabricProperty,
  GrainLine,
  Notch,
  PatternPiece,
  Point,
  SeamLine,
  SleeveEaseStrategy,
  ValidationReport
} from '../../types';

export type AssemblyValidationStatus =
  | 'verified-valid'
  | 'invalid'
  | 'unassessed-missing-data';

export interface AssemblyOptions {
  strategy?: SleeveEaseStrategy;
  customTargetEaseCm?: number;
  bezierToleranceCm?: number;
  fabric?: FabricProperty;
  seamAllowanceCm?: number;
}

export interface BodiceSleeveAssemblyInput {
  bodicePieces: PatternPiece[];
  sleevePiece?: PatternPiece;
  designSpec: DesignSpecification;
  measurements: BodyMeasurements;
  options?: AssemblyOptions;
}

export interface SeamArcLengthMeasurement {
  pieceId: string;
  pieceCode: string;
  seamId: string;
  segmentId: string;
  lengthCm: number;
  lowerBoundCm: number;
  upperBoundCm: number;
  uncertaintyCm: number;
  toleranceAchieved: boolean;
  subdivisions: number;
}

export interface EaseCompatibilityMetrics {
  frontBodiceArmholeLengthCm: number;
  backBodiceArmholeLengthCm: number;
  totalBodiceArmholeLengthCm: number;
  frontSleeveCapLengthCm: number;
  backSleeveCapLengthCm: number;
  totalSleeveCapLengthCm: number;
  frontEaseCm: number;
  backEaseCm: number;
  totalEaseCm: number;
  frontEaseUncertaintyCm: number;
  backEaseUncertaintyCm: number;
  totalEaseUncertaintyCm: number;
  frontEaseRatio: number | null; // Front ease as fraction of total ease [0.0 - 1.0], null if total ease < 0.20 cm or invalid
  isRatioDefined: boolean; // True only when totalEaseCm >= 0.20 cm and frontEaseCm >= 0 and backEaseCm >= 0
  frontEaseRatioUncertainty: number | null; // delta R_f = (|E_b| delta E_f + |E_f| delta E_b) / E_t^2
  targetStrategy: SleeveEaseStrategy;
  targetTotalEaseCm: number;
  targetFrontEaseCm: number;
  targetBackEaseCm: number;
  recommendedEnvelopeCm: { min: number; max: number };
  customEnvelopeCm?: { min: number; max: number };
  frontResidualCm: number;
  backResidualCm: number;
  totalResidualCm: number;
  isFrontEasePermitted: boolean; // E_f >= 0
  isBackEasePermitted: boolean;  // E_b >= 0
  isTotalEasePermitted: boolean;  // 0 <= E_t <= 5.0 cm (tailoring crimp capacity envelope)
  isDistributionBalanced: boolean; // 35% <= frontRatio <= 55% (or |E_f - E_b| <= 0.20 cm when E_t < 0.20 cm)
  isTotalEaseTargetCompliant: boolean;
  isTargetCompliant: boolean;
}

export interface SeamEndpointMatch {
  name: string;
  bodicePieceId: string;
  bodicePoint: Point;
  sleevePoint: Point;
  distanceCm: number;
  isConnected: boolean;
  expectedDirection: string;
  actualDirection: string;
  isOrientationValid: boolean;
  isPositionalCoincident?: boolean;
  isTangentContinuous?: boolean;
  tangentDepartureDeg?: number;
}

export interface SeamEndpointOrientationResult {
  frontUnderarmMatch: SeamEndpointMatch;
  backUnderarmMatch: SeamEndpointMatch;
  crownShoulderMatch: SeamEndpointMatch;
  underarmInseamMatch: {
    frontInseamLengthCm: number;
    backInseamLengthCm: number;
    parityDeltaCm: number;
    hasParity: boolean;
  };
  isEndpointTopologyValid: boolean;
  reasons: string[];
}

export interface FrontNotchPairing {
  sleeveNotchId: string;
  bodiceNotchId: string;
  sleeveNotchPosition: Point;
  bodiceNotchPosition: Point;
  sleeveArcFromUnderarmCm: number;
  bodiceArcFromUnderarmCm: number;
  deltaCm: number;
  isWithinTolerance: boolean;
  sleeveDisplacementCm: number;
  bodiceDisplacementCm: number;
  isAttachedToContour: boolean;
  orientationAngleDeg: number;
  isOrientationValid: boolean;
}

export interface BackNotchPairing {
  sleeveNotch1Id: string;
  sleeveNotch2Id: string;
  bodiceNotch1Id: string;
  bodiceNotch2Id: string;
  sleeveNotch1ArcCm: number;
  sleeveNotch2ArcCm: number;
  bodiceNotch1ArcCm: number;
  bodiceNotch2ArcCm: number;
  deltaNotch1Cm: number;
  deltaNotch2Cm: number;
  isPair1WithinTolerance: boolean;
  isPair2WithinTolerance: boolean;
  sleeveSpacingCm: number;
  bodiceSpacingCm: number;
  isSpacingValid: boolean; // 1.2 cm +/- 0.3 cm [0.90 - 1.50 cm]
  isOrderingValid: boolean; // Notch 1 closer to underarm than notch 2
  sleeveDisplacement1Cm: number;
  sleeveDisplacement2Cm: number;
  bodiceDisplacement1Cm: number;
  bodiceDisplacement2Cm: number;
  areAttachedToContour: boolean;
  orientationAngle1Deg: number;
  orientationAngle2Deg: number;
  areOrientationsValid: boolean;
}

export interface CrownNotchCheck {
  notchId: string;
  position: Point;
  apexDistanceCm: number;
  isApexAligned: boolean;
  orientationAngleDeg: number;
  isOrientationValid: boolean; // -90 +/- 15 deg
}

export interface AssemblyNotchCorrespondenceResult {
  frontNotch: FrontNotchPairing | null;
  backNotches: BackNotchPairing | null;
  crownNotch: CrownNotchCheck | null;
  status: AssemblyValidationStatus;
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AssemblyTransformedPiece {
  sourcePieceId: string;
  pieceCode: string;
  name: string;
  role: 'bodice-front' | 'bodice-back' | 'sleeve';
  translation: Point;
  rotationDeg: number;
  isRigid: boolean;
  transformedCutSvgPath: string;
  transformedSewSvgPath: string;
  transformedNotches: Notch[];
  transformedSeams: SeamLine[];
  transformedBoundingBox: BoundingBox;
  seamAllowanceWidthCm?: number;
  transformedGrainline?: GrainLine;
  material?: 'self' | 'lining' | 'interfacing';
  onFold?: boolean;
  cutCount?: number;
}

export interface AssemblyInspectionLayout {
  layoutType: '2d-inspection-alignment';
  description: string;
  disclaimer: string;
  frontAssembly: {
    bodice: AssemblyTransformedPiece;
    sleeve: AssemblyTransformedPiece;
  };
  backAssembly: {
    bodice: AssemblyTransformedPiece;
    sleeve: AssemblyTransformedPiece;
  };
  layoutBoundingBox: BoundingBox;
}

export interface BodiceSleeveAssemblyResult {
  id: string;
  timestamp: string;
  status: AssemblyValidationStatus;
  isValid: boolean;
  isProductionReady: boolean; // Strictly false: 2D prototype CAD geometry; 3D physical drape/wearer fit unassessed
  measurements: {
    frontBodiceArmhole: SeamArcLengthMeasurement | null;
    backBodiceArmhole: SeamArcLengthMeasurement | null;
    frontSleeveCap: SeamArcLengthMeasurement | null;
    backSleeveCap: SeamArcLengthMeasurement | null;
  };
  ease: EaseCompatibilityMetrics;
  endpoints: SeamEndpointOrientationResult;
  notches: AssemblyNotchCorrespondenceResult;
  validationReport: ValidationReport;
  inspectionLayout?: AssemblyInspectionLayout;
  pieces: {
    frontBodice?: PatternPiece;
    backBodice?: PatternPiece;
    sleeve?: PatternPiece;
  };
  unresolvedRisks: string[];
  productionNotes: string[];
}
