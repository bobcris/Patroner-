/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../../domain/design/curated-concepts.ts';
import {
  generateConceptVariations,
  resolveAiServiceAvailability
} from '../../../services/ai/fashion-service.ts';
import {
  createInitialStudioState,
  creativeStudioReducer
} from '../studio-reducer.ts';

test('UX-2.2 C2 & D4: default demonstration mode makes zero fetch calls, separates availability from outcome, and never claims reference image analysis', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 500 });
  }) as unknown as typeof fetch;

  try {
    const status = resolveAiServiceAvailability();
    assert.equal(status.availability, 'demonstration');

    const result = await generateConceptVariations({
      brief: 'Architectural tailored midi skirt with crisp side pleats',
      title: 'Column Pleat Study',
      category: 'skirt',
      silhouette: 'straight',
      fabricId: INITIAL_CONCEPTS[0].fabric.id,
      colorName: 'Chalk Oatmeal',
      colorHex: '#E8E3D9',
      easeProfile: 'classic',
      lengthCm: 68,
      attachedAssetIds: ['asset-ref-1'],
      attachedAssetNames: ['runway-drape.png']
    });

    assert.equal(fetchCalls, 0);
    assert.equal(result.serviceAvailability, 'demonstration');
    assert.equal(result.operationOutcome, 'demonstration-result');
    assert.equal(result.analyzedReferenceImages, false);
    assert.equal(result.candidates.length, 3);

    for (const candidate of result.candidates) {
      assert.equal(candidate.serviceAvailability, 'demonstration');
      assert.equal(candidate.operationOutcome, 'demonstration-result');
      assert.equal(candidate.analyzedReferenceImages, false);
      assert.ok(candidate.epistemicClaims.length > 0);
      assert.match(candidate.disclaimer, /not visually analyzed/i);
      assert.equal(/silhouette analyzed/i.test(candidate.summary), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('UX-2.2 C2: failed configured AI endpoint returns failed-operation explicitly and never silently claims completed AI analysis', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ error: 'service unavailable' }), { status: 503 });
  }) as unknown as typeof fetch;

  try {
    const status = resolveAiServiceAvailability({ enableLiveEndpoint: true });
    assert.equal(status.availability, 'configured-ready');

    const failed = await generateConceptVariations(
      {
        brief: 'Minimalist tailored bodice',
        title: 'Tailored Bodice',
        category: 'bodice',
        silhouette: 'tailored',
        fabricId: INITIAL_CONCEPTS[0].fabric.id,
        colorName: 'Parchment Ivory',
        colorHex: '#F4F1EA',
        easeProfile: 'classic',
        lengthCm: 44,
        attachedAssetIds: [],
        attachedAssetNames: []
      },
      { enableLiveEndpoint: true }
    );

    assert.equal(fetchCalls, 1);
    assert.equal(failed.serviceAvailability, 'configured-error');
    assert.equal(failed.operationOutcome, 'failed-operation');
    assert.equal(failed.analyzedReferenceImages, false);
    assert.equal(failed.candidates.length, 0);
    assert.ok(failed.errorMessage && /503/.test(failed.errorMessage));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('UX-2.2 Phase 6: generating AI candidates lands in gallery only and never overwrites active spec or concept until explicitly applied', async () => {
  const spec = INITIAL_CONCEPTS[0];
  let state = createInitialStudioState({ projectId: 'proj-ai', spec });
  const initialConceptSnapshot = structuredClone(state.document.concept);

  const batch = await generateConceptVariations({
    brief: 'Evening silk bias skirt',
    title: 'Bias Study',
    category: 'skirt',
    silhouette: 'a-line',
    fabricId: 'silk-charmeuse',
    colorName: 'Midnight Ink',
    colorHex: '#1C212D',
    easeProfile: 'relaxed',
    lengthCm: 76,
    attachedAssetIds: [],
    attachedAssetNames: []
  });

  state = creativeStudioReducer(state, {
    type: 'ADD_AI_CANDIDATES',
    candidates: batch.candidates
  });

  // Gallery receives candidates, active concept untouched, board still uninitialized
  assert.equal(state.document.aiCandidates.length, 3);
  assert.deepEqual(state.document.concept, initialConceptSnapshot);
  assert.equal(Object.keys(state.document.layersById).length, 0);

  // Explicit Apply to Board adds a non-authoritative visual card and updates concept organizer
  const chosenId = batch.candidates[1].id;
  state = creativeStudioReducer(state, {
    type: 'APPLY_AI_CANDIDATE_TO_BOARD',
    candidateId: chosenId
  });
  assert.equal(Object.keys(state.document.layersById).length, 1);
  const addedLayer = Object.values(state.document.layersById)[0];
  assert.equal(addedLayer.authorityTag, 'NON_AUTHORITATIVE_VISUAL_LAYER');
  assert.equal(state.document.concept.title, batch.candidates[1].title);
});
