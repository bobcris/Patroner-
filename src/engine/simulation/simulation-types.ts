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

export interface BenchmarkResolutionCheck {
  label: string;
  meshEdgeLengthMm: number;
  measuredValue: number;
  analyticalValue: number;
  errorValue: number;
  passed: boolean;
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
  convergenceBehavior: string;
  resolutionChecks: BenchmarkResolutionCheck[];
}

export interface ClothSolverQualificationReport {
  solverVersion: string;
  materialSpecId: string;
  materialName: string;
  evaluatedAt: string;
  allPassed: boolean;
  failureReason?: string;
  benchmarks: AnalyticalBenchmarkResult[];
}

export interface MeshTopologyDiagnostics {
  degenerateTriangleCount: number;
  minTriangleAreaCm2: number;
  minInteriorAngleDeg: number;
  maxAspectRatio: number;
  leftRightSymmetryErrorCm: number;
  boundaryVertexCount: number;
  manifoldIntegrityVerified: boolean;
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

export interface SimulationEpistemicLayers {
  analyticalQualification: 'AC-08_PASSED' | 'AC-08_FAILED';
  numericalConvergence: 'CONVERGED' | 'FAILED_CLOSED';
  syntheticDrapeBasis: 'PARAMETRIC_M02C_SYNTHETIC' | 'SCAN_SYNTHETIC';
  physicalToileValidation: 'AC-09_PENDING' | 'AC-09_PASSED' | 'AC-09_FAILED';
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
  selfIntersectingTriangles: number;
  minBodyClearanceCm: number;
  topologyDiagnostics: MeshTopologyDiagnostics;
  energyHistory: EnergyPoint[];
  energyConverging: boolean;
  vertices: MeshVertex3D[];
  triangles: MeshTriangle[];
  seamEdges: SeamSpringEdge[];
  benchmarkQualification: ClothSolverQualificationReport;
  epistemicLayers: SimulationEpistemicLayers;
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
  documentedAssumptions: string[];
  measurementUncertaintyNote: string;
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

export interface OptimizationZoneDelta {
  zoneId: FitZoneID;
  zoneLabel: string;
  easeDeltaBeforeCm: number;
  easeDeltaAfterCm: number;
  maxStrainBeforePct: number;
  maxStrainAfterPct: number;
  statusBefore: ZoneFitStatus;
  statusAfter: ZoneFitStatus;
}

export interface BoundedOptimizationProposal {
  proposalId: string;
  parentRevisionId: string;
  parameterDeltas: BoundedRecipeParameters;
  objectiveScoresBefore: FitObjectiveVector;
  objectiveScoresAfter: FitObjectiveVector;
  regionalDeltaSummary: OptimizationZoneDelta[];
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
  uniqueCandidatesTested: number;
  rejectedByM02Count: number;
  rejectionReasons: string[];
  baselineObjectives: FitObjectiveVector;
  proposals: BoundedOptimizationProposal[];
  requiresHumanApproval: true;
  governanceNote: string;
}

export type Ac09ToileBlockKey = 'skirt-block-v1' | 'bodice-sleeve-v1';

export type Ac09ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'INCOMPLETE';

export type Ac09WorkflowState =
  | 'PENDING'
  | 'DRAFT'
  | 'SAMPLE_REGISTERED'
  | 'EVIDENCE_INCOMPLETE'
  | 'READY_FOR_REVIEW'
  | 'PASSED'
  | 'FAILED';

export type Ac09MeasurementInstrument =
  | 'calibrated-fiberglass-tape'
  | 'flexible-steel-rule'
  | 'digital-caliper';

export type Ac09AuthorizedReviewerRole =
  | 'LEAD_PATTERNMAKER'
  | 'QA_LEAD'
  | 'ATELIER_TECH_DIRECTOR';

export interface Ac09TolerancePolicy {
  pomToleranceCm: number; // Authoritative M06 §18 limit: <= 0.50 cm
  regionalAgreementMinPct: number; // Authoritative M06 §18 limit: >= 85%
  hemLevelToleranceCm: number; // Default <= 0.80 cm
  maxAllowedUncertaintyCm: number; // Guard against coarse/unstable repeated readings
}

export interface Ac09PomCheckpoint {
  pointId: string;
  label: string;
  unit?: 'cm';
  checkpointDefinition?: string;
  zoneId: FitZoneID;
  nominalCadCm: number;
  measuredToileCm: number | null;
  repeatReadingsCm?: number[];
  repeatSpreadCm?: number | null;
  combinedUncertaintyCm?: number | null;
  toleranceCm: number; // M06 §18 authoritative limit: <= 0.50 cm
  deltaCm: number | null;
  withinTolerance: boolean | null;
  sourceFlag?: 'PHYSICAL_OPERATOR_CAPTURE';
}

export interface Ac09RegionalIssueCheck {
  zoneId: FitZoneID;
  zoneLabel: string;
  digitalPredictionStatus: ZoneFitStatus;
  digitalPredictedIssue: string;
  digitalEaseDeltaCm?: number;
  digitalMaxStrainPct?: number;
  physicalObservationSummary: string | null;
  agreesWithDigitalPrediction: boolean | null;
}

export interface Ac09EvidenceItem {
  itemId: string;
  label: string;
  category: 'photograph' | 'pom-tape' | 'grainline-hem' | 'seam-assembly';
  recorded: boolean;
  referenceNote?: string;
  attachmentUri?: string;
  capturedAt?: string;
  isSyntheticSource?: boolean;
}

export interface Ac09SampleTraceability {
  approvedPatternRevisionId: string;
  recordedPatternRevisionId: string;
  expectedGarmentCategory: 'skirt' | 'bodice';
  bodyMeasurementSetRef: string;
  expectedMaterialSpecId: string;
  expectedFabricComposition: string;
  expectedFabricWeightGsm: number;
  expectedFabricStretchPct: number;
  expectedFabricDirection: string;
  recordedFabricId: string;
  recordedFabricComposition: string;
  recordedFabricWeightGsm: number | null;
  recordedFabricStretchPct: number | null;
  recordedFabricDirection: string;
  recordedFabricLot: string;
  constructionDocRef: string;
  simulationCaseRef: string;
}

export interface Ac09ProcessRecord {
  cuttingOperator: string;
  cutDate: string | null;
  cuttingGrainlineVerified: boolean;
  sewingOperator: string;
  sewnDate: string | null;
  /** Physical cutting/sewing seam allowance in cm; must be a finite number strictly > 0 before review/approval. */
  seamAllowanceCm: number | null;
  stitchType: string;
  pressingMethod: string;
}

export interface Ac09ReviewerDecision {
  decision: 'PENDING' | 'APPROVED_PASS' | 'REJECTED_FAIL';
  reviewerName: string;
  reviewerRole: string;
  /** Parseable ISO-8601 date (YYYY-MM-DD) or ISO-8601 timestamp string. */
  decidedAt: string | null;
  rationale: string;
  /**
   * Client-side unkeyed SHA-256 tamper-evident integrity seal over the canonical review payload.
   * Detects accidental or partial post-decision mutation; does NOT provide cryptographic reviewer
   * identity authentication or defense against a local actor recomputing the unkeyed digest.
   */
  signatureDigest: string | null;
}

export interface Ac09RevisionSnapshot {
  revision: number;
  workflowState: Ac09WorkflowState;
  archivedAt: string;
  reason: string;
  snapshotDigest: string;
}

export interface Ac09PhysicalToileRecord {
  recordId: string;
  sampleId?: string;
  sampleRevision?: number;
  executionMode?: 'legacy' | 'workflow';
  workflowState?: Ac09WorkflowState;
  isLocked?: boolean;
  lockedAt?: string | null;
  /**
   * Client-side unkeyed SHA-256 tamper-evident snapshot seal over the locked record state.
   * Detects accidental/partial post-lock tampering; does NOT authenticate reviewer identity.
   */
  lockedSnapshotDigest?: string | null;
  revisionHistory?: Ac09RevisionSnapshot[];
  toileBlockKey: Ac09ToileBlockKey;
  garmentLabel: string;
  revisionId: string;
  sizeCode: string;
  fabricId: string;
  fabricName: string;
  grainlineVerified: boolean;
  bodyOrDressFormId: string;
  poseId: AvatarPoseId;
  evaluatorName: string;
  evaluatedAt: string | null;
  measurementInstrument?: Ac09MeasurementInstrument;
  instrumentResolutionCm?: number;
  tolerancePolicy?: Ac09TolerancePolicy;
  traceability?: Ac09SampleTraceability;
  processRecord?: Ac09ProcessRecord;
  reviewerDecision?: Ac09ReviewerDecision;
  pomCheckpoints: Ac09PomCheckpoint[];
  regionalAgreementChecks: Ac09RegionalIssueCheck[];
  /**
   * Non-negative unsigned physical floor-to-hem level differential magnitude in cm.
   * Required finite value in [0, policy.hemLevelToleranceCm] (default [0, 0.80] cm) for READY_FOR_REVIEW and PASSED.
   */
  hemLevelPhysicalDeviationCm: number | null;
  seamAlignmentVerified: boolean | null;
  evidenceChecklist: Ac09EvidenceItem[];
  notes: string;
  isProductionReady: false;
}

export interface Ac09PhysicalToileEvaluation {
  toileBlockKey: Ac09ToileBlockKey;
  status: Ac09ValidationStatus;
  workflowState: Ac09WorkflowState;
  completedPomCount: number;
  requiredPomCount: number;
  maxPomConcordanceErrorCm: number | null;
  maxMeasurementUncertaintyCm: number | null;
  pomToleranceLimitCm: number;
  pomConcordancePassed: boolean;
  evaluatedZonesCount: number;
  agreedZonesCount: number;
  regionalAgreementPct: number | null;
  requiredAgreementPct: number;
  regionalAgreementPassed: boolean;
  evidenceCompletedCount: number;
  requiredEvidenceCount: number;
  allEvidenceRecorded: boolean;
  traceabilityVerified: boolean;
  traceabilityMismatches: string[];
  missingEvidenceDiagnostics: string[];
  syntheticEvidenceDetected: boolean;
  signOffRecorded: boolean;
  signOffAuthorized: boolean;
  blockingReasons: string[];
  summary: string;
  isProductionReady: false;
}

export interface Ac09ExportableValidationReport {
  reportFormatVersion: 'patroner-ac09-v1';
  recordId: string;
  sampleId: string;
  sampleRevision: number;
  toileBlockKey: Ac09ToileBlockKey;
  simulationBaseline: {
    simulationCaseRef: string;
    poseId: AvatarPoseId;
    approvedPatternRevisionId: string;
    expectedMaterialSpecId: string;
    regionalPredictions: Array<{
      zoneId: FitZoneID;
      zoneLabel: string;
      status: ZoneFitStatus;
      easeDeltaCm: number | null;
      maxStrainPct: number | null;
      predictedIssue: string;
    }>;
  };
  physicalEvidence: {
    sizeCode: string;
    bodyMeasurementSetRef: string;
    recordedPatternRevisionId: string;
    fabric: {
      fabricId: string;
      composition: string;
      weightGsm: number | null;
      stretchPct: number | null;
      direction: string;
      lot: string;
    };
    process: Ac09ProcessRecord;
    instrument: {
      type: Ac09MeasurementInstrument;
      resolutionCm: number;
      dressFormOrBodyId: string;
      evaluatorName: string;
      evaluatedAt: string | null;
    };
    pomMeasurements: Ac09PomCheckpoint[];
    regionalObservations: Ac09RegionalIssueCheck[];
    evidenceAttachments: Ac09EvidenceItem[];
    hemLevelPhysicalDeviationCm: number | null;
    seamAlignmentVerified: boolean | null;
    grainlineVerified: boolean;
  };
  evaluationOutcome: Ac09PhysicalToileEvaluation;
  reviewerDecision: Ac09ReviewerDecision;
  governanceInvariants: {
    isProductionReady: false;
    physicalValidationRequired: true;
    m00Accepted: false;
    gateAuth3Status: 'CLOSED';
    externalCadInteroperabilityVerified: false;
    syntheticDataProhibited: true;
  };
  canonicalDigest: string;
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
