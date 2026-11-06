import { BodyMeasurements, EaseProfile, FabricProperty, Silhouette, SleeveEaseStrategy } from '../../types';
import { EASE_TABLE, SLEEVE_EASE_TABLE } from '../measurements/standards';
import {
  AvailableFabricEaseBreakdown,
  EnhancedFabricProperty,
  FabricEaseBreakdown,
  InputProvenanceSummary,
  MeasurementDirection,
  NegativeEaseAuthorizationPolicy,
  ProvisionalBiasShrinkagePolicy,
  ProvisionalRecoveryPolicy,
  UnavailableFabricEaseBreakdown
} from './fabric-types';
import { DEFAULT_ILLUSTRATIVE_FABRIC, getEnhancedFabricById } from './fabric-presets';

export interface EaseCalculationOptions {
  silhouette?: Silhouette;
  allowanceForShrinkage?: boolean;
  layerCount?: number; // For turn-of-cloth calculation (default: 1 layer)
  measurementDirection?: MeasurementDirection; // Required or derived; no unconditional fallback
  patternPieceOrientation?: 'crossgrain' | 'weft' | 'grainline' | 'warp' | 'bias';
  negativeEasePolicy?: NegativeEaseAuthorizationPolicy; // Explicit runtime-validated negative ease policy
  /**
   * @deprecated Legacy boolean flag. Deprecated in Milestone 04.5.3; a legacy boolean must NEVER activate negative ease.
   */
  negativeEasePolicyAllowed?: boolean;
  provisionalRecoveryPolicy?: ProvisionalRecoveryPolicy; // Explicit user-approved provisional recovery policy
  provisionalBiasShrinkagePolicy?: ProvisionalBiasShrinkagePolicy; // Explicit user-approved provisional bias shrinkage policy
  userExplicitConsentToDefaultFabric?: boolean; // Explicit opt-in for illustrative fallback
  garmentCategory?: string; // e.g. 'bodice', 'skirt' - required to match negative ease policy
  evaluationDate?: string | number | Date; // Injectable timestamp or ISO date for deterministic historical evaluation
}

/**
 * Result of validating a negative ease authorization policy.
 */
export interface PolicyValidationResult {
  isValid: boolean;
  rejectionReason?: string;
}

/**
 * Strict ISO 8601 calendar date validator.
 * Validates syntax, valid calendar dates (leap years, 28-31 days per month, hours/minutes/seconds).
 */
export function isValidIso8601Date(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string' || dateStr.trim() === '') {
    return false;
  }
  const str = dateStr.trim();
  const isoPattern = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-]\d{2}:?\d{2}))?)?$/;
  const match = str.match(isoPattern);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonths = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (day > daysInMonths[month - 1]) return false;

  if (match[4] !== undefined) {
    const hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);
    const second = parseInt(match[6], 10);
    if (hour > 23 || minute > 59 || second > 59) return false;
  }

  const timestamp = Date.parse(str);
  return !Number.isNaN(timestamp);
}

/**
 * Fit intent compatibility matrix mapped to garment category construction capabilities.
 */
export const CATEGORY_FIT_INTENT_COMPATIBILITY: Record<string, string[]> = {
  bodice: ['bodycon', 'stretch-contour', 'corsetry', 'performance-knit', 'tailored-fitted', 'compression-fit'],
  skirt: ['bodycon', 'stretch-contour', 'performance-knit', 'tailored-fitted', 'compression-fit'],
  sleeve: ['bodycon', 'stretch-contour', 'performance-knit', 'compression-fit'],
  trousers: ['bodycon', 'stretch-contour', 'performance-knit', 'tailored-fitted', 'compression-fit'],
  pants: ['bodycon', 'stretch-contour', 'performance-knit', 'tailored-fitted', 'compression-fit'],
  leggings: ['bodycon', 'stretch-contour', 'performance-knit', 'compression-fit'],
  corset: ['corsetry', 'bodycon', 'compression-fit'],
  dress: ['bodycon', 'stretch-contour', 'corsetry', 'performance-knit', 'tailored-fitted', 'compression-fit']
};

/**
 * Validates a negative ease authorization policy at runtime according to Milestone 04.5.3 / 04.5.3.1 rules.
 * - Missing garment category is rejected (not a wildcard).
 * - Wildcard 'all' is prohibited unless a separately explicit, audited scope is provided.
 * - Requires non-empty authorization source, author, valid ISO 8601 calendar date, recognized fit intent, finite non-negative limits.
 * - Verifies fit intent is compatible with garment category construction.
 * - Directional stretch and recovery must satisfy declared policy thresholds.
 * - Expiration date is evaluated deterministically against evaluationDate.
 */
