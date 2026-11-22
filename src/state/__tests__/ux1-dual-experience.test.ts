/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_CONCEPT_HISTORY_ITEMS,
  MAX_REFERENCE_IMAGE_BYTES,
  appendConceptHistory,
  createStudioDraftBriefFromSpec,
  deriveDraftingOptionsForSpecChange,
  formatOversizeImageMb,
  resolveTabForExperienceMode,
  validateReferenceImageFile
} from '../ProjectWorkspaceContext.tsx';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts.ts';
import { generateGarmentConcept } from '../../services/ai/fashion-service.ts';

test('UX-1 B1/B2: experience mode switcher maps cleanly between Creative Studio and Professional Workshop', () => {
  assert.equal(resolveTabForExperienceMode('creative-studio', 'pattern-cad'), 'studio');
  assert.equal(resolveTabForExperienceMode('professional-workshop', 'specification'), 'specification');
  assert.equal(resolveTabForExperienceMode('professional-workshop', 'measurements'), 'measurements');
  assert.equal(resolveTabForExperienceMode('professional-workshop', 'pattern-cad'), 'pattern-cad');
  assert.equal(resolveTabForExperienceMode('professional-workshop', 'production'), 'production');
});

test('UX-1 B3: reference image validator enforces PNG/JPG/WEBP format and 5 MB size cap', () => {
  assert.equal(
    validateReferenceImageFile({ name: 'drape.png', type: 'image/png', size: 1024 }).valid,
    true
  );
  assert.equal(
    validateReferenceImageFile({ name: 'look.jpg', type: 'image/jpeg', size: 2048 }).valid,
    true
  );
  assert.equal(
    validateReferenceImageFile({ name: 'ref.webp', type: 'image/webp', size: 4096 }).valid,
    true
  );

  const badType = validateReferenceImageFile({ name: 'doc.pdf', type: 'application/pdf', size: 1024 });
  assert.equal(badType.valid, false);
  assert.match(badType.error ?? '', /PNG, JPG, or WEBP/i);

  const empty = validateReferenceImageFile({ name: 'empty.png', type: 'image/png', size: 0 });
  assert.equal(empty.valid, false);
  assert.match(empty.error ?? '', /empty/i);

  const oversize = validateReferenceImageFile({
    name: 'huge.png',
    type: 'image/png',
    size: MAX_REFERENCE_IMAGE_BYTES + 1
  });
  assert.equal(oversize.valid, false);
  assert.match(oversize.error ?? '', /5\.0 MB/);
});

test('UX-1 B3: concept history deduplicates by id+version and caps cleanly without mutating authoritative spec', () => {
  const first = INITIAL_CONCEPTS[0];
  const second = INITIAL_CONCEPTS[1] ?? { ...first, id: 'concept-2', name: 'Concept 2' };
  let history = appendConceptHistory([], first);
  history = appendConceptHistory(history, second);
  history = appendConceptHistory(history, first); // re-selecting moves to front without duplicate

  assert.equal(history.length, 2);
  assert.equal(history[0].id, first.id);
  assert.equal(history[1].id, second.id);

  let capped = history;
  for (let i = 0; i < MAX_CONCEPT_HISTORY_ITEMS + 5; i++) {
    capped = appendConceptHistory(capped, { ...first, id: `hist-${i}`, version: 1 });
  }
  assert.equal(capped.length, MAX_CONCEPT_HISTORY_ITEMS);
});

test('UX-1 B3: FashionStudio forwards referenceImageBase64 to generateGarmentConcept and never auto-approves', async () => {
  const studioSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/fashion-studio/FashionStudio.tsx'),
    'utf-8'
  );
  assert.match(studioSource, /referenceImageBase64:\s*referenceImage\?\.dataUrl/);
  assert.match(studioSource, /data-testid="reference-image-preview"/);

  const result = await generateGarmentConcept({
    prompt: 'Structured pleated wool skirt',
    category: 'skirt',
    silhouette: 'a-line',
    fabricId: INITIAL_CONCEPTS[0].fabric.id,
    colorName: 'Midnight Ink',
    colorHex: '#1C212D',
    easeProfile: 'classic',
    lengthCm: 68,
    referenceImageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    referenceImageName: 'moodboard.png'
  });
  assert.equal(result.specification.isApproved, false);
  assert.ok(result.specification.designNotes.some(note => note.includes('moodboard.png')));
});

test('UX-1 B4: ProductionPackagePanel has a single authoritative mount in ProductionOverview (not PatternWorkspace)', () => {
  const patternSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/pattern-workspace/PatternWorkspace.tsx'),
    'utf-8'
  );
  const productionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/production/ProductionOverview.tsx'),
    'utf-8'
  );

  assert.equal(patternSource.includes('<ProductionPackagePanel'), false);
  assert.equal(productionSource.includes('<ProductionPackagePanel'), true);
});

test('UX-1 B4: MeasurementWorkspace removes nested grid wrapper around anatomical measurement inputs', () => {
  const measurementSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/measurements/MeasurementWorkspace.tsx'),
    'utf-8'
  );
  assert.match(measurementSource, /data-testid="measurement-inputs-container"/);
  assert.equal(
    measurementSource.includes('<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">\n            {isBodice ? ('),
    false
  );
});

