import { ArrowRight, BookOpenText } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { COMPARISONS, VERTICALS } from '../public/content';
import { PUBLIC_PAGES } from '../public/pages-meta';
import { useMe } from '../lib/hooks';
import { ThemeToggle } from './theme';
import { Button } from './ui';

/** Título y descripción al navegar en el cliente (el HTML prerenderizado ya los trae). */
export function usePageMeta(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = PUBLIC_PAGES.find((p) => p.path === pathname);
    if (!page) return;
    document.title = page.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', page.description);
  }, [pathname]);
}

export function PrimaryCta({ children }: { children?: ReactNode }) {
  const { data: me } = useMe();
  return (
    <Link to={me ? '/app' : '/login'}>
      <Button size="lg" icon={ArrowRight}>
        {me ? 'Ir al panel' : (children ?? 'Empezar gratis')}
      </Button>
    </Link>
  );
}

export function SectionTitle({
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

function Nav() {
  const { data: me } = useMe();
  const link = 'hover:text-stone-900 dark:hover:text-white';
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-stone-50/85 backdrop-blur dark:border-stone-800/70 dark:bg-stone-950/85">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <BookOpenText className="h-5 w-5 text-teal-700 dark:text-teal-400" />
          SEO Autopilot
        </Link>
        <nav className="hidden gap-5 text-sm text-stone-600 dark:text-stone-400 md:flex">
          <a href="/#como-funciona" className={link}>
            Cómo funciona
          </a>
          <a href="/#demo" className={link}>
            Pruébalo
          </a>
          <Link to="/ejemplo" className={link}>
            Ejemplo
          </Link>
          <a href="/#precios" className={link}>
            Precios
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {me ? (
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

function Footer() {
  return (
    <footer className="border-t border-stone-200 py-10 text-sm text-stone-500 dark:border-stone-800">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-3">
        <div>
          <p className="font-semibold text-stone-800 dark:text-stone-200">SEO Autopilot</p>
          <p className="mt-2">
            Artículos SEO automáticos para tiendas WooCommerce, con la voz de tu marca.
          </p>
        </div>
        <div>
          <p className="font-medium text-stone-700 dark:text-stone-300">Comparativas</p>
          <ul className="mt-2 space-y-1">
            {COMPARISONS.map((c) => (
              <li key={c.slug}>
                <Link to={`/comparativa/${c.slug}`} className="hover:underline">
                  SEO Autopilot vs {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium text-stone-700 dark:text-stone-300">Por sector</p>
          <ul className="mt-2 space-y-1">
            {VERTICALS.map((v) => (
              <li key={v.slug}>
                <Link to={`/tiendas/${v.slug}`} className="hover:underline">
                  SEO para tiendas de {v.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-8 text-center">© 2026 SEO Autopilot · seoranker.tech</p>
    </footer>
  );
}

/** Marco de las páginas públicas (landing, ejemplo, comparativas, sectores). */
export function PublicLayout({ children }: { children: ReactNode }) {
  usePageMeta();
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
