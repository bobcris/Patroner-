/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, DesignSpecification } from '../../types';
import { sampleTorsoEllipseAtY } from './avatar-generator';
import {
  AnatomicalPlaneID,
  AvatarBodyRepresentation,
  FitDiagnosticFinding,
  FitEvaluationReport,
  FitZoneID,
  MeshVertex3D,
  PullLineVector,
  SimulationCaseResult,
  ZoneFitMetrics,
  ZoneFitStatus
} from './simulation-types';

const DEFAULT_EASE_TARGETS: Record<string, { bust: number; waist: number; hip: number; biceps: number }> = {
  'ultra-fitted': { bust: 2.0, waist: 1.5, hip: 2.0, biceps: 2.0 },
  fitted: { bust: 4.0, waist: 2.5, hip: 3.5, biceps: 3.0 },
  classic: { bust: 6.5, waist: 3.5, hip: 5.0, biceps: 4.5 },
  relaxed: { bust: 9.5, waist: 6.0, hip: 7.5, biceps: 6.5 },
  oversized: { bust: 14.0, waist: 10.0, hip: 12.0, biceps: 9.0 }
};

/**
 * Evaluates quantitative regional garment fit across anatomical zones from a 3D cloth simulation (M06.4).
 *
 * STRICT GOVERNANCE (M06 §9.3 & Dossier 05 / Dossier 12):
 * - Prohibits collapsing regional fit into a single universal scalar fit score.
 * - Flags `physicalValidationRequired: true` because digital simulation (AC-08) never replaces physical toile sign-off (AC-09).
 */
