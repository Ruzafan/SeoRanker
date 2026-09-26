import {
  ArrowDownRight,
  ArrowUpRight,
  LineChart as LineChartIcon,
  Link2,
  RefreshCw,
  Sparkles,
  Unplug,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { PerformanceDto, SearchConsoleStatusDto } from '@seo/shared';
import { AiVisibilityCard } from '../components/ai-visibility-card';
import { LineChart, SERIES_TONES } from '../components/charts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Notice,
  PageHeader,
  Spinner,
  cx,
  inputClass,
} from '../components/ui';
import { formatDate } from '../lib/format';
import {
  useConnectSearchConsole,
  useDisconnectSearchConsole,
  useGenerate,
  usePerformance,
  useSearchConsoleProperties,
  useSelectProperty,
  useSyncSite,
  withToast,
} from '../lib/hooks';
import { errorMessages } from '../lib/i18n';

const nf = new Intl.NumberFormat('es-ES');
const pct = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 1 });
const money = (n: number, currency: string | null) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency ?? 'EUR' }).format(n);
const pos = (p: number | null) => (p === null ? '—' : p.toFixed(1).replace('.', ','));

function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0) return null;
  const d = (now - before) / before;
  const up = d >= 0;
  return (
    <span
      className={cx(
        'inline-flex items-center text-xs font-medium',
        up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400',
      )}
    >
      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {pct.format(Math.abs(d))}
    </span>
  );
}

function Kpi({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-2 text-2xl font-semibold tabular-nums">
        {value} {extra}
      </p>
    </Card>
  );
}

export function PerformancePage() {
  const { siteId = '' } = useParams();
  const { data, isLoading, error } = usePerformance(siteId);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (params.get('gsc') === 'connected') {
      toast.success('Search Console conectado. Importando datos de los últimos 90 días…');
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBanner error={error} />;

  return (
    <>
      <PageHeader
        title="Rendimiento"
        description="Clics y posiciones reales en Google (Search Console) y ventas que empezaron en tus artículos."
      />
      <SearchConsoleCard siteId={siteId} status={data.searchConsole} />
      {data.searchConsole.connected && <Results siteId={siteId} data={data} />}
      <AiVisibilityCard siteId={siteId} />
    </>
  );
}

function SearchConsoleCard({ siteId, status }: { siteId: string; status: SearchConsoleStatusDto }) {
  const connect = useConnectSearchConsole(siteId);
  const disconnect = useDisconnectSearchConsole(siteId);
  const sync = useSyncSite(siteId);
  const properties = useSearchConsoleProperties(siteId, status.connected && !status.propertyUrl);
  const select = useSelectProperty(siteId);

  if (!status.configured) {
    return (
      <Notice tone="blue" title="La conexión con Google no está activada en este servidor">
        El administrador debe configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.
      </Notice>
    );
  }
  if (!status.connected) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="Conecta Google Search Console"
        action={
          <Button
            icon={Link2}
            loading={connect.isPending}
            onClick={() => void withToast(connect.mutateAsync())}
          >
            Conectar con Google
          </Button>
        }
      >
        Verás los clics, impresiones y posición de cada artículo, cuáles pierden tráfico y qué
        búsquedas están a un paso de la primera página. Acceso de solo lectura.
      </EmptyState>
    );
  }
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="font-medium">
            Search Console{' '}
            {status.propertyUrl ? (
              <Badge tone="green">{status.propertyUrl}</Badge>
            ) : (
              <Badge tone="amber">Elige una propiedad</Badge>
            )}
          </p>
          <p className="text-stone-500">
            {status.googleEmail ?? 'Cuenta de Google'} ·{' '}
            {status.lastSyncAt
              ? `sincronizado ${formatDate(status.lastSyncAt)}`
              : 'pendiente de la primera sincronización'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={RefreshCw}
            loading={sync.isPending}
            onClick={() => void withToast(sync.mutateAsync(), 'Sincronización en marcha')}
          >
            Sincronizar
          </Button>
          <Button
            variant="ghost"
            icon={Unplug}
            loading={disconnect.isPending}
            onClick={() => {
              if (
                window.confirm('¿Desconectar Search Console? Se borrarán las métricas importadas.')
              )
                void withToast(disconnect.mutateAsync(), 'Search Console desconectado');
            }}
          >
            Desconectar
          </Button>
        </div>
      </div>
      {status.lastError && (
        <div className="mt-3">
          <Notice
            title={
              errorMessages[status.lastError as keyof typeof errorMessages] ?? status.lastError
            }
          >
            {status.lastError === 'GOOGLE_AUTH_FAILED' && (
              <button
                type="button"
                className="underline"
                onClick={() => void withToast(connect.mutateAsync())}
              >
                Volver a conectar
              </button>
            )}
          </Notice>
        </div>
      )}
      {!status.propertyUrl && (
        <div className="mt-3 text-sm">
          <p className="mb-2">
            No encontramos una propiedad de Search Console para esta tienda en esa cuenta. Elige
            una:
          </p>
          {properties.isLoading ? (
            <Spinner />
          ) : (
            <select
              className={cx(inputClass, 'max-w-md')}
              defaultValue=""
              onChange={(e) =>
                e.target.value &&
                void withToast(select.mutateAsync(e.target.value), 'Propiedad guardada')
              }
            >
              <option value="" disabled>
                Selecciona…
              </option>
              {properties.data?.map((p) => (
                <option key={p.siteUrl} value={p.siteUrl}>
                  {p.siteUrl}
                </option>
              ))}
            </select>
          )}
          <ErrorBanner error={properties.error} className="mt-2" />
        </div>
      )}
    </Card>
  );
}

