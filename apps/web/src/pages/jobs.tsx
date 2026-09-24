import { ListChecks } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
} from '../components/ui';
import {
  formatCents,
  formatDate,
  formatDuration,
  formatTokens,
  jobDurationMs,
} from '../lib/format';
import { useJobs } from '../lib/hooks';
import { jobStatusLabel, jobTypeLabel, parseJobError } from '../lib/i18n';

export function JobsPage() {
  const { siteId = '' } = useParams();
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useJobs(siteId, page);

  return (
    <>
      <PageHeader
        title="Trabajos"
        description="Historial de cada paso automático: qué se ejecutó, cuánto tardó, cuántos tokens usó y por qué falló si falló."
      />
      {isLoading && <Spinner />}
      <ErrorBanner error={error} />
      {data?.total === 0 && (
        <EmptyState icon={ListChecks} title="Todavía no se ha ejecutado ningún trabajo">
          Aquí aparecerán el análisis de voz, el descubrimiento de keywords, la redacción y la
          publicación, cada uno con su resultado.
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {data.items.map((j) => {
            const err = parseJobError(j.error);
            const inTok = Number(j.meta?.['inputTokens'] ?? 0);
            const outTok = Number(j.meta?.['outputTokens'] ?? 0);
            const cost = Number(j.meta?.['costCents'] ?? 0);
            return (
              <li key={j.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {jobTypeLabel[j.type]}
                      {j.attempt > 1 && (
                        <span className="ml-2 text-xs font-normal text-stone-500">
                          intento {j.attempt}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-stone-500">
                      {formatDate(j.createdAt)} · {formatDuration(jobDurationMs(j))}
                      {inTok + outTok > 0 &&
                        ` · ${formatTokens(inTok + outTok)} tokens · ${formatCents(cost)}`}
                    </p>
                  </div>
                  <StatusBadge status={j.status} label={jobStatusLabel[j.status] ?? j.status} />
                </div>
                {err && (
                  <details
                    className="mt-2 rounded-lg bg-red-50 p-2.5 text-red-900 dark:bg-red-950 dark:text-red-200"
                    open={j.status === 'failed'}
                  >
                    <summary className="cursor-pointer text-xs font-medium">{err.text}</summary>
                    {err.detail && (
                      <p className="mt-1 break-words text-xs opacity-80">{err.detail}</p>
                    )}
                  </details>
                )}
                {j.meta &&
                  Object.keys(j.meta).some(
                    (k) =>
                      ![
                        'inputTokens',
                        'outputTokens',
                        'costCents',
                        'models',
                        'durationMs',
                      ].includes(k),
                  ) && (
                    <details className="mt-2 text-xs text-stone-500">
                      <summary className="cursor-pointer">Detalles</summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-stone-50 p-2 dark:bg-stone-800">
                        {JSON.stringify(j.meta, null, 2)}
                      </pre>
                    </details>
                  )}
              </li>
            );
          })}
        </ul>
      )}
      {data && (
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
      )}
    </>
  );
}
