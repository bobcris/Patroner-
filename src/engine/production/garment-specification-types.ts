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
import { EngineProvenanceRecord, FabricSnapshotProvenance } from './production-types';

/**
 * Origin and trust classification of a specification parameter or entire specification.
 */
export type SpecificationValueProvenance =
  | 'ai-proposed'
  | 'designer-edited'
  | 'designer-approved'
  | 'system-derived'
  | 'unauthenticated-local-approval'
  | 'demonstration-fixture'
  | 'unknown';

/**
 * Parameter-level value provenance classification for canonicalization and lineage auditing.
 * Distinguishes missing, explicit null, explicit value, project default, system derived, AI proposed,
 * user measured, and user approved values.
 */
export type ParameterValueProvenance =
  | 'missing'
  | 'explicit-null'
  | 'explicit-value'
  | 'approved-project-default'
  | 'system-derived'
  | 'ai-proposed'
  | 'user-measured'
  | 'user-approved';

/**
 * Formal approval lifecycle state of an engineering specification revision.
 */
export type SpecificationApprovalState =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'revoked'
  | 'superseded'
  | 'invalid';

export const SPECIFICATION_CANONICAL_SCHEMA_VERSION = '1.1.0';

/**
 * Authority classification for specification approval.
 * Prevents unauthenticated local or demo approval from masquerading as verified organizational sign-off.
 */
export type ApprovalAuthorityTier =
  | 'demonstration_fixture'
  | 'unauthenticated_local_session'
  | 'authenticated_designer'
  | 'cryptographic_principal';

/**
 * Verifiable identity credential required for Tier 3 (authenticated_designer) approval.
 */
export interface VerifiableIdentityCredential {
  readonly token: string;
  readonly credentialId: string;
  readonly subject: string;
  readonly subjectId?: string;
  readonly expectedApprover: string;
  readonly displayName?: string;
  readonly issuer: string;
  readonly audience: string;
  readonly issuedAt: string; // ISO 8601
  readonly expiresAt: string; // ISO 8601
  readonly authorizationClaims: readonly string[];
  readonly providerId: string;
}

/**
 * Verified identity provenance retained on the immutable approval event and record.
 */
export interface VerifiedIdentityProvenance {
  readonly subject: string;
  readonly subjectId: string;
  readonly expectedApprover: string;
  readonly issuer: string;
  readonly audience: string;
  readonly credentialId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly verifiedAt: string;
  readonly authorizationClaims: readonly string[];
  readonly providerId: string;
  readonly tokenDigest: string;
}

/**
 * Result of a real identity-provider verification operation.
 */
export interface TrustedIdentityVerificationResult {
  readonly verified: boolean;
  readonly reason?: string;
  readonly provenance?: VerifiedIdentityProvenance;
}

/**
 * Trusted identity verifier interface injected into approval and verification operations.
 * Cannot be satisfied by a boolean availability flag.
 */
export interface TrustedIdentityVerifier {
  readonly verifierId?: string;
  readonly trustedIssuers?: readonly string[];
  readonly expectedAudience?: string;
  verifyIdentityCredential?(
    credential: VerifiableIdentityCredential,
    context: {
      readonly targetRevisionId: string;
      readonly targetSpecificationFingerprint: string;
      readonly expectedApprover: string;
      readonly approvalTimestamp: string;
    }
  ): TrustedIdentityVerificationResult;
  verifyCredential?(
    credential: VerifiableIdentityCredential,
    context?: unknown
  ): TrustedIdentityVerificationResult;
}

/**
 * Mandatory 10-field canonical payload bound by a Tier 4 (cryptographic_principal) signature.
 */
export interface CryptographicApprovalBindingPayload {
  readonly schemaVersion: string;
  readonly projectId: string;
  readonly garmentId: string;
  readonly specificationRevisionId: string;
  readonly specificationVersion: number;
  readonly canonicalSpecificationFingerprint: string;
  readonly approvalEventId: string;
  readonly approverPrincipal: string;
  readonly authorityTier: 'cryptographic_principal';
  readonly approvalTimestamp: string;
}

/**
 * Verifiable cryptographic signature binding all 10 mandatory specification approval parameters.
 */
export interface VerifiableCryptographicSignature {
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
  readonly algorithm: string;
  readonly signatureHex: string;
  readonly signedPayload: CryptographicApprovalBindingPayload;
}

/**
 * Result of a real cryptographic signature verification operation.
 */
export interface TrustedCryptographicVerificationResult {
  readonly verified: boolean;
  readonly reason?: string;
  readonly keyId?: string;
  readonly publicKeyFingerprint?: string;
  readonly verifiedPayloadDigest?: string;
}

/**
 * Trusted cryptographic verifier interface injected into approval and verification operations.
 */
export interface TrustedCryptographicVerifier {
  readonly verifierId: string;
  readonly trustedPublicKeyFingerprints: readonly string[];
  verifyApprovalSignature(
    signature: VerifiableCryptographicSignature,
    expectedPayload: CryptographicApprovalBindingPayload
  ): TrustedCryptographicVerificationResult;
}

/**
 * Dependency-injected authorization verification context.
 * Replaces untrusted global boolean authority flags.
 */
