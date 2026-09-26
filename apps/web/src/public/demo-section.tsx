import { useMutation } from '@tanstack/react-query';
import { HelpCircle, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { DemoResultDto } from '@seo/shared';
import { PrimaryCta, SectionTitle } from '../components/public-layout';
import { Badge, Button, ErrorBanner, inputClass, cx } from '../components/ui';
import { api } from '../lib/api';

const PLATFORM_LABEL: Record<DemoResultDto['platform'], string> = {
  woocommerce: 'WooCommerce',
  wordpress: 'WordPress',
  unknown: 'Web',
};

/** Demo sin registro: la URL de la tienda → lo que sus clientes buscan en Google. */
export function DemoSection() {
  const [url, setUrl] = useState('');
  const demo = useMutation({
    mutationFn: (u: string) => api.post<DemoResultDto>('/public/demo', { url: u }),
  });
  const r = demo.data;

  return (
    <section
      id="demo"
      className="scroll-mt-16 border-y border-stone-200 bg-white py-20 dark:border-stone-800 dark:bg-stone-900/40"
    >
      <div className="mx-auto max-w-3xl px-4">
        <SectionTitle eyebrow="Pruébalo ahora" title="¿Qué buscan tus clientes en Google?">
          Escribe la dirección de tu tienda. Leemos sus categorías y te enseñamos búsquedas reales
          sobre las que podrías escribir. Sin registrarte.
        </SectionTitle>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) demo.mutate(url.trim());
          }}
        >
          <label className="sr-only" htmlFor="demo-url">
            URL de tu tienda
          </label>
          <input
            id="demo-url"
            className={cx(inputClass, 'py-3 text-base')}
            placeholder="tutienda.com"
            inputMode="url"
            autoComplete="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button size="lg" icon={Search} loading={demo.isPending} type="submit">
            Analizar
          </Button>
        </form>
        <p className="mt-2 text-xs text-stone-500">
          Tarda unos segundos. Solo leemos información pública de tu web.
        </p>
        {demo.error && <ErrorBanner error={demo.error} className="mt-4" />}

        {r && (
          <div className="mt-8 rounded-2xl border border-stone-200 p-5 dark:border-stone-800">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{r.siteName ?? new URL(r.url).hostname}</p>
              <Badge>{PLATFORM_LABEL[r.platform]}</Badge>
              {r.topics.map((t) => (
                <Badge key={t} tone="blue">
                  {t}
                </Badge>
              ))}
            </div>
            {r.keywords.length === 0 ? (
              <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">
                Google no devolvió sugerencias para estos temas. Con tu cuenta, además del
                autocompletado usamos las preguntas relacionadas y tu Search Console.
              </p>
            ) : (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {r.keywords.map((k) => (
                  <li
                    key={k.term}
                    className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm dark:bg-stone-800/60"
                  >
                    {k.question ? (
                      <HelpCircle className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" />
                    ) : (
                      <Search className="h-4 w-4 shrink-0 text-stone-400" />
                    )}
                    <span className="min-w-0 flex-1">{k.term}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-teal-50 p-4 dark:bg-teal-950/40">
              <Sparkles className="h-5 w-5 shrink-0 text-teal-700 dark:text-teal-400" />
              <p className="min-w-0 flex-1 text-sm">
                Cada una de estas búsquedas puede ser un artículo en tu blog. Conecta tu tienda y el
                primero estará escrito en minutos.
              </p>
              <PrimaryCta>Escribir el primero gratis</PrimaryCta>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
