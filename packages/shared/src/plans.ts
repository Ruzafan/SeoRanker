/**
 * Planes y plataformas: fuente única para backend (límites), panel y landing.
 * Precios orientativos para la landing; el cobro (Stripe) aún no existe.
 */
export const PLAN_IDS = ['free', 'pro', 'agency'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDef {
  id: PlanId;
  name: string;
  /** EUR/mes. null = a medida. */
  priceEur: number | null;
  /** null = sin tope. */
  maxSites: number | null;
  /** null = sin tope. En free lo fija FREE_PLAN_MAX_ARTICLES (ver articlesPerMonthFor). */
  articlesPerMonth: number | null;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    name: 'Free',
    priceEur: 0,
    maxSites: 1,
    articlesPerMonth: 10,
    features: ['1 tienda', 'Keywords automáticas', 'Borradores en tu CMS'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceEur: 49,
    maxSites: 5,
    articlesPerMonth: 100,
    features: ['Hasta 5 tiendas', 'Publicación automática', 'Voz de marca por tienda'],
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    priceEur: null,
    maxSites: null,
    articlesPerMonth: null,
    features: ['Tiendas ilimitadas', 'Artículos sin tope', 'Soporte prioritario'],
  },
};

/** Un plan desconocido en BD se trata como free (lo más restrictivo). */
export function planFor(plan: string): PlanDef {
  return (PLAN_IDS as readonly string[]).includes(plan) ? PLANS[plan as PlanId] : PLANS.free;
}

/** Tope mensual de artículos; el de free es configurable por entorno. */
export function articlesPerMonthFor(plan: string, freePlanMaxArticles: number): number | null {
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
