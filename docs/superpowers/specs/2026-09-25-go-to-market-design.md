# Go-to-market: seeds automáticas, multi-tienda y landing

Fecha: 2026-09-25 · Rama: `feat/go-to-market` · Estado: implementado para revisión

## Objetivo

Pasar de "herramienta para mi tienda" a producto vendible, empezando por uso propio/agencia
(muchas tiendas en una cuenta) y dejando preparado el SaaS abierto (opción **C**).

Tres piezas independientes, en este orden:

1. **Seeds automáticas**: el discover ya no exige que el usuario escriba seeds.
2. **Multi-tienda / preparado para SaaS**: planes con límites, vista general de todas las
   tiendas y selección de plataforma (WordPress hoy; Shopify y otras después).
3. **Landing pública** en `/` que explica el producto, con gráficas.

Fuera de alcance (siguientes pasos): pagos con Stripe, implementar Shopify, datos reales de
tráfico (Search Console) en la landing y en el panel.

## 1. Seeds automáticas

- `PublishingAdapter` gana `listCategories(limit): Promise<string[]>`. WordPress lee
  `product_cat` (WooCommerce) y `categories`, sin fallar si no existe WooCommerce. Shopify
  (contrato) lanza `NotImplementedError`, como el resto.
- Prompt nuevo `ai/prompts/seed-keywords.ts` (`seed-keywords@1`): recibe el inventario de la
  tienda (títulos de productos, páginas y posts, y categorías) y devuelve entre 8 y 15 seeds
  con el término y el motivo. Salida por tool use, con strict.
- `pipeline/seeds.ts` → `generateSeeds(ctx, site, tracker)`. Si el inventario está vacío,
  lanza `NO_SEEDS`: el código de error existente pasa a significar "no hay seeds ni contenido
  para deducirlas".
- `runDiscover`: si `settings.seeds` está vacío, genera las seeds, **las guarda en los ajustes**
  (el usuario puede verlas y editarlas) y continúa normalmente. El meta del JobRun indica
  `seedsGenerated`.
- Scheduler: un sitio con cadencia y sin keywords lanza discover aunque no tenga seeds.

## 2. Multi-tienda y preparado para SaaS

- `@seo/shared` → `PLANS`: `free | pro | agency`, con `maxSites` y `articlesPerMonth`
  (`null` = sin tope). El tope de artículos del plan free sigue leyendo
  `FREE_PLAN_MAX_ARTICLES`, para no romper el `.env`.
  - free: 1 tienda, `FREE_PLAN_MAX_ARTICLES`/mes · pro: 5 tiendas, 100/mes ·
    agency: sin tope de tiendas ni de artículos.
- Crear un sitio comprueba `maxSites` → nuevo error `PLAN_SITE_LIMIT` (402), traducido en
  `i18n.ts`. `articlesLimitForPlan` usa `PLANS`.
- `@seo/shared` → `PLATFORMS`: `wordpress` (disponible) y `shopify` (próximamente), con
  etiqueta. `createSiteSchema` acepta `platform` (por defecto `wordpress`) y rechaza las
  plataformas no disponibles. `createAdapter` elige por `site.platform` y lanza
  `PLATFORM_NOT_SUPPORTED` para las no implementadas. Añadir una plataforma consiste en
  implementar su adapter, registrarlo en la factory y marcarla como disponible.
- Vista general: `GET /api/v1/sites/overview` → por tienda: artículos publicados este mes,
  keywords pendientes, trabajos en curso, último trabajo fallido (código) y uso del mes. Más
  el plan de la organización con sus límites y el número de tiendas. La página `/sites`
  muestra una tarjeta resumen del plan y las métricas por tienda.
- El alta de sitio muestra el selector de plataforma, con Shopify deshabilitado
  ("Próximamente").
- Registro abierto: ya existe (`REGISTRATION_ENABLED`). Las organizaciones nuevas empiezan en
  `free`.

## 3. Landing

- `/` pasa a ser la landing pública. El panel queda en `/app`, que hace lo que hacía antes
  `/`, y el login redirige a `/app`. Si hay sesión, la landing muestra "Ir al panel".
- Secciones: hero, cómo funciona (4 pasos), gráficas, funcionalidades, plataformas, planes
  (desde `PLANS`), FAQ y CTA.
- Gráficas en SVG propio, sin dependencias nuevas: sesiones orgánicas mes a mes (con y sin
  SEO Autopilot) y artículos publicados frente a visitas.
- **Todas las cifras son ilustrativas** y la página lo dice junto a cada gráfica
  ("Datos ilustrativos"). Se sustituirán por datos reales y contrastados antes de publicitar
  nada.

## Pruebas

- Unitarias: adapter de WordPress (`listCategories`) y planes/plataformas en shared.
- Integración (Postgres): discover sin seeds las genera, las guarda e inserta keywords;
  discover sin seeds ni contenido → `NO_SEEDS`; el scheduler lanza discover sin seeds;
  `PLAN_SITE_LIMIT`; la vista general devuelve solo las tiendas propias (aislamiento: 404 /
  vacío para otra organización).
- Web: compilación y tipos (como el resto del frontend).
