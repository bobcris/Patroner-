/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DesignSpecification, EaseProfile, FabricProperty, GarmentCategory, Silhouette } from '../../types';
import { PRESET_FABRICS } from '../../domain/design/preset-fabrics';
import type {
  AiConceptCandidate,
  AiEpistemicClaim,
  AiOperationOutcome,
  AiServiceAvailability
} from '../../features/creative-studio/types';

export interface ConceptGenerationInput {
  prompt: string;
  category: GarmentCategory;
  silhouette: Silhouette;
  fabricId: string;
  colorName: string;
  colorHex: string;
  easeProfile: EaseProfile;
  lengthCm: number;
  referenceImageBase64?: string;
  referenceImageName?: string;
}

export interface ConceptGenerationResult {
  specification: DesignSpecification;
  executionMode: 'live-server-gemini' | 'studio-demonstration-mode';
  engineNotes: string;
}

export interface ConceptGenerationOptions {
  /** Explicitly opt into calling the server-side `/api/fashion/concept` endpoint. */
  enableLiveEndpoint?: boolean;
  endpointUrl?: string;
}

function isLiveConceptEndpointEnabled(options?: ConceptGenerationOptions): boolean {
  if (typeof options?.enableLiveEndpoint === 'boolean') {
    return options.enableLiveEndpoint;
  }
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  return metaEnv?.VITE_ENABLE_FASHION_CONCEPT_API === 'true';
}

/**
 * AI Fashion Service for translating creative concepts into structured garment specifications.
 * Separates AI-inferred proposals from deterministic pattern drafting and human approvals.
 */
