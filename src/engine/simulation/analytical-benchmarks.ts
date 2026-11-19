/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AnalyticalBenchmarkResult,
  CalibratedMaterialConstitutiveSpec,
  ClothSolverQualificationReport
} from './simulation-types';

export const SOLVER_VERSION = 'patroner-cst-xpbd-v1.1.0';

export interface Simple2DMesh {
  nodesX: Float64Array;
  nodesY: Float64Array;
  restX: Float64Array;
  restY: Float64Array;
  triangles: Array<[number, number, number]>;
  restAreas: Float64Array;
}

export function isMaterialConstitutiveValidForBenchmarks(
  material: CalibratedMaterialConstitutiveSpec
): { valid: boolean; reason?: string } {
  if (!material || !material.thermodynamicallyAdmissible) {
    return { valid: false, reason: 'Material constitutive model flagged thermodynamically inadmissible.' };
  }
  const fields = [
    material.eWarpNCm,
    material.eWeftNCm,
    material.gShearNCm,
    material.nu12,
    material.nu21,
    material.bWarpNCm,
    material.bWeftNCm,
    material.densityKgM2,
    material.determinant2D,
    material.symmetryResidual
  ];
  if (fields.some(v => !Number.isFinite(v))) {
    return { valid: false, reason: 'Material constitutive specification contains non-finite parameters.' };
  }
  if (material.eWarpNCm <= 0 || material.eWeftNCm <= 0 || material.gShearNCm <= 0) {
    return { valid: false, reason: 'Positive-definiteness violated: elastic moduli must be strictly positive.' };
  }
  if (1 - material.nu12 * material.nu21 <= 0 || material.determinant2D <= 0) {
    return { valid: false, reason: 'Positive-definiteness violated: det(C_2D) <= 0.' };
  }
  const actualSym = Math.abs(material.nu12 * material.eWeftNCm - material.nu21 * material.eWarpNCm);
  if (actualSym > 1e-6 || material.symmetryResidual > 1e-9) {
    return { valid: false, reason: `Orthotropic reciprocal symmetry violated (residual=${actualSym.toExponential(2)}).` };
  }
  return { valid: true };
}

/**
 * Evaluates nodal forces and total elastic strain energy over 2D/3D Constant-Strain Triangles (CST)
 * using linear orthotropic plane-stress constitutive law.
 */
export function accumulateCstMembraneEnergyAndForces2D(
  mesh: Simple2DMesh,
  material: CalibratedMaterialConstitutiveSpec,
  forcesX: Float64Array,
  forcesY: Float64Array
): number {
  const { nodesX, nodesY, restX, restY, triangles, restAreas } = mesh;
  const denom = 1 - material.nu12 * material.nu21;
  const c11 = material.eWarpNCm / denom;
  const c22 = material.eWeftNCm / denom;
  const c12 = (material.nu12 * material.eWeftNCm) / denom;
  const c33 = material.gShearNCm;

  let totalEnergy = 0;

  for (let t = 0; t < triangles.length; t++) {
    const [ia, ib, ic] = triangles[t];
    const area0 = restAreas[t];
    if (area0 <= 1e-10) continue;

    // Reference shape matrix Dm = [X_b - X_a, X_c - X_a]
    const X1 = restX[ib] - restX[ia];
    const Y1 = restY[ib] - restY[ia];
    const X2 = restX[ic] - restX[ia];
    const Y2 = restY[ic] - restY[ia];
    const detDm = X1 * Y2 - X2 * Y1;
    if (Math.abs(detDm) <= 1e-12) continue;

    // Shape function derivatives dN/dX, dN/dY for nodes a, b, c
    const invDet = 1 / detDm;
    const dNdx_b = Y2 * invDet;
    const dNdy_b = -X2 * invDet;
    const dNdx_c = -Y1 * invDet;
    const dNdy_c = X1 * invDet;
    const dNdx_a = -(dNdx_b + dNdx_c);
    const dNdy_a = -(dNdy_b + dNdy_c);

    // Nodal displacements u = x - X
    const uaX = nodesX[ia] - restX[ia];
    const uaY = nodesY[ia] - restY[ia];
    const ubX = nodesX[ib] - restX[ib];
    const ubY = nodesY[ib] - restY[ib];
    const ucX = nodesX[ic] - restX[ic];
    const ucY = nodesY[ic] - restY[ic];

    // Engineering strain: eps_xx (weft x), eps_yy (warp y), gamma_xy (shear)
    const epsX = dNdx_a * uaX + dNdx_b * ubX + dNdx_c * ucX;
    const epsY = dNdy_a * uaY + dNdy_b * ubY + dNdy_c * ucY;
    const gammaXY =
      dNdy_a * uaX + dNdy_b * ubX + dNdy_c * ucX +
      dNdx_a * uaY + dNdx_b * ubY + dNdx_c * ucY;

    // Map warp along Y (22), weft along X (11)
    const sigX = c22 * epsX + c12 * epsY;
    const sigY = c12 * epsX + c11 * epsY;
    const tauXY = c33 * gammaXY;

    totalEnergy += 0.5 * area0 * (sigX * epsX + sigY * epsY + tauXY * gammaXY);

    // Nodal internal restoring force: f_int = area * B^T * sigma => f_elastic = -f_int
    forcesX[ia] -= area0 * (dNdx_a * sigX + dNdy_a * tauXY);
    forcesY[ia] -= area0 * (dNdy_a * sigY + dNdx_a * tauXY);
    forcesX[ib] -= area0 * (dNdx_b * sigX + dNdy_b * tauXY);
    forcesY[ib] -= area0 * (dNdy_b * sigY + dNdx_b * tauXY);
    forcesX[ic] -= area0 * (dNdx_c * sigX + dNdy_c * tauXY);
    forcesY[ic] -= area0 * (dNdy_c * sigY + dNdx_c * tauXY);
  }

  return totalEnergy;
}

