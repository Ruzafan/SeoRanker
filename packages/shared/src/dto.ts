import type { ArticleStatus, JobType, KeywordStatus } from './schemas.js';
import type { SeoPlugin, SiteSettings } from './settings.js';
import type { WarningCode } from './errors.js';

/** Todas las fechas viajan como ISO string. Nunca se incluye `credentials`. */
export interface UserDto {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string;
  plan: string;
  isAdmin: boolean;
}

export interface SiteDto {
  id: string;
  name: string;
  url: string;
  platform: string;
  language: string;
  country: string;
  brandVoice: string | null;
  settings: SiteSettings;
  hasCredentials: boolean;
  active: boolean;
  createdAt: string;
}

export interface KeywordDto {
  id: string;
  siteId: string;
  term: string;
  source: string;
  intent: string | null;
  score: number;
  status: KeywordStatus;
  seedTerm: string | null;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  gscImpressions: number | null;
  gscClicks: number | null;
  gscPosition: number | null;
  createdAt: string;
}

export interface ArticleSummaryDto {
  id: string;
  siteId: string;
  keywordId: string | null;
  title: string;
  slug: string;
  status: ArticleStatus;
  wordCount: number;
  remoteUrl: string | null;
  /** Estado del post en WordPress (draft, publish…) según la última sincronización. */
  remoteStatus: string | null;
  /** Fecha en que se detectó que pierde clics en Google; null si no. */
  decayDetectedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface OutlineSection {
  heading: string;
  points: string[];
}

export interface ArticleDto extends ArticleSummaryDto {
  metaDescription: string | null;
  contentHtml: string | null;
  outline: {
    title: string;
    slug: string;
    metaDescription: string;
    sections: OutlineSection[];
    faq: { question: string; answer: string }[];
  } | null;
  remotePostId: number | null;
  /** Keyword objetivo (para el análisis on-page). */
  keyword: string | null;
  featuredMediaId: number | null;
  /** Lo que posicionaba en Google al planificarlo (null si no había SerpAPI). */
  serp: {
    fetchedAt: string;
    results: { position: number; title: string; url: string; wordCount: number | null }[];
    relatedQuestions: string[];
  } | null;
}

export interface JobRunDto {
  id: string;
  siteId: string;
  type: JobType;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  refId: string | null;
  attempt: number;
  error: string | null;
  meta: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UsageDto {
  period: string;
  /** Artículos de ESTA tienda este mes. */
  articles: number;
  /** Artículos de toda la organización este mes: es lo que cuenta para el tope del plan. */
  organizationArticles: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  plan: string;
  /** Tope mensual de la organización. */
  articlesLimit: number;
  history: { period: string; articles: number; costCents: number }[];
}

export interface SiteStatsDto {
  publishedThisMonth: number;
  pendingKeywords: number;
  inProgress: number;
  usage: UsageDto;
  recentJobs: JobRunDto[];
}

/** Resumen de todas las tiendas de la organización (página /sites). */
export interface SitesOverviewDto {
  plan: {
    id: string;
    name: string;
    maxSites: number | null;
    /** Tope mensual de artículos de la organización (todas las tiendas). */
    articlesPerMonth: number;
  };
  sitesCount: number;
  /** Artículos generados este mes por toda la organización. */
  articlesThisMonth: number;
  sites: SiteOverviewItem[];
}

export interface SiteOverviewItem {
  siteId: string;
  publishedThisMonth: number;
  pendingKeywords: number;
  inProgress: number;
  /** Artículos generados este mes (cuenta para la cuota). */
  articlesThisMonth: number;
  costCents: number;
  /** Último trabajo fallido de las últimas 24 h; null si no hay. */
  lastFailure: { type: string; error: string | null; at: string } | null;
}

/** Lo que se detecta del WordPress al probar la conexión. null = no se pudo averiguar. */
export interface ConnectionDetails {
  yoastActive: boolean | null;
  rankMathActive: boolean | null;
  seoPlugin: SeoPlugin | null;
  /** Los campos del plugin SEO se pueden escribir por REST (conector o snippet instalados). */
  yoastMetaExposed: boolean | null;
  /** Versión del plugin SEO Autopilot Connector; null si no está instalado. */
  connectorVersion: string | null;
  woocommerce: boolean | null;
  siteName?: string;
}

export interface ConnectionTestDto {
  ok: boolean;
  /** Código (WP_AUTH_FAILED, CONNECTION_FAILED…) o "OK". Nunca texto localizado. */
  message: string;
  details?: ConnectionDetails;
  warnings: WarningCode[];
}

/** Respuesta 202 de las acciones que encolan trabajo. */
export interface EnqueuedDto {
  jobRunId: string;
}

export interface BatchResultDto {
  processed: number;
  skipped: number;
}

export interface OrganizationAdminDto {
  id: string;
  name: string;
  plan: string;
  createdAt: string;
  users: { id: string; email: string; role: string }[];
  sites: {
    id: string;
    name: string;
    url: string;
    active: boolean;
    articles: number;
    keywords: number;
  }[];
}

/** Estado de facturación de la organización (página /billing). */
export interface BillingDto {
  /** false si el servidor no tiene Stripe configurado: el panel oculta los botones de pago. */
  configured: boolean;
  plan: string;
  /** Estado de la suscripción en Stripe (active, past_due, canceled…); null si nunca pagó. */
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Hay cliente en Stripe: se puede abrir el portal (facturas, tarjeta, cancelar). */
  hasCustomer: boolean;
  /** Solo el propietario gestiona la facturación. */
  canManage: boolean;
  usage: {
    articles: number;
    articlesLimit: number;
    sites: number;
    maxSites: number | null;
    members: number;
    maxMembers: number | null;
  };
}

/** url = página de Stripe a la que redirigir; null si el cambio de plan se aplicó directamente. */
export interface CheckoutResultDto {
  url: string | null;
}

/** Search Console de un sitio. Nunca incluye tokens. */
export interface SearchConsoleStatusDto {
  /** El servidor tiene cliente OAuth de Google configurado. */
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
  propertyUrl: string | null;
  lastSyncAt: string | null;
  /** Código de error de la última sincronización (GOOGLE_AUTH_FAILED…). */
  lastError: string | null;
}

export interface SearchConsolePropertyDto {
  siteUrl: string;
  permissionLevel: string;
}

export interface ArticlePerformanceDto {
  articleId: string;
  title: string;
  remoteUrl: string | null;
  remoteStatus: string | null;
  clicks: number;
  impressions: number;
  /** Posición media ponderada por impresiones; null sin impresiones. */
  position: number | null;
  previousClicks: number;
  revenue: number;
  orders: number;
  decaying: boolean;
}

export interface OpportunityDto {
  keywordId: string;
  term: string;
  impressions: number;
  clicks: number;
  position: number | null;
  score: number;
  status: string;
}

/** Rendimiento real en Google y ventas atribuidas (página /sites/:id/performance). */
export interface PerformanceDto {
  searchConsole: SearchConsoleStatusDto;
  /** Ventana de 28 días que termina en el último día con datos. null si aún no hay datos. */
  period: { from: string; to: string } | null;
  totals: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number | null;
    previousClicks: number;
    previousImpressions: number;
    revenue: number;
    orders: number;
    currency: string | null;
  };
  /** Últimos 90 días, un punto por día con datos. */
  daily: { date: string; clicks: number; impressions: number }[];
  articles: ArticlePerformanceDto[];
  opportunities: OpportunityDto[];
  /** El plan incluye ventas atribuidas. */
  revenueEnabled: boolean;
}
