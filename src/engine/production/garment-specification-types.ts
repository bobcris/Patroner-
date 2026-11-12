/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner Authoritative Garment Specification & Trust Types (Milestone 04.6.2.3.4)
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
 */
export type ParameterValueProvenance =
  | 'missing'
  | 'explicit-null'
  | 'explicit-value'
  | 'explicit-user'
  | 'preset-default'
  | 'approved-project-default'
  | 'system-derived'
  | 'ai-proposed'
  | 'user-measured'
  | 'user-approved';

export type SpecificationParameterProvenance = ParameterValueProvenance;

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
 * Allowed asymmetric signature algorithms in the controlled PKI / key registry.
 * Shared-secret and symmetric MAC algorithms are strictly prohibited.
 */
export type AsymmetricSignatureAlgorithm = 'Ed25519';

/**
 * Trust status of a registered public key in the controlled key registry or JWKS.
 */
export type KeyTrustStatus =
  | 'trusted'
  | 'untrusted'
  | 'revoked'
  | 'expired'
  | 'controlled_local_public_key'
  | 'trusted_local_Configured_key'
  | 'enterprise_pki_verified'
  | 'unregistered_key'
  | 'revoked_key'
  | 'expired_key';

export type PublicKeyTrustStatus = KeyTrustStatus;

/**
 * Controlled public-key registration entry (PUBLIC KEY MATERIAL ONLY, `FINDING-08`, `FINDING-10`).
 * Private key material is strictly prohibited in verifier key registrations.
 */
export interface ControlledPublicKeyRegistration {
  readonly keyId: string;
  readonly publicKeyHex: string;
  readonly publicKeyBase64Url?: string;
  readonly publicKeyFingerprint?: string;
  readonly algorithm?: AsymmetricSignatureAlgorithm | string;
  readonly principalId?: string;
  readonly ownerPrincipal?: string;
  readonly issuer?: string;
  readonly providerId?: string;
  readonly tenantId?: string;
  readonly organizationScope?: string;
  readonly activatedAt?: string; // ISO 8601
  readonly expiresAt?: string;   // ISO 8601
  readonly revoked?: boolean;
  readonly compromised?: boolean;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
  readonly revocationReasonCode?: 'compromise' | 'rotation' | 'retirement' | 'unspecified';
  readonly trustStatus?: KeyTrustStatus;
  readonly registrationProvenance?: string;
  readonly allowedPrincipals?: readonly string[];
  readonly allowedScopes?: readonly string[];
}

export interface ControlledPublicKeyRegistry {
  readonly schemaVersion: string;
  readonly entries: Readonly<Record<string, ControlledPublicKeyRegistration>>;
}

/**
 * Trusted OIDC / JWKS public key entry for asymmetric JWT signature verification (`FINDING-08`, `FINDING-10`).
 */
export interface OidcJwkPublicKey {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  readonly kid: string;
  readonly alg: 'EdDSA' | string;
  readonly use?: 'sig' | string;
  readonly x?: string;            // Base64URL-encoded 32-byte Ed25519 public key
  readonly publicKeyHex?: string; // 64-char hex Ed25519 public key
  readonly issuer?: string;
  readonly tenantId?: string;
  readonly activatedAt?: string;  // ISO 8601
  readonly expiresAt?: string;    // ISO 8601
  readonly revoked?: boolean;
  readonly compromised?: boolean;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
  readonly trustStatus?: KeyTrustStatus;
}

export interface OidcJwtHeader {
  readonly alg: 'EdDSA';
  readonly typ: 'JWT' | 'at+jwt' | string;
  readonly kid: string;
  readonly crit?: readonly string[];
}

export interface OidcJwtPayload {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string | readonly string[];
  readonly iat: number;
  readonly nbf?: number;
  readonly exp: number;
  readonly jti: string;
  readonly name?: string;
  readonly tid?: string;
  readonly use?: string;
  readonly scope?: string;
  readonly roles?: readonly string[];
  readonly spec_id?: string;
  readonly target_revision_id?: string;
  readonly target_specification_fingerprint?: string;
  readonly acr?: string;
  readonly amr?: readonly string[];
}

/**
 * Verifiable OIDC/JWT identity credential required for Tier 3 (authenticated_designer) approval (`FINDING-06`).
 */