export interface ApprovalVerificationContext {
  readonly identityVerifier?: TrustedIdentityVerifier;
  readonly identityCredential?: VerifiableIdentityCredential;
  readonly cryptographicVerifier?: TrustedCryptographicVerifier;
  readonly currentTimestamp?: string;
}

/**
 * Legacy provider interface retained for compatibility checks.
 * Boolean availability flags in this interface are never trusted as proof of authentication or signature.
 */
export interface AuthorityProviderContext {
  readonly identityProviderConfigured?: boolean;
  readonly cryptographicProviderConfigured?: boolean;
  readonly hasAuthenticatedIdentityProvider?: () => boolean;
  readonly hasCryptographicSigningProvider?: () => boolean;
  readonly verifyIdentityToken?: (token: string, expectedApprover: string) => boolean;
  readonly verifyCryptographicSignature?: (signature: string, payload: string) => boolean;
}

/**
 * Immutable approval event recording an authorization action.
 */
export interface SpecificationApprovalEvent {
  readonly id: string;
  readonly eventType: 'approval';
  readonly targetRevisionId: string;
  readonly targetSpecificationFingerprint: string;
  readonly approverId: string;
  readonly approverName: string;
  readonly authorityTier: ApprovalAuthorityTier;
  readonly approvedAt: string; // ISO 8601
  readonly notes?: string;
  readonly provenance: SpecificationValueProvenance;
  readonly verifiedIdentity?: VerifiedIdentityProvenance;
  readonly cryptographicSignature?: VerifiableCryptographicSignature;
}

/**
 * Immutable revocation event recording an explicit revocation action.
 */
export interface SpecificationRevocationEvent {
  readonly id: string;
  readonly eventType: 'revocation';
  readonly originalApprovalEventId?: string;
  readonly targetRevisionId: string;
  readonly targetSpecificationFingerprint: string;
  readonly revokerId: string;
  readonly revokerName: string;
  readonly authorityTier: ApprovalAuthorityTier;
  readonly revokedAt: string; // ISO 8601
  readonly reason: string;
  readonly notes?: string;
}

/**
 * Immutable supersession event recording that a revision was superseded by a newer revision.
 */
export interface SpecificationSupersessionEvent {
  readonly id: string;
  readonly eventType: 'supersession';
  readonly targetRevisionId: string;
  readonly targetSpecificationFingerprint: string;
  readonly supersededByRevisionId: string;
  readonly authorityTier: ApprovalAuthorityTier;
  readonly supersededAt: string; // ISO 8601
  readonly reason?: string;
}

export type SpecificationLifecycleEvent =
  | SpecificationApprovalEvent
  | SpecificationRevocationEvent
  | SpecificationSupersessionEvent;

/**
 * Immutable cryptographic approval record binding an approver to an exact specification fingerprint.
 */
export interface SpecificationApprovalRecord {
  readonly eventId?: string;
  readonly approverId: string;
  readonly approverName: string;
  readonly authorityTier: ApprovalAuthorityTier;
  readonly approvedAt: string; // ISO 8601
  readonly targetRevisionId: string;
  readonly targetSpecificationFingerprint: string;
  readonly revocationReason?: string;
  readonly notes?: string;
  readonly provenance?: SpecificationValueProvenance;
  readonly verifiedIdentity?: VerifiedIdentityProvenance;
  readonly cryptographicSignature?: VerifiableCryptographicSignature;
  readonly revocation?: SpecificationRevocationEvent;
}

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
  readonly shoulderAllowanceCm?: number;
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
  readonly supersededByRevisionId?: string;
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
  readonly fieldProvenance?: Readonly<Record<string, ParameterValueProvenance>>;
  readonly isApproved: boolean;
  readonly approvalState: SpecificationApprovalState;
  readonly approvalAuthorityTier?: ApprovalAuthorityTier;
  readonly approvalRecord?: SpecificationApprovalRecord;
  readonly verifiedIdentity?: VerifiedIdentityProvenance;
  readonly cryptographicSignature?: VerifiableCryptographicSignature;
  readonly approvalHistory?: readonly SpecificationLifecycleEvent[];
  readonly revocationRecord?: SpecificationRevocationEvent;
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
  readonly supersededByRevisionId?: string;
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
  readonly fieldProvenance?: Readonly<Record<string, ParameterValueProvenance>>;
  readonly isApproved?: boolean;
  readonly approvalState?: SpecificationApprovalState;
  readonly approvalAuthorityTier?: ApprovalAuthorityTier;
  readonly approvalRecord?: SpecificationApprovalRecord;
  readonly approvalHistory?: readonly SpecificationLifecycleEvent[];
  readonly revocationRecord?: SpecificationRevocationEvent;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly approvalProvenance?: SpecificationValueProvenance;
  readonly engineProvenance?: Partial<EngineProvenanceRecord>;
  readonly aiEstimates?:
    | DesignSpecification['aiEstimates']
    | {
        readonly suggestedSilhouette: string;
        readonly styleConfidenceScore: number;
        readonly suggestedFabrics: readonly string[];
        readonly technicalAdvice: string;
        readonly disclaimer: string;
      };
}
