/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  PatternArtifactBundle,
  PatternArtifactCoordinateFrame
} from '../contracts/pattern-render-artifact';
import type { ParametricProposalOp } from '../contracts/wp-a-shared-contracts';
import {
  WP_A_AUTHORITY_TIER,
  WP_A_PROPOSAL_PAYLOAD_SCHEMA_VERSION,
  WP_A_SUBMISSION_STATUS
} from '../contracts/wp-a-shared-contracts';
import {
  buildProposedInspectionArtifact,
  createEmptyProposalHistory,
  MAX_PROPOSAL_HISTORY_ENTRIES,
  redoProposalHistory,
  undoProposalHistory
} from '../geometry-edit-proposal';
import {
  appendParametricOpToHistory,
  detectDependencyCycles,
  rebindInvalidatedOpTargetInHistory,
  removeParametricOpFromHistory,
  replayParametricOperations,
  serializeWpAProposalPayloadV2,
  toggleParametricOpInHistory,
  updateParametricOpInHistory
} from '../parametric-proposal-engine';
import { buildDeclarativeSegmentRule } from '../seam-allowance-rules';

const FRAME_CARTESIAN: PatternArtifactCoordinateFrame = {
  geometryUnit: 'cm',
  yAxisDirection: 'cartesian-y-up',
  handedness: 'right-handed-cartesian',
  exteriorWinding: 'CCW'
};

function makeArtifact(withDigest = false): PatternArtifactBundle {
  return {
    schemaVersion: 'patroner.pattern-render-artifact.v1',
    authorityTier: 'C0_LEGACY_TS_PROTOTYPE',
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    coordinateFrame: FRAME_CARTESIAN,
    provenance: {
      specificationRevisionId: 'spec-wpa5',
      measurementRevisionId: 'meas-wpa5',
      artifactDigestSha256: withDigest ? 'abc123verified' : undefined,
      engineVersion: 'c0-test',
      disclosureLabel: 'Test bundle'
    },
    pieces: [
      {
        pieceId: 'p-bodice',
        pieceCode: 'FB',
        name: 'Front Bodice',
        material: 'self',
        cutCount: 1,
        onFold: true,
        seamAllowanceWidthCm: 1.5,
        boundingBoxCm: { minX: 0, minY: 0, maxX: 20, maxY: 30, widthCm: 20, heightCm: 30 },
        sewSegments: [
          { id: 'seg-waist', kind: 'line', role: 'stitching', p0: { x: 0, y: 0 }, p3: { x: 20, y: 0 } },
          { id: 'seg-side', kind: 'line', role: 'stitching', p0: { x: 20, y: 0 }, p3: { x: 20, y: 30 } },
          { id: 'seg-top', kind: 'line', role: 'stitching', p0: { x: 20, y: 30 }, p3: { x: 0, y: 30 } },
          { id: 'seg-cf', kind: 'line', role: 'fold', isFold: true, p0: { x: 0, y: 30 }, p3: { x: 0, y: 0 } }
        ],
        cutSegments: [
          { id: 'cut-0', kind: 'line', role: 'cutting', p0: { x: 0, y: -1.5 }, p3: { x: 21.5, y: -1.5 } }
        ],
        seams: [],
        seamAllowances: [],
        darts: [],
        notches: [],
        hasBlockingError: false
      }
    ],
    diagnostics: [
      {
        id: 'diag-orig-1',
        code: 'TEST_DIAG',
        severity: 'INFO',
        pieceId: 'p-bodice',
        message: 'Anchored to original artifact'
      }
    ]
  };
}

