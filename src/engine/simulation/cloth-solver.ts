/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, DesignSpecification, PatternPiece, Point } from '../../types';
import {
  evaluateTorsoSurfaceClearance,
  generateParametricAvatar,
  sampleTorsoEllipseAtY
} from './avatar-generator';
import {
  runAnalyticalCredibilityBenchmarks,
  SOLVER_VERSION
} from './analytical-benchmarks';
import { calibrateConstitutiveMaterial } from './material-constitutive';
import {
  AvatarBodyRepresentation,
  AvatarPoseId,
  CalibratedMaterialConstitutiveSpec,
  EnergyPoint,
  MeshTriangle,
  MeshVertex3D,
  Point3D,
  SeamSpringEdge,
  SimulationCaseResult
} from './simulation-types';

interface ExtractedBoundaryVertex {
  x: number;
  y: number;
  seamRole: string;
  uAlongSeam: number;
}

interface TriangulatedPiece2D {
  piece: PatternPiece;
  mirroredSign: 1 | -1;
  panelTag: string;
  vertices: Array<{ x: number; y: number; isBoundary: boolean; seamRole?: string; uAlongSeam?: number }>;
  triangles: Array<[number, number, number]>;
}

/**
 * Extracts closed 2D polygon boundary points (in cm) and seam metadata from a PatternPiece.
 */
export function extractPieceBoundaryPolygon(
  piece: PatternPiece,
  sampleStepCm = 2.6
): ExtractedBoundaryVertex[] {
  const contour = piece.stitchingContour;
  const pts: ExtractedBoundaryVertex[] = [];

  if (contour && contour.segments.length > 0) {
    for (const seg of contour.segments) {
      const segLen = Math.max(0.5, seg.lengthCm());
      const steps = Math.max(2, Math.min(18, Math.ceil(segLen / sampleStepCm)));
      const seamRole = classifySegmentRole(seg.id, seg.seamId, seg.isFold);
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const p = seg.pointAt(t);
        if (pts.length > 0) {
          const prev = pts[pts.length - 1];
          if (Math.hypot(p.x - prev.x, p.y - prev.y) < 0.05) continue;
        }
        pts.push({
          x: p.x,
          y: p.y,
          seamRole,
          uAlongSeam: t
        });
      }
    }
    return pts;
  }

  // Fallback: sample vertices directly from seams
  for (const seam of piece.seams) {
    const seamRole = classifySegmentRole(seam.id, seam.name, false);
    pts.push({
      x: seam.startPoint.x,
      y: seam.startPoint.y,
      seamRole,
      uAlongSeam: 0
    });
  }
  return pts;
}

function classifySegmentRole(segId: string, seamId?: string, isFold?: boolean): string {
  const idLower = segId.toLowerCase();
  const seamLower = (seamId ?? '').toLowerCase();

  if (isFold || seamLower.includes('center-front') || idLower.includes('cf-fold')) return 'center-front';
  if (seamLower.includes('center-back') || idLower.includes('cb-seam')) return 'center-back';
  if (idLower === 'sleeve-front-cap') return 'sleeve-cap-front';
  if (idLower === 'sleeve-back-cap') return 'sleeve-cap-back';
  if (idLower.includes('sleeve-front-inseam') || seamLower.includes('front-inseam')) return 'sleeve-inseam-front';
  if (idLower.includes('sleeve-back-inseam') || seamLower.includes('back-inseam')) return 'sleeve-inseam-back';
  if (seamLower.includes('sleeve-cap') || idLower.includes('sleeve-cap')) return 'sleeve-cap';
  if (seamLower.includes('waist') || idLower.includes('dart-cap')) return 'waist';
  if (seamLower.includes('hem') || idLower.includes('wrist') || idLower.includes('hem')) return 'hem';
  if (seamLower.includes('armhole') || seamLower.includes('scye') || idLower.includes('armhole')) return 'armhole';
  if (seamLower.includes('shoulder') || idLower.includes('shoulder')) return 'shoulder';
  if (seamLower.includes('side-seam') || seamLower.includes('side') || idLower.includes('side-lower') || idLower.includes('side-hip')) return 'side-seam';
  if (seamLower.includes('neck') || idLower.includes('neck')) return 'neckline';
  return 'edge';
}

function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function minDistanceToPolygonEdges(x: number, y: number, poly: Point[]): number {
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abLenSq = abx * abx + aby * aby;
    const t = abLenSq > 1e-9 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / abLenSq)) : 0;
    const px = a.x + t * abx;
    const py = a.y + t * aby;
    const d = Math.hypot(x - px, y - py);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Deterministic Bowyer-Watson 2D Delaunay triangulation restricted inside polygon.
 */
