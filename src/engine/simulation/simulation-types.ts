/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BodiceDartStyle,
  BodyMeasurements,
  DesignSpecification,
  EaseProfile,
  SleeveEaseStrategy,
  ValidationReport
} from '../../types';

export type AvatarSourceType = 'ESTIMATED_PARAMETRIC_M02C' | 'MEASURED_3D_SCAN';

export type AvatarPoseId = 'CANONICAL_A_POSE' | 'SEATED_90' | 'ARM_FORWARD_45';

export type LandmarkID =
  | 'NAPE_C7'
  | 'FRONT_NECK_PIT'
  | 'LEFT_ACROMION'
  | 'RIGHT_ACROMION'
  | 'BUST_APEX_LEFT'
  | 'BUST_APEX_RIGHT'
  | 'SCYE_LEVEL_CENTER'
  | 'CENTER_WAIST_FRONT'
  | 'CENTER_WAIST_BACK'
  | 'HIGH_HIP_CENTER'
  | 'LOW_HIP_MAX'
  | 'LEFT_ELBOW'
  | 'LEFT_WRIST'
  | 'RIGHT_ELBOW'
  | 'RIGHT_WRIST';

export type AnatomicalPlaneID =
  | 'neck'
  | 'shoulder'
  | 'scye'
  | 'bust'
  | 'waist'
  | 'high_hip'
  | 'low_hip'
  | 'hem';

export type FitZoneID =
  | 'neck'
  | 'shoulder'
  | 'bust'
  | 'scye_armhole'
  | 'biceps_sleeve'
  | 'waist'
  | 'high_hip'
  | 'low_hip'
  | 'hem';

export type MaterialConstitutiveEvidenceTier =
  | 'TIER_1_LAB'
  | 'TIER_2_BENCHTOP'
  | 'TIER_3_PRIOR';

export type AnalyticalBenchmarkId =
  | 'B1_UNIAXIAL_MEMBRANE'
  | 'B2_CANTILEVER_BENDING'
  | 'B3_CATENARY_CURVE'
  | 'B4_MESH_CONVERGENCE';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface ClosedContour3D {
  planeId: AnatomicalPlaneID;
  yHeightCm: number;
  circumferenceCm: number;
  semiWidthXCm: number;
  semiDepthZCm: number;
  centerZOffsetCm: number;
  points: Point3D[];
}

export interface AvatarBodyRepresentation {
  avatarId: string;
  sourceType: AvatarSourceType;
  poseId: AvatarPoseId;
  provenanceLabel: string;
  provenanceStatement: string;
  heightCm: number;
  landmarks: Record<LandmarkID, Point3D>;
  crossSectionContours: Record<AnatomicalPlaneID, ClosedContour3D>;
  armAxis: {
    shoulderPivot: Point3D;
    elbowJoint: Point3D;
    wristJoint: Point3D;
    bicepsRadiusCm: number;
    elbowRadiusCm: number;
    wristRadiusCm: number;
  };
  measurementUncertaintyCm: Record<string, number>;
}

export interface CalibratedMaterialConstitutiveSpec {
  materialSpecId: string;
  fabricId: string;
  fabricName: string;
  evidenceTier: MaterialConstitutiveEvidenceTier;
  /** True orthotropic stiffnesses in N/cm (2D membrane shell modulus E * thickness) */
  eWarpNCm: number;
  eWeftNCm: number;
  gShearNCm: number;
  nu12: number;
  nu21: number;
  /** Discrete bending rigidities in N*cm */
  bWarpNCm: number;
  bWeftNCm: number;
  /** Areal mass in kg/m^2 */
  densityKgM2: number;
  thicknessMm: number;
  shrinkageWarpPct: number;
  shrinkageWeftPct: number;
  maxSafeEaseStretchPct: number;
  /** Thermodynamic admissibility checks (ADR-005 / DOS-04-R2) */
  symmetryResidual: number;
  determinant2D: number;
  thermodynamicallyAdmissible: boolean;
  warnings: string[];
}

export interface AnalyticalBenchmarkResult {
  benchmarkId: AnalyticalBenchmarkId;
  title: string;
  standardReference: string;
  measuredValue: number;
  analyticalValue: number;
  unit: string;
  errorValue: number;
  errorUnit: string;
  toleranceLimit: number;
  passed: boolean;
  notes: string;
}

export interface ClothSolverQualificationReport {
  solverVersion: string;
  evaluatedAt: string;
  allPassed: boolean;
  benchmarks: AnalyticalBenchmarkResult[];
}

export interface MeshVertex3D {
  index: number;
  pieceId: string;
  pieceCode: string;
  u: number;
  v: number;
  restX: number;
  restY: number;
  x: number;
  y: number;
  z: number;
  isBoundary: boolean;
  seamRole?: string;
  warpStrainPct: number;
  weftStrainPct: number;
  vonMisesStrainPct: number;
  contactPressureKpa: number;
  bodyClearanceCm: number;
}

