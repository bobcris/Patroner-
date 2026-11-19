/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodiceDartStyle,
  BodyMeasurements,
  DesignSpecification,
  PatternPiece,
  SleeveEaseStrategy
} from '../../types';
import { assembleBodiceSleeve } from '../assembly';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { validatePatternDraft } from '../validation/seam-validator';
import { generateParametricAvatar } from './avatar-generator';
import { runGarmentDrapeSimulation } from './cloth-solver';
import { evaluateQuantitativeFit } from './fit-evaluator';
import {
  AvatarPoseId,
  BoundedOptimizationProposal,
  BoundedOptimizationResult,
  BoundedRecipeParameters,
  FitEvaluationReport,
  FitObjectiveVector
} from './simulation-types';

export const RECIPE_BOUNDS = {
  bustEaseDeltaCm: { min: -1.5, max: 1.5 },
  waistEaseDeltaCm: { min: -1.5, max: 1.5 },
  hipEaseDeltaCm: { min: -1.5, max: 1.5 }
} as const;

const DEFAULT_BASE_EASE: Record<string, { bust: number; waist: number; hip: number }> = {
  'ultra-fitted': { bust: 2.0, waist: 1.5, hip: 2.0 },
  fitted: { bust: 4.0, waist: 2.5, hip: 3.5 },
  classic: { bust: 6.5, waist: 3.5, hip: 5.0 },
  relaxed: { bust: 9.5, waist: 6.0, hip: 7.5 },
  oversized: { bust: 14.0, waist: 10.0, hip: 12.0 }
};

/**
 * Clamps candidate recipe parameters strictly inside ADR-006 declared box constraints.
 */
export function clampBoundedRecipeParameters(params: BoundedRecipeParameters): BoundedRecipeParameters {
  return {
    bustEaseDeltaCm: clamp(params.bustEaseDeltaCm, RECIPE_BOUNDS.bustEaseDeltaCm.min, RECIPE_BOUNDS.bustEaseDeltaCm.max),
    waistEaseDeltaCm: clamp(params.waistEaseDeltaCm, RECIPE_BOUNDS.waistEaseDeltaCm.min, RECIPE_BOUNDS.waistEaseDeltaCm.max),
    hipEaseDeltaCm: clamp(params.hipEaseDeltaCm, RECIPE_BOUNDS.hipEaseDeltaCm.min, RECIPE_BOUNDS.hipEaseDeltaCm.max),
    sleeveEaseStrategy: params.sleeveEaseStrategy,
    bodiceDartStyle: params.bodiceDartStyle
  };
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return 0;
  return Number(Math.max(min, Math.min(max, v)).toFixed(3));
}

export function computeFitObjectiveVector(
  fitReport: FitEvaluationReport,
  deltas: BoundedRecipeParameters
): FitObjectiveVector {
  const zones = fitReport.evaluatedZoneOrder.map(id => fitReport.regionalZones[id]);
  const meanStrain =
    zones.reduce((acc, z) => acc + Math.max(Math.abs(z.meanWarpStrainPct), Math.abs(z.meanWeftStrainPct)), 0) /
    Math.max(1, zones.length);
  const meanEaseDev =
    zones.reduce((acc, z) => acc + Math.abs(z.easeDeltaCm), 0) / Math.max(1, zones.length);
  const balanceTilt = fitReport.hemLevelDeviationCm + fitReport.grainlinePlumbDeviationDeg * 0.25;
  const stylePenalty = Math.sqrt(
    deltas.bustEaseDeltaCm * deltas.bustEaseDeltaCm +
      deltas.waistEaseDeltaCm * deltas.waistEaseDeltaCm +
      deltas.hipEaseDeltaCm * deltas.hipEaseDeltaCm
  );

  return {
    meanStrainEnergyPenalty: Number(meanStrain.toFixed(4)),
    easeDeviationCm: Number(meanEaseDev.toFixed(4)),
    balanceTiltPenalty: Number(balanceTilt.toFixed(4)),
    stylePreservationPenalty: Number(stylePenalty.toFixed(4))
  };
}

/**
 * Compiles a candidate child specification from scratch through M02 drafting + validation (ADR-006).
 * Never mutates the caller's specification or existing contour coordinates directly.
 */
