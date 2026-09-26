import {
  BookOpenText,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Users,
  FileText,
  Gauge,
  KeyRound,
  LineChart,
  ListChecks,
  LogOut,
  MoreHorizontal,
  Mic2,
  Settings,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
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
  { to: 'performance', label: 'Rendimiento', icon: LineChart },
  { to: 'keywords', label: 'Keywords', icon: KeyRound },
  { to: 'articles', label: 'Artículos', icon: FileText },
  { to: 'calendar', label: 'Calendario', icon: CalendarDays },
  { to: 'report', label: 'Informe', icon: ClipboardList },
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
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur print:hidden dark:border-stone-800 dark:bg-stone-950/90">
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
          <Link
            to="/organization"
            className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
            aria-label="Equipo y clientes"
            title="Equipo y clientes"
          >
            <Users className="h-5 w-5" />
          </Link>
          <Link
            to="/billing"
            className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
            aria-label="Plan y facturación"
            title={me ? `Plan ${me.plan}` : 'Plan y facturación'}
          >
            <CreditCard className="h-5 w-5" />
          </Link>
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
        <nav
          className="hidden w-48 shrink-0 print:hidden md:block"
          aria-label="Secciones del sitio"
        >
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
      <MobileNav />
    </div>
  );
}

/** En móvil caben 4 secciones legibles; el resto va en «Más». */
const MOBILE_PRIMARY = ['', 'performance', 'keywords', 'articles'];

function MobileNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const primary = siteNav.filter((i) => MOBILE_PRIMARY.includes(i.to));
  const more = siteNav.filter((i) => !MOBILE_PRIMARY.includes(i.to));
  const item = (active: boolean) =>
    cx(
      'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
      active ? 'text-teal-700 dark:text-teal-400' : 'text-stone-500',
    );
  return (
    <div className="print:hidden md:hidden">
      {open && (
        <div className="fixed inset-x-0 bottom-14 z-20 border-t border-stone-200 bg-white p-2 shadow-lg dark:border-stone-800 dark:bg-stone-950">
          <ul className="grid grid-cols-3 gap-1">
            {more.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  className={({ isActive }) =>
                    cx(
                      'flex flex-col items-center gap-1 rounded-lg p-3 text-xs font-medium',
                      isActive
                        ? 'bg-stone-100 text-teal-800 dark:bg-stone-800 dark:text-teal-300'
                        : 'text-stone-600 dark:text-stone-300',
                    )
                  }
                >
                  <i.icon className="h-5 w-5" />
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid h-14 grid-cols-5 border-t border-stone-200 bg-white/95 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95"
        aria-label="Secciones del sitio"
      >
        {primary.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => item(isActive)}>
            <i.icon className="h-5 w-5" />
            <span>{i.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={item(open || more.some((i) => pathname.endsWith(`/${i.to}`)))}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>Más</span>
        </button>
      </nav>
    </div>
  );
}
