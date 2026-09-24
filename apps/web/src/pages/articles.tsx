import { FileText } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ARTICLE_STATUSES, type ArticleStatus } from '@seo/shared';
import {
  Button,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  cx,
  inputClass,
} from '../components/ui';
import { formatDate } from '../lib/format';
import { useArticles } from '../lib/hooks';
import { articleStatusLabel } from '../lib/i18n';

export function ArticlesPage() {
  const { siteId = '' } = useParams();
  const [status, setStatus] = useState<ArticleStatus | ''>('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useArticles(siteId, status || undefined, page);

  return (
    <>
      <PageHeader
        title="Artículos"
        description="Revisa, edita y publica en WordPress los artículos generados."
      />
      <select
        className={cx(inputClass, 'mb-3 sm:w-56')}
        value={status}
        onChange={(e) => {
          setStatus(e.target.value as ArticleStatus | '');
          setPage(1);
        }}
        aria-label="Filtrar por estado"
      >
        <option value="">Todos los estados</option>
        {ARTICLE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {articleStatusLabel[s]}
          </option>
        ))}
      </select>

      {isLoading && <Spinner />}
      <ErrorBanner error={error} />

      {data && data.total === 0 && (
        <EmptyState
          icon={FileText}
          title={status ? 'Ningún artículo con ese estado' : 'Todavía no hay artículos'}
          action={
            !status ? (
              <Link to="../keywords">
                <Button>Ir a keywords</Button>
              </Link>
            ) : undefined
          }
        >
          {status
            ? 'Cambia el filtro para ver el resto.'
            : 'Elige una keyword y pulsa «Generar artículo»: Claude preparará el esquema y lo redactará. Lo verás aquí para revisarlo antes de publicar.'}
        </EmptyState>
      )}

      {data && data.items.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {data.items.map((a) => (
            <li key={a.id}>
              <Link
                to={a.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.title}</p>
                  <p className="text-xs text-stone-500">
                    {a.wordCount > 0 ? `${a.wordCount} palabras · ` : ''}
                    {formatDate(a.updatedAt)}
                  </p>
                </div>
                <StatusBadge status={a.status} label={articleStatusLabel[a.status]} />
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
