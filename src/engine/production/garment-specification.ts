/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DesignSpecification } from '../../types';
import { CURRENT_ENGINE_VERSION } from './pattern-revision-snapshot';
import { deepFreeze } from './pattern-revision-snapshot';
import {
  AuthoritativeGarmentSpecification,
  CreateAuthoritativeSpecificationInput,
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

  const isApproved = Boolean(input.isApproved);
  let approvedBy = input.approvedBy;
  let approvedAt = input.approvedAt;
  let approvalProvenance: SpecificationValueProvenance = input.approvalProvenance ?? (isApproved ? 'designer-approved' : 'designer-edited');

  if (isApproved) {
    if (!approvedBy || approvedBy.trim() === '') {
      throw new ProductionSnapshotValidationError('Approved specification must include an approvedBy identity.');
    }
    if (!approvedAt || !isValidIsoDate(approvedAt)) {
      throw new ProductionSnapshotValidationError('Approved specification must include a valid ISO approvedAt timestamp.');
    }
  } else {
    approvedBy = undefined;
    approvedAt = undefined;
    if (approvalProvenance === 'designer-approved') {
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
 * The new revision increments the version, tracks parentRevisionId, and resets approval.
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
 * Returns a new immutable snapshot record with valid approver credentials and timestamp.
 */
export function approveAuthoritativeGarmentSpecification(
  spec: AuthoritativeGarmentSpecification,
  approvedBy: string,
  approvedAt?: string
): AuthoritativeGarmentSpecification {
  if (!approvedBy || approvedBy.trim() === '') {
    throw new ProductionSnapshotValidationError('Cannot approve specification without a valid approvedBy identity.');
  }
  const timestamp = approvedAt ?? new Date().toISOString();
  if (!isValidIsoDate(timestamp)) {
    throw new ProductionSnapshotValidationError('Approval timestamp must be a valid ISO 8601 date.');
  }

  return reviseAuthoritativeGarmentSpecification(spec, {
    specificationRevisionId: spec.specificationRevisionId, // Retain ID on explicit approval
    version: spec.version,
    isApproved: true,
    approvedBy: approvedBy.trim(),
    approvedAt: timestamp,
    approvalProvenance: 'designer-approved'
  });
}

/**
 * Revokes approval on a specification.
 * Returns a new revision explicitly marked unapproved.
 */
export function revokeAuthoritativeGarmentSpecificationApproval(
  spec: AuthoritativeGarmentSpecification,
  reason?: string
): AuthoritativeGarmentSpecification {
  const notes = reason ? [...spec.designNotes, `Approval revoked: ${reason}`] : spec.designNotes;

  return reviseAuthoritativeGarmentSpecification(spec, {
    isApproved: false,
    approvedBy: undefined,
    approvedAt: undefined,
    approvalProvenance: 'designer-edited',
    designNotes: notes
  });
}

/**
 * Converts an AuthoritativeGarmentSpecification to the standard DesignSpecification
 * consumed across the CAD and UI layers, ensuring bidirectional compatibility.
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
    approvedAt: spec.approvedAt,
    version: spec.version,
    aiEstimates: spec.aiEstimates ? {
      suggestedSilhouette: spec.aiEstimates.suggestedSilhouette,
      styleConfidenceScore: spec.aiEstimates.styleConfidenceScore,
      suggestedFabrics: [...spec.aiEstimates.suggestedFabrics],
      technicalAdvice: spec.aiEstimates.technicalAdvice,
      disclaimer: spec.aiEstimates.disclaimer
    } : undefined,
    // Milestone 04.6.2 extended attributes
    specificationRevisionId: spec.specificationRevisionId,
    parentRevisionId: spec.parentRevisionId,
    approvedBy: spec.approvedBy,
    approvalProvenance: spec.approvalProvenance,
    explicitEaseCm: spec.explicitEaseCm ? { ...spec.explicitEaseCm } : undefined,
    targetFinishedDimensions: {
      length: spec.targetFinishedDimensions.lengthCm,
      waist: spec.targetFinishedDimensions.waistCm,
      hip: spec.targetFinishedDimensions.hipCm,
      bust: spec.targetFinishedDimensions.bustCm
    },
    seamAllowanceCm: spec.allowances.seamAllowanceCm,
    hemAllowanceCm: spec.allowances.hemAllowanceCm,
    waistAllowanceCm: spec.allowances.waistAllowanceCm
  };
}

/**
 * Converts a standard DesignSpecification into an AuthoritativeGarmentSpecification.
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
    ...(design.targetFinishedDimensions ?? {})
  };

  return createAuthoritativeGarmentSpecification({
    projectId: options.projectId ?? 'project-patroner-default',
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
    easeProfile: design.easeProfile,
    explicitEaseCm: design.explicitEaseCm,
    lengthCm: design.lengthCm,
    targetFinishedDimensions,
    dartStyle: design.dartStyle,
    sleeveEaseStrategy: design.sleeveEaseStrategy,
    allowances: {
      seamAllowanceCm: design.seamAllowanceCm ?? 1.5,
      hemAllowanceCm: design.hemAllowanceCm ?? 3.0,
      waistAllowanceCm: design.waistAllowanceCm ?? 1.0
    },
    constructionFeatures: design.constructionFeatures,
    designNotes: design.designNotes,
    isApproved: design.isApproved,
    approvedBy: design.approvedBy ?? (design.isApproved ? 'Designer' : undefined),
    approvedAt: design.approvedAt ?? (design.isApproved ? new Date().toISOString() : undefined),
    approvalProvenance: design.approvalProvenance ?? (design.isApproved ? 'designer-approved' : 'designer-edited'),
    aiEstimates: design.aiEstimates
  });
}
