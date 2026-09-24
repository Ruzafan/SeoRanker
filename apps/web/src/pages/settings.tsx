import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Plug, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  siteSettingsSchema,
  type ConnectionTestDto,
  type SiteDto,
  type UpdateSiteInput,
} from '@seo/shared';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Notice,
  Spinner,
  cx,
  inputClass,
} from '../components/ui';
import { YOAST_SNIPPET } from '../lib/format';
import { useDeleteSite, useSite, useTestConnection, useUpdateSite, withToast } from '../lib/hooks';
import { cadenceLabel, errorMessages, warningMessages } from '../lib/i18n';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Obligatorio').max(100),
  url: z.string().trim().min(3, 'Obligatorio').max(300),
  language: z.string().trim().length(2, '2 letras, p. ej. es'),
  country: z.string().trim().length(2, '2 letras, p. ej. ES'),
  wpUsername: z.string().trim().max(100),
  wpAppPassword: z.string().trim().max(200),
  seedsText: z.string().max(5000),
  wordCount: siteSettingsSchema.shape.wordCount,
  cadence: siteSettingsSchema.shape.cadence,
  autoPublish: siteSettingsSchema.shape.autoPublish,
  categoryId: z.string().regex(/^\d*$/, 'Debe ser un número'),
  model: z.string().trim().max(100),
  active: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

const toForm = (s: SiteDto): FormValues => ({
  name: s.name,
  url: s.url,
  language: s.language,
  country: s.country,
  wpUsername: '',
  wpAppPassword: '',
  seedsText: s.settings.seeds.join('\n'),
  wordCount: s.settings.wordCount,
  cadence: s.settings.cadence,
  autoPublish: s.settings.autoPublish,
  categoryId: s.settings.categoryId ? String(s.settings.categoryId) : '',
  model: s.settings.model ?? '',
  active: s.active,
});