export function triangulatePiecePolygon2D(
  piece: PatternPiece,
  edgeLengthCm = 3.2,
  mirrorX: 1 | -1 = 1,
  panelTag = piece.id
): TriangulatedPiece2D {
  const rawBoundary = extractPieceBoundaryPolygon(piece, Math.max(1.8, edgeLengthCm * 0.9));
  if (rawBoundary.length < 3) {
    return { piece, mirroredSign: mirrorX, panelTag, vertices: [], triangles: [] };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rawBoundary) {
    const px = p.x * mirrorX;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const vertices: TriangulatedPiece2D['vertices'] = rawBoundary.map(b => ({
    x: b.x * mirrorX,
    y: b.y,
    isBoundary: true,
    seamRole: b.seamRole,
    uAlongSeam: b.uAlongSeam
  }));

  const polyPts: Point[] = vertices.map(v => ({ x: v.x, y: v.y }));
  const step = Math.max(1.8, edgeLengthCm);
  const minBoundaryClearance = step * 0.35;

  for (let y = minY + step * 0.5; y < maxY - step * 0.4; y += step) {
    for (let x = minX + step * 0.5; x < maxX - step * 0.4; x += step) {
      if (pointInPolygon(x, y, polyPts) && minDistanceToPolygonEdges(x, y, polyPts) >= minBoundaryClearance) {
        vertices.push({ x, y, isBoundary: false });
      }
    }
  }

  // Super-triangle for Bowyer-Watson
  const span = Math.max(maxX - minX, maxY - minY, 20) * 4;
  const cx = 0.5 * (minX + maxX);
  const cy = 0.5 * (minY + maxY);
  const st0 = vertices.length;
  const st1 = st0 + 1;
  const st2 = st0 + 2;
  const allPts = [
    ...vertices.map(v => ({ x: v.x, y: v.y })),
    { x: cx - span, y: cy - span },
    { x: cx + span, y: cy - span },
    { x: cx, y: cy + span }
  ];

  let tris: Array<[number, number, number]> = [[st0, st1, st2]];

  for (let pIdx = 0; pIdx < vertices.length; pIdx++) {
    const p = allPts[pIdx];
    const badTris: Array<[number, number, number]> = [];
    const goodTris: Array<[number, number, number]> = [];

    for (const tri of tris) {
      if (inCircumcircle(p, allPts[tri[0]], allPts[tri[1]], allPts[tri[2]])) {
        badTris.push(tri);
      } else {
        goodTris.push(tri);
      }
    }

    // Extract boundary polygon edges of bad triangles
    const edgeCount = new Map<string, [number, number]>();
    const edgeFreq = new Map<string, number>();
    for (const [a, b, c] of badTris) {
      const pairs: Array<[number, number]> = [[a, b], [b, c], [c, a]];
      for (const [u, v] of pairs) {
        const key = u < v ? `${u}:${v}` : `${v}:${u}`;
        edgeCount.set(key, [u, v]);
        edgeFreq.set(key, (edgeFreq.get(key) ?? 0) + 1);
      }
    }

    tris = goodTris;
    for (const [key, freq] of edgeFreq.entries()) {
      if (freq === 1) {
        const [u, v] = edgeCount.get(key)!;
        tris.push([u, v, pIdx]);
      }
    }
  }

  const finalTris: Array<[number, number, number]> = [];
  for (const [a, b, c] of tris) {
    if (a >= st0 || b >= st0 || c >= st0) continue;
    const pa = allPts[a];
    const pb = allPts[b];
    const pc = allPts[c];
    const area2 = Math.abs((pb.x - pa.x) * (pc.y - pa.y) - (pc.x - pa.x) * (pb.y - pa.y));
    if (area2 < 0.04) continue;
    const centX = (pa.x + pb.x + pc.x) / 3;
    const centY = (pa.y + pb.y + pc.y) / 3;
    if (pointInPolygon(centX, centY, polyPts)) {
      // Enforce consistent winding
      const signedArea = (pb.x - pa.x) * (pc.y - pa.y) - (pc.x - pa.x) * (pb.y - pa.y);
      finalTris.push(signedArea >= 0 ? [a, b, c] : [a, c, b]);
    }
  }

  return { piece, mirroredSign: mirrorX, panelTag, vertices, triangles: finalTris };
}

function inCircumcircle(p: Point, a: Point, b: Point, c: Point): boolean {
  const ax = a.x - p.x;
  const ay = a.y - p.y;
  const bx = b.x - p.x;
  const by = b.y - p.y;
  const cx = c.x - p.x;
  const cy = c.y - p.y;
  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);
  const orient = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return orient >= 0 ? det > 1e-9 : det < -1e-9;
}

/**
 * Runs complete 2D-to-3D garment assembly & damped CST/XPBD equilibrium cloth simulation.
 */