test('WP-A5: replays multi-domain parametric operations deterministically from immutable sourceArtifact', () => {
  const art = makeArtifact(false);
  const originalSnapshot = JSON.stringify(art);
  let history = createEmptyProposalHistory(art);

  const op1: ParametricProposalOp = {
    opId: 'op-1-notch',
    sequence: 1,
    domain: 'notch-drill',
    kind: 'upsert-notch',
    label: 'Add Side Notch',
    pieceId: 'p-bodice',
    dependsOnIds: ['seg:seg-side'],
    enabled: true,
    provenance: { createdSequence: 1, sourceTool: 'notch-drill', authorityTier: WP_A_AUTHORITY_TIER },
    params: { notchId: 'n-side-1', segmentId: 'seg-side', targetArcLengthCm: 10, notchType: 'single', label: 'N1' }
  };

  const op2: ParametricProposalOp = {
    opId: 'op-2-dart',
    sequence: 2,
    domain: 'dart',
    kind: 'create-dart',
    label: 'Create Waist Dart',
    pieceId: 'p-bodice',
    dependsOnIds: ['seg:seg-waist'],
    enabled: true,
    provenance: { createdSequence: 2, sourceTool: 'dart-author', authorityTier: WP_A_AUTHORITY_TIER },
    params: {
      dartId: 'd-waist',
      label: 'Waist Dart',
      hostSegmentId: 'seg-waist',
      centerParameterT: 0.5,
      intakeWidthCm: 3.0,
      pivotApexCm: { x: 10, y: 15 },
      backoffCm: 2.0,
      foldDirection: 'toward-center'
    }
  };

  const op3: ParametricProposalOp = {
    opId: 'op-3-rule',
    sequence: 3,
    domain: 'allowance-rule',
    kind: 'set-segment-allowance-rule',
    label: 'Set Side SA 2.0 cm',
    pieceId: 'p-bodice',
    dependsOnIds: ['seg:seg-side'],
    enabled: true,
    provenance: { createdSequence: 3, sourceTool: 'allowance-rule', authorityTier: WP_A_AUTHORITY_TIER },
    params: {
      rule: buildDeclarativeSegmentRule({ segmentId: 'seg-side', edgeRole: 'seam-edge', distanceCm: 2.0 })
    }
  };

  history = appendParametricOpToHistory(art, history, op1);
  history = appendParametricOpToHistory(art, history, op2);
  history = appendParametricOpToHistory(art, history, op3);

  const wpA = history.present.wpAState!;
  assert.equal(wpA.graphDiagnostic.appliedOpCount, 3);
  assert.equal(wpA.graphDiagnostic.hasCycle, false);
  assert.equal(wpA.pieceEngineering['p-bodice'].proposedNotches.length, 1);
  assert.equal(wpA.pieceEngineering['p-bodice'].proposedDarts.length, 1);
  assert.equal(wpA.pieceEngineering['p-bodice'].allowanceEvaluation?.cutGeometryRegeneratedInClient, false);

  // Edit op-1 parameter and replay downstream deterministically
  history = updateParametricOpInHistory(art, history, 'op-1-notch', (op) =>
    op.kind === 'upsert-notch' ? { ...op, params: { ...op.params, targetArcLengthCm: 15 } } : op
  );
  const updatedNotch = history.present.wpAState!.pieceEngineering['p-bodice'].proposedNotches[0];
  assert.ok(Math.abs(updatedNotch.position.y - 15) < 1e-6);

  // Toggle disable & remove
  history = toggleParametricOpInHistory(art, history, 'op-3-rule');
  assert.equal(history.present.wpAState!.replayStatuses['op-3-rule'].status, 'skipped-disabled');
  history = removeParametricOpFromHistory(art, history, 'op-3-rule');
  assert.equal(history.present.wpAState!.operations.length, 2);

  // Single-history undo/redo works cleanly across WP-A ops
  const undone = undoProposalHistory(history);
  assert.equal(undone.present.wpAState!.operations.length, 3);
  const redone = redoProposalHistory(undone);
  assert.equal(redone.present.wpAState!.operations.length, 2);

  // Projected inspection artifact keeps cutSegments byte-identical and diagnostics empty (D2/D3)
  const projected = buildProposedInspectionArtifact(art, history.present);
  assert.equal(projected.authorityTier, WP_A_AUTHORITY_TIER);
  assert.equal(projected.isCertified, false);
  assert.equal(projected.diagnostics.length, 0);
  assert.equal(JSON.stringify(projected.pieces[0].cutSegments), JSON.stringify(art.pieces[0].cutSegments));
  assert.equal(JSON.stringify(art), originalSnapshot, 'sourceArtifact must remain completely unmutated');
});

