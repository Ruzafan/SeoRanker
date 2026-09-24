import type { JobRunDto } from '@seo/shared';

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatCents(cents: number): string {
  return `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} US$`;
}

export function formatTokens(n: number): string {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)} M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)} k`
      : String(n);
}

export function jobDurationMs(job: JobRunDto): number | null {
  const fromMeta = job.meta?.['durationMs'];
  if (typeof fromMeta === 'number') return fromMeta;
  if (job.startedAt && job.finishedAt)
    return Date.parse(job.finishedAt) - Date.parse(job.startedAt);
  return null;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export const isJobActive = (j: Pick<JobRunDto, 'status'>): boolean =>
  j.status === 'queued' || j.status === 'running';

/** Snippet para que Yoast exponga sus campos por REST (functions.php). */
export const YOAST_SNIPPET = `add_action('init', function () {
  foreach (['_yoast_wpseo_focuskw', '_yoast_wpseo_metadesc', '_yoast_wpseo_title'] as $key) {
    register_post_meta('post', $key, [
      'show_in_rest'  => true,
      'single'        => true,
      'type'          => 'string',
      'auth_callback' => function () { return current_user_can('edit_posts'); },
    ]);
  }
});`;
