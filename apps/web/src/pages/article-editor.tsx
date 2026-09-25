import { ArrowLeft, ExternalLink, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Notice,
  Spinner,
  StatusBadge,
  cx,
  inputClass,
} from '../components/ui';
import {
  useArticle,
  useDeleteArticle,
  useJobs,
  usePatchArticle,
  usePublishArticle,
  useRegenerateArticle,
  useSite,
  withToast,
} from '../lib/hooks';
import { articleStatusLabel, errorText, parseJobError, warningMessages } from '../lib/i18n';
import { OnPagePanel, SerpPanel } from '../components/onpage-panel';
import { WorkflowPanel } from '../components/workflow-panel';

const TITLE_MAX = 60;
const META_MAX = 155;

function Counter({ value, max }: { value: number; max: number }) {
  const over = value > max;
  return (
    <span
      className={cx(
        'text-xs tabular-nums',
        over ? 'font-medium text-red-600 dark:text-red-400' : 'text-stone-500',
      )}
    >
      {value}/{max}
      {over && ' · demasiado largo, Google lo recortará'}
    </span>
  );
}

const PREVIEW_STYLES =
  '<style>body{font:16px/1.65 system-ui,sans-serif;max-width:42rem;margin:1rem auto;padding:0 1rem;color:#1c1917}h2{margin-top:1.8em}a{color:#0f766e}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6d3d1;padding:.4em .6em;text-align:left}.product{border:1px dashed #0d9488;border-radius:.5rem;padding:.8em 1em;color:#115e59;background:#f0fdfa;margin:1em 0}</style>';

/** En la vista previa, el shortcode de WooCommerce se muestra como un hueco de tarjeta. */
function previewHtml(html: string): string {
  return html.replace(
    /\[products ids="(\d+)"[^\]]*\]/g,
    '<div class="product">🛒 Tarjeta del producto #$1 (precio y botón de compra en tu tienda)</div>',
  );
}

