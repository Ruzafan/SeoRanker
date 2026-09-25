import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from './ui';

/**
 * Gráficas SVG ligeras (sin dependencias). Paleta validada con el validador de dataviz
 * (claro y oscuro): serie principal teal, comparación naranja. Una sola escala Y por gráfica.
 */
export interface Series {
  name: string;
  values: number[];
  /** Clases de trazo/relleno por modo, p. ej. SERIES_TONES.primary */
  tone: SeriesTone;
}

export const SERIES_TONES = {
  primary: {
    stroke: 'stroke-[#0d9488] dark:stroke-[#0d9488]',
    fill: 'fill-[#0d9488] dark:fill-[#0d9488]',
    bg: 'bg-[#0d9488]',
  },
  compare: {
    stroke: 'stroke-[#c2410c] dark:stroke-[#ea580c]',
    fill: 'fill-[#c2410c] dark:fill-[#ea580c]',
    bg: 'bg-[#c2410c] dark:bg-[#ea580c]',
  },
} as const;
export type SeriesTone = (typeof SERIES_TONES)[keyof typeof SERIES_TONES];

const W = 640;
const H = 280;
// El margen derecho de las líneas deja sitio a las etiquetas directas del último punto.
const PAD = { top: 16, right: 48, bottom: 28, left: 52 };
const BAR_PAD_RIGHT = 8;
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

function niceMax(v: number): number {
  const step = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return Math.ceil(v / step) * step;
}

const nf = new Intl.NumberFormat('es-ES');

function Tooltip({
  x,
  title,
  rows,
}: {
  x: number;
  title: string;
  rows: { name: string; value: string; tone: SeriesTone }[];
}) {
  // x en fracción del ancho: se ancla a la izquierda o derecha para no salirse.
  const right = x > 0.6;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-stone-700 dark:bg-stone-900"
      style={right ? { right: `${(1 - x) * 100 + 2}%` } : { left: `${x * 100 + 2}%` }}
    >
      <p className="mb-1 text-stone-500">{title}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2">
          <span className={cx('h-0.5 w-3 rounded', r.tone.bg)} aria-hidden />
          <strong className="tabular-nums text-stone-900 dark:text-stone-100">{r.value}</strong>
          <span className="text-stone-500">{r.name}</span>
        </p>
      ))}
    </div>
  );
}