export function SettingsPage() {
  const { siteId = '' } = useParams();
  const navigate = useNavigate();
  const { data: site } = useSite(siteId);
  const update = useUpdateSite(siteId);
  const test = useTestConnection(siteId);
  const del = useDeleteSite(siteId);
  const [result, setResult] = useState<ConnectionTestDto | null>(null);

  const { register, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });
  const { errors, isDirty } = formState;

  useEffect(() => {
    if (site) reset(toForm(site));
  }, [site, reset]);

  if (!site) return <Spinner />;

  const onSubmit = handleSubmit(async (v) => {
    const seeds = [
      ...new Set(
        v.seedsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    const input: UpdateSiteInput = {
      name: v.name,
      url: v.url,
      language: v.language.toLowerCase(),
      country: v.country.toUpperCase(),
      active: v.active,
      settings: {
        seeds,
        wordCount: v.wordCount,
        cadence: v.cadence,
        autoPublish: v.autoPublish,
        categoryId: v.categoryId ? Number(v.categoryId) : null,
        model: v.model || null,
      },
    };
    // Las credenciales solo se envían si el usuario escribe algo; en blanco = mantener las guardadas.
    if (v.wpUsername) input.wpUsername = v.wpUsername;
    if (v.wpAppPassword) input.wpAppPassword = v.wpAppPassword;
    await withToast(update.mutateAsync(input), 'Ajustes guardados');
  });

  const runTest = async () => {
    setResult(null);
    const r = await withToast(test.mutateAsync());
    if (r) setResult(r);
  };

  const yoastBroken =
    result?.warnings.includes('YOAST_META_NOT_EXPOSED') || site.settings.yoastMetaExposed === false;

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Ajustes del sitio</h1>
      <form onSubmit={onSubmit} className="space-y-6">
        <Card className="space-y-4">
          <h2 className="font-medium">Sitio</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" error={errors.name?.message}>
              <input className={inputClass} {...register('name')} />
            </Field>
            <Field label="URL" error={errors.url?.message}>
              <input className={inputClass} inputMode="url" {...register('url')} />
            </Field>
            <Field label="Idioma (ISO)" error={errors.language?.message}>
              <input className={inputClass} maxLength={2} {...register('language')} />
            </Field>
            <Field label="País (ISO)" error={errors.country?.message}>
              <input className={inputClass} maxLength={2} {...register('country')} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="rounded border-stone-300 text-teal-700 focus:ring-teal-600"
              {...register('active')}
            />
            Sitio activo (si lo pausas, la automatización lo ignora)
          </label>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">Conexión con WordPress</h2>
              <p className="text-sm text-stone-600 dark:text-stone-400">
                {site.hasCredentials
                  ? 'Hay credenciales guardadas (cifradas). Déjalas en blanco para mantenerlas.'
                  : 'Aún no hay credenciales guardadas.'}
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Usuario" error={errors.wpUsername?.message}>
              <input
                className={inputClass}
                autoComplete="off"
                placeholder={site.hasCredentials ? '•••••• (sin cambios)' : ''}
                {...register('wpUsername')}
              />
            </Field>
            <Field
              label="Contraseña de aplicación"
              hint="Usuarios → Perfil → Contraseñas de aplicación."
              error={errors.wpAppPassword?.message}
            >
              <input
                className={inputClass}
                autoComplete="off"
                placeholder={site.hasCredentials ? '•••••• (sin cambios)' : 'xxxx xxxx xxxx xxxx'}
                {...register('wpAppPassword')}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              icon={Plug}
              loading={test.isPending}
              disabled={!site.hasCredentials || isDirty}
              onClick={() => void runTest()}
            >
              Probar conexión
            </Button>
            {isDirty && (
              <span className="text-xs text-stone-500">Guarda los cambios antes de probar.</span>
            )}
          </div>
          {result && (
            <div className="space-y-3">
              {result.ok ? (
                <Notice
                  tone="green"
                  title={`Conexión correcta${result.details?.siteName ? ` con «${result.details.siteName}»` : ''}`}
                >
                  Yoast SEO:{' '}
                  {result.details?.yoastActive === true
                    ? 'detectado'
                    : result.details?.yoastActive === false
                      ? 'no detectado'
                      : 'no se pudo comprobar'}
                  .
                </Notice>
              ) : (
                <Notice
                  title={
                    errorMessages[result.message as keyof typeof errorMessages] ?? result.message
                  }
                />
              )}
              {result.warnings
                .filter((w) => w !== 'YOAST_META_NOT_EXPOSED')
                .map((w) => (
                  <Notice key={w} title={warningMessages[w]} />
                ))}
            </div>
          )}
          {yoastBroken && (
            <Notice title={warningMessages.YOAST_META_NOT_EXPOSED}>
              <p className="mb-2">
                Para que la meta description y la keyword principal lleguen a Yoast, pega esto en el{' '}
                <code>functions.php</code> de tu tema (o en un plugin de snippets):
              </p>
              <pre className="overflow-x-auto rounded bg-white/70 p-2 text-[11px] leading-snug dark:bg-black/30">
                {YOAST_SNIPPET}
              </pre>
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(YOAST_SNIPPET)
                    .then(() => toast.success('Copiado'))
                }
              >
                Copiar snippet
              </Button>
            </Notice>
          )}
          {!yoastBroken && result?.details?.yoastMetaExposed === true && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Yoast expone sus campos por REST: la meta
              description se guardará en Yoast.
            </p>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="font-medium">Contenido y automatización</h2>
          <Field
            label="Keywords semilla"
            hint="Una por línea. De estas se descubren las demás (p. ej. «figuras de acción», «coleccionables anime»)."
            error={errors.seedsText?.message}
          >
            <textarea className={cx(inputClass, 'min-h-28')} {...register('seedsText')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Palabras por artículo" error={errors.wordCount?.message}>
              <input
                type="number"
                min={300}
                max={3000}
                step={100}
                className={inputClass}
                {...register('wordCount', { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Cadencia automática"
              hint="Con «Diaria» se genera un borrador nuevo cada día con la mejor keyword pendiente."
            >
              <select className={inputClass} {...register('cadence')}>
                {Object.entries(cadenceLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Categoría destino (ID en WordPress)"
              hint="Opcional. Aparece en la URL al editar la categoría (tag_ID)."
              error={errors.categoryId?.message}
            >
              <input inputMode="numeric" className={inputClass} {...register('categoryId')} />
            </Field>
            <Field label="Modelo de Claude" hint="Vacío = el modelo por defecto del servidor.">
              <input
                className={inputClass}
                list="models"
                placeholder="claude-sonnet-5"
                {...register('model')}
              />
              <datalist id="models">
                <option value="claude-sonnet-5" />
                <option value="claude-opus-5" />
                <option value="claude-fable-5-1" />
                <option value="claude-haiku-4-5-20251001" />
              </datalist>
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-stone-300 text-teal-700 focus:ring-teal-600"
              {...register('autoPublish')}
            />
            <span>
              Publicación automática
              <span className="block text-xs text-stone-500">
                Desactivado: los artículos se envían a WordPress como <strong>borrador</strong> para
                que los revises.
              </span>
            </span>
          </label>
        </Card>

        <ErrorBanner error={update.error} />
        <div className="flex justify-end">
          <Button type="submit" icon={Save} loading={update.isPending} disabled={!isDirty}>
            Guardar ajustes
          </Button>
        </div>
      </form>

      <Card className="mt-10 border-red-200 dark:border-red-900">
        <h2 className="font-medium text-red-800 dark:text-red-300">Zona peligrosa</h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Elimina el sitio con sus keywords, artículos y trabajos. No borra nada de WordPress.
        </p>
        <Button
          type="button"
          variant="danger"
          icon={Trash2}
          className="mt-3"
          loading={del.isPending}
          onClick={() => {
            if (
              !window.confirm(
                `¿Eliminar «${site.name}» y todos sus datos? Esta acción no se puede deshacer.`,
              )
            )
              return;
            del.mutate(undefined, {
              onSuccess: () => {
                toast.success('Sitio eliminado');
                navigate('/');
              },
            });
          }}
        >
          Eliminar sitio
        </Button>
        <ErrorBanner error={del.error} className="mt-3" />
      </Card>
    </>
  );
}
