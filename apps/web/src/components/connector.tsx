import { CheckCircle2, Download, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { CONNECTOR_VERSION, isOlderVersion, type SiteSettings } from '@seo/shared';
import { YOAST_SNIPPET } from '../lib/format';
import { Badge, Button, Card } from './ui';

export const CONNECTOR_ZIP_URL = '/downloads/seo-autopilot-connector.zip';

const SEO_PLUGIN_NAME = { yoast: 'Yoast SEO', rankmath: 'Rank Math' } as const;

type ConnectorState = 'unknown' | 'missing' | 'outdated' | 'ok';

export function connectorState(settings: SiteSettings): ConnectorState {
  if (settings.connectorVersion === null) {
    return settings.seoPlugin === null && settings.yoastMetaExposed === null
      ? 'unknown'
      : 'missing';
  }
  return isOlderVersion(settings.connectorVersion, CONNECTOR_VERSION) ? 'outdated' : 'ok';
}

/** Estado del plugin conector de WordPress con su descarga e instrucciones. */
export function ConnectorCard({ settings }: { settings: SiteSettings }) {
  const state = connectorState(settings);
  const seo = settings.seoPlugin ? SEO_PLUGIN_NAME[settings.seoPlugin] : null;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-medium">
            <Plug className="h-4 w-4" /> Conector de WordPress
            {state === 'ok' && <Badge tone="green">v{settings.connectorVersion} activo</Badge>}
            {state === 'outdated' && (
              <Badge tone="amber">v{settings.connectorVersion}: actualízalo</Badge>
            )}
            {state === 'missing' && <Badge tone="amber">No instalado</Badge>}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-stone-600 dark:text-stone-400">
            Un plugin ligero que permite rellenar la keyword y la meta description de{' '}
            {seo ?? 'Yoast SEO o Rank Math'} y publicar los datos estructurados (FAQ) de cada
            artículo. No guarda datos ni llama a servicios externos.
          </p>
        </div>
        <a href={CONNECTOR_ZIP_URL} download>
          <Button type="button" variant={state === 'ok' ? 'secondary' : 'primary'} icon={Download}>
            Descargar v{CONNECTOR_VERSION}
          </Button>
        </a>
      </div>

      {state === 'ok' ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {seo ? `${seo} detectado: ` : ''}la meta SEO y el JSON-LD se guardarán al publicar.
        </p>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>Descarga el ZIP.</li>
          <li>
            En WordPress: <em>Plugins → Añadir nuevo → Subir plugin</em>, elige el ZIP y actívalo.
          </li>
          <li>
            Vuelve aquí y pulsa <strong>Probar conexión</strong>.
          </li>
        </ol>
      )}

      <details className="text-xs text-stone-600 dark:text-stone-400">
        <summary className="cursor-pointer">
          ¿Prefieres no instalar plugins? Usa este snippet
        </summary>
        <p className="mt-2">
          Pégalo en el <code>functions.php</code> de tu tema o en un plugin de snippets. Cubre la
          meta de Yoast y Rank Math, pero no los datos estructurados.
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-stone-100 p-2 text-[11px] leading-snug dark:bg-black/30">
          {YOAST_SNIPPET}
        </pre>
        <Button
          type="button"
          variant="secondary"
          className="mt-2"
          onClick={() =>
            void navigator.clipboard.writeText(YOAST_SNIPPET).then(() => toast.success('Copiado'))
          }
        >
          Copiar snippet
        </Button>
      </details>
    </Card>
  );
}
