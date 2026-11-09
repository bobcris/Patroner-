/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodiceDartStyle,
  DesignSpecification,
  EaseProfile,
  FabricProperty,
  GarmentCategory,
  GarmentConstructionFeature,
  Silhouette,
  SleeveEaseStrategy
} from '../../types';
import { EngineProvenanceRecord } from './production-types';
import { FabricSnapshotProvenance } from './production-types';

/**
 * Origin and trust classification of a specification parameter or entire specification.
 */
export type SpecificationValueProvenance =
  | 'ai-proposed'
  | 'designer-edited'
  | 'designer-approved'
  | 'system-derived'
  | 'unknown';

/**
 * Explicit target finished garment dimensions specified by designer or system.
 */
export interface TargetFinishedGarmentDimensions {
  readonly lengthCm: number;
  readonly waistCm?: number;
  readonly hipCm?: number;
  readonly bustCm?: number;
  readonly chestCm?: number;
  readonly acrossBackCm?: number;
  readonly bicepCm?: number;
  readonly wristCm?: number;
}

/**
 * Explicit mechanical and wearing ease values assigned to circumferences.
 */
export interface ExplicitGarmentEaseCm {
  readonly waist?: number;
  readonly hip?: number;
  readonly bust?: number;
  readonly biceps?: number;
  readonly wrist?: number;
  readonly neck?: number;
}

/**
 * Standard manufacturing seam and edge allowances.
 */
export interface GarmentAllowancesSnapshot {
  readonly seamAllowanceCm: number;
  readonly hemAllowanceCm: number;
  readonly waistAllowanceCm?: number;
  readonly neckAllowanceCm?: number;
  readonly armholeAllowanceCm?: number;
}

/**
 * Authoritative, versioned garment specification record.
 * Connects Fashion Design Studio creative intent with deterministic pattern drafting.
 */
export interface AuthoritativeGarmentSpecification {
  readonly projectId: string;
  readonly garmentId: string;
  readonly specificationRevisionId: string;
  readonly parentRevisionId?: string;
  readonly version: number;
  readonly name: string;
  readonly garmentCategory: GarmentCategory;
  readonly silhouette: Silhouette;
  readonly prompt: string;
  readonly color: {
    readonly name: string;
    readonly hex: string;
  };
  readonly fabric: FabricProperty;
  readonly fabricRevision?: string;
  readonly fabricProvenance: FabricSnapshotProvenance;
  readonly easeProfile: EaseProfile;
  readonly explicitEaseCm?: ExplicitGarmentEaseCm;
  readonly targetFinishedDimensions: TargetFinishedGarmentDimensions;
  readonly dartStyle?: BodiceDartStyle;
  readonly sleeveEaseStrategy?: SleeveEaseStrategy;
  readonly allowances: GarmentAllowancesSnapshot;
  readonly constructionFeatures: readonly GarmentConstructionFeature[];
  readonly designNotes: readonly string[];
  readonly isApproved: boolean;
  readonly approvedBy?: string;
  readonly approvedAt?: string; // ISO 8601 date string
  readonly approvalProvenance: SpecificationValueProvenance;
  readonly engineProvenance: EngineProvenanceRecord;
  readonly aiEstimates?: {
    readonly suggestedSilhouette: string;
    readonly styleConfidenceScore: number;
    readonly suggestedFabrics: readonly string[];
    readonly technicalAdvice: string;
    readonly disclaimer: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Input for creating or revising an authoritative specification.
 */
export interface CreateAuthoritativeSpecificationInput {
  readonly projectId?: string;
  readonly garmentId?: string;
  readonly specificationRevisionId?: string;
  readonly parentRevisionId?: string;
  readonly version?: number;
  readonly name: string;
  readonly garmentCategory: GarmentCategory;
  readonly silhouette: Silhouette;
  readonly prompt?: string;
  readonly color?: {
    readonly name: string;
    readonly hex: string;
  };
  readonly fabric: FabricProperty;
  readonly fabricRevision?: string;
  readonly fabricProvenance?: FabricSnapshotProvenance;
  readonly easeProfile: EaseProfile;
  readonly explicitEaseCm?: ExplicitGarmentEaseCm;
  readonly lengthCm: number;
  readonly targetFinishedDimensions?: Partial<TargetFinishedGarmentDimensions>;
  readonly dartStyle?: BodiceDartStyle;
  readonly sleeveEaseStrategy?: SleeveEaseStrategy;
  readonly allowances?: Partial<GarmentAllowancesSnapshot>;
  readonly constructionFeatures?: readonly GarmentConstructionFeature[];
  readonly designNotes?: readonly string[];
  readonly isApproved?: boolean;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly approvalProvenance?: SpecificationValueProvenance;
  readonly engineProvenance?: Partial<EngineProvenanceRecord>;
  readonly aiEstimates?: DesignSpecification['aiEstimates'];
}
