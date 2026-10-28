import { HttpErrorResponse } from '@angular/common/http';

/** What kind of failure an API call hit, so a caller can branch on meaning rather than raw status. */
export type ApiErrorCategory =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'validation'
  | 'conflict'
  | 'server'
  | 'network'
  | 'unknown';

/** One field-level sub-error from the API's validation envelope. */
export interface ApiErrorDetail {
  field?: string;
  message?: string;
  code?: string;
}

/** The body the API's GlobalExceptionHandler writes for every failure (ApiErrorResponse.cs). */
interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetail[] | null;
    traceId?: string;
  } | null;
  /** Some older endpoints answer with a bare { message } rather than the envelope. */
  message?: string;
}

/** Maps an HTTP status to its category. Status 0 is Angular's "the request never got an answer". */
export function categorizeStatus(status: number): ApiErrorCategory {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 400 || status === 422) return 'validation';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * The one error type ApiService throws.
 *
 * `status`, `traceId` and `message` keep the names the previous bare-Error wrapper used, so callers
 * that read `err.status === 409` or show `err.message` are unaffected; `code`, `details` and
 * `category` are the parts of the server's envelope that were being dropped.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** HTTP status, or 0 when there was no HTTP response at all. */
  readonly status: number;
  /** The server's machine-readable code, e.g. VALIDATION_ERROR or INFRASTRUCTURE_CTRM_UNAVAILABLE. */
  readonly code?: string;
  readonly details: readonly ApiErrorDetail[];
  /** Correlation id a user can quote to support. Only present when the server sent one. */
  readonly traceId?: string;
  readonly category: ApiErrorCategory;

  constructor(init: {
    message: string;
    status: number;
    code?: string;
    details?: readonly ApiErrorDetail[];
    traceId?: string;
    category?: ApiErrorCategory;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.traceId = init.traceId;
    this.category = init.category ?? categorizeStatus(init.status);
  }

  /**
   * Builds from a failed HTTP response. The message is the server's real text, falling back through
   * the common shapes: for validation errors the first field-level detail (e.g. "A location named X
   * already exists in this trade unit") wins over the generic "One or more fields failed validation."
   */
  static fromHttpErrorResponse(response: HttpErrorResponse): ApiError {
    const body = (typeof response.error === 'object' ? response.error : null) as ApiErrorEnvelope | null;
    const envelope = body?.error ?? undefined;
    const details = Array.isArray(envelope?.details)
      ? envelope.details.filter((d): d is ApiErrorDetail => !!d && typeof d === 'object')
      : [];
    const detailMsg = details.find(d => !!d.message)?.message;
    const serverMsg = detailMsg ?? envelope?.message ?? body?.message ?? response.message;
    return new ApiError({
      message: serverMsg || 'Server error',
      status: response.status,
      code: envelope?.code || undefined,
      details,
      traceId: envelope?.traceId || undefined,
      cause: response,
    });
  }

  /** Wraps anything that is not an HTTP response (e.g. a throw inside a response mapper). */
  static fromUnknown(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    return new ApiError({
      message: error instanceof Error ? error.message : 'Server error',
      status: 0,
      category: 'unknown',
      cause: error,
    });
  }
}