export function validateNegativeEaseAuthorizationPolicy(
  policy: unknown,
  garmentCategory: string | undefined,
  directionalStretchPercent: number,
  directionalRecoveryPercent: number | undefined,
  evaluationDate?: string | number | Date
): PolicyValidationResult {
  if (!policy || typeof policy !== 'object') {
    return { isValid: false, rejectionReason: 'Negative ease authorization policy is missing or not an object.' };
  }

  const p = policy as Partial<NegativeEaseAuthorizationPolicy>;

  if (p.isAuthorized !== true) {
    return { isValid: false, rejectionReason: 'Negative ease policy is not authorized (isAuthorized is not true).' };
  }

  // Explicit, matching garment category. Missing category is a rejection, not a wildcard.
  if (!garmentCategory || typeof garmentCategory !== 'string' || garmentCategory.trim() === '') {
    return {
      isValid: false,
      rejectionReason: 'Target garment category is missing. Missing category is a rejection, not a wildcard.'
    };
  }

  if (!p.garmentCategory || typeof p.garmentCategory !== 'string' || p.garmentCategory.trim() === '') {
    return {
      isValid: false,
      rejectionReason: 'Negative ease policy is missing explicit garmentCategory. Missing category is a rejection, not a wildcard.'
    };
  }

  const normalizedTargetCat = garmentCategory.trim().toLowerCase();
  const normalizedPolicyCat = p.garmentCategory.trim().toLowerCase();

  // Multi-category wildcard 'all' audit scope check
  if (normalizedPolicyCat === 'all') {
    if (
      !p.multiCategoryAuditScope ||
      typeof p.multiCategoryAuditScope !== 'string' ||
      p.multiCategoryAuditScope.trim().length < 10 ||
      p.isMultiCategoryAudited !== true
    ) {
      return {
        isValid: false,
        rejectionReason: 'Wildcard category "all" is prohibited without a separately explicit, audited scope. Provide multiCategoryAuditScope (>= 10 chars) and isMultiCategoryAudited: true, or use explicit category matching.'
      };
    }
  } else if (normalizedPolicyCat !== normalizedTargetCat) {
    return {
      isValid: false,
      rejectionReason: `Policy garmentCategory '${p.garmentCategory}' does not match target garment category '${garmentCategory}'.`
    };
  }

  // Non-empty authorization source / provenance
  if (!p.sourceAndProvenance || typeof p.sourceAndProvenance !== 'string' || p.sourceAndProvenance.trim() === '') {
    return {
      isValid: false,
      rejectionReason: 'Negative ease policy missing non-empty sourceAndProvenance reference.'
    };
  }

  // Non-empty author
  if (!p.authorizedBy || typeof p.authorizedBy !== 'string' || p.authorizedBy.trim() === '') {
    return {
      isValid: false,
      rejectionReason: 'Negative ease policy missing non-empty authorizedBy identity.'
    };
  }

  // Valid ISO 8601 calendar authorization date
  if (!p.authorizationDate || !isValidIso8601Date(p.authorizationDate)) {
    return {
      isValid: false,
      rejectionReason: `Negative ease policy contains invalid authorizationDate '${p.authorizationDate}'. Must be a valid ISO 8601 calendar date.`
    };
  }

  // Deterministic evaluation date resolution
  const evalTime = evaluationDate !== undefined
    ? (typeof evaluationDate === 'string'
        ? (isValidIso8601Date(evaluationDate) ? Date.parse(evaluationDate) : NaN)
        : (evaluationDate instanceof Date ? evaluationDate.getTime() : evaluationDate))
    : Date.now();

  if (Number.isNaN(evalTime)) {
    return {
      isValid: false,
      rejectionReason: `Invalid evaluationDate '${evaluationDate}'. Must be a valid ISO 8601 date, timestamp, or Date object.`
    };
  }

  // Expiration check with deterministic evaluation timestamp
  if (p.expirationDate !== undefined) {
    if (!isValidIso8601Date(p.expirationDate)) {
      return {
        isValid: false,
        rejectionReason: `Negative ease policy contains invalid expirationDate '${p.expirationDate}'. Must be a valid ISO 8601 calendar date.`
      };
    }
    const expTime = Date.parse(p.expirationDate);
    if (evalTime > expTime) {
      return {
        isValid: false,
        rejectionReason: `Negative ease policy expired on '${p.expirationDate}' (evaluated at ${new Date(evalTime).toISOString()}).`
      };
    }
  }

  // Recognized fit intent
  const RECOGNIZED_FIT_INTENTS = [
    'bodycon',
    'compression-fit',
    'stretch-contour',
    'corsetry',
    'performance-knit',
    'tailored-fitted'
  ];
  if (!p.fitIntent || typeof p.fitIntent !== 'string' || p.fitIntent.trim() === '') {
    return {
      isValid: false,
      rejectionReason: 'Negative ease policy missing fitIntent.'
    };
  }
  const normalizedIntent = p.fitIntent.trim().toLowerCase();
  if (!RECOGNIZED_FIT_INTENTS.includes(normalizedIntent)) {
    return {
      isValid: false,
      rejectionReason: `Unrecognized fitIntent '${p.fitIntent}'. Must be one of: ${RECOGNIZED_FIT_INTENTS.join(', ')}.`
    };
  }

  // Verify fit intent is compatible with the garment category and construction
  const compatibleIntents = CATEGORY_FIT_INTENT_COMPATIBILITY[normalizedTargetCat];
  if (compatibleIntents && !compatibleIntents.includes(normalizedIntent)) {
    return {
      isValid: false,
      rejectionReason: `Fit intent '${p.fitIntent}' is incompatible with garment category '${garmentCategory}' construction. Compatible intents: ${compatibleIntents.join(', ')}.`
    };
  }

  // Finite non-negative limits: percentage
  if (
    p.maxPermittedNegativeEasePercent === undefined ||
    !Number.isFinite(p.maxPermittedNegativeEasePercent) ||
    p.maxPermittedNegativeEasePercent <= 0
  ) {
    return {
      isValid: false,
      rejectionReason: `Invalid maxPermittedNegativeEasePercent '${p.maxPermittedNegativeEasePercent}'. Must be a finite positive number.`
    };
  }

  // Finite non-negative limits: centimetre
  if (p.maxPermittedNegativeEaseCm !== undefined) {
    if (!Number.isFinite(p.maxPermittedNegativeEaseCm) || p.maxPermittedNegativeEaseCm <= 0) {
      return {
        isValid: false,
        rejectionReason: `Invalid maxPermittedNegativeEaseCm '${p.maxPermittedNegativeEaseCm}'. Must be a finite positive number when defined.`
      };
    }
  }

  // Minimum required stretch & recovery threshold checks
  if (
    p.minimumRequiredStretchPercent === undefined ||
    !Number.isFinite(p.minimumRequiredStretchPercent) ||
    p.minimumRequiredStretchPercent < 0
  ) {
    return {
      isValid: false,
      rejectionReason: 'Invalid minimumRequiredStretchPercent in policy. Must be finite non-negative number.'
    };
  }

  if (
    p.minimumRequiredRecoveryPercent === undefined ||
    !Number.isFinite(p.minimumRequiredRecoveryPercent) ||
    p.minimumRequiredRecoveryPercent < 0 ||
    p.minimumRequiredRecoveryPercent > 100
  ) {
    return {
      isValid: false,
      rejectionReason: 'Invalid minimumRequiredRecoveryPercent in policy. Must be finite number between 0 and 100.'
    };
  }

  if (
    !Number.isFinite(directionalStretchPercent) ||
    directionalStretchPercent < p.minimumRequiredStretchPercent
  ) {
    return {
      isValid: false,
      rejectionReason: `Directional stretch (${directionalStretchPercent.toFixed(1)}%) does not satisfy policy minimum required stretch (${p.minimumRequiredStretchPercent.toFixed(1)}%).`
    };
  }

  const recovery = directionalRecoveryPercent ?? 0;
  if (
    directionalRecoveryPercent === undefined ||
    !Number.isFinite(directionalRecoveryPercent) ||
    recovery < p.minimumRequiredRecoveryPercent
  ) {
    return {
      isValid: false,
      rejectionReason: `Directional recovery (${recovery.toFixed(1)}%) does not satisfy policy minimum required recovery (${p.minimumRequiredRecoveryPercent.toFixed(1)}%).`
    };
  }

  return { isValid: true };
}

