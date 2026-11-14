/** The eight hard gates of review schema 1.0.0 (legibility and content match only). Still accepted. */
export const REVIEW_GATE_NAMES = [
  'noOverflowOrClipping',
  'noUnintendedOverlap',
  'safeMargins',
  'readableContrast',
  'subtitleReadable',
  'visualMatchesContent',
  'consistentTypography',
  'thumbnailReadable',
] as const;

export type ReviewGateName = typeof REVIEW_GATE_NAMES[number];
export type PassingReviewGates = Record<ReviewGateName, true>;

/**
 * Review schema 2.0.0 separates what the reviewer judges into three groups.
 * (Technical validity is decided by validate/resolve/output_inspect, not by a reviewer.)
 * Every gate is a hard gate: one false gate fails the review and is never averaged away.
 */
export const REVIEW_GATE_GROUPS_V2 = {
  /** B. Can it be read? */
  legibility: [
    'noOverflowOrClipping',
    'noUnintendedOverlap',
    'safeMargins',
    'readableContrast',
    'subtitleReadable',
    'consistentTypography',
    'thumbnailReadable',
    'readableWhenScaledDown',
    'balancedLayout',
  ],
  /** C. Does it explain? */
  explanation: [
    'visualMatchesContent',
    'claimsAccurate',
    'fitsAudience',
  ],
  /** D. Does the picture do work? */
  visual: [
    'formFitsMeaning',
    'clearFocus',
    'variedPresentation',
  ],
} as const;

export const REVIEW_GATE_NAMES_V2 = [
  ...REVIEW_GATE_GROUPS_V2.legibility,
  ...REVIEW_GATE_GROUPS_V2.explanation,
  ...REVIEW_GATE_GROUPS_V2.visual,
] as const;

export type ReviewGateNameV2 = typeof REVIEW_GATE_NAMES_V2[number];

/**
 * Gates that may be answered "not_applicable" (with the reason in
 * notApplicableReasons) so that a short or deliberately uniform video is not
 * forced into variety for its own sake.
 */
export const OPTIONAL_REVIEW_GATES_V2: readonly ReviewGateNameV2[] = ['variedPresentation'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * A passing gate object is exact: every canonical gate is present, every value
 * is the boolean true, and no unknown gate can hide a misspelled canonical key.
 */
export const hasCompletePassingReviewGates = (value: unknown): value is PassingReviewGates => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === REVIEW_GATE_NAMES.length
    && REVIEW_GATE_NAMES.every((name) => value[name] === true)
    && keys.every((name) => (REVIEW_GATE_NAMES as readonly string[]).includes(name));
};

/** Schema 2.0.0: all gates present and true, except optional gates that state a reason for not applying. */
export const hasCompletePassingReviewGatesV2 = (value: unknown, reasons: unknown): boolean => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== REVIEW_GATE_NAMES_V2.length || !keys.every((name) => (REVIEW_GATE_NAMES_V2 as readonly string[]).includes(name))) return false;
  return REVIEW_GATE_NAMES_V2.every((name) => {
    if (value[name] === true) return true;
    return value[name] === 'not_applicable' && OPTIONAL_REVIEW_GATES_V2.includes(name) && isRecord(reasons) && nonEmpty(reasons[name]);
  });
};

export const passingReviewGates = (): PassingReviewGates => Object.fromEntries(
  REVIEW_GATE_NAMES.map((name) => [name, true]),
) as PassingReviewGates;

export const passingReviewGatesV2 = (): Record<ReviewGateNameV2, true> => Object.fromEntries(
  REVIEW_GATE_NAMES_V2.map((name) => [name, true]),
) as Record<ReviewGateNameV2, true>;

/** A passing review may contain actionable warnings, but never malformed or error issues. */
export const hasNoReviewErrors = (value: unknown): boolean => Array.isArray(value)
  && value.every((issue) => isRecord(issue)
    && issue.severity === 'warning'
    && typeof issue.problem === 'string'
    && issue.problem.length > 0
    && typeof issue.fix === 'string'
    && issue.fix.length > 0);

/**
 * Schema 2.0.0 issues must be actionable: where (scene or time), what, how it
 * hurts the viewer, what it was seen in, and what to change.
 */
export const hasNoReviewErrorsV2 = (value: unknown): boolean => hasNoReviewErrors(value)
  && (value as unknown[]).every((issue) => isRecord(issue)
    && (nonEmpty(issue.sceneId) || typeof issue.timeSeconds === 'number')
    && nonEmpty(issue.impact)
    && nonEmpty(issue.evidence));

export const isReviewSchemaV2 = (value: unknown): boolean => isRecord(value) && value.schemaVersion === '2.0.0';

/** Gates of a review in either schema version. */
export const reviewGatesPass = (review: unknown): boolean => {
  if (!isRecord(review)) return false;
  return isReviewSchemaV2(review)
    ? hasCompletePassingReviewGatesV2(review.gates, review.notApplicableReasons)
    : hasCompletePassingReviewGates(review.gates);
};

export const reviewIssuesPass = (review: unknown): boolean => {
  if (!isRecord(review)) return false;
  return isReviewSchemaV2(review) ? hasNoReviewErrorsV2(review.issues) : hasNoReviewErrors(review.issues);
};

/** Shared UI/render interpretation of a review for one immutable lock. */
export const isPassingReviewForLock = (value: unknown, projectId: string, lockHash: string): boolean => {
  if (!isRecord(value)) return false;
  return value.status === 'pass'
    && value.projectId === projectId
    && value.lockHash === lockHash
    && typeof value.iteration === 'number'
    && Number.isInteger(value.iteration)
    && value.iteration >= 1
    && value.iteration <= 3
    && reviewGatesPass(value)
    && reviewIssuesPass(value);
};
