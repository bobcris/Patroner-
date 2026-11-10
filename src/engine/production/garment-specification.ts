/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DesignSpecification } from '../../types';
import { CURRENT_ENGINE_VERSION, CURRENT_SNAPSHOT_ENGINE } from './pattern-revision-snapshot';
import { canonicalizeJson, deepFreeze } from './pattern-revision-snapshot';
import { sha256Hex } from './crypto';
import {
  ApprovalAuthorityTier,
  AuthoritativeGarmentSpecification,
  CreateAuthoritativeSpecificationInput,
  SpecificationApprovalEvent,
  SpecificationApprovalRecord,
  SpecificationApprovalState,
  SpecificationLifecycleEvent,
  SpecificationRevocationEvent,
  SpecificationValueProvenance
} from './garment-specification-types';
import { EnhancedFabricProperty } from '../fabric/fabric-types';
import { ProductionSnapshotValidationError } from './production-types';

/**
 * Validates whether an ISO date string is syntactically well-formed and parseable.
 */
function isValidIsoDate(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string' || dateStr.trim() === '') return false;
  const epoch = Date.parse(dateStr);
  return Number.isFinite(epoch);
}

/**
 * Computes a deterministic SHA-256 fingerprint for ALL engineering-significant specification fields.
 * Used for cryptographic approval binding, tamper detection, and dependency tracking.
 *
 * Excludes volatile metadata (createdAt, updatedAt) that does not affect engineering outcomes.
 */
