/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements } from '../../types';
import {
  AnatomicalPlaneID,
  AvatarBodyRepresentation,
  AvatarPoseId,
  AvatarSourceType,
  ClosedContour3D,
  LandmarkID,
  Point3D
} from './simulation-types';

/**
 * Generates an anatomical parametric 3D avatar from 1D tape BodyMeasurements (M02c).
 *
 * GOVERNANCE & EPISTEMIC INTEGRITY (REQ-BODY-01 / Dossier 11):
 * - Strictly labels `sourceType: 'ESTIMATED_PARAMETRIC_M02C'`.
 * - NEVER emits `'MEASURED_3D_SCAN'` for parametrically synthesized geometry.
 */
export function generateParametricAvatar(
  measurements: BodyMeasurements,
  poseId: AvatarPoseId = 'CANONICAL_A_POSE'
): AvatarBodyRepresentation {
  const heightCm = measurements.height ?? 168;
  const bustCm = measurements.bust ?? measurements.waist + 20;
  const waistCm = measurements.waist;
  const highHipCm = measurements.highHip ?? waistCm + 12;
  const lowHipCm = measurements.lowHip;
  const neckCm = measurements.neckCircumference ?? 36.5;
  const acrossBackCm = measurements.acrossBack ?? 36.0;
  const shoulderLenCm = measurements.shoulderLength ?? 12.5;
  const backWaistLengthCm = measurements.backWaistLength ?? 41.0;
  const armholeDepthCm = measurements.armholeDepth ?? 21.5;
  const waistToHipCm = measurements.waistToHip ?? 20.5;
  const skirtLengthCm = measurements.skirtLength ?? 65.0;

  // Vertical datum: y = 0 at waist plane, +y upward toward nape, -y downward toward hem
  const yWaist = 0;
  const yNape = backWaistLengthCm;
  const yShoulder = backWaistLengthCm - 3.8;
  const yScye = backWaistLengthCm - armholeDepthCm;
  const yBust = Math.max(yScye - 2.0, backWaistLengthCm * 0.42);
  const yHighHip = -(waistToHipCm * 0.48);
  const yLowHip = -waistToHipCm;
  const yHem = -Math.max(skirtLengthCm, waistToHipCm + 8);

  const shoulderWidthCm = Math.max(acrossBackCm + 2.0, neckCm * 0.42 + shoulderLenCm * 1.85);
  const crossSections: Record<AnatomicalPlaneID, ClosedContour3D> = {
    neck: buildEllipticalPlane('neck', yNape, neckCm, 0.62, 0.0, 24),
    shoulder: buildEllipticalPlane('shoulder', yShoulder, shoulderWidthCm * 2.05, 0.26, -0.2, 32),
    scye: buildEllipticalPlane('scye', yScye, bustCm * 0.96, 0.62, 0.4, 36),
    bust: buildEllipticalPlane('bust', yBust, bustCm, 0.72, 1.35, 36),
    waist: buildEllipticalPlane('waist', yWaist, waistCm, 0.68, 0.35, 36),
    high_hip: buildEllipticalPlane('high_hip', yHighHip, highHipCm, 0.70, -0.1, 36),
    low_hip: buildEllipticalPlane('low_hip', yLowHip, lowHipCm, 0.72, -0.6, 36),
    hem: buildEllipticalPlane('hem', yHem, lowHipCm * 0.96, 0.75, -0.5, 36)
  };

  // Pose-dependent shoulder/elbow/wrist kinematics (Dossier 11)
  const shoulderX = crossSections.shoulder.semiWidthXCm * 0.92;
  const armToElbow = measurements.armLengthToElbow ?? 33.5;
  const sleeveLen = measurements.sleeveLength ?? 59.5;
  const lowerArmLen = Math.max(20, sleeveLen - armToElbow);

  const armAngleOutRad =
    poseId === 'CANONICAL_A_POSE'
      ? (18 * Math.PI) / 180
      : poseId === 'ARM_FORWARD_45'
      ? (14 * Math.PI) / 180
      : (12 * Math.PI) / 180;

  const armForwardRad =
    poseId === 'ARM_FORWARD_45'
      ? (45 * Math.PI) / 180
      : poseId === 'SEATED_90'
      ? (25 * Math.PI) / 180
      : (4 * Math.PI) / 180;

  const rightShoulder: Point3D = { x: shoulderX, y: yShoulder - 1.2, z: -0.3 };
  const rightElbow: Point3D = {
    x: rightShoulder.x + Math.sin(armAngleOutRad) * armToElbow,
    y: rightShoulder.y - Math.cos(armAngleOutRad) * Math.cos(armForwardRad) * armToElbow,
    z: rightShoulder.z + Math.sin(armForwardRad) * armToElbow
  };
  const rightWrist: Point3D = {
    x: rightElbow.x + Math.sin(armAngleOutRad * 0.8) * lowerArmLen,
    y: rightElbow.y - Math.cos(armAngleOutRad * 0.8) * Math.cos(armForwardRad * 1.1) * lowerArmLen,
    z: rightElbow.z + Math.sin(armForwardRad * 1.1) * lowerArmLen
  };

  const leftShoulder: Point3D = { x: -shoulderX, y: yShoulder - 1.2, z: -0.3 };
  const leftElbow: Point3D = {
    x: -rightElbow.x,
    y: rightElbow.y,
    z: rightElbow.z
  };
  const leftWrist: Point3D = {
    x: -rightWrist.x,
    y: rightWrist.y,
    z: rightWrist.z
  };

  const bustSpanHalf = (measurements.bustSpan ?? 18.5) / 2;
  const landmarks: Record<LandmarkID, Point3D> = {
    NAPE_C7: { x: 0, y: yNape, z: -crossSections.neck.semiDepthZCm },
    FRONT_NECK_PIT: { x: 0, y: yNape - 3.2, z: crossSections.neck.semiDepthZCm },
    LEFT_ACROMION: leftShoulder,
    RIGHT_ACROMION: rightShoulder,
    BUST_APEX_LEFT: { x: -bustSpanHalf, y: yBust, z: crossSections.bust.semiDepthZCm + 0.9 },
    BUST_APEX_RIGHT: { x: bustSpanHalf, y: yBust, z: crossSections.bust.semiDepthZCm + 0.9 },
    SCYE_LEVEL_CENTER: { x: 0, y: yScye, z: 0 },
    CENTER_WAIST_FRONT: { x: 0, y: yWaist, z: crossSections.waist.semiDepthZCm + crossSections.waist.centerZOffsetCm },
    CENTER_WAIST_BACK: { x: 0, y: yWaist, z: -crossSections.waist.semiDepthZCm + crossSections.waist.centerZOffsetCm },
    HIGH_HIP_CENTER: { x: 0, y: yHighHip, z: crossSections.high_hip.centerZOffsetCm },
    LOW_HIP_MAX: { x: 0, y: yLowHip, z: -crossSections.low_hip.semiDepthZCm + crossSections.low_hip.centerZOffsetCm },
    LEFT_ELBOW: leftElbow,
    LEFT_WRIST: leftWrist,
    RIGHT_ELBOW: rightElbow,
    RIGHT_WRIST: rightWrist
  };

  const bicepsCircumference = measurements.bicepsCircumference ?? 29.5;
  const elbowCircumference = measurements.elbowCircumference ?? 25.5;
  const wristCircumference = measurements.wristCircumference ?? 16.5;

  const fingerprintSeed = [
    Math.round(bustCm * 10),
    Math.round(waistCm * 10),
    Math.round(lowHipCm * 10),
    Math.round(heightCm * 10),
    poseId
  ].join('-');

  return {
    avatarId: `avatar-param-m02c-${fingerprintSeed}`,
    sourceType: 'ESTIMATED_PARAMETRIC_M02C',
    poseId,
    provenanceLabel: 'Estimated Parametric Surface (M02c Tape Measurements)',
    provenanceStatement:
      'Parametric elliptical cross-section torso & arm envelope reconstructed from 1D tape measurements. Not a measured 3D optical body scan.',
    heightCm,
    landmarks,
    crossSectionContours: crossSections,
    armAxis: {
      shoulderPivot: rightShoulder,
      elbowJoint: rightElbow,
      wristJoint: rightWrist,
      bicepsRadiusCm: bicepsCircumference / (2 * Math.PI),
      elbowRadiusCm: elbowCircumference / (2 * Math.PI),
      wristRadiusCm: wristCircumference / (2 * Math.PI)
    },
    measurementUncertaintyCm: {
      bustCircumference: 1.0,
      waistCircumference: 0.8,
      lowHipCircumference: 1.0,
      armscyeDepth: 0.7,
      shoulderSlope: 1.2,
      crossSectionEccentricity: 1.5
    }
  };
}

