# SEO Autopilot

Genera artículos SEO con Claude y los envía a WordPress/WooCommerce (con meta de Yoast) como borrador. Multi-tenant desde el día uno (`Organization → Site → todo`), preparado para convertirse en SaaS.

- **api** — Fastify 4 (REST `/api/v1`, sesión JWT en cookie httpOnly, bull-board en `/admin/queues`)
- **worker** — BullMQ: `brand-voice`, `discover`, `outline`, `write`, `publish` + vigilante de zombis (cada 10 min) y planificador de cadencias (cada 15 min)
- **web** — React + Vite + Tailwind (claro/oscuro, responsive)
- **PostgreSQL 16** y **Redis 7**

## Arranque rápido (Docker)

```bash
node scripts/init-env.mjs        # crea .env y genera JWT_SECRET y ENCRYPTION_KEY
# edita .env: ANTHROPIC_API_KEY=sk-ant-...   (y ADMIN_EMAIL=tu@email.com)
docker compose up -d --build
```

- Frontend: <http://localhost:8080> (el primer usuario que se registra queda como propietario)
- API: <http://localhost:3000/health> → `{"status":"ok","checks":{"db":"ok","redis":"ok"}}`
- Colas: <http://localhost:8080/admin/queues> (solo el usuario de `ADMIN_EMAIL`)

Las migraciones las aplica el servicio `migrate` (one-shot) antes de arrancar api y worker.

> **`ENCRYPTION_KEY` es irrecuperable.** Cifra las credenciales de WordPress (AES-256-GCM). Guárdala en un gestor de contraseñas: si la pierdes, hay que volver a introducir las credenciales de cada sitio.

## Desarrollo local

Requiere Node ≥ 20 y pnpm.

```bash
pnpm install
node scripts/init-env.mjs
docker compose up -d postgres redis
pnpm --filter @seo/db migrate:deploy      # con DATABASE_URL del .env exportada
pnpm build                                # los paquetes compartidos se consumen compilados
pnpm dev:api    # en otra terminal
pnpm dev:worker
pnpm dev:web    # http://localhost:8080 (proxy a la API en :3000)
```

`pnpm test` corre todos los paquetes. Los tests de integración usan bases dedicadas (`seo_test_core`, `seo_test_api`) que crean solas en el Postgres de `docker compose up -d postgres`; si no hay Postgres, se saltan con un aviso.
`pnpm lint`, `pnpm format:check`, `pnpm build`.

## Cómo conectar WordPress

1. WordPress ≥ 5.6 → _Usuarios → Perfil → Contraseñas de aplicación_ → crea una y cópiala (`xxxx xxxx …`).
2. En la app: _Añadir sitio_ con la URL, el usuario y esa contraseña. Al darla de alta se analiza la voz de marca, se descubren keywords y se redacta el **primer artículo** (queda como borrador en _Artículos_).
3. Recomendado: instala el conector (abajo) y pulsa _Ajustes → Probar conexión_.

### Conector de WordPress (Yoast SEO / Rank Math / JSON-LD)

El panel ofrece un plugin ligero, **SEO Autopilot Connector** (`apps/wp-plugin`, se descarga como ZIP desde _Ajustes → Conector de WordPress_; el build del frontend lo empaqueta en `/downloads/seo-autopilot-connector.zip`). Hace tres cosas:

- Registra con `show_in_rest` los campos de **Yoast** (`_yoast_wpseo_*`) y **Rank Math** (`rank_math_*`), para que la keyword principal, la meta description y el título SEO se puedan escribir por la API.
- Imprime en el `<head>` el JSON-LD de cada artículo (preguntas frecuentes), guardado en `_seo_autopilot_schema`.
- Expone `/wp-json/seo-autopilot/v1/status` (versión, plugin SEO activo, WooCommerce). _Probar conexión_ lo usa y avisa si falta o está desactualizado.

Verificado contra WordPress 6 real (Docker): con **Yoast 28.5** la meta se guarda incluso sin el conector (las versiones recientes de Yoast ya la exponen) y la meta description aparece en la página; el JSON-LD solo con el conector. Con **Rank Math** los datos se guardan en sus campos nativos; que los pinte en el `<head>` depende de completar su asistente de configuración.

Sin conector ni plugin, la meta description se guarda igualmente como extracto del post. Quien no quiera instalar plugins tiene un snippet equivalente (sin JSON-LD) en el mismo panel.

## Variables de entorno

Todas están comentadas en [`.env.example`](.env.example). Obligatorias: `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN` (api), `JWT_SECRET` (≥32 car.), `ENCRYPTION_KEY` (32 bytes base64) y `ANTHROPIC_API_KEY` (worker). Si falta o es inválida una obligatoria, el proceso no arranca y lo dice.

## Despliegue

Todas las imágenes se construyen desde la **raíz del repo** (`docker build -f apps/<app>/Dockerfile .`).
Necesitas: Postgres, Redis, y tres procesos: `api`, `worker`, `web`. El worker **debe** estar siempre en marcha (sin él nada se genera). Migraciones: `./node_modules/.bin/prisma migrate deploy` ejecutado en `/app/packages/db` de la imagen `api` (es lo que hace el servicio `migrate`).

