import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ArticleSummaryDto } from '@seo/shared';
import { Button, Card, ErrorBanner, PageHeader, Spinner, cx } from '../components/ui';
import { useCalendar, useSchedule, withToast } from '../lib/hooks';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const monthLabel = (d: Date) => d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Fecha efectiva del artículo en el calendario: la programada o la de publicación. */
function when(a: ArticleSummaryDto): Date | null {
  const iso = a.scheduledFor ?? a.publishedAt;
  return iso ? new Date(iso) : null;
}

function Chip({ a, siteId }: { a: ArticleSummaryDto; siteId: string }) {
  const live = !a.scheduledFor || a.status === 'published';
  return (
    <Link
      to={`/sites/${siteId}/articles/${a.id}`}
      draggable={a.status === 'ready'}
      onDragStart={(e) => e.dataTransfer.setData('text/article', a.id)}
      title={a.title}
      className={cx(
        'block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight',
        live
          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
          : 'cursor-grab bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
        a.reviewStatus === 'pending' && 'ring-1 ring-amber-500',
      )}
    >
      {a.title}
    </Link>
  );
}

export function CalendarPage() {
  const { siteId = '' } = useParams();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  // Rejilla de lunes a domingo que cubre el mes.
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7));
    return Array.from(
      { length: 42 },
      (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    );
  }, [month]);
  const from = days[0]!;
  const to = new Date(days[41]!.getTime() + 86_399_999);
  const { data, isLoading, error } = useCalendar(siteId, from.toISOString(), to.toISOString());
  const schedule = useSchedule(siteId);
  const [over, setOver] = useState<string | null>(null);

  const byDay = new Map<string, ArticleSummaryDto[]>();
  for (const a of data?.items ?? []) {
    const d = when(a);
    if (!d) continue;
    const k = dayKey(d);
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }

  const drop = (day: Date | null) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/article');
    if (!id) return;
    // Se programa a las 9:00 (hora local) del día elegido; soltar en "Sin programar" lo desprograma.
    const at = day
      ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).toISOString()
      : null;
    void withToast(
      schedule.mutateAsync({ id, scheduledFor: at }),
      at ? `Programado para el ${day?.toLocaleDateString('es-ES')}` : 'Sin programar',
    );
  };
  const today = dayKey(new Date());

  return (
    <>
      <PageHeader
        title="Calendario"
        description="Arrastra los artículos listos a un día: se publicarán en WordPress esa mañana (con la aprobación del cliente si la exiges)."
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              icon={ChevronLeft}
              aria-label="Mes anterior"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            />
            <span className="min-w-[9rem] text-center text-sm font-medium capitalize">
              {monthLabel(month)}
            </span>
            <Button
              variant="secondary"
              icon={ChevronRight}
              aria-label="Mes siguiente"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            />
          </div>
        }
      />
      {isLoading && <Spinner />}
      <ErrorBanner error={error ?? schedule.error} />

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="overflow-x-auto">
          <div className="grid min-w-[42rem] grid-cols-7 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 dark:border-stone-800 dark:bg-stone-800">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="bg-stone-50 py-1.5 text-center text-xs font-medium text-stone-500 dark:bg-stone-900"
              >
                {w}
              </div>
            ))}
            {days.map((d) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === month.getMonth();
              return (
                <div
                  key={k}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(k);
                  }}
                  onDragLeave={() => setOver((o) => (o === k ? null : o))}
                  onDrop={drop(d)}
                  className={cx(
                    'min-h-24 space-y-1 bg-white p-1.5 dark:bg-stone-950',
                    !inMonth && 'bg-stone-50 text-stone-400 dark:bg-stone-900/60',
                    over === k && 'bg-teal-50 dark:bg-teal-950/40',
                  )}
                >
                  <p
                    className={cx(
                      'text-right text-xs tabular-nums',
                      k === today && 'font-bold text-teal-700 dark:text-teal-400',
                    )}
                  >
                    {d.getDate()}
                  </p>
                  {byDay.get(k)?.map((a) => (
                    <Chip key={a.id} a={a} siteId={siteId} />
                  ))}
                </div>
              );
            })}
          </div>
          <p className="mt-2 flex flex-wrap gap-4 text-xs text-stone-500">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Publicado
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />
              Programado
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full ring-1 ring-amber-500" />
              Pendiente de aprobación
            </span>
          </p>
        </div>

        <Card className={cx('h-fit', over === 'none' && 'border-teal-600')}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver('none');
            }}
            onDragLeave={() => setOver(null)}
            onDrop={drop(null)}
          >
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4" /> Listos sin programar
            </h2>
            {data?.unscheduled.length === 0 ? (
              <p className="mt-2 text-xs text-stone-500">No hay artículos listos sin fecha.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {data?.unscheduled.map((a) => (
                  <Chip key={a.id} a={a} siteId={siteId} />
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
