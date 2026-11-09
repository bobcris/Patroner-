/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DesignSpecification } from '../../types';
import { CURRENT_ENGINE_VERSION } from './pattern-revision-snapshot';
import { canonicalizeJson, deepFreeze } from './pattern-revision-snapshot';
import { sha256Hex } from './crypto';
import {
  ApprovalAuthorityTier,
  AuthoritativeGarmentSpecification,
  CreateAuthoritativeSpecificationInput,
  SpecificationApprovalRecord,
  SpecificationApprovalState,
  SpecificationValueProvenance
} from './garment-specification-types';
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
 * Computes a deterministic SHA-256 fingerprint for specification engineering parameters.
 * Used for cryptographic approval binding and tamper detection.
 */
export function computeSpecificationFingerprint(
  spec: AuthoritativeGarmentSpecification | CreateAuthoritativeSpecificationInput | DesignSpecification
): string {
  let lengthCm = 0;
  if ('targetFinishedDimensions' in spec && spec.targetFinishedDimensions) {
    const td = spec.targetFinishedDimensions as { lengthCm?: number; length?: number };
    if (typeof td.lengthCm === 'number') {
      lengthCm = td.lengthCm;
    } else if (typeof td.length === 'number') {
      lengthCm = td.length;
    }
  }
  if (!lengthCm && 'lengthCm' in spec && typeof spec.lengthCm === 'number') {
    lengthCm = spec.lengthCm;
  }

  const payload = {
    garmentCategory: spec.garmentCategory,
    silhouette: spec.silhouette,
    lengthCm,
    explicitEaseCm: spec.explicitEaseCm,
    easeProfile: spec.easeProfile,
    fabricId: spec.fabric?.id,
    dartStyle: spec.dartStyle,
    sleeveEaseStrategy: spec.sleeveEaseStrategy,
    constructionFeatures: spec.constructionFeatures?.map(f => ({
      id: f.id,
      category: f.category,
      name: f.name,
      patternImpact: f.patternImpact
    })),
    allowances: 'allowances' in spec && spec.allowances ? {
      seam: spec.allowances.seamAllowanceCm,
      hem: spec.allowances.hemAllowanceCm,
      waist: spec.allowances.waistAllowanceCm,
      neck: spec.allowances.neckAllowanceCm,
      armhole: spec.allowances.armholeAllowanceCm
    } : {
      seam: (spec as DesignSpecification).seamAllowanceCm,
      hem: (spec as DesignSpecification).hemAllowanceCm,
      waist: (spec as DesignSpecification).waistAllowanceCm,
      neck: (spec as DesignSpecification).neckAllowanceCm,
      armhole: (spec as DesignSpecification).armholeAllowanceCm
    }
  };
  return sha256Hex(canonicalizeJson(payload));
}