/**
 * Validates a provisional recovery policy according to Milestone 04.5.3 rules.
 */
export function validateProvisionalRecoveryPolicy(
  policy: unknown
): { isValid: boolean; recoveryPercent?: number; rejectionReason?: string } {
  if (!policy || typeof policy !== 'object') {
    return { isValid: false, rejectionReason: 'Provisional recovery policy is missing or not an object.' };
  }

  const p = policy as Partial<ProvisionalRecoveryPolicy>;

  if (p.allowProvisionalRecovery !== true) {
    return { isValid: false, rejectionReason: 'allowProvisionalRecovery is not true.' };
  }

  if (p.userApproved !== true) {
    return { isValid: false, rejectionReason: 'userApproved is not true. User explicit approval is required.' };
  }

  if (
    p.provisionalRecoveryPercent === undefined ||
    !Number.isFinite(p.provisionalRecoveryPercent) ||
    p.provisionalRecoveryPercent < 0 ||
    p.provisionalRecoveryPercent > 100
  ) {
    return {
      isValid: false,
      rejectionReason: `provisionalRecoveryPercent must be a finite number between 0 and 100 (got ${p.provisionalRecoveryPercent}).`
    };
  }

  if (!p.approvedBy || typeof p.approvedBy !== 'string' || p.approvedBy.trim() === '') {
    return { isValid: false, rejectionReason: 'Provisional recovery policy missing approvedBy identity.' };
  }

  if (!p.reason || typeof p.reason !== 'string' || p.reason.trim() === '') {
    return { isValid: false, rejectionReason: 'Provisional recovery policy missing rationale reason.' };
  }

  if (!p.approvalDate || !isValidIso8601Date(p.approvalDate)) {
    return { isValid: false, rejectionReason: 'Provisional recovery policy missing valid ISO 8601 approvalDate.' };
  }

  return { isValid: true, recoveryPercent: p.provisionalRecoveryPercent };
}

/**
 * Validates a provisional bias shrinkage policy according to Milestone 04.5.3 rules.
 */
export function validateProvisionalBiasShrinkagePolicy(
  policy: unknown
): { isValid: boolean; shrinkagePercent?: number; rejectionReason?: string } {
  if (!policy || typeof policy !== 'object') {
    return { isValid: false, rejectionReason: 'Provisional bias shrinkage policy is missing or not an object.' };
  }

  const p = policy as Partial<ProvisionalBiasShrinkagePolicy>;

  if (p.allowProvisional !== true) {
    return { isValid: false, rejectionReason: 'allowProvisional is not true.' };
  }

  if (p.userApproved !== true) {
    return { isValid: false, rejectionReason: 'userApproved is not true. User explicit approval is required.' };
  }

  if (
    p.provisionalShrinkagePercent === undefined ||
    !Number.isFinite(p.provisionalShrinkagePercent) ||
    p.provisionalShrinkagePercent < 0 ||
    p.provisionalShrinkagePercent > 100
  ) {
    return {
      isValid: false,
      rejectionReason: `provisionalShrinkagePercent must be a finite number between 0 and 100 (got ${p.provisionalShrinkagePercent}).`
    };
  }

  if (!p.approvedBy || typeof p.approvedBy !== 'string' || p.approvedBy.trim() === '') {
    return { isValid: false, rejectionReason: 'Provisional bias shrinkage policy missing approvedBy identity.' };
  }

  if (!p.reason || typeof p.reason !== 'string' || p.reason.trim() === '') {
    return { isValid: false, rejectionReason: 'Provisional bias shrinkage policy missing rationale reason.' };
  }

  if (!p.approvalDate || !isValidIso8601Date(p.approvalDate)) {
    return { isValid: false, rejectionReason: 'Provisional bias shrinkage policy missing valid ISO 8601 approvalDate.' };
  }

  return { isValid: true, shrinkagePercent: p.provisionalShrinkagePercent };
}

