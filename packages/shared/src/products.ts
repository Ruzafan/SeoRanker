/**
 * SEO de las fichas de producto: qué leemos de cada producto, qué le falta y qué se le puede
 * sugerir. Fuente única para el diagnóstico (backend) y sus etiquetas (panel).
 */

export type ProductSeoPlugin = 'yoast' | 'rankmath' | null;

/** Lo que el conector (1.3.0+) devuelve de cada producto. */
export interface ProductSnapshot {
  id: number;
  name: string;
  url: string;
  status: string;
  /** HTML de la descripción corta de WooCommerce. */
  shortDescription: string;
  /** Texto plano de la descripción larga (recortado): contexto para Claude, no se edita. */
  description: string;
  categories: string[];
  tags: string[];
  price: string | null;
  images: { id: number; url: string; alt: string }[];
  seoPlugin: ProductSeoPlugin;
  focusKeyword: string;
  seoTitle: string;
  metaDescription: string;
}

/** Campos que SeoRanker puede rellenar o mejorar. Las imágenes van como `image_alt:<id>`. */
export const PRODUCT_FIELDS = [
  'focus_keyword',
  'seo_title',
  'meta_description',
  'short_description',
  'tags',
] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number] | `image_alt:${number}`;

export const PRODUCT_ISSUES = [
  'NO_SEO_PLUGIN',
  'NO_FOCUS_KEYWORD',
  'NO_META_DESCRIPTION',
  'META_DESCRIPTION_LENGTH',
  'NO_SEO_TITLE',
  'SEO_TITLE_TOO_LONG',
  'NO_SHORT_DESCRIPTION',
  'IMAGES_WITHOUT_ALT',
  'FEW_TAGS',
  'THIN_DESCRIPTION',
] as const;
export type ProductIssue = (typeof PRODUCT_ISSUES)[number];

/** Peso de cada problema en la puntuación (100 = sin problemas). */
const ISSUE_WEIGHT: Record<ProductIssue, number> = {
  NO_SEO_PLUGIN: 10,
  NO_FOCUS_KEYWORD: 15,
  NO_META_DESCRIPTION: 20,
  META_DESCRIPTION_LENGTH: 8,
  NO_SEO_TITLE: 8,
  SEO_TITLE_TOO_LONG: 6,
  NO_SHORT_DESCRIPTION: 12,
  IMAGES_WITHOUT_ALT: 12,
  FEW_TAGS: 7,
  THIN_DESCRIPTION: 10,
};

export const META_DESCRIPTION_MIN = 70;
export const META_DESCRIPTION_MAX = 160;
export const SEO_TITLE_MAX = 60;
const MIN_TAGS = 2;
const THIN_WORDS = 50;

const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function diagnoseProduct(p: ProductSnapshot): { score: number; issues: ProductIssue[] } {
  const issues: ProductIssue[] = [];
  if (!p.seoPlugin) {
    issues.push('NO_SEO_PLUGIN');
  } else {
    if (!p.focusKeyword.trim()) issues.push('NO_FOCUS_KEYWORD');
    const meta = p.metaDescription.trim();
    if (!meta) issues.push('NO_META_DESCRIPTION');
    else if (meta.length < META_DESCRIPTION_MIN || meta.length > META_DESCRIPTION_MAX)
      issues.push('META_DESCRIPTION_LENGTH');
    const title = p.seoTitle.trim();
    if (!title) issues.push('NO_SEO_TITLE');
    else if (title.length > SEO_TITLE_MAX && !title.includes('%'))
      issues.push('SEO_TITLE_TOO_LONG');
  }
  if (!plain(p.shortDescription)) issues.push('NO_SHORT_DESCRIPTION');
  if (p.images.some((i) => !i.alt.trim())) issues.push('IMAGES_WITHOUT_ALT');
  if (p.tags.length < MIN_TAGS) issues.push('FEW_TAGS');
  if (plain(p.description).split(' ').filter(Boolean).length < THIN_WORDS)
    issues.push('THIN_DESCRIPTION');
  const score = Math.max(0, 100 - issues.reduce((s, i) => s + ISSUE_WEIGHT[i], 0));
  return { score, issues };
}

/** Texto plano de la descripción corta (para mostrar y comparar). */
export const plainText = plain;
