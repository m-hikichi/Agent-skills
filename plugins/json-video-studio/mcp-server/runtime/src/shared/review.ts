/** The eight hard gates defined by agents/video-reviewer.md and review.template.json. */
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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

export const passingReviewGates = (): PassingReviewGates => Object.fromEntries(
  REVIEW_GATE_NAMES.map((name) => [name, true]),
) as PassingReviewGates;

/** A passing review may contain actionable warnings, but never malformed or error issues. */
export const hasNoReviewErrors = (value: unknown): boolean => Array.isArray(value)
  && value.every((issue) => isRecord(issue)
    && issue.severity === 'warning'
    && typeof issue.problem === 'string'
    && issue.problem.length > 0
    && typeof issue.fix === 'string'
    && issue.fix.length > 0);

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
    && hasCompletePassingReviewGates(value.gates)
    && hasNoReviewErrors(value.issues);
};