/**
 * Helper to build a strictly typed UnavailableFabricEaseBreakdown.
 * Exposes no usable calculated or cutting dimensions.
 */
function createUnavailableResult(
  circumferenceId: FabricEaseBreakdown['circumferenceId'],
  bodyValueCm: number,
  baselineMovementEaseCm: number,
  unavailableReason: string,
  measurementDirection: MeasurementDirection | undefined,
  provenanceNotes: string[],
  limitations: string[],
  inputProvenanceSummary?: InputProvenanceSummary
): UnavailableFabricEaseBreakdown {
  return {
    status: 'unavailable',
    circumferenceId,
    measurementDirection,
    bodyMeasurementCm: bodyValueCm,
    baselineMovementEaseCm,
    isCalculationAvailable: false,
    unavailableReason,
    provenanceNotes,
    limitations,
    inputProvenanceSummary
  };
}

/**
 * Resolves enhanced fabric from input, requiring explicit user consent if falling back.
 */
function resolveEnhancedFabric(
  fabricInput?: FabricProperty | EnhancedFabricProperty,
  userExplicitConsentToDefaultFabric: boolean = false
): { fabric?: EnhancedFabricProperty; warning?: string; isFallback: boolean } {
  if (!fabricInput) {
    if (userExplicitConsentToDefaultFabric) {
      return {
        fabric: DEFAULT_ILLUSTRATIVE_FABRIC,
        warning: 'No fabric specified; using unverified illustrative project default with explicit user consent.',
        isFallback: true
      };
    }
    return {
      fabric: undefined,
      warning: 'Fabric specification missing. Explicit fabric selection required for physical ease calculations.',
      isFallback: false
    };
  }

  // If already an EnhancedFabricProperty with directional data
  if ('gsm' in fabricInput && 'directional' in fabricInput && fabricInput.directional) {
    return {
      fabric: fabricInput as EnhancedFabricProperty,
      isFallback: false
    };
  }

  // Lookup by ID
  const lookup = getEnhancedFabricById(fabricInput.id);
  if (lookup.status === 'found') {
    return {
      fabric: lookup.fabric,
      isFallback: false
    };
  }

  // Not found in presets
  if (userExplicitConsentToDefaultFabric) {
    return {
      fabric: DEFAULT_ILLUSTRATIVE_FABRIC,
      warning: `Fabric '${fabricInput.id ?? 'unknown'}' not found; using unverified illustrative default with explicit user consent.`,
      isFallback: true
    };
  }

  return {
    fabric: undefined,
    warning: `Fabric with ID '${fabricInput.id ?? 'unknown'}' not found in material library. Explicit selection required.`,
    isFallback: false
  };
}

/**
 * Calculates deterministic fabric-aware ease breakdown for a given body dimension.
 *
 * CRITICAL TEXTILE INTEGRITY PRINCIPLES (Milestone 04.5.3 Audit):
 * 1. Finished Garment Dimension = Body Measurement + Baseline Wearing Ease + Design Ease
 *                               + Thickness Allowance (Turn of Cloth) - Stretch Deduction.
 *    (Finished garment dimension is the dimension of the sewn, pressed garment when worn).
 * 2. Pre-Shrink Cutting Dimension = Finished Garment Dimension / (1 - Shrinkage Ratio).
 *    (Cutting dimension is the flat pattern dimension cut on fabric to allow for shrinkage).
 *    Shrinkage compensation is NEVER added to finished garment ease!
 * 3. Unavailable results expose NO usable finished garment or cutting dimensions.
 * 4. Missing or conflicting measurement direction is never substituted with crossgrain.
 * 5. Negative ease requires a complete, validated NegativeEaseAuthorizationPolicy matching category.
 * 6. Missing recovery cannot produce a measured calculation; requires complete provisional policy.
 * 7. Bias shrinkage cannot be fabricated by averaging warp and weft.
 */