export function compileAndRevalidateCandidate(params: {
  parentSpec: DesignSpecification;
  measurements: BodyMeasurements;
  deltas: BoundedRecipeParameters;
  bodiceDartStyle?: BodiceDartStyle;
}): {
  passed: boolean;
  summary: string;
  candidateSpec: DesignSpecification;
  pieces: PatternPiece[];
} {
  const { parentSpec, measurements, bodiceDartStyle = parentSpec.dartStyle ?? 'waist' } = params;
  const safeDeltas = clampBoundedRecipeParameters(params.deltas);
  const easeDefaults = DEFAULT_BASE_EASE[parentSpec.easeProfile] ?? DEFAULT_BASE_EASE.classic;

  const baseBust = parentSpec.explicitEaseCm?.bust ?? easeDefaults.bust;
  const baseWaist = parentSpec.explicitEaseCm?.waist ?? easeDefaults.waist;
  const baseHip = parentSpec.explicitEaseCm?.hip ?? easeDefaults.hip;

  const parentRev = parentSpec.specificationRevisionId ?? `spec-${parentSpec.id}-v${parentSpec.version}`;
  const nextVersion = parentSpec.version + 1;

  // Child branch MUST start unapproved (`isApproved: false`) requiring explicit LEAD_PATTERNMAKER / designer approval
  const candidateSpec: DesignSpecification = {
    ...parentSpec,
    version: nextVersion,
    parentRevisionId: parentRev,
    specificationRevisionId: `${parentSpec.id}-m06opt-v${nextVersion}`,
    isApproved: false,
    approvedAt: undefined,
    approvedBy: undefined,
    approvalState: 'draft',
    approvalRecord: undefined,
    sleeveEaseStrategy: safeDeltas.sleeveEaseStrategy ?? parentSpec.sleeveEaseStrategy,
    dartStyle: bodiceDartStyle,
    explicitEaseCm: {
      ...parentSpec.explicitEaseCm,
      bust: Number(Math.max(0, baseBust + safeDeltas.bustEaseDeltaCm).toFixed(2)),
      waist: Number(Math.max(0, baseWaist + safeDeltas.waistEaseDeltaCm).toFixed(2)),
      hip: Number(Math.max(0, baseHip + safeDeltas.hipEaseDeltaCm).toFixed(2))
    }
  };

  let pieces: PatternPiece[] = [];
  try {
    if (candidateSpec.garmentCategory === 'bodice') {
      const bodicePieces = draftBodiceBlock(measurements, candidateSpec, { dartStyle: bodiceDartStyle });
      const sleeveStrategy = candidateSpec.sleeveEaseStrategy ?? 'classic';
      const sleeveRes = draftSleeveBlock(measurements, candidateSpec, {
        strategy: sleeveStrategy,
        bodicePieces
      });
      pieces = [...bodicePieces, sleeveRes.piece];

      const assembly = assembleBodiceSleeve({
        bodicePieces,
        sleevePiece: sleeveRes.piece,
        designSpec: candidateSpec,
        measurements,
        options: {
          strategy: sleeveStrategy,
          strictUncertaintyGate: false
        }
      });
      if (assembly.status !== 'verified-valid') {
        return {
          passed: false,
          summary: `Rejected by M04.3 bodice-sleeve assembly gate: ${assembly.validationReport.statusLabel}`,
          candidateSpec,
          pieces
        };
      }
    } else {
      pieces = draftSkirtBlock(measurements, candidateSpec);
    }

    const validation = validatePatternDraft(pieces);
    if (!validation.isValid) {
      return {
        passed: false,
        summary: `Rejected by M02 contour/seam validation (${validation.failureCount} failures).`,
        candidateSpec,
        pieces
      };
    }

    return {
      passed: true,
      summary: `M02 re-validation passed (${pieces.length} pieces, ${validation.passedCount} checks).`,
      candidateSpec,
      pieces
    };
  } catch (err) {
    return {
      passed: false,
      summary: `Rejected by M02 drafting failure: ${err instanceof Error ? err.message : String(err)}`,
      candidateSpec,
      pieces
    };
  }
}

/**
 * Executes bounded multi-objective Pareto optimization over declared M02/M04 recipe parameters (M06.5 / ADR-006).
 */
