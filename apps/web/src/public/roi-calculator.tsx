import { useState } from 'react';
import { PAID_PLAN_IDS, PLANS, type PaidPlanId } from '@seo/shared';
import { SectionTitle } from '../components/public-layout';
import { inputClass } from '../components/ui';

const eur = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/** El plan más barato que cubre ese volumen mensual (en todas las tiendas). */
export function planFor(articles: number): PaidPlanId {
  return PAID_PLAN_IDS.find((id) => PLANS[id].articlesPerMonth >= articles) ?? 'agency';
}

/** Calculadora: lo que cuesta producir X artículos al mes frente al plan que los cubre. */
export function RoiCalculator() {
  const [articles, setArticles] = useState(20);
  const [costPerArticle, setCostPerArticle] = useState(50);
  const plan = PLANS[planFor(articles)];
  const manual = articles * costPerArticle;
  const saving = manual - plan.priceEur;

  return (
    <section className="py-20">
      <div className="mx-auto max-w-4xl px-4">
        <SectionTitle eyebrow="Calculadora" title="¿Cuánto te cuesta hoy cada artículo?">
          Pon cuántos artículos quieres al mes y lo que te cuesta cada uno (redactor, agencia o tu
          propio tiempo).
        </SectionTitle>
        <div className="grid gap-6 rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900 md:grid-cols-2">
          <div className="space-y-5">
            <label className="block text-sm font-medium">
              Artículos al mes: <span className="tabular-nums">{articles}</span>
              <input
                type="range"
                min={4}
                max={400}
                step={4}
                value={articles}
                onChange={(e) => setArticles(Number(e.target.value))}
                className="mt-2 w-full accent-teal-700"
              />
            </label>
            <label className="block text-sm font-medium">
              Coste actual por artículo (€)
              <input
                type="number"
                min={0}
                max={1000}
                className={`${inputClass} mt-1`}
                value={costPerArticle}
                onChange={(e) => setCostPerArticle(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>
          <div className="flex flex-col justify-center gap-3 rounded-xl bg-stone-50 p-5 dark:bg-stone-800/60">
            <p className="flex justify-between text-sm">
              <span>Producción actual</span>
              <span className="font-semibold tabular-nums">{eur.format(manual)}/mes</span>
            </p>
            <p className="flex justify-between text-sm">
              <span>SEO Autopilot {plan.name}</span>
              <span className="font-semibold tabular-nums">{eur.format(plan.priceEur)}/mes</span>
            </p>
            <p className="border-t border-stone-200 pt-3 text-lg dark:border-stone-700">
              {saving > 0 ? (
                <>
                  Ahorro:{' '}
                  <strong className="tabular-nums text-teal-700 dark:text-teal-400">
                    {eur.format(saving)}/mes
                  </strong>
                </>
              ) : (
                'Con este volumen, SEO Autopilot no te ahorra dinero: te ahorra tiempo.'
              )}
            </p>
            <p className="text-xs text-stone-500">
              Incluye la IA, la investigación de keywords y la publicación. No incluye tu tiempo de
              revisión, que recomendamos.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
