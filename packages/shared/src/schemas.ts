import { z } from 'zod';
import { PRODUCT_ISSUES } from './products.js';
import { INVITABLE_ROLES, PAID_PLAN_IDS, PLATFORM_IDS, PLATFORMS } from './plans.js';
import { editableSettingsSchema } from './settings.js';

// ---- Auth ----------------------------------------------------------------
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10).max(200),
  organizationName: z.string().trim().min(1).max(100).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---- Sites ---------------------------------------------------------------
const langSchema = z.string().trim().toLowerCase().length(2);
const countrySchema = z.string().trim().toUpperCase().length(2);

export const createSiteSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    url: z.string().trim().min(3).max(300),
    language: langSchema,
    country: countrySchema,
    /** Las no disponibles se rechazan en el servicio con PLATFORM_NOT_SUPPORTED. */
    platform: z.enum(PLATFORM_IDS).default('wordpress'),
    wpUsername: z.string().trim().min(1).max(100).optional(),
    wpAppPassword: z.string().trim().min(8).max(200).optional(),
  })
  .superRefine((v, ctx) => {
    // Solo las plataformas con conector piden credenciales (una web genérica solo se analiza).
    if (!PLATFORMS[v.platform].needsCredentials) return;
    if (!v.wpUsername) ctx.addIssue({ code: 'custom', path: ['wpUsername'], message: 'Required' });
    if (!v.wpAppPassword)
      ctx.addIssue({ code: 'custom', path: ['wpAppPassword'], message: 'Required' });
  });
export type CreateSiteInput = z.infer<typeof createSiteSchema>;

export const updateSiteSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    url: z.string().trim().min(3).max(300),
    language: langSchema,
    country: countrySchema,
    brandVoice: z.string().max(20000).nullable(),
    wpUsername: z.string().trim().min(1).max(100),
    wpAppPassword: z.string().trim().min(8).max(200),
    settings: editableSettingsSchema,
    active: z.boolean(),
  })
  .partial();
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

// ---- Keywords ------------------------------------------------------------
export const KEYWORD_INTENTS = ['informational', 'commercial', 'transactional'] as const;
/** Filtro por intención; `buyer` = comercial + transaccional (las que venden). */
export const KEYWORD_INTENT_FILTERS = ['buyer', ...KEYWORD_INTENTS] as const;
export type KeywordIntentFilter = (typeof KEYWORD_INTENT_FILTERS)[number];

export const KEYWORD_STATUSES = [
  'pending',
  'queued',
  'processing',
  'done',
  'failed',
  'discarded',
] as const;
export type KeywordStatus = (typeof KEYWORD_STATUSES)[number];

export const createKeywordsSchema = z.object({
  terms: z.array(z.string().trim().min(2).max(200)).min(1).max(500),
});
export type CreateKeywordsInput = z.infer<typeof createKeywordsSchema>;

export const patchKeywordSchema = z
  .object({
    status: z.enum(['pending', 'discarded']),
    score: z.number().int().min(0).max(100),
    intent: z.enum(KEYWORD_INTENTS).nullable(),
  })
  .partial();
export type PatchKeywordInput = z.infer<typeof patchKeywordSchema>;

export const batchKeywordsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(['queue', 'discard']),
});
export type BatchKeywordsInput = z.infer<typeof batchKeywordsSchema>;

export const KEYWORD_SOURCES = ['manual', 'autocomplete', 'paa', 'gsc', 'import'] as const;

export const keywordQuerySchema = z.object({
  status: z.enum(KEYWORD_STATUSES).optional(),
  source: z.enum(KEYWORD_SOURCES).optional(),
  intent: z.enum(KEYWORD_INTENT_FILTERS).optional(),
  clusterId: z.string().min(1).max(64).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(['score', 'createdAt', 'term', 'volume', 'gscImpressions']).default('score'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type KeywordQuery = z.infer<typeof keywordQuerySchema>;

// ---- Productos -------------------------------------------------------------
export const productQuerySchema = z.object({
  issue: z.enum(PRODUCT_ISSUES).optional(),
  search: z.string().trim().max(200).optional(),
  /** Con sugerencias pendientes de revisar. */
  pending: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(['score', 'name']).default('score'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

export const analyzeProductsSchema = z.object({
  /** Productos concretos; sin ellos, los de peor puntuación sin sugerencias pendientes. */
  productIds: z.array(z.string().min(1).max(64)).min(1).max(50).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type AnalyzeProductsInput = z.infer<typeof analyzeProductsSchema>;

export const decideSuggestionsSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(50),
  decision: z.enum(['accept', 'reject']),
});
export type DecideSuggestionsInput = z.infer<typeof decideSuggestionsSchema>;

// ---- Articles ------------------------------------------------------------
export const ARTICLE_STATUSES = [
  'draft',
  'writing',
  'ready',
  'publishing',
  'published',
  'failed',
] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const patchArticleSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    metaDescription: z.string().max(400).nullable(),
    contentHtml: z.string().max(500_000),
    /** Publicación programada (ISO); null la quita. */
    scheduledFor: z.string().datetime({ offset: true }).nullable(),
  })
  .partial();
export type PatchArticleInput = z.infer<typeof patchArticleSchema>;

export const articleQuerySchema = z.object({
  status: z.enum(ARTICLE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ArticleQuery = z.infer<typeof articleQuerySchema>;

/** Enviar a WordPress: publicar ya o dejar borrador. Sin `status`, según los ajustes del sitio. */
export const publishArticleSchema = z.object({ status: z.enum(['publish', 'draft']).optional() });
export type PublishArticleInput = z.infer<typeof publishArticleSchema>;

/** Webs sin publicación automática: el usuario pega la URL donde publicó el artículo a mano. */
export const markPublishedSchema = z.object({ url: z.string().trim().min(3).max(500) });
export type MarkPublishedInput = z.infer<typeof markPublishedSchema>;

// ---- Jobs ----------------------------------------------------------------
export const JOB_TYPES = [
  'discover',
  'seeds',
  'product-scan',
  'product-seo',
  'outline',
  'write',
  'publish',
  'brand-voice',
  'sync',
  'cluster',
  'backlink',
  'refresh',
  'ai-visibility',
  'watchdog',
  'schedule',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

// ---- Facturación -----------------------------------------------------------
export const checkoutSchema = z.object({ plan: z.enum(PAID_PLAN_IDS) });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// ---- Search Console --------------------------------------------------------
export const selectPropertySchema = z.object({ propertyUrl: z.string().trim().min(3).max(300) });
export type SelectPropertyInput = z.infer<typeof selectPropertySchema>;

export const googleCallbackSchema = z.object({
  state: z.string().min(10).max(2000),
  code: z.string().min(1).max(2000).optional(),
  error: z.string().max(200).optional(),
});

// ---- Público ----------------------------------------------------------------
export const demoSchema = z.object({ url: z.string().trim().min(4).max(300) });

// ---- Flujo editorial -------------------------------------------------------
export const reviewSchema = z.object({
  decision: z.enum(['approve', 'request_changes']),
  comment: z.string().trim().max(5000).optional(),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const calendarQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

// ---- Organización ----------------------------------------------------------
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(INVITABLE_ROLES),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const memberRoleSchema = z.object({ role: z.enum(INVITABLE_ROLES) });

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(10).max(200),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const brandingSchema = z.object({
  brandName: z.string().trim().max(100).nullable(),
  brandLogoUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https:\/\//, 'https')
    .nullable(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
});
export type BrandingInput = z.infer<typeof brandingSchema>;

export const reportQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
