# SEO Autopilot

Monorepo pnpm: generación automática de artículos SEO para WordPress/WooCommerce (Yoast). Multi-tenant desde el día uno: `Organization → Site → todo lo demás`. Ver README para arranque y despliegue.

## Estructura

- `apps/api` Fastify 4 (REST `/api/v1`), `apps/worker` BullMQ, `apps/web` React + Vite + Tailwind v3 (páginas públicas prerenderizadas en el build: `prerender.mjs`), `apps/wp-plugin` conector de WordPress (PHP; el build web lo sirve como ZIP)
- `packages/core` lógica de negocio (pipeline, providers, adapters, servicios, IA), `packages/db` Prisma + cliente (+ `@seo/db/testing`), `packages/shared` schemas zod, DTOs y códigos de error api↔web

Dónde está qué en `packages/core/src`: `services/` (lo que llaman las rutas; `billing.ts` = Stripe), `pipeline/` (trabajos: brand-voice, discover, outline, write, publish, sync, cluster, backlink, refresh, ai-visibility, watchdog, scheduler), `ai/claude.ts` (único módulo que habla con Anthropic) y `ai/prompts/` (uno por archivo, versionados), `adapters/` (WordPress real, Shopify = contrato), `keywords/` (`provider.ts` Autocomplete/PAA, `metrics.ts` DataForSEO, `serp.ts`, `similarity.ts` anticanibalización), `integrations/google.ts` (OAuth + Search Console), `seo/schema.ts` (JSON-LD), `tenant.ts` (aislamiento por sitio), `queue.ts` (un tipo de trabajo = una cola; `PipelineJobType` sale de `QUEUE_NAMES`).

## Comandos

- `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm format:check` (los paquetes compartidos se consumen **compilados**: `pnpm build` antes de tests/dev)
- `node scripts/init-env.mjs` crea `.env` con secretos generados
- `docker compose up -d --build` levanta todo; `docker compose up -d postgres redis` para desarrollo
- Migración nueva: con postgres arriba, `DATABASE_URL=... pnpm --filter @seo/db migrate:dev --name x`
- Tests de integración: usan Postgres en `localhost:5432` (bases `seo_test_*`); sin él se saltan con aviso

## Convenciones (no negociables)

- TypeScript estricto; nada de `any` ni `@ts-ignore`. ESM con extensiones `.js` en los imports relativos.
- Archivos en kebab-case, clases en PascalCase.
- Errores: `AppError` (`code`, `httpStatus`, `retryable`). El backend **nunca** emite texto en español, solo códigos (`ERROR_CODES` en `@seo/shared`); el frontend los traduce en `apps/web/src/lib/i18n.ts` (tipado exhaustivo: un código nuevo no compila sin traducir).
- Nada de lógica de negocio en rutas: validan (zod de `@seo/shared`), llaman a `@seo/core`, responden.
- **Todo acceso a datos de un sitio pasa por `tenant.ts`** (`requireSite/Keyword/Article` + `siteScope`), que fuerza `siteId`. Un recurso ajeno devuelve 404, nunca 403. Hay un test que recorre todas las rutas con otra organización.
- Credenciales de WordPress: AES-256-GCM con `ENCRYPTION_KEY`; nunca en claro, logs ni respuestas (solo `hasCredentials`).
- Salida estructurada de Claude siempre por tool use (schema zod → JSON Schema), nunca JSON en texto.
- Env validado con zod en un único `env.ts` por app; si falta algo, no arranca.
- Estados "en curso" (`processing`, `writing`, `publishing`, `queued`) deben poder recuperarse: si añades uno, contémplalo en `pipeline/watchdog.ts`.
- Roles: `owner` | `member` | `viewer`. El `viewer` (cliente) solo lee; una ruta que no sea GET y deba permitírsele se marca `config: { viewerAllowed: true }` (lo aplica `requireWriter`). Facturación, miembros y marca: solo `owner` (`OWNER_REQUIRED`).
- Funciones de pago: flags en `PLANS` (`@seo/shared/plans.ts`) y comprobación en el servicio (`PLAN_FEATURE_REQUIRED`), nunca solo en el frontend.

## Versiones fijadas a propósito

TypeScript `~5.9`, Prisma `^6` (client y CLI alineados), Fastify `^4` con plugins de su línea (cookie 9, cors 9, helmet 11, rate-limit 9, jwt 8), bull-board `^5` (las líneas 6+ requieren Fastify 5), Vite 6, Tailwind 3, `@node-rs/argon2` (binarios precompilados; `argon2` nativo no compila en la imagen Docker). No subir mayores sin decidirlo.

## Estado

Fases 0–7 y roadmap de producto implementados (Stripe, conector WP, Search Console, calidad SERP/métricas/productos/JSON-LD, landing prerenderizada, clusters/canibalización/enlazado inverso, flujo editorial, visibilidad en IA). Verificado contra WordPress 7.1 + WooCommerce + Yoast 28.5 / Rank Math reales (Docker) y con una llamada real a Claude con búsqueda web. Pendiente de verificar con credenciales reales: Stripe (checkout y webhooks), OAuth de Google/Search Console, DataForSEO, calidad de los artículos con los prompts v2/v3 y despliegue en Railway/Fly. El frontend público está verificado en Chrome headless (hidratación); el panel, por compilación, tipos y un recorrido en navegador.
