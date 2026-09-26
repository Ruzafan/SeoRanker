import { CheckCircle2, CircleAlert, CircleX, ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { analyzeOnPage, type ArticleDto, type OnPageCheck } from '@seo/shared';
import { Card, cx } from './ui';

function message(c: OnPageCheck, keyword: string | null): string {
  const kw = keyword ? `«${keyword}»` : 'la keyword';
  switch (c.id) {
    case 'keyword_in_title':
      return c.level === 'good' ? `El título contiene ${kw}.` : `Añade ${kw} al título.`;
    case 'keyword_in_meta':
      return c.level === 'good'
        ? `La meta description contiene ${kw}.`
        : `Incluye ${kw} en la meta description: Google la resalta en negrita.`;
    case 'keyword_in_slug':
      return c.level === 'good' ? 'La URL contiene la keyword.' : 'La URL no contiene la keyword.';
    case 'keyword_in_intro':
      return c.level === 'good'
        ? 'La keyword aparece al principio.'
        : 'Menciona la keyword en el primer párrafo.';
    case 'keyword_in_h2':
      return c.level === 'good'
        ? 'Algún subtítulo (H2) usa la keyword.'
        : 'Usa la keyword (o una variante) en algún H2.';
    case 'keyword_density':
      return c.level === 'good'
        ? `Densidad de la keyword: ${c.value} %.`
        : c.value > 2.5
          ? `Densidad del ${c.value} %: parece forzada, reduce repeticiones.`
          : `Densidad del ${c.value} %: menciónala algo más.`;
    case 'title_length':
      return c.level === 'good'
        ? `Título de ${c.value} caracteres.`
        : c.value > 60
          ? `Título de ${c.value} caracteres: Google lo cortará (máx. ~60).`
          : `Título de ${c.value} caracteres: aprovecha hasta ~60.`;
    case 'meta_length':
      return c.value === 0
        ? 'Falta la meta description.'
        : c.level === 'good'
          ? `Meta description de ${c.value} caracteres.`
          : `Meta description de ${c.value} caracteres (ideal 120-155).`;
    case 'word_count':
      return `${c.value} palabras${c.level === 'good' ? '.' : ': por debajo del objetivo del sitio.'}`;
    case 'h2_count':
      return c.level === 'good'
        ? `${c.value} secciones (H2).`
        : 'Pocas secciones: estructura el texto con más H2.';
    case 'internal_links':
      return c.value === 0
        ? 'Sin enlaces internos: enlaza a productos o artículos relacionados.'
        : `${c.value} enlaces internos${c.level === 'good' ? '.' : ' (ideal 2-8).'}`;
    case 'faq_section':
      return c.level === 'good'
        ? 'Tiene preguntas frecuentes (se publican como datos estructurados).'
        : 'Añade una sección de preguntas frecuentes con H3.';
    case 'sentence_length':
      return c.level === 'good'
        ? `Frases de ${c.value} palabras de media: fácil de leer.`
        : `Frases de ${c.value} palabras de media: acórtalas.`;
  }
}

const ICON = { good: CheckCircle2, warn: CircleAlert, bad: CircleX } as const;
const TONE = {
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-red-600',
} as const;

export function OnPagePanel(props: {
  keyword: string | null;
  title: string;
  meta: string;
  slug: string;
  html: string;
  targetWords: number;
}) {
  const result = useMemo(
    () =>
      analyzeOnPage({
        keyword: props.keyword,
        title: props.title,
        metaDescription: props.meta,
        slug: props.slug,
        html: props.html,
        targetWords: props.targetWords,
      }),
    [props.keyword, props.title, props.meta, props.slug, props.html, props.targetWords],
  );
  const order = { bad: 0, warn: 1, good: 2 } as const;
  const checks = [...result.checks].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Análisis SEO</h2>
        <span
          className={cx(
            'rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums',
            result.score >= 80
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : result.score >= 55
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
          )}
          title="Puntuación on-page"
        >
          {result.score}/100
        </span>
      </div>
      {props.keyword && (
        <p className="mt-1 text-xs text-stone-500">Keyword objetivo: «{props.keyword}»</p>
      )}
      <ul className="mt-3 space-y-1.5 text-sm">
        {checks.map((c) => {
          const Icon = ICON[c.level];
          return (
            <li key={c.id} className="flex gap-2">
              <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', TONE[c.level])} />
              <span>{message(c, props.keyword)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function SerpPanel({ serp }: { serp: NonNullable<ArticleDto['serp']> }) {
  return (
    <Card>
      <h2 className="font-medium">Competencia en Google</h2>
      <p className="mt-1 text-xs text-stone-500">
        Lo que posicionaba al planificar el artículo. El esquema cubre sus temas comunes y añade lo
        que les falta.
      </p>
      <ol className="mt-3 space-y-1.5 text-sm">
        {serp.results.map((r) => (
          <li key={r.url} className="flex gap-2">
            <span className="w-5 shrink-0 text-right tabular-nums text-stone-500">
              {r.position}
            </span>
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer noopener"
              className="min-w-0 flex-1 truncate hover:underline"
              title={r.title}
            >
              {r.title}
            </a>
            {r.wordCount && (
              <span className="shrink-0 text-xs tabular-nums text-stone-500">
                {r.wordCount.toLocaleString('es-ES')} pal.
              </span>
            )}
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
          </li>
        ))}
      </ol>
      {serp.relatedQuestions.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-stone-500">
            La gente también pregunta
          </h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {serp.relatedQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
