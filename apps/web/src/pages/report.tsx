import { Printer } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CONNECTOR_VERSION_VISITS,
  type MonthlyReportDto,
  type ReportArticleDto,
} from '@seo/shared';
import { Button, ErrorBanner, Spinner, inputClass } from '../components/ui';
import { useReport } from '../lib/hooks';
import { trafficChannelLabel } from '../lib/i18n';

const nf = new Intl.NumberFormat('es-ES');
const pct = (now: number, before: number) =>
  before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)} %` : '—';
const money = (n: number, c: string | null) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: c ?? 'EUR' }).format(n);

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Informe mensual para el cliente final. «Descargar PDF» usa la impresión del navegador. */
export function ReportPage() {
  const { siteId = '' } = useParams();
  const [month, setMonth] = useState(thisMonth);
  const { data, isLoading, error } = useReport(siteId, month);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">Informe mensual</h1>
        <input
          type="month"
          className={`${inputClass} w-auto`}
          value={month}
          max={thisMonth()}
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

      <TrafficSection r={r} color={color} />

      {r.revenue && (
        <section className="mt-4 rounded-xl p-4" style={{ background: `${color}14` }}>
          <p className="text-sm">
            Ventas cuya visita empezó en un artículo:{' '}
            <strong>{money(r.revenue.total, r.revenue.currency)}</strong> en {r.revenue.orders}{' '}
            pedidos.
          </p>
          {r.revenue.byChannel.length > 0 && (
            <p className="mt-1 text-xs text-stone-600">
              {r.revenue.byChannel
                .map(
                  (c) =>
                    `${c.channel ? trafficChannelLabel[c.channel] : 'Procedencia desconocida'}: ${money(c.total, r.revenue?.currency ?? null)} (${c.orders})`,
                )
                .join(' · ')}
            </p>
          )}
        </section>
      )}

      <section className="mt-8">
        <h3 className="font-semibold">Artículos publicados</h3>
        <p className="text-sm text-stone-500">
          {r.published.length} este mes · {r.articles.length} en total. Los datos son del mes.
        </p>
        {r.articles.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Aún no hay artículos publicados.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="py-1">Artículo</th>
                <th className="py-1">En Google</th>
                <th className="py-1 text-right">Visitas</th>
                {r.revenue && <th className="py-1 text-right">Ventas</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {r.articles.map((a) => (
                <ArticleRow
                  key={a.id}
                  a={a}
                  revenue={r.revenue !== null}
                  currency={r.revenue?.currency ?? null}
                  measured={r.traffic.measured}
                />
              ))}
            </tbody>
          </table>
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

function TrafficSection({ r, color }: { r: MonthlyReportDto; color: string }) {
  const t = r.traffic;
  if (!t.measured && t.total === 0) {
    return (
      <p className="mt-4 text-sm text-stone-500 print:hidden">
        Para saber de dónde llegan las visitas a los artículos (Google, ChatGPT y otros asistentes,
        redes…), actualiza el conector de WordPress a la v{CONNECTOR_VERSION_VISITS} desde Ajustes.
      </p>
    );
  }
  return (
    <section className="mt-8">
      <h3 className="font-semibold">De dónde llegan las visitas</h3>
      <p className="text-sm text-stone-500">
        {nf.format(t.total)} visitas entraron a la web por un artículo este mes.
      </p>
      {t.total > 0 && (
        <ul className="mt-2 space-y-1.5 text-sm">
          {t.byChannel.map((c) => (
            <li key={c.channel} className="flex items-center gap-3">
              <span className="w-36 shrink-0">{trafficChannelLabel[c.channel]}</span>
              <span className="h-2 flex-1 overflow-hidden rounded bg-stone-100">
                <span
                  className="block h-full rounded"
                  style={{ width: `${(c.visits / t.total) * 100}%`, background: color }}
                />
              </span>
              <span className="w-12 text-right tabular-nums">{nf.format(c.visits)}</span>
            </li>
          ))}
        </ul>
      )}
      {t.assistants.length > 0 && (
        <p className="mt-2 text-xs text-stone-600">
          Asistentes de IA:{' '}
          {t.assistants.map((a) => `${a.name} (${nf.format(a.visits)})`).join(' · ')}
        </p>
      )}
    </section>
  );
}

function ArticleRow({
  a,
  revenue,
  currency,
  measured,
}: {
  a: ReportArticleDto;
  revenue: boolean;
  currency: string | null;
  measured: boolean;
}) {
  const g = a.google;
  return (
    <tr className="align-top">
      <td className="py-1.5 pr-3">
        {a.url ? (
          <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline">
            {a.title}
          </a>
        ) : (
          a.title
        )}
        <span className="block text-xs text-stone-500">
          {new Date(a.publishedAt).toLocaleDateString('es-ES')}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-xs">
        {!g ? (
          <span className="text-stone-400">Sin Search Console</span>
        ) : g.impressions === 0 ? (
          <span className="text-stone-500">Aún no aparece</span>
        ) : (
          <>
            {nf.format(g.impressions)} impresiones · {nf.format(g.clicks)} clics
            {g.position !== null && (
              <span className="block text-stone-500">posición {g.position.toFixed(1)}</span>
            )}
          </>
        )}
      </td>
      <td className="py-1.5 text-right text-xs tabular-nums">
        {!measured && a.visits === 0 ? (
          <span className="text-stone-400">—</span>
        ) : (
          <>
            <span className="text-sm">{nf.format(a.visits)}</span>
            {a.visitsByChannel.length > 0 && (
              <span className="block text-stone-500">
                {a.visitsByChannel
                  .slice(0, 3)
                  .map((c) => `${trafficChannelLabel[c.channel]} ${nf.format(c.visits)}`)
                  .join(' · ')}
              </span>
            )}
          </>
        )}
      </td>
      {revenue && (
        <td className="py-1.5 text-right text-xs tabular-nums">
          {a.orders ? `${money(a.revenue, currency)} (${a.orders})` : '—'}
        </td>
      )}
    </tr>
  );
}