export interface VerifiableIdentityCredential {
  readonly credentialToken: string; // Compact RFC 7515 / OIDC JWT (header.payload.signature) signed with asymmetric EdDSA
  readonly token?: string;          // Alias for credentialToken
  readonly credentialId?: string;
  readonly subjectId: string;
  readonly subject?: string;
  readonly expectedApprover?: string;
  readonly displayName: string;
  readonly issuer: string;
  readonly audience: string;
  readonly tenantId?: string;
  readonly keyId?: string;
  readonly jti?: string;
  readonly specificationId?: string;
  readonly targetSpecificationId?: string;
  readonly targetRevisionId?: string;
  readonly targetSpecificationFingerprint?: string;
  readonly acr?: string;
  readonly amr?: readonly string[];
  readonly algorithm?: string;
  readonly tokenType?: string;
  readonly intendedUse?: string;
  readonly notBefore?: string; // ISO 8601
  readonly issuedAt: string;   // ISO 8601
  readonly expiresAt: string;  // ISO 8601
  readonly claims: readonly string[];
  readonly authorizationClaims?: readonly string[];
  readonly providerId?: string;
}

/**
 * Verified identity provenance retained on the immutable approval event and record.
 */
export interface VerifiedIdentityProvenance {
  readonly subject: string;
  readonly subjectId: string;
  readonly displayName?: string;
  readonly expectedApprover: string;
  readonly issuer: string;
  readonly audience: string;
  readonly tenantId?: string;
  readonly keyId?: string;
  readonly tokenId?: string;
  readonly jti?: string;
  readonly credentialId: string;
  readonly notBefore?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly verifiedAt: string;
  readonly claims: readonly string[];
  readonly authorizationClaims: readonly string[];
  readonly providerId: string;
  readonly verificationMethod: 'OIDC-JWT-EdDSA';
  readonly tokenDigest: string;
  readonly targetSpecificationId?: string;
  readonly targetRevisionId?: string;
  readonly targetSpecificationFingerprint?: string;
  readonly acr?: string;
  readonly amr?: readonly string[];
}

/**
 * Atomic JTI Replay Store record & interface (`FINDING-06`).
 */
export interface JtiReplayRecord {
  readonly jti: string;
  readonly issuer: string;
  readonly subjectId: string;
  readonly consumedAtIso: string;
  readonly expiresAtEpochSeconds: number;
  readonly specificationId?: string;
  readonly targetRevisionId?: string;
  readonly targetSpecificationFingerprint?: string;
  readonly tokenDigest: string;
}

export interface JtiReplayStore {
  /**
   * Honest disclosure (`FINDING-06`):
   * `false` for in-memory single-process stores; `true` only for external durable distributed stores.
   */
  readonly isDurableDistributedStore: boolean;
  readonly storeType: 'in-memory-local-process' | 'external-durable' | string;
  consumeJti(
    record: JtiReplayRecord,
    nowEpochSeconds: number
  ): {
    readonly consumed: boolean;
    readonly reason?: string;
    readonly existingRecord?: JtiReplayRecord;
  };
  getConsumedRecord(jti: string, issuer?: string): JtiReplayRecord | undefined;
  purgeExpired(nowEpochSeconds: number): number;
}

export interface IdentityCredentialVerificationOptions {
  readonly expectedSpecificationId?: string;
  readonly expectedRevisionId?: string;
  readonly expectedSpecificationFingerprint?: string;
  readonly expectedApprover?: string;
  readonly approvalTimestamp?: string;
  readonly expectedTenantId?: string;
  readonly requireTargetBinding?: boolean;
  readonly reverifyRecordedApproval?: {
    readonly recordedTokenDigest: string;
    readonly recordedJti?: string;
    readonly recordedSpecificationId: string;
    readonly recordedRevisionId: string;
    readonly recordedSpecificationFingerprint: string;
  };
}

/**
 * Result of a real OIDC/JWT identity-provider verification operation.
 */
export interface TrustedIdentityVerificationResult {
  readonly verified: boolean;
  readonly isValid: boolean;
  readonly reason?: string;
  readonly provenance?: VerifiedIdentityProvenance;
  readonly verifiedSubjectId?: string;
  readonly verifiedDisplayName?: string;
  readonly verifiedIssuer?: string;
  readonly verifiedAudience?: string;
  readonly verifiedKeyId?: string;
  readonly verifiedTenantId?: string;
  readonly verifiedClaims?: readonly string[];
  readonly verifiedJti?: string;
  readonly verifiedSpecificationId?: string;
  readonly verifiedTargetRevisionId?: string;
  readonly verifiedTargetSpecificationFingerprint?: string;
  readonly verifiedAcr?: string;
  readonly verifiedAmr?: readonly string[];
  readonly verifiedAt?: string;
}

