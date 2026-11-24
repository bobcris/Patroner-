/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../../domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from '../../../engine/measurements/standards';
import {
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
  buildAuthoritativeProductionWorkspaceBundle
} from '../../../engine/production';
import { adaptC0LegacyBundleToRenderArtifact } from '../contracts/c0-legacy-adapter';
import { adaptPythonPatternArtifact } from '../contracts/python-artifact-adapter';
import type { PythonPatternPieceContract } from '../contracts/pattern-render-artifact';

function createValidPythonPieceFixture(): PythonPatternPieceContract {
  return {
    pieceId: 'bodice-front-01',
    pieceCode: 'BF-001',
    name: 'Bodice Front Block',
    coordinateFrame: {
      geometryUnit: 'cm',
      clearanceUnit: 'mm',
      internalAngleUnit: 'rad',
      displayAngleUnit: 'deg',
      handedness: 'right-handed-cartesian',
      exteriorWinding: 'CCW',
      interiorCutoutWinding: 'CW',
      leftNormalDirectionOnExterior: 'inward'
    },
    sewBoundarySegments: [
      {
        id: 'seg-armscye-01',
        p0: { x: 0.1234567, y: 0.0 },
        p1: { x: 3.0, y: 1.5 },
        p2: { x: 6.0, y: 4.5 },
        p3: { x: 8.0, y: 9.0 }
      }
    ],
    cutBoundarySegments: [
      {
        id: 'cut-armscye-01',
        p0: { x: -1.3765433, y: 0.0 },
        p1: { x: 1.5, y: 2.5 },
        p2: { x: 4.5, y: 5.5 },
        p3: { x: 6.5, y: 10.5 }
      }
    ],
    notches: [
      {
        id: 'notch-01',
        segmentId: 'seg-armscye-01',
        targetArcLengthCm: 5.0,
        parameterT: 0.4821934,
        position: { x: 4.12, y: 2.68 },
        normalVector: { x: 0.68, y: -0.733 },
        notchType: 'slit',
        arcLengthResidualCm: 2.1e-9
      }
    ],
    seamAllowances: [
      {
        segmentId: 'seg-armscye-01',
        distanceCm: 1.5,
        directionSign: -1,
        joinStyle: 'miter',
        miterLimit: 2.5
      }
    ],
    offsetReports: [
      {
        segmentId: 'seg-armscye-01',
        canonicalOffsetClassification: 'CERTIFIED_VALID',
        activeClassificationsOnDomain: ['CERTIFIED_VALID'],
        baseCurveSingularityClassification: 'REGULAR_BASE_CURVE',
        verificationOutcome: 'CERTIFIED_VALID',
        failureCategory: 'NONE',
        directionSign: -1,
        offsetDistanceCm: 1.5,
        minBaseSpeedSquaredQ: 68.25,
        minOffsetSpeedFactorF: 1.084,
        hasZeroSpeedCuspOnDomain: false,
        hasTangentReversalOnDomain: false,
        gridErrorCm: 0.00042,
        certifiedIntervalErrorCm: 0.00118,
        maxJoinTangentDeltaDeg: 0.004,
        reparameterized: false,
        trimmed: false,
        oracleTierUsed: 'C1-Cert-113bit-Q',
        isProductionReady: true
      }
    ],
    offsetValidationRecords: [
      {
        segment_id: 'seg-armscye-01',
        piece_id: 'bodice-front-01',
        contour_orientation: 'CCW_EXTERIOR',
        coordinate_convention: 'CARTESIAN_RH_CCW',
        offset_direction_sign_s: -1,
        offset_distance_cm: 1.5,
        regularity_margin_epsilon: 0.05,
        min_base_speed_squared_interval: [68.249999, 68.250001],
        min_offset_speed_factor_interval: [1.083999, 1.084001],
        has_zero_speed_cusp_on_domain: false,
        has_tangent_reversal_on_domain: false,
        stationary_parameterization_status: 'NONE_REGULAR_SPEED',
        base_curve_singularity_classification: 'REGULAR_BASE_CURVE',
        max_geometric_deviation_bound_cm: 0.00118,
        max_certified_radial_error_cm: 0.00118,
        primary_span_coverage_ratio: 1.0,
        local_self_intersection_status: 'NONE',
        global_contour_self_intersection_status: 'NONE',
        unresolved_intervals: [],
        verification_outcome: 'CERTIFIED_VALID',
        failure_category: 'NONE',
        canonical_offset_classification: 'CERTIFIED_VALID',
        active_classifications_on_domain: ['CERTIFIED_VALID'],
        working_precision_bits: 113,
        is_production_ready: true
      }
    ],
    warnings: []
  };
}

