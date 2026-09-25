import { Bot, Check, Play, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDate } from '../lib/format';
import { useAiVisibility, useRunAiVisibility, withToast } from '../lib/hooks';
import { Badge, Button, Card, cx } from './ui';

const pct = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 });

/**
 * ¿Te recomiendan los asistentes de IA? Preguntas de comprador hechas a Claude con búsqueda web:
 * si nombra la tienda, si cita sus páginas y qué dominios cita en su lugar.
 */
export function AiVisibilityCard({ siteId }: { siteId: string }) {
  const { data } = useAiVisibility(siteId);
  const run = useRunAiVisibility(siteId);
  if (!data) return null;
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Bot className="h-4 w-4" /> Visibilidad en asistentes de IA
        </h2>
        {data.mentionRate !== null && (
          <Badge tone={data.mentionRate >= 0.5 ? 'green' : data.mentionRate > 0 ? 'amber' : 'red'}>
            Te nombran en el {pct.format(data.mentionRate)} de las respuestas
          </Badge>
        )}
        {data.enabled && (
          <Button
            variant="ghost"
            icon={Play}
            className="ml-auto"
            loading={run.isPending}
            onClick={() =>
              void withToast(run.mutateAsync(), 'Preguntando a la IA… tarda un minuto')
            }
          >
            Comprobar ahora
          </Button>
        )}
      </div>
      {!data.enabled ? (
        <Card>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Cada semana preguntamos a un asistente de IA con búsqueda web lo que preguntaría un
            comprador de tu sector y te decimos si te recomienda, si cita tu web y a quién cita en
            tu lugar. Disponible en Pro y Agency.{' '}
            <Link to="/billing" className="text-teal-700 underline dark:text-teal-400">
              Ver planes
            </Link>
          </p>
        </Card>
      ) : data.checks.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Aún no hay comprobaciones. Se hacen solas cada semana a partir de tus mejores keywords,
            o pulsa «Comprobar ahora».
          </p>
        </Card>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {data.checks.map((c) => (
              <li key={c.prompt} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                {c.mentioned ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <X className="h-4 w-4 shrink-0 text-red-600" />
                )}
                <span className="min-w-0 flex-1">{c.prompt}</span>
                {c.cited && <Badge tone="green">Cita tu web</Badge>}
                {c.competitors.length > 0 && (
                  <span className="w-full pl-7 text-xs text-stone-500 sm:w-auto sm:pl-0">
                    Cita: {c.competitors.slice(0, 3).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 p-3 text-xs text-stone-500 dark:border-stone-800">
            {data.lastRunAt && <span>Última comprobación: {formatDate(data.lastRunAt)}.</span>}
            {data.topCompetitors.length > 0 && (
              <span>
                Quién aparece en tu lugar:{' '}
                {data.topCompetitors.slice(0, 5).map((c, i) => (
                  <span key={c.domain} className={cx(i > 0 && 'ml-1')}>
                    {c.domain} ({c.count})
                    {i < Math.min(4, data.topCompetitors.length - 1) ? ',' : ''}
                  </span>
                ))}
              </span>
            )}
          </div>
        </Card>
      )}
      <p className="mt-2 text-xs text-stone-500">
        Para aparecer más: artículos que respondan directamente a estas preguntas, datos concretos
        de tu tienda y preguntas frecuentes (se publican como datos estructurados).
      </p>
    </section>
  );
}