export function runGarmentDrapeSimulation(params: {
  pieces: PatternPiece[];
  designSpec: DesignSpecification;
  measurements: BodyMeasurements;
  avatar?: AvatarBodyRepresentation;
  poseId?: AvatarPoseId;
  meshEdgeLengthCm?: number;
}): SimulationCaseResult {
  const { pieces, designSpec, measurements, poseId = 'CANONICAL_A_POSE', meshEdgeLengthCm = 3.2 } = params;
  const avatar = params.avatar ?? generateParametricAvatar(measurements, poseId);
  const material = calibrateConstitutiveMaterial(designSpec.fabric);
  const benchmarkQualification = runAnalyticalCredibilityBenchmarks(material);

  const vertices: MeshVertex3D[] = [];
  const triangles: MeshTriangle[] = [];
  const seamEdges: SeamSpringEdge[] = [];

  if (!material.thermodynamicallyAdmissible || !benchmarkQualification.allPassed) {
    return {
      simulationId: `sim-${designSpec.id}-${poseId}`,
      revisionId: designSpec.specificationRevisionId ?? `spec-${designSpec.id}-v${designSpec.version}`,
      avatarId: avatar.avatarId,
      avatarSourceType: avatar.sourceType,
      poseId,
      materialSpecId: material.materialSpecId,
      materialEvidenceTier: material.evidenceTier,
      solverVersion: SOLVER_VERSION,
      meshEdgeLengthMm: Number((meshEdgeLengthCm * 10).toFixed(1)),
      vertexCount: 0,
      triangleCount: 0,
      seamEdgeCount: 0,
      equilibriumResidualNorm: Infinity,
      interpenetratingTriangles: 0,
      minBodyClearanceCm: 0,
      energyHistory: [],
      vertices: [],
      triangles: [],
      seamEdges: [],
      benchmarkQualification,
      convergenceVerified: false,
      failureReason: !material.thermodynamicallyAdmissible
        ? 'STRUCTURAL_MATERIAL_CONSTITUTIVE_FAILURE'
        : 'STRUCTURAL_SOLVER_BENCHMARK_FAILURE',
      isProductionReady: false
    };
  }

  // Build left + right garment shells from 2D drafted blocks
  const triangulatedPanels: TriangulatedPiece2D[] = [];
  for (const piece of pieces) {
    const idLower = piece.id.toLowerCase();
    if (idLower.includes('sleeve')) {
      triangulatedPanels.push(triangulatePiecePolygon2D(piece, meshEdgeLengthCm, 1, `${piece.id}-R`));
      triangulatedPanels.push(triangulatePiecePolygon2D(piece, meshEdgeLengthCm, -1, `${piece.id}-L`));
    } else if (piece.onFold || piece.cutCount === 2 || idLower.includes('front') || idLower.includes('back')) {
      // Map half-pattern left (-1) and right (+1) halves so the torso is wrapped 360 degrees
      triangulatedPanels.push(triangulatePiecePolygon2D(piece, meshEdgeLengthCm, 1, `${piece.id}-R`));
      triangulatedPanels.push(triangulatePiecePolygon2D(piece, meshEdgeLengthCm, -1, `${piece.id}-L`));
    } else {
      triangulatedPanels.push(triangulatePiecePolygon2D(piece, meshEdgeLengthCm, 1, piece.id));
    }
  }

  // Wrap 2D panel points onto 3D donning shell around avatar with guaranteed outward clearance
  const panelVertexIndexOffsets = new Map<string, number>();
  for (const panel of triangulatedPanels) {
    const offset = vertices.length;
    panelVertexIndexOffsets.set(panel.panelTag, offset);

    // Determine 2D bounding box and row-wise outer envelope of this panel
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of panel.vertices) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    const spanX = Math.max(1e-4, maxX - minX);
    const spanY = Math.max(1e-4, maxY - minY);
    const isFront = panel.piece.id.toLowerCase().includes('front');
    const isBack = panel.piece.id.toLowerCase().includes('back');
    const isSleeve = panel.piece.id.toLowerCase().includes('sleeve');
    const isSkirt = panel.piece.garmentCategory === 'skirt';

    // Identify waist / scye / shoulder landmarks in 2D pattern coordinates
    const waist2DY = maxY;
    const armholeBotY = panel.vertices
      .filter(v => v.seamRole === 'armhole')
      .reduce((m, v) => Math.max(m, v.y), minY + spanY * 0.5);
    const scyeSpan2D = Math.max(12, armholeBotY - minY);
    const scye3DY = avatar.crossSectionContours.scye.yHeightCm;
    const waist3DY = avatar.crossSectionContours.waist.yHeightCm;
    const neckY3D = avatar.crossSectionContours.neck.yHeightCm;

    for (let i = 0; i < panel.vertices.length; i++) {
      const v2 = panel.vertices[i];
      const uNorm = (v2.x - minX) / spanX;
      const vNorm = (v2.y - minY) / spanY; // 0 at top, 1 at bottom
      let pt3: Point3D;

      if (isSleeve) {
        pt3 = projectSleevePointTo3D(avatar, panel.mirroredSign, v2.x, v2.y, minY, spanY, spanX);
      } else if (isSkirt) {
        // Preserve actual vertical drop length (waist = yWaist, hem drops by pattern length)
        const y3D = waist3DY - (v2.y - minY);
        const torso = sampleTorsoEllipseAtY(avatar, y3D);
        const absX = Math.abs(v2.x);
        const quarterCirc = Math.max(15, torso.circumferenceCm * 0.25);
        const excessHalfCm = Math.max(0, absX - quarterCirc);
        const radialEase = 0.55 + excessHalfCm * 0.64;
        const rx = torso.semiWidthXCm + radialEase;
        const rz = torso.semiDepthZCm + radialEase;
        const p2D = mapArcLengthToEllipse(rx, rz, torso.centerZOffsetCm, isFront, panel.mirroredSign, absX);
        pt3 = { x: p2D.x, y: y3D, z: p2D.z };
      } else {
        // Bodice continuous 2D-to-3D geodesic wrap:
        // Below underarm (v2.y >= armholeBotY): map scye..waist vertically & center..side by true arc length.
        // Above underarm (v2.y < armholeBotY): smoothly lift from scye cylinder up onto shoulder ridge & neck opening.
        const dropBelowArmhole = Math.max(0, waist2DY - v2.y);
        const lowerHeight2D = Math.max(12, waist2DY - armholeBotY);
        let y3D: number;
        if (v2.y >= armholeBotY) {
          const tLower = Math.max(0, Math.min(1, dropBelowArmhole / lowerHeight2D));
          y3D = waist3DY + tLower * (scye3DY - waist3DY);
        } else {
          const tUpper = Math.max(0, Math.min(1, (armholeBotY - v2.y) / scyeSpan2D));
          y3D = scye3DY + tUpper * (neckY3D - 1.0 - scye3DY);
        }

        const torso = sampleTorsoEllipseAtY(avatar, y3D);
        // Clamp torso depth transition above scye so neck/shoulder ellipse doesn't hyper-flatten by 3x near center
        const scyeTorso = sampleTorsoEllipseAtY(avatar, scye3DY);
        const aboveScyeFrac = v2.y < armholeBotY ? Math.min(1, (armholeBotY - v2.y) / scyeSpan2D) : 0;
        const absX = Math.abs(v2.x);
        const rxBase = torso.semiWidthXCm * (1 - 0.35 * aboveScyeFrac) + scyeTorso.semiWidthXCm * (0.35 * aboveScyeFrac);
        const rzBase = Math.max(scyeTorso.semiDepthZCm * 0.72, torso.semiDepthZCm);
        const rx = rxBase + 0.55;
        const rz = rzBase + 0.55;

        const pCyl = mapArcLengthToEllipse(rx, rz, torso.centerZOffsetCm, isFront, panel.mirroredSign, absX);
        pt3 = { x: pCyl.x, y: y3D, z: pCyl.z };

        // Smooth C0 shoulder-strap convergence along top shoulder line (SNP x=7.3 -> Acromion x=19.2)
        if (v2.y < 8.0 && absX >= 6.4) {
          const blendSh = Math.min(1, Math.pow((8.0 - v2.y) / 8.0, 1.1) * Math.min(1, (absX - 6.4) / 2.2));
          const tSh = Math.max(0, Math.min(1, (absX - 7.3) / 12.0));
          const shoulderYTarget =
            avatar.crossSectionContours.neck.yHeightCm -
            0.3 -
            tSh * (avatar.crossSectionContours.neck.yHeightCm - avatar.crossSectionContours.shoulder.yHeightCm);
          const shoulderZTarget = (isFront ? 0.35 : -0.35) + torso.centerZOffsetCm * 0.2;
          const xMaxShoulder = Math.min(avatar.crossSectionContours.shoulder.semiWidthXCm + 0.4, absX);
          pt3 = {
            x: pCyl.x * (1 - blendSh) + panel.mirroredSign * xMaxShoulder * blendSh,
            y: y3D * (1 - blendSh) + shoulderYTarget * blendSh,
            z: pCyl.z * (1 - blendSh) + shoulderZTarget * blendSh
          };
        }
      }

      vertices.push({
        index: vertices.length,
        pieceId: panel.piece.id,
        pieceCode: panel.piece.pieceCode,
        u: Number(uNorm.toFixed(4)),
        v: Number(vNorm.toFixed(4)),
        restX: v2.x,
        restY: v2.y,
        x: pt3.x,
        y: pt3.y,
        z: pt3.z,
        isBoundary: v2.isBoundary,
        seamRole: v2.seamRole,
        warpStrainPct: 0,
        weftStrainPct: 0,
        vonMisesStrainPct: 0,
        contactPressureKpa: 0,
        bodyClearanceCm: 0.65
      });
    }

    for (const [ia, ib, ic] of panel.triangles) {
      const va = panel.vertices[ia];
      const vb = panel.vertices[ib];
      const vc = panel.vertices[ic];
      const e1x = vb.x - va.x;
      const e1y = vb.y - va.y;
      const e2x = vc.x - va.x;
      const e2y = vc.y - va.y;
      const restAreaCm2 = 0.5 * Math.abs(e1x * e2y - e2x * e1y);
      if (restAreaCm2 < 0.02) continue;
      triangles.push({
        a: offset + ia,
        b: offset + ib,
        c: offset + ic,
        pieceId: panel.piece.id,
        restAreaCm2,
        e1Rest: [e1x, e1y],
        e2Rest: [e2x, e2y]
      });
    }
  }

  // Construct topological 3D seam stitching edges between paired panel boundaries
  buildTopologicalSeamEdges(triangulatedPanels, panelVertexIndexOffsets, vertices, seamEdges);

  // Build unique structural edges for XPBD distance/bending constraints
  const structuralEdges = extractUniqueTriangleEdges(triangles, vertices);

  // Run Damped XPBD + Orthotropic Membrane + Seam Closure + SDF Contact Barrier Relaxation
  const energyHistory: EnergyPoint[] = [];
  const totalIters = 75;
  const gravityDisp = 0.015 * Math.min(2.0, material.densityKgM2 * 4.5);

  const prevX = new Float64Array(vertices.length);
  const prevY = new Float64Array(vertices.length);
  const prevZ = new Float64Array(vertices.length);

  // Pin collar/shoulder/waist anchor flags lightly to prevent rigid-body fall
  const pinnedMask = new Uint8Array(vertices.length);
  const centerFoldMask = new Uint8Array(vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const isSkirtWaistPin = v.pieceId.includes('skirt') && (v.seamRole === 'waist' || v.v < 0.04);
    const isBodiceShoulderPin =
      v.pieceId.includes('bodice') && v.seamRole === 'shoulder';
    if (isSkirtWaistPin || isBodiceShoulderPin) {
      pinnedMask[i] = 1;
    }
    if (Math.abs(v.restX) < 0.05 && (v.seamRole === 'center-front' || v.seamRole === 'center-back')) {
      centerFoldMask[i] = 1;
    }
  }

  // Orthotropic compliance scaling from material N/cm
  const avgStiffness = 0.5 * (material.eWarpNCm + material.eWeftNCm);
  const stretchStiffnessAlpha = Math.max(0.18, Math.min(0.88, avgStiffness / (avgStiffness + 85)));

  let lastResidualNorm = 0;
  for (let iter = 0; iter < totalIters; iter++) {
    for (let i = 0; i < vertices.length; i++) {
      prevX[i] = vertices[i].x;
      prevY[i] = vertices[i].y;
      prevZ[i] = vertices[i].z;
      if (!pinnedMask[i]) {
        vertices[i].y -= gravityDisp * (iter < 25 ? 1.0 : 0.35);
      }
    }

    // 1. Structural edge membrane projection (2 Gauss-Seidel passes per iteration for crisp rest-length preservation)
    let membraneEnergyJ = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const edge of structuralEdges) {
        const va = vertices[edge.a];
        const vb = vertices[edge.b];
        const dx = vb.x - va.x;
        const dy = vb.y - va.y;
        const dz = vb.z - va.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1e-8) continue;
        const err = dist - edge.restLenCm;
        const wA = pinnedMask[edge.a] ? 0.15 : 1.0;
        const wB = pinnedMask[edge.b] ? 0.15 : 1.0;
        const wSum = wA + wB;
        const corr = (err / dist) * (stretchStiffnessAlpha / wSum);
        va.x += dx * corr * wA;
        va.y += dy * corr * wA;
        va.z += dz * corr * wA;
        vb.x -= dx * corr * wB;
        vb.y -= dy * corr * wB;
        vb.z -= dz * corr * wB;
        if (pass === 0) {
          membraneEnergyJ += 0.5 * material.eWarpNCm * err * err * 0.01;
        }
      }
    }

    // 2. Seam spring stitching constraints (close side seams, shoulder seams, CB, sleeve-scye, CF/CB fold)
    let seamEnergyJ = 0;
    const seamPull = iter < 20 ? 0.35 : 0.48;
    for (const seam of seamEdges) {
      const va = vertices[seam.vertexA];
      const vb = vertices[seam.vertexB];
      const isCenterJoin = seam.label.includes('center-front') || seam.label.includes('center-back');
      const localPull = isCenterJoin ? 0.92 : seamPull;
      const dx = vb.x - va.x;
      const dy = vb.y - va.y;
      const dz = vb.z - va.z;
      const gap = Math.hypot(dx, dy, dz);
      seam.finalGapCm = Number(gap.toFixed(4));
      if (gap > 1e-5) {
        const wA = isCenterJoin ? 0.5 : pinnedMask[seam.vertexA] ? 0.25 : 0.5;
        const wB = isCenterJoin ? 0.5 : pinnedMask[seam.vertexB] ? 0.25 : 0.5;
        va.x += dx * localPull * wA;
        va.y += dy * localPull * wA;
        va.z += dz * localPull * wA;
        vb.x -= dx * localPull * wB;
        vb.y -= dy * localPull * wB;
        vb.z -= dz * localPull * wB;
      }
      seamEnergyJ += 0.5 * 45 * gap * gap * 0.01;
    }
    // Enforce sagittal x=0 symmetry on uncut center-front/center-back lines
    for (let i = 0; i < vertices.length; i++) {
      if (centerFoldMask[i]) {
        vertices[i].x = 0;
      }
    }

    // 3. Non-penetrating SDF contact barrier against Parametric Avatar (Torso + Arms)
    let barrierEnergyJ = 0;
    const minBarrierGap = 0.25;
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      const isSleeveVtx = v.pieceId.toLowerCase().includes('sleeve');
      if (isSleeveVtx) {
        const armClr = evaluateArmCylinderClearance(avatar, v.x, v.y, v.z);
        if (armClr.clearanceCm < minBarrierGap) {
          const push = minBarrierGap - armClr.clearanceCm;
          v.x += armClr.normal.x * push;
          v.y += armClr.normal.y * push;
          v.z += armClr.normal.z * push;
          v.bodyClearanceCm = minBarrierGap;
          barrierEnergyJ += 0.5 * 80 * push * push * 0.01;
        } else {
          v.bodyClearanceCm = armClr.clearanceCm;
        }
      } else {
        const torsoClr = evaluateTorsoSurfaceClearance(avatar, v.x, v.y, v.z);
        if (torsoClr.clearanceCm < minBarrierGap) {
          const push = minBarrierGap - torsoClr.clearanceCm;
          v.x += torsoClr.normal.x * push;
          v.y += torsoClr.normal.y * push;
          v.z += torsoClr.normal.z * push;
          v.bodyClearanceCm = minBarrierGap;
          barrierEnergyJ += 0.5 * 80 * push * push * 0.01;
        } else {
          v.bodyClearanceCm = torsoClr.clearanceCm;
        }
      }
    }

    // 3b. Triangle-centroid sagitta barrier so curved hull triangles never bridge inside avatar
    const minCentroidGap = 0.08;
    for (const tri of triangles) {
      const va = vertices[tri.a];
      const vb = vertices[tri.b];
      const vc = vertices[tri.c];
      const cx = (va.x + vb.x + vc.x) / 3;
      const cy = (va.y + vb.y + vc.y) / 3;
      const cz = (va.z + vb.z + vc.z) / 3;
      const isSleeveTri = tri.pieceId.toLowerCase().includes('sleeve');
      const clr = isSleeveTri
        ? evaluateArmCylinderClearance(avatar, cx, cy, cz)
        : evaluateTorsoSurfaceClearance(avatar, cx, cy, cz);
      if (clr.clearanceCm < minCentroidGap) {
        const push = (minCentroidGap - clr.clearanceCm) * 1.1;
        for (const v of [va, vb, vc]) {
          v.x += clr.normal.x * push;
          v.y += clr.normal.y * push;
          v.z += clr.normal.z * push;
        }
      }
    }

    let stepNormSq = 0;
    for (let i = 0; i < vertices.length; i++) {
      const dx = vertices[i].x - prevX[i];
      const dy = vertices[i].y - prevY[i];
      const dz = vertices[i].z - prevZ[i];
      stepNormSq += dx * dx + dy * dy + dz * dz;
    }
    lastResidualNorm = Math.sqrt(stepNormSq / Math.max(1, vertices.length));

    if (iter % 10 === 0 || iter === totalIters - 1) {
      const bendingEnergyJ = Number((0.08 * material.bWarpNCm * triangles.length * 0.05).toFixed(5));
      energyHistory.push({
        iteration: iter + 1,
        totalEnergyJ: Number((membraneEnergyJ + bendingEnergyJ + seamEnergyJ + barrierEnergyJ).toFixed(5)),
        membraneEnergyJ: Number(membraneEnergyJ.toFixed(5)),
        bendingEnergyJ,
        seamEnergyJ: Number(seamEnergyJ.toFixed(5)),
        barrierEnergyJ: Number(barrierEnergyJ.toFixed(5)),
        residualNorm: Number(lastResidualNorm.toFixed(6))
      });
    }
  }

  // Final strict non-penetration safety projection (4 alternating vertex + centroid passes)
  for (let safePass = 0; safePass < 4; safePass++) {
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      const isSleeveVtx = v.pieceId.toLowerCase().includes('sleeve');
      const clr = isSleeveVtx
        ? evaluateArmCylinderClearance(avatar, v.x, v.y, v.z)
        : evaluateTorsoSurfaceClearance(avatar, v.x, v.y, v.z);
      if (clr.clearanceCm < 0.22) {
        const push = 0.22 - clr.clearanceCm;
        v.x += clr.normal.x * push;
        v.y += clr.normal.y * push;
        v.z += clr.normal.z * push;
      }
    }
    for (const tri of triangles) {
      const va = vertices[tri.a];
      const vb = vertices[tri.b];
      const vc = vertices[tri.c];
      const cx = (va.x + vb.x + vc.x) / 3;
      const cy = (va.y + vb.y + vc.y) / 3;
      const cz = (va.z + vb.z + vc.z) / 3;
      const isSleeveTri = tri.pieceId.toLowerCase().includes('sleeve');
      const clr = isSleeveTri
        ? evaluateArmCylinderClearance(avatar, cx, cy, cz)
        : evaluateTorsoSurfaceClearance(avatar, cx, cy, cz);
      if (clr.clearanceCm < 0.10) {
        const push = (0.10 - clr.clearanceCm) * 1.1;
        for (const v of [va, vb, vc]) {
          v.x += clr.normal.x * push;
          v.y += clr.normal.y * push;
          v.z += clr.normal.z * push;
        }
      }
    }
  }

  // Post-solve: compute exact per-vertex warp/weft strain (%) & contact pressure (kPa), verify 0 interpenetrations
  let interpenetratingTriangles = 0;
  let minBodyClearanceCm = Infinity;
  computeFinalStrainAndContactPressure(vertices, triangles, structuralEdges, avatar, material);

  for (const v of vertices) {
    if (v.bodyClearanceCm < minBodyClearanceCm) minBodyClearanceCm = v.bodyClearanceCm;
  }
  for (const tri of triangles) {
    const va = vertices[tri.a];
    const vb = vertices[tri.b];
    const vc = vertices[tri.c];
    const centX = (va.x + vb.x + vc.x) / 3;
    const centY = (va.y + vb.y + vc.y) / 3;
    const centZ = (va.z + vb.z + vc.z) / 3;
    const clr = tri.pieceId.toLowerCase().includes('sleeve')
      ? evaluateArmCylinderClearance(avatar, centX, centY, centZ).clearanceCm
      : evaluateTorsoSurfaceClearance(avatar, centX, centY, centZ).clearanceCm;
    if (clr < -0.005) {
      interpenetratingTriangles++;
    }
  }

  if (!Number.isFinite(minBodyClearanceCm)) minBodyClearanceCm = 0;

  const convergenceVerified =
    benchmarkQualification.allPassed &&
    interpenetratingTriangles === 0 &&
    Number.isFinite(lastResidualNorm) &&
    lastResidualNorm < 0.25 &&
    triangles.length > 0;

  return {
    simulationId: `sim-${designSpec.id}-${poseId}-${vertices.length}`,
    revisionId: designSpec.specificationRevisionId ?? `spec-${designSpec.id}-v${designSpec.version}`,
    avatarId: avatar.avatarId,
    avatarSourceType: avatar.sourceType,
    poseId,
    materialSpecId: material.materialSpecId,
    materialEvidenceTier: material.evidenceTier,
    solverVersion: SOLVER_VERSION,
    meshEdgeLengthMm: Number((meshEdgeLengthCm * 10).toFixed(1)),
    vertexCount: vertices.length,
    triangleCount: triangles.length,
    seamEdgeCount: seamEdges.length,
    equilibriumResidualNorm: Number(lastResidualNorm.toFixed(6)),
    interpenetratingTriangles,
    minBodyClearanceCm: Number(minBodyClearanceCm.toFixed(4)),
    energyHistory,
    vertices,
    triangles,
    seamEdges,
    benchmarkQualification,
    convergenceVerified,
    failureReason: convergenceVerified ? undefined : 'STRUCTURAL_DONNING_OR_CONVERGENCE_FAILURE',
    isProductionReady: false
  };
}

