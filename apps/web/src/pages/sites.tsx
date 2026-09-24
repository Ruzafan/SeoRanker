import { zodResolver } from '@hookform/resolvers/zod';
import { Globe, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createSiteSchema, type CreateSiteInput } from '@seo/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Spinner,
  inputClass,
} from '../components/ui';
import { useCreateSite, useSites } from '../lib/hooks';

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
  return (
    <>
      <PageHeader
        title="Tus sitios"
        description="Cada sitio tiene sus propias keywords, artículos, voz de marca y credenciales."
        actions={
          <Link to="/sites/new">
            <Button icon={Plus}>Añadir sitio</Button>
          </Link>
        }
      />
      {isLoading && <Spinner />}
      <ErrorBanner error={error} />
      {sites?.length === 0 && (
        <EmptyState
          icon={Globe}
          title="Todavía no has conectado ningún sitio"
          action={
            <Link to="/sites/new">
              <Button icon={Plus}>Conectar mi WordPress</Button>
            </Link>
          }
        >
          Necesitas la URL de tu WordPress y una contraseña de aplicación (Usuarios → Perfil →
          Contraseñas de aplicación). No hace falta instalar nada en tu sitio.
        </EmptyState>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {sites?.map((s) => (
          <Link key={s.id} to={`/sites/${s.id}`} className="group">
            <Card className="h-full transition group-hover:border-teal-600">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-medium">{s.name}</h2>
                  <p className="truncate text-sm text-stone-500">{s.url}</p>
                </div>
                <Badge tone={s.active ? 'green' : 'neutral'}>
                  {s.active ? 'Activo' : 'Pausado'}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone={s.hasCredentials ? 'green' : 'amber'}>
                  {s.hasCredentials ? 'Credenciales guardadas' : 'Sin credenciales'}
                </Badge>
                <Badge>
                  {s.language.toUpperCase()}-{s.country}
                </Badge>
                {s.settings.cadence !== 'off' && <Badge tone="blue">Automático</Badge>}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

export function NewSitePage() {
  const create = useCreateSite();
  const navigate = useNavigate();
  const { register, handleSubmit, formState } = useForm<CreateSiteInput>({
    resolver: zodResolver(createSiteSchema),
    defaultValues: { language: 'es', country: 'ES' },
  });
  const { errors } = formState;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Añadir sitio"
        description="Conectaremos con WordPress mediante una contraseña de aplicación."
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
              Crear sitio
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