export function calculateFabricAwareCircumferenceEase(
  circumferenceId: FabricEaseBreakdown['circumferenceId'],
  bodyValueCm: number,
  easeProfile: EaseProfile,
  fabricInput?: FabricProperty | EnhancedFabricProperty,
  options: EaseCalculationOptions = {}
): FabricEaseBreakdown {
  const provenanceNotes: string[] = [];
  const limitations: string[] = [
    'Stretch deduction uses provisional project model; not certified by tensile load-elongation curve testing.',
    'Turn-of-cloth model assumes uniform circular cylinder neutral axis shift (t/2).',
    'Negative ease calculation is a geometric 1D circumferential stretch reduction based on directional recovery; it does not model dynamic pressure gradient, muscular support, hydrostatic compression, or performance-garment suitability, which require laboratory pressure testing (e.g. BS 6612 / NF G30-102B).'
  ];

  const baseEaseProfile = EASE_TABLE[easeProfile] ?? EASE_TABLE.classic;
  const baseEaseVal = (baseEaseProfile as any)[circumferenceId] ?? (circumferenceId === 'bust' ? 5.5 : 3.0);
  const baselineMovementEaseCm = Number(baseEaseVal.toFixed(2));

  // 1. Resolve measurement direction and check for conflicting inputs
  let measurementDirection: MeasurementDirection | undefined = options.measurementDirection;

  if (!measurementDirection && options.patternPieceOrientation) {
    if (options.patternPieceOrientation === 'crossgrain' || options.patternPieceOrientation === 'weft') {
      measurementDirection = 'circumference-crossgrain';
    } else if (options.patternPieceOrientation === 'grainline' || options.patternPieceOrientation === 'warp') {
      measurementDirection = 'length-grainline';
    } else if (options.patternPieceOrientation === 'bias') {
      measurementDirection = 'bias';
    }
  }

  // Check conflicting inputs between explicit measurementDirection and patternPieceOrientation
  if (options.measurementDirection && options.patternPieceOrientation) {
    const dir = options.measurementDirection;
    const ori = options.patternPieceOrientation;
    const isConflict =
      (dir === 'circumference-crossgrain' && ori !== 'crossgrain' && ori !== 'weft') ||
      (dir === 'length-grainline' && ori !== 'grainline' && ori !== 'warp') ||
      (dir === 'bias' && ori !== 'bias');

    if (isConflict) {
      const conflictMsg = `Conflicting directional inputs: measurementDirection '${dir}' conflicts with patternPieceOrientation '${ori}'.`;
      provenanceNotes.push(conflictMsg);
      return createUnavailableResult(
        circumferenceId,
        bodyValueCm,
        baselineMovementEaseCm,
        conflictMsg,
        undefined, // Never substitute crossgrain on conflict!
        provenanceNotes,
        limitations
      );
    }
  }

  const VALID_DIRECTIONS: MeasurementDirection[] = [
    'circumference-crossgrain',
    'length-grainline',
    'bias'
  ];

  const isOrientationValid = Boolean(measurementDirection && VALID_DIRECTIONS.includes(measurementDirection));
  if (!isOrientationValid) {
    const missingDirMsg = `Measurement direction '${measurementDirection ?? 'undefined'}' is missing or ambiguous. Explicit direction ('circumference-crossgrain', 'length-grainline', or 'bias') or patternPieceOrientation is required. Unconditional circumference-crossgrain fallback removed.`;
    provenanceNotes.push(missingDirMsg);
    return createUnavailableResult(
      circumferenceId,
      bodyValueCm,
      baselineMovementEaseCm,
      missingDirMsg,
      undefined, // Never substitute crossgrain when missing/ambiguous!
      provenanceNotes,
      limitations
    );
  }

  // 2. Resolve fabric with explicit consent
  const resolution = resolveEnhancedFabric(fabricInput, options.userExplicitConsentToDefaultFabric);
  if (resolution.warning) {
    provenanceNotes.push(resolution.warning);
  }

  const fabric = resolution.fabric;
  if (!fabric) {
    const unverifiedFabricMsg = resolution.warning ?? 'Fabric specification is missing or unverified.';
    return createUnavailableResult(
      circumferenceId,
      bodyValueCm,
      baselineMovementEaseCm,
      unverifiedFabricMsg,
      measurementDirection,
      provenanceNotes,
      limitations
    );
  }

  if (fabric.auditWarnings && fabric.auditWarnings.length > 0) {
    provenanceNotes.push(...fabric.auditWarnings);
  }

  const validatedDirection = measurementDirection as MeasurementDirection;

  // 3. Directional Stretch & Elastic Recovery Resolution (Section 3: Missing recovery must not produce measured calc)
  let directionalStretchPercent = 0;
  let directionalRecoveryPercent: number | undefined = undefined;
  let isProvisionalRecovery = false;
  let provisionalRecoveryReason = '';

  if (validatedDirection === 'circumference-crossgrain') {
    directionalStretchPercent = fabric.directional?.weft?.stretchPercent ?? 0;
    directionalRecoveryPercent = fabric.directional?.weft?.elasticRecoveryPercent;
  } else if (validatedDirection === 'length-grainline') {
    directionalStretchPercent = fabric.directional?.warp?.stretchPercent ?? 0;
    directionalRecoveryPercent = fabric.directional?.warp?.elasticRecoveryPercent;
  } else {
    directionalStretchPercent = fabric.directional?.bias?.stretchPercent ?? 0;
    directionalRecoveryPercent = fabric.directional?.bias?.elasticRecoveryPercent;
  }

  if (directionalRecoveryPercent === undefined || !Number.isFinite(directionalRecoveryPercent)) {
    if (options.provisionalRecoveryPolicy) {
      const provRecValidation = validateProvisionalRecoveryPolicy(options.provisionalRecoveryPolicy);
      if (provRecValidation.isValid && provRecValidation.recoveryPercent !== undefined) {
        directionalRecoveryPercent = provRecValidation.recoveryPercent;
        isProvisionalRecovery = true;
        provisionalRecoveryReason = options.provisionalRecoveryPolicy.reason;
        provenanceNotes.push(
          `Elastic recovery missing from fabric data; applied user-approved provisional recovery of ${directionalRecoveryPercent}% by ${options.provisionalRecoveryPolicy.approvedBy} (${provisionalRecoveryReason}).`
        );
      } else {
        const provErrorMsg = `Provisional recovery policy rejected: ${provRecValidation.rejectionReason ?? 'Invalid policy'}.`;
        provenanceNotes.push(provErrorMsg);
        return createUnavailableResult(
          circumferenceId,
          bodyValueCm,
          baselineMovementEaseCm,
          provErrorMsg,
          validatedDirection,
          provenanceNotes,
          limitations
        );
      }
    } else {
      const missingRecoveryMsg = `Directional elastic recovery data missing for ${validatedDirection}. Measured recovery or complete user-approved provisional policy required.`;
      provenanceNotes.push(missingRecoveryMsg);
      return createUnavailableResult(
        circumferenceId,
        bodyValueCm,
        baselineMovementEaseCm,
        missingRecoveryMsg,
        validatedDirection,
        provenanceNotes,
        limitations
      );
    }
  }

  // 4. Directional Shrinkage Resolution (Section 5: Do not average warp and weft to fabricate bias shrinkage)
  let directionalShrinkagePercent = 0;
  let isProvisionalBiasShrinkage = false;
  let provisionalBiasShrinkageReason = '';

  if (validatedDirection === 'circumference-crossgrain') {
    directionalShrinkagePercent = fabric.directional?.weft?.shrinkagePercent ?? 0;
  } else if (validatedDirection === 'length-grainline') {
    directionalShrinkagePercent = fabric.directional?.warp?.shrinkagePercent ?? 0;
  } else {
    // Bias direction: NO averaging of warp and weft!
    if (fabric.directional?.bias?.shrinkagePercent !== undefined && Number.isFinite(fabric.directional.bias.shrinkagePercent)) {
      directionalShrinkagePercent = fabric.directional.bias.shrinkagePercent;
    } else if (options.allowanceForShrinkage) {
      if (options.provisionalBiasShrinkagePolicy) {
        const provBiasValidation = validateProvisionalBiasShrinkagePolicy(options.provisionalBiasShrinkagePolicy);
        if (provBiasValidation.isValid && provBiasValidation.shrinkagePercent !== undefined) {
          directionalShrinkagePercent = provBiasValidation.shrinkagePercent;
          isProvisionalBiasShrinkage = true;
          provisionalBiasShrinkageReason = options.provisionalBiasShrinkagePolicy.reason;
          provenanceNotes.push(
            `Bias shrinkage missing from fabric data; applied user-approved provisional bias shrinkage of ${directionalShrinkagePercent}% by ${options.provisionalBiasShrinkagePolicy.approvedBy} (${provisionalBiasShrinkageReason}).`
          );
        } else {
          const provBiasError = `Provisional bias shrinkage policy rejected: ${provBiasValidation.rejectionReason ?? 'Invalid policy'}.`;
          provenanceNotes.push(provBiasError);
          return createUnavailableResult(
            circumferenceId,
            bodyValueCm,
            baselineMovementEaseCm,
            provBiasError,
            validatedDirection,
            provenanceNotes,
            limitations
          );
        }
      } else {
        const noBiasShrinkageMsg =
          'Bias shrinkage data is missing for bias calculation. Measured bias shrinkage evidence or an explicitly approved provisional bias shrinkage policy is required. Warp and weft shrinkage averaging is prohibited.';
        provenanceNotes.push(noBiasShrinkageMsg);
        return createUnavailableResult(
          circumferenceId,
          bodyValueCm,
          baselineMovementEaseCm,
          noBiasShrinkageMsg,
          validatedDirection,
          provenanceNotes,
          limitations
        );
      }
    } else {
      directionalShrinkagePercent = 0;
    }
  }

  // 5. Negative Ease Policy Authorization (Section 2: Legacy boolean deprecated & rejected; strict runtime policy validation)
  let allowNegativeEase = false;
  let negativeEasePolicyApplied: NegativeEaseAuthorizationPolicy | undefined = undefined;

  if (options.negativeEasePolicyAllowed === true) {
    provenanceNotes.push(
      "Legacy 'negativeEasePolicyAllowed' boolean is deprecated and rejected as an authorization mechanism. A complete, runtime-validated NegativeEaseAuthorizationPolicy is strictly required."
    );
  }

  if (options.negativeEasePolicy) {
    const policyValidation = validateNegativeEaseAuthorizationPolicy(
      options.negativeEasePolicy,
      options.garmentCategory,
      directionalStretchPercent,
      directionalRecoveryPercent,
      options.evaluationDate
    );

    if (policyValidation.isValid) {
      allowNegativeEase = true;
      negativeEasePolicyApplied = options.negativeEasePolicy;
      provenanceNotes.push(
        `Negative ease explicitly authorized for category '${options.negativeEasePolicy.garmentCategory}' by ${options.negativeEasePolicy.authorizedBy} (Intent: ${options.negativeEasePolicy.fitIntent}, Auth Date: ${options.negativeEasePolicy.authorizationDate}).`
      );
    } else {
      provenanceNotes.push(
        `Negative ease policy rejected: ${policyValidation.rejectionReason}`
      );
    }
  }

  // 6. Calculate Stretch Deduction (Only when authorized by a validated negative ease policy)
  let stretchDeductionCm = 0;
  if (allowNegativeEase && directionalStretchPercent > 3.0 && directionalRecoveryPercent !== undefined) {
    const recoveryRatio = directionalRecoveryPercent / 100;
    const maxRatio = allowNegativeEase ? 1.5 : 0.60;
    const stretchRatio = Math.min(maxRatio, (directionalStretchPercent - 3.0) * 0.05 * recoveryRatio);
    stretchDeductionCm = Number((baselineMovementEaseCm * stretchRatio).toFixed(2));
  }

  // 7. Turn-of-Cloth Thickness Allowance
  const thicknessCm = (fabric.thicknessMm ?? 0.6) / 10;
  const layers = options.layerCount ?? 1;
  let thicknessAllowanceCm = 0;
  if (thicknessCm > 0.06) {
    thicknessAllowanceCm = Number((2 * Math.PI * thicknessCm * 0.5 * layers).toFixed(2));
  }

  // 8. Design Ease (Silhouette Adjustment)
  let designEaseCm = 0;
  if (options.silhouette === 'tailored') {
    designEaseCm = 0.5;
  } else if (options.silhouette === 'relaxed') {
    designEaseCm = 2.0;
  } else if (options.silhouette === 'pencil' || options.silhouette === 'straight') {
    designEaseCm = 0.0;
  } else if (options.silhouette === 'a-line' || options.silhouette === 'flared') {
    designEaseCm = circumferenceId === 'lowHip' ? 4.0 : 0.0;
  }

  // 9. Net Finished Garment Ease & Negative Ease Boundary Checking
  let totalAppliedEaseCm = Number(
    (baselineMovementEaseCm + designEaseCm + thicknessAllowanceCm - stretchDeductionCm).toFixed(2)
  );

  if (totalAppliedEaseCm < 0 && !allowNegativeEase) {
    stretchDeductionCm = Number((baselineMovementEaseCm + designEaseCm + thicknessAllowanceCm).toFixed(2));
    totalAppliedEaseCm = 0;
    provenanceNotes.push('Negative ease is disabled by default; stretch deduction was clamped to preserve zero non-negative ease.');
  }

  // Check policy limits if total applied ease is negative
  if (totalAppliedEaseCm < 0 && allowNegativeEase && negativeEasePolicyApplied) {
    const negativeEaseCm = Math.abs(totalAppliedEaseCm);
    const negativeEasePercent = Number(((negativeEaseCm / bodyValueCm) * 100).toFixed(2));

    if (
      negativeEasePolicyApplied.maxPermittedNegativeEaseCm !== undefined &&
      negativeEaseCm > negativeEasePolicyApplied.maxPermittedNegativeEaseCm
    ) {
      const overageCmMsg = `Calculated negative ease (-${negativeEaseCm.toFixed(2)} cm) exceeds maximum authorized policy limit (-${negativeEasePolicyApplied.maxPermittedNegativeEaseCm.toFixed(2)} cm).`;
      provenanceNotes.push(overageCmMsg);
      return createUnavailableResult(
        circumferenceId,
        bodyValueCm,
        baselineMovementEaseCm,
        overageCmMsg,
        validatedDirection,
        provenanceNotes,
        limitations
      );
    }

    if (
      negativeEasePolicyApplied.maxPermittedNegativeEasePercent !== undefined &&
      negativeEasePercent > negativeEasePolicyApplied.maxPermittedNegativeEasePercent
    ) {
      const overagePctMsg = `Calculated negative ease (-${negativeEasePercent.toFixed(1)}%) exceeds maximum authorized policy limit (-${negativeEasePolicyApplied.maxPermittedNegativeEasePercent.toFixed(1)}%).`;
      provenanceNotes.push(overagePctMsg);
      return createUnavailableResult(
        circumferenceId,
        bodyValueCm,
        baselineMovementEaseCm,
        overagePctMsg,
        validatedDirection,
        provenanceNotes,
        limitations
      );
    }
  }

  // 10. Finished Garment Dimension (Body + Net Finished Ease)
  const finishedGarmentDimensionCm = Number((bodyValueCm + totalAppliedEaseCm).toFixed(2));

  // 11. Directional Shrinkage & Pre-Shrink Cutting Dimension
  let shrinkageRatio = 0;
  let cuttingAllowanceFactor = 1.0;
  let preShrinkCuttingDimensionCm = finishedGarmentDimensionCm;
  let shrinkageCompensationCm = 0;

  if (options.allowanceForShrinkage && directionalShrinkagePercent > 0) {
    shrinkageRatio = directionalShrinkagePercent / 100;
    if (shrinkageRatio < 0.99) {
      cuttingAllowanceFactor = Number((1 / (1 - shrinkageRatio)).toFixed(4));
      preShrinkCuttingDimensionCm = Number((finishedGarmentDimensionCm / (1 - shrinkageRatio)).toFixed(2));
      shrinkageCompensationCm = Number((preShrinkCuttingDimensionCm - finishedGarmentDimensionCm).toFixed(2));
    }
  }

  // 12. Compile Input Provenance Summary
  const inputProvenanceSummary: InputProvenanceSummary = {
    measuredInputs: [`bodyMeasurementCm: ${bodyValueCm.toFixed(2)} cm`],
    supplierDeclaredInputs: [],
    projectDefaultInputs: [`baselineMovementEaseCm: ${baselineMovementEaseCm.toFixed(2)} cm (ISO/Aldrich table)`],
    estimatedInputs: [],
    explicitUserAssumptions: [],
    calculatedOutputs: [
      `totalAppliedEaseCm: ${totalAppliedEaseCm.toFixed(2)} cm`,
      `finishedGarmentDimensionCm: ${finishedGarmentDimensionCm.toFixed(2)} cm`,
      `preShrinkCuttingDimensionCm: ${preShrinkCuttingDimensionCm.toFixed(2)} cm`,
      `shrinkageCompensationCm: ${shrinkageCompensationCm.toFixed(2)} cm`
    ]
  };

  if (fabric.provenance === 'project-default') {
    inputProvenanceSummary.projectDefaultInputs.push(`fabric: ${fabric.name} (${fabric.id}) [project-default]`);
  } else if (fabric.provenance === 'laboratory-tested') {
    inputProvenanceSummary.measuredInputs.push(`fabric: ${fabric.name} (${fabric.id}) [laboratory-tested]`);
  } else if (fabric.provenance === 'supplier-declared') {
    inputProvenanceSummary.supplierDeclaredInputs.push(`fabric: ${fabric.name} (${fabric.id}) [supplier-declared]`);
  } else {
    inputProvenanceSummary.estimatedInputs.push(`fabric: ${fabric.name} (${fabric.id})`);
  }

  if (isProvisionalRecovery) {
    inputProvenanceSummary.explicitUserAssumptions.push(
      `Provisional recovery: ${directionalRecoveryPercent}% (${provisionalRecoveryReason})`
    );
  } else if (directionalRecoveryPercent !== undefined) {
    inputProvenanceSummary.measuredInputs.push(`directionalRecoveryPercent: ${directionalRecoveryPercent}%`);
  }

  if (isProvisionalBiasShrinkage) {
    inputProvenanceSummary.explicitUserAssumptions.push(
      `Provisional bias shrinkage: ${directionalShrinkagePercent}% (${provisionalBiasShrinkageReason})`
    );
  }

  if (negativeEasePolicyApplied) {
    inputProvenanceSummary.explicitUserAssumptions.push(
      `Negative ease authorized by ${negativeEasePolicyApplied.authorizedBy} (max: ${negativeEasePolicyApplied.maxPermittedNegativeEasePercent}%, Intent: ${negativeEasePolicyApplied.fitIntent})`
    );
  }

  return {
    status: 'available',
    circumferenceId,
    measurementDirection: validatedDirection,
    bodyMeasurementCm: bodyValueCm,
    baselineMovementEaseCm,
    designEaseCm,
    stretchDeductionCm,
    thicknessAllowanceCm,
    silhouetteAdjustmentCm: designEaseCm,
    totalAppliedEaseCm,
    finishedGarmentDimensionCm,
    shrinkageRatio,
    shrinkageCompensationCm,
    preShrinkCuttingDimensionCm,
    cuttingAllowanceFactor,
    isCalculationAvailable: true,
    isProvisionalCalculation: isProvisionalRecovery || isProvisionalBiasShrinkage,
    provisionalReason: isProvisionalRecovery ? provisionalRecoveryReason : (isProvisionalBiasShrinkage ? provisionalBiasShrinkageReason : undefined),
    isProvisionalRecovery,
    provisionalRecoveryPolicyApplied: isProvisionalRecovery ? options.provisionalRecoveryPolicy : undefined,
    isProvisionalBiasShrinkage,
    provisionalBiasShrinkagePolicyApplied: isProvisionalBiasShrinkage ? options.provisionalBiasShrinkagePolicy : undefined,
    negativeEasePolicyApplied,
    inputProvenanceSummary,
    provenanceNotes,
    limitations
  };
}