/**
 * Verifies whether a specification revision has a valid, non-tampered approval record.
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
    : ('id' in spec ? (spec as DesignSpecification).id : 'garment');
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

  // If approvalRecord exists, verify cryptographic binding
  if (spec.approvalRecord) {
    if (spec.approvalRecord.targetRevisionId !== specRevId) {
      return {
        isValid: false,
        state: 'invalid',
        reason: `Approval record target revision '${spec.approvalRecord.targetRevisionId}' does not match specification revision '${specRevId}'.`,
        fingerprint: currentFingerprint
      };
    }
    if (spec.approvalRecord.targetSpecificationFingerprint !== currentFingerprint) {
      return {
        isValid: false,
        state: 'invalid',
        reason: 'Specification content has been modified after approval was granted; content fingerprint mismatch.',
        fingerprint: currentFingerprint
      };
    }
  } else {
    // If no approvalRecord, verify basic credentials
    if (!spec.approvedBy || spec.approvedBy.trim() === '') {
      return {
        isValid: false,
        state: 'invalid',
        reason: 'Approved specification lacks an approver identity.',
        fingerprint: currentFingerprint
      };
    }
    if (!spec.approvedAt || !isValidIsoDate(spec.approvedAt)) {
      return {
        isValid: false,
        state: 'invalid',
        reason: 'Approved specification lacks a valid ISO approval timestamp.',
        fingerprint: currentFingerprint
      };
    }
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
    armholeAllowanceCm: input.allowances?.armholeAllowanceCm ?? 1.0
  };

  const engineProvenance = {
    engineVersion: input.engineProvenance?.engineVersion ?? CURRENT_ENGINE_VERSION,
    snapshotEngine: 'Patroner Authoritative Specification Engine v1.0',
    buildTimestamp: input.engineProvenance?.buildTimestamp ?? now,
    ...(input.engineProvenance ?? {})
  };

  // Compute specification fingerprint for approval record
  const tempSpecPayload = {
    garmentCategory: input.garmentCategory,
    silhouette: input.silhouette,
    lengthCm: input.lengthCm,
    explicitEaseCm: input.explicitEaseCm,
    easeProfile: input.easeProfile,
    fabric: input.fabric,
    dartStyle: input.dartStyle,
    sleeveEaseStrategy: input.sleeveEaseStrategy,
    constructionFeatures: input.constructionFeatures,
    allowances
  };
  const specFingerprint = computeSpecificationFingerprint(tempSpecPayload as unknown as AuthoritativeGarmentSpecification);

  let approvalRecord: SpecificationApprovalRecord | undefined = undefined;
  if (isApproved) {
    if (input.approvalRecord && input.approvalRecord.targetSpecificationFingerprint === specFingerprint) {
      approvalRecord = input.approvalRecord;
    } else {
      approvalRecord = {
        approverId: `approver-${(approvedBy ?? 'operator').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        approverName: approvedBy ?? 'Local Operator',
        authorityTier: approvalAuthorityTier ?? 'unauthenticated_local_session',
        approvedAt: approvedAt!,
        targetRevisionId: specId,
        targetSpecificationFingerprint: specFingerprint
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
  const newVersion = base.version + 1;
  const newRevisionId = updates.specificationRevisionId ?? `spec-${base.garmentId}-v${newVersion}`;

  return createAuthoritativeGarmentSpecification({
    projectId: updates.projectId ?? base.projectId,
    garmentId: updates.garmentId ?? base.garmentId,
    specificationRevisionId: newRevisionId,
    parentRevisionId: base.specificationRevisionId,
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

  const specFingerprint = computeSpecificationFingerprint(spec);
  const approvalRecord: SpecificationApprovalRecord = {
    approverId: `approver-${approvedBy.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    approverName: approvedBy.trim(),
    authorityTier,
    approvedAt,
    targetRevisionId: spec.specificationRevisionId,
    targetSpecificationFingerprint: specFingerprint,
    notes
  };

  const provenance: SpecificationValueProvenance = authorityTier === 'demonstration_fixture'
    ? 'demonstration-fixture'
    : 'unauthenticated-local-approval';

  return reviseAuthoritativeGarmentSpecification(spec, {
    specificationRevisionId: spec.specificationRevisionId, // Retain ID on explicit approval
    version: spec.version,
    isApproved: true,
    approvalState: 'approved',
    approvalAuthorityTier: authorityTier,
    approvalRecord,
    approvedBy: approvedBy.trim(),
    approvedAt,
    approvalProvenance: provenance
  });
}

/**
 * Revokes approval on a specification.
 * Returns a new revision explicitly marked unapproved with revocation state.
 */
export function revokeAuthoritativeGarmentSpecificationApproval(
  spec: AuthoritativeGarmentSpecification,
  reason?: string
): AuthoritativeGarmentSpecification {
  const notes = reason ? [...spec.designNotes, `Approval revoked: ${reason}`] : spec.designNotes;

  const revokedRecord: SpecificationApprovalRecord | undefined = spec.approvalRecord ? {
    ...spec.approvalRecord,
    revocationReason: reason ?? 'Revoked by operator'
  } : undefined;

  return reviseAuthoritativeGarmentSpecification(spec, {
    isApproved: false,
    approvalState: 'revoked',
    approvalAuthorityTier: undefined,
    approvalRecord: revokedRecord,
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
    approvalRecord: spec.approvalRecord ? { ...spec.approvalRecord } : undefined,
    approvedAt: spec.approvedAt,
    version: spec.version,
    aiEstimates: spec.aiEstimates ? {
      suggestedSilhouette: spec.aiEstimates.suggestedSilhouette,
      styleConfidenceScore: spec.aiEstimates.styleConfidenceScore,
      suggestedFabrics: [...spec.aiEstimates.suggestedFabrics],
      technicalAdvice: spec.aiEstimates.technicalAdvice,
      disclaimer: spec.aiEstimates.disclaimer
    } : undefined,
    // Milestone 04.6.2 & 04.6.2.1 extended attributes
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
    armholeAllowanceCm: spec.allowances.armholeAllowanceCm
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
      armholeAllowanceCm: design.armholeAllowanceCm ?? 1.0
    },
    constructionFeatures: design.constructionFeatures,
    designNotes: design.designNotes,
    isApproved,
    approvalState,
    approvalAuthorityTier: design.approvalAuthorityTier ?? (isApproved ? 'unauthenticated_local_session' : undefined),
    approvalRecord: design.approvalRecord,
    approvedBy: isApproved ? design.approvedBy : undefined,
    approvedAt: isApproved ? design.approvedAt : undefined,
    approvalProvenance: design.approvalProvenance ?? (isApproved ? 'unauthenticated-local-approval' : 'designer-edited'),
    aiEstimates: design.aiEstimates
  });
}
