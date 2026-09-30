import { ArrowLeft, Check, ExternalLink, Loader2, Sparkles, Undo2, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { plainText, type ProductDto, type ProductSuggestionDto } from '@seo/shared';
import { DiffView } from '../components/diff-view';
import { Badge, Button, Card, ErrorBanner, Notice, PageHeader, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';
import {
  useAnalyzeProduct,
  useDecideSuggestions,
  useProduct,
  useProductsOverview,
  useRevertSuggestion,
  withToast,
} from '../lib/hooks';
import { productFieldLabel, productIssueLabel } from '../lib/i18n';
import { scoreTone } from './products';

/** Texto legible de un valor guardado: etiquetas en JSON y descripción corta en HTML. */
function display(field: string, value: string | null): string {
  if (value === null) return '';
  if (field === 'tags') {
    try {
      return (JSON.parse(value) as string[]).join(', ');
    } catch {
      return value;
    }
  }
  return field === 'short_description' ? plainText(value) : value;
}

const statusLabel: Record<ProductSuggestionDto['status'], string> = {
  pending: 'Pendiente',
  applied: 'Aplicado',
  rejected: 'Descartado',
  reverted: 'Deshecho',
};

export function ProductDetailPage() {
  const { siteId = '', productId = '' } = useParams();
  const { data: p, isLoading, error } = useProduct(siteId, productId);
  const overview = useProductsOverview(siteId);
  const analyze = useAnalyzeProduct(siteId);
  const decide = useDecideSuggestions(siteId, productId);
  const revert = useRevertSuggestion(siteId);

  if (isLoading) return <Spinner />;
  if (!p) return <ErrorBanner error={error} />;

  const pending = p.suggestions.filter((s) => s.status === 'pending');
  const fills = pending.filter((s) => s.kind === 'fill');
  const improves = pending.filter((s) => s.kind === 'improve');
  const history = p.suggestions.filter((s) => s.status !== 'pending');
  const quota = overview.data?.quota;
  const quotaLeft = quota ? quota.limit - quota.used : 1;
  const busy = decide.isPending || revert.isPending;
  const act = (ids: string[], decision: 'accept' | 'reject') =>
    withToast(
      decide.mutateAsync({ ids, decision }),
      decision === 'accept' ? 'Aplicado en tu tienda' : 'Descartado',
    );

  return (
    <>
      <Link
        to=".."
        relative="path"
        className="mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:underline dark:text-stone-400"
      >
        <ArrowLeft className="h-4 w-4" /> Productos
      </Link>
      <PageHeader
        title={p.name}
        description={
          p.analyzedAt
            ? `Revisado por Claude el ${formatDate(p.analyzedAt)}.`
            : 'Claude aún no ha revisado este producto.'
        }
        actions={
          <>
            <a href={p.url} target="_blank" rel="noreferrer">
              <Button variant="secondary" icon={ExternalLink}>
                Ver en la tienda
              </Button>
            </a>
            <Button
              icon={Sparkles}
              loading={analyze.isPending}
              disabled={p.analyzing || quotaLeft <= 0}
              title={quotaLeft <= 0 ? 'Has usado el cupo de productos de este mes' : undefined}
              onClick={() => {
                if (
                  pending.length > 0 &&
                  !window.confirm(
                    'Las sugerencias pendientes se sustituirán por las nuevas. ¿Continuar?',
                  )
                )
                  return;
                void withToast(analyze.mutateAsync(p.id), 'Claude está revisando el producto…');
              }}
            >
              {p.analyzedAt ? 'Volver a revisar' : 'Revisar con Claude'}
            </Button>
          </>
        }
      />
      <ErrorBanner error={decide.error ?? revert.error} className="mb-4" />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={scoreTone(p.score)}>{p.score}/100</Badge>
        {p.issues.map((i) => (
          <Badge key={i}>{productIssueLabel[i]}</Badge>
        ))}
        {quota && (
          <span className="text-xs text-stone-500">
            Te quedan {Math.max(0, quotaLeft)} revisiones este mes
          </span>
        )}
      </div>

      {p.analyzing && (
        <div className="mb-4">
          <Notice tone="blue" title="Claude está revisando este producto…">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Suele tardar menos de un minuto. La
              página se actualiza sola.
            </span>
          </Notice>
        </div>
      )}

      {pending.length === 0 && !p.analyzing && (
        <Card className="mb-6 text-sm text-stone-600 dark:text-stone-400">
          {p.analyzedAt
            ? 'No hay sugerencias pendientes. Abajo tienes el historial de cambios.'
            : 'Pulsa «Revisar con Claude»: propondrá qué rellenar y qué mejorar. Nada se aplica hasta que lo aceptes.'}
        </Card>
      )}

      {fills.length > 0 && (
        <section className="mb-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Huecos a rellenar</h2>
              <p className="text-sm text-stone-500">
                Campos vacíos en tu tienda. Rellenarlos no cambia nada de lo que ya tienes.
              </p>
            </div>
            {fills.length > 1 && (
              <Button
                variant="secondary"
                icon={Check}
                disabled={busy}
                onClick={() =>
                  void act(
                    fills.map((s) => s.id),
                    'accept',
                  )
                }
              >
                Aceptar los {fills.length}
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {fills.map((s) => (
              <SuggestionCard key={s.id} s={s} p={p} busy={busy} onDecide={act} />
            ))}
          </div>
        </section>
      )}

      {improves.length > 0 && (
        <section className="mb-8">
          <h2 className="font-semibold">Mejoras propuestas</h2>
          <p className="mb-2 text-sm text-stone-500">
            Sustituyen algo que ya tienes: revisa la diferencia antes de aceptar.
          </p>
          <div className="space-y-3">
            {improves.map((s) => (
              <SuggestionCard key={s.id} s={s} p={p} busy={busy} onDecide={act} />
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Historial</h2>
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white text-sm dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {history.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="font-medium">{productFieldLabel(s.field)}</span>
                <span className="min-w-0 flex-1 truncate text-stone-500">
                  {display(s.field, s.after)}
                </span>
                <Badge
                  tone={
                    s.status === 'applied' ? 'green' : s.status === 'reverted' ? 'blue' : 'neutral'
                  }
                >
                  {statusLabel[s.status]}
                </Badge>
                {s.decidedAt && (
                  <span className="text-xs text-stone-500">{formatDate(s.decidedAt)}</span>
                )}
                {s.status === 'applied' && (
                  <Button
                    variant="ghost"
                    icon={Undo2}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('¿Volver a dejar el valor anterior en tu tienda?'))
                        void withToast(revert.mutateAsync(s.id), 'Cambio deshecho');
                    }}
                  >
                    Deshacer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function SuggestionCard({
  s,
  p,
  busy,
  onDecide,
}: {
  s: ProductSuggestionDto;
  p: ProductDto;
  busy: boolean;
  onDecide: (ids: string[], decision: 'accept' | 'reject') => unknown;
}) {
  const image = s.field.startsWith('image_alt:')
    ? p.snapshot.images.find((i) => `image_alt:${i.id}` === s.field)
    : undefined;
  const newTags =
    s.field === 'tags'
      ? (JSON.parse(s.after) as string[]).filter((t) => !p.snapshot.tags.includes(t))
      : [];
  return (
    <Card className="!p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{productFieldLabel(s.field)}</span>
        <Badge tone={s.kind === 'fill' ? 'blue' : 'amber'}>
          {s.kind === 'fill' ? 'Estaba vacío' : 'Mejora'}
        </Badge>
        {s.reason && <span className="text-sm text-stone-500">— {s.reason}</span>}
      </div>

      {s.kind === 'improve' && s.before !== null ? (
        <DiffView before={display(s.field, s.before)} after={display(s.field, s.after)} />
      ) : s.field === 'tags' ? (
        <div className="flex flex-wrap gap-1.5">
          {newTags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
            >
              + {t}
            </span>
          ))}
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {image?.url && (
            <img
              src={image.url}
              alt=""
              className="h-16 w-16 shrink-0 rounded-md border border-stone-200 object-cover dark:border-stone-700"
            />
          )}
          <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/30">
            {display(s.field, s.after)}
          </p>
        </div>
      )}
      {s.kind === 'improve' && s.field === 'tags' && newTags.length > 0 && (
        <p className="mt-2 text-xs text-stone-500">
          Solo se añaden etiquetas: no se quita ninguna de las tuyas.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button icon={Check} disabled={busy} onClick={() => void onDecide([s.id], 'accept')}>
          Aceptar
        </Button>
        <Button
          variant="secondary"
          icon={X}
          disabled={busy}
          onClick={() => void onDecide([s.id], 'reject')}
        >
          Descartar
        </Button>
      </div>
    </Card>
  );
}
