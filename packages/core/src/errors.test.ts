import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';

describe('AppError', () => {
  it('lleva code, httpStatus y retryable', () => {
    const e = new AppError('NOT_FOUND', 'no existe', { httpStatus: 404 });
    expect(e.code).toBe('NOT_FOUND');
    expect(e.httpStatus).toBe(404);
    expect(e.retryable).toBe(false);
  });
});
