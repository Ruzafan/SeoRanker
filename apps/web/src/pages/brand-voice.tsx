import { Loader2, Mic2, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Spinner,
  cx,
  inputClass,
} from '../components/ui';
import { formatDate } from '../lib/format';
import { useAnalyzeVoice, useJobs, useSite, useUpdateSite, withToast } from '../lib/hooks';
import { parseJobError } from '../lib/i18n';

export function BrandVoicePage() {
  const { siteId = '' } = useParams();
  const { data: site } = useSite(siteId);
  const { data: jobs } = useJobs(siteId);
  const update = useUpdateSite(siteId);
  const analyze = useAnalyzeVoice(siteId);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (site && !dirty) setText(site.brandVoice ?? '');
  }, [site, dirty]);

  if (!site) return <Spinner />;

  const lastJob = jobs?.items.find((j) => j.type === 'brand-voice');
  const running = lastJob?.status === 'queued' || lastJob?.status === 'running';
  const failure = lastJob?.status === 'failed' ? parseJobError(lastJob.error) : null;

  return (
    <>
      <PageHeader
        title="Voz de marca"
        description="El perfil de estilo que Claude sigue al escribir. Se compone en el prompt de cada artículo; edítalo a mano cuando quieras."
        actions={
          <Button
            icon={RefreshCw}
            variant="secondary"
            disabled={running || !site.hasCredentials}
            loading={analyze.isPending}
            onClick={() => {
              if (
                site.brandVoice &&
                dirty &&
                !window.confirm('Tienes cambios sin guardar que se perderán. ¿Continuar?')
              )
                return;
              setDirty(false);
              void withToast(analyze.mutateAsync(), 'Analizando tu sitio…');
            }}
          >
            {site.brandVoice ? 'Regenerar desde mi sitio' : 'Generar desde mi sitio'}
          </Button>
        }
      />

      {running && (
        <div className="mb-4">
          <Notice tone="blue" title="Claude está leyendo tu contenido y redactando el perfil…">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Suele tardar menos de un minuto. La
              página se actualiza sola.
            </span>
          </Notice>
        </div>
      )}
      {failure && !running && (
        <div className="mb-4">
          <Notice title={failure.text}>{failure.detail}</Notice>
        </div>
      )}
      {lastJob?.status === 'succeeded' && !dirty && site.brandVoice && (
        <p className="mb-3 text-xs text-stone-500">
          Última generación: {formatDate(lastJob.finishedAt)}
        </p>
      )}

      {!site.brandVoice && !running && !dirty ? (
        <EmptyState icon={Mic2} title="Aún no hay voz de marca">
          {site.hasCredentials
            ? 'Pulsa «Generar desde mi sitio»: leeremos tus entradas, páginas y productos publicados y Claude describirá tu tono, vocabulario y estructura. También puedes escribirlo tú directamente.'
            : 'Primero conecta tu WordPress en Ajustes para poder analizar tu contenido, o escribe el perfil directamente aquí.'}
        </EmptyState>
      ) : null}

      <Card className={cx('mt-4', !site.brandVoice && !dirty && !running && 'hidden')}>
        <textarea
          className={cx(inputClass, 'min-h-[24rem] leading-relaxed')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          aria-label="Perfil de voz de marca"
        />
        <div className="mt-3 flex justify-end">
          <Button
            icon={Save}
            disabled={!dirty}
            loading={update.isPending}
            onClick={() =>
              void withToast(
                update.mutateAsync({ brandVoice: text.trim() || null }),
                'Voz de marca guardada',
              ).then((r) => {
                if (r) setDirty(false);
              })
            }
          >
            Guardar
          </Button>
        </div>
      </Card>
      {!site.brandVoice && !dirty && !running && (
        <div className="mt-4">
          <Button variant="ghost" onClick={() => setDirty(true)}>
            Escribirla a mano
          </Button>
        </div>
      )}
    </>
  );
}
