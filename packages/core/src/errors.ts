import type { ErrorCode } from '@seo/shared';

export type { ErrorCode };

export interface AppErrorOptions {
  httpStatus?: number;
  retryable?: boolean;
  cause?: unknown;
}

/** Error tipado. `code` es un código estable que el frontend traduce; nunca texto localizado. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? 500;
    this.retryable = options.retryable ?? false;
  }
}

export class NotImplementedError extends AppError {
  constructor(what: string) {
    super('NOT_IMPLEMENTED', `${what} is not implemented`, { httpStatus: 501 });
    this.name = 'NotImplementedError';
  }
}

export const notFound = (what = 'Resource'): AppError =>
  new AppError('NOT_FOUND', `${what} not found`, { httpStatus: 404 });

/** Mensaje seguro (sin secretos) de cualquier error desconocido. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function errorCode(err: unknown): ErrorCode {
  return err instanceof AppError ? err.code : 'INTERNAL_ERROR';
}