Variables por servicio:

| Servicio | Variables                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api      | `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`, `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAIL`, `REGISTRATION_ENABLED`, `FREE_PLAN_MAX_ARTICLES`, opcional `STRIPE_*` (ver Stripe)                                               |
| worker   | `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY` (la **misma** que la api), `ANTHROPIC_API_KEY`, `DEFAULT_MODEL`, `FREE_PLAN_MAX_ARTICLES`, opcionales `SERPAPI_KEY`, `DATAFORSEO_*`, `GOOGLE_CLIENT_*`, `WORKER_CONCURRENCY` |
| web      | `API_UPSTREAM` = URL interna de la api (p. ej. `http://api:3000`). nginx sirve el frontend y proxea `/api` y `/admin` a la api: el navegador ve un solo origen, así la cookie de sesión funciona sin CORS ni TLS cruzado                          |

`WEB_ORIGIN` debe ser exactamente la URL pública del frontend (con `https://`).

### VPS con Docker (recomendado para empezar)

```bash
git clone <repo> && cd seo-autopilot
node scripts/init-env.mjs             # o copia .env.example y rellena a mano
# .env: NODE_ENV lo fija el compose; pon WEB_ORIGIN=https://seo.tudominio.com,
#       ANTHROPIC_API_KEY, ADMIN_EMAIL, y tras crear tu usuario REGISTRATION_ENABLED=false
docker compose up -d --build
```

Pon TLS delante con Caddy (la cookie es `Secure` en producción, así que **necesitas https**):

```
# /etc/caddy/Caddyfile
seo.tudominio.com {
  reverse_proxy localhost:8080
}
```

Cierra los puertos 5432, 6379 y 3000 en el firewall (o quita sus `ports:` del compose): solo debe ser público el 443. Si pruebas por `http` sin TLS, pon `COOKIE_SECURE=false` temporalmente.
Copias de seguridad: `docker compose exec postgres pg_dump -U seo seo > backup.sql` (y guarda `ENCRYPTION_KEY`). Actualizar: `git pull && docker compose up -d --build`.

### Railway

1. Proyecto nuevo → añade los plugins **PostgreSQL** y **Redis**.
2. Crea 3 servicios desde el mismo repo, cada uno con _Dockerfile Path_ `apps/api/Dockerfile`, `apps/worker/Dockerfile` y `apps/web/Dockerfile` (Root Directory = raíz del repo).
3. Variables (usa referencias `${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`) según la tabla anterior. En `web`: `API_UPSTREAM=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3000` y pon `API_PORT=3000` en la api.
4. En la api, _Pre-deploy command_: `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`.
5. Genera dominio público solo para `web`; ese dominio (https) es tu `WEB_ORIGIN`.

### Fly.io

Tres apps (`seo-api`, `seo-worker`, `seo-web`) + `fly postgres create` + Redis (Upstash: `fly redis create`). Ejemplo para la api (`fly.api.toml`; análogo para las otras con su Dockerfile):

```toml
app = "seo-api"
[build]
  dockerfile = "apps/api/Dockerfile"
[deploy]
  release_command = "sh -c 'cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy'"
[env]
  NODE_ENV = "production"
  API_PORT = "3000"
  WEB_ORIGIN = "https://seo-web.fly.dev"
[[services]]
  internal_port = 3000
  protocol = "tcp"
  [[services.ports]]
    handle = ["tls", "http"]
    port = 443
```

```bash
fly launch --no-deploy --config fly.api.toml
fly secrets set --config fly.api.toml DATABASE_URL=... REDIS_URL=... JWT_SECRET=... ENCRYPTION_KEY=... ADMIN_EMAIL=...
fly deploy --config fly.api.toml
# worker: sin [[services]] (no expone puerto) y con ANTHROPIC_API_KEY. Mantén al menos 1 máquina siempre encendida.
# web: API_UPSTREAM=http://seo-api.internal:3000
```

> Las guías de Railway y Fly.io están escritas contra la documentación de cada plataforma pero **no se han probado** en una cuenta real; la de VPS/Docker sí (es lo que corre `docker compose`).

## Cómo funciona el pipeline

`discover` (Autocomplete + puntuación con Claude) → keywords en BD → `outline` → `write` → `publish`.
Idempotentes, con `JobRun` al empezar y al acabar (duración, tokens, error), 3 intentos con backoff exponencial desde 30 s (los 429/5xx de Anthropic se reintentan; los 4xx no). Un vigilante devuelve a `pending` lo que lleve >20 min en `processing`. Toda salida estructurada de Claude va por _tool use_ validado con zod. Los prompts están versionados en `packages/core/src/ai/prompts/`.

Generar a mano (botón _Generar artículo_) se detiene en `ready` para que lo revises. La **cadencia automática** (Ajustes) genera cada día/semana la mejor keyword pendiente y la envía a WordPress (como borrador salvo que actives la publicación automática).

## Calidad de los artículos