export type IdentityVerificationResult = TrustedIdentityVerificationResult;

/**
 * Trusted OIDC/JWT identity verifier interface injected into approval and verification operations.
 */
export interface TrustedIdentityVerifier {
  readonly verifierId?: string;
  readonly trustedIssuers?: readonly string[];
  readonly expectedAudience?: string;
  readonly expectedTenantId?: string;
  readonly publicJwks?: readonly OidcJwkPublicKey[];
  readonly replayStore?: JtiReplayStore;
  verifyIdentityCredential?(
    credential: VerifiableIdentityCredential,
    context: {
      readonly targetRevisionId: string;
      readonly expectedRevisionId?: string;
      readonly targetSpecificationFingerprint: string;
      readonly expectedSpecificationFingerprint?: string;
      readonly expectedApprover: string;
      readonly approvalTimestamp: string;
      readonly expectedTenantId?: string;
      readonly expectedSpecificationId?: string;
      readonly requireTargetBinding?: boolean;
      readonly reverifyRecordedApproval?: IdentityCredentialVerificationOptions['reverifyRecordedApproval'];
    }
  ): TrustedIdentityVerificationResult;
  verifyCredential(
    credential: VerifiableIdentityCredential,
    context?: IdentityCredentialVerificationOptions
  ): TrustedIdentityVerificationResult;
}

/**
 * Complete canonical payload bound by a Tier 4 (cryptographic_principal) asymmetric signature.
 */
export interface CryptographicApprovalBindingPayload {
  readonly schemaVersion: string;
  readonly projectId: string;
  readonly tenantId?: string;
  readonly garmentId: string;
  readonly specificationRevisionId: string;
  readonly specificationVersion: number;
  readonly canonicalSpecificationFingerprint: string;
  readonly approvalEventId: string;
  readonly approverPrincipal: string;
  readonly authorityTier: 'cryptographic_principal';
  readonly approvalScope?: string;
  readonly approvalTimestamp: string;
  readonly keyId?: string;
  readonly algorithm?: string;
}

export type CanonicalApprovalSigningPayload = CryptographicApprovalBindingPayload;

/**
 * Verifiable asymmetric cryptographic signature binding all mandatory specification approval parameters.
 */
export interface VerifiableCryptographicSignature {
  readonly keyId: string;
  readonly publicKeyHex?: string;
  readonly publicKeyFingerprint: string;
  readonly algorithm: string;
  readonly signatureHex: string;
  readonly signatureDigest?: string;
  readonly signerPrincipal?: string;
  readonly signedPayload: CryptographicApprovalBindingPayload;
  readonly signedPayloadCanonicalJson?: string;
  readonly signedPayloadFingerprint?: string;
  readonly signedAt?: string;
}

/**
 * Result of a real asymmetric cryptographic signature verification operation.
 */
export interface TrustedCryptographicVerificationResult {
  readonly verified: boolean;
  readonly isValid: boolean;
  readonly reason?: string;
  readonly keyId?: string;
  readonly verifiedKeyId?: string;
  readonly verifiedPublicKeyHex?: string;
  readonly verifiedPrincipal?: string;
  readonly verifiedTenantId?: string;
  readonly algorithm?: string;
  readonly verifiedAlgorithm?: string;
  readonly publicKeyFingerprint?: string;
  readonly verifiedPayloadDigest?: string;
  readonly trustStatus?: KeyTrustStatus;
  readonly verifiedAt?: string;
}

export type CryptographicVerificationResult = TrustedCryptographicVerificationResult;

/**
 * Trusted asymmetric cryptographic verifier interface injected into approval and verification operations.
 * Holds ONLY public key registrations; private keys are never accessible to the verifier.
 */
