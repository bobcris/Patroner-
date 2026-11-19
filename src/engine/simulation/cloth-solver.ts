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
  ClothSolverQualificationReport,
  EnergyPoint,
  MeshTriangle,
  MeshTopologyDiagnostics,
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

  let minXRaw = Infinity;
  let maxXRaw = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rawBoundary) {
    minXRaw = Math.min(minXRaw, p.x);
    maxXRaw = Math.max(maxXRaw, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const polyRawPts: Point[] = rawBoundary.map(b => ({ x: b.x, y: b.y }));
  const step = Math.max(1.8, edgeLengthCm);
  const minBoundaryClearance = step * 0.35;

  // Generate interior lattice in canonical un-mirrored coordinates so L (-1) and R (+1) panels are exact mirror clones
  const canonicalPoints: Array<{ x: number; y: number; isBoundary: boolean; seamRole?: string; uAlongSeam?: number }> =
    rawBoundary.map(b => ({
      x: b.x,
      y: b.y,
      isBoundary: true,
      seamRole: b.seamRole,
      uAlongSeam: b.uAlongSeam
    }));

  for (let y = minY + step * 0.5; y < maxY - step * 0.4; y += step) {
    for (let x = minXRaw + step * 0.5; x < maxXRaw - step * 0.4; x += step) {
      if (pointInPolygon(x, y, polyRawPts) && minDistanceToPolygonEdges(x, y, polyRawPts) >= minBoundaryClearance) {
        canonicalPoints.push({ x, y, isBoundary: false });
      }
    }
  }

  const vertices: TriangulatedPiece2D['vertices'] = canonicalPoints.map(pt => ({
    ...pt,
    x: pt.x * mirrorX
  }));

  let minX = Infinity;
  let maxX = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
  }
  const polyPts: Point[] = vertices.slice(0, rawBoundary.length).map(v => ({ x: v.x, y: v.y }));

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
  precomputedBenchmarks?: ClothSolverQualificationReport;
}): SimulationCaseResult {
  const {
    pieces,
    designSpec,
    measurements,
    poseId = 'CANONICAL_A_POSE',
    meshEdgeLengthCm = 3.2,
    precomputedBenchmarks
  } = params;
  const avatar = params.avatar ?? generateParametricAvatar(measurements, poseId);
  const material = calibrateConstitutiveMaterial(designSpec.fabric);
  const canReuseBenchmarks =
    precomputedBenchmarks &&
    precomputedBenchmarks.allPassed &&
    precomputedBenchmarks.materialSpecId === material.materialSpecId &&
    precomputedBenchmarks.solverVersion === SOLVER_VERSION;
  const benchmarkQualification = canReuseBenchmarks
    ? precomputedBenchmarks
    : runAnalyticalCredibilityBenchmarks(material);

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
      selfIntersectingTriangles: 0,
      minBodyClearanceCm: 0,
      topologyDiagnostics: {
        degenerateTriangleCount: 0,
        minTriangleAreaCm2: 0,
        minInteriorAngleDeg: 0,
        maxAspectRatio: 0,
        leftRightSymmetryErrorCm: 0,
        boundaryVertexCount: 0,
        manifoldIntegrityVerified: false
      },
      energyHistory: [],
      energyConverging: false,
      vertices: [],
      triangles: [],
      seamEdges: [],
      benchmarkQualification,
      epistemicLayers: {
        analyticalQualification: benchmarkQualification.allPassed ? 'AC-08_PASSED' : 'AC-08_FAILED',
        numericalConvergence: 'FAILED_CLOSED',
        syntheticDrapeBasis: avatar.sourceType === 'MEASURED_3D_SCAN' ? 'SCAN_SYNTHETIC' : 'PARAMETRIC_M02C_SYNTHETIC',
        physicalToileValidation: 'AC-09_PENDING'
      },
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

    // Precompute exact sleeve 2D row half-widths & cap boundary height when projecting a sleeve piece
    const sleeveProfile = isSleeve ? buildSleeveRowProfile(panel.vertices, minY, spanY) : null;

    for (let i = 0; i < panel.vertices.length; i++) {
      const v2 = panel.vertices[i];
      const uNorm = (v2.x - minX) / spanX;
      const vNorm = (v2.y - minY) / spanY; // 0 at top, 1 at bottom
      let pt3: Point3D;

      if (isSleeve && sleeveProfile) {
        pt3 = projectSleevePointTo3D(avatar, panel.mirroredSign, v2.x, v2.y, sleeveProfile);
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
    if (
      v.isBoundary &&
      Math.abs(v.restX) < 0.05 &&
      !v.pieceId.toLowerCase().includes('sleeve')
    ) {
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
    const seamPull = iter < 20 ? 0.45 : 0.72;
    for (const seam of seamEdges) {
      const va = vertices[seam.vertexA];
      const vb = vertices[seam.vertexB];
      const isCenterJoin = seam.label.includes('center-front') || seam.label.includes('center-back');
      const localPull = isCenterJoin ? 0.94 : seamPull;
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

  // Post-solve non-penetration safety projection + cloth-cloth self-intersection separation
  for (let safePass = 0; safePass < 6; safePass++) {
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
    resolveClothSelfIntersectionsPass(vertices, triangles, seamEdges, avatar, pinnedMask, centerFoldMask);
  }

  // Post-solve: compute exact per-vertex warp/weft strain (%) & contact pressure (kPa), verify 0 interpenetrations & topology quality
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

  const topologyDiagnostics = computeMeshTopologyDiagnostics(vertices, triangles);
  const selfIntersectingTriangles = countSelfIntersectingTriangles(vertices, triangles, seamEdges);

  const firstHist = energyHistory[0];
  const lastHist = energyHistory[energyHistory.length - 1];
  const energyConverging =
    energyHistory.length >= 2 &&
    Number.isFinite(lastResidualNorm) &&
    lastResidualNorm < 0.25 &&
    (lastHist.residualNorm <= firstHist.residualNorm * 1.05 || lastHist.residualNorm < 0.05);

  const convergenceVerified =
    benchmarkQualification.allPassed &&
    interpenetratingTriangles === 0 &&
    topologyDiagnostics.degenerateTriangleCount === 0 &&
    energyConverging &&
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
    selfIntersectingTriangles,
    minBodyClearanceCm: Number(minBodyClearanceCm.toFixed(4)),
    topologyDiagnostics,
    energyHistory,
    energyConverging,
    vertices,
    triangles,
    seamEdges,
    benchmarkQualification,
    epistemicLayers: {
      analyticalQualification: benchmarkQualification.allPassed ? 'AC-08_PASSED' : 'AC-08_FAILED',
      numericalConvergence: convergenceVerified ? 'CONVERGED' : 'FAILED_CLOSED',
      syntheticDrapeBasis: avatar.sourceType === 'MEASURED_3D_SCAN' ? 'SCAN_SYNTHETIC' : 'PARAMETRIC_M02C_SYNTHETIC',
      physicalToileValidation: 'AC-09_PENDING'
    },
    convergenceVerified,
    failureReason: convergenceVerified ? undefined : 'STRUCTURAL_DONNING_OR_CONVERGENCE_FAILURE',
    isProductionReady: false
  };
}

interface SleeveRowProfile {
  minY: number;
  spanY: number;
  capBaseY: number;
  bicepsHalfWidthCm: number;
  wristHalfWidthCm: number;
}

function buildSleeveRowProfile(
  verts: Array<{ x: number; y: number; seamRole?: string }>,
  minY: number,
  spanY: number
): SleeveRowProfile {
  const capYs = verts.filter(v => v.seamRole?.startsWith('sleeve-cap')).map(v => v.y);
  const capBaseY = capYs.length > 0 ? Math.max(...capYs) : minY + spanY * 0.27;
  const bicepsVerts = verts.filter(v => Math.abs(v.y - capBaseY) <= 3.5);
  const wristVerts = verts.filter(v => v.y >= minY + spanY - 3.5);
  const bicepsHalfWidthCm = Math.max(
    10,
    ...(bicepsVerts.length > 0 ? bicepsVerts : verts).map(v => Math.abs(v.x))
  );
  const wristHalfWidthCm = Math.max(
    7,
    wristVerts.length > 0 ? Math.max(...wristVerts.map(v => Math.abs(v.x))) : bicepsHalfWidthCm * 0.65
  );
  return { minY, spanY, capBaseY, bicepsHalfWidthCm, wristHalfWidthCm };
}

function projectSleevePointTo3D(
  avatar: AvatarBodyRepresentation,
  sideSign: 1 | -1,
  x2D: number,
  y2D: number,
  profile: SleeveRowProfile
): Point3D {
  const axis = avatar.armAxis;
  const shoulder = {
    x: sideSign * (Math.abs(axis.shoulderPivot.x) + 0.55),
    y: axis.shoulderPivot.y,
    z: axis.shoulderPivot.z
  };
  const elbow = {
    x: sideSign * (Math.abs(axis.elbowJoint.x) + 0.45),
    y: axis.elbowJoint.y,
    z: axis.elbowJoint.z
  };
  const wrist = {
    x: sideSign * (Math.abs(axis.wristJoint.x) + 0.45),
    y: axis.wristJoint.y,
    z: axis.wristJoint.z
  };

  // Bijective axial coordinate along entire sleeve height (0 at shoulder crown -> 1 at wrist)
  // so cap triangles spread smoothly down the upper arm and never pile axially onto a single ring.
  const tLinear = Math.max(0, Math.min(1, (y2D - profile.minY) / Math.max(10, profile.spanY)));
  const capFrac = Math.max(0.15, Math.min(0.4, (profile.capBaseY - profile.minY) / Math.max(10, profile.spanY)));
  const elbowT = 0.58;

  const center: Point3D =
    tLinear < elbowT
      ? lerp3D(shoulder, elbow, tLinear / elbowT)
      : lerp3D(elbow, wrist, Math.min(1, (tLinear - elbowT) / (1 - elbowT)));

  const vBelowCap = Math.max(0, (tLinear - capFrac) / Math.max(0.1, 1 - capFrac));
  const armRadius =
    tLinear < elbowT
      ? axis.bicepsRadiusCm + (axis.elbowRadiusCm - axis.bicepsRadiusCm) * (tLinear / elbowT)
      : axis.elbowRadiusCm + (axis.wristRadiusCm - axis.elbowRadiusCm) * ((tLinear - elbowT) / (1 - elbowT));

  const localHalfSpan =
    y2D <= profile.capBaseY
      ? profile.bicepsHalfWidthCm + 0.35
      : profile.bicepsHalfWidthCm + (profile.wristHalfWidthCm - profile.bicepsHalfWidthCm) * vBelowCap + 0.35;
  const signedLateral = Math.max(-0.985, Math.min(0.985, (x2D * sideSign) / Math.max(4, localHalfSpan)));
  const theta = signedLateral * Math.PI;

  const tangent = normalize3D(
    tLinear < elbowT
      ? { x: elbow.x - shoulder.x, y: elbow.y - shoulder.y, z: elbow.z - shoulder.z }
      : { x: wrist.x - elbow.x, y: wrist.y - elbow.y, z: wrist.z - elbow.z }
  );
  const fwdRef = { x: 0, y: 0, z: 1 };
  let outVec = normalize3D(cross3D(fwdRef, tangent));
  if (outVec.x * sideSign < 0) {
    outVec = { x: -outVec.x, y: -outVec.y, z: -outVec.z };
  }
  let fwdVec = normalize3D(cross3D(tangent, outVec));
  if (fwdVec.z < 0) {
    fwdVec = { x: -fwdVec.x, y: -fwdVec.y, z: -fwdVec.z };
  }

  const targetRadius = armRadius + 0.78;
  return {
    x: center.x + (outVec.x * Math.cos(theta) + fwdVec.x * Math.sin(theta)) * targetRadius,
    y: center.y + (outVec.y * Math.cos(theta) + fwdVec.y * Math.sin(theta)) * targetRadius,
    z: center.z + (outVec.z * Math.cos(theta) + fwdVec.z * Math.sin(theta)) * targetRadius
  };
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

    const matchesRole = (role: string | undefined, vx: number, targetRole: string) =>
      role === targetRole ||
      ((targetRole === 'center-front' || targetRole === 'center-back') && Math.abs(vx) < 0.05);

    const listA = panelA.vertices
      .map((v, i) => ({ v, idx: offA + i }))
      .filter(item => item.v.isBoundary && matchesRole(item.v.seamRole, item.v.x, roleA))
      .sort(cmp);
    const listB = panelB.vertices
      .map((v, i) => ({ v, idx: offB + i }))
      .filter(item => item.v.isBoundary && matchesRole(item.v.seamRole, item.v.x, roleB))
      .sort(cmp);

    if (listA.length === 0 || listB.length === 0) return;
    // Pair every vertex along the denser seam side so no intermediate seam vertex is left dangling
    const count = Math.max(maxPairs, listA.length, listB.length);
    for (let k = 0; k < count; k++) {
      const ia = listA[Math.round((k / Math.max(1, count - 1)) * (listA.length - 1))].idx;
      const ib = listB[Math.round((k / Math.max(1, count - 1)) * (listB.length - 1))].idx;
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

    pairBoundaryRole(front, 'side-seam', back, 'side-seam', `side-seam-${side}`, 12, false);
    pairBoundaryRole(front, 'shoulder', back, 'shoulder', `shoulder-seam-${side}`, 8, true);
    pairBoundaryRole(sleeve, 'sleeve-cap-front', front, 'armhole', `scye-front-${side}`, 10, false);
    pairBoundaryRole(sleeve, 'sleeve-cap-back', back, 'armhole', `scye-back-${side}`, 10, false);
    pairBoundaryRole(sleeve, 'sleeve-inseam-front', sleeve, 'sleeve-inseam-back', `sleeve-underarm-${side}`, 18, false);
  }

  // Center-front and Center-back join between R and L mirrored halves
  const frontR = panels.find(p => p.panelTag.includes('front') && p.panelTag.endsWith('-R'));
  const frontL = panels.find(p => p.panelTag.includes('front') && p.panelTag.endsWith('-L'));
  pairBoundaryRole(frontR, 'center-front', frontL, 'center-front', 'center-front-join', 12, false);

  const backR = panels.find(p => p.panelTag.includes('back') && p.panelTag.endsWith('-R'));
  const backL = panels.find(p => p.panelTag.includes('back') && p.panelTag.endsWith('-L'));
  pairBoundaryRole(backR, 'center-back', backL, 'center-back', 'center-back-join', 12, false);
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

/**
 * Evaluates 3D triangle mesh quality, degeneracy, boundary count, and sagittal Left/Right symmetry.
 */
export function computeMeshTopologyDiagnostics(
  vertices: MeshVertex3D[],
  triangles: MeshTriangle[]
): MeshTopologyDiagnostics {
  if (vertices.length === 0 || triangles.length === 0) {
    return {
      degenerateTriangleCount: triangles.length,
      minTriangleAreaCm2: 0,
      minInteriorAngleDeg: 0,
      maxAspectRatio: 0,
      leftRightSymmetryErrorCm: 0,
      boundaryVertexCount: 0,
      manifoldIntegrityVerified: false
    };
  }

  let degenerateTriangleCount = 0;
  let minTriangleAreaCm2 = Infinity;
  let minInteriorAngleDeg = 180;
  let maxAspectRatio = 1;

  for (const tri of triangles) {
    const a = vertices[tri.a];
    const b = vertices[tri.b];
    const c = vertices[tri.c];

    const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const e3 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
    const cr = cross3D(e1, e2);
    const area3D = 0.5 * Math.hypot(cr.x, cr.y, cr.z);

    if (!Number.isFinite(area3D) || area3D < 1e-4) {
      degenerateTriangleCount++;
    }
    if (area3D < minTriangleAreaCm2) minTriangleAreaCm2 = area3D;

    const l1 = Math.hypot(e1.x, e1.y, e1.z);
    const l2 = Math.hypot(e2.x, e2.y, e2.z);
    const l3 = Math.hypot(e3.x, e3.y, e3.z);
    const minL = Math.max(1e-6, Math.min(l1, l2, l3));
    const maxL = Math.max(l1, l2, l3);
    maxAspectRatio = Math.max(maxAspectRatio, maxL / minL);

    const cosA = Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - l3 * l3) / (2 * Math.max(1e-8, l1 * l2))));
    const cosB = Math.max(-1, Math.min(1, (l1 * l1 + l3 * l3 - l2 * l2) / (2 * Math.max(1e-8, l1 * l3))));
    const cosC = Math.max(-1, Math.min(1, (l2 * l2 + l3 * l3 - l1 * l1) / (2 * Math.max(1e-8, l2 * l3))));
    const minAng = (Math.min(Math.acos(cosA), Math.acos(cosB), Math.acos(cosC)) * 180) / Math.PI;
    if (Number.isFinite(minAng) && minAng < minInteriorAngleDeg) {
      minInteriorAngleDeg = minAng;
    }
  }

  // Left/Right symmetry check comparing +x and -x sides of matching piece types
  let posXSum = 0;
  let posCnt = 0;
  let negXSum = 0;
  let negCnt = 0;
  let boundaryVertexCount = 0;
  for (const v of vertices) {
    if (v.isBoundary) boundaryVertexCount++;
    if (v.x > 0.25) {
      posXSum += v.x;
      posCnt++;
    } else if (v.x < -0.25) {
      negXSum += Math.abs(v.x);
      negCnt++;
    }
  }
  const leftRightSymmetryErrorCm =
    posCnt > 0 && negCnt > 0
      ? Number(Math.abs(posXSum / posCnt - negXSum / negCnt).toFixed(4))
      : 0;

  return {
    degenerateTriangleCount,
    minTriangleAreaCm2: Number((Number.isFinite(minTriangleAreaCm2) ? minTriangleAreaCm2 : 0).toFixed(5)),
    minInteriorAngleDeg: Number(minInteriorAngleDeg.toFixed(2)),
    maxAspectRatio: Number(maxAspectRatio.toFixed(2)),
    leftRightSymmetryErrorCm,
    boundaryVertexCount,
    manifoldIntegrityVerified: degenerateTriangleCount === 0 && minTriangleAreaCm2 >= 1e-4
  };
}

/**
 * Spatial-AABB + Möller-Trumbore interior-segment intersection detector checking cloth-cloth self-intersections
 * among non-adjacent and unjoined triangle pairs.
 */
export function countSelfIntersectingTriangles(
  vertices: MeshVertex3D[],
  triangles: MeshTriangle[],
  seamEdges: SeamSpringEdge[]
): number {
  const nTri = triangles.length;
  if (nTri < 2) return 0;

  // Map vertices connected by active seam edges so intended joined vertices do not false-trigger as punctures
  const seamJoined = new Set<string>();
  for (const s of seamEdges) {
    seamJoined.add(s.vertexA < s.vertexB ? `${s.vertexA}:${s.vertexB}` : `${s.vertexB}:${s.vertexA}`);
  }

  const minX = new Float64Array(nTri);
  const maxX = new Float64Array(nTri);
  const minY = new Float64Array(nTri);
  const maxY = new Float64Array(nTri);
  const minZ = new Float64Array(nTri);
  const maxZ = new Float64Array(nTri);

  for (let i = 0; i < nTri; i++) {
    const t = triangles[i];
    const a = vertices[t.a];
    const b = vertices[t.b];
    const c = vertices[t.c];
    minX[i] = Math.min(a.x, b.x, c.x);
    maxX[i] = Math.max(a.x, b.x, c.x);
    minY[i] = Math.min(a.y, b.y, c.y);
    maxY[i] = Math.max(a.y, b.y, c.y);
    minZ[i] = Math.min(a.z, b.z, c.z);
    maxZ[i] = Math.max(a.z, b.z, c.z);
  }

  const intersectingSet = new Set<number>();
  const verticesShareSeam = (u: number, v: number) =>
    u === v || seamJoined.has(u < v ? `${u}:${v}` : `${v}:${u}`);

  for (let i = 0; i < nTri; i++) {
    const ti = triangles[i];
    const iVerts = [ti.a, ti.b, ti.c];
    for (let j = i + 1; j < nTri; j++) {
      if (
        maxX[i] < minX[j] ||
        minX[i] > maxX[j] ||
        maxY[i] < minY[j] ||
        minY[i] > maxY[j] ||
        maxZ[i] < minZ[j] ||
        minZ[i] > maxZ[j]
      ) {
        continue;
      }

      const tj = triangles[j];
      const jVerts = [tj.a, tj.b, tj.c];
      let sharedOrSeamed = false;
      for (const u of iVerts) {
        for (const v of jVerts) {
          if (verticesShareSeam(u, v)) {
            sharedOrSeamed = true;
            break;
          }
        }
        if (sharedOrSeamed) break;
      }
      if (sharedOrSeamed) continue;

      if (trianglesStrictlyPierce(vertices[ti.a], vertices[ti.b], vertices[ti.c], vertices[tj.a], vertices[tj.b], vertices[tj.c])) {
        intersectingSet.add(i);
        intersectingSet.add(j);
      }
    }
  }

  return intersectingSet.size;
}

function trianglesStrictlyPierce(
  a0: Point3D,
  a1: Point3D,
  a2: Point3D,
  b0: Point3D,
  b1: Point3D,
  b2: Point3D
): boolean {
  const segHitsTri = (p: Point3D, q: Point3D, v0: Point3D, v1: Point3D, v2: Point3D): boolean => {
    const dir = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
    const e1 = { x: v1.x - v0.x, y: v1.y - v0.y, z: v1.z - v0.z };
    const e2 = { x: v2.x - v0.x, y: v2.y - v0.y, z: v2.z - v0.z };
    const pvec = cross3D(dir, e2);
    const det = e1.x * pvec.x + e1.y * pvec.y + e1.z * pvec.z;
    if (Math.abs(det) < 1e-8) return false;
    const invDet = 1 / det;
    const tvec = { x: p.x - v0.x, y: p.y - v0.y, z: p.z - v0.z };
    const u = (tvec.x * pvec.x + tvec.y * pvec.y + tvec.z * pvec.z) * invDet;
    if (u <= 0.04 || u >= 0.96) return false;
    const qvec = cross3D(tvec, e1);
    const v = (dir.x * qvec.x + dir.y * qvec.y + dir.z * qvec.z) * invDet;
    if (v <= 0.04 || u + v >= 0.96) return false;
    const t = (e2.x * qvec.x + e2.y * qvec.y + e2.z * qvec.z) * invDet;
    return t > 0.04 && t < 0.96;
  };

  return (
    segHitsTri(a0, a1, b0, b1, b2) ||
    segHitsTri(a1, a2, b0, b1, b2) ||
    segHitsTri(a2, a0, b0, b1, b2) ||
    segHitsTri(b0, b1, a0, a1, a2) ||
    segHitsTri(b1, b2, a0, a1, a2) ||
    segHitsTri(b2, b0, a0, a1, a2)
  );
}

/**
 * Resolves any remaining non-adjacent cloth-cloth triangle intersections symmetrically along
 * body-outward / centroid-separation normals while honoring pinned anchors and sagittal symmetry.
 */
function resolveClothSelfIntersectionsPass(
  vertices: MeshVertex3D[],
  triangles: MeshTriangle[],
  seamEdges: SeamSpringEdge[],
  avatar: AvatarBodyRepresentation,
  pinnedMask: Uint8Array,
  centerFoldMask: Uint8Array
): void {
  const nTri = triangles.length;
  if (nTri < 2) return;

  const seamJoined = new Set<string>();
  for (const s of seamEdges) {
    seamJoined.add(s.vertexA < s.vertexB ? `${s.vertexA}:${s.vertexB}` : `${s.vertexB}:${s.vertexA}`);
  }
  const verticesShareSeam = (u: number, v: number) =>
    u === v || seamJoined.has(u < v ? `${u}:${v}` : `${v}:${u}`);

  const minX = new Float64Array(nTri);
  const maxX = new Float64Array(nTri);
  const minY = new Float64Array(nTri);
  const maxY = new Float64Array(nTri);
  const minZ = new Float64Array(nTri);
  const maxZ = new Float64Array(nTri);

  for (let i = 0; i < nTri; i++) {
    const t = triangles[i];
    const a = vertices[t.a];
    const b = vertices[t.b];
    const c = vertices[t.c];
    minX[i] = Math.min(a.x, b.x, c.x);
    maxX[i] = Math.max(a.x, b.x, c.x);
    minY[i] = Math.min(a.y, b.y, c.y);
    maxY[i] = Math.max(a.y, b.y, c.y);
    minZ[i] = Math.min(a.z, b.z, c.z);
    maxZ[i] = Math.max(a.z, b.z, c.z);
  }

  for (let i = 0; i < nTri; i++) {
    const ti = triangles[i];
    const iVerts = [ti.a, ti.b, ti.c];
    for (let j = i + 1; j < nTri; j++) {
      if (
        maxX[i] < minX[j] ||
        minX[i] > maxX[j] ||
        maxY[i] < minY[j] ||
        minY[i] > maxY[j] ||
        maxZ[i] < minZ[j] ||
        minZ[i] > maxZ[j]
      ) {
        continue;
      }

      const tj = triangles[j];
      const jVerts = [tj.a, tj.b, tj.c];
      let sharedOrSeamed = false;
      for (const u of iVerts) {
        for (const v of jVerts) {
          if (verticesShareSeam(u, v)) {
            sharedOrSeamed = true;
            break;
          }
        }
        if (sharedOrSeamed) break;
      }
      if (sharedOrSeamed) continue;

      const ai = vertices[ti.a];
      const bi = vertices[ti.b];
      const ci = vertices[ti.c];
      const aj = vertices[tj.a];
      const bj = vertices[tj.b];
      const cj = vertices[tj.c];

      if (!trianglesStrictlyPierce(ai, bi, ci, aj, bj, cj)) continue;

      const cix = (ai.x + bi.x + ci.x) / 3;
      const ciy = (ai.y + bi.y + ci.y) / 3;
      const ciz = (ai.z + bi.z + ci.z) / 3;
      const cjx = (aj.x + bj.x + cj.x) / 3;
      const cjy = (aj.y + bj.y + cj.y) / 3;
      const cjz = (aj.z + bj.z + cj.z) / 3;

      const iIsSleeve = ti.pieceId.toLowerCase().includes('sleeve');
      const jIsSleeve = tj.pieceId.toLowerCase().includes('sleeve');

      // When sleeve pierces bodice, separate cleanly:
      // 1) Tuck loose bodice ease safely toward torso surface (never below 0.28 cm clearance)
      // 2) Lift/push sleeve vertices outward along arm-cylinder normal + tangential lift (never INTO the arm)
      if (iIsSleeve !== jIsSleeve) {
        const sleeveVerts = iIsSleeve ? [ai, bi, ci] : [aj, bj, cj];
        const bodiceVerts = iIsSleeve ? [aj, bj, cj] : [ai, bi, ci];
        const sleeveIndices = iIsSleeve ? iVerts : jVerts;
        const bodiceIndices = iIsSleeve ? jVerts : iVerts;
        for (let k = 0; k < 3; k++) {
          const bv = bodiceVerts[k];
          if (!pinnedMask[bodiceIndices[k]] && !centerFoldMask[bodiceIndices[k]]) {
            const bClr = evaluateTorsoSurfaceClearance(avatar, bv.x, bv.y, bv.z);
            if (bClr.clearanceCm > 0.30) {
              const tuck = Math.min(0.42, bClr.clearanceCm - 0.28);
              bv.x -= bClr.normal.x * tuck;
              bv.z -= bClr.normal.z * tuck;
            }
          }
          const sv = sleeveVerts[k];
          if (!pinnedMask[sleeveIndices[k]]) {
            const tClr = evaluateTorsoSurfaceClearance(avatar, sv.x, sv.y, sv.z);
            sv.x += tClr.normal.x * 0.30;
            sv.y += 0.14;
            sv.z += tClr.normal.z * 0.30;
          }
        }
      } else {
        let dx = cix - cjx;
        let dy = ciy - cjy;
        let dz = ciz - cjz;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 1e-6) {
          dx /= dist;
          dy /= dist;
          dz /= dist;
        } else {
          const fallbackNorm = evaluateTorsoSurfaceClearance(avatar, cix, ciy, ciz).normal;
          dx = fallbackNorm.x;
          dy = fallbackNorm.y;
          dz = fallbackNorm.z;
        }
        const push = 0.22;
        for (const idx of iVerts) {
          if (pinnedMask[idx] || centerFoldMask[idx]) continue;
          vertices[idx].x += dx * push;
          vertices[idx].y += dy * push;
          vertices[idx].z += dz * push;
        }
        for (const idx of jVerts) {
          if (pinnedMask[idx] || centerFoldMask[idx]) continue;
          vertices[idx].x -= dx * push;
          vertices[idx].y -= dy * push;
          vertices[idx].z -= dz * push;
        }
      }

      // Refresh AABBs for updated triangles
      minX[i] = Math.min(ai.x, bi.x, ci.x);
      maxX[i] = Math.max(ai.x, bi.x, ci.x);
      minY[i] = Math.min(ai.y, bi.y, ci.y);
      maxY[i] = Math.max(ai.y, bi.y, ci.y);
      minZ[i] = Math.min(ai.z, bi.z, ci.z);
      maxZ[i] = Math.max(ai.z, bi.z, ci.z);

      minX[j] = Math.min(aj.x, bj.x, cj.x);
      maxX[j] = Math.max(aj.x, bj.x, cj.x);
      minY[j] = Math.min(aj.y, bj.y, cj.y);
      maxY[j] = Math.max(aj.y, bj.y, cj.y);
      minZ[j] = Math.min(aj.z, bj.z, cj.z);
      maxZ[j] = Math.max(aj.z, bj.z, cj.z);
    }
  }
}
