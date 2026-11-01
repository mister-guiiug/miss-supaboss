/**
 * Mini sparkline SVG (série de points numériques) — historique local uniquement.
 * États vides / un seul point / série plate : visibles, pas ambigus.
 */
export function Sparkline({
  values,
  width = 72,
  height = 20,
  className = '',
  emptyLabel,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  className?: string;
  /** Texte accessible quand il n’y a pas assez de points. */
  emptyLabel?: string;
}) {
  if (values.length === 0) {
    return (
      <span
        className={`inline-block text-[10px] text-[var(--sb-text-soft)] ${className}`}
        title={emptyLabel}
      >
        —
      </span>
    );
  }
  if (values.length === 1) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className={className}
      >
        <circle
          cx={width / 2}
          cy={height / 2}
          r={2}
          fill="currentColor"
          opacity={0.5}
        />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  const span = flat ? 1 : max - min;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = flat
        ? height / 2
        : height - ((v - min) / span) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className={`${className}${flat ? ' opacity-50' : ''}`}
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={flat ? '2 2' : undefined}
        points={points}
      />
    </svg>
  );
}