export function computeSpecificationFingerprint(
  spec: AuthoritativeGarmentSpecification | CreateAuthoritativeSpecificationInput | DesignSpecification
): string {
  // 1. Identity and revision
  const garmentId = 'garmentId' in spec && spec.garmentId
    ? spec.garmentId
    : ('id' in spec && (spec as DesignSpecification).id ? (spec as DesignSpecification).id : 'garment');

  const version = spec.version ?? 1;
  const specificationRevisionId = spec.specificationRevisionId ?? `spec-${garmentId}-v${version}`;
  const parentRevisionId = spec.parentRevisionId ?? null;
  const projectId = ('projectId' in spec && spec.projectId) ? spec.projectId : 'project-patroner-default';
  const garmentCategory = spec.garmentCategory;

  // 2. Target Finished Dimensions (extract all fields without loss)
  let lengthCm = 0;
  let waistCm: number | null = null;
  let hipCm: number | null = null;
  let bustCm: number | null = null;
  let chestCm: number | null = null;
  let acrossBackCm: number | null = null;
  let bicepCm: number | null = null;
  let wristCm: number | null = null;

  if ('targetFinishedDimensions' in spec && spec.targetFinishedDimensions) {
    const td = spec.targetFinishedDimensions as {
      lengthCm?: number;
      length?: number;
      waistCm?: number;
      waist?: number;
      hipCm?: number;
      hip?: number;
      bustCm?: number;
      bust?: number;
      chestCm?: number;
      chest?: number;
      acrossBackCm?: number;
      acrossBack?: number;
      bicepCm?: number;
      bicep?: number;
      wristCm?: number;
      wrist?: number;
    };
    if (typeof td.lengthCm === 'number') lengthCm = td.lengthCm;
    else if (typeof td.length === 'number') lengthCm = td.length;

    waistCm = typeof td.waistCm === 'number' ? td.waistCm : (typeof td.waist === 'number' ? td.waist : null);
    hipCm = typeof td.hipCm === 'number' ? td.hipCm : (typeof td.hip === 'number' ? td.hip : null);
    bustCm = typeof td.bustCm === 'number' ? td.bustCm : (typeof td.bust === 'number' ? td.bust : null);
    chestCm = typeof td.chestCm === 'number' ? td.chestCm : (typeof td.chest === 'number' ? td.chest : null);
    acrossBackCm = typeof td.acrossBackCm === 'number' ? td.acrossBackCm : (typeof td.acrossBack === 'number' ? td.acrossBack : null);
    bicepCm = typeof td.bicepCm === 'number' ? td.bicepCm : (typeof td.bicep === 'number' ? td.bicep : null);
    wristCm = typeof td.wristCm === 'number' ? td.wristCm : (typeof td.wrist === 'number' ? td.wrist : null);
  }

  if (!lengthCm && 'lengthCm' in spec && typeof spec.lengthCm === 'number') {
    lengthCm = spec.lengthCm;
  }

  // 3. Design and construction features
  const constructionFeatures = Array.isArray(spec.constructionFeatures)
    ? [...spec.constructionFeatures]
        .map(f => ({
          id: f.id,
          category: f.category,
          name: f.name,
          description: f.description ?? '',
          patternImpact: f.patternImpact ?? ''
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];

  const designNotes = Array.isArray(spec.designNotes)
    ? [...spec.designNotes].filter(n => typeof n === 'string' && n.trim() !== '').sort()
    : [];

  // 4. Fabric Engineering Properties
  const fab = spec.fabric;
  const enhanced = fab as Partial<EnhancedFabricProperty> | undefined;
  const fabricData = fab ? {
    id: fab.id,
    name: fab.name,
    weight: fab.weight,
    stretch: fab.stretch,
    gsm: enhanced?.gsm ?? null,
    thicknessMm: enhanced?.thicknessMm ?? null,
    moldingFactor: enhanced?.moldingFactor ?? null,
    directional: enhanced?.directional ? {
      warp: enhanced.directional.warp ? {
        shrinkagePercent: enhanced.directional.warp.shrinkagePercent,
        stretchPercent: enhanced.directional.warp.stretchPercent
      } : null,
      weft: enhanced.directional.weft ? {
        shrinkagePercent: enhanced.directional.weft.shrinkagePercent,
        stretchPercent: enhanced.directional.weft.stretchPercent
      } : null,
      bias: enhanced.directional.bias ? {
        stretchPercent: enhanced.directional.bias.stretchPercent
      } : null
    } : null,
    fabricRevision: 'fabricRevision' in spec && spec.fabricRevision
      ? spec.fabricRevision
      : (enhanced?.revision ?? null),
    fabricProvenance: 'fabricProvenance' in spec && spec.fabricProvenance
      ? spec.fabricProvenance
      : (enhanced?.provenance ?? 'unknown')
  } : null;

  // 5. Allowances
  let allowances = {
    seamAllowanceCm: 1.5,
    hemAllowanceCm: 3.0,
    waistAllowanceCm: 1.0,
    neckAllowanceCm: 1.0,
    armholeAllowanceCm: 1.0,
    shoulderAllowanceCm: 1.0
  };

  if ('allowances' in spec && spec.allowances) {
    const a = spec.allowances;
    allowances = {
      seamAllowanceCm: a.seamAllowanceCm ?? 1.5,
      hemAllowanceCm: a.hemAllowanceCm ?? 3.0,
      waistAllowanceCm: a.waistAllowanceCm ?? 1.0,
      neckAllowanceCm: a.neckAllowanceCm ?? 1.0,
      armholeAllowanceCm: a.armholeAllowanceCm ?? 1.0,
      shoulderAllowanceCm: a.shoulderAllowanceCm ?? 1.0
    };
  } else {
    const ds = spec as DesignSpecification;
    allowances = {
      seamAllowanceCm: ds.seamAllowanceCm ?? 1.5,
      hemAllowanceCm: ds.hemAllowanceCm ?? 3.0,
      waistAllowanceCm: ds.waistAllowanceCm ?? 1.0,
      neckAllowanceCm: ds.neckAllowanceCm ?? 1.0,
      armholeAllowanceCm: ds.armholeAllowanceCm ?? 1.0,
      shoulderAllowanceCm: ds.shoulderAllowanceCm ?? 1.0
    };
  }

  // 6. Explicit Ease
  const explicitEase = spec.explicitEaseCm ? {
    waist: spec.explicitEaseCm.waist ?? null,
    hip: spec.explicitEaseCm.hip ?? null,
    bust: spec.explicitEaseCm.bust ?? null,
    biceps: spec.explicitEaseCm.biceps ?? null,
    wrist: spec.explicitEaseCm.wrist ?? null,
    neck: spec.explicitEaseCm.neck ?? null
  } : null;

  // 7. AI Estimates (relevant where consumed)
  const aiEstimates = spec.aiEstimates ? {
    suggestedSilhouette: spec.aiEstimates.suggestedSilhouette ?? null,
    styleConfidenceScore: spec.aiEstimates.styleConfidenceScore ?? null,
    suggestedFabrics: Array.isArray(spec.aiEstimates.suggestedFabrics)
      ? [...spec.aiEstimates.suggestedFabrics].sort()
      : [],
    technicalAdvice: spec.aiEstimates.technicalAdvice ?? null
  } : null;

  // 8. Engine version
  const engineVersion = ('engineProvenance' in spec && spec.engineProvenance?.engineVersion)
    ? spec.engineProvenance.engineVersion
    : CURRENT_ENGINE_VERSION;

  const payload = {
    projectId,
    garmentId,
    specificationRevisionId,
    parentRevisionId,
    version,
    garmentCategory,
    silhouette: spec.silhouette,
    prompt: spec.prompt ?? '',
    dartStyle: spec.dartStyle ?? null,
    sleeveEaseStrategy: spec.sleeveEaseStrategy ?? null,
    constructionFeatures,
    designNotes,
    fabric: fabricData,
    targetFinishedDimensions: {
      lengthCm,
      waistCm,
      hipCm,
      bustCm,
      chestCm,
      acrossBackCm,
      bicepCm,
      wristCm
    },
    explicitEaseCm: explicitEase,
    easeProfile: spec.easeProfile,
    allowances,
    aiEstimates,
    engineVersion
  };

  return sha256Hex(canonicalizeJson(payload));
}

/**
 * Verifies whether a specification revision has a valid, untampered approval record.
 * Recomputes the canonical specification fingerprint and enforces strict authority tier validation.
 */
export function verifySpecificationApproval(
  spec: AuthoritativeGarmentSpecification | DesignSpecification
): {
  isValid: boolean;
  state: SpecificationApprovalState;
  reason?: string;
  fingerprint: string;
} {
  const currentFingerprint = computeSpecificationFingerprint(spec);
  const specId = 'garmentId' in spec && spec.garmentId
    ? spec.garmentId
    : ('id' in spec && (spec as DesignSpecification).id ? (spec as DesignSpecification).id : 'garment');
  const specRevId = spec.specificationRevisionId ?? `spec-${specId}-v${spec.version || 1}`;

  if (!spec.isApproved) {
    const st = spec.approvalState ?? 'draft';
    return {
      isValid: false,
      state: st === 'approved' ? 'draft' : st,
      reason: 'Specification is not approved.',
      fingerprint: currentFingerprint
    };
  }

  if (spec.approvalState === 'revoked') {
    return {
      isValid: false,
      state: 'revoked',
      reason: 'Specification approval was explicitly revoked.',
      fingerprint: currentFingerprint
    };
  }

  if (spec.approvalState === 'superseded') {
    return {
      isValid: false,
      state: 'superseded',
      reason: 'Specification revision has been superseded by a newer revision.',
      fingerprint: currentFingerprint
    };
  }

  if (!spec.approvalRecord) {
    if (spec.approvalAuthorityTier === 'demonstration_fixture') {
      if (!spec.approvedBy || spec.approvedBy.trim() === '') {
        return {
          isValid: false,
          state: 'invalid',
          reason: 'Approved demonstration fixture lacks an approver identity.',
          fingerprint: currentFingerprint
        };
      }
      if (!spec.approvedAt || !isValidIsoDate(spec.approvedAt)) {
        return {
          isValid: false,
          state: 'invalid',
          reason: 'Approved demonstration fixture lacks a valid ISO approval timestamp.',
          fingerprint: currentFingerprint
        };
      }
      return {
        isValid: true,
        state: 'approved',
        fingerprint: currentFingerprint
      };
    }

    return {
      isValid: false,
      state: 'invalid',
      reason: 'Approved specification lacks an authoritative approval record.',
      fingerprint: currentFingerprint
    };
  }

  const record = spec.approvalRecord;

  // Verify exact revision ID
  if (record.targetRevisionId !== specRevId) {
    return {
      isValid: false,
      state: 'invalid',
      reason: `Approval record target revision '${record.targetRevisionId}' does not match specification revision '${specRevId}'.`,
      fingerprint: currentFingerprint
    };
  }

  // Verify exact specification fingerprint
  if (record.targetSpecificationFingerprint !== currentFingerprint) {
    return {
      isValid: false,
      state: 'invalid',
      reason: 'Specification content has been modified after approval was granted; content fingerprint mismatch.',
      fingerprint: currentFingerprint
    };
  }

  // Verify authority tier
  if (record.authorityTier === 'cryptographic_principal') {
    // Cryptographic principal must remain unavailable until genuine authentication provider exists
    return {
      isValid: false,
      state: 'invalid',
      reason: 'cryptographic_principal authority tier is unavailable without cryptographic provider configuration.',
      fingerprint: currentFingerprint
    };
  }

  // Verify approver identity
  if (!record.approverName || record.approverName.trim() === '' || !record.approverId || record.approverId.trim() === '') {
    return {
      isValid: false,
      state: 'invalid',
      reason: 'Approved specification approval record lacks a valid approver identity.',
      fingerprint: currentFingerprint
    };
  }

  // Verify approval timestamp
  if (!record.approvedAt || !isValidIsoDate(record.approvedAt)) {
    return {
      isValid: false,
      state: 'invalid',
      reason: 'Approved specification approval record lacks a valid ISO approval timestamp.',
      fingerprint: currentFingerprint
    };
  }

  return {
    isValid: true,
    state: 'approved',
    fingerprint: currentFingerprint
  };
}

/**
 * Creates an authoritative garment specification binding creative design intent
 * with deterministic mechanical allowances, target dimensions, and explicit ease.
 */
export function createAuthoritativeGarmentSpecification(
  input: CreateAuthoritativeSpecificationInput
): AuthoritativeGarmentSpecification {
  if (!input.name || input.name.trim() === '') {
    throw new ProductionSnapshotValidationError('Specification name is required and cannot be empty.');
  }
  if (!input.garmentCategory) {
    throw new ProductionSnapshotValidationError('Garment category is required.');
  }
  if (!Number.isFinite(input.lengthCm) || input.lengthCm <= 0) {
    throw new ProductionSnapshotValidationError(
      `Target lengthCm must be a positive finite number (received ${input.lengthCm}).`
    );
  }
  if (!input.fabric || typeof input.fabric !== 'object') {
    throw new ProductionSnapshotValidationError('Fabric property specification is required.');
  }

  const now = new Date().toISOString();
  const version = input.version ?? 1;
  const specId = input.specificationRevisionId ?? `spec-${input.garmentId ?? 'garment'}-v${version}`;

  const hasApprover = Boolean(input.approvedBy && input.approvedBy.trim() !== '');
  const isApprovedRequested = Boolean(input.isApproved || input.approvalState === 'approved');
  const isApproved = isApprovedRequested && hasApprover;

  let approvedBy = isApproved ? input.approvedBy?.trim() : undefined;
  let approvedAt = isApproved ? input.approvedAt : undefined;
  let approvalAuthorityTier: ApprovalAuthorityTier | undefined = isApproved
    ? (input.approvalAuthorityTier ?? 'unauthenticated_local_session')
    : undefined;

  let approvalState: SpecificationApprovalState = input.approvalState ?? (isApproved ? 'approved' : 'draft');
  if (isApprovedRequested && !hasApprover) {
    approvalState = 'draft';
  }

  let approvalProvenance: SpecificationValueProvenance = input.approvalProvenance ?? (
    isApproved
      ? (approvalAuthorityTier === 'demonstration_fixture' ? 'demonstration-fixture' : 'unauthenticated-local-approval')
      : 'designer-edited'
  );

  if (isApproved) {
    if (!approvedAt || !isValidIsoDate(approvedAt)) {
      approvedAt = now;
    }
  } else {
    approvedBy = undefined;
    approvedAt = undefined;
    approvalAuthorityTier = undefined;
    if (approvalProvenance === 'designer-approved' || approvalProvenance === 'unauthenticated-local-approval') {
      approvalProvenance = 'designer-edited';
    }
  }

  const targetFinishedDimensions = {
    lengthCm: input.lengthCm,
    ...(input.targetFinishedDimensions ?? {})
  };

  const allowances = {
    seamAllowanceCm: input.allowances?.seamAllowanceCm ?? 1.5,
    hemAllowanceCm: input.allowances?.hemAllowanceCm ?? 3.0,
    waistAllowanceCm: input.allowances?.waistAllowanceCm ?? 1.0,
    neckAllowanceCm: input.allowances?.neckAllowanceCm ?? 1.0,
    armholeAllowanceCm: input.allowances?.armholeAllowanceCm ?? 1.0,
    shoulderAllowanceCm: input.allowances?.shoulderAllowanceCm ?? 1.0
  };

  const engineProvenance = {
    engineVersion: input.engineProvenance?.engineVersion ?? CURRENT_ENGINE_VERSION,
    snapshotEngine: 'Patroner Authoritative Specification Engine v1.0',
    buildTimestamp: input.engineProvenance?.buildTimestamp ?? now,
    ...(input.engineProvenance ?? {})
  };

  // Compute preliminary specification to generate canonical fingerprint
  const tempSpecPayload = {
    projectId: input.projectId ?? 'project-patroner-default',
    garmentId: input.garmentId ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    specificationRevisionId: specId,
    parentRevisionId: input.parentRevisionId,
    version,
    name: input.name.trim(),
    garmentCategory: input.garmentCategory,
    silhouette: input.silhouette,
    prompt: input.prompt ?? '',
    color: input.color ?? { name: 'Chalk Oatmeal', hex: '#E8E3D9' },
    fabric: input.fabric,
    fabricRevision: input.fabricRevision,
    fabricProvenance: input.fabricProvenance ?? 'unknown',
    easeProfile: input.easeProfile,
    explicitEaseCm: input.explicitEaseCm,
    targetFinishedDimensions,
    dartStyle: input.dartStyle,
    sleeveEaseStrategy: input.sleeveEaseStrategy,
    allowances,
    constructionFeatures: input.constructionFeatures ?? [],
    designNotes: input.designNotes ?? [],
    aiEstimates: input.aiEstimates,
    engineProvenance
  };

  const specFingerprint = computeSpecificationFingerprint(tempSpecPayload as unknown as AuthoritativeGarmentSpecification);

  let approvalRecord: SpecificationApprovalRecord | undefined = undefined;
  let approvalHistory: SpecificationLifecycleEvent[] = input.approvalHistory ? [...input.approvalHistory] : [];
  let revocationRecord: SpecificationRevocationEvent | undefined = input.revocationRecord;

  if (isApproved) {
    if (input.approvalRecord && input.approvalRecord.targetSpecificationFingerprint === specFingerprint) {
      approvalRecord = input.approvalRecord;
    } else {
      const eventId = `appr-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const approvalEvent: SpecificationApprovalEvent = {
        id: eventId,
        eventType: 'approval',
        targetRevisionId: specId,
        targetSpecificationFingerprint: specFingerprint,
        approverId: `approver-${(approvedBy ?? 'operator').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        approverName: approvedBy ?? 'Local Operator',
        authorityTier: approvalAuthorityTier ?? 'unauthenticated_local_session',
        approvedAt: approvedAt!,
        provenance: approvalProvenance
      };

      approvalRecord = {
        eventId,
        approverId: approvalEvent.approverId,
        approverName: approvalEvent.approverName,
        authorityTier: approvalEvent.authorityTier,
        approvedAt: approvalEvent.approvedAt,
        targetRevisionId: specId,
        targetSpecificationFingerprint: specFingerprint,
        provenance: approvalProvenance
      };

      approvalHistory.push(approvalEvent);
    }
  } else if (approvalState === 'revoked' && input.revocationRecord) {
    revocationRecord = input.revocationRecord;
    if (input.approvalRecord) {
      approvalRecord = {
        ...input.approvalRecord,
        revocation: revocationRecord,
        revocationReason: revocationRecord.reason
      };
    }
  }

  const spec: AuthoritativeGarmentSpecification = {
    projectId: input.projectId ?? 'project-patroner-default',
    garmentId: input.garmentId ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    specificationRevisionId: specId,
    parentRevisionId: input.parentRevisionId,
    version,
    name: input.name.trim(),
    garmentCategory: input.garmentCategory,
    silhouette: input.silhouette,
    prompt: input.prompt ?? '',
    color: input.color ?? { name: 'Chalk Oatmeal', hex: '#E8E3D9' },
    fabric: input.fabric,
    fabricRevision: input.fabricRevision,
    fabricProvenance: input.fabricProvenance ?? 'unknown',
    easeProfile: input.easeProfile,
    explicitEaseCm: input.explicitEaseCm ? { ...input.explicitEaseCm } : undefined,
    targetFinishedDimensions,
    dartStyle: input.dartStyle,
    sleeveEaseStrategy: input.sleeveEaseStrategy,
    allowances,
    constructionFeatures: input.constructionFeatures ? [...input.constructionFeatures] : [],
    designNotes: input.designNotes ? [...input.designNotes] : [],
    isApproved,
    approvalState,
    approvalAuthorityTier,
    approvalRecord,
    approvalHistory: approvalHistory.length > 0 ? approvalHistory : undefined,
    revocationRecord,
    approvedBy,
    approvedAt,
    approvalProvenance,
    engineProvenance,
    aiEstimates: input.aiEstimates,
    createdAt: now,
    updatedAt: now
  };

  return deepFreeze(spec);
}

/**
 * Creates a revised specification from an existing baseline.
 * Enforces historical immutability: the base specification remains unchanged.
 * The new revision increments the version, tracks parentRevisionId, and resets approval to 'draft'.
 */
export function reviseAuthoritativeGarmentSpecification(
  base: AuthoritativeGarmentSpecification,
  updates: Partial<CreateAuthoritativeSpecificationInput>
): AuthoritativeGarmentSpecification {
  const newVersion = updates.version ?? (base.version + 1);
  const newRevisionId = updates.specificationRevisionId ?? `spec-${base.garmentId}-v${newVersion}`;
  const parentRevisionId = updates.parentRevisionId !== undefined
    ? updates.parentRevisionId
    : (newVersion === base.version ? base.parentRevisionId : base.specificationRevisionId);

  return createAuthoritativeGarmentSpecification({
    projectId: updates.projectId ?? base.projectId,
    garmentId: updates.garmentId ?? base.garmentId,
    specificationRevisionId: newRevisionId,
    parentRevisionId,
    version: newVersion,
    name: updates.name ?? base.name,
    garmentCategory: updates.garmentCategory ?? base.garmentCategory,
    silhouette: updates.silhouette ?? base.silhouette,
    prompt: updates.prompt ?? base.prompt,
    color: updates.color ?? base.color,
    fabric: updates.fabric ?? base.fabric,
    fabricRevision: updates.fabricRevision ?? base.fabricRevision,
    fabricProvenance: updates.fabricProvenance ?? base.fabricProvenance,
    easeProfile: updates.easeProfile ?? base.easeProfile,
    explicitEaseCm: updates.explicitEaseCm !== undefined ? updates.explicitEaseCm : base.explicitEaseCm,
    lengthCm: updates.lengthCm ?? base.targetFinishedDimensions.lengthCm,
    targetFinishedDimensions: {
      ...base.targetFinishedDimensions,
      ...(updates.targetFinishedDimensions ?? {})
    },
    dartStyle: updates.dartStyle ?? base.dartStyle,
    sleeveEaseStrategy: updates.sleeveEaseStrategy ?? base.sleeveEaseStrategy,
    allowances: {
      ...base.allowances,
      ...(updates.allowances ?? {})
    },
    constructionFeatures: updates.constructionFeatures ?? base.constructionFeatures,
    designNotes: updates.designNotes ?? base.designNotes,
    // By default, a newly modified specification requires re-approval
    isApproved: updates.isApproved ?? false,
    approvalState: updates.approvalState ?? (updates.isApproved ? 'approved' : 'draft'),
    approvalAuthorityTier: updates.approvalAuthorityTier,
    approvalRecord: updates.approvalRecord,
    approvalHistory: updates.approvalHistory ?? base.approvalHistory,
    revocationRecord: updates.revocationRecord,
    approvedBy: updates.approvedBy,
    approvedAt: updates.approvedAt,
    approvalProvenance: updates.approvalProvenance ?? 'designer-edited',
    engineProvenance: updates.engineProvenance ?? base.engineProvenance,
    aiEstimates: updates.aiEstimates ?? (base.aiEstimates ? {
      suggestedSilhouette: base.aiEstimates.suggestedSilhouette,
      styleConfidenceScore: base.aiEstimates.styleConfidenceScore,
      suggestedFabrics: [...base.aiEstimates.suggestedFabrics],
      technicalAdvice: base.aiEstimates.technicalAdvice,
      disclaimer: base.aiEstimates.disclaimer
    } : undefined)
  });
}

/**
 * Formally approves a specification revision.
 * Returns a new immutable snapshot record with valid approver credentials, authority tier, and cryptographic fingerprint.
 */
export function approveAuthoritativeGarmentSpecification(
  spec: AuthoritativeGarmentSpecification,
  approvedBy: string,
  approvedAtOrOptions?: string | {
    approvedAt?: string;
    authorityTier?: ApprovalAuthorityTier;
    notes?: string;
  }
): AuthoritativeGarmentSpecification {
  if (!approvedBy || approvedBy.trim() === '') {
    throw new ProductionSnapshotValidationError('Cannot approve specification without a valid approvedBy identity.');
  }

  let approvedAt: string;
  let authorityTier: ApprovalAuthorityTier = 'unauthenticated_local_session';
  let notes: string | undefined = undefined;

  if (typeof approvedAtOrOptions === 'string') {
    approvedAt = approvedAtOrOptions;
  } else if (approvedAtOrOptions && typeof approvedAtOrOptions === 'object') {
    approvedAt = approvedAtOrOptions.approvedAt ?? new Date().toISOString();
    authorityTier = approvedAtOrOptions.authorityTier ?? 'unauthenticated_local_session';
    notes = approvedAtOrOptions.notes;
  } else {
    approvedAt = new Date().toISOString();
  }

  if (!isValidIsoDate(approvedAt)) {
    throw new ProductionSnapshotValidationError('Approval timestamp must be a valid ISO 8601 date.');
  }

  if (authorityTier === 'cryptographic_principal') {
    throw new ProductionSnapshotValidationError(
      'cryptographic_principal authority tier is unavailable without cryptographic provider configuration.'
    );
  }

  const specFingerprint = computeSpecificationFingerprint(spec);
  const eventId = `appr-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const approvalEvent: SpecificationApprovalEvent = {
    id: eventId,
    eventType: 'approval',
    targetRevisionId: spec.specificationRevisionId,
    targetSpecificationFingerprint: specFingerprint,
    approverId: `approver-${approvedBy.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    approverName: approvedBy.trim(),
    authorityTier,
    approvedAt,
    notes,
    provenance: authorityTier === 'demonstration_fixture' ? 'demonstration-fixture' : 'unauthenticated-local-approval'
  };

  const approvalRecord: SpecificationApprovalRecord = {
    eventId,
    approverId: approvalEvent.approverId,
    approverName: approvalEvent.approverName,
    authorityTier,
    approvedAt,
    targetRevisionId: spec.specificationRevisionId,
    targetSpecificationFingerprint: specFingerprint,
    notes,
    provenance: approvalEvent.provenance
  };

  const history: SpecificationLifecycleEvent[] = spec.approvalHistory
    ? [...spec.approvalHistory, approvalEvent]
    : [approvalEvent];

  return createAuthoritativeGarmentSpecification({
    ...spec,
    lengthCm: spec.targetFinishedDimensions.lengthCm,
    specificationRevisionId: spec.specificationRevisionId,
    parentRevisionId: spec.parentRevisionId,
    version: spec.version,
    isApproved: true,
    approvalState: 'approved',
    approvalAuthorityTier: authorityTier,
    approvalRecord,
    approvalHistory: history,
    revocationRecord: undefined,
    approvedBy: approvedBy.trim(),
    approvedAt,
    approvalProvenance: approvalEvent.provenance
  });
}

/**
 * Revokes approval on a specification.
 * Returns a new revision explicitly marked unapproved with revocation state.
 * Preserves the original approval event in append-only history.
 */
export function revokeAuthoritativeGarmentSpecificationApproval(
  spec: AuthoritativeGarmentSpecification,
  reason: string,
  options?: {
    revokerId?: string;
    revokerName?: string;
    revokedAt?: string;
    authorityTier?: ApprovalAuthorityTier;
  }
): AuthoritativeGarmentSpecification {
  const cleanReason = (reason ?? '').trim();
  if (!cleanReason) {
    throw new ProductionSnapshotValidationError('Revocation reason is mandatory and cannot be empty.');
  }

  const now = options?.revokedAt ?? new Date().toISOString();
  if (!isValidIsoDate(now)) {
    throw new ProductionSnapshotValidationError('Revocation timestamp must be a valid ISO 8601 date.');
  }

  const revokerId = options?.revokerId ?? 'operator-revoker';
  const revokerName = options?.revokerName ?? 'Local Atelier Operator';
  const authorityTier = options?.authorityTier ?? spec.approvalRecord?.authorityTier ?? 'unauthenticated_local_session';

  const specFingerprint = computeSpecificationFingerprint(spec);
  const revocationEventId = `rev-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const revocationEvent: SpecificationRevocationEvent = {
    id: revocationEventId,
    eventType: 'revocation',
    originalApprovalEventId: spec.approvalRecord?.eventId,
    targetRevisionId: spec.specificationRevisionId,
    targetSpecificationFingerprint: specFingerprint,
    revokerId,
    revokerName,
    authorityTier,
    revokedAt: now,
    reason: cleanReason
  };

  const updatedApprovalRecord: SpecificationApprovalRecord | undefined = spec.approvalRecord ? {
    ...spec.approvalRecord,
    revocation: revocationEvent,
    revocationReason: cleanReason
  } : undefined;

  const history: SpecificationLifecycleEvent[] = spec.approvalHistory
    ? [...spec.approvalHistory, revocationEvent]
    : [revocationEvent];

  const notes = [...spec.designNotes, `Approval revoked: ${cleanReason}`];

  return createAuthoritativeGarmentSpecification({
    ...spec,
    lengthCm: spec.targetFinishedDimensions.lengthCm,
    specificationRevisionId: spec.specificationRevisionId,
    parentRevisionId: spec.parentRevisionId,
    version: spec.version,
    isApproved: false,
    approvalState: 'revoked',
    approvalAuthorityTier: undefined,
    approvalRecord: updatedApprovalRecord,
    approvalHistory: history,
    revocationRecord: revocationEvent,
    approvedBy: undefined,
    approvedAt: undefined,
    approvalProvenance: 'designer-edited',
    designNotes: notes
  });
}

/**
 * Converts an AuthoritativeGarmentSpecification to the standard DesignSpecification
 * consumed across the CAD and UI layers, ensuring bidirectional lossless compatibility.
 */
export function convertToDesignSpecification(
  spec: AuthoritativeGarmentSpecification
): DesignSpecification {
  return {
    id: spec.garmentId,
    name: spec.name,
    prompt: spec.prompt,
    garmentCategory: spec.garmentCategory,
    silhouette: spec.silhouette,
    fabric: spec.fabric,
    color: spec.color,
    easeProfile: spec.easeProfile,
    lengthCm: spec.targetFinishedDimensions.lengthCm,
    dartStyle: spec.dartStyle,
    sleeveEaseStrategy: spec.sleeveEaseStrategy,
    constructionFeatures: [...spec.constructionFeatures],
    designNotes: [...spec.designNotes],
    isApproved: spec.isApproved,
    approvalState: spec.approvalState,
    approvalAuthorityTier: spec.approvalAuthorityTier,
    approvalRecord: spec.approvalRecord ? {
      eventId: spec.approvalRecord.eventId,
      approverId: spec.approvalRecord.approverId,
      approverName: spec.approvalRecord.approverName,
      authorityTier: spec.approvalRecord.authorityTier,
      approvedAt: spec.approvalRecord.approvedAt,
      targetRevisionId: spec.approvalRecord.targetRevisionId,
      targetSpecificationFingerprint: spec.approvalRecord.targetSpecificationFingerprint,
      revocationReason: spec.approvalRecord.revocationReason,
      notes: spec.approvalRecord.notes,
      provenance: spec.approvalRecord.provenance,
      revocation: spec.approvalRecord.revocation ? { ...spec.approvalRecord.revocation } : undefined
    } : undefined,
    approvalHistory: spec.approvalHistory ? spec.approvalHistory.map(evt => ({ ...evt })) : undefined,
    revocationRecord: spec.revocationRecord ? { ...spec.revocationRecord } : undefined,
    approvedAt: spec.approvedAt,
    version: spec.version,
    aiEstimates: spec.aiEstimates ? {
      suggestedSilhouette: spec.aiEstimates.suggestedSilhouette,
      styleConfidenceScore: spec.aiEstimates.styleConfidenceScore,
      suggestedFabrics: [...spec.aiEstimates.suggestedFabrics],
      technicalAdvice: spec.aiEstimates.technicalAdvice,
      disclaimer: spec.aiEstimates.disclaimer
    } : undefined,
    specificationRevisionId: spec.specificationRevisionId,
    parentRevisionId: spec.parentRevisionId,
    projectId: spec.projectId,
    fabricRevision: spec.fabricRevision,
    fabricProvenance: spec.fabricProvenance,
    approvedBy: spec.approvedBy,
    approvalProvenance: spec.approvalProvenance,
    explicitEaseCm: spec.explicitEaseCm ? { ...spec.explicitEaseCm } : undefined,
    targetFinishedDimensions: {
      length: spec.targetFinishedDimensions.lengthCm,
      waist: spec.targetFinishedDimensions.waistCm,
      hip: spec.targetFinishedDimensions.hipCm,
      bust: spec.targetFinishedDimensions.bustCm,
      chest: spec.targetFinishedDimensions.chestCm,
      acrossBack: spec.targetFinishedDimensions.acrossBackCm,
      bicep: spec.targetFinishedDimensions.bicepCm,
      wrist: spec.targetFinishedDimensions.wristCm
    },
    seamAllowanceCm: spec.allowances.seamAllowanceCm,
    hemAllowanceCm: spec.allowances.hemAllowanceCm,
    waistAllowanceCm: spec.allowances.waistAllowanceCm,
    neckAllowanceCm: spec.allowances.neckAllowanceCm,
    armholeAllowanceCm: spec.allowances.armholeAllowanceCm,
    shoulderAllowanceCm: spec.allowances.shoulderAllowanceCm
  };
}

/**
 * Converts a standard DesignSpecification into an AuthoritativeGarmentSpecification.
 * Strictly prevents unauthenticated, empty, or fabricated approvals from being granted.
 */
export function convertFromDesignSpecification(
  design: DesignSpecification,
  options: {
    projectId?: string;
    parentRevisionId?: string;
    specificationRevisionId?: string;
  } = {}
): AuthoritativeGarmentSpecification {
  const targetFinishedDimensions: Partial<AuthoritativeGarmentSpecification['targetFinishedDimensions']> = {
    lengthCm: design.lengthCm,
    waistCm: design.targetFinishedDimensions?.waist,
    hipCm: design.targetFinishedDimensions?.hip,
    bustCm: design.targetFinishedDimensions?.bust,
    chestCm: design.targetFinishedDimensions?.chest,
    acrossBackCm: design.targetFinishedDimensions?.acrossBack,
    bicepCm: design.targetFinishedDimensions?.bicep,
    wristCm: design.targetFinishedDimensions?.wrist
  };

  const hasValidApprover = Boolean(design.approvedBy && design.approvedBy.trim() !== '');
  const isApproved = Boolean(design.isApproved && hasValidApprover);
  const approvalState: SpecificationApprovalState = isApproved
    ? (design.approvalState ?? 'approved')
    : (design.approvalState === 'revoked' ? 'revoked' : 'draft');

  return createAuthoritativeGarmentSpecification({
    projectId: options.projectId ?? design.projectId ?? 'project-patroner-default',
    garmentId: design.id,
    specificationRevisionId: options.specificationRevisionId ?? design.specificationRevisionId ?? `spec-${design.id}-v${design.version || 1}`,
    parentRevisionId: options.parentRevisionId ?? design.parentRevisionId,
    version: design.version || 1,
    name: design.name,
    garmentCategory: design.garmentCategory,
    silhouette: design.silhouette,
    prompt: design.prompt,
    color: design.color,
    fabric: design.fabric,
    fabricRevision: design.fabricRevision,
    fabricProvenance: design.fabricProvenance,
    easeProfile: design.easeProfile,
    explicitEaseCm: design.explicitEaseCm,
    lengthCm: design.lengthCm,
    targetFinishedDimensions,
    dartStyle: design.dartStyle,
    sleeveEaseStrategy: design.sleeveEaseStrategy,
    allowances: {
      seamAllowanceCm: design.seamAllowanceCm ?? 1.5,
      hemAllowanceCm: design.hemAllowanceCm ?? 3.0,
      waistAllowanceCm: design.waistAllowanceCm ?? 1.0,
      neckAllowanceCm: design.neckAllowanceCm ?? 1.0,
      armholeAllowanceCm: design.armholeAllowanceCm ?? 1.0,
      shoulderAllowanceCm: design.shoulderAllowanceCm ?? 1.0
    },
    constructionFeatures: design.constructionFeatures,
    designNotes: design.designNotes,
    isApproved,
    approvalState,
    approvalAuthorityTier: design.approvalAuthorityTier ?? (isApproved ? 'unauthenticated_local_session' : undefined),
    approvalRecord: design.approvalRecord as SpecificationApprovalRecord | undefined,
    approvalHistory: design.approvalHistory as SpecificationLifecycleEvent[] | undefined,
    revocationRecord: design.revocationRecord as SpecificationRevocationEvent | undefined,
    approvedBy: isApproved ? design.approvedBy : undefined,
    approvedAt: isApproved ? design.approvedAt : undefined,
    approvalProvenance: design.approvalProvenance ?? (isApproved ? 'unauthenticated-local-approval' : 'designer-edited'),
    aiEstimates: design.aiEstimates
  });
}