/**
 * Calculates recommended sleeve cap ease adapted to fabric molding capacity.
 * Structured wools with high molding factors can absorb up to +3.5cm cap ease cleanly.
 * Low-molding silks or stiff denims require lower cap ease to avoid crimp puckering.
 */
export function calculateFabricAdaptedSleeveCapEase(
  strategy: SleeveEaseStrategy,
  fabricInput?: FabricProperty | EnhancedFabricProperty,
  options: { userExplicitConsentToDefaultFabric?: boolean } = {}
): {
  baseStrategyEaseCm: number;
  adaptedCapEaseCm: number;
  minCapEaseCm: number;
  maxCapEaseCm: number;
  moldingFactor: number;
  crimpCapacityDescription: string;
  isCalculationAvailable: boolean;
  notes: string[];
} {
  const resolution = resolveEnhancedFabric(fabricInput, options.userExplicitConsentToDefaultFabric);
  const strategyParams = SLEEVE_EASE_TABLE[strategy] ?? SLEEVE_EASE_TABLE.classic;
  const baseEase = strategyParams.recommendedCapEaseCm;
  const notes: string[] = [
    'Molding factor ease scaling is a provisional project formula based on atelier practice, not finite-element analysis.'
  ];

  if (resolution.warning) {
    notes.push(resolution.warning);
  }

  if (!resolution.fabric) {
    return {
      baseStrategyEaseCm: baseEase,
      adaptedCapEaseCm: baseEase,
      minCapEaseCm: strategyParams.capEaseMinCm,
      maxCapEaseCm: strategyParams.capEaseMaxCm,
      moldingFactor: 1.0,
      crimpCapacityDescription: 'Standard sleeve cap ease; fabric moldability unassessed.',
      isCalculationAvailable: false,
      notes
    };
  }

  const molding = resolution.fabric.moldingFactor ?? 1.0;
  const rawAdapted = baseEase * molding;
  const adaptedCapEaseCm = Number(
    Math.max(strategyParams.capEaseMinCm, Math.min(strategyParams.capEaseMaxCm, rawAdapted)).toFixed(2)
  );

  let crimpCapacityDescription = 'Balanced daywear cap ease distribution';
  if (molding >= 1.2) {
    crimpCapacityDescription = 'High steam-molding capacity: ease will shrink smoothly with iron shaping without crimping.';
  } else if (molding < 0.8) {
    crimpCapacityDescription = 'Low moldability: cap ease must be restricted to prevent puckering along the armhole seam.';
  }

  return {
    baseStrategyEaseCm: baseEase,
    adaptedCapEaseCm,
    minCapEaseCm: strategyParams.capEaseMinCm,
    maxCapEaseCm: strategyParams.capEaseMaxCm,
    moldingFactor: molding,
    crimpCapacityDescription,
    isCalculationAvailable: true,
    notes
  };
}

/**
 * Comprehensive fabric-aware garment ease summary across all primary circumferences.
 */
export function calculateCompleteGarmentEase(
  measurements: BodyMeasurements,
  easeProfile: EaseProfile,
  fabricInput?: FabricProperty | EnhancedFabricProperty,
  options: EaseCalculationOptions = {}
): Record<'bust' | 'waist' | 'lowHip', FabricEaseBreakdown> {
  const bustVal = measurements.bust ?? 90;
  const waistVal = measurements.waist;
  const hipVal = measurements.lowHip;
  const circumferenceOptions: EaseCalculationOptions = {
    ...options,
    garmentCategory: options.garmentCategory ?? 'bodice',
    measurementDirection: options.measurementDirection ?? 'circumference-crossgrain'
  };

  return {
    bust: calculateFabricAwareCircumferenceEase('bust', bustVal, easeProfile, fabricInput, circumferenceOptions),
    waist: calculateFabricAwareCircumferenceEase('waist', waistVal, easeProfile, fabricInput, circumferenceOptions),
    lowHip: calculateFabricAwareCircumferenceEase('lowHip', hipVal, easeProfile, fabricInput, circumferenceOptions)
  };
}
