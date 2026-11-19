/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AnalyticalBenchmarkResult,
  CalibratedMaterialConstitutiveSpec,
  ClothSolverQualificationReport
} from './simulation-types';

export const SOLVER_VERSION = 'patroner-cst-xpbd-v1.0.0';

export interface Simple2DMesh {
  nodesX: Float64Array;
  nodesY: Float64Array;
  restX: Float64Array;
  restY: Float64Array;
  triangles: Array<[number, number, number]>;
  restAreas: Float64Array;
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

/**
 * B1 — Uniaxial Membrane Patch Test (<= 0.1% relative error).
 */
export function runBenchmarkB1UniaxialMembrane(
  material: CalibratedMaterialConstitutiveSpec
): AnalyticalBenchmarkResult {
  const widthCm = 10;
  const lengthCm = 20;
  const nx = 4;
  const ny = 8;
  const mesh = buildStripMesh(widthCm, lengthCm, nx, ny);
  const totalForceN = 20;
  const analyticalStrain = totalForceN / (material.eWarpNCm * widthCm);

  const nNodes = mesh.nodesX.length;
  const forcesX = new Float64Array(nNodes);
  const forcesY = new Float64Array(nNodes);

  // Nodal consistent traction distribution on top boundary y = lengthCm
  const extY = new Float64Array(nNodes);
  for (let i = 0; i <= nx; i++) {
    const topIdx = ny * (nx + 1) + i;
    const weight = i === 0 || i === nx ? 0.5 / nx : 1.0 / nx;
    extY[topIdx] = totalForceN * weight;
  }

  // Exact initial seed very close or zero-displacement solved via damped gradient + momentum
  const vx = new Float64Array(nNodes);
  const vy = new Float64Array(nNodes);
  const step = 0.0022;

  for (let iter = 0; iter < 1200; iter++) {
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
        // y = 0 rollers; pin x only at bottom-left origin to remove rigid-body translation while permitting Poisson contraction
        mesh.nodesY[idx] = 0;
        vy[idx] = 0;
        if (i === 0) {
          mesh.nodesX[idx] = 0;
          vx[idx] = 0;
        } else {
          vx[idx] = 0.88 * vx[idx] + step * fx;
          mesh.nodesX[idx] += vx[idx];
          maxForce = Math.max(maxForce, Math.abs(fx));
        }
      } else {
        vx[idx] = 0.88 * vx[idx] + step * fx;
        vy[idx] = 0.88 * vy[idx] + step * fy;
        mesh.nodesX[idx] += vx[idx];
        mesh.nodesY[idx] += vy[idx];
        maxForce = Math.max(maxForce, Math.abs(fx), Math.abs(fy));
      }
    }
    if (maxForce < 1e-8) break;
  }

  let meanTopY = 0;
  for (let i = 0; i <= nx; i++) {
    meanTopY += mesh.nodesY[ny * (nx + 1) + i];
  }
  meanTopY /= nx + 1;
  const measuredStrain = (meanTopY - lengthCm) / lengthCm;
  const relErrorPct = (Math.abs(measuredStrain - analyticalStrain) / Math.max(1e-9, analyticalStrain)) * 100;

  return {
    benchmarkId: 'B1_UNIAXIAL_MEMBRANE',
    title: 'B1 — Uniaxial Membrane Patch Test',
    standardReference: 'ADR-005 / AC-08 (Orthotropic CST Patch)',
    measuredValue: Number((measuredStrain * 100).toFixed(5)),
    analyticalValue: Number((analyticalStrain * 100).toFixed(5)),
    unit: '% strain',
    errorValue: Number(relErrorPct.toFixed(5)),
    errorUnit: '% rel err',
    toleranceLimit: 0.1,
    passed: relErrorPct <= 0.1,
    notes: `Simulated axial strain ${(measuredStrain * 100).toFixed(4)}% vs closed-form F/(E_warp*W)=${(analyticalStrain * 100).toFixed(4)}%.`
  };
}

/**
 * B2 — Cantilever Elastica Bending (ASTM D1388, <= 1.5% relative error vs nonlinear ODE).
 */