export function evaluateQuantitativeFit(
  simulation: SimulationCaseResult,
  avatar: AvatarBodyRepresentation,
  designSpec: DesignSpecification,
  measurements: BodyMeasurements
): FitEvaluationReport {
  const easeDefaults = DEFAULT_EASE_TARGETS[designSpec.easeProfile] ?? DEFAULT_EASE_TARGETS.classic;
  const targetBustEase = designSpec.explicitEaseCm?.bust ?? easeDefaults.bust;
  const targetWaistEase = designSpec.explicitEaseCm?.waist ?? easeDefaults.waist;
  const targetHipEase = designSpec.explicitEaseCm?.hip ?? easeDefaults.hip;
  const targetBicepsEase = designSpec.explicitEaseCm?.biceps ?? easeDefaults.biceps;

  const isBodice = designSpec.garmentCategory === 'bodice';
  const evaluatedZoneOrder: FitZoneID[] = isBodice
    ? ['shoulder', 'bust', 'scye_armhole', 'biceps_sleeve', 'waist']
    : ['waist', 'high_hip', 'low_hip', 'hem'];

  const torsoVertices = simulation.vertices.filter(v => !v.pieceId.toLowerCase().includes('sleeve'));
  const sleeveVertices = simulation.vertices.filter(v => v.pieceId.toLowerCase().includes('sleeve'));

  const regionalZones = {} as Record<FitZoneID, ZoneFitMetrics>;
  const actionableFindings: FitDiagnosticFinding[] = [];
  const pullLineVectors: PullLineVector[] = [];

  const documentedAssumptions = [
    `Avatar surface '${avatar.sourceType}' uses elliptical cross-sections (Hermite C1 blend across 8 planes); cross-section eccentricity uncertainty is ±${(avatar.measurementUncertaintyCm.crossSectionEccentricity ?? 1.5).toFixed(1)} cm.`,
    `Material constitutive tier is '${simulation.materialEvidenceTier}'; strain & ease magnitudes depend on low-load tensile modulus calibration (ADR-005).`,
    'Contact pressure is estimated via local thin-membrane hoop Laplace equilibrium P = T / R inside a 0.36 cm SDF contact envelope.',
    'Static equilibrium poses (CANONICAL_A_POSE, ARM_FORWARD_45, SEATED_90) exclude multi-cycle dynamic wear, stitching-thread stretch, and thermal pressing.'
  ];
  const measurementUncertaintyNote = `M02c tape uncertainty: bust ±${(avatar.measurementUncertaintyCm.bustCircumference ?? 1.0).toFixed(1)} cm, waist ±${(avatar.measurementUncertaintyCm.waistCircumference ?? 0.8).toFixed(1)} cm, hip ±${(avatar.measurementUncertaintyCm.lowHipCircumference ?? 1.0).toFixed(1)} cm, eccentricity ±${(avatar.measurementUncertaintyCm.crossSectionEccentricity ?? 1.5).toFixed(1)} cm.`;

  if (!simulation.convergenceVerified || simulation.vertices.length === 0) {
    for (const z of evaluatedZoneOrder) {
      regionalZones[z] = buildFailedZoneMetrics(z, simulation.failureReason ?? 'Simulation failed to converge.');
    }
    return {
      fitReportId: `fit-${simulation.simulationId}`,
      simulationId: simulation.simulationId,
      avatarId: avatar.avatarId,
      avatarSourceType: avatar.sourceType,
      poseId: avatar.poseId,
      overallFitStatus: 'FAIL_STRUCTURAL',
      regionalZones,
      evaluatedZoneOrder,
      hemLevelDeviationCm: 0,
      grainlinePlumbDeviationDeg: 0,
      pullLineVectors: [],
      actionableFindings: [
        {
          id: 'finding-non-convergent',
          zoneId: evaluatedZoneOrder[0],
          severity: 'critical',
          title: 'Non-Convergent Drape Simulation',
          detail: simulation.failureReason ?? 'Cloth equilibrium solver failed closed; cannot certify fit.'
        }
      ],
      documentedAssumptions,
      measurementUncertaintyNote,
      prohibitsUniversalScalarScore: true,
      physicalValidationRequired: true,
      disclaimer:
        'Digital 3D equilibrium diagnostics (AC-08) over ESTIMATED_PARAMETRIC_M02C avatar. Never substitutes for physical toile sample verification (AC-09).',
      isProductionReady: false
    };
  }

  // Evaluate torso zones via radial slice rings
  const evaluateSliceZone = (
    zoneId: FitZoneID,
    zoneLabel: string,
    planeId: AnatomicalPlaneID,
    targetEaseCm: number,
    suggestedRecipeParameter?: string
  ): ZoneFitMetrics => {
    const plane = avatar.crossSectionContours[planeId];
    const bandHalfCm = 4.5;
    const bandVerts = torsoVertices.filter(v => Math.abs(v.y - plane.yHeightCm) <= bandHalfCm);
    const effectiveVerts = bandVerts.length >= 6 ? bandVerts : nearestVerticesByY(torsoVertices, plane.yHeightCm, 12);

    const meanClearance =
      effectiveVerts.reduce((acc, v) => acc + Math.max(0, v.bodyClearanceCm), 0) /
      Math.max(1, effectiveVerts.length);
    const bodyCirc = sampleTorsoEllipseAtY(avatar, plane.yHeightCm).circumferenceCm;
    // Circumferential ease increment around an elliptical ring with mean outward clearance d is ~ 2 * pi * d
    // adjusted by hoop tangential strain
    const meanWeftStrain = mean(effectiveVerts.map(v => v.weftStrainPct));
    const meanWarpStrain = mean(effectiveVerts.map(v => v.warpStrainPct));
    const maxStrainPct = maxAbs(effectiveVerts.map(v => Math.max(Math.abs(v.weftStrainPct), Math.abs(v.warpStrainPct))));
    const meanPressure = mean(effectiveVerts.map(v => v.contactPressureKpa));
    const maxPressure = maxAbs(effectiveVerts.map(v => v.contactPressureKpa));

    const actualEaseCm = Number((2 * Math.PI * Math.max(0, meanClearance - 0.08)).toFixed(2));
    const drapedCircumferenceCm = Number((bodyCirc + actualEaseCm).toFixed(2));
    const easeDeltaCm = Number((actualEaseCm - targetEaseCm).toFixed(2));

    let status: ZoneFitStatus = 'PASS';
    let diagnosis = `Zone ease ${actualEaseCm.toFixed(2)} cm aligns within ±1.20 cm of target ${targetEaseCm.toFixed(2)} cm.`;

    if (maxStrainPct > 12.0 || meanPressure > 3.2 || actualEaseCm < -0.5) {
      status = 'FAIL_STRUCTURAL';
      diagnosis = `Excessive fabric tension (${maxStrainPct.toFixed(1)}% peak strain, ${meanPressure.toFixed(2)} kPa contact) indicates binding/under-ease.`;
      actionableFindings.push({
        id: `finding-${zoneId}`,
        zoneId,
        severity: 'critical',
        title: `${zoneLabel}: Excessive Strain / Compression`,
        detail: diagnosis,
        suggestedRecipeParameter
      });
    } else if (Math.abs(easeDeltaCm) > 1.25 || maxStrainPct > 6.5) {
      status = 'MARGINAL_ADJUSTABLE';
      diagnosis =
        easeDeltaCm < 0
          ? `Slightly tight by ${Math.abs(easeDeltaCm).toFixed(2)} cm relative to ${designSpec.easeProfile} target ease (${targetEaseCm.toFixed(2)} cm).`
          : `Excess fullness (+${easeDeltaCm.toFixed(2)} cm above ${designSpec.easeProfile} target ease ${targetEaseCm.toFixed(2)} cm).`;
      actionableFindings.push({
        id: `finding-${zoneId}`,
        zoneId,
        severity: 'warning',
        title: `${zoneLabel}: Ease Deviation (${easeDeltaCm > 0 ? '+' : ''}${easeDeltaCm.toFixed(2)} cm)`,
        detail: diagnosis,
        suggestedRecipeParameter
      });
    }

    // Track pull line vector at peak-strain vertex in zone
    if (effectiveVerts.length > 0) {
      const peakVert = effectiveVerts.reduce((best, cur) =>
        cur.vonMisesStrainPct > best.vonMisesStrainPct ? cur : best
      );
      if (peakVert.vonMisesStrainPct > 1.0) {
        pullLineVectors.push({
          zoneId,
          origin: { x: peakVert.x, y: peakVert.y, z: peakVert.z },
          direction: normalizePull(peakVert.x, 0.25, peakVert.z),
          strainPct: peakVert.vonMisesStrainPct,
          label: `${zoneLabel} Pull (${peakVert.vonMisesStrainPct.toFixed(1)}%)`
        });
      }
    }

    return {
      zoneId,
      zoneLabel,
      bodyCircumferenceCm: Number(bodyCirc.toFixed(2)),
      drapedCircumferenceCm,
      actualEaseCm,
      targetEaseCm: Number(targetEaseCm.toFixed(2)),
      easeDeltaCm,
      meanWarpStrainPct: Number(meanWarpStrain.toFixed(3)),
      meanWeftStrainPct: Number(meanWeftStrain.toFixed(3)),
      maxStrainPct: Number(maxStrainPct.toFixed(3)),
      meanContactPressureKpa: Number(meanPressure.toFixed(3)),
      maxContactPressureKpa: Number(maxPressure.toFixed(3)),
      status,
      diagnosis
    };
  };

  if (isBodice) {
    regionalZones.shoulder = evaluateSliceZone('shoulder', 'Shoulder Bridge', 'shoulder', 1.5);
    regionalZones.bust = evaluateSliceZone('bust', 'Bust / Chest Line', 'bust', targetBustEase, 'bustEaseDeltaCm');
    regionalZones.scye_armhole = evaluateSliceZone('scye_armhole', 'Armscye & Scye Depth', 'scye', 3.0, 'sleeveEaseStrategy');
    regionalZones.waist = evaluateSliceZone('waist', 'Bodice Waistline', 'waist', targetWaistEase, 'waistEaseDeltaCm');

    // Evaluate sleeve biceps zone from sleeve mesh
    const upperSleeve = sleeveVertices.filter(v => v.v >= 0.15 && v.v <= 0.50);
    const effSleeve = upperSleeve.length > 0 ? upperSleeve : sleeveVertices;
    const bicepsBody = measurements.bicepsCircumference ?? 29.5;
    const meanSleeveClr = mean(effSleeve.map(v => Math.max(0, v.bodyClearanceCm)));
    const bicepsEase = effSleeve.length > 0 ? Number((2 * Math.PI * Math.max(0, meanSleeveClr - 0.08)).toFixed(2)) : targetBicepsEase;
    const bicepsDelta = Number((bicepsEase - targetBicepsEase).toFixed(2));
    const maxSlvStrain = effSleeve.length > 0 ? maxAbs(effSleeve.map(v => v.vonMisesStrainPct)) : 0;
    const slvStatus: ZoneFitStatus =
      maxSlvStrain > 12 || bicepsEase < -0.4
        ? 'FAIL_STRUCTURAL'
        : Math.abs(bicepsDelta) > 1.35 || maxSlvStrain > 6.5
        ? 'MARGINAL_ADJUSTABLE'
        : 'PASS';

    regionalZones.biceps_sleeve = {
      zoneId: 'biceps_sleeve',
      zoneLabel: 'Upper Arm / Biceps Sleeve',
      bodyCircumferenceCm: Number(bicepsBody.toFixed(2)),
      drapedCircumferenceCm: Number((bicepsBody + bicepsEase).toFixed(2)),
      actualEaseCm: bicepsEase,
      targetEaseCm: targetBicepsEase,
      easeDeltaCm: bicepsDelta,
      meanWarpStrainPct: Number(mean(effSleeve.map(v => v.warpStrainPct)).toFixed(3)),
      meanWeftStrainPct: Number(mean(effSleeve.map(v => v.weftStrainPct)).toFixed(3)),
      maxStrainPct: Number(maxSlvStrain.toFixed(3)),
      meanContactPressureKpa: Number(mean(effSleeve.map(v => v.contactPressureKpa)).toFixed(3)),
      maxContactPressureKpa: Number(maxAbs(effSleeve.map(v => v.contactPressureKpa)).toFixed(3)),
      status: slvStatus,
      diagnosis:
        slvStatus === 'PASS'
          ? `Sleeve upper arm ease ${bicepsEase.toFixed(2)} cm balances arm mobility.`
          : `Sleeve upper arm ease delta ${bicepsDelta > 0 ? '+' : ''}${bicepsDelta.toFixed(2)} cm (peak strain ${maxSlvStrain.toFixed(1)}%).`
    };
  } else {
    regionalZones.waist = evaluateSliceZone('waist', 'Skirt Waistband Line', 'waist', targetWaistEase, 'waistEaseDeltaCm');
    regionalZones.high_hip = evaluateSliceZone('high_hip', 'High Hip Contour', 'high_hip', targetHipEase * 0.75);
    regionalZones.low_hip = evaluateSliceZone('low_hip', 'Full Low Hip Line', 'low_hip', targetHipEase, 'hipEaseDeltaCm');
    const hemExtra = designSpec.silhouette === 'a-line' ? 6.5 : designSpec.silhouette === 'flared' ? 11.0 : designSpec.silhouette === 'pencil' ? -2.0 : 2.5;
    regionalZones.hem = evaluateSliceZone('hem', 'Skirt Hem Sweep', 'hem', Math.max(1.5, targetHipEase + hemExtra));
  }

  // Hem level deviation & grainline plumb tilt along true bottom seam (hem for skirt, waist for bodice)
  const bottomRole = isBodice ? 'waist' : 'hem';
  const roleHemVerts = torsoVertices.filter(v => v.isBoundary && v.seamRole === bottomRole);
  const hemVerts = roleHemVerts.length >= 4 ? roleHemVerts : torsoVertices.filter(v => v.v >= 0.97);
  const hemYVals = hemVerts.map(v => v.y);
  const hemLevelDeviationCm =
    hemYVals.length >= 2 ? Number((Math.max(...hemYVals) - Math.min(...hemYVals)).toFixed(3)) : 0;

  const frontCenterTop = torsoVertices.filter(v => v.pieceId.includes('front') && v.v <= 0.15 && Math.abs(v.x) < 4);
  const frontCenterBot = torsoVertices.filter(v => v.pieceId.includes('front') && v.v >= 0.85 && Math.abs(v.x) < 4);
  let grainlinePlumbDeviationDeg = 0;
  if (frontCenterTop.length > 0 && frontCenterBot.length > 0) {
    const topX = mean(frontCenterTop.map(v => v.x));
    const topY = mean(frontCenterTop.map(v => v.y));
    const botX = mean(frontCenterBot.map(v => v.x));
    const botY = mean(frontCenterBot.map(v => v.y));
    const dy = Math.max(1.0, Math.abs(topY - botY));
    grainlinePlumbDeviationDeg = Number(((Math.atan2(Math.abs(botX - topX), dy) * 180) / Math.PI).toFixed(3));
  }

  // Overall status is strictly worst-zone status (no compensatory averaging / scalar score!)
  const zoneStatuses = evaluatedZoneOrder.map(z => regionalZones[z].status);
  const overallFitStatus: ZoneFitStatus = zoneStatuses.includes('FAIL_STRUCTURAL')
    ? 'FAIL_STRUCTURAL'
    : zoneStatuses.includes('MARGINAL_ADJUSTABLE')
    ? 'MARGINAL_ADJUSTABLE'
    : 'PASS';

  return {
    fitReportId: `fit-${simulation.simulationId}`,
    simulationId: simulation.simulationId,
    avatarId: avatar.avatarId,
    avatarSourceType: avatar.sourceType,
    poseId: avatar.poseId,
    overallFitStatus,
    regionalZones,
    evaluatedZoneOrder,
    hemLevelDeviationCm,
    grainlinePlumbDeviationDeg,
    pullLineVectors,
    actionableFindings,
    documentedAssumptions,
    measurementUncertaintyNote,
    prohibitsUniversalScalarScore: true,
    physicalValidationRequired: true,
    disclaimer:
      'Quantitative regional fit report over ESTIMATED_PARAMETRIC_M02C avatar. AC-08 simulation is diagnostic only and never replaces physical sample approval (AC-09).',
    isProductionReady: false
  };
}

