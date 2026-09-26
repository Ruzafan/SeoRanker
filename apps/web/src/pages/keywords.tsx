import {
  ArrowDown,
  ArrowUp,
  Ban,
  Compass,
  KeyRound,
  Layers,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { KEYWORD_SOURCES, KEYWORD_STATUSES, type KeywordStatus } from '@seo/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  cx,
  inputClass,
} from '../components/ui';
import {
  useAddKeywords,
  useBatchKeywords,
  useClusters,
  useDeleteKeyword,
  useDiscover,
  useGenerate,
  useKeywords,
  usePatchKeyword,
  useRebuildClusters,
  useSite,
  withToast,
  type KeywordFilters,
} from '../lib/hooks';
import { intentLabel, keywordSourceLabel, keywordStatusLabel } from '../lib/i18n';

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function KeywordsPage() {
  const { siteId = '' } = useParams();
  const { data: site } = useSite(siteId);
  const [params] = useSearchParams();
  const [status, setStatus] = useState<KeywordStatus | ''>('');
  const [source, setSource] = useState(params.get('source') ?? '');
  const [clusterId, setClusterId] = useState('');
  const clusters = useClusters(siteId);
  const rebuild = useRebuildClusters(siteId);
  const clusterName = new Map(clusters.data?.map((c) => [c.id, c.name]));
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [sort, setSort] = useState<KeywordFilters['sort']>('score');
  const [order, setOrder] = useState<KeywordFilters['order']>('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  const filters: KeywordFilters = {
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(search ? { search } : {}),
    sort,
    order,
    page,
  };
  const { data, isLoading, error } = useKeywords(siteId, filters);
  const add = useAddKeywords(siteId);
  const discover = useDiscover(siteId);
  const batch = useBatchKeywords(siteId);
  const patch = usePatchKeyword(siteId);
  const del = useDeleteKeyword(siteId);
  const generate = useGenerate(siteId);

  useEffect(() => setPage(1), [status, source, clusterId, search, sort, order]);
  useEffect(() => setSelected(new Set()), [status, source, clusterId, search, page]);

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((k) => selected.has(k.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const toggleSort = (col: KeywordFilters['sort']) => {
    if (sort === col) setOrder(order === 'desc' ? 'asc' : 'desc');
    else {
      setSort(col);
      setOrder(col === 'term' ? 'asc' : 'desc');
    }
  };
  const SortIcon = order === 'desc' ? ArrowDown : ArrowUp;
  const hasSeeds = (site?.settings.seeds.length ?? 0) > 0;

  const submitAdd = async () => {
    const terms = text
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    if (!terms.length) return;
    const r = await withToast(add.mutateAsync(terms));
    if (r) {
      setText('');
      setAdding(false);
      void withToast(
        Promise.resolve(r),
        `${r.created} añadidas${r.skipped ? `, ${r.skipped} ya existían` : ''}`,
      );
    }
  };

  const ids = [...selected];
  // Columnas de métricas solo si hay datos (sin DataForSEO o Search Console serían todo «—»).
  const showVolume = items.some((k) => k.volume !== null);
  const showGoogle = items.some((k) => k.gscImpressions !== null);
  return (
    <>
      <PageHeader
        title="Keywords"
        description="Las búsquedas para las que quieres posicionar. Ordénalas por puntuación y genera artículos de las mejores."
        actions={
          <>
            <Button variant="secondary" icon={Plus} onClick={() => setAdding((a) => !a)}>
              Añadir
            </Button>
            <Button
              variant="secondary"
              icon={Compass}
              loading={discover.isPending}
              title={hasSeeds ? undefined : 'Sin semillas: se deducirán del contenido de tu tienda'}
              onClick={() =>
                void withToast(
                  discover.mutateAsync(),
                  'Descubrimiento en marcha; verás las keywords al terminar',
                )
              }
            >
              Descubrir
            </Button>
          </>
        }
      />

      {adding && (
        <Card className="mb-4">
          <label className="block text-sm font-medium">Una keyword por línea</label>
          <textarea
            className={cx(inputClass, 'mt-2 min-h-32')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'figuras de acción coleccionables\ncómo limpiar figuras de resina'}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button loading={add.isPending} onClick={() => void submitAdd()}>
              Guardar keywords
            </Button>
          </div>
        </Card>
      )}

      <div className="mb-4 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="h-4 w-4 text-stone-500" />
          <span className="text-sm font-medium">Clusters</span>
          <span className="text-xs text-stone-500">
            Primero se escribe la guía pilar de cada tema y después sus artículos, enlazados entre
            sí.
          </span>
          <Button
            variant="ghost"
            className="ml-auto"
            loading={rebuild.isPending}
            onClick={() => void withToast(rebuild.mutateAsync(), 'Reagrupando keywords…')}
          >
            Reagrupar
          </Button>
        </div>
        {(clusters.data?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setClusterId('')}
              className={cx(
                'rounded-full border px-2.5 py-1 text-xs',
                !clusterId
                  ? 'border-teal-600 text-teal-800 dark:text-teal-300'
                  : 'border-stone-200 dark:border-stone-700',
              )}
            >
              Todos
            </button>
            {clusters.data?.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setClusterId(c.id === clusterId ? '' : c.id)}
                title={c.pillar ? `Pilar: ${c.pillar.term}` : undefined}
                className={cx(
                  'rounded-full border px-2.5 py-1 text-xs',
                  c.id === clusterId
                    ? 'border-teal-600 text-teal-800 dark:text-teal-300'
                    : 'border-stone-200 dark:border-stone-700',
                )}
              >
                {c.name}{' '}
                <span className="tabular-nums text-stone-500">
                  {c.done}/{c.keywords}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          className={cx(inputClass, 'sm:max-w-xs')}
          placeholder="Buscar…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Buscar keywords"
        />
        <select
          className={cx(inputClass, 'sm:w-48')}
          value={status}
          onChange={(e) => setStatus(e.target.value as KeywordStatus | '')}
          aria-label="Filtrar por estado"
        >
          <option value="">Todos los estados</option>
          {KEYWORD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {keywordStatusLabel[s]}
            </option>
          ))}
        </select>
        <select
          className={cx(inputClass, 'sm:w-56')}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label="Filtrar por origen"
        >
          <option value="">Todos los orígenes</option>
          {KEYWORD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {keywordSourceLabel[s]}
            </option>
          ))}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 p-2.5 text-sm dark:border-teal-900 dark:bg-teal-950">
          <span className="font-medium">{selected.size} seleccionadas</span>
          <Button
            icon={Sparkles}
            loading={batch.isPending}
            onClick={async () => {
              const r = await withToast(batch.mutateAsync({ ids, action: 'queue' }));
              if (r)
                void withToast(
                  Promise.resolve(r),
                  `${r.processed} en cola${r.skipped ? `, ${r.skipped} omitidas` : ''}`,
                );
              setSelected(new Set());
            }}
          >
            Generar artículos
          </Button>
          <Button
            variant="secondary"
            icon={Ban}
            onClick={async () => {
              const r = await withToast(batch.mutateAsync({ ids, action: 'discard' }));
              if (r) void withToast(Promise.resolve(r), `${r.processed} descartadas`);
              setSelected(new Set());
            }}
          >
            Descartar
          </Button>
        </div>
      )}

      {isLoading && <Spinner />}
      <ErrorBanner error={error} />

      {data && data.total === 0 && (
        <EmptyState
          icon={KeyRound}
          title={
            status || source || search
              ? 'Ninguna keyword coincide con el filtro'
              : 'Aún no tienes keywords'
          }
          action={
            !status && !source && !search ? (
              hasSeeds ? (
                <Button
                  icon={Compass}
                  onClick={() => void withToast(discover.mutateAsync(), 'Descubrimiento en marcha')}
                >
                  Descubrir desde mis semillas
                </Button>
              ) : (
                <Link to="../settings">
                  <Button>Configurar semillas</Button>
                </Link>
              )
            ) : undefined
          }
        >
          {status || source || search
            ? 'Prueba con otro estado o quita la búsqueda.'
            : hasSeeds
              ? 'Descubre keywords a partir de tus semillas: Google Autocomplete las expande y Claude las puntúa.'
              : 'Añade keywords semilla en Ajustes (los temas de tu sitio) y descubriremos decenas de keywords puntuadas. También puedes pegarlas a mano con «Añadir».'}
        </EmptyState>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900">
              <tr>
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(items.map((k) => k.id)))
                    }
                    className="rounded border-stone-300 text-teal-700 focus:ring-teal-600"
                  />
                </th>
                <th className="p-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium uppercase"
                    onClick={() => toggleSort('term')}
                  >
                    Keyword {sort === 'term' && <SortIcon className="h-3 w-3" />}
                  </button>
                </th>
                <th className="p-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium uppercase"
                    onClick={() => toggleSort('score')}
                  >
                    Score {sort === 'score' && <SortIcon className="h-3 w-3" />}
                  </button>
                </th>
                {showVolume && (
                  <th className="hidden p-3 md:table-cell">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium uppercase"
                      onClick={() => toggleSort('volume')}
                      title="Búsquedas al mes y dificultad (0-100)"
                    >
                      Volumen {sort === 'volume' && <SortIcon className="h-3 w-3" />}
                    </button>
                  </th>
                )}
                {showGoogle && (
                  <th className="hidden p-3 md:table-cell">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium uppercase"
                      onClick={() => toggleSort('gscImpressions')}
                      title="Impresiones y posición media en Google (Search Console, 28 días)"
                    >
                      Google {sort === 'gscImpressions' && <SortIcon className="h-3 w-3" />}
                    </button>
                  </th>
                )}
                <th className="hidden p-3 sm:table-cell">Intención</th>
                <th className="p-3">Estado</th>
                <th className="w-28 p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 bg-white dark:divide-stone-800 dark:bg-stone-950">
              {items.map((k) => {
                const busy = k.status === 'queued' || k.status === 'processing';
                return (
                  <tr
                    key={k.id}
                    className={cx(selected.has(k.id) && 'bg-teal-50/50 dark:bg-teal-950/30')}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${k.term}`}
                        checked={selected.has(k.id)}
                        onChange={() => toggle(k.id)}
                        className="rounded border-stone-300 text-teal-700 focus:ring-teal-600"
                      />
                    </td>
                    <td className="p-3">
                      <span className="font-medium">{k.term}</span>
                      <span className="mt-0.5 block text-xs text-stone-500">
                        {keywordSourceLabel[k.source as keyof typeof keywordSourceLabel] ??
                          k.source}
                        {k.seedTerm ? ` · de «${k.seedTerm}»` : ''}
                        {k.clusterId && clusterName.get(k.clusterId)
                          ? ` · ${clusterName.get(k.clusterId)}`
                          : ''}
                      </span>
                      {k.discardReason === 'CANNIBALIZATION' && (
                        <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                          Descartada: ya hay{' '}
                          {k.similarToArticleId ? (
                            <Link
                              to={`../articles/${k.similarToArticleId}`}
                              relative="path"
                              className="underline"
                            >
                              un artículo
                            </Link>
                          ) : (
                            'un post en tu blog'
                          )}{' '}
                          para esta búsqueda. «Recuperar» la escribe igualmente.
                        </span>
                      )}
                    </td>
                    <td className="p-3 tabular-nums">{k.score}</td>
                    {showVolume && (
                      <td className="hidden p-3 tabular-nums md:table-cell">
                        {k.volume === null ? (
                          '—'
                        ) : (
                          <>
                            {k.volume.toLocaleString('es-ES')}
                            {k.difficulty !== null && (
                              <span className="block text-xs text-stone-500">
                                KD {k.difficulty}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    )}
                    {showGoogle && (
                      <td className="hidden p-3 tabular-nums md:table-cell">
                        {k.gscImpressions === null ? (
                          '—'
                        ) : (
                          <>
                            {k.gscImpressions.toLocaleString('es-ES')} impr.
                            {k.gscPosition !== null && (
                              <span className="block text-xs text-stone-500">
                                pos. {k.gscPosition.toFixed(1).replace('.', ',')}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    )}
                    <td className="hidden p-3 sm:table-cell">
                      {k.intent ? <Badge>{intentLabel[k.intent] ?? k.intent}</Badge> : '—'}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={k.status} label={keywordStatusLabel[k.status]} />
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          title="Generar artículo"
                          aria-label={`Generar artículo para ${k.term}`}
                          disabled={busy || k.status === 'discarded'}
                          onClick={() =>
                            void withToast(generate.mutateAsync(k.id), 'Artículo en cola')
                          }
                          className="rounded-lg p-1.5 text-teal-700 hover:bg-stone-100 disabled:opacity-30 dark:text-teal-400 dark:hover:bg-stone-800"
                        >
                          <Sparkles className="h-4 w-4" />
                        </button>
                        {k.status !== 'discarded' ? (
                          <button
                            type="button"
                            title="Descartar"
                            aria-label={`Descartar ${k.term}`}
                            disabled={busy}
                            onClick={() =>
                              void withToast(
                                patch.mutateAsync({ id: k.id, patch: { status: 'discarded' } }),
                              )
                            }
                            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Recuperar"
                            onClick={() =>
                              void withToast(
                                patch.mutateAsync({ id: k.id, patch: { status: 'pending' } }),
                              )
                            }
                            className="rounded-lg px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                          >
                            Recuperar
                          </button>
                        )}
                        <button
                          type="button"
                          title="Eliminar"
                          aria-label={`Eliminar ${k.term}`}
                          disabled={busy}
                          onClick={() =>
                            window.confirm(`¿Eliminar «${k.term}»?`) &&
                            void withToast(del.mutateAsync(k.id))
                          }
                          className="rounded-lg p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-30 dark:hover:bg-red-950"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
      )}
    </>
  );
}
