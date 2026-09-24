import { Navigate } from 'react-router-dom';
import { Badge, Card, ErrorBanner, PageHeader, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';
import { useAdminOrgs, useMe } from '../lib/hooks';

/** Vista de soporte, solo lectura, de todas las organizaciones. Solo para ADMIN_EMAIL. */
export function AdminPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data: orgs, isLoading, error } = useAdminOrgs(!!me?.isAdmin);
  if (meLoading) return <Spinner />;
  if (!me?.isAdmin) return <Navigate to="/" replace />;

  return (
    <>
      <PageHeader
        title="Administración"
        description="Todas las organizaciones (solo lectura). No incluye credenciales."
      />
      {isLoading && <Spinner />}
      <ErrorBanner error={error} />
      <div className="space-y-4">
        {orgs?.map((o) => (
          <Card key={o.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">{o.name}</h2>
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <Badge tone={o.plan === 'free' ? 'neutral' : 'green'}>{o.plan}</Badge>
                desde {formatDate(o.createdAt)}
              </div>
            </div>
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
              {o.users.map((u) => `${u.email} (${u.role})`).join(', ')}
            </p>
            {o.sites.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Sin sitios.</p>
            ) : (
              <ul className="mt-3 divide-y divide-stone-100 text-sm dark:divide-stone-800">
                {o.sites.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{s.name}</span>{' '}
                      <span className="text-stone-500">{s.url}</span>
                    </span>
                    <span className="text-xs text-stone-500">
                      {s.articles} artículos · {s.keywords} keywords {s.active ? '' : '· pausado'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
