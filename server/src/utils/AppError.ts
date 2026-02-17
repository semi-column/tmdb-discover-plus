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
