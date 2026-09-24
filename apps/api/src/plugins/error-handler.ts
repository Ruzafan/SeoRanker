import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '@seo/core';

export interface ErrorBody {
  error: { code: string; message: string };
}

/** Traduce cualquier error a `{ error: { code, message } }`. Los códigos los traduce el frontend. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((_req, reply) => {
    const body: ErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
    void reply.status(404).send(body);
  });

  app.setErrorHandler((err: FastifyError | AppError | ZodError, req, reply) => {
    if (err instanceof AppError) {
      const body: ErrorBody = { error: { code: err.code, message: err.message } };
      if (err.httpStatus >= 500) req.log.error({ err }, 'app error');
      return reply.status(err.httpStatus).send(body);
    }
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      const body: ErrorBody = { error: { code: 'VALIDATION_ERROR', message } };
      return reply.status(400).send(body);
    }
    const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status === 429) {
      const body: ErrorBody = { error: { code: 'RATE_LIMITED', message: 'Too many requests' } };
      return reply.status(429).send(body);
    }
    if (status >= 400 && status < 500) {
      const body: ErrorBody = { error: { code: 'VALIDATION_ERROR', message: err.message } };
      return reply.status(status).send(body);
    }
    req.log.error({ err }, 'unhandled error');
    const body: ErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Internal error' } };
    return reply.status(500).send(body);
  });
}
