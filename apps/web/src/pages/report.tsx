import { Printer } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { MonthlyReportDto } from '@seo/shared';
import { Button, ErrorBanner, Spinner, inputClass } from '../components/ui';
import { useReport } from '../lib/hooks';

const nf = new Intl.NumberFormat('es-ES');
const pct = (now: number, before: number) =>
  before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)} %` : '—';
const money = (n: number, c: string | null) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: c ?? 'EUR' }).format(n);

function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Informe mensual para el cliente final. «Descargar PDF» usa la impresión del navegador. */
export function ReportPage() {
  const { siteId = '' } = useParams();
  const [month, setMonth] = useState(lastMonth);
  const { data, isLoading, error } = useReport(siteId, month);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">Informe mensual</h1>
        <input
          type="month"
          className={`${inputClass} w-auto`}
          value={month}
          max={new Date().toISOString().slice(0, 7)}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
        <Button icon={Printer} onClick={() => window.print()} disabled={!data}>
          Descargar PDF
        </Button>
      </div>
      {isLoading && <Spinner />}
      <ErrorBanner error={error} />
      {data && <Report r={data} />}
    </>
  );
}

function Report({ r }: { r: MonthlyReportDto }) {
  const b = r.branding;
  const brand = b.whiteLabel && b.brandName ? b.brandName : 'SEO Autopilot';
  const color = (b.whiteLabel && b.brandColor) || '#0f766e';
  const monthName = new Date(`${r.month}-01T12:00:00`).toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
  });
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-8 text-stone-900 print:border-0 print:p-0 dark:border-stone-800">
      <header
        className="flex items-center justify-between border-b pb-4"
        style={{ borderColor: color }}
      >
        <div>
          <p className="text-sm uppercase tracking-wide" style={{ color }}>
            Informe SEO · <span className="capitalize">{monthName}</span>
          </p>
          <h2 className="text-2xl font-semibold">{r.site.name}</h2>
          <p className="text-sm text-stone-500">{r.site.url}</p>
        </div>
        {b.whiteLabel && b.brandLogoUrl ? (
          <img src={b.brandLogoUrl} alt={brand} className="max-h-12 max-w-[10rem] object-contain" />
        ) : (
          <p className="font-semibold" style={{ color }}>
            {brand}
          </p>
        )}
      </header>

      <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Artículos publicados" value={nf.format(r.published.length)} />
        {r.search ? (
          <>
            <Stat
              label="Clics desde Google"
              value={nf.format(r.search.clicks)}
              sub={`${pct(r.search.clicks, r.search.previousClicks)} vs mes anterior`}
            />
            <Stat
              label="Impresiones"
              value={nf.format(r.search.impressions)}
              sub={`${pct(r.search.impressions, r.search.previousImpressions)} vs mes anterior`}
            />
            <Stat
              label="Posición media"
              value={r.search.position === null ? '—' : r.search.position.toFixed(1)}
            />
          </>
        ) : (
          <p className="col-span-3 self-center text-sm text-stone-500">
            Conecta Search Console para incluir clics e impresiones.
          </p>
        )}
      </section>

      {r.revenue && (
        <section className="mt-4 rounded-xl p-4" style={{ background: `${color}14` }}>
          <p className="text-sm">
            Ventas cuya visita empezó en un artículo:{' '}
            <strong>{money(r.revenue.total, r.revenue.currency)}</strong> en {r.revenue.orders}{' '}
            pedidos.
          </p>
        </section>
      )}

      {r.topArticles.length > 0 && (
        <section className="mt-8">
          <h3 className="font-semibold">Artículos con más clics</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="py-1">Artículo</th>
                <th className="py-1 text-right">Clics</th>
                <th className="py-1 text-right">Impresiones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {r.topArticles.map((a) => (
                <tr key={a.title}>
                  <td className="py-1.5">{a.title}</td>
                  <td className="py-1.5 text-right tabular-nums">{nf.format(a.clicks)}</td>
                  <td className="py-1.5 text-right tabular-nums">{nf.format(a.impressions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-8">
        <h3 className="font-semibold">Publicado este mes</h3>
        {r.published.length === 0 ? (
          <p className="mt-1 text-sm text-stone-500">Ningún artículo publicado.</p>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {r.published.map((p) => (
              <li key={p.id}>
                {p.title}{' '}
                <span className="text-stone-500">
                  · {new Date(p.publishedAt).toLocaleDateString('es-ES')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {r.refreshed > 0 && (
          <p className="mt-2 text-sm">
            Además, {r.refreshed} artículos se actualizaron para recuperar posiciones.
          </p>
        )}
      </section>

      {r.opportunities.length > 0 && (
        <section className="mt-8">
          <h3 className="font-semibold">Próximas oportunidades</h3>
          <p className="text-sm text-stone-500">
            Búsquedas en las que la tienda ya aparece y que atacaremos a continuación.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {r.opportunities.map((o) => (
              <li key={o.term}>
                {o.term}{' '}
                <span className="text-stone-500">
                  · {nf.format(o.impressions)} impresiones
                  {o.position ? `, posición ${o.position.toFixed(1)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!b.whiteLabel && (
        <p className="mt-10 text-center text-xs text-stone-400">Generado con SEO Autopilot</p>
      )}
    </article>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 p-3">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-stone-500">{sub}</p>}
    </div>
  );
}
