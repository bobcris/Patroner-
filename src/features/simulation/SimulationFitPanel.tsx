/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  Eye,
  GitBranch,
  Layers,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import {
  BodiceDartStyle,
  BodyMeasurements,
  DesignSpecification,
  PatternPiece,
  SleeveEaseStrategy
} from '../../types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Ac09PhysicalToileRecord,
  Ac09ToileBlockKey,
  AvatarPoseId,
  BoundedOptimizationProposal,
  BoundedOptimizationResult,
  calibrateConstitutiveMaterial,
  createPendingAc09ToileRecord,
  evaluateAc09ToileRecord,
  evaluateQuantitativeFit,
  generateParametricAvatar,
  runBoundedPatternOptimization,
  runGarmentDrapeSimulation,
  updateAc09PomMeasurement,
  ZoneFitStatus
} from '../../engine/simulation';

export type ViewportHeatmapMode = 'strain' | 'pressure' | 'ease' | 'seams';

interface SimulationFitPanelProps {
  currentSpec: DesignSpecification;
  measurements: BodyMeasurements;
  pieces: PatternPiece[];
  bodiceDartStyle: BodiceDartStyle;
  sleeveEaseStrategy: SleeveEaseStrategy;
  onApplyOptimizationProposal?: (proposal: BoundedOptimizationProposal) => void;
}

