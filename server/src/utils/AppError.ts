import { getRequestId } from './requestContext.ts';

export const ErrorCodes = {
  INVALID_API_KEY: 'INVALID_API_KEY',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  TMDB_RATE_LIMITED: 'TMDB_RATE_LIMITED',
  TMDB_UNAVAILABLE: 'TMDB_UNAVAILABLE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  statusCode: number;
  code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function formatErrorResponse(
  code: ErrorCode,
  message: string
): { error: string; code: string; requestId: string | undefined } {
  return {
    error: message,
    code,
    requestId: getRequestId(),
  };
}

export function sendError(res: any, statusCode: number, code: ErrorCode, message: string): void {
  res.status(statusCode).json(formatErrorResponse(code, message));
}

/**
 * Return a safe, user-facing message for internal/storage errors.
 * Keeps known user-facing messages (validation, auth) but strips
 * Mongoose CastErrors and other verbose internals.
 */
export function safeErrorMessage(error: Error): string {
  const msg = error.message || '';
  if (msg.includes('CastError') || msg.includes('Cast to')) {
    return 'Invalid catalog data. Please check your catalog configuration and try again.';
  }
  if (msg.includes('validation failed') || msg.includes('ValidatorError')) {
    return 'Catalog validation failed. Please check your settings and try again.';
  }
  // Keep short, intentional error messages (thrown by our own code)
  if (msg.length < 120 && !msg.includes('\n')) return msg;
  return 'An unexpected error occurred. Please try again.';
}
