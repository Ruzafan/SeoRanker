import { wordDiff } from '@seo/shared';

/**
 * Antes y después lado a lado, como el diff dividido de git en modo palabra: a la izquierda se
 * tacha en rojo lo que se quita; a la derecha se resalta en verde lo que se añade.
 */
export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = wordDiff(before, after);
  return (
    <div className="grid gap-2 text-sm sm:grid-cols-2">
      <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 dark:border-red-900/60 dark:bg-red-950/30">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-red-700 dark:text-red-400">
          − Ahora
        </p>
        <p className="whitespace-pre-wrap leading-relaxed">
          {parts
            .filter((p) => p.op !== 'added')
            .map((p, i) =>
              p.op === 'removed' ? (
                <del
                  key={i}
                  className="rounded bg-red-200/80 text-red-900 decoration-red-700/60 dark:bg-red-900/60 dark:text-red-100"
                >
                  {p.text}
                </del>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
        </p>
      </div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          + Propuesta
        </p>
        <p className="whitespace-pre-wrap leading-relaxed">
          {parts
            .filter((p) => p.op !== 'removed')
            .map((p, i) =>
              p.op === 'added' ? (
                <ins
                  key={i}
                  className="rounded bg-emerald-200/80 text-emerald-950 no-underline dark:bg-emerald-800/60 dark:text-emerald-50"
                >
                  {p.text}
                </ins>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
        </p>
      </div>
      <p className="text-xs text-stone-500 sm:col-span-2">
        {before.length} → {after.length} caracteres
      </p>
    </div>
  );
}
