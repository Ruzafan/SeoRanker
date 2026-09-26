import type { FaqItem } from '../html.js';

export interface SchemaInput {
  title: string;
  description: string | null;
  url: string | null;
  faq: FaqItem[];
  siteName: string;
  siteUrl: string;
  language: string;
  /** Yoast y Rank Math ya emiten Article/BlogPosting: duplicarlo confunde a Google. */
  includeArticle: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
}

/**
 * JSON-LD del artículo (lo imprime el conector en el <head>): FAQPage con las preguntas visibles
 * y, sin plugin SEO, un Article básico. undefined si no hay nada que aportar.
 */
export function buildArticleSchema(input: SchemaInput): string | undefined {
  const graph: Record<string, unknown>[] = [];
  if (input.faq.length >= 2) {
    graph.push({
      '@type': 'FAQPage',
      ...(input.url ? { '@id': `${input.url}#faq` } : {}),
      mainEntity: input.faq.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    });
  }
  if (input.includeArticle) {
    graph.push({
      '@type': 'Article',
      headline: input.title.slice(0, 110),
      ...(input.description ? { description: input.description } : {}),
      ...(input.url ? { mainEntityOfPage: input.url, url: input.url } : {}),
      inLanguage: input.language,
      ...(input.publishedAt ? { datePublished: input.publishedAt.toISOString() } : {}),
      dateModified: input.updatedAt.toISOString(),
      publisher: { '@type': 'Organization', name: input.siteName, url: input.siteUrl },
    });
  }
  if (!graph.length) return undefined;
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}