test('Checkpoint N M-B4-02: oversize reference image rounding never displays "5.00 MB" for files > 5.0 MB', () => {
  const justOver5Mb = MAX_REFERENCE_IMAGE_BYTES + 1;
  const slightlyOver5Mb = MAX_REFERENCE_IMAGE_BYTES + 1024;
  assert.equal(formatOversizeImageMb(justOver5Mb), '5.01');
  assert.equal(formatOversizeImageMb(slightlyOver5Mb), '5.01');

  const res = validateReferenceImageFile({
    name: 'barely-over.png',
    type: 'image/png',
    size: slightlyOver5Mb
  });
  assert.equal(res.valid, false);
  assert.match(res.error ?? '', /5\.01 MB/);
  assert.equal((res.error ?? '').includes('5.00 MB'), false);
});

test('Checkpoint N M-B4-01: generateGarmentConcept avoids default 404 fetch in SPA mode and uses truthful fallback notes', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let lastFetchBody: string | undefined;

  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    fetchCalls += 1;
    lastFetchBody = init?.body;
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;

  try {
    // Default client-only SPA call must not hit missing /api/fashion/concept endpoint
    const demoResult = await generateGarmentConcept({
      prompt: 'Clean linen midi skirt',
      category: 'skirt',
      silhouette: 'straight',
      fabricId: INITIAL_CONCEPTS[0].fabric.id,
      colorName: 'Chalk Oatmeal',
      colorHex: '#E8E3D9',
      easeProfile: 'classic',
      lengthCm: 65,
      referenceImageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      referenceImageName: 'linen-ref.png'
    });
    assert.equal(fetchCalls, 0);
    assert.equal(demoResult.executionMode, 'studio-demonstration-mode');
    assert.equal(demoResult.specification.isApproved, false);
    assert.ok(demoResult.specification.designNotes.some(note => note.includes('linen-ref.png')));
    assert.equal(
      demoResult.specification.designNotes.some(note => /silhouette analyzed/i.test(note)),
      false,
      'Studio Demonstration Mode must not claim automated silhouette analysis'
    );

    // Explicit opt-in still posts referenceImageBase64 and falls back cleanly on 404
    const optInResult = await generateGarmentConcept(
      {
        prompt: 'Clean linen midi skirt',
        category: 'skirt',
        silhouette: 'straight',
        fabricId: INITIAL_CONCEPTS[0].fabric.id,
        colorName: 'Chalk Oatmeal',
        colorHex: '#E8E3D9',
        easeProfile: 'classic',
        lengthCm: 65,
        referenceImageBase64: 'data:image/png;base64,AAAA',
        referenceImageName: 'linen-ref.png'
      },
      { enableLiveEndpoint: true }
    );
    assert.equal(fetchCalls, 1);
    assert.match(lastFetchBody ?? '', /"referenceImageBase64":"data:image\/png;base64,AAAA"/);
    assert.equal(optInResult.executionMode, 'studio-demonstration-mode');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Checkpoint N M-B3-01: ProjectWorkspaceContext keeps state updaters pure with zero nested setState calls', () => {
  const skirt = INITIAL_CONCEPTS[0];
  const bodice = INITIAL_CONCEPTS[1] ?? { ...skirt, id: 'bodice-1', garmentCategory: 'bodice' as const };
  const switchDelta = deriveDraftingOptionsForSpecChange(skirt, {
    ...bodice,
    dartStyle: 'french',
    sleeveEaseStrategy: 'tailored'
  });
  assert.deepEqual(switchDelta, {
    bodiceDartStyle: 'french',
    sleeveEaseStrategy: 'tailored'
  });

  const sameGarmentNoDartChange = deriveDraftingOptionsForSpecChange(skirt, {
    ...skirt,
    lengthCm: skirt.lengthCm + 4
  });
  assert.deepEqual(sameGarmentNoDartChange, {});

  const ctxSource = fs.readFileSync(
    path.join(process.cwd(), 'src/state/ProjectWorkspaceContext.tsx'),
    'utf-8'
  );
  assert.equal(/setCurrentSpec\s*\(\s*prevSpec\s*=>/.test(ctxSource), false);
  assert.equal(/setMeasurementProvenance\s*\(\s*prevOrigin\s*=>/.test(ctxSource), false);
});

test('Checkpoint N M-B3-02: StudioDraftBrief snapshot lifts unsaved Creative Studio brief into ProjectWorkspaceContext', () => {
  const initial = INITIAL_CONCEPTS[0];
  const brief = createStudioDraftBriefFromSpec(initial);
  assert.equal(brief.prompt, initial.prompt);
  assert.equal(brief.category, initial.garmentCategory);
  assert.equal(brief.silhouette, initial.silhouette);
  assert.equal(brief.selectedFabricId, initial.fabric.id);
  assert.equal(brief.lengthCm, initial.lengthCm);

  const appSource = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf-8');
  assert.match(appSource, /draftBrief=\{studioDraftBrief\}/);
  assert.match(appSource, /onUpdateDraftBrief=\{updateStudioDraftBrief\}/);
});

test('Checkpoint N M-B7-01: DesignSpecificationView SHA-256 lineage row wraps cleanly without shrink-0 overflow at 768px', () => {
  const specSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/design-specification/DesignSpecificationView.tsx'),
    'utf-8'
  );
  assert.match(specSource, /flex flex-col lg:flex-row lg:items-center justify-between gap-2 text-\[11px\]/);
  assert.equal(
    specSource.includes('text-neutral-500 shrink-0">\n            Note: SHA-256 is an integrity digest'),
    false
  );
});