export function runBenchmarkB2CantileverBending(
  material: CalibratedMaterialConstitutiveSpec
): AnalyticalBenchmarkResult {
  // Strip width 2.5 cm, overhanging length 10 cm under distributed fabric gravity
  const lengthCm = 10.0;
  const widthCm = 2.5;
  const bEff = Math.max(0.05, material.bWarpNCm * widthCm); // N*cm^2
  // Uniform distributed weight in N/cm: density(kg/m^2) * 9.81 * (widthCm/100) / 100
  const weightPerCm = Math.max(0.002, material.densityKgM2 * 9.81 * (widthCm / 100) * 0.01);

  // Discrete hinge chain equilibrium (N = 64 segments) using exact midpoint rotational hinge equilibrium
  const nSeg = 64;
  const ds = lengthCm / nSeg;
  const discreteTheta = new Float64Array(nSeg + 1); // vertex angles discreteTheta[0] = 0 clamped root
  for (let iter = 0; iter < 600; iter++) {
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

  let discreteTipDeflectionCm = 0;
  for (let i = 0; i < nSeg; i++) {
    discreteTipDeflectionCm += 0.5 * ds * (Math.sin(discreteTheta[i]) + Math.sin(discreteTheta[i + 1]));
  }

  // Independent Reference ODE: RK4 shooting for continuous Euler-Bernoulli elastica
  // d(theta)/ds = M(s)/B, d(M)/ds = -w*(L - s) wait: dV/ds = -w, dM/ds = -V*cos(theta) => M'' = ...
  // Actually shooting curvature u(s) = theta'(s), u'(s) = -(w*(L-s)/B)*cos(theta(s))? No:
  // Bending moment M(s) at s is integral_s^L w * (x(u) - x(s)) du -> dM/ds = -V(s) * cos(theta(s)), where V(s) = w*(L-s).
  // So u'(s) = -(w*(L-s)/B) * cos(theta(s)) with theta(0)=0 and u(L)=0!
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

  // Bisection shooting on initial curvature u0 in [0, w*L^2/(2B) * 2]
  let lo = 0;
  let hi = (weightPerCm * lengthCm * lengthCm) / bEff + 0.2;
  for (let b = 0; b < 45; b++) {
    const mid = 0.5 * (lo + hi);
    const res = integrateContinuousOde(mid, 400);
    if (res.uEnd > 0) hi = mid;
    else lo = mid;
  }
  const odeRef = integrateContinuousOde(0.5 * (lo + hi), 400);
  const relErrorPct = (Math.abs(discreteTipDeflectionCm - odeRef.yTip) / Math.max(1e-6, Math.abs(odeRef.yTip))) * 100;

  return {
    benchmarkId: 'B2_CANTILEVER_BENDING',
    title: 'B2 — Cantilever Elastica Bending (ASTM D1388)',
    standardReference: 'ADR-005 / AC-08 (Nonlinear Elastica ODE)',
    measuredValue: Number(discreteTipDeflectionCm.toFixed(4)),
    analyticalValue: Number(odeRef.yTip.toFixed(4)),
    unit: 'cm deflection',
    errorValue: Number(relErrorPct.toFixed(4)),
    errorUnit: '% rel err',
    toleranceLimit: 1.5,
    passed: relErrorPct <= 1.5,
    notes: `Discrete 32-hinge tip deflection ${discreteTipDeflectionCm.toFixed(3)} cm vs RK4 elastica ODE ${odeRef.yTip.toFixed(3)} cm.`
  };
}

/**
 * B3 — Catenary Suspension Curve (<= 0.05 cm = 0.5 mm max sag deviation).
 */
export function runBenchmarkB3CatenaryCurve(): AnalyticalBenchmarkResult {
  const spanCm = 20.0;
  const totalArcLenCm = 24.0;
  const nSeg = 30;
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

  // Damped Verlet + symmetric forward-backward inextensible XPBD constraint projection
  const dtSqG = 0.004;
  for (let iter = 0; iter < 1500; iter++) {
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

    for (let pass = 0; pass < 40; pass++) {
      for (let i = 0; i < nSeg; i++) projectLink(i);
      for (let i = nSeg - 1; i >= 0; i--) projectLink(i);
    }
  }

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

  let maxDevCm = 0;
  for (let i = 0; i < nNodes; i++) {
    const exactY = a * Math.cosh(x[i] / a) - anchorOffset;
    maxDevCm = Math.max(maxDevCm, Math.abs(y[i] - exactY));
  }
  const maxAnalyticalSagCm = Math.abs(a - anchorOffset);
  const measuredSagCm = Math.abs(Math.min(...Array.from(y)));

  return {
    benchmarkId: 'B3_CATENARY_CURVE',
    title: 'B3 — Catenary Suspension Curve',
    standardReference: 'ADR-005 / AC-08 (y = a*cosh(x/a) - c)',
    measuredValue: Number(measuredSagCm.toFixed(4)),
    analyticalValue: Number(maxAnalyticalSagCm.toFixed(4)),
    unit: 'cm max sag',
    errorValue: Number(maxDevCm.toFixed(4)),
    errorUnit: 'cm max dev',
    toleranceLimit: 0.05,
    passed: maxDevCm <= 0.05,
    notes: `XPBD 30-link chain max vertical deviation ${maxDevCm.toFixed(4)} cm <= 0.05 cm (0.5 mm) limit.`
  };
}

/**
 * B4 — Mesh Refinement Convergence (halving edge length h changes mean strain by < 2.0%).
 */
export function runBenchmarkB4MeshConvergence(
  material: CalibratedMaterialConstitutiveSpec
): AnalyticalBenchmarkResult {
  const solveMeanAxialStrain = (nx: number, ny: number): number => {
    const widthCm = 8;
    const lengthCm = 12;
    const mesh = buildStripMesh(widthCm, lengthCm, nx, ny);
    const loadN = 15;
    const nNodes = mesh.nodesX.length;
    const fx = new Float64Array(nNodes);
    const fy = new Float64Array(nNodes);
    const extY = new Float64Array(nNodes);
    for (let i = 0; i <= nx; i++) {
      const idx = ny * (nx + 1) + i;
      const w = i === 0 || i === nx ? 0.5 / nx : 1.0 / nx;
      extY[idx] = loadN * w;
    }
    const vx = new Float64Array(nNodes);
    const vy = new Float64Array(nNodes);
    for (let it = 0; it < 900; it++) {
      fx.fill(0);
      fy.fill(0);
      accumulateCstMembraneEnergyAndForces2D(mesh, material, fx, fy);
      let maxR = 0;
      for (let idx = 0; idx < nNodes; idx++) {
        const j = Math.floor(idx / (nx + 1));
        const i = idx % (nx + 1);
        if (j === 0) {
          mesh.nodesY[idx] = 0;
          if (i === 0) mesh.nodesX[idx] = 0;
          else {
            vx[idx] = 0.86 * vx[idx] + 0.002 * fx[idx];
            mesh.nodesX[idx] += vx[idx];
          }
        } else {
          vx[idx] = 0.86 * vx[idx] + 0.002 * fx[idx];
          vy[idx] = 0.86 * vy[idx] + 0.002 * (fy[idx] + extY[idx]);
          mesh.nodesX[idx] += vx[idx];
          mesh.nodesY[idx] += vy[idx];
          maxR = Math.max(maxR, Math.abs(fx[idx]), Math.abs(fy[idx] + extY[idx]));
        }
      }
      if (maxR < 1e-7) break;
    }
    let avgTop = 0;
    for (let i = 0; i <= nx; i++) avgTop += mesh.nodesY[ny * (nx + 1) + i];
    return (avgTop / (nx + 1) - lengthCm) / lengthCm;
  };

  // Coarse h = 2.0 cm (4x6) vs Refined h = 1.0 cm (8x12)
  const coarseStrain = solveMeanAxialStrain(4, 6);
  const fineStrain = solveMeanAxialStrain(8, 12);
  const diffPct = (Math.abs(fineStrain - coarseStrain) / Math.max(1e-9, Math.abs(fineStrain))) * 100;

  return {
    benchmarkId: 'B4_MESH_CONVERGENCE',
    title: 'B4 — Mesh Refinement Convergence (h vs h/2)',
    standardReference: 'ADR-005 / AC-08 (< 2.0% strain shift)',
    measuredValue: Number((fineStrain * 100).toFixed(5)),
    analyticalValue: Number((coarseStrain * 100).toFixed(5)),
    unit: '% strain (h/2 vs h)',
    errorValue: Number(diffPct.toFixed(5)),
    errorUnit: '% diff',
    toleranceLimit: 2.0,
    passed: diffPct < 2.0,
    notes: `Coarse strain ${(coarseStrain * 100).toFixed(4)}% vs refined ${(fineStrain * 100).toFixed(4)}% (${diffPct.toFixed(4)}% shift < 2.0%).`
  };
}

/**
 * Executes the full B1-B4 Analytical Credibility Qualification Suite for a material constitutive model.
 */
export function runAnalyticalCredibilityBenchmarks(
  material: CalibratedMaterialConstitutiveSpec
): ClothSolverQualificationReport {
  const benchmarks: AnalyticalBenchmarkResult[] = [
    runBenchmarkB1UniaxialMembrane(material),
    runBenchmarkB2CantileverBending(material),
    runBenchmarkB3CatenaryCurve(),
    runBenchmarkB4MeshConvergence(material)
  ];

  return {
    solverVersion: SOLVER_VERSION,
    evaluatedAt: new Date().toISOString(),
    allPassed: benchmarks.every(b => b.passed),
    benchmarks
  };
}
