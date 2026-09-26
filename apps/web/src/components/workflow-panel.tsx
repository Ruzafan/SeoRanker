import { CalendarClock, Check, MessageSquare, RefreshCcw, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { PLANS, isPlanId, type ArticleDto } from '@seo/shared';
import { formatDate } from '../lib/format';
import {
  useAddComment,
  useComments,
  useMe,
  useRefreshArticle,
  useRestoreArticle,
  useReviewArticle,
  useSchedule,
  withToast,
} from '../lib/hooks';
import { Badge, Button, Card, cx, inputClass } from './ui';

const REVIEW: Record<
  ArticleDto['reviewStatus'],
  { label: string; tone: 'neutral' | 'amber' | 'green' | 'red' }
> = {
  none: { label: 'Sin revisión', tone: 'neutral' },
  pending: { label: 'Pendiente de aprobación', tone: 'amber' },
  approved: { label: 'Aprobado', tone: 'green' },
  changes_requested: { label: 'Cambios pedidos', tone: 'red' },
};

const KIND: Record<string, string> = {
  approve: 'aprobó',
  request_changes: 'pidió cambios',
  comment: 'comentó',
};

/** datetime-local ⇄ ISO en la zona horaria del navegador. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Programación, revisión del cliente, comentarios y refresco de un artículo. */
export function WorkflowPanel({ siteId, article }: { siteId: string; article: ArticleDto }) {
  const { data: me } = useMe();
  const viewer = me?.role === 'viewer';
  const plan = me && isPlanId(me.plan) ? PLANS[me.plan] : PLANS.free;
  const schedule = useSchedule(siteId);
  const review = useReviewArticle(siteId, article.id);
  const refresh = useRefreshArticle(siteId, article.id);
  const restore = useRestoreArticle(siteId, article.id);
  const comments = useComments(article.id);
  const addComment = useAddComment(article.id);
  const [text, setText] = useState('');
  const [when, setWhen] = useState(toLocalInput(article.scheduledFor));
  const hasContent = !!article.contentHtml;
  const r = REVIEW[article.reviewStatus];

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-medium">Flujo editorial</h2>
        <Badge tone={r.tone}>{r.label}</Badge>
        {article.refreshedAt && (
          <Badge tone="blue">Refrescado {formatDate(article.refreshedAt)}</Badge>
        )}
        {article.decayDetectedAt && <Badge tone="red">Pierde tráfico</Badge>}
      </div>

      {!viewer && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 flex items-center gap-1.5 font-medium">
              <CalendarClock className="h-4 w-4" /> Publicar el
            </span>
            <input
              type="datetime-local"
              className={cx(inputClass, 'w-auto')}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!hasContent || when === toLocalInput(article.scheduledFor)}
            loading={schedule.isPending}
            onClick={() =>
              void withToast(
                schedule.mutateAsync({
                  id: article.id,
                  scheduledFor: when ? new Date(when).toISOString() : null,
                }),
                when ? 'Publicación programada' : 'Programación quitada',
              )
            }
          >
            {when ? 'Programar' : 'Quitar fecha'}
          </Button>
          {article.status === 'published' && (
            <Button
              variant="secondary"
              icon={RefreshCcw}
              className="ml-auto"
              disabled={!plan.contentRefresh}
              title={plan.contentRefresh ? undefined : 'Disponible en Pro y Agency'}
              loading={refresh.isPending}
              onClick={() =>
                window.confirm(
                  'Claude actualizará el artículo con lo que posiciona hoy y las búsquedas reales de la página. Podrás deshacerlo. ¿Continuar?',
                ) && void withToast(refresh.mutateAsync(), 'Refrescando el artículo…')
              }
            >
              Refrescar
            </Button>
          )}
          {article.hasPreviousVersion && (
            <Button
              variant="ghost"
              icon={RotateCcw}
              loading={restore.isPending}
              onClick={() =>
                window.confirm('¿Volver a la versión anterior al último refresco?') &&
                void withToast(restore.mutateAsync(), 'Versión anterior restaurada')
              }
            >
              Deshacer refresco
            </Button>
          )}
        </div>
      )}

      {hasContent && (
        <div className="flex flex-wrap gap-2">
          <Button
            icon={Check}
            loading={review.isPending && review.variables?.decision === 'approve'}
            disabled={article.reviewStatus === 'approved'}
            onClick={() =>
              void withToast(
                review.mutateAsync({
                  decision: 'approve',
                  ...(text.trim() ? { comment: text.trim() } : {}),
                }),
                'Artículo aprobado',
              ).then((r2) => r2 && setText(''))
            }
          >
            Aprobar
          </Button>
          <Button
            variant="secondary"
            icon={X}
            loading={review.isPending && review.variables?.decision === 'request_changes'}
            onClick={() => {
              if (!text.trim())
                return void withToast(
                  Promise.reject(new Error('Escribe qué cambios necesitas en el comentario.')),
                );
              void withToast(
                review.mutateAsync({ decision: 'request_changes', comment: text.trim() }),
                'Cambios pedidos',
              ).then((r2) => r2 && setText(''));
            }}
          >
            Pedir cambios
          </Button>
        </div>
      )}

      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <MessageSquare className="h-4 w-4" /> Comentarios
        </h3>
        <ul className="mt-2 space-y-2">
          {comments.data?.length === 0 && (
            <li className="text-xs text-stone-500">Aún no hay comentarios.</li>
          )}
          {comments.data?.map((c) => (
            <li key={c.id} className="rounded-lg bg-stone-50 p-2.5 text-sm dark:bg-stone-800/60">
              <p className="text-xs text-stone-500">
                <strong>{c.author ?? 'Alguien'}</strong> {KIND[c.kind] ?? ''} ·{' '}
                {formatDate(c.createdAt)}
              </p>
              {c.body && <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <textarea
            className={cx(inputClass, 'min-h-16')}
            placeholder="Escribe un comentario (se adjunta también al aprobar o pedir cambios)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!text.trim()}
            loading={addComment.isPending}
            onClick={() =>
              void withToast(addComment.mutateAsync(text.trim())).then((r2) => r2 && setText(''))
            }
          >
            Enviar
          </Button>
        </div>
      </div>
    </Card>
  );
}