export function runBoundedPatternOptimization(params: {
  currentSpec: DesignSpecification;
  measurements: BodyMeasurements;
  poseId?: AvatarPoseId;
  bodiceDartStyle?: BodiceDartStyle;
  sleeveEaseStrategy?: SleeveEaseStrategy;
}): BoundedOptimizationResult {
  const {
    currentSpec,
    measurements,
    poseId = 'CANONICAL_A_POSE',
    bodiceDartStyle = currentSpec.dartStyle ?? 'waist',
    sleeveEaseStrategy = currentSpec.sleeveEaseStrategy ?? 'classic'
  } = params;

  const avatar = generateParametricAvatar(measurements, poseId);
  const parentRev = currentSpec.specificationRevisionId ?? `spec-${currentSpec.id}-v${currentSpec.version}`;

  // Baseline evaluation
  const baselineCheck = compileAndRevalidateCandidate({
    parentSpec: currentSpec,
    measurements,
    deltas: { bustEaseDeltaCm: 0, waistEaseDeltaCm: 0, hipEaseDeltaCm: 0, sleeveEaseStrategy },
    bodiceDartStyle
  });
  const baseSim = runGarmentDrapeSimulation({
    pieces: baselineCheck.pieces,
    designSpec: currentSpec,
    measurements,
    avatar,
    poseId
  });
  const baseFit = evaluateQuantitativeFit(baseSim, avatar, currentSpec, measurements);
  const baselineObjectives = computeFitObjectiveVector(baseFit, {
    bustEaseDeltaCm: 0,
    waistEaseDeltaCm: 0,
    hipEaseDeltaCm: 0
  });

  // Candidate grid guided by baseline regional ease deficits inside ADR-006 box bounds
  const candidates: BoundedRecipeParameters[] = [];
  if (currentSpec.garmentCategory === 'bodice') {
    const bustDeficit = -(baseFit.regionalZones.bust?.easeDeltaCm ?? 0);
    const waistDeficit = -(baseFit.regionalZones.waist?.easeDeltaCm ?? 0);
    candidates.push(
      { bustEaseDeltaCm: bustDeficit * 0.75, waistEaseDeltaCm: waistDeficit * 0.75, hipEaseDeltaCm: 0, sleeveEaseStrategy },
      { bustEaseDeltaCm: bustDeficit, waistEaseDeltaCm: waistDeficit, hipEaseDeltaCm: 0, sleeveEaseStrategy: 'classic' },
      { bustEaseDeltaCm: 1.0, waistEaseDeltaCm: 0.75, hipEaseDeltaCm: 0, sleeveEaseStrategy: 'tailored' },
      { bustEaseDeltaCm: -0.75, waistEaseDeltaCm: -0.5, hipEaseDeltaCm: 0, sleeveEaseStrategy: 'fitted' },
      { bustEaseDeltaCm: 1.4, waistEaseDeltaCm: 1.2, hipEaseDeltaCm: 0, sleeveEaseStrategy }
    );
  } else {
    const waistDeficit = -(baseFit.regionalZones.waist?.easeDeltaCm ?? 0);
    const hipDeficit = -(baseFit.regionalZones.low_hip?.easeDeltaCm ?? 0);
    candidates.push(
      { bustEaseDeltaCm: 0, waistEaseDeltaCm: waistDeficit * 0.8, hipEaseDeltaCm: hipDeficit * 0.8 },
      { bustEaseDeltaCm: 0, waistEaseDeltaCm: waistDeficit, hipEaseDeltaCm: hipDeficit },
      { bustEaseDeltaCm: 0, waistEaseDeltaCm: 0.8, hipEaseDeltaCm: 1.2 },
      { bustEaseDeltaCm: 0, waistEaseDeltaCm: -0.6, hipEaseDeltaCm: -0.6 },
      { bustEaseDeltaCm: 0, waistEaseDeltaCm: 1.4, hipEaseDeltaCm: 1.5 }
    );
  }

  let rejectedByM02Count = 0;
  const validCandidates: Array<{
    deltas: BoundedRecipeParameters;
    objectives: FitObjectiveVector;
    candidateSpec: DesignSpecification;
    fitReport: FitEvaluationReport;
    m02Summary: string;
  }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const clamped = clampBoundedRecipeParameters(candidates[i]);
    const reval = compileAndRevalidateCandidate({
      parentSpec: currentSpec,
      measurements,
      deltas: clamped,
      bodiceDartStyle
    });
    if (!reval.passed) {
      rejectedByM02Count++;
      continue;
    }

    const sim = runGarmentDrapeSimulation({
      pieces: reval.pieces,
      designSpec: reval.candidateSpec,
      measurements,
      avatar,
      poseId
    });
    if (!sim.convergenceVerified) {
      rejectedByM02Count++;
      continue;
    }

    const fit = evaluateQuantitativeFit(sim, avatar, reval.candidateSpec, measurements);
    const obj = computeFitObjectiveVector(fit, clamped);
    validCandidates.push({
      deltas: clamped,
      objectives: obj,
      candidateSpec: reval.candidateSpec,
      fitReport: fit,
      m02Summary: reval.summary
    });
  }

  // Assign Pareto non-dominance ranks over (meanStrainEnergyPenalty, easeDeviationCm, balanceTiltPenalty, stylePreservationPenalty)
  const ranks = assignParetoRanks(validCandidates.map(c => c.objectives));
  const proposals: BoundedOptimizationProposal[] = validCandidates
    .map((c, idx) => ({
      proposalId: `opt-prop-${parentRev}-${idx + 1}`,
      parentRevisionId: parentRev,
      parameterDeltas: c.deltas,
      objectiveScoresBefore: baselineObjectives,
      objectiveScoresAfter: c.objectives,
      paretoRank: ranks[idx],
      independentM02ValidationPassed: true,
      m02ValidationSummary: c.m02Summary,
      proposedDesignSpec: c.candidateSpec,
      fitReportAfter: c.fitReport,
      requiresHumanApproval: true as const,
      rationale: buildProposalRationale(c.deltas, baselineObjectives, c.objectives)
    }))
    .sort((a, b) => a.paretoRank - b.paretoRank || a.objectiveScoresAfter.easeDeviationCm - b.objectiveScoresAfter.easeDeviationCm)
    .slice(0, 4);

  return {
    optimizationId: `m06-opt-${parentRev}`,
    parentRevisionId: parentRev,
    evaluatedCandidatesCount: candidates.length,
    rejectedByM02Count,
    baselineObjectives,
    proposals,
    requiresHumanApproval: true,
    governanceNote:
      'ADR-006 Bounded Optimization: Every proposal adjusts only declared ease/recipe parameters within ±1.5 cm bounds, passes independent M02/M04.3 re-validation, and emits an unapproved child revision requiring explicit designer approval.'
  };
}