function Results({ siteId, data }: { siteId: string; data: PerformanceDto }) {
  const generate = useGenerate(siteId);
  const t = data.totals;
  const decaying = data.articles.filter((a) => a.decaying);

  if (!data.period) {
    return (
      <EmptyState icon={LineChartIcon} title="Aún no hay datos de Google para tus artículos">
        Google tarda unos días en mostrar un artículo nuevo en Search Console. Solo contamos las
        páginas publicadas desde aquí: vuelve cuando tengas artículos publicados.
      </EmptyState>
    );
  }

  return (
    <>
      <p className="mb-3 text-xs text-stone-500">
        Últimos 28 días con datos ({formatDate(data.period.from)} – {formatDate(data.period.to)})
        frente a los 28 anteriores. Solo artículos generados aquí.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Clics"
          value={nf.format(t.clicks)}
          extra={<Delta now={t.clicks} before={t.previousClicks} />}
        />
        <Kpi
          label="Impresiones"
          value={nf.format(t.impressions)}
          extra={<Delta now={t.impressions} before={t.previousImpressions} />}
        />
        <Kpi label="CTR medio" value={pct.format(t.ctr)} />
        {data.revenueEnabled ? (
          <Kpi
            label="Ventas atribuidas"
            value={money(t.revenue, t.currency)}
            extra={<span className="text-xs text-stone-500">{t.orders} pedidos</span>}
          />
        ) : (
          <Kpi label="Posición media" value={pos(t.position)} />
        )}
      </div>

      {data.daily.length > 1 && (
        <Card className="mt-3">
          <h2 className="mb-2 font-medium">Clics diarios desde Google</h2>
          <LineChart
            ariaLabel={`Clics diarios de los artículos en Google: ${nf.format(t.clicks)} en los últimos 28 días.`}
            labels={data.daily.map((d) => d.date.slice(5).split('-').reverse().join('/'))}
            series={[
              {
                name: 'Clics',
                values: data.daily.map((d) => d.clicks),
                tone: SERIES_TONES.primary,
              },
            ]}
          />
        </Card>
      )}

      {decaying.length > 0 && (
        <div className="mt-6">
          <Notice
            title={`${decaying.length} artículo${decaying.length > 1 ? 's pierden' : ' pierde'} clics`}
          >
            Han bajado más de un 30 % frente al mes anterior. Refrescarlos con datos actuales suele
            recuperar la posición: ábrelos y pulsa «Refrescar».
          </Notice>
        </div>
      )}

      <section className="mt-6">
        <h2 className="mb-3 font-medium">Artículos</h2>
        <Card className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800">
              <tr>
                <th className="p-3">Artículo</th>
                <th className="p-3 text-right">Clics</th>
                <th className="p-3 text-right">Impr.</th>
                <th className="p-3 text-right">Posición</th>
                {data.revenueEnabled && <th className="p-3 text-right">Ventas</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {data.articles.map((a) => (
                <tr key={a.articleId}>
                  <td className="max-w-xs p-3">
                    <Link
                      to={`../articles/${a.articleId}`}
                      relative="path"
                      className="font-medium hover:underline"
                    >
                      {a.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {a.remoteStatus && a.remoteStatus !== 'publish' && (
                        <Badge>
                          {a.remoteStatus === 'draft' ? 'Borrador en WP' : a.remoteStatus}
                        </Badge>
                      )}
                      {a.decaying && <Badge tone="red">Pierde tráfico</Badge>}
                    </div>
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {nf.format(a.clicks)} <Delta now={a.clicks} before={a.previousClicks} />
                  </td>
                  <td className="p-3 text-right tabular-nums">{nf.format(a.impressions)}</td>
                  <td className="p-3 text-right tabular-nums">{pos(a.position)}</td>
                  {data.revenueEnabled && (
                    <td className="p-3 text-right tabular-nums">
                      {a.orders ? `${money(a.revenue, t.currency)} (${a.orders})` : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {!data.revenueEnabled && (
          <p className="mt-2 text-xs text-stone-500">
            ¿Quieres ver qué artículos generan ventas en WooCommerce?{' '}
            <Link to="/billing" className="text-teal-700 underline dark:text-teal-400">
              Disponible en Pro y Agency
            </Link>
            .
          </p>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Oportunidades: ya asomas en Google</h2>
          <Link
            to="../keywords?source=gsc"
            relative="path"
            className="text-sm text-teal-700 hover:underline dark:text-teal-400"
          >
            Ver todas
          </Link>
        </div>
        {data.opportunities.length === 0 ? (
          <p className="text-sm text-stone-500">
            Aún no hay búsquedas entre las posiciones 8 y 20 con impresiones suficientes.
          </p>
        ) : (
          <Card className="divide-y divide-stone-100 p-0 dark:divide-stone-800 sm:p-0">
            {data.opportunities.map((o) => (
              <div key={o.keywordId} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="min-w-0 flex-1 font-medium">{o.term}</span>
                <span className="text-stone-500">
                  pos. {pos(o.position)} · {nf.format(o.impressions)} impr.
                </span>
                <Button
                  variant="secondary"
                  icon={Sparkles}
                  disabled={o.status !== 'pending'}
                  loading={generate.isPending && generate.variables === o.keywordId}
                  onClick={() =>
                    void withToast(generate.mutateAsync(o.keywordId), `Generando «${o.term}»`)
                  }
                >
                  {o.status === 'pending' ? 'Escribir artículo' : 'En curso'}
                </Button>
              </div>
            ))}
          </Card>
        )}
      </section>
    </>
  );
}