export const SimulationFitPanel: React.FC<SimulationFitPanelProps> = ({
  currentSpec,
  measurements,
  pieces,
  bodiceDartStyle,
  sleeveEaseStrategy,
  onApplyOptimizationProposal
}) => {
  const [poseId, setPoseId] = useState<AvatarPoseId>('CANONICAL_A_POSE');
  const [heatmapMode, setHeatmapMode] = useState<ViewportHeatmapMode>('strain');
  const [yawDeg, setYawDeg] = useState<number>(28);
  const [pitchDeg, setPitchDeg] = useState<number>(12);
  const [camZoom, setCamZoom] = useState<number>(1.0);
  const [showAvatarContours, setShowAvatarContours] = useState<boolean>(true);
  const [optimizationResult, setOptimizationResult] = useState<BoundedOptimizationResult | null>(null);
  const [appliedProposalId, setAppliedProposalId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0
  });

  const avatar = useMemo(
    () => generateParametricAvatar(measurements, poseId),
    [measurements, poseId]
  );

  const constitutiveMaterial = useMemo(
    () => calibrateConstitutiveMaterial(currentSpec.fabric),
    [currentSpec.fabric]
  );

  const simulation = useMemo(
    () =>
      runGarmentDrapeSimulation({
        pieces,
        designSpec: currentSpec,
        measurements,
        avatar,
        poseId,
        meshEdgeLengthCm: 3.2
      }),
    [pieces, currentSpec, measurements, avatar, poseId]
  );

  const fitReport = useMemo(
    () => evaluateQuantitativeFit(simulation, avatar, currentSpec, measurements),
    [simulation, avatar, currentSpec, measurements]
  );

  const defaultToileBlock: Ac09ToileBlockKey =
    currentSpec.garmentCategory === 'bodice' ? 'bodice-sleeve-v1' : 'skirt-block-v1';
  const [ac09ActiveBlock, setAc09ActiveBlock] = useState<Ac09ToileBlockKey>(defaultToileBlock);
  const [ac09Records, setAc09Records] = useState<Record<Ac09ToileBlockKey, Ac09PhysicalToileRecord>>(() => ({
    'skirt-block-v1': createPendingAc09ToileRecord({
      toileBlockKey: 'skirt-block-v1',
      designSpec: currentSpec,
      measurements,
      fitReport: currentSpec.garmentCategory === 'skirt' ? fitReport : undefined,
      poseId
    }),
    'bodice-sleeve-v1': createPendingAc09ToileRecord({
      toileBlockKey: 'bodice-sleeve-v1',
      designSpec: currentSpec,
      measurements,
      fitReport: currentSpec.garmentCategory === 'bodice' ? fitReport : undefined,
      poseId
    })
  }));

  // Sync AC-09 nominal CAD values smoothly only if that record is still unassessed (zero fabricated measurements)
  useEffect(() => {
    setAc09ActiveBlock(defaultToileBlock);
    setAc09Records(prev => {
      const targetKey = defaultToileBlock;
      const existing = prev[targetKey];
      const evalState = evaluateAc09ToileRecord(existing);
      if (evalState.status !== 'PENDING') return prev;
      return {
        ...prev,
        [targetKey]: createPendingAc09ToileRecord({
          toileBlockKey: targetKey,
          designSpec: currentSpec,
          measurements,
          fitReport,
          poseId
        })
      };
    });
  }, [defaultToileBlock, currentSpec, measurements, fitReport, poseId]);

  const activeAc09Record = ac09Records[ac09ActiveBlock];
  const activeAc09Evaluation = useMemo(
    () => evaluateAc09ToileRecord(activeAc09Record),
    [activeAc09Record]
  );

  const updateActiveAc09Record = (updater: (prev: Ac09PhysicalToileRecord) => Ac09PhysicalToileRecord) => {
    setAc09Records(prev => ({
      ...prev,
      [ac09ActiveBlock]: updater(prev[ac09ActiveBlock])
    }));
  };

  // Render deterministic 3D projected viewport canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Drafting ground grid
    ctx.fillStyle = '#F7F5F0';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#EAE6DF';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    // Vertical centering offset based on garment category
    const centerYCm = currentSpec.garmentCategory === 'bodice' ? 17 : -33;
    const scale = (currentSpec.garmentCategory === 'bodice' ? 5.2 : 4.95) * camZoom;

    const project = (x: number, y: number, z: number) => {
      const yShift = y - centerYCm;
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const y2 = yShift * cosP - z1 * sinP;
      const z2 = yShift * sinP + z1 * cosP;
      const persp = 1 / Math.max(0.45, 1 - z2 * 0.0045);
      return {
        sx: width * 0.5 + x1 * scale * persp,
        sy: height * 0.52 - y2 * scale * persp,
        depth: z2
      };
    };

    // 1. Draw parametric avatar wire rings & arm skeleton
    if (showAvatarContours) {
      ctx.strokeStyle = 'rgba(115, 115, 115, 0.36)';
      ctx.lineWidth = 1.1;
      for (const plane of Object.values(avatar.crossSectionContours)) {
        if (plane.points.length < 3) continue;
        ctx.beginPath();
        plane.points.forEach((pt, idx) => {
          const p = project(pt.x, pt.y, pt.z);
          if (idx === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        });
        ctx.closePath();
        ctx.stroke();
      }

      // Draw arm axes for bodice view
      if (currentSpec.garmentCategory === 'bodice') {
        const drawArmAxis = (sign: 1 | -1) => {
          const pts = [avatar.armAxis.shoulderPivot, avatar.armAxis.elbowJoint, avatar.armAxis.wristJoint].map(
            pt => project(sign * Math.abs(pt.x), pt.y, pt.z)
          );
          ctx.strokeStyle = 'rgba(120, 113, 108, 0.45)';
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(pts[0].sx, pts[0].sy);
          ctx.lineTo(pts[1].sx, pts[1].sy);
          ctx.lineTo(pts[2].sx, pts[2].sy);
          ctx.stroke();
          ctx.setLineDash([]);
        };
        drawArmAxis(1);
        drawArmAxis(-1);
      }
    }

    // 2. Painter's algorithm sorted cloth triangles
    const projectedVerts = simulation.vertices.map(v => ({
      v,
      p: project(v.x, v.y, v.z)
    }));

    const sortedTris = simulation.triangles
      .map(tri => {
        const pa = projectedVerts[tri.a];
        const pb = projectedVerts[tri.b];
        const pc = projectedVerts[tri.c];
        const avgDepth = (pa.p.depth + pb.p.depth + pc.p.depth) / 3;
        return { tri, pa, pb, pc, avgDepth };
      })
      .sort((u, v) => u.avgDepth - v.avgDepth);

    for (const item of sortedTris) {
      const { pa, pb, pc } = item;
      const ax = pb.v.x - pa.v.x;
      const ay = pb.v.y - pa.v.y;
      const az = pb.v.z - pa.v.z;
      const bx = pc.v.x - pa.v.x;
      const by = pc.v.y - pa.v.y;
      const bz = pc.v.z - pa.v.z;
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const nLen = Math.max(1e-6, Math.hypot(nx, ny, nz));
      const light = Math.max(0.35, Math.min(1.0, 0.55 + 0.45 * ((nx * 0.35 + ny * 0.45 + nz * 0.82) / nLen)));

      const avgStrain = (pa.v.vonMisesStrainPct + pb.v.vonMisesStrainPct + pc.v.vonMisesStrainPct) / 3;
      const avgPress = (pa.v.contactPressureKpa + pb.v.contactPressureKpa + pc.v.contactPressureKpa) / 3;
      const avgClear = (pa.v.bodyClearanceCm + pb.v.bodyClearanceCm + pc.v.bodyClearanceCm) / 3;

      let fillRgb: [number, number, number];
      if (heatmapMode === 'strain') {
        fillRgb = strainToRgb(avgStrain);
      } else if (heatmapMode === 'pressure') {
        fillRgb = pressureToRgb(avgPress);
      } else if (heatmapMode === 'ease') {
        fillRgb = clearanceToRgb(avgClear);
      } else {
        fillRgb = [226, 222, 214];
      }

      const r = Math.round(fillRgb[0] * light);
      const g = Math.round(fillRgb[1] * light);
      const b = Math.round(fillRgb[2] * light);

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.90)`;
      ctx.strokeStyle = heatmapMode === 'seams' ? 'rgba(68, 64, 60, 0.38)' : 'rgba(28, 25, 23, 0.14)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(pa.p.sx, pa.p.sy);
      ctx.lineTo(pb.p.sx, pb.p.sy);
      ctx.lineTo(pc.p.sx, pc.p.sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 3. Draw stitched seam lines in seams/ease modes
    if (heatmapMode === 'seams' || heatmapMode === 'ease') {
      for (const seam of simulation.seamEdges) {
        const pa = projectedVerts[seam.vertexA]?.p;
        const pb = projectedVerts[seam.vertexB]?.p;
        if (!pa || !pb) continue;
        ctx.strokeStyle = seam.finalGapCm < 0.8 ? '#059669' : '#d97706';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.stroke();
      }
    }

    // 4. Overlay circumferential ease plane highlights in ease mode
    if (heatmapMode === 'ease') {
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 1.4;
      for (const zoneId of fitReport.evaluatedZoneOrder) {
        const planeKey = zoneId === 'scye_armhole' ? 'scye' : zoneId === 'biceps_sleeve' ? null : zoneId;
        if (!planeKey) continue;
        const plane = avatar.crossSectionContours[planeKey];
        if (!plane) continue;
        ctx.beginPath();
        plane.points.forEach((pt, idx) => {
          const p = project(pt.x * 1.03, pt.y, pt.z * 1.03);
          if (idx === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }
  }, [simulation, avatar, yawDeg, pitchDeg, camZoom, heatmapMode, showAvatarContours, currentSpec.garmentCategory, fitReport.evaluatedZoneOrder]);

  const handleRunOptimization = () => {
    const res = runBoundedPatternOptimization({
      currentSpec,
      measurements,
      poseId,
      bodiceDartStyle,
      sleeveEaseStrategy
    });
    setOptimizationResult(res);
    setAppliedProposalId(null);
  };

  const handleApproveProposal = (proposal: BoundedOptimizationProposal) => {
    setAppliedProposalId(proposal.proposalId);
    onApplyOptimizationProposal?.(proposal);
  };

  return (
    <div className="space-y-6" data-testid="m06-simulation-panel">
      {/* Governance & Provenance Top Banner */}
      <div className="bg-white border border-neutral-200 rounded-sm p-4 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-neutral-100 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Badge variant="dark" size="sm">M06 // 3D CLOTH SIMULATION &amp; FIT</Badge>
              <Badge variant="warning" size="sm" data-testid="m06-avatar-provenance">
                {avatar.sourceType}
              </Badge>
              <Badge
                variant={constitutiveMaterial.evidenceTier === 'TIER_1_LAB' ? 'success' : 'warning'}
                size="sm"
              >
                MATERIAL: {constitutiveMaterial.evidenceTier}
              </Badge>
              <Badge variant="danger" size="sm">
                isProductionReady: false
              </Badge>
            </div>
            <h3 className="text-base font-serif font-bold text-neutral-900">
              Equilibrium 3D Drape, Regional Fit Diagnostics &amp; Bounded Optimization
            </h3>
            <p className="text-xs text-neutral-600 mt-0.5">
              {avatar.provenanceStatement}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-mono text-neutral-500 uppercase">POSE:</span>
            {(['CANONICAL_A_POSE', 'ARM_FORWARD_45', 'SEATED_90'] as AvatarPoseId[]).map(pid => (
              <button
                key={pid}
                onClick={() => {
                  setPoseId(pid);
                  setOptimizationResult(null);
                }}
                className={`px-2.5 py-1 text-[11px] font-mono rounded-xs border cursor-pointer transition-colors ${
                  poseId === pid
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                {pid}
              </button>
            ))}
          </div>
        </div>

        {/* 4-Layer Epistemic Separation Strip (Analytical vs Numerical Convergence vs Synthetic Simulation vs Physical Toile) */}
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] font-mono"
          data-testid="m06-epistemic-strip"
        >
          <div className="border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5 rounded-xs">
            <span className="text-[10px] text-emerald-700 block uppercase">1. Analytical Mechanics (AC-08)</span>
            <strong className="text-emerald-950">{simulation.epistemicLayers.analyticalQualification}</strong>
          </div>
          <div className="border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 rounded-xs">
            <span className="text-[10px] text-neutral-500 block uppercase">2. Numerical Equilibrium</span>
            <strong className="text-neutral-900">
              {simulation.epistemicLayers.numericalConvergence} (res {simulation.equilibriumResidualNorm.toFixed(4)})
            </strong>
          </div>
          <div className="border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 rounded-xs">
            <span className="text-[10px] text-amber-800 block uppercase">3. Synthetic 3D Drape Basis</span>
            <strong className="text-amber-950">{simulation.epistemicLayers.syntheticDrapeBasis}</strong>
          </div>
          <div className="border border-amber-300 bg-amber-50 px-2.5 py-1.5 rounded-xs">
            <span className="text-[10px] text-amber-800 block uppercase">4. Physical Toile (AC-09)</span>
            <strong className="text-amber-950" data-testid="m06-ac09-header-status">
              AC-09_{activeAc09Evaluation.status}
            </strong>
          </div>
        </div>

        {/* Solver Equilibrium, Topology Quality & Zero-Interpenetration Telemetry */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs font-mono">
          <MetricBox
            label="CONVERGENCE"
            value={simulation.convergenceVerified && simulation.energyConverging ? 'VERIFIED' : 'FAILED'}
            tone={simulation.convergenceVerified ? 'success' : 'danger'}
          />
          <MetricBox
            label="AC-08 BENCHMARKS"
            value={`${simulation.benchmarkQualification.benchmarks.filter(b => b.passed).length}/4 PASS`}
            tone={simulation.benchmarkQualification.allPassed ? 'success' : 'danger'}
          />
          <MetricBox
            label="BODY / SELF CONTACT"
            value={`${simulation.interpenetratingTriangles} body / ${simulation.selfIntersectingTriangles} self`}
            tone={simulation.interpenetratingTriangles === 0 && simulation.selfIntersectingTriangles === 0 ? 'success' : 'warning'}
          />
          <MetricBox
            label="MESH & QUALITY"
            value={`${simulation.vertexCount}v / ${simulation.triangleCount}t (${simulation.topologyDiagnostics.degenerateTriangleCount} deg)`}
            tone={simulation.topologyDiagnostics.manifoldIntegrityVerified ? 'default' : 'danger'}
          />
          <MetricBox
            label="MIN CLEARANCE / L-R Δ"
            value={`${simulation.minBodyClearanceCm.toFixed(2)} / ${simulation.topologyDiagnostics.leftRightSymmetryErrorCm.toFixed(2)} cm`}
          />
          <MetricBox
            label="OVERALL ZONE STATUS"
            value={fitReport.overallFitStatus}
            tone={
              fitReport.overallFitStatus === 'PASS'
                ? 'success'
                : fitReport.overallFitStatus === 'MARGINAL_ADJUSTABLE'
                ? 'warning'
                : 'danger'
            }
          />
        </div>
      </div>

      {/* Main Split Grid: 3D Diagnostic Viewport + Analytical Benchmarks */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Interactive 3D Viewport */}
        <div className="lg:col-span-7 bg-white border border-neutral-200 rounded-sm overflow-hidden shadow-2xs flex flex-col">
          <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                { id: 'strain', label: 'Strain (%)' },
                { id: 'pressure', label: 'Pressure (kPa)' },
                { id: 'ease', label: 'Ease Slices' },
                { id: 'seams', label: 'Seam Graph' }
              ] as Array<{ id: ViewportHeatmapMode; label: string }>).map(mode => (
                <button
                  key={mode.id}
                  onClick={() => setHeatmapMode(mode.id)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-xs border cursor-pointer transition-colors ${
                    heatmapMode === mode.id
                      ? 'bg-neutral-900 text-white border-neutral-900'
                      : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowAvatarContours(v => !v)}
                className={`px-2 py-1 text-[11px] font-mono rounded-xs border cursor-pointer ${
                  showAvatarContours
                    ? 'bg-neutral-800 text-white border-neutral-800'
                    : 'bg-white text-neutral-600 border-neutral-300'
                }`}
              >
                <Eye className="w-3 h-3 inline mr-1" />Avatar SDF
              </button>
              <button
                onClick={() => setCamZoom(z => Math.min(2.0, Number((z + 0.15).toFixed(2))))}
                className="p-1 border border-neutral-300 rounded-xs bg-white hover:bg-neutral-100 cursor-pointer"
                aria-label="Zoom in 3D viewport"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCamZoom(z => Math.max(0.55, Number((z - 0.15).toFixed(2))))}
                className="p-1 border border-neutral-300 rounded-xs bg-white hover:bg-neutral-100 cursor-pointer"
                aria-label="Zoom out 3D viewport"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setYawDeg(28);
                  setPitchDeg(12);
                  setCamZoom(1.0);
                }}
                className="p-1 border border-neutral-300 rounded-xs bg-white hover:bg-neutral-100 cursor-pointer"
                aria-label="Reset 3D camera"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="relative flex-1 flex items-center justify-center bg-[#F7F5F0] p-2">
            <canvas
              ref={canvasRef}
              width={660}
              height={460}
              data-testid="m06-3d-viewport"
              onMouseDown={e => {
                dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
              }}
              onMouseMove={e => {
                if (!dragRef.current.active) return;
                const dx = e.clientX - dragRef.current.lastX;
                const dy = e.clientY - dragRef.current.lastY;
                dragRef.current.lastX = e.clientX;
                dragRef.current.lastY = e.clientY;
                setYawDeg(prev => prev + dx * 0.65);
                setPitchDeg(prev => Math.max(-45, Math.min(55, prev + dy * 0.45)));
              }}
              onMouseUp={() => {
                dragRef.current.active = false;
              }}
              onMouseLeave={() => {
                dragRef.current.active = false;
              }}
              className="w-full h-auto max-h-[460px] cursor-grab active:cursor-grabbing rounded-xs border border-neutral-200/80"
            />
            <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-xs border border-neutral-200 px-2.5 py-1 rounded-xs text-[10px] font-mono text-neutral-700">
              Drag to orbit • Yaw {Math.round(yawDeg)}° • Pitch {Math.round(pitchDeg)}° • {simulation.seamEdgeCount} seam springs
            </div>
            <div className="absolute top-4 right-4 flex gap-1">
              {[
                { label: 'Front', y: 0, p: 8 },
                { label: '3/4', y: 32, p: 12 },
                { label: 'Side', y: 90, p: 8 },
                { label: 'Back', y: 180, p: 8 }
              ].map(cam => (
                <button
                  key={cam.label}
                  onClick={() => {
                    setYawDeg(cam.y);
                    setPitchDeg(cam.p);
                  }}
                  className="px-2 py-0.5 text-[10px] font-mono bg-white/90 border border-neutral-300 rounded-xs hover:bg-neutral-900 hover:text-white cursor-pointer"
                >
                  {cam.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Analytical Benchmarks B1-B4 & Material Constitutive Tensor */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-neutral-200 rounded-sm p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-neutral-800" />
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900">
                  AC-08 Analytical Mechanics Gate (B1–B4)
                </h4>
              </div>
              <Badge variant={simulation.benchmarkQualification.allPassed ? 'success' : 'danger'} size="sm">
                {simulation.benchmarkQualification.allPassed ? 'ALL PASSED' : 'FAILED'}
              </Badge>
            </div>
            <div className="space-y-2" data-testid="m06-benchmarks-list">
              {simulation.benchmarkQualification.benchmarks.map(b => (
                <div
                  key={b.benchmarkId}
                  className="border border-neutral-200 rounded-xs p-2.5 bg-neutral-50/60 text-xs font-mono space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-neutral-900">{b.title}</span>
                    <Badge variant={b.passed ? 'success' : 'danger'} size="sm">
                      {b.passed ? 'PASS' : 'FAIL'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-neutral-600 flex flex-wrap justify-between gap-2">
                    <span>
                      Sim {b.measuredValue} vs Exact {b.analyticalValue} {b.unit}
                    </span>
                    <span className="font-semibold text-neutral-900">
                      Δ {b.errorValue} {b.errorUnit} (≤ {b.toleranceLimit})
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-500">{b.convergenceBehavior}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-neutral-200 rounded-sm p-4 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-neutral-800" />
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900">
                  Orthotropic Constitutive Spec (ADR-005)
                </h4>
              </div>
              <Badge variant={constitutiveMaterial.thermodynamicallyAdmissible ? 'success' : 'danger'} size="sm">
                {constitutiveMaterial.thermodynamicallyAdmissible ? 'ADMISSIBLE' : 'INVALID'}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2 bg-neutral-50 border border-neutral-200 rounded-xs">
                <span className="text-neutral-500 block">E_warp / E_weft</span>
                <strong className="text-neutral-900">
                  {constitutiveMaterial.eWarpNCm.toFixed(1)} / {constitutiveMaterial.eWeftNCm.toFixed(1)} N/cm
                </strong>
              </div>
              <div className="p-2 bg-neutral-50 border border-neutral-200 rounded-xs">
                <span className="text-neutral-500 block">G_12 Shear / ν_12</span>
                <strong className="text-neutral-900">
                  {constitutiveMaterial.gShearNCm.toFixed(1)} N/cm • {constitutiveMaterial.nu12.toFixed(3)}
                </strong>
              </div>
              <div className="p-2 bg-neutral-50 border border-neutral-200 rounded-xs">
                <span className="text-neutral-500 block">B_warp / Mass</span>
                <strong className="text-neutral-900">
                  {constitutiveMaterial.bWarpNCm.toFixed(3)} N·cm • {(constitutiveMaterial.densityKgM2 * 1000).toFixed(0)} g/m²
                </strong>
              </div>
              <div className="p-2 bg-neutral-50 border border-neutral-200 rounded-xs">
                <span className="text-neutral-500 block">Symmetry / det(C_2D)</span>
                <strong className="text-neutral-900">
                  {constitutiveMaterial.symmetryResidual.toExponential(1)} / {constitutiveMaterial.determinant2D.toFixed(0)}
                </strong>
              </div>
            </div>
            {constitutiveMaterial.warnings.length > 0 && (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded-xs text-[11px] text-amber-950">
                {constitutiveMaterial.warnings[0]}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quantitative Regional Fit Table (No Universal Scalar Score) */}
      <div className="bg-white border border-neutral-200 rounded-sm p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-100 pb-3 gap-2">
          <div>
            <h4 className="text-sm font-serif font-bold text-neutral-900">
              Quantitative Regional Fit Evaluation (Prohibits Single Universal Score)
            </h4>
            <p className="text-xs text-neutral-600">
              Hem Level Deviation: <strong className="font-mono">{fitReport.hemLevelDeviationCm.toFixed(2)} cm</strong> •
              Grainline Plumb Tilt: <strong className="font-mono">{fitReport.grainlinePlumbDeviationDeg.toFixed(2)}°</strong> •
              Physical Sample Validation Required (AC-09)
            </p>
          </div>
          <Badge variant="neutral" size="sm">
            {fitReport.evaluatedZoneOrder.length} ANATOMICAL ZONES
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono" data-testid="m06-fit-table">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500 uppercase text-[10px]">
                <th className="py-2 pr-3">Zone</th>
                <th className="py-2 pr-3">Body (cm)</th>
                <th className="py-2 pr-3">Draped (cm)</th>
                <th className="py-2 pr-3">Actual / Target Ease</th>
                <th className="py-2 pr-3">Peak Strain</th>
                <th className="py-2 pr-3">Contact Pressure</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Regional Diagnosis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {fitReport.evaluatedZoneOrder.map(zId => {
                const z = fitReport.regionalZones[zId];
                return (
                  <tr key={zId} className="hover:bg-neutral-50/70">
                    <td className="py-2.5 pr-3 font-bold text-neutral-900">{z.zoneLabel}</td>
                    <td className="py-2.5 pr-3 text-neutral-700">{z.bodyCircumferenceCm.toFixed(1)}</td>
                    <td className="py-2.5 pr-3 text-neutral-700">{z.drapedCircumferenceCm.toFixed(1)}</td>
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-neutral-900">{z.actualEaseCm.toFixed(2)}</span>
                      <span className="text-neutral-500"> / {z.targetEaseCm.toFixed(2)} cm</span>
                    </td>
                    <td className="py-2.5 pr-3 text-neutral-800">{z.maxStrainPct.toFixed(2)}%</td>
                    <td className="py-2.5 pr-3 text-neutral-800">
                      {z.meanContactPressureKpa.toFixed(2)} kPa
                      <span className="text-[10px] text-neutral-500 block">peak {z.maxContactPressureKpa.toFixed(1)}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <ZoneStatusBadge status={z.status} />
                    </td>
                    <td className="py-2.5 text-[11px] font-sans text-neutral-600">{z.diagnosis}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-neutral-50 border border-neutral-200 rounded-xs p-3 text-[11px] text-neutral-700 space-y-1">
          <div className="font-mono font-bold text-neutral-900 uppercase text-[10px]">
            Documented Model Assumptions &amp; Provenance Uncertainty
          </div>
          <p className="font-mono text-[10px] text-neutral-600">{fitReport.measurementUncertaintyNote}</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {fitReport.documentedAssumptions.map((assumption, idx) => (
              <li key={idx}>{assumption}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bounded Pattern Optimization & Independent Re-Validation (ADR-006) */}
      <div className="bg-white border border-neutral-200 rounded-sm p-4 shadow-2xs space-y-4" data-testid="m06-optimization-drawer">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 pb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-neutral-800" />
              <h4 className="text-sm font-serif font-bold text-neutral-900">
                Bounded Multi-Objective Pattern Optimizer (ADR-006)
              </h4>
              <Badge variant="dark" size="sm">±1.5 CM BOX BOUNDS</Badge>
            </div>
            <p className="text-xs text-neutral-600">
              Optimizes only declared recipe ease/strategy parameters, re-validates every candidate through M02/M04.3 from scratch, and emits an unapproved child revision requiring explicit designer approval.
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleRunOptimization}
            icon={<Compass className="w-3.5 h-3.5" />}
            data-testid="m06-run-optimization-btn"
          >
            Run Bounded Optimization
          </Button>
        </div>

        {optimizationResult ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-neutral-600 bg-neutral-50 border border-neutral-200 p-2.5 rounded-xs">
              <span>Evaluated: <strong>{optimizationResult.evaluatedCandidatesCount}</strong></span>
              <span>•</span>
              <span>Rejected by M02: <strong>{optimizationResult.rejectedByM02Count}</strong></span>
              <span>•</span>
              <span>Baseline Mean Ease Dev: <strong>{optimizationResult.baselineObjectives.easeDeviationCm.toFixed(2)} cm</strong></span>
              <span>•</span>
              <span className="text-amber-800 font-semibold">requiresHumanApproval: true</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {optimizationResult.proposals.map(prop => {
                const isApplied = appliedProposalId === prop.proposalId;
                return (
                  <div
                    key={prop.proposalId}
                    className={`border rounded-xs p-3.5 space-y-2.5 text-xs ${
                      isApplied ? 'border-emerald-600 bg-emerald-50/40' : 'border-neutral-200 bg-neutral-50/40'
                    }`}
                    data-testid="m06-optimization-proposal"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-mono">
                        <Badge variant={prop.paretoRank === 1 ? 'success' : 'neutral'} size="sm">
                          PARETO RANK #{prop.paretoRank}
                        </Badge>
                        <Badge variant="success" size="sm">M02 RE-VALIDATED</Badge>
                      </div>
                      <span className="text-[10px] font-mono text-neutral-500">
                        {prop.proposedDesignSpec.specificationRevisionId}
                      </span>
                    </div>

                    <p className="text-neutral-700 leading-relaxed">{prop.rationale}</p>

                    <div className="grid grid-cols-3 gap-2 text-[11px] font-mono bg-white border border-neutral-200 p-2 rounded-xs">
                      <div>
                        <span className="text-neutral-500 block">Ease Dev</span>
                        <strong>{prop.objectiveScoresAfter.easeDeviationCm.toFixed(2)} cm</strong>
                      </div>
                      <div>
                        <span className="text-neutral-500 block">Mean Strain</span>
                        <strong>{prop.objectiveScoresAfter.meanStrainEnergyPenalty.toFixed(2)}%</strong>
                      </div>
                      <div>
                        <span className="text-neutral-500 block">Style Δ</span>
                        <strong>{prop.objectiveScoresAfter.stylePreservationPenalty.toFixed(2)} cm</strong>
                      </div>
                    </div>

                    {prop.regionalDeltaSummary.length > 0 && (
                      <div className="bg-white border border-neutral-200 rounded-xs p-2 text-[10px] font-mono space-y-1">
                        <div className="text-neutral-500 uppercase font-bold">Before → After Regional Delta</div>
                        {prop.regionalDeltaSummary.map(dz => (
                          <div key={dz.zoneId} className="flex items-center justify-between gap-2 text-neutral-700">
                            <span className="truncate">{dz.zoneLabel}</span>
                            <span>
                              Ease {dz.easeDeltaBeforeCm > 0 ? '+' : ''}
                              {dz.easeDeltaBeforeCm.toFixed(2)} →{' '}
                              <strong>
                                {dz.easeDeltaAfterCm > 0 ? '+' : ''}
                                {dz.easeDeltaAfterCm.toFixed(2)} cm
                              </strong>{' '}
                              • {dz.statusBefore} → <strong>{dz.statusAfter}</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] font-mono text-neutral-500">
                        Child Revision State: <strong className="text-amber-800">DRAFT (UNAPPROVED)</strong>
                      </span>
                      <Button
                        variant={isApplied ? 'outline' : 'primary'}
                        size="sm"
                        onClick={() => handleApproveProposal(prop)}
                        icon={<GitBranch className="w-3.5 h-3.5" />}
                        data-testid="m06-approve-proposal-btn"
                      >
                        {isApplied ? 'Child Revision Applied' : 'Approve & Branch Child'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-xs text-neutral-500 font-mono bg-neutral-50 border border-dashed border-neutral-300 rounded-xs p-4 text-center">
            Click &ldquo;Run Bounded Optimization&rdquo; to explore Pareto-optimal ease recipes inside ±1.5 cm box limits with independent M02 re-validation.
          </div>
        )}
      </div>

      {/* AC-09 Physical Toile Fit Concordance Protocol & Evidence Recorder (M06 §18) */}
      <div className="bg-white border border-neutral-200 rounded-sm p-4 shadow-2xs space-y-4" data-testid="m06-ac09-panel">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-neutral-100 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <ClipboardCheck className="w-4 h-4 text-neutral-800" />
              <h4 className="text-sm font-serif font-bold text-neutral-900">
                AC-09 Physical vs. Digital Toile Validation Protocol (M06 §18)
              </h4>
              <Badge
                variant={
                  activeAc09Evaluation.status === 'PASSED'
                    ? 'success'
                    : activeAc09Evaluation.status === 'FAILED'
                    ? 'danger'
                    : 'warning'
                }
                size="sm"
                data-testid="m06-ac09-status-badge"
              >
                AC-09: {activeAc09Evaluation.status}
              </Badge>
            </div>
            <p className="text-xs text-neutral-600">
              Sewn toile verification requires physical POM concordance ≤ 0.50 cm and ≥ 85% regional fit-issue agreement before Release Level A sign-off. Zero fabricated sample values are pre-filled.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['skirt-block-v1', 'bodice-sleeve-v1'] as Ac09ToileBlockKey[]).map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setAc09ActiveBlock(key)}
                data-testid={`m06-ac09-tab-${key}`}
                className={`px-2.5 py-1 text-[11px] font-mono rounded-xs border cursor-pointer ${
                  ac09ActiveBlock === key
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                {key}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                setAc09Records(prev => ({
                  ...prev,
                  [ac09ActiveBlock]: createPendingAc09ToileRecord({
                    toileBlockKey: ac09ActiveBlock,
                    designSpec: currentSpec,
                    measurements,
                    fitReport:
                      (ac09ActiveBlock === 'bodice-sleeve-v1') === (currentSpec.garmentCategory === 'bodice')
                        ? fitReport
                        : undefined,
                    poseId
                  })
                }))
              }
              className="px-2.5 py-1 text-[11px] font-mono rounded-xs border border-neutral-300 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 cursor-pointer"
            >
              Reset Pending
            </button>
          </div>
        </div>

        {/* Protocol Summary & Metadata Fields */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
          <div className="border border-neutral-200 bg-neutral-50 p-2.5 rounded-xs">
            <span className="text-[10px] text-neutral-500 block uppercase">POM Concordance (≤ 0.50 cm)</span>
            <strong>
              {activeAc09Evaluation.completedPomCount}/{activeAc09Evaluation.requiredPomCount} recorded
              {activeAc09Evaluation.maxPomConcordanceErrorCm !== null
                ? ` (max Δ ${activeAc09Evaluation.maxPomConcordanceErrorCm.toFixed(2)} cm)`
                : ' • Awaiting Tape'}
            </strong>
          </div>
          <div className="border border-neutral-200 bg-neutral-50 p-2.5 rounded-xs">
            <span className="text-[10px] text-neutral-500 block uppercase">Regional Fit Agreement (≥ 85%)</span>
            <strong>
              {activeAc09Evaluation.regionalAgreementPct !== null
                ? `${activeAc09Evaluation.regionalAgreementPct.toFixed(1)}% (${activeAc09Evaluation.agreedZonesCount}/${activeAc09Evaluation.evaluatedZonesCount})`
                : `0/${activeAc09Record.regionalAgreementChecks.length} evaluated`}
            </strong>
          </div>
          <label className="border border-neutral-200 bg-white p-2 rounded-xs block">
            <span className="text-[10px] text-neutral-500 block uppercase">Evaluator Identity</span>
            <input
              type="text"
              value={activeAc09Record.evaluatorName}
              onChange={e =>
                updateActiveAc09Record(r => ({
                  ...r,
                  evaluatorName: e.target.value,
                  evaluatedAt: r.evaluatedAt ?? new Date().toISOString().slice(0, 10)
                }))
              }
              placeholder="Patternmaker / Tailor name"
              className="w-full mt-0.5 text-xs font-sans text-neutral-900 border-b border-neutral-200 focus:outline-none focus:border-neutral-900"
            />
          </label>
          <label className="border border-neutral-200 bg-white p-2 rounded-xs block">
            <span className="text-[10px] text-neutral-500 block uppercase">Dress Form / Body ID</span>
            <input
              type="text"
              value={activeAc09Record.bodyOrDressFormId}
              onChange={e =>
                updateActiveAc09Record(r => ({
                  ...r,
                  bodyOrDressFormId: e.target.value,
                  evaluatedAt: r.evaluatedAt ?? new Date().toISOString().slice(0, 10)
                }))
              }
              placeholder="e.g., Wolf-M-Form-01"
              className="w-full mt-0.5 text-xs font-sans text-neutral-900 border-b border-neutral-200 focus:outline-none focus:border-neutral-900"
            />
          </label>
        </div>

        {/* POM & Regional Agreement Checklists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-neutral-200 rounded-xs overflow-hidden">
            <div className="bg-neutral-50 px-3 py-2 border-b border-neutral-200 text-[11px] font-mono font-bold text-neutral-900 uppercase">
              Physical POM Measurements ({activeAc09Record.sizeCode} • {activeAc09Record.fabricName})
            </div>
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-neutral-200 text-[10px] text-neutral-500">
                  <th className="p-2">Checkpoint</th>
                  <th className="p-2">CAD (cm)</th>
                  <th className="p-2">Physical (cm)</th>
                  <th className="p-2">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {activeAc09Record.pomCheckpoints.map(pt => (
                  <tr key={pt.pointId}>
                    <td className="p-2 font-sans text-neutral-800">{pt.label}</td>
                    <td className="p-2 text-neutral-700">{pt.nominalCadCm.toFixed(2)}</td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        aria-label={`Measured physical cm for ${pt.label}`}
                        value={pt.measuredToileCm ?? ''}
                        onChange={e => {
                          const raw = e.target.value.trim();
                          const val = raw === '' ? null : Number(raw);
                          updateActiveAc09Record(r => updateAc09PomMeasurement(r, pt.pointId, val));
                        }}
                        placeholder="Pending"
                        className="w-20 px-1.5 py-0.5 border border-neutral-300 rounded-xs text-xs font-mono bg-white"
                      />
                    </td>
                    <td className="p-2">
                      {pt.deltaCm === null ? (
                        <span className="text-neutral-400">PENDING</span>
                      ) : (
                        <span className={pt.withinTolerance ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>
                          {pt.deltaCm > 0 ? '+' : ''}
                          {pt.deltaCm.toFixed(2)} cm
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="border border-neutral-200 rounded-xs p-3 space-y-2">
              <div className="text-[11px] font-mono font-bold text-neutral-900 uppercase">
                Regional Fit-Issue Agreement vs Digital Report
              </div>
              {activeAc09Record.regionalAgreementChecks.map(rz => (
                <div key={rz.zoneId} className="flex items-center justify-between gap-2 text-xs border-b border-neutral-100 pb-1.5 last:border-b-0 last:pb-0">
                  <div>
                    <strong className="text-neutral-900">{rz.zoneLabel}</strong>
                    <span className="text-[11px] text-neutral-500 block">Digital: {rz.digitalPredictionStatus}</span>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() =>
                        updateActiveAc09Record(r => ({
                          ...r,
                          regionalAgreementChecks: r.regionalAgreementChecks.map(item =>
                            item.zoneId === rz.zoneId
                              ? { ...item, agreesWithDigitalPrediction: true, physicalObservationSummary: 'Matches physical toile fit behavior' }
                              : item
                          )
                        }))
                      }
                      className={`px-2 py-0.5 border rounded-xs cursor-pointer ${
                        rz.agreesWithDigitalPrediction === true
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-white text-neutral-700 border-neutral-300'
                      }`}
                    >
                      Agree
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateActiveAc09Record(r => ({
                          ...r,
                          regionalAgreementChecks: r.regionalAgreementChecks.map(item =>
                            item.zoneId === rz.zoneId
                              ? { ...item, agreesWithDigitalPrediction: false, physicalObservationSummary: 'Diverges from digital diagnostic' }
                              : item
                          )
                        }))
                      }
                      className={`px-2 py-0.5 border rounded-xs cursor-pointer ${
                        rz.agreesWithDigitalPrediction === false
                          ? 'bg-red-700 text-white border-red-700'
                          : 'bg-white text-neutral-700 border-neutral-300'
                      }`}
                    >
                      Diverge
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="border border-neutral-200 rounded-xs p-3 space-y-2 text-xs">
              <div className="text-[11px] font-mono font-bold text-neutral-900 uppercase">
                Photographic, Grainline &amp; Seam Evidence Checklist ({activeAc09Evaluation.evidenceCompletedCount}/{activeAc09Evaluation.requiredEvidenceCount})
              </div>
              <div className="flex flex-wrap items-center gap-4 border-b border-neutral-100 pb-2">
                <label className="flex items-center gap-1.5 text-[11px] font-mono text-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeAc09Record.grainlineVerified}
                    onChange={e => updateActiveAc09Record(r => ({ ...r, grainlineVerified: e.target.checked }))}
                  />
                  Grainline Plumb Verified
                </label>
                <label className="flex items-center gap-1.5 text-[11px] font-mono text-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeAc09Record.seamAlignmentVerified === true}
                    onChange={e => updateActiveAc09Record(r => ({ ...r, seamAlignmentVerified: e.target.checked ? true : null }))}
                  />
                  Seams Alignment Verified
                </label>
              </div>
              {activeAc09Record.evidenceChecklist.map(ev => (
                <label key={ev.itemId} className="flex items-start gap-2 text-[11px] text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ev.recorded}
                    onChange={e =>
                      updateActiveAc09Record(r => ({
                        ...r,
                        evidenceChecklist: r.evidenceChecklist.map(item =>
                          item.itemId === ev.itemId ? { ...item, recorded: e.target.checked } : item
                        )
                      }))
                    }
                    className="mt-0.5"
                  />
                  <span>{ev.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-neutral-50 border border-neutral-200 rounded-xs p-2.5 text-xs font-mono text-neutral-800">
          {activeAc09Evaluation.summary}
        </div>
      </div>

      {/* Epistemic Honesty Footer */}
      <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 text-xs text-amber-950 flex items-start gap-2.5">
        <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <p>{fitReport.disclaimer}</p>
      </div>
    </div>
  );
};

const MetricBox: React.FC<{
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}> = ({ label, value, tone = 'default' }) => {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-800 bg-emerald-50/70 border-emerald-200'
      : tone === 'warning'
      ? 'text-amber-900 bg-amber-50/70 border-amber-200'
      : tone === 'danger'
      ? 'text-red-800 bg-red-50/70 border-red-200'
      : 'text-neutral-900 bg-neutral-50 border-neutral-200';
  return (
    <div className={`border rounded-xs p-2 ${toneClass}`}>
      <span className="text-[10px] uppercase tracking-wider opacity-75 block">{label}</span>
      <strong className="text-xs">{value}</strong>
    </div>
  );
};

const ZoneStatusBadge: React.FC<{ status: ZoneFitStatus }> = ({ status }) => {
  if (status === 'PASS') {
    return (
      <Badge variant="success" size="sm">
        <CheckCircle2 className="w-3 h-3 inline mr-1" />PASS
      </Badge>
    );
  }
  if (status === 'MARGINAL_ADJUSTABLE') {
    return (
      <Badge variant="warning" size="sm">
        <AlertTriangle className="w-3 h-3 inline mr-1" />MARGINAL
      </Badge>
    );
  }
  return (
    <Badge variant="danger" size="sm">
      <ShieldAlert className="w-3 h-3 inline mr-1" />FAIL
    </Badge>
  );
};

function strainToRgb(strainPct: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, strainPct / 10));
  if (t < 0.5) {
    const k = t * 2;
    return [
      Math.round(160 + 85 * k),
      Math.round(215 - 35 * k),
      Math.round(180 - 110 * k)
    ];
  }
  const k = (t - 0.5) * 2;
  return [
    Math.round(245 - 25 * k),
    Math.round(180 - 135 * k),
    Math.round(70 - 20 * k)
  ];
}

function pressureToRgb(kpa: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, kpa / 3.0));
  return [
    Math.round(230 - 130 * t),
    Math.round(230 - 110 * t),
    Math.round(225 + 25 * t)
  ];
}

function clearanceToRgb(clearanceCm: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, clearanceCm / 2.2));
  return [
    Math.round(220 - 110 * t),
    Math.round(215 + 20 * t),
    Math.round(205 + 35 * t)
  ];
}