function assignParetoRanks(objs: FitObjectiveVector[]): number[] {
  return objs.map((cand, i) => {
    let dominatedCount = 0;
    for (let j = 0; j < objs.length; j++) {
      if (i === j) continue;
      if (dominates(objs[j], cand)) dominatedCount++;
    }
    return dominatedCount + 1;
  });
}

function dominates(a: FitObjectiveVector, b: FitObjectiveVector): boolean {
  const keys: Array<keyof FitObjectiveVector> = [
    'meanStrainEnergyPenalty',
    'easeDeviationCm',
    'balanceTiltPenalty',
    'stylePreservationPenalty'
  ];
  let strictlyBetterInOne = false;
  for (const k of keys) {
    if (a[k] > b[k] + 1e-6) return false;
    if (a[k] < b[k] - 1e-6) strictlyBetterInOne = true;
  }
  return strictlyBetterInOne;
}

function buildProposalRationale(
  deltas: BoundedRecipeParameters,
  before: FitObjectiveVector,
  after: FitObjectiveVector
): string {
  const parts: string[] = [];
  if (Math.abs(deltas.bustEaseDeltaCm) > 0.05) {
    parts.push(`bust ease ${deltas.bustEaseDeltaCm > 0 ? '+' : ''}${deltas.bustEaseDeltaCm.toFixed(2)} cm`);
  }
  if (Math.abs(deltas.waistEaseDeltaCm) > 0.05) {
    parts.push(`waist ease ${deltas.waistEaseDeltaCm > 0 ? '+' : ''}${deltas.waistEaseDeltaCm.toFixed(2)} cm`);
  }
  if (Math.abs(deltas.hipEaseDeltaCm) > 0.05) {
    parts.push(`hip ease ${deltas.hipEaseDeltaCm > 0 ? '+' : ''}${deltas.hipEaseDeltaCm.toFixed(2)} cm`);
  }
  if (deltas.sleeveEaseStrategy) {
    parts.push(`sleeve strategy '${deltas.sleeveEaseStrategy}'`);
  }
  const adj = parts.length > 0 ? parts.join(', ') : 'baseline alignment';
  return `Adjust ${adj}: mean regional ease deviation ${before.easeDeviationCm.toFixed(2)} -> ${after.easeDeviationCm.toFixed(2)} cm; mean strain ${before.meanStrainEnergyPenalty.toFixed(2)}% -> ${after.meanStrainEnergyPenalty.toFixed(2)}%.`;
}