export function ArticleEditorPage() {
  const { siteId = '', articleId = '' } = useParams();
  const navigate = useNavigate();
  const listPath = `/sites/${siteId}/articles`;
  const { data: site } = useSite(siteId);
  const { data: article, isLoading, error } = useArticle(articleId);
  const { data: jobs } = useJobs(siteId);
  const patch = usePatchArticle(siteId, articleId);
  const publish = usePublishArticle(siteId, articleId);
  const regenerate = useRegenerateArticle(siteId, articleId);
  const del = useDeleteArticle(siteId, articleId);

  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState('');
  const [html, setHtml] = useState('');
  const [tab, setTab] = useState<'html' | 'preview'>('html');
  const [dirty, setDirty] = useState(false);

  // Carga los datos del servidor salvo que haya ediciones sin guardar (el polling no debe pisarlas).
  useEffect(() => {
    if (article && !dirty) {
      setTitle(article.title);
      setMeta(article.metaDescription ?? '');
      setHtml(article.contentHtml ?? '');
    }
  }, [article, dirty]);

  const lastPublishJob = useMemo(
    () => jobs?.items.find((j) => j.type === 'publish' && j.refId === articleId),
    [jobs, articleId],
  );
  const lastWriteJob = useMemo(
    () => jobs?.items.find((j) => j.type === 'write' && j.refId === articleId),
    [jobs, articleId],
  );

  if (isLoading) return <Spinner />;
  if (error || !article) return <ErrorBanner error={error} />;

  const busy = article.status === 'writing' || article.status === 'publishing';
  const failedJob = [lastPublishJob, lastWriteJob].find((j) => j?.status === 'failed');
  const jobError = parseJobError(failedJob?.error ?? null);
  const yoastWarn =
    site?.settings.yoastMetaExposed === false ||
    (Array.isArray(lastPublishJob?.meta?.['warnings']) &&
      (lastPublishJob.meta['warnings'] as string[]).includes('YOAST_META_NOT_EXPOSED'));

  const save = async (): Promise<boolean> => {
    const res = await withToast(
      patch.mutateAsync({ title, metaDescription: meta || null, contentHtml: html }),
    );
    if (res) setDirty(false);
    return !!res;
  };

  const onPublish = async () => {
    if (dirty && !(await save())) return;
    await withToast(publish.mutateAsync(), 'Enviando a WordPress…');
  };

  const set =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  return (
    <>
      <Link
        to={listPath}
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-600 hover:underline dark:text-stone-400"
      >
        <ArrowLeft className="h-4 w-4" /> Artículos
      </Link>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={article.status} label={articleStatusLabel[article.status]} />
        {article.wordCount > 0 && <Badge>{article.wordCount} palabras</Badge>}
        {article.remoteUrl && (
          <a
            href={article.remoteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-teal-700 hover:underline dark:text-teal-400"
          >
            Ver en WordPress <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {busy && (
        <div className="mb-4">
          <Notice
            tone="blue"
            title={
              article.status === 'writing'
                ? 'Claude está redactando el artículo…'
                : 'Publicando en WordPress…'
            }
          >
            Esta página se actualiza sola cada pocos segundos. Puedes salir y volver.
          </Notice>
        </div>
      )}
      {jobError && !busy && (
        <div className="mb-4">
          <ErrorBox text={jobError.text} detail={jobError.detail} />
        </div>
      )}
      {yoastWarn && (
        <div className="mb-4">
          <Notice title={warningMessages.YOAST_META_NOT_EXPOSED}>
            <p>
              Instala el{' '}
              <Link to={`/sites/${siteId}/settings`} className="font-medium underline">
                conector de WordPress
              </Link>{' '}
              (un clic, sin tocar código) y vuelve a publicar. Mientras tanto, la meta description
              se ha guardado como extracto del post.
            </p>
          </Notice>
        </div>
      )}

      <Card className="space-y-4">
        <Field label="Título (H1)" error={undefined}>
          <input
            className={inputClass}
            value={title}
            disabled={busy}
            onChange={(e) => set(setTitle)(e.target.value)}
          />
          <Counter value={title.length} max={TITLE_MAX} />
        </Field>
        <Field label="Meta description">
          <textarea
            className={cx(inputClass, 'min-h-20')}
            value={meta}
            disabled={busy}
            onChange={(e) => set(setMeta)(e.target.value)}
          />
          <Counter value={meta.length} max={META_MAX} />
        </Field>

        <div>
          <div className="mb-2 flex items-center gap-1 border-b border-stone-200 dark:border-stone-800">
            {(['html', 'preview'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cx(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                  tab === t
                    ? 'border-teal-600 text-teal-800 dark:text-teal-300'
                    : 'border-transparent text-stone-500 hover:text-stone-800',
                )}
              >
                {t === 'html' ? 'HTML' : 'Vista previa'}
              </button>
            ))}
          </div>
          {tab === 'html' ? (
            <textarea
              className={cx(inputClass, 'min-h-[28rem] font-mono text-xs leading-relaxed')}
              value={html}
              disabled={busy}
              spellCheck={false}
              onChange={(e) => set(setHtml)(e.target.value)}
              placeholder={
                busy ? 'Redactando…' : 'El contenido aparecerá aquí cuando esté redactado.'
              }
            />
          ) : (
            <iframe
              title="Vista previa del artículo"
              sandbox=""
              srcDoc={`${PREVIEW_STYLES}<h1>${escapeHtml(title)}</h1>${previewHtml(html)}`}
              className="h-[28rem] w-full rounded-lg border border-stone-200 bg-white dark:border-stone-700"
            />
          )}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <OnPagePanel
          keyword={article.keyword}
          title={title}
          meta={meta}
          slug={article.slug}
          html={html}
          targetWords={site?.settings.wordCount ?? 1200}
        />
        {article.serp && <SerpPanel serp={article.serp} />}
      </div>

      <WorkflowPanel siteId={siteId} article={article} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          icon={Save}
          variant="secondary"
          disabled={!dirty || busy}
          loading={patch.isPending}
          onClick={() => void save()}
        >
          Guardar cambios
        </Button>
        <Button
          icon={Send}
          disabled={busy || !html}
          loading={publish.isPending}
          onClick={() => void onPublish()}
        >
          {article.remotePostId ? 'Actualizar en WordPress' : 'Enviar a WordPress'}
        </Button>
        <Button
          icon={RefreshCw}
          variant="secondary"
          disabled={busy}
          loading={regenerate.isPending}
          onClick={() =>
            window.confirm(
              'Se descartará el texto actual y Claude lo escribirá de nuevo. ¿Continuar?',
            ) &&
            void withToast(regenerate.mutateAsync(), 'Regenerando…').then(() => setDirty(false))
          }
        >
          Regenerar
        </Button>
        <Button
          icon={Trash2}
          variant="ghost"
          className="ml-auto text-red-700 dark:text-red-400"
          disabled={busy}
          onClick={() => {
            if (!window.confirm('¿Eliminar este artículo? No se borra de WordPress.')) return;
            del.mutate(undefined, {
              onSuccess: () => {
                toast.success('Artículo eliminado');
                navigate(listPath);
              },
              onError: (e) => toast.error(errorText(e)),
            });
          }}
        >
          Eliminar
        </Button>
      </div>
      <p className="mt-3 text-xs text-stone-500">
        {site?.settings.autoPublish
          ? 'Publicación automática activada: se publicará directamente.'
          : 'Se enviará a WordPress como borrador; publícalo desde allí cuando quieras.'}
      </p>
    </>
  );
}

function ErrorBox({ text, detail }: { text: string; detail: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <p className="font-medium">{text}</p>
      {detail && <p className="mt-0.5 break-words text-xs opacity-80">{detail}</p>}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