export interface MeshTriangle {
  a: number;
  b: number;
  c: number;
  pieceId: string;
  restAreaCm2: number;
  e1Rest: [number, number];
  e2Rest: [number, number];
}

export interface SeamSpringEdge {
  id: string;
  label: string;
  vertexA: number;
  vertexB: number;
  restGapCm: number;
  finalGapCm: number;
}

export interface EnergyPoint {
  iteration: number;
  totalEnergyJ: number;
  membraneEnergyJ: number;
  bendingEnergyJ: number;
  seamEnergyJ: number;
  barrierEnergyJ: number;
  residualNorm: number;
}

export interface SimulationCaseResult {
  simulationId: string;
  revisionId: string;
  avatarId: string;
  avatarSourceType: AvatarSourceType;
  poseId: AvatarPoseId;
  materialSpecId: string;
  materialEvidenceTier: MaterialConstitutiveEvidenceTier;
  solverVersion: string;
  meshEdgeLengthMm: number;
  vertexCount: number;
  triangleCount: number;
  seamEdgeCount: number;
  equilibriumResidualNorm: number;
  interpenetratingTriangles: number;
  minBodyClearanceCm: number;
  energyHistory: EnergyPoint[];
  vertices: MeshVertex3D[];
  triangles: MeshTriangle[];
  seamEdges: SeamSpringEdge[];
  benchmarkQualification: ClothSolverQualificationReport;
  convergenceVerified: boolean;
  failureReason?: string;
  isProductionReady: false;
}

export type ZoneFitStatus = 'PASS' | 'MARGINAL_ADJUSTABLE' | 'FAIL_STRUCTURAL';

export interface ZoneFitMetrics {
  zoneId: FitZoneID;
  zoneLabel: string;
  bodyCircumferenceCm: number;
  drapedCircumferenceCm: number;
  actualEaseCm: number;
  targetEaseCm: number;
  easeDeltaCm: number;
  meanWarpStrainPct: number;
  meanWeftStrainPct: number;
  maxStrainPct: number;
  meanContactPressureKpa: number;
  maxContactPressureKpa: number;
  status: ZoneFitStatus;
  diagnosis: string;
}

export interface FitDiagnosticFinding {
  id: string;
  zoneId: FitZoneID;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  suggestedRecipeParameter?: string;
}

export interface PullLineVector {
  zoneId: FitZoneID;
  origin: Point3D;
  direction: Vector3D;
  strainPct: number;
  label: string;
}

export interface FitEvaluationReport {
  fitReportId: string;
  simulationId: string;
  avatarId: string;
  avatarSourceType: AvatarSourceType;
  poseId: AvatarPoseId;
  overallFitStatus: ZoneFitStatus;
  regionalZones: Record<FitZoneID, ZoneFitMetrics>;
  evaluatedZoneOrder: FitZoneID[];
  hemLevelDeviationCm: number;
  grainlinePlumbDeviationDeg: number;
  pullLineVectors: PullLineVector[];
  actionableFindings: FitDiagnosticFinding[];
  prohibitsUniversalScalarScore: true;
  physicalValidationRequired: true;
  disclaimer: string;
  isProductionReady: false;
}

export interface BoundedRecipeParameters {
  bustEaseDeltaCm: number;
  waistEaseDeltaCm: number;
  hipEaseDeltaCm: number;
  sleeveEaseStrategy?: SleeveEaseStrategy;
  bodiceDartStyle?: BodiceDartStyle;
}

export interface FitObjectiveVector {
  meanStrainEnergyPenalty: number;
  easeDeviationCm: number;
  balanceTiltPenalty: number;
  stylePreservationPenalty: number;
}

export interface BoundedOptimizationProposal {
  proposalId: string;
  parentRevisionId: string;
  parameterDeltas: BoundedRecipeParameters;
  objectiveScoresBefore: FitObjectiveVector;
  objectiveScoresAfter: FitObjectiveVector;
  paretoRank: number;
  independentM02ValidationPassed: boolean;
  m02ValidationSummary: string;
  proposedDesignSpec: DesignSpecification;
  fitReportAfter: FitEvaluationReport;
  requiresHumanApproval: true;
  rationale: string;
}

export interface BoundedOptimizationResult {
  optimizationId: string;
  parentRevisionId: string;
  evaluatedCandidatesCount: number;
  rejectedByM02Count: number;
  baselineObjectives: FitObjectiveVector;
  proposals: BoundedOptimizationProposal[];
  requiresHumanApproval: true;
  governanceNote: string;
}

export interface GarmentSimulationInput {
  designSpec: DesignSpecification;
  measurements: BodyMeasurements;
  poseId?: AvatarPoseId;
  bodiceDartStyle?: BodiceDartStyle;
  sleeveEaseStrategy?: SleeveEaseStrategy;
  meshEdgeLengthCm?: number;
  easeProfileOverride?: EaseProfile;
}

export interface ValidationPipelineArtifact {
  validation: ValidationReport;
  pieceCount: number;
}