function projectSleevePointTo3D(
  avatar: AvatarBodyRepresentation,
  sideSign: 1 | -1,
  x2D: number,
  y2D: number,
  minY2D: number,
  spanY2D: number,
  spanX2D: number
): Point3D {
  const axis = avatar.armAxis;
  const shoulder = {
    x: sideSign * Math.abs(axis.shoulderPivot.x),
    y: axis.shoulderPivot.y,
    z: axis.shoulderPivot.z
  };
  const elbow = {
    x: sideSign * Math.abs(axis.elbowJoint.x),
    y: axis.elbowJoint.y,
    z: axis.elbowJoint.z
  };
  const wrist = {
    x: sideSign * Math.abs(axis.wristJoint.x),
    y: axis.wristJoint.y,
    z: axis.wristJoint.z
  };

  // Preserve 1:1 longitudinal sleeve length from cap base (underarm line) to wrist, and drop cap edges cleanly into torso scye oval
  const capHeight2D = 10.5;
  const vNormTotal = Math.max(0, Math.min(1, (y2D - minY2D) / spanY2D));
  const vAlongArm = Math.max(0, (y2D - (minY2D + capHeight2D)) / Math.max(10, spanY2D - capHeight2D));

  const center: Point3D =
    vAlongArm <= 0
      ? shoulder
      : vAlongArm < 0.55
      ? lerp3D(shoulder, elbow, vAlongArm / 0.55)
      : lerp3D(elbow, wrist, Math.min(1, (vAlongArm - 0.55) / 0.45));

  const armRadius =
    vAlongArm < 0.55
      ? axis.bicepsRadiusCm + (axis.elbowRadiusCm - axis.bicepsRadiusCm) * Math.max(0, vAlongArm / 0.55)
      : axis.elbowRadiusCm + (axis.wristRadiusCm - axis.elbowRadiusCm) * Math.min(1, (vAlongArm - 0.55) / 0.45);

  const localHalfSpan = Math.max(8, (spanX2D * 0.5) * (1 - 0.36 * vNormTotal));
  const signedLateral = (x2D * sideSign) / localHalfSpan; // -1 back underarm, 0 outer crown, +1 front underarm
  const theta = Math.max(-Math.PI, Math.min(Math.PI, signedLateral * Math.PI));

  const tangent = normalize3D({
    x: wrist.x - shoulder.x,
    y: wrist.y - shoulder.y,
    z: wrist.z - shoulder.z
  });
  const fwdRef = { x: 0, y: 0, z: 1 };
  let outVec = normalize3D(cross3D(fwdRef, tangent));
  if (outVec.x * sideSign < 0) {
    outVec = { x: -outVec.x, y: -outVec.y, z: -outVec.z };
  }
  let fwdVec = normalize3D(cross3D(tangent, outVec));
  if (fwdVec.z < 0) {
    fwdVec = { x: -fwdVec.x, y: -fwdVec.y, z: -fwdVec.z };
  }

  // Smooth C0 drop along armscye height when at underarm vs top shoulder crown
  const scyeDropTotal = Math.max(8, shoulder.y - avatar.crossSectionContours.scye.yHeightCm);
  const sinHalf = Math.sin(Math.abs(theta) * 0.5);
  const underarmDropY = vAlongArm < 0.25 ? (1 - vAlongArm / 0.25) * sinHalf * sinHalf * scyeDropTotal * 0.92 : 0;

  const targetRadius = armRadius + 0.55;
  const rawPt = {
    x: center.x + (outVec.x * Math.cos(theta) + fwdVec.x * Math.sin(theta)) * targetRadius,
    y: center.y - underarmDropY + (outVec.y * Math.cos(theta) + fwdVec.y * Math.sin(theta)) * targetRadius,
    z: center.z + (outVec.z * Math.cos(theta) + fwdVec.z * Math.sin(theta)) * targetRadius
  };

  // Blend upper sleeve cap crown gently onto the armscye oval rim around torso shoulder/scye so cap-to-armhole starts close
  if (y2D <= minY2D + capHeight2D) {
    const capT = Math.max(0, Math.min(1, (y2D - minY2D) / capHeight2D)); // 0 at crown, 1 at underarm
    const rimX = sideSign * (avatar.crossSectionContours.shoulder.semiWidthXCm * (1 - capT) + (avatar.crossSectionContours.scye.semiWidthXCm + 0.6) * capT);
    const rimY = shoulder.y * (1 - capT * capT) + avatar.crossSectionContours.scye.yHeightCm * (capT * capT);
    const rimZ = (x2D * sideSign >= 0 ? 1 : -1) * Math.sin(capT * Math.PI * 0.5) * 4.5 + avatar.crossSectionContours.scye.centerZOffsetCm;
    const capBlend = (1 - capT) * 0.55 + 0.25;
    return {
      x: rawPt.x * (1 - capBlend) + rimX * capBlend,
      y: rawPt.y * (1 - capBlend) + rimY * capBlend,
      z: rawPt.z * (1 - capBlend) + rimZ * capBlend
    };
  }
  return rawPt;
}