function YAxis({
  max,
  format,
  width = plotW,
}: {
  max: number;
  format: (n: number) => string;
  width?: number;
}) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <g>
      {ticks.map((t) => {
        const y = PAD.top + plotH - (t / max) * plotH;
        return (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + width}
              y1={y}
              y2={y}
              className="stroke-stone-200 dark:stroke-stone-800"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y}
              dy="0.32em"
              textAnchor="end"
              className="fill-stone-500 text-[13px] tabular-nums"
            >
              {format(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ labels, xAt }: { labels: string[]; xAt: (i: number) => number }) {
  return (
    <g>
      {labels.map((l, i) =>
        // En móvil se leen mejor uno de cada dos.
        i % 2 === 0 || i === labels.length - 1 ? (
          <text
            key={l}
            x={xAt(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-stone-500 text-[13px]"
          >
            {l}
          </text>
        ) : null,
      )}
    </g>
  );
}

function DataTable({
  labels,
  series,
  format,
}: {
  labels: string[];
  series: { name: string; values: number[] }[];
  format: (n: number) => string;
}) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
        Ver datos en tabla
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs tabular-nums">
          <thead>
            <tr className="text-stone-500">
              <th className="py-1 pr-3 font-medium">Mes</th>
              {series.map((s) => (
                <th key={s.name} className="py-1 pr-3 font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l} className="border-t border-stone-100 dark:border-stone-800">
                <td className="py-1 pr-3">{l}</td>
                {series.map((s) => (
                  <td key={s.name} className="py-1 pr-3">
                    {format(s.values[i] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Líneas con crosshair: la guía encuentra el mes; el tooltip lista todas las series. */
export function LineChart({
  labels,
  series,
  format = (n) => nf.format(Math.round(n)),
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  format?: (n: number) => string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...series.flatMap((s) => s.values)));
  const xAt = (i: number) => PAD.left + (i / Math.max(1, labels.length - 1)) * plotW;
  const yAt = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - rect.left) / rect.width;
    setActive(Math.max(0, Math.min(labels.length - 1, Math.round(f * (labels.length - 1)))));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(labels.length - 1, (a ?? -1) + 1));
    if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? labels.length) - 1));
  };

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-4 text-xs text-stone-600 dark:text-stone-400">
        {series.map((s) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className={cx('h-0.5 w-4 rounded', s.tone.bg)} aria-hidden />
            {s.name}
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          <YAxis max={max} format={format} />
          <XLabels labels={labels} xAt={xAt} />
          {series.map((s) => (
            <path
              key={s.name}
              d={s.values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i)},${yAt(v)}`).join(' ')}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={s.tone.stroke}
            />
          ))}
          {/* Etiquetas directas al final de cada línea: la identidad no depende solo del color. */}
          {series.map((s) => {
            const last = s.values.length - 1;
            return (
              <text
                key={s.name}
                x={xAt(last) + 8}
                y={yAt(s.values[last] ?? 0)}
                dy="0.32em"
                className="fill-stone-700 text-[13px] font-medium dark:fill-stone-300"
              >
                {format(s.values[last] ?? 0)}
              </text>
            );
          })}
          {active !== null && (
            <g>
              <line
                x1={xAt(active)}
                x2={xAt(active)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-stone-400 dark:stroke-stone-600"
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.name}
                  cx={xAt(active)}
                  cy={yAt(s.values[active] ?? 0)}
                  r={4.5}
                  strokeWidth={2}
                  className={cx(s.tone.fill, 'stroke-white dark:stroke-stone-900')}
                />
              ))}
            </g>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {active !== null && (
          <Tooltip
            x={xAt(active) / W}
            title={labels[active] ?? ''}
            rows={series.map((s) => ({
              name: s.name,
              value: format(s.values[active] ?? 0),
              tone: s.tone,
            }))}
          />
        )}
      </div>
      <DataTable labels={labels} series={series} format={format} />
    </div>
  );
}

/** Barras de una sola serie (sin leyenda: el título la nombra). Tooltip por barra. */
export function BarChart({
  labels,
  values,
  name,
  format = (n) => nf.format(Math.round(n)),
  ariaLabel,
}: {
  labels: string[];
  values: number[];
  name: string;
  format?: (n: number) => string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const clipId = useId();
  const max = niceMax(Math.max(...values));
  const barPlotW = W - PAD.left - BAR_PAD_RIGHT;
  const band = barPlotW / labels.length;
  const barW = Math.min(24, band * 0.6);
  const xAt = (i: number) => PAD.left + band * i + band / 2;
  const tone = SERIES_TONES.primary;

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
          <YAxis max={max} format={format} width={barPlotW} />
          <XLabels labels={labels} xAt={xAt} />
          {values.map((v, i) => {
            const h = (v / max) * plotH;
            const x = xAt(i) - barW / 2;
            const y = PAD.top + plotH - h;
            const r = Math.min(4, h);
            // Extremo de datos redondeado 4px; cuadrado en la línea base.
            const d = `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`;
            return (
              <g
                key={labels[i]}
                tabIndex={0}
                role="img"
                aria-label={`${labels[i]}: ${format(v)} ${name}`}
                className="outline-none"
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <rect
                  x={xAt(i) - band / 2}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  clipPath={`url(#${clipId})`}
                />
                <path
                  d={d}
                  className={cx(tone.fill, 'transition-opacity', active === i && 'opacity-80')}
                />
              </g>
            );
          })}
          {/* Etiqueta directa selectiva: solo el último valor. */}
          <text
            x={xAt(values.length - 1)}
            y={PAD.top + plotH - ((values[values.length - 1] ?? 0) / max) * plotH - 6}
            textAnchor="middle"
            className="fill-stone-700 text-[13px] font-medium dark:fill-stone-300"
          >
            {format(values[values.length - 1] ?? 0)}
          </text>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={barPlotW} height={plotH} />
          </clipPath>
        </svg>
        {active !== null && (
          <Tooltip
            x={xAt(active) / W}
            title={labels[active] ?? ''}
            rows={[{ name, value: format(values[active] ?? 0), tone }]}
          />
        )}
      </div>
      <DataTable labels={labels} series={[{ name, values }]} format={format} />
    </div>
  );
}
