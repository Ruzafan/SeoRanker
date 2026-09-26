import type {
  ArticleStatus,
  ErrorCode,
  JobType,
  KEYWORD_SOURCES,
  KeywordStatus,
  WarningCode,
} from '@seo/shared';
import { ApiError } from './api';

/** Traducción de códigos de error del backend. Tipado exhaustivo: un código nuevo no compila sin traducir. */
export const errorMessages: Record<ErrorCode | 'NETWORK_ERROR', string> = {
  VALIDATION_ERROR: 'Hay datos no válidos. Revisa los campos marcados.',
  UNAUTHORIZED: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  FORBIDDEN: 'No tienes permiso para hacer esto.',
  NOT_FOUND: 'No se ha encontrado lo que buscas.',
  CONFLICT: 'La acción entra en conflicto con el estado actual.',
  RATE_LIMITED: 'Demasiadas peticiones. Espera un momento antes de reintentar.',
  INVALID_CREDENTIALS: 'Email o contraseña incorrectos.',
  EMAIL_TAKEN: 'Ya existe una cuenta con ese email.',
  REGISTRATION_DISABLED: 'El registro está deshabilitado en este servidor.',
  INVALID_URL:
    'La URL no es válida o apunta a una dirección no permitida (localhost o red privada).',
  CONNECTION_FAILED:
    'No se pudo conectar con el sitio. Comprueba que está accesible y vuelve a probar.',
  WP_AUTH_FAILED: 'WordPress rechazó el usuario o la contraseña de aplicación.',
  WP_REST_NOT_FOUND:
    'No se encontró la API REST de WordPress en esa URL. Revisa la dirección y que los enlaces permanentes no estén en «Simple».',
  NO_CREDENTIALS: 'Este sitio no tiene credenciales de WordPress. Añádelas en Ajustes.',
  NO_SEEDS:
    'No hay semillas ni contenido publicado del que deducirlas. Publica algo en la tienda o añade semillas en Ajustes.',
  INVALID_STATE: 'Esa acción no se puede hacer en el estado actual.',
  PLAN_SITE_LIMIT:
    'Tu plan no admite más tiendas. Cambia de plan para conectar otra o elimina una que no uses.',
  PLATFORM_NOT_SUPPORTED: 'Esa plataforma todavía no está disponible. De momento, WordPress.',
  BILLING_NOT_CONFIGURED: 'Los pagos no están activados en este servidor.',
  OWNER_REQUIRED: 'Solo el propietario de la cuenta puede hacer esto.',
  GOOGLE_NOT_CONFIGURED: 'La conexión con Google no está activada en este servidor.',
  GOOGLE_AUTH_FAILED: 'Google rechazó el acceso o ha caducado. Vuelve a conectar Search Console.',
  GSC_NOT_CONNECTED: 'Conecta Search Console para ver esta información.',
  PLAN_FEATURE_REQUIRED: 'Tu plan no incluye esta función. Puedes ampliarlo en Plan y facturación.',
  APPROVAL_REQUIRED: 'Este artículo necesita la aprobación del cliente antes de publicarse.',
  MEMBER_LIMIT: 'Tu plan no admite más usuarios. Amplíalo o quita a alguien del equipo.',
  INVITATION_INVALID: 'La invitación no existe, ya se usó o ha caducado. Pide un enlace nuevo.',
  QUOTA_EXCEEDED:
    'Has alcanzado el límite mensual de artículos de tu plan. Puedes ampliarlo en Plan y facturación.',
  AI_ERROR: 'Falló la llamada a Claude. Suele ser temporal; reintenta en unos minutos.',
  AI_TRUNCATED:
    'La respuesta de Claude se cortó por longitud. Reduce las palabras por artículo y regenera.',
  AI_INVALID_OUTPUT: 'Claude devolvió un resultado que no se pudo validar.',
  NOT_IMPLEMENTED: 'Esta función aún no está disponible.',
  WATCHDOG_TIMEOUT: 'El trabajo no terminó a tiempo y se marcó como fallido.',
  INTERNAL_ERROR: 'Error interno del servidor.',
  NETWORK_ERROR: 'No se pudo contactar con el servidor.',
};

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return errorMessages[err.code] ?? errorMessages.INTERNAL_ERROR;
  return err instanceof Error ? err.message : 'Error desconocido';
}

/** Un JobRun guarda `CODIGO: detalle`. Devuelve el texto traducido y el detalle técnico. */
export function parseJobError(error: string | null): { text: string; detail: string } | null {
  if (!error) return null;
  const m = /^([A-Z_]+):\s*([\s\S]*)$/.exec(error);
  const code = m?.[1] as ErrorCode | undefined;
  if (code && code in errorMessages) return { text: errorMessages[code], detail: m?.[2] ?? '' };
  return { text: error, detail: '' };
}

export const warningMessages: Record<WarningCode, string> = {
  YOAST_META_NOT_EXPOSED:
    'Tu plugin SEO no expone sus campos por la API REST: la meta description y la keyword principal no se han podido guardar. Instala el conector.',
  YOAST_NOT_DETECTED:
    'No se ha detectado Yoast SEO ni Rank Math. Los artículos se publican igual, pero sin su meta SEO.',
  CONNECTOR_NOT_INSTALLED:
    'El conector de WordPress no está instalado: sin él no se guardan la meta SEO ni los datos estructurados.',
  CONNECTOR_OUTDATED: 'Hay una versión nueva del conector de WordPress. Descárgala y actualízalo.',
};

export const keywordStatusLabel: Record<KeywordStatus, string> = {
  pending: 'Pendiente',
  queued: 'En cola',
  processing: 'Procesando',
  done: 'Hecha',
  failed: 'Fallida',
  discarded: 'Descartada',
};

export const keywordSourceLabel: Record<(typeof KEYWORD_SOURCES)[number], string> = {
  manual: 'Manual',
  autocomplete: 'Autocompletado de Google',
  paa: 'La gente también pregunta',
  gsc: 'Search Console (ya asomas)',
  import: 'Importada',
};

export const articleStatusLabel: Record<ArticleStatus, string> = {
  draft: 'Borrador',
  writing: 'Redactando',
  ready: 'Listo',
  publishing: 'Publicando',
  published: 'En WordPress',
  failed: 'Fallido',
};

export const jobTypeLabel: Record<JobType, string> = {
  discover: 'Descubrir keywords',
  outline: 'Esquema',
  write: 'Redacción',
  publish: 'Publicación',
  'brand-voice': 'Voz de marca',
  sync: 'Sincronización (Google y tienda)',
  cluster: 'Agrupar en clusters',
  backlink: 'Enlazado inverso',
  refresh: 'Refresco de contenido',
  'ai-visibility': 'Visibilidad en IA',
  watchdog: 'Vigilante',
  schedule: 'Programación',
};

export const jobStatusLabel: Record<string, string> = {
  queued: 'En cola',
  running: 'En curso',
  succeeded: 'Correcto',
  failed: 'Fallido',
};

export const intentLabel: Record<string, string> = {
  informational: 'Informativa',
  commercial: 'Comercial',
  transactional: 'Transaccional',
};

export const cadenceLabel: Record<string, string> = {
  off: 'Desactivada',
  daily: 'Diaria',
  weekly: 'Semanal',
};
