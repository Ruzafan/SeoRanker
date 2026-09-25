import {
  ArrowRight,
  BookOpenText,
  Compass,
  FileText,
  Globe,
  Info,
  Mic2,
  PenLine,
  PlugZap,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PLANS, PLAN_IDS, PLATFORM_IDS, PLATFORMS } from '@seo/shared';
import { BarChart, LineChart, SERIES_TONES } from '../components/charts';
import { ThemeToggle } from '../components/theme';
import { Badge, Button, cx } from '../components/ui';
import { useMe } from '../lib/hooks';

/**
 * DATOS ILUSTRATIVOS. No son resultados medidos: sirven para enseñar la forma de la curva
 * mientras no haya casos reales. Sustituir por datos contrastados (p. ej. Search Console de
 * una tienda cliente, con su permiso) antes de usar la landing en publicidad.
 */
const ILLUSTRATIVE = {
  months: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  sessionsWith: [1200, 1260, 1390, 1560, 1790, 2060, 2380, 2720, 3080, 3450, 3830, 4210],
  sessionsWithout: [1200, 1190, 1210, 1180, 1200, 1170, 1190, 1160, 1180, 1150, 1170, 1160],
  articlesPerMonth: [8, 8, 10, 10, 12, 12, 12, 14, 14, 14, 16, 16],
};

const lastWith = ILLUSTRATIVE.sessionsWith.at(-1) ?? 0;
const lastWithout = ILLUSTRATIVE.sessionsWithout.at(-1) ?? 0;
const firstWith = ILLUSTRATIVE.sessionsWith[0] ?? 1;
const growthPct = Math.round((lastWith / firstWith - 1) * 100);
const totalArticles = ILLUSTRATIVE.articlesPerMonth.reduce((a, b) => a + b, 0);

export function LandingPage() {
  const { data: me } = useMe();
  const loggedIn = !!me;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <Nav loggedIn={loggedIn} />
      <main>
        <Hero loggedIn={loggedIn} />
        <HowItWorks />
        <Results />
        <Features />
        <Platforms />
        <Pricing loggedIn={loggedIn} />
        <Faq />
        <FinalCta loggedIn={loggedIn} />
      </main>
      <footer className="border-t border-stone-200 py-8 text-center text-sm text-stone-500 dark:border-stone-800">
        © {new Date().getFullYear()} SEO Autopilot · seoranker.tech
      </footer>
    </div>
  );
}

function PrimaryCta({ loggedIn, children }: { loggedIn: boolean; children?: ReactNode }) {
  return (
    <Link to={loggedIn ? '/app' : '/login'}>
      <Button size="lg" icon={ArrowRight}>
        {loggedIn ? 'Ir al panel' : (children ?? 'Empezar gratis')}
      </Button>
    </Link>
  );
}

