import {
  BookOpenText,
  FileText,
  Gauge,
  KeyRound,
  ListChecks,
  LogOut,
  Mic2,
  Settings,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useLogout, useMe, useRefreshWhenIdle, useSite, useSites } from '../lib/hooks';
import { ThemeToggle } from './theme';
import { cx, Spinner } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const siteNav: NavItem[] = [
  { to: '', label: 'Panel', icon: Gauge, end: true },
  { to: 'keywords', label: 'Keywords', icon: KeyRound },
  { to: 'articles', label: 'Artículos', icon: FileText },
  { to: 'voice', label: 'Voz de marca', icon: Mic2 },
  { to: 'jobs', label: 'Trabajos', icon: ListChecks },
  { to: 'settings', label: 'Ajustes', icon: Settings },
];

function TopBar({ siteName }: { siteName?: string | undefined }) {
  const { data: me } = useMe();
  const { data: sites } = useSites();
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link to="/sites" className="flex items-center gap-2 font-semibold tracking-tight">
          <BookOpenText className="h-5 w-5 text-teal-700 dark:text-teal-400" />
          <span className="hidden sm:inline">SEO Autopilot</span>
        </Link>
        {siteName && (
          <>
            <span className="text-stone-300 dark:text-stone-700">/</span>
            <Link
              to="/sites"
              className="max-w-[10rem] truncate text-sm text-stone-700 hover:underline dark:text-stone-300 sm:max-w-xs"
              title="Cambiar de sitio"
            >
              {siteName}
              {(sites?.length ?? 0) > 1 && <span className="ml-1 text-stone-400">▾</span>}
            </Link>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {me?.isAdmin && (
            <Link
              to="/admin"
              className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
              aria-label="Administración"
              title="Administración"
            >
              <Shield className="h-5 w-5" />
            </Link>
          )}
          <ThemeToggle />
          <button
            type="button"
            aria-label="Cerrar sesión"
            title={me?.email}
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
            className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}

/** Marco para pantallas sin sitio seleccionado (selector, alta, admin). */
export function PlainLayout() {
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

/** Marco de un sitio: barra lateral en escritorio, barra inferior en móvil. */
export function SiteLayout() {
  const { siteId = '' } = useParams();
  const { data: site, isLoading } = useSite(siteId);
  useRefreshWhenIdle(siteId);

  return (
    <div className="min-h-screen">
      <TopBar siteName={site?.name} />
      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-6 sm:py-8">
        <nav className="hidden w-48 shrink-0 md:block" aria-label="Secciones del sitio">
          <ul className="sticky top-20 space-y-1">
            {siteNav.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  end={i.end}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                      isActive
                        ? 'bg-stone-100 text-teal-800 dark:bg-stone-800 dark:text-teal-300'
                        : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-900',
                    )
                  }
                >
                  <i.icon className="h-4 w-4" />
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 pb-20 md:pb-0">{isLoading ? <Spinner /> : <Outlet />}</main>
      </div>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-stone-200 bg-white/95 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95 md:hidden"
        aria-label="Secciones del sitio"
      >
        {siteNav.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            className={({ isActive }) =>
              cx(
                'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium',
                isActive ? 'text-teal-700 dark:text-teal-400' : 'text-stone-500',
              )
            }
          >
            <i.icon className="h-5 w-5" />
            <span className="max-w-full truncate px-0.5">
              {i.label.replace('Voz de marca', 'Voz')}
            </span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
