import { PLAN_IDS, PLANS } from '@seo/shared';
import { COMPARISONS, LANDING_FAQS, VERTICALS } from './content';

/** Páginas públicas que se prerenderizan (HTML indexable) y entran en el sitemap. */
export interface PublicPage {
  path: string;
  title: string;
  description: string;
  /** JSON-LD específico de la página. */
  jsonLd?: Record<string, unknown>[];
}

const faqLd = (faqs: { q: string; a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
});

export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: '/',
    title: 'SEO Autopilot · Artículos SEO automáticos para tu tienda WooCommerce',
    description:
      'Descubre qué busca tu cliente, genera artículos con la voz de tu marca y publícalos en WordPress con Yoast o Rank Math. Mide clics y ventas por artículo.',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'SEO Autopilot',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description:
          'Generación y publicación automática de artículos SEO para tiendas WordPress/WooCommerce.',
        offers: PLAN_IDS.map((id) => ({
          '@type': 'Offer',
          name: PLANS[id].name,
          price: PLANS[id].priceEur,
          priceCurrency: 'EUR',
        })),
      },
      faqLd(LANDING_FAQS),
    ],
  },
  {
    path: '/ejemplo',
    title: 'Ejemplo de artículo SEO para una tienda online · SEO Autopilot',
    description:
      'Así es un artículo de SEO Autopilot: estructura basada en la SERP, tabla comparativa, recomendación de producto y preguntas frecuentes con datos estructurados.',
  },
  ...COMPARISONS.map((c) => ({
    path: `/comparativa/${c.slug}`,
    title: `${c.title} · SEO Autopilot`,
    description: c.description,
  })),
  ...VERTICALS.map((v) => ({
    path: `/tiendas/${v.slug}`,
    title: `${v.title} · SEO Autopilot`,
    description: v.description,
  })),
];