export async function generateGarmentConcept(
  input: ConceptGenerationInput,
  options?: ConceptGenerationOptions
): Promise<ConceptGenerationResult> {
  // Only invoke server-side Gemini endpoint when explicitly configured/enabled to avoid spurious 404s in client-only SPA mode
  if (isLiveConceptEndpointEnabled(options)) {
    try {
      const res = await fetch(options?.endpointUrl ?? '/api/fashion/concept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });

      if (res.ok) {
        const data = await res.json();
        return {
          specification: data.specification,
          executionMode: 'live-server-gemini',
          engineNotes: 'Generated via server-side Gemini multimodal reasoning.'
        };
      }
    } catch {
      // Fallback to client-side Studio Demonstration Engine (deterministic fashion intelligence)
    }
  }

  // Find fabric
  const selectedFabric = PRESET_FABRICS.find(f => f.id === input.fabricId) || PRESET_FABRICS[0];

  // Procedural fashion domain rules based on category and silhouette
  const isMini = input.lengthCm < 50;
  const isMaxi = input.lengthCm > 85;
  const lengthDesc = isMini ? 'Mini length' : isMaxi ? 'Full maxi length' : 'Graceful midi length';

  const generatedSpec: DesignSpecification = {
    id: `concept-${Date.now().toString(36)}`,
    name: input.prompt ? input.prompt.slice(0, 38).trim() : `Tailored ${input.silhouette.toUpperCase()} ${input.category}`,
    prompt: input.prompt || `A bespoke ${input.silhouette} ${input.category} crafted in ${selectedFabric.name}.`,
    garmentCategory: input.category,
    silhouette: input.silhouette,
    fabric: selectedFabric,
    color: {
      name: input.colorName,
      hex: input.colorHex
    },
    easeProfile: input.easeProfile,
    lengthCm: input.lengthCm,
    constructionFeatures: [
      {
        id: `feat-closure-${Date.now()}`,
        category: 'closure',
        name: 'Concealed Center-Back YKK Zipper',
        description: 'Concealed coil zipper set flush with upper waist seam allowance.',
        patternImpact: '1.5cm seam allowance on Center Back; zipper stop notch drafted.'
      },
      {
        id: `feat-dart-${Date.now()}`,
        category: 'dart',
        name: input.silhouette === 'a-line' ? 'Relaxed Front Dart Suppression' : 'Contoured Dual Dart Pair',
        description: 'Anatomically positioned waist darts transferring fullness smoothly to the hip line.',
        patternImpact: 'Waist suppression distributed evenly between side seam curve and dart uptakes.'
      },
      {
        id: `feat-hem-${Date.now()}`,
        category: 'hem',
        name: selectedFabric.weight === 'lightweight' ? 'Fine Baby Rolled Hem' : '3.0cm Tailored Blind Hem',
        description: `${lengthDesc} finished with stabilized hem allowance.`,
        patternImpact: '3.0cm hem allowance extension on pattern cut path.'
      }
    ],
    designNotes: [
      `Engineered for ${selectedFabric.name} with ${input.easeProfile} ease profile.`,
      input.referenceImageName
        ? `Reference image attached for designer brief context: "${input.referenceImageName}" (stored with session brief; automated visual silhouette analysis is not performed in Studio Demonstration Mode).`
        : 'Synthesized from parametric brief controls (Studio Demonstration Mode).'
    ],
    isApproved: false, // Must be approved by designer before drafting
    version: 1,
    aiEstimates: {
      suggestedSilhouette: `${input.silhouette.toUpperCase()} (${lengthDesc})`,
      styleConfidenceScore: 94,
      suggestedFabrics: [selectedFabric.name, 'Virgin Wool Crepe', 'Belgian Linen'],
      technicalAdvice: `Given ${selectedFabric.stretch} stretch and ${selectedFabric.weight} weight, ensure interfacings are applied to waistline stay-facings.`,
      disclaimer: 'Note: Visual concept and construction proposals are AI-generated. Human designer approval is required to freeze specs for pattern drafting.'
    }
  };

  return {
    specification: generatedSpec,
    executionMode: 'studio-demonstration-mode',
    engineNotes: 'Studio Demonstration Mode (deterministic parametric synthesis; live multimodal vision endpoint disabled).'
  };
}

// ============================================================================
// UX-2.2 C2 — Separated AI Service Availability vs Operation Outcome Contract
// ============================================================================

export interface AiServiceStatusInfo {
  availability: AiServiceAvailability;
  label: string;
  description: string;
}

export interface ConceptVariationRequest {
  brief: string;
  title: string;
  category: GarmentCategory;
  silhouette: Silhouette;
  fabricId: string;
  colorName: string;
  colorHex: string;
  easeProfile: EaseProfile;
  lengthCm: number;
  attachedAssetIds: string[];
  attachedAssetNames: string[];
}

export interface ConceptVariationBatchResult {
  serviceAvailability: AiServiceAvailability;
  operationOutcome: AiOperationOutcome;
  analyzedReferenceImages: boolean;
  candidates: AiConceptCandidate[];
  statusNote: string;
  errorMessage?: string;
}

/**
 * Resolves current AI service availability without performing hidden network requests (D4 + C2).
 */
export function resolveAiServiceAvailability(
  options?: ConceptGenerationOptions
): AiServiceStatusInfo {
  if (isLiveConceptEndpointEnabled(options)) {
    return {
      availability: 'configured-ready',
      label: 'Configured AI Service',
      description: 'Server-side AI endpoint is explicitly enabled for this session.'
    };
  }
  return {
    availability: 'demonstration',
    label: 'Demonstration Mode',
    description:
      'Client-side deterministic exploration only. No external AI service is active and uploaded images are not visually analyzed.'
  };
}

const DEMO_VARIATION_PROFILES: ReadonlyArray<{
  suffix: string;
  silhouetteMap: Record<Silhouette, Silhouette>;
  easeMap: Record<EaseProfile, EaseProfile>;
  lengthDeltaCm: number;
  fabricFallbackIdx: number;
  colorShift: { name: string; hex: string } | null;
  focusLabel: string;
  featureName: string;
  featureImpact: string;
}> = [
  {
    suffix: 'Architectural Tailored Study',
    silhouetteMap: {
      'a-line': 'a-line',
      straight: 'straight',
      pencil: 'pencil',
      flared: 'a-line',
      tailored: 'tailored',
      relaxed: 'straight',
      wrap: 'wrap'
    },
    easeMap: {
      'ultra-fitted': 'fitted',
      fitted: 'fitted',
      classic: 'classic',
      relaxed: 'classic',
      oversized: 'relaxed'
    },
    lengthDeltaCm: 0,
    fabricFallbackIdx: 0,
    colorShift: null,
    focusLabel: 'Clean seam geometry and restrained dart shaping',
    featureName: 'Structured Internal Waist Stay',
    featureImpact: 'Maintains waistline stability without bulky external waistband.'
  },
  {
    suffix: 'Fluid Volume Exploration',
    silhouetteMap: {
      'a-line': 'flared',
      straight: 'a-line',
      pencil: 'straight',
      flared: 'flared',
      tailored: 'relaxed',
      relaxed: 'relaxed',
      wrap: 'flared'
    },
    easeMap: {
      'ultra-fitted': 'classic',
      fitted: 'classic',
      classic: 'relaxed',
      relaxed: 'relaxed',
      oversized: 'oversized'
    },
    lengthDeltaCm: 6,
    fabricFallbackIdx: 2,
    colorShift: { name: 'Warm Stone', hex: '#C6BEB0' },
    focusLabel: 'Extended hem drape with softer movement ease',
    featureName: 'Extended Swing Hem Facing',
    featureImpact: 'Adds clean weight at hem edge for fluid stride drape.'
  },
  {
    suffix: 'Crisp Atelier Contrast',
    silhouetteMap: {
      'a-line': 'straight',
      straight: 'pencil',
      pencil: 'pencil',
      flared: 'a-line',
      tailored: 'tailored',
      relaxed: 'tailored',
      wrap: 'tailored'
    },
    easeMap: {
      'ultra-fitted': 'ultra-fitted',
      fitted: 'fitted',
      classic: 'fitted',
      relaxed: 'classic',
      oversized: 'classic'
    },
    lengthDeltaCm: -4,
    fabricFallbackIdx: 1,
    colorShift: { name: 'Midnight Ink', hex: '#1C212D' },
    focusLabel: 'Sharper silhouette contour with structured woven hand',
    featureName: 'Topstitched Concealed Back Vent',
    featureImpact: 'Adds walking clearance while preserving straight profile.'
  }
];

/**
 * Generates structured concept exploration candidates for the Creative Studio Results Gallery.
 * Strictly separates service availability from operation outcome (C2) and never silently
 * masquerades a failed endpoint or demonstration synthesis as completed AI visual analysis.
 */
export async function generateConceptVariations(
  input: ConceptVariationRequest,
  options?: ConceptGenerationOptions
): Promise<ConceptVariationBatchResult> {
  const status = resolveAiServiceAvailability(options);
  const nowIso = new Date().toISOString();

  // Configured live endpoint path: never silently fall back to fake "completed AI" on failure (C2)
  if (status.availability === 'configured-ready') {
    try {
      const res = await fetch(options?.endpointUrl ?? '/api/fashion/variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });

      if (!res.ok) {
        return {
          serviceAvailability: 'configured-error',
          operationOutcome: 'failed-operation',
          analyzedReferenceImages: false,
          candidates: [],
          statusNote: `Configured AI endpoint returned HTTP ${res.status}. No AI analysis was completed.`,
          errorMessage: `AI service error (HTTP ${res.status}). Check server configuration or switch to Demonstration Mode.`
        };
      }

      const payload = (await res.json()) as {
        candidates?: AiConceptCandidate[];
        analyzedReferenceImages?: boolean;
      };
      const returned = Array.isArray(payload.candidates) ? payload.candidates : [];
      return {
        serviceAvailability: 'configured-ready',
        operationOutcome: 'successful-ai-result',
        analyzedReferenceImages: Boolean(payload.analyzedReferenceImages),
        candidates: returned.map(c => ({
          ...c,
          serviceAvailability: 'configured-ready',
          operationOutcome: 'successful-ai-result'
        })),
        statusNote: 'Completed via configured server-side AI service.'
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network request failed';
      return {
        serviceAvailability: 'configured-error',
        operationOutcome: 'failed-operation',
        analyzedReferenceImages: false,
        candidates: [],
        statusNote: 'Configured AI endpoint could not be reached. No AI analysis was completed.',
        errorMessage: `AI service unavailable: ${msg}`
      };
    }
  }

  // Default D4 Demonstration Mode: zero network requests, truthful epistemic claims
  const baseFabric = PRESET_FABRICS.find(f => f.id === input.fabricId) ?? PRESET_FABRICS[0];
  const baseTitle = input.title.trim() || `${input.silhouette} ${input.category}`;

  const candidates: AiConceptCandidate[] = DEMO_VARIATION_PROFILES.map((profile, idx) => {
    const fabric = idx === 0 ? baseFabric : PRESET_FABRICS[profile.fabricFallbackIdx] ?? baseFabric;
    const nextSilhouette = profile.silhouetteMap[input.silhouette] ?? input.silhouette;
    const nextEase = profile.easeMap[input.easeProfile] ?? input.easeProfile;
    const nextLength = Math.max(35, Math.min(145, Math.round(input.lengthCm + profile.lengthDeltaCm)));
    const nextColor = profile.colorShift ?? { name: input.colorName, hex: input.colorHex };

    const claims: AiEpistemicClaim[] = [
      {
        field: 'silhouette',
        value: nextSilhouette,
        tag: 'DEMONSTRATION_SYNTHESIS',
        rationale: 'Derived deterministically from your brief controls in Demonstration Mode.'
      },
      {
        field: 'fabric',
        value: fabric.name,
        tag: 'INFERRED_CATEGORY_PRIOR',
        rationale: `Selected from curated atelier library (${fabric.weight} weight, ${fabric.stretch} stretch).`
      },
      {
        field: 'targetLengthCm',
        value: `${nextLength} cm`,
        tag: 'AMBIGUOUS_REQUIRES_CONFIRMATION',
        rationale: 'Visual target length only; requires explicit designer confirmation before Pattern Atelier drafting.'
      }
    ];

    const notes: string[] = [
      `Demonstration variation (${profile.focusLabel}).`,
      `Paired with ${fabric.name} and ${nextEase} ease direction.`
    ];
    if (input.attachedAssetNames.length > 0) {
      notes.push(
        `Board references listed for designer context only (${input.attachedAssetNames.slice(0, 3).join(', ')}). Automated image analysis is NOT active in Demonstration Mode.`
      );
    }

    return {
      id: `demo-cand-${Date.now().toString(36)}-${idx + 1}`,
      createdAt: nowIso,
      serviceAvailability: 'demonstration',
      operationOutcome: 'demonstration-result',
      analyzedReferenceImages: false,
      referencedAssetIds: [...input.attachedAssetIds],
      title: `${baseTitle.slice(0, 26).trim()} — ${profile.suffix}`,
      summary: `${profile.focusLabel}. Proposed in ${fabric.name} (${nextColor.name}) at ${nextLength} cm target length.`,
      garmentCategory: input.category,
      silhouette: nextSilhouette,
      fabricId: fabric.id,
      fabricName: fabric.name,
      colorName: nextColor.name,
      colorHex: nextColor.hex,
      easeProfile: nextEase,
      lengthCm: nextLength,
      constructionFeatures: [
        {
          id: `demo-feat-${idx}-1`,
          category: 'closure',
          name: 'Concealed Center-Back Zipper',
          description: 'Standard concealed coil zipper set flush with upper waist seam.',
          patternImpact: '1.5cm seam allowance on Center Back; zipper stop notch drafted.'
        },
        {
          id: `demo-feat-${idx}-2`,
          category: idx === 1 ? 'hem' : idx === 2 ? 'vent' : 'waistband',
          name: profile.featureName,
          description: profile.focusLabel,
          patternImpact: profile.featureImpact
        }
      ],
      designNotes: notes,
      epistemicClaims: claims,
      disclaimer:
        'Demonstration synthesis only (live AI endpoint disabled). Reference images were not visually analyzed. Candidate is non-authoritative and cannot overwrite your active specification until explicitly applied or promoted.'
    };
  });

  return {
    serviceAvailability: 'demonstration',
    operationOutcome: 'demonstration-result',
    analyzedReferenceImages: false,
    candidates,
    statusNote:
      'Generated 3 demonstration concept variations locally (zero network requests; uploaded images were not visually analyzed).'
  };
}