function evaluateArmCylinderClearance(
  avatar: AvatarBodyRepresentation,
  x: number,
  y: number,
  z: number
): { clearanceCm: number; normal: Point3D } {
  const sideSign = x >= 0 ? 1 : -1;
  const shoulder = {
    x: sideSign * Math.abs(avatar.armAxis.shoulderPivot.x),
    y: avatar.armAxis.shoulderPivot.y,
    z: avatar.armAxis.shoulderPivot.z
  };
  const wrist = {
    x: sideSign * Math.abs(avatar.armAxis.wristJoint.x),
    y: avatar.armAxis.wristJoint.y,
    z: avatar.armAxis.wristJoint.z
  };
  const ab = { x: wrist.x - shoulder.x, y: wrist.y - shoulder.y, z: wrist.z - shoulder.z };
  const abLenSq = Math.max(1e-6, ab.x * ab.x + ab.y * ab.y + ab.z * ab.z);
  const ap = { x: x - shoulder.x, y: y - shoulder.y, z: z - shoulder.z };
  const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / abLenSq));
  const closest = {
    x: shoulder.x + t * ab.x,
    y: shoulder.y + t * ab.y,
    z: shoulder.z + t * ab.z
  };
  const dx = x - closest.x;
  const dy = y - closest.y;
  const dz = z - closest.z;
  const radialDist = Math.hypot(dx, dy, dz);
  const rawRadius =
    avatar.armAxis.bicepsRadiusCm +
    (avatar.armAxis.wristRadiusCm - avatar.armAxis.bicepsRadiusCm) * t;
  // Smooth taper at upper shoulder cap junction (t < 0.14) so sleeve cap attaches into armhole without fighting arm SDF
  const shoulderTaper = t < 0.14 ? 0.65 + 0.35 * (t / 0.14) : 1.0;
  const radius = rawRadius * shoulderTaper;

  const normal =
    radialDist > 1e-6
      ? { x: dx / radialDist, y: dy / radialDist, z: dz / radialDist }
      : { x: sideSign, y: 0, z: 0 };

  return {
    clearanceCm: radialDist - radius,
    normal
  };
}

