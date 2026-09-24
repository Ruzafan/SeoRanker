import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    db: z.enum(['ok', 'error']),
    redis: z.enum(['ok', 'error']),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