test('WP-A5: detects dependency cycles fail-closed and supports rebinding invalidated targets', () => {
  const art = makeArtifact(false);
  const cyclicOps: ParametricProposalOp[] = [
    {
      opId: 'op-a',
      sequence: 1,
      domain: 'allowance-rule',
      kind: 'set-piece-default-allowance',
      label: 'A',
      pieceId: 'p-bodice',
      dependsOnIds: ['op-b'],
      enabled: true,
      provenance: { createdSequence: 1, sourceTool: 'allowance-rule', authorityTier: WP_A_AUTHORITY_TIER },
      params: { defaultAllowanceCm: 1.5 }
    },
    {
      opId: 'op-b',
      sequence: 2,
      domain: 'allowance-rule',
      kind: 'set-piece-default-allowance',
      label: 'B',
      pieceId: 'p-bodice',
      dependsOnIds: ['op-a'],
      enabled: true,
      provenance: { createdSequence: 2, sourceTool: 'allowance-rule', authorityTier: WP_A_AUTHORITY_TIER },
      params: { defaultAllowanceCm: 2.0 }
    }
  ];

  const cycleCheck = detectDependencyCycles(cyclicOps);
  assert.equal(cycleCheck.hasCycle, true);
  assert.deepEqual(cycleCheck.cycleOpIds, ['op-a', 'op-b']);

  const replayedCycle = replayParametricOperations(art, cyclicOps);
  assert.equal(replayedCycle.wpAState!.graphDiagnostic.hasCycle, true);
  assert.equal(replayedCycle.wpAState!.replayStatuses['op-a'].status, 'cycle-rejected');
  assert.equal(replayedCycle.wpAState!.replayStatuses['op-b'].status, 'cycle-rejected');

  // Invalidated target + explicit recovery via rebindInvalidatedOpTargetInHistory
  let history = createEmptyProposalHistory(art);
  history = appendParametricOpToHistory(art, history, {
    opId: 'op-broken-notch',
    sequence: 1,
    domain: 'notch-drill',
    kind: 'upsert-notch',
    label: 'Notch on missing seg',
    pieceId: 'p-bodice',
    dependsOnIds: ['seg:missing-seg'],
    enabled: true,
    provenance: { createdSequence: 1, sourceTool: 'notch-drill', authorityTier: WP_A_AUTHORITY_TIER },
    params: { notchId: 'n-broken', segmentId: 'missing-seg', targetArcLengthCm: 5, notchType: 'single' }
  });
  assert.equal(history.present.wpAState!.replayStatuses['op-broken-notch'].status, 'invalidated-upstream');

  history = rebindInvalidatedOpTargetInHistory(art, history, 'op-broken-notch', 'seg-side');
  assert.equal(history.present.wpAState!.replayStatuses['op-broken-notch'].status, 'applied');
  assert.equal(history.present.wpAState!.pieceEngineering['p-bodice'].proposedNotches.length, 1);
});

test('WP-A5: respects single 50-entry GeometryProposalHistoryState bound and deterministic Payload v2 contract', () => {
  const art = makeArtifact(false);
  let history = createEmptyProposalHistory(art);

  for (let i = 1; i <= 55; i++) {
    history = appendParametricOpToHistory(art, history, {
      opId: `op-sa-${i}`,
      sequence: i,
      domain: 'allowance-rule',
      kind: 'set-piece-default-allowance',
      label: `Set SA ${i}`,
      pieceId: 'p-bodice',
      dependsOnIds: [],
      enabled: true,
      provenance: { createdSequence: i, sourceTool: 'allowance-rule', authorityTier: WP_A_AUTHORITY_TIER },
      params: { defaultAllowanceCm: 1 + (i % 5) * 0.25 }
    });
  }
  assert.equal(history.past.length, MAX_PROPOSAL_HISTORY_ENTRIES);

  const ser1 = serializeWpAProposalPayloadV2(art, history);
  const ser2 = serializeWpAProposalPayloadV2(art, history);
  assert.equal(ser1.ok, true);
  assert.equal(ser2.ok, true);
  if (!ser1.ok || !ser2.ok) return;

  assert.equal(ser1.json, ser2.json, 'Payload v2 serialization must be byte-deterministic');
  assert.equal(ser1.payload.schemaVersion, WP_A_PROPOSAL_PAYLOAD_SCHEMA_VERSION);
  assert.equal(ser1.payload.submissionStatus, WP_A_SUBMISSION_STATUS);
  assert.equal(ser1.payload.authorityTier, WP_A_AUTHORITY_TIER);
  assert.equal(ser1.payload.isCertified, false);
  assert.equal(ser1.payload.isProductionReady, false);
  assert.equal(ser1.payload.externalCadInteroperabilityVerified, false);
  assert.equal(ser1.payload.sourceArtifact.artifactDigestSha256, null, 'must never invent missing SHA-256 digest');
  assert.equal(ser1.payload.sourceArtifact.hasVerifiedSourceDigest, false);
  assert.equal(ser1.payload.pieces[0].cutContourRegeneratedInClient, false);

  // Fail-closed on NaN value inside an operation
  const nanHistory = appendParametricOpToHistory(art, createEmptyProposalHistory(art), {
    opId: 'op-nan',
    sequence: 1,
    domain: 'allowance-rule',
    kind: 'set-piece-default-allowance',
    label: 'Bad NaN',
    pieceId: 'p-bodice',
    dependsOnIds: [],
    enabled: true,
    provenance: { createdSequence: 1, sourceTool: 'allowance-rule', authorityTier: WP_A_AUTHORITY_TIER },
    params: { defaultAllowanceCm: Number.NaN }
  });
  const badSer = serializeWpAProposalPayloadV2(art, nanHistory);
  assert.equal(badSer.ok, false);
});