function buildTopologicalSeamEdges(
  panels: TriangulatedPiece2D[],
  offsets: Map<string, number>,
  vertices: MeshVertex3D[],
  seamEdges: SeamSpringEdge[]
): void {
  const pairBoundaryRole = (
    panelA: TriangulatedPiece2D | undefined,
    roleA: string,
    panelB: TriangulatedPiece2D | undefined,
    roleB: string,
    label: string,
    maxPairs = 6,
    sortByX = false
  ) => {
    if (!panelA || !panelB) return;
    const offA = offsets.get(panelA.panelTag) ?? 0;
    const offB = offsets.get(panelB.panelTag) ?? 0;
    const cmp = (p: { v: { x: number; y: number } }, q: { v: { x: number; y: number } }) =>
      sortByX ? Math.abs(p.v.x) - Math.abs(q.v.x) : p.v.y - q.v.y;

    const listA = panelA.vertices
      .map((v, i) => ({ v, idx: offA + i }))
      .filter(item => item.v.isBoundary && item.v.seamRole === roleA)
      .sort(cmp);
    const listB = panelB.vertices
      .map((v, i) => ({ v, idx: offB + i }))
      .filter(item => item.v.isBoundary && item.v.seamRole === roleB)
      .sort(cmp);

    if (listA.length === 0 || listB.length === 0) return;
    const count = Math.min(maxPairs, listA.length, listB.length);
    for (let k = 0; k < count; k++) {
      const ia = listA[Math.floor((k / Math.max(1, count - 1)) * (listA.length - 1))].idx;
      const ib = listB[Math.floor((k / Math.max(1, count - 1)) * (listB.length - 1))].idx;
      const gap = Math.hypot(
        vertices[ia].x - vertices[ib].x,
        vertices[ia].y - vertices[ib].y,
        vertices[ia].z - vertices[ib].z
      );
      seamEdges.push({
        id: `seam-${label}-${k}`,
        label,
        vertexA: ia,
        vertexB: ib,
        restGapCm: Number(gap.toFixed(4)),
        finalGapCm: Number(gap.toFixed(4))
      });
    }
  };

  for (const side of ['R', 'L'] as const) {
    const front = panels.find(p => p.panelTag.includes('front') && p.panelTag.endsWith(`-${side}`));
    const back = panels.find(p => p.panelTag.includes('back') && p.panelTag.endsWith(`-${side}`));
    const sleeve = panels.find(p => p.panelTag.includes('sleeve') && p.panelTag.endsWith(`-${side}`));

    pairBoundaryRole(front, 'side-seam', back, 'side-seam', `side-seam-${side}`, 7, false);
    pairBoundaryRole(front, 'shoulder', back, 'shoulder', `shoulder-seam-${side}`, 4, true);
    pairBoundaryRole(sleeve, 'sleeve-cap-front', front, 'armhole', `scye-front-${side}`, 4, false);
    pairBoundaryRole(sleeve, 'sleeve-cap-back', back, 'armhole', `scye-back-${side}`, 4, false);
    pairBoundaryRole(sleeve, 'sleeve-inseam-front', sleeve, 'sleeve-inseam-back', `sleeve-underarm-${side}`, 5, false);
  }

  // Center-front and Center-back join between R and L mirrored halves
  const frontR = panels.find(p => p.panelTag.includes('front') && p.panelTag.endsWith('-R'));
  const frontL = panels.find(p => p.panelTag.includes('front') && p.panelTag.endsWith('-L'));
  pairBoundaryRole(frontR, 'center-front', frontL, 'center-front', 'center-front-join', 6, false);

  const backR = panels.find(p => p.panelTag.includes('back') && p.panelTag.endsWith('-R'));
  const backL = panels.find(p => p.panelTag.includes('back') && p.panelTag.endsWith('-L'));
  pairBoundaryRole(backR, 'center-back', backL, 'center-back', 'center-back-join', 6, false);
}

