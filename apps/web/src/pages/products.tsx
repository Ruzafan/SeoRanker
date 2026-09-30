import { Loader2, RefreshCw, ShoppingBag, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CONNECTOR_VERSION_PRODUCTS, type ProductIssue } from '@seo/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Notice,
  PageHeader,
  Pagination,
  Spinner,
  cx,
  inputClass,
  type Tone,
} from '../components/ui';
import { formatDate } from '../lib/format';
import {
  useAnalyzeProducts,
  useProducts,
  useProductsOverview,
  useScanProducts,
  withToast,
} from '../lib/hooks';
import { productIssueLabel } from '../lib/i18n';

export const scoreTone = (score: number): Tone =>
  score >= 85 ? 'green' : score >= 60 ? 'amber' : 'red';

const BATCH = 10;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ProductsPage() {
  const { siteId = '' } = useParams();
  const overview = useProductsOverview(siteId);
  const scan = useScanProducts(siteId);
  const batch = useAnalyzeProducts(siteId);
  const [issue, setIssue] = useState<ProductIssue | ''>('');
  const [pending, setPending] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [issue, pending, search]);
  const { data, isLoading, error } = useProducts(siteId, {
    ...(issue ? { issue } : {}),
    ...(search ? { search } : {}),
    ...(pending ? { pending: 'true' as const } : {}),
    page,
  });

  const o = overview.data;
  if (overview.isLoading) return <Spinner />;
  const quotaLeft = o ? Math.max(0, o.quota.limit - o.quota.used) : 0;
  const scanning = o?.scanning || scan.isPending;

  return (
    <>
      <PageHeader
        title="Productos"
        description="El SEO de cada ficha de tu tienda. Claude propone qué rellenar y qué mejorar; nada se cambia en WordPress hasta que tú lo aceptas."
        actions={
          o?.supported ? (
            <>
              <Button
                variant="secondary"
                icon={RefreshCw}
                loading={scanning}
                onClick={() => void withToast(scan.mutateAsync(), 'Analizando tu tienda…')}
              >
                {o.scannedAt ? 'Volver a analizar' : 'Analizar tienda'}
              </Button>
              {o.quota.batch && o.total > 0 && (
                <Button
                  icon={Sparkles}
                  loading={batch.isPending}
                  disabled={quotaLeft === 0}
                  title="Claude revisa los productos con peor puntuación que aún no tienen sugerencias"
                  onClick={async () => {
                    const r = await withToast(batch.mutateAsync({ limit: BATCH }));
                    if (r) setPending(false);
                  }}
                >
                  Mejorar los {Math.min(BATCH, quotaLeft)} peores
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <ErrorBanner error={overview.error} />

      {o && !o.supported && (
        <Notice title="Actualiza el conector de WordPress">
          Para revisar tus productos necesitas WooCommerce y el conector v
          {CONNECTOR_VERSION_PRODUCTS} o superior. Descárgalo en{' '}
          <Link to="../settings" className="underline">
            Ajustes
          </Link>
          , súbelo en WordPress (Plugins → Añadir nuevo → Subir plugin) y vuelve a probar la
          conexión.
        </Notice>
      )}

      {o?.supported && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="!p-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">Productos</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{o.total}</p>
          </Card>
          <Card className="!p-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">Nota media</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {o.averageScore === null ? '—' : `${o.averageScore}/100`}
            </p>
          </Card>
          <Card className="!p-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">Revisados este mes</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {o.quota.used}
              <span className="text-base font-normal text-stone-500"> / {o.quota.limit}</span>
            </p>
            {quotaLeft === 0 && (
              <Link to="/billing" className="text-xs text-teal-700 underline dark:text-teal-400">
                Mejorar plan
              </Link>
            )}
          </Card>
          <Card className="!p-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">Último análisis</p>
            <p className="mt-1 text-sm">
              {scanning ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> En curso…
                </span>
              ) : o.scannedAt ? (
                formatDate(o.scannedAt)
              ) : (
                'Nunca'
              )}
            </p>
          </Card>
        </div>
      )}

      {o?.supported && o.issues.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {o.issues.map((i) => (
            <button
              key={i.issue}
              type="button"
              onClick={() => setIssue((cur) => (cur === i.issue ? '' : i.issue))}
              className={cx(
                'rounded-full border px-2.5 py-1 text-xs transition',
                issue === i.issue
                  ? 'border-teal-600 bg-teal-600 text-white'
                  : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900',
              )}
            >
              {productIssueLabel[i.issue]} · {i.count}
            </button>
          ))}
        </div>
      )}

      {o?.supported && o.total > 0 && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className={cx(inputClass, 'sm:max-w-xs')}
            placeholder="Buscar producto…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Buscar producto"
          />
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pending}
              onChange={(e) => setPending(e.target.checked)}
            />
            Con sugerencias por revisar
          </label>
        </div>
      )}

      {isLoading && <Spinner />}
      <ErrorBanner error={error} />

      {o?.supported && data && data.total === 0 && (
        <EmptyState
          icon={ShoppingBag}
          title={
            o.total === 0 ? 'Aún no hemos analizado tu tienda' : 'Ningún producto con ese filtro'
          }
          action={
            o.total === 0 ? (
              <Button
                icon={RefreshCw}
                loading={scanning}
                onClick={() => void withToast(scan.mutateAsync(), 'Analizando tu tienda…')}
              >
                Analizar tienda
              </Button>
            ) : undefined
          }
        >
          {o.total === 0
            ? 'Leeremos tus productos publicados y te diremos qué les falta para posicionar: keyword, meta descripción, textos alternativos, etiquetas… El análisis es gratis; solo las propuestas de Claude cuentan en tu cupo.'
            : 'Quita filtros para ver el resto.'}
        </EmptyState>
      )}

      {data && data.items.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {data.items.map((p) => (
            <li key={p.id}>
              <Link
                to={p.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800"
              >
                {p.image ? (
                  <img
                    src={p.image}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-md border border-stone-200 object-cover dark:border-stone-700"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-stone-100 dark:bg-stone-800">
                    <ShoppingBag className="h-4 w-4 text-stone-400" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="truncate text-xs text-stone-500">
                    {p.issues.length === 0
                      ? 'Sin problemas'
                      : p.issues.map((i) => productIssueLabel[i]).join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {p.analyzing && (
                    <Badge tone="blue">
                      <Loader2 className="h-3 w-3 animate-spin" /> Claude revisando
                    </Badge>
                  )}
                  {p.pendingSuggestions > 0 && (
                    <Badge tone="amber">{p.pendingSuggestions} por revisar</Badge>
                  )}
                  <Badge tone={scoreTone(p.score)}>{p.score}/100</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && (
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
      )}
    </>
  );
}
