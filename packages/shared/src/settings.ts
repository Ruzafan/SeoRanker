import { z } from 'zod';

export const CADENCES = ['off', 'daily', 'weekly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const SEO_PLUGINS = ['yoast', 'rankmath'] as const;
export type SeoPlugin = (typeof SEO_PLUGINS)[number];

/** Versión del plugin de WordPress que distribuye el panel (apps/wp-plugin). */
export const CONNECTOR_VERSION = '1.1.0';

/** true si la versión `a` (x.y.z) es anterior a `b`. Lo no numérico cuenta como 0. */
export function isOlderVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** Settings completos de un sitio tal y como se guardan en Site.settings. Sin defaults: ver DEFAULT_SETTINGS. */
export const siteSettingsSchema = z.object({
  seeds: z.array(z.string().trim().min(2).max(100)).max(50),
  wordCount: z.number().int().min(300).max(3000),
  cadence: z.enum(CADENCES),
  autoPublish: z.boolean(),
  categoryId: z.number().int().positive().nullable(),
  model: z.string().trim().min(1).max(100).nullable(),
  /**
   * Experiencia real del negocio (años, especialidad, garantías, lo que ven con sus clientes).
   * Se usa como fuente de primera mano en los artículos (E-E-A-T); nunca se inventa más.
   */
  expertise: z.string().trim().max(3000).nullable(),
  /** Usuario de WordPress que firma los artículos. null = el de la contraseña de aplicación. */
  authorId: z.number().int().positive().nullable(),
  /** Recomendar productos de la tienda (WooCommerce) dentro de los artículos. */
  productCards: z.boolean(),
  /** Al publicarse un artículo, enlazarlo desde artículos antiguos relacionados. */
  autoBacklinks: z.boolean(),
  /** null = aún no sabemos; false = Yoast no expone su meta por REST. Lo rellena el sistema. */
  yoastMetaExposed: z.boolean().nullable(),
  /** Plugin SEO detectado (Yoast o Rank Math). Lo rellena el sistema al probar la conexión. */
  seoPlugin: z.enum(SEO_PLUGINS).nullable(),
  /** Versión del conector instalada en WordPress; null = no instalado o sin comprobar. */
  connectorVersion: z.string().max(20).nullable(),
  woocommerce: z.boolean().nullable(),
  lastDiscoverAt: z.string().nullable(),
  /** Alta guiada: 'pending' hasta que el primer discover lanza el primer artículo. */
  onboarding: z.enum(['pending', 'done']).nullable(),
  /** Cursor de la sincronización de pedidos de WooCommerce (ISO). */
  ordersSyncedAt: z.string().nullable(),
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const DEFAULT_SETTINGS: SiteSettings = {
  seeds: [],
  wordCount: 1200,
  cadence: 'off',
  autoPublish: false,
  categoryId: null,
  model: null,
  expertise: null,
  authorId: null,
  productCards: true,
  autoBacklinks: true,
  yoastMetaExposed: null,
  seoPlugin: null,
  connectorVersion: null,
  woocommerce: null,
  lastDiscoverAt: null,
  onboarding: null,
  ordersSyncedAt: null,
};

/** Campos que puede editar el usuario (el resto los gestiona el sistema). */
export const editableSettingsSchema = siteSettingsSchema
  .pick({
    seeds: true,
    wordCount: true,
    cadence: true,
    autoPublish: true,
    categoryId: true,
    model: true,
    expertise: true,
    authorId: true,
    productCards: true,
    autoBacklinks: true,
  })
  .partial();

export type EditableSettings = z.infer<typeof editableSettingsSchema>;

/** Lee Site.settings (JSON arbitrario) y devuelve settings válidos; lo inválido cae al default. */
export function parseSettings(raw: unknown): SiteSettings {
  const base = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const merged = { ...DEFAULT_SETTINGS, ...base };
  const result = siteSettingsSchema.safeParse(merged);
  if (result.success) return result.data;
  // Campo a campo: conserva lo válido, descarta lo roto.
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SiteSettings)[]) {
    const field = siteSettingsSchema.shape[key].safeParse(base[key]);
    if (field.success) out[key] = field.data;
  }
  return out as SiteSettings;
}