/**
 * Enforces REQ-BODY-01 semantic boundary: parametric avatars cannot masquerade as MEASURED_3D_SCAN.
 */
export function validateAvatarProvenance(
  avatar: AvatarBodyRepresentation,
  claimedScanCertificateId?: string
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (avatar.sourceType === 'MEASURED_3D_SCAN') {
    if (!claimedScanCertificateId || claimedScanCertificateId.trim().length < 6) {
      errors.push('MEASURED_3D_SCAN provenance rejected: missing verified 3D scan calibration certificate.');
    }
    if (avatar.avatarId.startsWith('avatar-param-m02c-')) {
      errors.push('Semantic provenance violation: M02c parametric avatar cannot be labeled MEASURED_3D_SCAN.');
    }
  } else if (avatar.sourceType !== 'ESTIMATED_PARAMETRIC_M02C') {
    errors.push(`Unsupported avatar sourceType '${String(avatar.sourceType)}'.`);
  }
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Computes closed elliptical contour given target circumference using Ramanujan inverse approximation.
 */
function buildEllipticalPlane(
  planeId: AnatomicalPlaneID,
  yHeightCm: number,
  targetCircumferenceCm: number,
  depthToWidthRatio: number,
  centerZOffsetCm: number,
  segments: number
): ClosedContour3D {
  const safeCirc = Math.max(12, targetCircumferenceCm);
  // Find semi-axis a given b = ratio * a such that ellipse perimeter = safeCirc
  // Using Ramanujan approximation: C ≈ pi * (a + b) * (1 + 3h / (10 + sqrt(4 - 3h)))
  const r = Math.max(0.25, Math.min(1.0, depthToWidthRatio));
  const h = Math.pow(1 - r, 2) / Math.pow(1 + r, 2);
  const unitPerimeterFactor = Math.PI * (1 + r) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const semiWidthXCm = safeCirc / unitPerimeterFactor;
  const semiDepthZCm = semiWidthXCm * r;

  const points: Point3D[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    points.push({
      x: Number((semiWidthXCm * Math.cos(theta)).toFixed(4)),
      y: Number(yHeightCm.toFixed(4)),
      z: Number((semiDepthZCm * Math.sin(theta) + centerZOffsetCm).toFixed(4))
    });
  }

  return {
    planeId,
    yHeightCm,
    circumferenceCm: safeCirc,
    semiWidthXCm,
    semiDepthZCm,
    centerZOffsetCm,
    points
  };
}

const ORDERED_PLANES: AnatomicalPlaneID[] = [
  'hem',
  'low_hip',
  'high_hip',
  'waist',
  'bust',
  'scye',
  'shoulder',
  'neck'
];

/**
 * Evaluates smooth interpolated elliptical torso semi-axes at arbitrary vertical height yCm.
 */
export function sampleTorsoEllipseAtY(
  avatar: AvatarBodyRepresentation,
  yCm: number
): { semiWidthXCm: number; semiDepthZCm: number; centerZOffsetCm: number; circumferenceCm: number } {
  const planes = ORDERED_PLANES.map(id => avatar.crossSectionContours[id]);
  if (yCm <= planes[0].yHeightCm) {
    const p = planes[0];
    return {
      semiWidthXCm: p.semiWidthXCm,
      semiDepthZCm: p.semiDepthZCm,
      centerZOffsetCm: p.centerZOffsetCm,
      circumferenceCm: p.circumferenceCm
    };
  }
  const last = planes[planes.length - 1];
  if (yCm >= last.yHeightCm) {
    return {
      semiWidthXCm: last.semiWidthXCm,
      semiDepthZCm: last.semiDepthZCm,
      centerZOffsetCm: last.centerZOffsetCm,
      circumferenceCm: last.circumferenceCm
    };
  }

  for (let i = 0; i < planes.length - 1; i++) {
    const p0 = planes[i];
    const p1 = planes[i + 1];
    if (yCm >= p0.yHeightCm && yCm <= p1.yHeightCm) {
      const span = Math.max(1e-6, p1.yHeightCm - p0.yHeightCm);
      const t = (yCm - p0.yHeightCm) / span;
      // Smooth Hermite C1 blend to avoid artificial horizontal creases
      const s = t * t * (3 - 2 * t);
      return {
        semiWidthXCm: p0.semiWidthXCm + (p1.semiWidthXCm - p0.semiWidthXCm) * s,
        semiDepthZCm: p0.semiDepthZCm + (p1.semiDepthZCm - p0.semiDepthZCm) * s,
        centerZOffsetCm: p0.centerZOffsetCm + (p1.centerZOffsetCm - p0.centerZOffsetCm) * s,
        circumferenceCm: p0.circumferenceCm + (p1.circumferenceCm - p0.circumferenceCm) * s
      };
    }
  }

  return {
    semiWidthXCm: last.semiWidthXCm,
    semiDepthZCm: last.semiDepthZCm,
    centerZOffsetCm: last.centerZOffsetCm,
    circumferenceCm: last.circumferenceCm
  };
}

/**
 * Signed radial clearance from a point (x, y, z) to the parametric torso SDF surface.
 * Positive => strictly outside body surface; Negative => penetrating inside body.
 */
export function evaluateTorsoSurfaceClearance(
  avatar: AvatarBodyRepresentation,
  x: number,
  y: number,
  z: number
): {
  clearanceCm: number;
  normal: Point3D;
  surfacePoint: Point3D;
} {
  const neck = avatar.crossSectionContours.neck;
  const shoulder = avatar.crossSectionContours.shoulder;
  const absX = Math.abs(x);

  // Above shoulder-armscye height and outside neck column: cloth drapes over top of shoulder ridge (+y support)
  if (y >= shoulder.yHeightCm - 1.2 && absX >= neck.semiWidthXCm * 0.85 && absX <= shoulder.semiWidthXCm + 2.5 && Math.abs(z) <= shoulder.semiDepthZCm + 1.5) {
    const tSh = Math.max(
      0,
      Math.min(1, (absX - neck.semiWidthXCm * 0.9) / Math.max(2, shoulder.semiWidthXCm - neck.semiWidthXCm * 0.9))
    );
    const ridgeY = neck.yHeightCm - 0.5 - tSh * (neck.yHeightCm - shoulder.yHeightCm);
    const crownProfileY = ridgeY - Math.min(2.2, 0.08 * z * z);
    return {
      clearanceCm: y - crownProfileY,
      normal: { x: 0, y: 1, z: 0 },
      surfacePoint: { x, y: crownProfileY, z }
    };
  }

  const e = sampleTorsoEllipseAtY(avatar, y);
  const dz = z - e.centerZOffsetCm;
  const nxNorm = x / Math.max(1e-4, e.semiWidthXCm);
  const nzNorm = dz / Math.max(1e-4, e.semiDepthZCm);
  const rho = Math.hypot(nxNorm, nzNorm);

  if (rho < 1e-8) {
    return {
      clearanceCm: -Math.min(e.semiWidthXCm, e.semiDepthZCm),
      normal: { x: 0, y: 0, z: 1 },
      surfacePoint: { x: 0, y, z: e.centerZOffsetCm + e.semiDepthZCm }
    };
  }

  const surfX = x / rho;
  const surfZ = e.centerZOffsetCm + dz / rho;
  const gradX = nxNorm / Math.max(1e-4, e.semiWidthXCm);
  const gradZ = nzNorm / Math.max(1e-4, e.semiDepthZCm);
  const gradLen = Math.max(1e-8, Math.hypot(gradX, gradZ));
  const normalX = gradX / gradLen;
  const normalZ = gradZ / gradLen;

  const dxSurf = x - surfX;
  const dzSurf = z - surfZ;
  const dist = Math.hypot(dxSurf, dzSurf);
  const clearanceCm = rho >= 1 ? dist : -dist;

  return {
    clearanceCm,
    normal: { x: normalX, y: 0, z: normalZ },
    surfacePoint: { x: surfX, y, z: surfZ }
  };
}

export function buildAvatarSourceSafetyGuard(sourceType: AvatarSourceType): string {
  return sourceType === 'ESTIMATED_PARAMETRIC_M02C'
    ? 'ESTIMATED PARAMETRIC AVATAR (M02c) — NO 3D SCAN GEOMETRY'
    : 'MEASURED 3D BODY SCAN';
}
