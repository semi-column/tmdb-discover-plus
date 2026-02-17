import { describe, it, expect } from 'vitest';
import { AppError, ErrorCodes, formatErrorResponse, sendError } from '../../src/utils/AppError.ts';

describe('AppError', () => {
  it('creates an error with statusCode and code', () => {
    const err = new AppError(404, ErrorCodes.NOT_FOUND, 'Not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Not found');
  });

  it('has correct prototype chain', () => {
    const err = new AppError(500, ErrorCodes.INTERNAL_ERROR, 'fail');
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('ErrorCodes', () => {
  it('contains expected error codes', () => {
    expect(ErrorCodes.INVALID_API_KEY).toBe('INVALID_API_KEY');
    expect(ErrorCodes.CONFIG_NOT_FOUND).toBe('CONFIG_NOT_FOUND');
    expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});

describe('formatErrorResponse', () => {
  it('returns structured error object', () => {
    const result = formatErrorResponse(ErrorCodes.VALIDATION_ERROR, 'Bad input');
    expect(result).toMatchObject({
      error: 'Bad input',
      code: 'VALIDATION_ERROR',
    });
    // requestId may be undefined outside of async context
    expect('requestId' in result).toBe(true);
  });
});

describe('sendError', () => {
  it('sends JSON error response with correct status', () => {
    let statusCode: number | undefined;
    let body: unknown;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: unknown) {
        body = data;
      },
    };
    sendError(res, 422, ErrorCodes.VALIDATION_ERROR, 'Invalid field');
    expect(statusCode).toBe(422);
    expect(body).toMatchObject({ error: 'Invalid field', code: 'VALIDATION_ERROR' });
  });
});
