import { AlertCircle, CheckCircle2, Loader2, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { errorText } from '../lib/i18n';

export const cx = (...c: (string | false | null | undefined)[]): string =>
  c.filter(Boolean).join(' ');

export const inputClass =
  'block w-full rounded-lg border-stone-300 bg-white text-sm shadow-sm placeholder:text-stone-400 focus:border-teal-600 focus:ring-teal-600 dark:border-stone-700 dark:bg-stone-900 dark:placeholder:text-stone-500';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary:
    'bg-teal-700 text-white hover:bg-teal-800 focus-visible:outline-teal-700 dark:bg-teal-600 dark:hover:bg-teal-500',
  secondary:
    'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800',
  danger: 'bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700',
  ghost: 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  icon?: LucideIcon;
  size?: 'md' | 'lg';
}

export function Button({
  variant = 'primary',
  loading,
  icon: Icon,
  size = 'md',
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'lg' ? 'px-5 py-3 text-base' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : Icon ? (
        <Icon className="h-4 w-4" />
      ) : null}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

const tones = {
  neutral: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

const statusTone: Record<string, Tone> = {
  pending: 'neutral',
  queued: 'blue',
  processing: 'blue',
  writing: 'blue',
  publishing: 'blue',
  running: 'blue',
  done: 'green',
  ready: 'green',
  published: 'green',
  succeeded: 'green',
  failed: 'red',
  discarded: 'neutral',
  draft: 'amber',
};
export function StatusBadge({ status, label }: { status: string; label: string }) {
  const active = ['queued', 'processing', 'writing', 'publishing', 'running'].includes(status);
  return (
    <Badge tone={statusTone[status] ?? 'neutral'}>
      {active && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </Badge>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-stone-600 dark:text-stone-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Estado vacío honesto: explica qué es esto y cuál es el siguiente paso. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-stone-300 px-6 py-12 text-center dark:border-stone-700">
      <Icon className="mb-3 h-8 w-8 text-stone-400" />
      <h3 className="text-base font-medium">{title}</h3>
      {children && (
        <p className="mt-1 max-w-md text-sm text-stone-600 dark:text-stone-400">{children}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-stone-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

/** Muestra el error real: mensaje traducido + detalle técnico del servidor. */
export function ErrorBanner({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const detail = error instanceof ApiError ? error.detail : '';
  return (
    <div
      role="alert"
      className={cx(
        'flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">{errorText(error)}</p>
        {detail && <p className="mt-0.5 break-words text-xs opacity-80">{detail}</p>}
      </div>
    </div>
  );
}

export function Notice({
  tone = 'amber',
  title,
  children,
}: {
  tone?: 'amber' | 'green' | 'blue';
  title: string;
  children?: ReactNode;
}) {
  const styles = {
    amber:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
    green:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    blue: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200',
  };
  const Icon = tone === 'green' ? CheckCircle2 : AlertCircle;
  return (
    <div className={cx('flex gap-3 rounded-lg border p-3 text-sm', styles[tone])}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-xs opacity-90">{children}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-stone-600 dark:text-stone-400">
      <span>
        Página {page} de {pages} · {total} en total
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}