export interface TrustedCryptographicVerifier {
  readonly verifierId: string;
  readonly trustedPublicKeyFingerprints: readonly string[];
  readonly publicKeyRegistry?: readonly ControlledPublicKeyRegistration[];
  verifyApprovalSignature(
    signature: VerifiableCryptographicSignature,
    expectedPayload: CryptographicApprovalBindingPayload
  ): TrustedCryptographicVerificationResult;
  verifySignature(
    firstArg: CryptographicApprovalBindingPayload | VerifiableCryptographicSignature,
    secondArg: VerifiableCryptographicSignature | CryptographicApprovalBindingPayload
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

export type SpecificationApprovalVerificationContext = ApprovalVerificationContext;

export interface SpecificationApprovalVerificationResult {
  readonly isValid: boolean;
  readonly state: SpecificationApprovalState;
  readonly authorityTier?: ApprovalAuthorityTier;
  readonly authorityClassification?: ApprovalAuthorityTier;
  readonly isApprovalAuthenticated?: boolean;
  readonly isApprovalCryptographicallySigned?: boolean;
  readonly canonicalFingerprint: string;
  readonly recordedFingerprint?: string;
  readonly approverName?: string;
  readonly approvedAt?: string;
  readonly reason?: string;
  readonly verifiedIdentity?: VerifiedIdentityProvenance;
  readonly cryptographicSignature?: VerifiableCryptographicSignature;
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
  readonly eventId?: string;
  readonly eventType: 'approval';
  readonly targetRevisionId: string;
  readonly specificationRevisionId?: string;
  readonly specificationVersion?: number;
  readonly targetSpecificationFingerprint: string;
  readonly canonicalContentFingerprint?: string;
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
  readonly eventId?: string;
  readonly eventType: 'revocation';
  readonly originalApprovalEventId?: string;
  readonly revokedApprovalEventId?: string;
  readonly targetRevisionId: string;
  readonly specificationRevisionId?: string;
  readonly specificationVersion?: number;
  readonly targetSpecificationFingerprint: string;
  readonly revokerId: string;
  readonly revokerName: string;
  readonly authorityTier: ApprovalAuthorityTier;
  readonly revokedAt: string; // ISO 8601
  readonly reason: string;
  readonly notes?: string;
}

export type SpecificationRevocationRecord = SpecificationRevocationEvent;

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
  readonly eventType?: 'approval';
  readonly approverId: string;
  readonly approverName: string;
  readonly authorityTier: ApprovalAuthorityTier;
  readonly approvedAt: string; // ISO 8601
  readonly targetRevisionId: string;
  readonly specificationRevisionId?: string;
  readonly specificationVersion?: number;
  readonly targetSpecificationFingerprint: string;
  readonly canonicalContentFingerprint?: string;
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
  readonly bicepsCm?: number;
  readonly wristCm?: number;
  readonly hemSweepCm?: number;
  readonly sleeveLengthCm?: number;
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
  readonly armholeDepth?: number;
  readonly capEase?: number;
}

export type ExplicitGarmentEaseAllowances = ExplicitGarmentEaseCm;

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

export type ManufacturingSeamAllowances = GarmentAllowancesSnapshot;

/**
 * Authoritative, versioned garment specification record.
 * Connects Fashion Design Studio creative intent with deterministic pattern drafting.
 */
export interface AuthoritativeGarmentSpecification {
  readonly schemaVersion?: string;
  readonly projectId: string;
  readonly garmentId: string;
  readonly specificationRevisionId: string;
  readonly parentRevisionId?: string;
  readonly previousRevisionId?: string;
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
  readonly lengthCm: number;
  readonly targetFinishedDimensions: TargetFinishedGarmentDimensions;
  readonly dartStyle?: BodiceDartStyle | 'single' | 'princess' | 'none';
  readonly waistband?: string;
  readonly sleeveEaseStrategy?: SleeveEaseStrategy;
  readonly allowances: GarmentAllowancesSnapshot;
  readonly constructionFeatures: readonly GarmentConstructionFeature[];
  readonly designNotes: readonly string[];
  readonly fieldProvenance?: Readonly<Record<string, ParameterValueProvenance>>;
  readonly isApproved: boolean;
  readonly approvalState: SpecificationApprovalState;
  readonly approvalAuthorityTier?: ApprovalAuthorityTier;
  readonly approvedContentFingerprint?: string;
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
  readonly isProductionReady?: false;
}

/**
 * Input for creating or revising an authoritative specification.
 */
export interface CreateAuthoritativeSpecificationInput {
  readonly projectId?: string;
  readonly garmentId?: string;
  readonly specificationRevisionId?: string;
  readonly parentRevisionId?: string;
  readonly previousRevisionId?: string;
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
  readonly dartStyle?: BodiceDartStyle | 'single' | 'princess' | 'none';
  readonly waistband?: string;
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
  readonly createdAt?: string;
  readonly updatedAt?: string;
}