- **SERP antes del esquema** (`SERPAPI_KEY`): el top 10 de Google para la keyword, con los H2/H3 y la longitud de los 5 primeros, entra en el prompt del esquema (cubrir lo que todos tratan y añadir lo que falta). Se guarda en `Article.serp` y el editor lo muestra.
- **Volumen y dificultad** (`DATAFORSEO_*`): discover mezcla la puntuación de Claude (60 %) con la demanda real (40 %); `sync` completa cada día las keywords manuales o de Search Console que no las tienen.
- **Productos**: con WooCommerce, el artículo puede recomendar hasta 3 productos que encajen (Store API pública); se insertan con el shortcode nativo `[products ids="…"]` (precio, stock y botón siempre al día) y la foto del primero pasa a ser la imagen destacada. Se desactiva en Ajustes.
- **Datos estructurados**: FAQPage generado de las preguntas **visibles** del artículo (h3 de la última sección) y Article solo si no hay Yoast/Rank Math (ellos ya lo emiten). Lo imprime el conector.
- **E-E-A-T**: en Ajustes, la experiencia real del negocio (única fuente de afirmaciones de primera mano) y el autor de WordPress que firma.
- **Análisis on-page** en el editor (`analyzeOnPage` en `@seo/shared`): keyword en título/meta/URL/intro/H2, densidad, longitudes, enlaces internos, FAQ y longitud de frase.
- Tablas permitidas para comparativas.

## Rendimiento: Search Console y ventas

La página _Rendimiento_ de cada tienda muestra clics, impresiones y posición reales de los artículos, cuáles pierden tráfico y las **oportunidades** (búsquedas por las que la tienda ya aparece entre las posiciones 8 y 20). Lo alimenta el trabajo `sync`, que el worker encola una vez al día por tienda (y el botón _Sincronizar_):

- **Posts**: relee de WordPress el estado y la URL definitiva de cada artículo enviado (un borrador pasa de `?p=ID` a su enlace al publicarse).
- **Search Console**: métricas diarias por artículo (90 días la primera vez, después se relee la última semana porque Google corrige datos), oportunidades como keywords con origen `gsc` (sin las de marca ni las que ya posiciona un artículo propio, que serían canibalización) y **caída**: un artículo que pierde más del 30 % de clics frente a los 28 días anteriores queda marcado para refrescar.
- **Ventas** (planes Pro y Agency, WooCommerce 8.5+ y conector ≥ 1.1): pedidos cuya sesión **empezó** en un artículo, según la atribución nativa de WooCommerce. No se añaden UTM a los enlaces internos (pisarían la fuente real de la visita).

Configurar Google (una vez por servidor):

1. Google Cloud → _APIs y servicios_ → habilita **Google Search Console API**.
2. _Pantalla de consentimiento OAuth_: tipo externo, scopes `openid`, `email` y `.../auth/webmasters.readonly` (solo lectura). Mientras esté en modo _Testing_, añade como usuarios de prueba las cuentas que vayan a conectar; para abrirlo a clientes hay que pasar la verificación de Google.
3. _Credenciales_ → ID de cliente OAuth de tipo **Aplicación web**, con URI de redirección `https://<tu-dominio>/api/v1/integrations/google/callback`.
4. `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en la api **y** el worker (el worker refresca los tokens).

El refresh token se guarda cifrado con `ENCRYPTION_KEY`, como las credenciales de WordPress, y nunca sale en respuestas ni logs. Desconectar revoca el token en Google y borra las métricas importadas.

## Planes, cuotas y Stripe

Planes en `packages/shared/src/plans.ts` (fuente única para api, panel y landing): **Free** (1 tienda, `FREE_PLAN_MAX_ARTICLES` artículos/mes, por defecto 3), **Starter** 19 € (1 tienda, 20/mes), **Pro** 49 € (5 tiendas, 100/mes) y **Agency** 149 € (25 tiendas, 400/mes, marca blanca). El tope de artículos es **por organización** (suma de todas sus tiendas); lo aplica `assertQuota` (`packages/core/src/pipeline/quota.ts`).

Sin Stripe configurado todo funciona y el plan se cambia a mano: `UPDATE "Organization" SET plan = 'pro' WHERE id = '...'`.

### Stripe

1. En Stripe crea un producto por plan (Starter, Pro, Agency) con un precio **mensual recurrente** en EUR y copia cada `price_...` a `STRIPE_PRICE_STARTER/PRO/AGENCY`.
2. _Developers → API keys_: la secret key a `STRIPE_SECRET_KEY`.
3. _Developers → Webhooks_: endpoint `https://<tu-dominio>/api/v1/billing/webhook` con los eventos `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused` y `customer.subscription.resumed`. Su signing secret a `STRIPE_WEBHOOK_SECRET`.
4. _Settings → Billing → Customer portal_: actívalo (facturas, método de pago y cancelación).
5. Opcional: activa Stripe Tax y pon `STRIPE_AUTOMATIC_TAX=true` para cobrar el IVA por país.

El webhook relee la suscripción de Stripe en cada evento, así que el orden de llegada da igual y reenviar eventos es seguro. Con una suscripción activa, cambiar de plan en el panel cambia el precio en Stripe al instante (con prorrateo) sin volver a pasar por Checkout.
