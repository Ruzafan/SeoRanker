import { z } from 'zod';

export const CADENCES = ['off', 'daily', 'weekly'] as const;
export type Cadence = (typeof CADENCES)[number];

/** Settings completos de un sitio tal y como se guardan en Site.settings. Sin defaults: ver DEFAULT_SETTINGS. */
export const siteSettingsSchema = z.object({
  seeds: z.array(z.string().trim().min(2).max(100)).max(50),
  wordCount: z.number().int().min(300).max(3000),
  cadence: z.enum(CADENCES),
  autoPublish: z.boolean(),
  categoryId: z.number().int().positive().nullable(),
  model: z.string().trim().min(1).max(100).nullable(),
  /** null = aún no sabemos; false = Yoast no expone su meta por REST. Lo rellena el sistema. */
  yoastMetaExposed: z.boolean().nullable(),
  lastDiscoverAt: z.string().nullable(),
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const DEFAULT_SETTINGS: SiteSettings = {
  seeds: [],
  wordCount: 1200,
  cadence: 'off',
  autoPublish: false,
  categoryId: null,
  model: null,
  yoastMetaExposed: null,
  lastDiscoverAt: null,
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
