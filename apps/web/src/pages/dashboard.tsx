import { CheckCircle2, Circle, Compass, FileText, KeyRound, Sparkles } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { KeywordDto, Paginated } from '@seo/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Notice,
  PageHeader,
  Spinner,
  StatusBadge,
  cx,
} from '../components/ui';
import { connectorState } from '../components/connector';
import { api } from '../lib/api';
import {
  formatCents,
  formatDate,
  formatDuration,
  formatTokens,
  jobDurationMs,
} from '../lib/format';
import { useDiscover, useGenerate, useSite, useStats, withToast } from '../lib/hooks';
import { jobStatusLabel, jobTypeLabel } from '../lib/i18n';

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
    </Card>
  );
}

export function DashboardPage() {
  const { siteId = '' } = useParams();
  const { data: site } = useSite(siteId);
  const { data: stats, isLoading, error } = useStats(siteId);
  const generate = useGenerate(siteId);
  const discover = useDiscover(siteId);

  if (isLoading || !site) return <Spinner />;
  if (error || !stats) return <ErrorBanner error={error} />;

  const { usage } = stats;
  const seeds = site.settings.seeds.length;

  const onGenerate = async () => {
    const page = await withToast(
      api.get<Paginated<KeywordDto>>(
        `/sites/${siteId}/keywords?status=pending&sort=score&order=desc&pageSize=1`,
      ),
    );
    const best = page?.items[0];
    if (page && !best) {
      toast.info('No hay keywords pendientes. Descubre o añade algunas primero.');
      return;
    }
    if (best) {
      const ok = await withToast(
        generate.mutateAsync(best.id),
        `Generando artículo para «${best.term}»`,
      );
      void ok;
    }
  };

  const steps = [
    {
      done: site.hasCredentials,
      label: 'Conecta tu WordPress',
      to: 'settings',
      hint: 'Usuario y contraseña de aplicación.',
    },
    {
      done: connectorState(site.settings) === 'ok',
      label: 'Instala el conector',
      to: 'settings',
      hint: 'Plugin de un clic para la meta de Yoast/Rank Math y el FAQ en Google.',
    },
    {
      done: !!site.brandVoice,
      label: 'Genera la voz de marca',
      to: 'voice',
      hint: 'Claude lee tu contenido y aprende tu estilo.',
    },
    {
      done: stats.pendingKeywords > 0 || usage.articles > 0,
      label: 'Consigue keywords',
      to: 'keywords',
      hint:
        seeds > 0
          ? 'Descúbrelas a partir de tus semillas o pégalas a mano.'
          : 'Las deducimos del contenido de tu tienda; no hace falta configurar nada.',
    },
  ];
  const setupDone = steps.every((s) => s.done);

  return (
    <>
      <PageHeader
        title="Panel"
        description={`Resumen de ${site.name} este mes.`}
        actions={
          <>
            <Button size="lg" icon={Sparkles} onClick={onGenerate} loading={generate.isPending}>
              Generar artículo
            </Button>
            <Button
              size="lg"
              variant="secondary"
              icon={Compass}
              loading={discover.isPending}
              onClick={() =>
                void withToast(discover.mutateAsync(), 'Descubrimiento de keywords en marcha')
              }
            >
              Descubrir keywords
            </Button>
          </>
        }
      />

      {site.settings.onboarding === 'pending' && (
        <div className="mb-6">
          <Notice tone="blue" title="Estamos preparando tu primer artículo">
            Analizamos el estilo de tu tienda y buscamos lo que tus clientes preguntan en Google. En
            unos minutos tendrás un borrador listo para revisar en{' '}
            <Link to="articles" className="underline">
              Artículos
            </Link>
            .
          </Notice>
        </div>
      )}

      {!setupDone && (
        <Card className="mb-6">
          <h2 className="font-medium">Primeros pasos</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.label}>
                <Link
                  to={s.to}
                  className="flex gap-2.5 rounded-lg p-2 hover:bg-stone-50 dark:hover:bg-stone-800"
                >
                  {s.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
                  )}
                  <span className={cx('text-sm', s.done && 'text-stone-500 line-through')}>
                    <span className="font-medium">{s.label}</span>
                    {!s.done && <span className="block text-xs text-stone-500">{s.hint}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Publicados este mes"
          value={stats.publishedThisMonth}
          sub="Enviados a WordPress"
        />
        <Stat label="Keywords pendientes" value={stats.pendingKeywords} />
        <Stat
          label="Tokens del mes"
          value={formatTokens(usage.inputTokens + usage.outputTokens)}
          sub={`${formatTokens(usage.inputTokens)} entrada · ${formatTokens(usage.outputTokens)} salida`}
        />
        <Stat
          label="Coste estimado"
          value={formatCents(usage.costCents)}
          sub="Según tarifas públicas"
        />
      </div>

      <Card className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Plan <strong className="capitalize">{usage.plan}</strong>: {usage.organizationArticles}{' '}
            de {usage.articlesLimit} artículos este mes
            {usage.organizationArticles !== usage.articles && (
              <span className="text-stone-500"> ({usage.articles} en esta tienda)</span>
            )}
          </span>
          {usage.organizationArticles >= usage.articlesLimit * 0.8 && (
            <Link
              to="/billing"
              className="font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Mejorar plan
            </Link>
          )}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
          <div
            className={cx(
              'h-full rounded-full',
              usage.organizationArticles >= usage.articlesLimit ? 'bg-red-600' : 'bg-teal-600',
            )}
            style={{
              width: `${Math.min(100, (usage.organizationArticles / Math.max(1, usage.articlesLimit)) * 100)}%`,
            }}
          />
        </div>
      </Card>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Últimos trabajos</h2>
          <Link to="jobs" className="text-sm text-teal-700 hover:underline dark:text-teal-400">
            Ver todos
          </Link>
        </div>
        {stats.recentJobs.length === 0 ? (
          <EmptyState
            icon={stats.pendingKeywords > 0 ? FileText : KeyRound}
            title="Aún no se ha ejecutado ningún trabajo"
          >
            Cuando generes un artículo o descubras keywords, verás aquí cada paso con su estado,
            duración y errores.
          </EmptyState>
        ) : (
          <Card className="divide-y divide-stone-100 p-0 dark:divide-stone-800 sm:p-0">
            {stats.recentJobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{jobTypeLabel[j.type]}</p>
                  <p className="text-xs text-stone-500">
                    {formatDate(j.createdAt)} · {formatDuration(jobDurationMs(j))}
                  </p>
                </div>
                <StatusBadge status={j.status} label={jobStatusLabel[j.status] ?? j.status} />
              </div>
            ))}
          </Card>
        )}
      </section>
    </>
  );
}
