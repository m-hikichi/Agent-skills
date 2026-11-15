import type {StructuredError} from '../shared/contracts.js';
import {EXIT_CODES} from '../shared/exit-codes.js';

export type ErrorCategory =
  | 'schema'
  | 'dependency'
  | 'render'
  | 'policy'
  | 'cancelled'
  | 'internal';

const CATEGORY_EXIT_CODE: Record<ErrorCategory, number> = {
  schema: EXIT_CODES.schemaOrConfig,
  dependency: EXIT_CODES.dependencyOrProvider,
  render: EXIT_CODES.render,
  policy: EXIT_CODES.policyOrSecurity,
  cancelled: EXIT_CODES.cancelled,
  internal: EXIT_CODES.render,
};

export interface AppErrorOptions {
  category?: ErrorCategory;
  jsonPointer?: string;
  hint?: string;
  retryable?: boolean;
  jobId?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly jsonPointer?: string;
  readonly hint?: string;
  readonly retryable: boolean;
  readonly jobId?: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.category = options.category ?? 'internal';
    this.jsonPointer = options.jsonPointer;
    this.hint = options.hint;
    this.retryable = options.retryable ?? false;
    this.jobId = options.jobId;
    this.cause = options.cause;
  }

  get exitCode(): number {
    return CATEGORY_EXIT_CODE[this.category];
  }

  toJSON(): StructuredError {
    return compact({
      code: this.code,
      message: this.message,
      jsonPointer: this.jsonPointer,
      hint: this.hint,
      retryable: this.retryable,
      jobId: this.jobId,
    });
  }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

export function asAppError(error: unknown, fallbackCode = 'INTERNAL_ERROR'): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError(fallbackCode, error.message, {cause: error});
  }
  return new AppError(fallbackCode, String(error));
}

export function abortError(jobId?: string): AppError {
  return new AppError('CANCELLED', 'Operation cancelled.', {
    category: 'cancelled',
    retryable: true,
    ...(jobId === undefined ? {} : {jobId}),
  });
}

export function throwIfAborted(signal?: AbortSignal, jobId?: string): void {
  if (signal?.aborted) throw abortError(jobId);
}
