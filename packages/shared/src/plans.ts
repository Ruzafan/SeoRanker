/**
 * Planes y plataformas: fuente única para backend (límites), panel y landing.
 * El cobro lo gestiona Stripe (ver packages/core/src/services/billing.ts); aquí solo los límites.
 */
export const PLAN_IDS = ['free', 'starter', 'pro', 'agency'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const PAID_PLAN_IDS = ['starter', 'pro', 'agency'] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export interface PlanDef {
  id: PlanId;
  name: string;
  /** EUR/mes (IVA no incluido). */
  priceEur: number;
  /** null = sin tope. */
  maxSites: number | null;
  /** En free lo fija FREE_PLAN_MAX_ARTICLES (ver articlesPerMonthFor). */
  articlesPerMonth: number;
  /** Usuarios de la organización (incluido el propietario). null = sin tope. */
  maxMembers: number | null;
  /** Informes sin la marca SEO Autopilot, con el logo y color de la agencia. */
  whiteLabel: boolean;
  /** Seguimiento de visibilidad en asistentes de IA (ChatGPT, Perplexity…). */
  aiVisibility: boolean;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    name: 'Free',
    priceEur: 0,
    maxSites: 1,
    articlesPerMonth: 3,
    maxMembers: 1,
    whiteLabel: false,
    aiVisibility: false,
    features: [
      '1 tienda',
      '3 artículos para probar',
      'Keywords automáticas',
      'Borradores en tu CMS',
    ],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceEur: 19,
    maxSites: 1,
    articlesPerMonth: 20,
    maxMembers: 2,
    whiteLabel: false,
    aiVisibility: false,
    features: [
      '1 tienda',
      '20 artículos al mes',
      'Search Console: clics y posiciones',
      'Publicación automática',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceEur: 49,
    maxSites: 5,
    articlesPerMonth: 100,
    maxMembers: 5,
    whiteLabel: false,
    aiVisibility: true,
    features: [
      'Hasta 5 tiendas',
      '100 artículos al mes',
      'Ventas atribuidas en WooCommerce',
      'Refresco de contenido y clusters',
      'Visibilidad en IA',
    ],
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    priceEur: 149,
    maxSites: 25,
    articlesPerMonth: 400,
    maxMembers: null,
    whiteLabel: true,
    aiVisibility: true,
    features: [
      'Hasta 25 tiendas',
      '400 artículos al mes',
      'Informes marca blanca',
      'Aprobación de clientes',
      'Usuarios ilimitados',
    ],
  },
};

export function isPlanId(plan: string): plan is PlanId {
  return (PLAN_IDS as readonly string[]).includes(plan);
}

export function isPaidPlanId(plan: string): plan is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(plan);
}

/** Un plan desconocido en BD se trata como free (lo más restrictivo). */
export function planFor(plan: string): PlanDef {
  return isPlanId(plan) ? PLANS[plan] : PLANS.free;
}

/** Tope mensual de artículos (por organización); el de free es configurable por entorno. */
export function articlesPerMonthFor(plan: string, freePlanMaxArticles: number): number {
  const def = planFor(plan);
  return def.id === 'free' ? freePlanMaxArticles : def.articlesPerMonth;
}

export const PLATFORM_IDS = ['wordpress', 'shopify'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const PLATFORMS: Record<PlatformId, { id: PlatformId; name: string; available: boolean }> = {
  wordpress: { id: 'wordpress', name: 'WordPress / WooCommerce', available: true },
  shopify: { id: 'shopify', name: 'Shopify', available: false },
};

export const AVAILABLE_PLATFORMS = PLATFORM_IDS.filter((p) => PLATFORMS[p].available);
