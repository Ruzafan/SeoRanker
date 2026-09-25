/**
 * Códigos de error estables. El backend solo emite códigos; el frontend los traduce.
 * Añadir uno aquí obliga (por tipos) a traducirlo en apps/web/src/lib/i18n.ts.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'REGISTRATION_DISABLED',
  'INVALID_URL',
  'CONNECTION_FAILED',
  'WP_AUTH_FAILED',
  'WP_REST_NOT_FOUND',
  'NO_CREDENTIALS',
  'NO_SEEDS',
  'INVALID_STATE',
  'QUOTA_EXCEEDED',
  'PLAN_SITE_LIMIT',
  'PLATFORM_NOT_SUPPORTED',
  'BILLING_NOT_CONFIGURED',
  'OWNER_REQUIRED',
  'AI_ERROR',
  'AI_TRUNCATED',
  'AI_INVALID_OUTPUT',
  'NOT_IMPLEMENTED',
  'WATCHDOG_TIMEOUT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Avisos no fatales que devuelven publicación y test de conexión. */
export const WARNING_CODES = ['YOAST_META_NOT_EXPOSED', 'YOAST_NOT_DETECTED'] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