test('UX-2.3.1 C0-Legacy adapter projects skirt and bodice bundles as non-authoritative preview geometry', () => {
  for (const spec of [INITIAL_CONCEPTS[0], INITIAL_CONCEPTS[2]]) {
    const bundle = buildAuthoritativeProductionWorkspaceBundle({
      projectId: 'project-patroner-default',
      tenantId: 'tenant-studio-local',
      designSpec: spec,
      measurements: STANDARD_SIZING_SYSTEM.sizes.M,
      activeSize: 'M',
      bomControls: { ...DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS },
      governance: {
        bodiceDartStyle: 'waist',
        sleeveEaseStrategy: 'classic',
        strictUncertaintyGate: true,
        requireApprovedGovernance: false,
        measurementProvenance: 'standard-chart',
        measurementApprovalState: 'unverified'
      }
    });

    const artifact = adaptC0LegacyBundleToRenderArtifact({
      workspaceBundle: bundle,
      specificationRevisionId: 'spec-rev-1',
      measurementRevisionId: 'meas-rev-1'
    });

    assert.equal(artifact.authorityTier, 'C0_LEGACY_TS_PROTOTYPE');
    assert.equal(artifact.isCertified, false);
    assert.equal(artifact.isProductionReady, false);
    assert.equal(artifact.externalCadInteroperabilityVerified, false);
    assert.equal(artifact.coordinateFrame.geometryUnit, 'cm');
    assert.equal(artifact.coordinateFrame.yAxisDirection, 'svg-y-down');
    assert.equal(artifact.pieces.length, bundle.pieces.length);
    assert.ok(artifact.pieces.length >= 2);
    assert.ok(artifact.pieces[0].fallbackCutSvgPath && artifact.pieces[0].fallbackCutSvgPath.length > 0);
    assert.ok(artifact.pieces[0].fallbackSewSvgPath && artifact.pieces[0].fallbackSewSvgPath.length > 0);
  }
});

test('UX-2.3.1 Python adapter validates contracts.py fixture verbatim without mutating source coordinates', () => {
  const fixture = createValidPythonPieceFixture();
  const res = adaptPythonPatternArtifact({
    pieces: [fixture],
    specificationRevisionId: 'spec-py-1',
    measurementRevisionId: 'meas-py-1',
    artifactDigestSha256: 'a'.repeat(64)
  });

  assert.equal(res.valid, true);
  assert.equal(res.validationErrors.length, 0);
  assert.equal(res.bundle.authorityTier, 'C1_PYTHON_CERTIFIED');
  assert.equal(res.bundle.isCertified, true);
  assert.equal(res.bundle.coordinateFrame.yAxisDirection, 'cartesian-y-up');
  assert.equal(res.bundle.coordinateFrame.handedness, 'right-handed-cartesian');
  assert.equal(res.bundle.externalCadInteroperabilityVerified, false);

  // Exact source coordinate preservation (no rounding or mutation)
  assert.equal(res.bundle.pieces[0].sewSegments[0].p0.x, 0.1234567);
  assert.equal(res.bundle.pieces[0].cutSegments[0].p0.x, -1.3765433);
  assert.equal(res.bundle.pieces[0].notches[0].parameterT, 0.4821934);
});

test('UX-2.3.1 Python adapter fails closed when cross-field invariants fail or certification records are missing', () => {
  // 1. Contradictory OffsetValidationRecord: CERTIFIED_VALID but min speed factor < epsilon
  const baseBadFixture = createValidPythonPieceFixture();
  const badIntervalFixture = {
    ...baseBadFixture,
    offsetValidationRecords: [
      {
        ...baseBadFixture.offsetValidationRecords[0],
        min_offset_speed_factor_interval: [0.01, 0.04] as readonly [number, number],
        regularity_margin_epsilon: 0.05
      }
    ]
  };

  const badRes = adaptPythonPatternArtifact({
    pieces: [badIntervalFixture],
    specificationRevisionId: 'spec-py-bad',
    measurementRevisionId: 'meas-py-1'
  });
  assert.equal(badRes.valid, false);
  assert.equal(badRes.bundle.isCertified, false);
  assert.equal(badRes.bundle.isProductionReady, false);
  assert.equal(badRes.bundle.authorityTier, 'UNVERIFIED_EXTERNAL_ARTIFACT');
  assert.ok(badRes.bundle.diagnostics.some(d => d.code === 'CF-01-SPEED-FACTOR-LOWER-BELOW-DYNAMIC-EPSILON'));

  // 2. Missing certification records -> never displays as certified
  const unverifiedFixture = {
    ...createValidPythonPieceFixture(),
    offsetValidationRecords: [],
    offsetReports: []
  };

  const unverifiedRes = adaptPythonPatternArtifact({
    pieces: [unverifiedFixture],
    specificationRevisionId: 'spec-py-unverified',
    measurementRevisionId: 'meas-py-1'
  });
  assert.equal(unverifiedRes.valid, true);
  assert.equal(unverifiedRes.bundle.isCertified, false);
  assert.equal(unverifiedRes.bundle.isProductionReady, false);
  assert.equal(unverifiedRes.bundle.authorityTier, 'UNVERIFIED_EXTERNAL_ARTIFACT');

  // 3. Blocking GeometryWarning (ADR-009 TANGENT_REVERSAL) downgrades piece and exposes diagnostic
  const warningFixture = {
    ...createValidPythonPieceFixture(),
    warnings: [
      {
        warningId: 'warn-ag06-01',
        code: 'ADR009_TANGENT_REVERSAL',
        severity: 'CRITICAL_BLOCKING' as const,
        classification: 'TANGENT_REVERSAL' as const,
        pieceId: 'bodice-front-01',
        segmentId: 'seg-armscye-01',
        parameterT: 0.5,
        message: 'Signed curvature exceeds 1/(s*d) threshold on inward offset.',
        remediationAction: 'Reduce seam allowance or split contour.'
      }
    ]
  };
  const warnRes = adaptPythonPatternArtifact({
    pieces: [warningFixture],
    specificationRevisionId: 'spec-py-warn',
    measurementRevisionId: 'meas-py-1'
  });
  assert.equal(warnRes.bundle.isCertified, false);
  assert.equal(warnRes.bundle.isProductionReady, false);
  assert.equal(warnRes.bundle.pieces[0].hasBlockingError, true);
  assert.ok(warnRes.bundle.diagnostics.some(d => d.code === 'ADR009_TANGENT_REVERSAL'));
});