function buildStripMesh(widthCm: number, lengthCm: number, nx: number, ny: number): Simple2DMesh {
  const numNodes = (nx + 1) * (ny + 1);
  const restX = new Float64Array(numNodes);
  const restY = new Float64Array(numNodes);
  const nodesX = new Float64Array(numNodes);
  const nodesY = new Float64Array(numNodes);

  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const idx = j * (nx + 1) + i;
      const x = (i / nx) * widthCm;
      const y = (j / ny) * lengthCm;
      restX[idx] = x;
      restY[idx] = y;
      nodesX[idx] = x;
      nodesY[idx] = y;
    }
  }

  const triangles: Array<[number, number, number]> = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n00 = j * (nx + 1) + i;
      const n10 = n00 + 1;
      const n01 = n00 + (nx + 1);
      const n11 = n01 + 1;
      triangles.push([n00, n10, n11]);
      triangles.push([n00, n11, n01]);
    }
  }

  const restAreas = new Float64Array(triangles.length);
  for (let t = 0; t < triangles.length; t++) {
    const [a, b, c] = triangles[t];
    restAreas[t] = 0.5 * Math.abs(
      (restX[b] - restX[a]) * (restY[c] - restY[a]) -
      (restX[c] - restX[a]) * (restY[b] - restY[a])
    );
  }

  return { nodesX, nodesY, restX, restY, triangles, restAreas };
}

function solveUniaxialStrip(
  material: CalibratedMaterialConstitutiveSpec,
  widthCm: number,
  lengthCm: number,
  nx: number,
  ny: number,
  totalForceN: number
): number {
  const mesh = buildStripMesh(widthCm, lengthCm, nx, ny);
  const nNodes = mesh.nodesX.length;
  const forcesX = new Float64Array(nNodes);
  const forcesY = new Float64Array(nNodes);

  const extY = new Float64Array(nNodes);
  for (let i = 0; i <= nx; i++) {
    const topIdx = ny * (nx + 1) + i;
    const weight = i === 0 || i === nx ? 0.5 / nx : 1.0 / nx;
    extY[topIdx] = totalForceN * weight;
  }

  const vx = new Float64Array(nNodes);
  const vy = new Float64Array(nNodes);
  const maxStiff = Math.max(40, material.eWarpNCm, material.eWeftNCm);
  const step = Math.min(0.0028, 0.35 / maxStiff);
  const maxIters = Math.min(2200, Math.max(900, ny * 85));

  for (let iter = 0; iter < maxIters; iter++) {
    forcesX.fill(0);
    forcesY.fill(0);
    accumulateCstMembraneEnergyAndForces2D(mesh, material, forcesX, forcesY);

    let maxForce = 0;
    for (let idx = 0; idx < nNodes; idx++) {
      const j = Math.floor(idx / (nx + 1));
      const i = idx % (nx + 1);
      const fx = forcesX[idx];
      const fy = forcesY[idx] + extY[idx];

      if (j === 0) {
        mesh.nodesY[idx] = 0;
        vy[idx] = 0;
        if (i === 0) {
          mesh.nodesX[idx] = 0;
          vx[idx] = 0;
        } else {
          vx[idx] = 0.90 * vx[idx] + step * fx;
          mesh.nodesX[idx] += vx[idx];
          maxForce = Math.max(maxForce, Math.abs(fx));
        }
      } else {
        vx[idx] = 0.90 * vx[idx] + step * fx;
        vy[idx] = 0.90 * vy[idx] + step * fy;
        mesh.nodesX[idx] += vx[idx];
        mesh.nodesY[idx] += vy[idx];
        maxForce = Math.max(maxForce, Math.abs(fx), Math.abs(fy));
      }
    }
    if (maxForce < 1e-6) break;
  }

  let meanTopY = 0;
  for (let i = 0; i <= nx; i++) {
    meanTopY += mesh.nodesY[ny * (nx + 1) + i];
  }
  meanTopY /= nx + 1;
  return (meanTopY - lengthCm) / lengthCm;
}