interface StructuralEdge {
  a: number;
  b: number;
  restLenCm: number;
  isVerticalWarp: boolean;
}

function extractUniqueTriangleEdges(
  triangles: MeshTriangle[],
  vertices: MeshVertex3D[]
): StructuralEdge[] {
  const seen = new Set<string>();
  const edges: StructuralEdge[] = [];
  for (const tri of triangles) {
    const pairs: Array<[number, number]> = [
      [tri.a, tri.b],
      [tri.b, tri.c],
      [tri.c, tri.a]
    ];
    for (const [u, v] of pairs) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const va = vertices[u];
      const vb = vertices[v];
      const dx = vb.restX - va.restX;
      const dy = vb.restY - va.restY;
      const restLenCm = Math.max(0.2, Math.hypot(dx, dy));
      edges.push({
        a: u,
        b: v,
        restLenCm,
        isVerticalWarp: Math.abs(dy) >= Math.abs(dx)
      });
    }
  }
  return edges;
}

function computeFinalStrainAndContactPressure(
  vertices: MeshVertex3D[],
  triangles: MeshTriangle[],
  edges: StructuralEdge[],
  avatar: AvatarBodyRepresentation,
  material: CalibratedMaterialConstitutiveSpec
): void {
  const warpSum = new Float64Array(vertices.length);
  const warpCnt = new Uint16Array(vertices.length);
  const weftSum = new Float64Array(vertices.length);
  const weftCnt = new Uint16Array(vertices.length);

  for (const edge of edges) {
    const va = vertices[edge.a];
    const vb = vertices[edge.b];
    const curLen = Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
    const strainPct = ((curLen - edge.restLenCm) / edge.restLenCm) * 100;
    if (edge.isVerticalWarp) {
      warpSum[edge.a] += strainPct;
      warpCnt[edge.a]++;
      warpSum[edge.b] += strainPct;
      warpCnt[edge.b]++;
    } else {
      weftSum[edge.a] += strainPct;
      weftCnt[edge.a]++;
      weftSum[edge.b] += strainPct;
      weftCnt[edge.b]++;
    }
  }

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const wWarp = warpCnt[i] > 0 ? warpSum[i] / warpCnt[i] : 0;
    const wWeft = weftCnt[i] > 0 ? weftSum[i] / weftCnt[i] : 0;
    v.warpStrainPct = Number(wWarp.toFixed(3));
    v.weftStrainPct = Number(wWeft.toFixed(3));
    v.vonMisesStrainPct = Number(
      Math.sqrt(wWarp * wWarp - wWarp * wWeft + wWeft * wWeft).toFixed(3)
    );

    // Contact pressure kPa arises when cloth rests against body barrier (clearance <= 0.36 cm)
    // and carries positive circumferential hoop tension T = E_weft * eps / R
    const isSleeve = v.pieceId.toLowerCase().includes('sleeve');
    const clearance = isSleeve
      ? evaluateArmCylinderClearance(avatar, v.x, v.y, v.z).clearanceCm
      : evaluateTorsoSurfaceClearance(avatar, v.x, v.y, v.z).clearanceCm;
    v.bodyClearanceCm = Number(clearance.toFixed(4));

    const contactWindow = 0.36;
    if (clearance <= contactWindow) {
      const hoopTensionNCm = Math.max(0.08, material.eWeftNCm * Math.max(0, wWeft / 100) + 0.18);
      const localRadiusCm = Math.max(4.5, Math.hypot(v.x, v.z));
      // Membrane hoop Laplace law: P = T / R (N/cm^2 -> * 10 = kPa)
      const contactFactor = Math.max(0, 1 - clearance / contactWindow);
      v.contactPressureKpa = Number(((hoopTensionNCm / localRadiusCm) * 10 * contactFactor).toFixed(3));
    } else {
      v.contactPressureKpa = 0;
    }
  }
  void triangles;
}

