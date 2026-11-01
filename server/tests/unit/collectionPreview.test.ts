import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/utils/authMiddleware.ts', () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.apiKey = 'test-api-key';
    next();
  },
  optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireConfigOwnership: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { apiRouter } from '../../src/routes/api.ts';
import { setLogSink } from '../../src/utils/logger.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  setLogSink(null);
});

describe('POST /api/preview collection validation', () => {
  it('preserves the real collection validation 400 and user_config classification', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const warnings: Array<Record<string, unknown> | null> = [];
    setLogSink((_level, _context, message, data) => {
      if (message === 'Invalid preview configuration') warnings.push(data);
    });
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    const response = await request(app)
      .post('/api/preview')
      .send({
        type: 'movie',
        filters: { listType: 'collection' },
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(warnings).toEqual([
      expect.objectContaining({
        classification: 'user_config',
        code: 'VALIDATION_ERROR',
        error: expect.objectContaining({ statusCode: 400 }),
      }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