function Nav({ loggedIn }: { loggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-stone-50/85 backdrop-blur dark:border-stone-800/70 dark:bg-stone-950/85">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <BookOpenText className="h-5 w-5 text-teal-700 dark:text-teal-400" />
          SEO Autopilot
        </Link>
        <nav className="hidden gap-5 text-sm text-stone-600 dark:text-stone-400 md:flex">
          <a href="#como-funciona" className="hover:text-stone-900 dark:hover:text-white">
            Cómo funciona
          </a>
          <a href="#resultados" className="hover:text-stone-900 dark:hover:text-white">
            Resultados
          </a>
          <a href="#precios" className="hover:text-stone-900 dark:hover:text-white">
            Precios
          </a>
          <a href="#faq" className="hover:text-stone-900 dark:hover:text-white">
            Preguntas
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {loggedIn ? (
            <Link to="/app">
              <Button>Ir al panel</Button>
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden rounded-lg px-3 py-2 text-sm font-medium hover:bg-stone-100 dark:hover:bg-stone-800 sm:block"
              >
                Entrar
              </Link>
              <Link to="/login">
                <Button>Empezar gratis</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 [&>*]:min-w-0 pb-16 pt-14 md:grid-cols-2 md:pt-20">
      <div>
        <Badge tone="blue">
          <Sparkles className="h-3.5 w-3.5" /> Contenido SEO en piloto automático
        </Badge>
        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Más visitas orgánicas para tu tienda online, sin escribir una línea.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-stone-600 dark:text-stone-400">
          Conecta tu WooCommerce y SEO Autopilot descubre qué busca tu cliente, escribe artículos
          con la voz de tu marca y los publica con el SEO de Yoast ya rellenado. Cada semana, en
          todas tus tiendas.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <PrimaryCta loggedIn={loggedIn} />
          <a
            href="#como-funciona"
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Ver cómo funciona
          </a>
        </div>
        <p className="mt-4 text-sm text-stone-500">
          Sin tarjeta · Sin instalar plugins · Tú decides si publica solo o deja borradores
        </p>
      </div>
      <HeroPreview />
    </section>
  );
}

/** Mini "captura" del producto hecha con HTML: keywords puntuadas → artículo publicado. */
function HeroPreview() {
  const rows = [
    { term: 'cómo limpiar figuras de resina', score: 86, intent: 'Informativa' },
    { term: 'mejores vitrinas para coleccionistas', score: 81, intent: 'Comercial' },
    { term: 'figuras de acción articuladas baratas', score: 77, intent: 'Transaccional' },
    { term: 'diferencia entre pvc y resina', score: 72, intent: 'Informativa' },
  ];
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xl shadow-stone-900/5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">Keywords descubiertas</p>
        <Badge tone="green">Automático</Badge>
      </div>
      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
        {rows.map((r) => (
          <li key={r.term} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="w-8 rounded-md bg-teal-50 py-0.5 text-center text-xs font-semibold tabular-nums text-teal-800 dark:bg-teal-950 dark:text-teal-300">
              {r.score}
            </span>
            <span className="min-w-0 flex-1 truncate">{r.term}</span>
            <span className="hidden text-xs text-stone-500 sm:block">{r.intent}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-stone-50 p-3 text-sm dark:bg-stone-800/60">
        <Send className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" />
        <span className="min-w-0 flex-1 truncate">
          Publicado: <strong>Cómo limpiar figuras de resina sin dañarlas</strong>
        </span>
        <Badge tone="green">Yoast OK</Badge>
      </div>
      <p className="mt-2 text-center text-[11px] text-stone-400">Ejemplo ilustrativo</p>
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2>
      {children && <p className="mt-3 text-stone-600 dark:text-stone-400">{children}</p>}
    </div>
  );
}

const steps: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: PlugZap,
    title: 'Conecta tu tienda',
    text: 'URL y contraseña de aplicación de WordPress. Nada que instalar; las credenciales se guardan cifradas.',
  },
  {
    icon: Compass,
    title: 'Descubrimos tus keywords',
    text: 'Leemos tus categorías y productos, deducimos los temas y buscamos lo que tus clientes preguntan en Google.',
  },
  {
    icon: PenLine,
    title: 'Escribimos con tu voz',
    text: 'Claude aprende el tono de tu marca y redacta artículos completos, con estructura, FAQ y enlaces a tus productos.',
  },
  {
    icon: Send,
    title: 'Publicamos con SEO',
    text: 'Título, slug, meta description y keyword de Yoast rellenados. Publica solo o deja borradores para revisar.',
  },
];

function HowItWorks() {
  return (
    <section
      id="como-funciona"
      className="scroll-mt-16 border-y border-stone-200 bg-white py-20 dark:border-stone-800 dark:bg-stone-900/40"
    >
      <div className="mx-auto max-w-6xl px-4">
        <SectionTitle eyebrow="Cómo funciona" title="De cero a publicar, en cuatro pasos">
          Lo configuras una vez. A partir de ahí trabaja solo, con la frecuencia que elijas.
        </SectionTitle>
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="relative rounded-2xl border border-stone-200 p-5 dark:border-stone-800"
            >
              <span className="absolute right-4 top-4 text-sm font-semibold tabular-nums text-stone-300 dark:text-stone-700">
                0{i + 1}
              </span>
              <s.icon className="h-6 w-6 text-teal-700 dark:text-teal-400" />
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function IllustrativeNote() {
  return (
    <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      Datos ilustrativos: muestran la tendencia esperada, no resultados medidos de un cliente.
    </p>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{label}</p>
    </div>
  );
}

function Results() {
  return (
    <section id="resultados" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-6xl px-4">
        <SectionTitle eyebrow="Resultados" title="El contenido constante se acumula en visitas">
          Cada artículo responde a una búsqueda real de tus clientes. Publicar de forma continua
          hace que el tráfico orgánico crezca mes a mes, mientras una tienda sin contenido nuevo se
          queda plana.
        </SectionTitle>

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatTile value={`+${growthPct}%`} label="sesiones orgánicas en 12 meses" />
          <StatTile
            value={`×${(lastWith / lastWithout).toFixed(1)}`}
            label="frente a no publicar contenido"
          />
          <StatTile value={String(totalArticles)} label="artículos publicados en el año" />
        </div>
        <p className="-mt-3 mb-6 text-center text-xs text-amber-800 dark:text-amber-300">
          Cifras calculadas sobre los datos ilustrativos de las gráficas.
        </p>

        <div className="grid gap-6 lg:grid-cols-5">
          <figure className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 lg:col-span-3">
            <figcaption className="mb-3">
              <p className="font-semibold">Sesiones orgánicas al mes</p>
              <p className="text-sm text-stone-500">
                Tienda de ejemplo con 1.200 sesiones de partida
              </p>
            </figcaption>
            <LineChart
              ariaLabel={`Sesiones orgánicas mensuales: con SEO Autopilot pasan de ${firstWith} a ${lastWith}; sin contenido nuevo se mantienen en torno a ${lastWithout}. Datos ilustrativos.`}
              labels={ILLUSTRATIVE.months}
              series={[
                {
                  name: 'Con SEO Autopilot',
                  values: ILLUSTRATIVE.sessionsWith,
                  tone: SERIES_TONES.primary,
                },
                {
                  name: 'Sin contenido nuevo',
                  values: ILLUSTRATIVE.sessionsWithout,
                  tone: SERIES_TONES.compare,
                },
              ]}
            />
            <IllustrativeNote />
          </figure>
          <figure className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 lg:col-span-2">
            <figcaption className="mb-3">
              <p className="font-semibold">Artículos publicados al mes</p>
              <p className="text-sm text-stone-500">Cadencia creciente según avanza el año</p>
            </figcaption>
            <BarChart
              ariaLabel={`Artículos publicados al mes, de ${ILLUSTRATIVE.articlesPerMonth[0]} a ${ILLUSTRATIVE.articlesPerMonth.at(-1)}. Datos ilustrativos.`}
              name="artículos"
              labels={ILLUSTRATIVE.months}
              values={ILLUSTRATIVE.articlesPerMonth}
            />
            <IllustrativeNote />
          </figure>
        </div>
      </div>
    </section>
  );
}

const features: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Compass,
    title: 'Keywords sin configurar nada',
    text: 'Deducimos los temas de tu catálogo y los ampliamos con autocompletado y "La gente también pregunta".',
  },
  {
    icon: Mic2,
    title: 'Tu voz, no la de un robot',
    text: 'Analizamos tus textos publicados y escribimos con el mismo tono, vocabulario y estilo.',
  },
  {
    icon: FileText,
    title: 'Artículos completos',
    text: 'Estructura pensada para la intención de búsqueda, FAQ y enlaces internos solo a páginas que existen.',
  },
  {
    icon: Store,
    title: 'Todas tus tiendas en un panel',
    text: 'Gestiona varias tiendas a la vez: cada una con sus keywords, su voz y su calendario.',
  },
  {
    icon: ShieldCheck,
    title: 'Tú tienes el control',
    text: 'Borradores para revisar o publicación automática. Edita cualquier artículo antes de que salga.',
  },
  {
    icon: Globe,
    title: 'En tu idioma y mercado',
    text: 'Contenido nativo por idioma y país, sin traducciones literales.',
  },
];

function Features() {
  return (
    <section className="border-y border-stone-200 bg-white py-20 dark:border-stone-800 dark:bg-stone-900/40">
      <div className="mx-auto max-w-6xl px-4">
        <SectionTitle
          eyebrow="Funcionalidades"
          title="Todo lo que hace un equipo de contenido, automatizado"
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="flex gap-4">
              <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-teal-700 dark:text-teal-400" />
              <div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Platforms() {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-3xl px-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">
          Plataformas
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Funciona con tu tienda</h2>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {PLATFORM_IDS.map((id) => {
            const p = PLATFORMS[id];
            return (
              <span
                key={id}
                className={cx(
                  'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium',
                  p.available
                    ? 'border-teal-600 text-teal-800 dark:text-teal-300'
                    : 'border-dashed border-stone-300 text-stone-500 dark:border-stone-700',
                )}
              >
                {p.name}
                {!p.available && <Badge>Próximamente</Badge>}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Pricing({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section
      id="precios"
      className="scroll-mt-16 border-y border-stone-200 bg-white py-20 dark:border-stone-800 dark:bg-stone-900/40"
    >
      <div className="mx-auto max-w-6xl px-4">
        <SectionTitle eyebrow="Precios" title="Empieza gratis, crece cuando lo necesites" />
        <div className="grid gap-6 md:grid-cols-3">
          {PLAN_IDS.map((id) => {
            const p = PLANS[id];
            const featured = id === 'pro';
            return (
              <div
                key={id}
                className={cx(
                  'flex flex-col rounded-2xl border p-6',
                  featured
                    ? 'border-teal-600 shadow-lg shadow-teal-900/10'
                    : 'border-stone-200 dark:border-stone-800',
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  {featured && <Badge tone="blue">Más popular</Badge>}
                </div>
                <p className="mt-4">
                  {p.priceEur === null ? (
                    <span className="text-3xl font-semibold">A medida</span>
                  ) : (
                    <>
                      <span className="text-4xl font-semibold tabular-nums">{p.priceEur} €</span>
                      <span className="text-stone-500"> /mes</span>
                    </>
                  )}
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  {p.articlesPerMonth === null
                    ? 'Artículos ilimitados'
                    : `Hasta ${p.articlesPerMonth} artículos/mes por tienda`}
                </p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-teal-700 dark:text-teal-400">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to={loggedIn ? '/app' : '/login'} className="mt-6">
                  <Button variant={featured ? 'primary' : 'secondary'} className="w-full">
                    {p.priceEur === null ? 'Hablemos' : 'Empezar'}
                  </Button>
                </Link>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-xs text-stone-500">
          Precios orientativos, IVA no incluido. El coste de la IA está incluido en el plan.
        </p>
      </div>
    </section>
  );
}

const faqs = [
  {
    q: '¿Google penaliza el contenido escrito con IA?',
    a: 'Google valora que el contenido sea útil, no cómo se ha escrito. Por eso cada artículo responde a una búsqueda concreta, sigue la voz de tu marca y enlaza solo a páginas reales. Y siempre puedes revisarlo antes de publicar.',
  },
  {
    q: '¿Tengo que instalar algo en WordPress?',
    a: 'No. Usamos la API oficial de WordPress con una contraseña de aplicación, que puedes revocar cuando quieras. Para rellenar los campos de Yoast basta con un pequeño fragmento que te damos.',
  },
  {
    q: '¿Publica solo o puedo revisar antes?',
    a: 'Tú eliges por tienda: dejar borradores en WordPress para revisarlos o publicar automáticamente con la frecuencia que marques.',
  },
  {
    q: '¿Cuándo se notan los resultados?',
    a: 'El SEO es acumulativo: los primeros artículos suelen empezar a posicionar en semanas y el efecto crece a medida que publicas. Depende de tu sector y de la competencia de cada búsqueda.',
  },
  {
    q: '¿Y si tengo Shopify?',
    a: 'Estamos preparando la integración con Shopify. Mientras tanto, SEO Autopilot funciona con WordPress y WooCommerce.',
  },
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 py-20">
      <div className="mx-auto max-w-3xl px-4">
        <SectionTitle eyebrow="Preguntas" title="Preguntas frecuentes" />
        <div className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {faqs.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {f.q}
                <span className="text-stone-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="px-4 pb-20">
      <div className="mx-auto max-w-4xl rounded-3xl bg-teal-800 px-6 py-12 text-center text-white dark:bg-teal-900">
        <h2 className="text-3xl font-semibold tracking-tight">
          Tu próximo artículo puede salir hoy
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-teal-100">
          Conecta tu tienda en dos minutos. Las keywords y la voz de marca se configuran solas.
        </p>
        <div className="mt-6 flex justify-center">
          <Link to={loggedIn ? '/app' : '/login'}>
            <Button size="lg" variant="secondary" icon={ArrowRight}>
              {loggedIn ? 'Ir al panel' : 'Empezar gratis'}
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