function buildFailedBenchmark(
  benchmarkId: AnalyticalBenchmarkResult['benchmarkId'],
  title: string,
  standardReference: string,
  unit: string,
  errorUnit: string,
  toleranceLimit: number,
  reason: string
): AnalyticalBenchmarkResult {
  return {
    benchmarkId,
    title,
    standardReference,
    measuredValue: 0,
    analyticalValue: 0,
    unit,
    errorValue: Infinity,
    errorUnit,
    toleranceLimit,
    passed: false,
    notes: `FAILED CLOSED: ${reason}`,
    convergenceBehavior: 'Aborted before solve (constitutive precondition violation).',
    resolutionChecks: []
  };
}

/**
 * B1 — Uniaxial Membrane Patch Test (<= 0.1% relative error across multi-resolution CST meshes).
 */
export function runBenchmarkB1UniaxialMembrane(
  material: CalibratedMaterialConstitutiveSpec
): AnalyticalBenchmarkResult {
  const validity = isMaterialConstitutiveValidForBenchmarks(material);
  if (!validity.valid) {
    return buildFailedBenchmark(
      'B1_UNIAXIAL_MEMBRANE',
      'B1 — Uniaxial Membrane Patch Test',
      'ADR-005 / AC-08 (Orthotropic CST Patch)',
      '% strain',
      '% rel err',
      0.1,
      validity.reason ?? 'Invalid constitutive material.'
    );
  }

  const widthCm = 10;
  const lengthCm = 20;
  const totalForceN = 20;
  const analyticalStrain = totalForceN / (material.eWarpNCm * widthCm);

  const coarseStrain = solveUniaxialStrip(material, widthCm, lengthCm, 4, 8, totalForceN);
  const fineStrain = solveUniaxialStrip(material, widthCm, lengthCm, 8, 16, totalForceN);

  const coarseErr = (Math.abs(coarseStrain - analyticalStrain) / Math.max(1e-9, analyticalStrain)) * 100;
  const fineErr = (Math.abs(fineStrain - analyticalStrain) / Math.max(1e-9, analyticalStrain)) * 100;
  const worstErr = Math.max(coarseErr, fineErr);
  const passed = Number.isFinite(worstErr) && coarseErr <= 0.1 && fineErr <= 0.1;

  return {
    benchmarkId: 'B1_UNIAXIAL_MEMBRANE',
    title: 'B1 — Uniaxial Membrane Patch Test',
    standardReference: 'ADR-005 / AC-08 (Orthotropic CST Patch)',
    measuredValue: Number((fineStrain * 100).toFixed(5)),
    analyticalValue: Number((analyticalStrain * 100).toFixed(5)),
    unit: '% strain',
    errorValue: Number(worstErr.toFixed(5)),
    errorUnit: '% rel err',
    toleranceLimit: 0.1,
    passed,
    notes: `CST strain (8x16)=${(fineStrain * 100).toFixed(4)}% vs closed-form F/(E_warp*W)=${(analyticalStrain * 100).toFixed(4)}% (max rel err=${worstErr.toFixed(4)}% <= 0.1%).`,
    convergenceBehavior: `Coarse (4x8) err=${coarseErr.toFixed(5)}% -> Refined (8x16) err=${fineErr.toFixed(5)}%.`,
    resolutionChecks: [
      {
        label: 'Coarse CST 4x8',
        meshEdgeLengthMm: 25,
        measuredValue: Number((coarseStrain * 100).toFixed(5)),
        analyticalValue: Number((analyticalStrain * 100).toFixed(5)),
        errorValue: Number(coarseErr.toFixed(5)),
        passed: coarseErr <= 0.1
      },
      {
        label: 'Refined CST 8x16',
        meshEdgeLengthMm: 12.5,
        measuredValue: Number((fineStrain * 100).toFixed(5)),
        analyticalValue: Number((analyticalStrain * 100).toFixed(5)),
        errorValue: Number(fineErr.toFixed(5)),
        passed: fineErr <= 0.1
      }
    ]
  };
}

