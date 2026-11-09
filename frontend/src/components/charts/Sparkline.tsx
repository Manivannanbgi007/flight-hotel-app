import { useId } from 'react';

import { cn } from '@/lib/cn';

/**
 * A tiny trend line for KPI cards (no axes, no recharts: it costs nothing to load). The line is in a quiet colour and
 * the last point in the accent; the area under it is a 10% wash. Decorative: the card's value and change carry the
 * meaning, so give the numbers in text next to it.
 */
export function Sparkline({ values, width = 120, height = 36, color = 'var(--role-600)', className }: {
  values: number[];
  width?: number;
  height?: number;
  /** CSS colour of the line, also a var() (default: the portal's role accent). */
  color?: string;
  className?: string;
}) {
  const gradientId = `spark${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (values.length < 2) {
    return null;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const x = (index: number) => pad + (index / (values.length - 1)) * (width - pad * 2);
  const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const lastIndex = values.length - 1;
  const area = `M${x(0)},${height} L${points.replace(/ /g, ' L')} L${x(lastIndex)},${height} Z`;
  return (
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${width} ${height}`} width={width} height={height}
      className={cn('block overflow-visible', className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: color, stopOpacity: 0.18 }} />
          <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" style={{ stroke: color }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(lastIndex)} cy={y(values[lastIndex] ?? 0)} r="3.5" style={{ fill: color }} stroke="#ffffff" strokeWidth="2" />
    </svg>
  );
}
