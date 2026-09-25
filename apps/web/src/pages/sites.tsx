import { zodResolver } from '@hookform/resolvers/zod';
import { Globe, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  PLATFORM_IDS,
  PLATFORMS,
  createSiteSchema,
  type CreateSiteInput,
  type JobType,
  type PlatformId,
} from '@seo/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Spinner,
  cx,
  inputClass,
} from '../components/ui';
import { useCreateSite, useSites, useSitesOverview } from '../lib/hooks';
import { jobTypeLabel, parseJobError } from '../lib/i18n';

/** Raíz: con un solo sitio entra directo a su panel; si no, muestra el selector. */
export function HomeRedirect() {
  const { data: sites, isLoading, error } = useSites();
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner error={error} />;
  const only = sites?.length === 1 ? sites[0] : undefined;
  return <Navigate to={only ? `/sites/${only.id}` : '/sites'} replace />;
}

export function SitesPage() {
  const { data: sites, isLoading, error } = useSites();
  const { data: overview } = useSitesOverview();
  const byId = new Map(overview?.sites.map((o) => [o.siteId, o]));
  const plan = overview?.plan;
  const atLimit = !!plan && plan.maxSites !== null && (overview?.sitesCount ?? 0) >= plan.maxSites;
  const totals = overview?.sites.reduce(
    (t, o) => ({
      published: t.published + o.publishedThisMonth,
      pending: t.pending + o.pendingKeywords,
      inProgress: t.inProgress + o.inProgress,
      failing: t.failing + (o.lastFailure ? 1 : 0),
    }),
    { published: 0, pending: 0, inProgress: 0, failing: 0 },
  );

  return (
    <>
      <PageHeader
        title="Tus tiendas"
        description="Todas tus tiendas de un vistazo. Cada una tiene sus propias keywords, artículos, voz de marca y credenciales."
        actions={
          atLimit ? (
            <Button icon={Plus} disabled title="Has llegado al límite de tiendas de tu plan">
              Añadir tienda
            </Button>
          ) : (
            <Link to="/sites/new">
              <Button icon={Plus}>Añadir tienda</Button>
            </Link>
          )
        }
      />
      {isLoading && <Spinner />}
      <ErrorBanner error={error} />

      {plan && totals && (sites?.length ?? 0) > 0 && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Plan</p>
              <p className="font-semibold">
                {plan.name}{' '}
                <span className="text-sm font-normal text-stone-500">
                  · {overview.sitesCount}/{plan.maxSites ?? '∞'} tiendas ·{' '}
                  {plan.articlesPerMonth ?? '∞'} artículos/mes por tienda
                </span>
              </p>
            </div>
            <Metric label="Publicados este mes" value={totals.published} />
            <Metric label="Keywords pendientes" value={totals.pending} />
            <Metric label="En curso" value={totals.inProgress} />
            <Metric label="Con errores (24 h)" value={totals.failing} alert={totals.failing > 0} />
          </div>
        </Card>
      )}

      {sites?.length === 0 && (
        <EmptyState
          icon={Globe}
          title="Todavía no has conectado ninguna tienda"
          action={
            <Link to="/sites/new">
              <Button icon={Plus}>Conectar mi tienda</Button>
            </Link>
          }
        >
          Con WordPress necesitas la URL y una contraseña de aplicación (Usuarios → Perfil →
          Contraseñas de aplicación). No hace falta instalar nada en tu tienda.
        </EmptyState>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {sites?.map((s) => {
          const o = byId.get(s.id);
          const failure = o?.lastFailure ? parseJobError(o.lastFailure.error) : null;
          return (
            <Link key={s.id} to={`/sites/${s.id}`} className="group">
              <Card className="h-full transition group-hover:border-teal-600">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium">{s.name}</h2>
                    <p className="truncate text-sm text-stone-500">{s.url}</p>
                  </div>
                  <Badge tone={s.active ? 'green' : 'neutral'}>
                    {s.active ? 'Activa' : 'Pausada'}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge>{platformName(s.platform)}</Badge>
                  <Badge tone={s.hasCredentials ? 'green' : 'amber'}>
                    {s.hasCredentials ? 'Conectada' : 'Sin credenciales'}
                  </Badge>
                  <Badge>
                    {s.language.toUpperCase()}-{s.country}
                  </Badge>
                  {s.settings.cadence !== 'off' && <Badge tone="blue">Automático</Badge>}
                </div>
                {o && (
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <MiniStat label="Publicados (mes)" value={o.publishedThisMonth} />
                    <MiniStat label="Keywords" value={o.pendingKeywords} />
                    <MiniStat label="En curso" value={o.inProgress} />
                  </dl>
                )}
                {o?.lastFailure && failure && (
                  <p
                    className="mt-3 truncate text-xs text-red-700 dark:text-red-400"
                    title={failure.detail}
                  >
                    {jobTypeName(o.lastFailure.type)} falló: {failure.text}
                  </p>
                )}
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function Metric({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p
        className={cx(
          'text-lg font-semibold tabular-nums',
          alert && 'text-red-700 dark:text-red-400',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse rounded-lg bg-stone-50 px-2 py-1.5 dark:bg-stone-800/50">
      <dt className="text-[11px] text-stone-500">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

const platformName = (p: string): string => (p in PLATFORMS ? PLATFORMS[p as PlatformId].name : p);

const jobTypeName = (t: string): string => (t in jobTypeLabel ? jobTypeLabel[t as JobType] : t);

export function NewSitePage() {
  const create = useCreateSite();
  const navigate = useNavigate();
  const { register, handleSubmit, formState } = useForm<
    z.input<typeof createSiteSchema>,
    unknown,
    CreateSiteInput
  >({
    resolver: zodResolver(createSiteSchema),
    defaultValues: { language: 'es', country: 'ES', platform: 'wordpress' },
  });
  const { errors } = formState;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Añadir tienda"
        description="Elige la plataforma de tu tienda. Con WordPress conectamos mediante una contraseña de aplicación."
      />
      <Card>
        <form
          className="space-y-4"
          onSubmit={handleSubmit((v) =>
            create.mutate(v, {
              onSuccess: (site) => {
                toast.success('Sitio creado. Prueba la conexión para comprobar las credenciales.');
                navigate(`/sites/${site.id}/settings`);
              },
            }),
          )}
        >
          <Field label="Plataforma" error={errors.platform?.message}>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORM_IDS.map((id) => {
                const p = PLATFORMS[id];
                return (
                  <label
                    key={id}
                    className={cx(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                      p.available
                        ? 'cursor-pointer border-stone-300 dark:border-stone-700'
                        : 'cursor-not-allowed border-dashed border-stone-200 text-stone-400 dark:border-stone-800',
                    )}
                  >
                    <input
                      type="radio"
                      value={id}
                      disabled={!p.available}
                      className="text-teal-700"
                      {...register('platform')}
                    />
                    <span>{p.name}</span>
                    {!p.available && <Badge>Próximamente</Badge>}
                  </label>
                );
              })}
            </div>
          </Field>
          <Field label="Nombre" error={errors.name?.message}>
            <input className={inputClass} placeholder="Mi tienda" {...register('name')} />
          </Field>
          <Field
            label="URL del sitio"
            hint="Con https://. Es donde está instalado WordPress."
            error={errors.url?.message}
          >
            <input
              className={inputClass}
              placeholder="https://mitienda.es"
              inputMode="url"
              {...register('url')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Idioma (ISO)" error={errors.language?.message}>
              <input className={inputClass} maxLength={2} {...register('language')} />
            </Field>
            <Field label="País (ISO)" error={errors.country?.message}>
              <input className={inputClass} maxLength={2} {...register('country')} />
            </Field>
          </div>
          <Field label="Usuario de WordPress" error={errors.wpUsername?.message}>
            <input className={inputClass} autoComplete="off" {...register('wpUsername')} />
          </Field>
          <Field
            label="Contraseña de aplicación"
            hint="Se guarda cifrada (AES-256-GCM) y nunca se vuelve a mostrar."
            error={errors.wpAppPassword?.message}
          >
            <input
              className={inputClass}
              autoComplete="off"
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              {...register('wpAppPassword')}
            />
          </Field>
          <ErrorBanner error={create.error} />
          <div className="flex justify-end gap-2">
            <Link to="/sites">
              <Button type="button" variant="secondary">
                Cancelar
              </Button>
            </Link>
            <Button type="submit" loading={create.isPending}>
              Crear tienda
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