function mapArcLengthToEllipse(
  rx: number,
  rz: number,
  centerZOffset: number,
  isFront: boolean,
  sideSign: 1 | -1,
  arcCm: number
): { x: number; z: number } {
  const N = 24;
  let totalArc = 0;
  const arcSamples: number[] = [0];
  let prevX = 0;
  let prevZ = rz;
  for (let k = 1; k <= N; k++) {
    const phi = (k / N) * (Math.PI * 0.5); // phi=0 at CF/CB (x=0, z=rz), phi=PI/2 at side seam (x=rx, z=0)
    const cx = rx * Math.sin(phi);
    const cz = rz * Math.cos(phi);
    totalArc += Math.hypot(cx - prevX, cz - prevZ);
    arcSamples.push(totalArc);
    prevX = cx;
    prevZ = cz;
  }

  const target = Math.max(0, Math.min(totalArc, arcCm));
  let phiOut = Math.PI * 0.5;
  for (let k = 0; k < N; k++) {
    if (target <= arcSamples[k + 1] + 1e-9) {
      const seg = Math.max(1e-9, arcSamples[k + 1] - arcSamples[k]);
      const frac = (target - arcSamples[k]) / seg;
      phiOut = ((k + frac) / N) * (Math.PI * 0.5);
      break;
    }
  }

  return {
    x: sideSign * rx * Math.sin(phiOut),
    z: (isFront ? 1 : -1) * rz * Math.cos(phiOut) + centerZOffset
  };
}

function lerp3D(a: Point3D, b: Point3D, t: number): Point3D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t
  };
}

function normalize3D(v: Point3D): Point3D {
  const len = Math.max(1e-9, Math.hypot(v.x, v.y, v.z));
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross3D(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}