function buildFailedZoneMetrics(zoneId: FitZoneID, reason: string): ZoneFitMetrics {
  return {
    zoneId,
    zoneLabel: zoneId,
    bodyCircumferenceCm: 0,
    drapedCircumferenceCm: 0,
    actualEaseCm: 0,
    targetEaseCm: 0,
    easeDeltaCm: 0,
    meanWarpStrainPct: 0,
    meanWeftStrainPct: 0,
    maxStrainPct: 0,
    meanContactPressureKpa: 0,
    maxContactPressureKpa: 0,
    status: 'FAIL_STRUCTURAL',
    diagnosis: reason
  };
}

function nearestVerticesByY(vertices: MeshVertex3D[], yTarget: number, count: number): MeshVertex3D[] {
  return [...vertices]
    .sort((a, b) => Math.abs(a.y - yTarget) - Math.abs(b.y - yTarget))
    .slice(0, count);
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function maxAbs(vals: number[]): number {
  if (vals.length === 0) return 0;
  return Math.max(...vals.map(v => Math.abs(v)));
}

function normalizePull(x: number, y: number, z: number) {
  const len = Math.max(1e-6, Math.hypot(x, y, z));
  return { x: Number((x / len).toFixed(4)), y: Number((y / len).toFixed(4)), z: Number((z / len).toFixed(4)) };
}