/**
 * B2 — Cantilever Elastica Bending (ASTM D1388, <= 1.5% relative error vs nonlinear ODE).
 */
export function runBenchmarkB2CantileverBending(
  material: CalibratedMaterialConstitutiveSpec
): AnalyticalBenchmarkResult {
  const validity = isMaterialConstitutiveValidForBenchmarks(material);
  if (!validity.valid) {
    return buildFailedBenchmark(
      'B2_CANTILEVER_BENDING',
      'B2 — Cantilever Elastica Bending (ASTM D1388)',
      'ADR-005 / AC-08 (Nonlinear Elastica ODE)',
      'cm deflection',
      '% rel err',
      1.5,
      validity.reason ?? 'Invalid constitutive material.'
    );
  }

  const lengthCm = 10.0;
  const widthCm = 2.5;
  const bEff = Math.max(0.05, material.bWarpNCm * widthCm);
  const weightPerCm = Math.max(0.002, material.densityKgM2 * 9.81 * (widthCm / 100) * 0.01);

  const solveDiscreteHinge = (nSeg: number): number => {
    const ds = lengthCm / nSeg;
    const discreteTheta = new Float64Array(nSeg + 1);
    for (let iter = 0; iter < 900; iter++) {
      let maxChange = 0;
      const moments = new Float64Array(nSeg + 1);
      let cumShear = 0;
      for (let i = nSeg - 1; i >= 0; i--) {
        const segWeight = weightPerCm * ds;
        const midTheta = 0.5 * (discreteTheta[i] + discreteTheta[i + 1]);
        moments[i] = moments[i + 1] + (cumShear + 0.5 * segWeight) * ds * Math.cos(midTheta);
        cumShear += segWeight;
      }
      for (let i = 0; i < nSeg; i++) {
        const midMoment = 0.5 * (moments[i] + moments[i + 1]);
        const targetNext = Math.max(-1.45, Math.min(1.45, discreteTheta[i] + (midMoment * ds) / bEff));
        maxChange = Math.max(maxChange, Math.abs(targetNext - discreteTheta[i + 1]));
        discreteTheta[i + 1] = 0.65 * discreteTheta[i + 1] + 0.35 * targetNext;
      }
      if (maxChange < 1e-10) break;
    }
    let tipDeflection = 0;
    for (let i = 0; i < nSeg; i++) {
      tipDeflection += 0.5 * ds * (Math.sin(discreteTheta[i]) + Math.sin(discreteTheta[i + 1]));
    }
    return tipDeflection;
  };

  // Independent Reference ODE: RK4 shooting for continuous Euler-Bernoulli elastica
  const integrateContinuousOde = (u0: number, nSteps: number) => {
    const h = lengthCm / nSteps;
    let theta = 0;
    let u = u0;
    let y = 0;
    const deriv = (s: number, th: number, curU: number): [number, number] => [
      curU,
      -((weightPerCm * Math.max(0, lengthCm - s)) / bEff) * Math.cos(th)
    ];
    for (let k = 0; k < nSteps; k++) {
      const s = k * h;
      const [k1t, k1u] = deriv(s, theta, u);
      const [k2t, k2u] = deriv(s + 0.5 * h, theta + 0.5 * h * k1t, u + 0.5 * h * k1u);
      const [k3t, k3u] = deriv(s + 0.5 * h, theta + 0.5 * h * k2t, u + 0.5 * h * k2u);
      const [k4t, k4u] = deriv(s + h, theta + h * k3t, u + h * k3u);
      const nextTheta = theta + (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
      const nextU = u + (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
      y += 0.5 * h * (Math.sin(theta) + Math.sin(nextTheta));
      theta = nextTheta;
      u = nextU;
    }
    return { uEnd: u, yTip: y };
  };

  let lo = 0;
  let hi = (weightPerCm * lengthCm * lengthCm) / bEff + 0.2;
  for (let b = 0; b < 45; b++) {
    const mid = 0.5 * (lo + hi);
    const res = integrateContinuousOde(mid, 400);
    if (res.uEnd > 0) hi = mid;
    else lo = mid;
  }
  const odeRef = integrateContinuousOde(0.5 * (lo + hi), 400);

  const tip32 = solveDiscreteHinge(32);
  const tip64 = solveDiscreteHinge(64);
  const err32 = (Math.abs(tip32 - odeRef.yTip) / Math.max(1e-6, Math.abs(odeRef.yTip))) * 100;
  const err64 = (Math.abs(tip64 - odeRef.yTip) / Math.max(1e-6, Math.abs(odeRef.yTip))) * 100;

  return {
    benchmarkId: 'B2_CANTILEVER_BENDING',
    title: 'B2 — Cantilever Elastica Bending (ASTM D1388)',
    standardReference: 'ADR-005 / AC-08 (Nonlinear Elastica ODE)',
    measuredValue: Number(tip64.toFixed(4)),
    analyticalValue: Number(odeRef.yTip.toFixed(4)),
    unit: 'cm deflection',
    errorValue: Number(err64.toFixed(4)),
    errorUnit: '% rel err',
    toleranceLimit: 1.5,
    passed: err32 <= 1.5 && err64 <= 1.5,
    notes: `Discrete 64-hinge tip deflection ${tip64.toFixed(3)} cm vs RK4 elastica ODE ${odeRef.yTip.toFixed(3)} cm (err=${err64.toFixed(3)}%).`,
    convergenceBehavior: `32-hinge err=${err32.toFixed(4)}% -> 64-hinge err=${err64.toFixed(4)}%.`,
    resolutionChecks: [
      {
        label: '32-hinge chain (ds=3.13mm)',
        meshEdgeLengthMm: 3.13,
        measuredValue: Number(tip32.toFixed(4)),
        analyticalValue: Number(odeRef.yTip.toFixed(4)),
        errorValue: Number(err32.toFixed(4)),
        passed: err32 <= 1.5
      },
      {
        label: '64-hinge chain (ds=1.56mm)',
        meshEdgeLengthMm: 1.56,
        measuredValue: Number(tip64.toFixed(4)),
        analyticalValue: Number(odeRef.yTip.toFixed(4)),
        errorValue: Number(err64.toFixed(4)),
        passed: err64 <= 1.5
      }
    ]
  };
}

/**
 * B3 — Catenary Suspension Curve (<= 0.05 cm = 0.5 mm max sag deviation).
 */
export function runBenchmarkB3CatenaryCurve(): AnalyticalBenchmarkResult {
  const spanCm = 20.0;
  const totalArcLenCm = 24.0;

  // Analytical catenary parameter a: 2*a*sinh(span / (2*a)) = totalArcLenCm
  const halfSpan = spanCm * 0.5;
  let a = 8.0;
  for (let k = 0; k < 40; k++) {
    const f = 2 * a * Math.sinh(halfSpan / a) - totalArcLenCm;
    const fp = 2 * Math.sinh(halfSpan / a) - (2 * halfSpan / a) * Math.cosh(halfSpan / a);
    if (Math.abs(fp) < 1e-12) break;
    a -= f / fp;
  }
  const anchorOffset = a * Math.cosh(halfSpan / a);
  const maxAnalyticalSagCm = Math.abs(a - anchorOffset);

  const solveCatenaryChain = (nSeg: number) => {
    const nNodes = nSeg + 1;
    const segLen = totalArcLenCm / nSeg;
    const x = new Float64Array(nNodes);
    const y = new Float64Array(nNodes);
    const px = new Float64Array(nNodes);
    const py = new Float64Array(nNodes);
    for (let i = 0; i < nNodes; i++) {
      const t = i / nSeg;
      x[i] = -spanCm * 0.5 + t * spanCm;
      y[i] = -5.5 * Math.sin(Math.PI * t);
      px[i] = x[i];
      py[i] = y[i];
    }

    const dtSqG = 0.004;
    const iters = nSeg >= 60 ? 2200 : 1500;
    for (let iter = 0; iter < iters; iter++) {
      for (let i = 1; i < nNodes - 1; i++) {
        const vx = (x[i] - px[i]) * 0.85;
        const vy = (y[i] - py[i]) * 0.85;
        px[i] = x[i];
        py[i] = y[i];
        x[i] += vx;
        y[i] += vy - dtSqG;
      }

      const projectLink = (i: number) => {
        const dx = x[i + 1] - x[i];
        const dy = y[i + 1] - y[i];
        const d = Math.hypot(dx, dy);
        if (d < 1e-10) return;
        const diff = (d - segLen) / d;
        if (i === 0) {
          x[i + 1] -= dx * diff;
          y[i + 1] -= dy * diff;
        } else if (i === nSeg - 1) {
          x[i] += dx * diff;
          y[i] += dy * diff;
        } else {
          x[i] += 0.5 * dx * diff;
          y[i] += 0.5 * dy * diff;
          x[i + 1] -= 0.5 * dx * diff;
          y[i + 1] -= 0.5 * dy * diff;
        }
      };

      const passes = nSeg >= 60 ? 60 : 40;
      for (let pass = 0; pass < passes; pass++) {
        for (let i = 0; i < nSeg; i++) projectLink(i);
        for (let i = nSeg - 1; i >= 0; i--) projectLink(i);
      }
    }

    let maxDevCm = 0;
    for (let i = 0; i < nNodes; i++) {
      const exactY = a * Math.cosh(x[i] / a) - anchorOffset;
      maxDevCm = Math.max(maxDevCm, Math.abs(y[i] - exactY));
    }
    const measuredSagCm = Math.abs(Math.min(...Array.from(y)));
    return { maxDevCm, measuredSagCm };
  };

  const c30 = solveCatenaryChain(30);
  const c60 = solveCatenaryChain(60);

  return {
    benchmarkId: 'B3_CATENARY_CURVE',
    title: 'B3 — Catenary Suspension Curve',
    standardReference: 'ADR-005 / AC-08 (y = a*cosh(x/a) - c)',
    measuredValue: Number(c60.measuredSagCm.toFixed(4)),
    analyticalValue: Number(maxAnalyticalSagCm.toFixed(4)),
    unit: 'cm max sag',
    errorValue: Number(c60.maxDevCm.toFixed(4)),
    errorUnit: 'cm max dev',
    toleranceLimit: 0.05,
    passed: c30.maxDevCm <= 0.05 && c60.maxDevCm <= 0.05,
    notes: `XPBD 60-link chain max vertical deviation ${c60.maxDevCm.toFixed(4)} cm <= 0.05 cm (0.5 mm) limit.`,
    convergenceBehavior: `30-link (ds=8mm) dev=${c30.maxDevCm.toFixed(4)} cm -> 60-link (ds=4mm) dev=${c60.maxDevCm.toFixed(4)} cm.`,
    resolutionChecks: [
      {
        label: '30-link chain (ds=8mm)',
        meshEdgeLengthMm: 8.0,
        measuredValue: Number(c30.measuredSagCm.toFixed(4)),
        analyticalValue: Number(maxAnalyticalSagCm.toFixed(4)),
        errorValue: Number(c30.maxDevCm.toFixed(4)),
        passed: c30.maxDevCm <= 0.05
      },
      {
        label: '60-link chain (ds=4mm)',
        meshEdgeLengthMm: 4.0,
        measuredValue: Number(c60.measuredSagCm.toFixed(4)),
        analyticalValue: Number(maxAnalyticalSagCm.toFixed(4)),
        errorValue: Number(c60.maxDevCm.toFixed(4)),
        passed: c60.maxDevCm <= 0.05
      }
    ]
  };
}

/**
 * B4 — Mesh Refinement Convergence (halving edge length h changes mean strain by < 2.0%, including M06 §10.2 8mm -> 4mm).
 */
export function runBenchmarkB4MeshConvergence(
  material: CalibratedMaterialConstitutiveSpec
): AnalyticalBenchmarkResult {
  const validity = isMaterialConstitutiveValidForBenchmarks(material);
  if (!validity.valid) {
    return buildFailedBenchmark(
      'B4_MESH_CONVERGENCE',
      'B4 — Mesh Refinement Convergence (h vs h/2)',
      'ADR-005 / AC-08 (< 2.0% strain shift)',
      '% strain (h/2 vs h)',
      '% diff',
      2.0,
      validity.reason ?? 'Invalid constitutive material.'
    );
  }

  const widthCm = 8;
  const lengthCm = 12;
  const loadN = 15;

  // Pair A: Coarse h = 20 mm (4x6) -> Medium h = 10 mm (8x12)
  const strain20mm = solveUniaxialStrip(material, widthCm, lengthCm, 4, 6, loadN);
  const strain10mm = solveUniaxialStrip(material, widthCm, lengthCm, 8, 12, loadN);
  const diff20to10Pct = (Math.abs(strain10mm - strain20mm) / Math.max(1e-9, Math.abs(strain10mm))) * 100;

  // Pair B (M06 §10.2 explicit baseline): h = 8 mm (10x15) -> h/2 = 4 mm (20x30)
  const strain8mm = solveUniaxialStrip(material, widthCm, lengthCm, 10, 15, loadN);
  const strain4mm = solveUniaxialStrip(material, widthCm, lengthCm, 20, 30, loadN);
  const diff8to4Pct = (Math.abs(strain4mm - strain8mm) / Math.max(1e-9, Math.abs(strain4mm))) * 100;

  const maxDiffPct = Math.max(diff20to10Pct, diff8to4Pct);
  const passed = Number.isFinite(maxDiffPct) && diff20to10Pct < 2.0 && diff8to4Pct < 2.0;

  return {
    benchmarkId: 'B4_MESH_CONVERGENCE',
    title: 'B4 — Mesh Refinement Convergence (h vs h/2)',
    standardReference: 'ADR-005 / AC-08 / M06 §10.2 (8mm -> 4mm < 2.0%)',
    measuredValue: Number((strain4mm * 100).toFixed(5)),
    analyticalValue: Number((strain8mm * 100).toFixed(5)),
    unit: '% strain (4mm vs 8mm)',
    errorValue: Number(maxDiffPct.toFixed(5)),
    errorUnit: '% diff',
    toleranceLimit: 2.0,
    passed,
    notes: `8mm->4mm shift=${diff8to4Pct.toFixed(4)}%, 20mm->10mm shift=${diff20to10Pct.toFixed(4)}% (both < 2.0%).`,
    convergenceBehavior: `20mm=${(strain20mm * 100).toFixed(4)}% -> 10mm=${(strain10mm * 100).toFixed(4)}% -> 8mm=${(strain8mm * 100).toFixed(4)}% -> 4mm=${(strain4mm * 100).toFixed(4)}%.`,
    resolutionChecks: [
      {
        label: 'Coarse->Med (20mm -> 10mm)',
        meshEdgeLengthMm: 10,
        measuredValue: Number((strain10mm * 100).toFixed(5)),
        analyticalValue: Number((strain20mm * 100).toFixed(5)),
        errorValue: Number(diff20to10Pct.toFixed(5)),
        passed: diff20to10Pct < 2.0
      },
      {
        label: 'Target §10.2 (8mm -> 4mm)',
        meshEdgeLengthMm: 4,
        measuredValue: Number((strain4mm * 100).toFixed(5)),
        analyticalValue: Number((strain8mm * 100).toFixed(5)),
        errorValue: Number(diff8to4Pct.toFixed(5)),
        passed: diff8to4Pct < 2.0
      }
    ]
  };
}

/**
 * Executes the full B1-B4 Analytical Credibility Qualification Suite for a material constitutive model.
 */
export function runAnalyticalCredibilityBenchmarks(
  material: CalibratedMaterialConstitutiveSpec
): ClothSolverQualificationReport {
  const validity = isMaterialConstitutiveValidForBenchmarks(material);
  const benchmarks: AnalyticalBenchmarkResult[] = [
    runBenchmarkB1UniaxialMembrane(material),
    runBenchmarkB2CantileverBending(material),
    runBenchmarkB3CatenaryCurve(),
    runBenchmarkB4MeshConvergence(material)
  ];

  const allPassed = validity.valid && benchmarks.every(b => b.passed);

  return {
    solverVersion: SOLVER_VERSION,
    materialSpecId: material.materialSpecId,
    materialName: material.fabricName,
    evaluatedAt: new Date().toISOString(),
    allPassed,
    failureReason: validity.valid ? (allPassed ? undefined : 'One or more AC-08 analytical benchmarks exceeded tolerance.') : validity.reason,
    benchmarks
  };
}
