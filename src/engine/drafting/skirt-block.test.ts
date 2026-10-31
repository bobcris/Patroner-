/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { draftSkirtBlock } from './skirt-block';
import { validatePatternDraft, SEAM_TOLERANCE_CM } from '../validation/seam-validator';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { DesignSpecification } from '../../types';

const mockDesign: DesignSpecification = {
  id: 'des-01',
  name: 'Minimalist Straight Skirt',
  prompt: 'A tailored minimalist wool skirt with clean waistline',
  garmentCategory: 'skirt',
  silhouette: 'straight',
  fabric: {
    id: 'wool-crepe',
    name: 'Wool Crepe',
    composition: '100% Virgin Wool',
    weight: 'medium',
    stretch: 'none',
    recommendedEaseCm: { waist: 3, hip: 4 },
    drapeDescription: 'Structured fluid drape with crisp grain'
  },
  color: { name: 'Oatmeal', hex: '#E5DFD3' },
  easeProfile: 'classic',
  lengthCm: 64,
  constructionFeatures: [
    {
      id: 'cf-1',
      category: 'closure',
      name: 'Invisible Zipper',
      description: '18cm invisible zipper at Center Back',
      patternImpact: '1.5cm seam allowance on CB seam'
    }
  ],
  designNotes: ['Back vent optional', 'Waist facing or 3cm waistband'],
  isApproved: true,
  version: 1
};

test('draftSkirtBlock drafts valid Front and Back skirt panels', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, mockDesign);

  assert.equal(pieces.length, 2, 'Should generate exactly 2 pieces (Front and Back)');

  const [front, back] = pieces;
  assert.equal(front.pieceCode, 'SK-01-F');
  assert.equal(front.onFold, true);
  assert.equal(back.pieceCode, 'SK-02-B');
  assert.equal(back.cutCount, 2);

  // Both pieces must contain darts
  assert.equal(front.darts.length, 1);
  assert.equal(back.darts.length, 1);

  // Both pieces must have valid SVG paths
  assert.ok(front.cutPathData.startsWith('M'));
  assert.ok(back.cutPathData.startsWith('M'));
  assert.ok(front.sewPathData.includes('Z'));
  assert.ok(back.sewPathData.includes('Z'));
});

test('draftSkirtBlock guarantees side seam compatibility within SEAM_TOLERANCE_CM', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.L;
  const pieces = draftSkirtBlock(measurements, mockDesign);

  const front = pieces.find(p => p.id === 'piece-skirt-front')!;
  const back = pieces.find(p => p.id === 'piece-skirt-back')!;

  const frontSideSeam = front.seams.find(s => s.name === 'Front Side Seam')!;
  const backSideSeam = back.seams.find(s => s.name === 'Back Side Seam')!;

  assert.ok(frontSideSeam, 'Front side seam must exist');
  assert.ok(backSideSeam, 'Back side seam must exist');

  const discrepancy = Math.abs(frontSideSeam.lengthCm - backSideSeam.lengthCm);
  assert.ok(
    discrepancy <= SEAM_TOLERANCE_CM,
    `Discrepancy (${discrepancy} cm) between Front (${frontSideSeam.lengthCm} cm) and Back (${backSideSeam.lengthCm} cm) side seams exceeds ${SEAM_TOLERANCE_CM} cm`
  );
});

test('validatePatternDraft produces pass report for properly drafted skirt', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, mockDesign);
  const report = validatePatternDraft(pieces);

  assert.equal(report.isValid, true);
  assert.ok(report.overallScore >= 90);
  assert.equal(report.checks.filter(c => c.status === 'fail').length, 0);
});
