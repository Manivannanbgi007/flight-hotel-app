import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { P } from './palette';

/** Props every illustration takes. They are decorative: hidden from screen readers, the page text says it all. */
export interface IllustrationProps {
  className?: string;
}

/** The <svg> of an illustration: scales to its box, decorative (aria-hidden), never focusable. */
/** A width or size utility, possibly behind variants (`w-40`, `sm:w-44`, `size-24`), but not `max-w-*` / `min-w-*`. */
const SIZED_CLASS = /(^|\s)([a-z0-9-]+:)*(w|size)-/;

export function Svg({ viewBox, className, children }: { viewBox: string; className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      // Full width unless the caller sizes the drawing (`w-40`, `sm:w-44`, `w-auto`): `cn` does not merge classes, and
      // in the generated CSS `w-full` comes after `w-40`, so it would always win.
      className={cn('block h-auto', !SIZED_CLASS.test(className ?? '') && 'w-full', className)}
    >
      {children}
    </svg>
  );
}

/** A soft cloud, 72 × 40 at scale 1. */
export function Cloud({ x, y, scale = 1, fill = P.white, opacity = 1, className }: {
  x: number;
  y: number;
  scale?: number;
  fill?: string;
  opacity?: number;
  className?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <g className={className}>
        <path d="M12 36h50a11 11 0 0 0 1-21.9A15 15 0 0 0 34.5 9 12 12 0 0 0 14 17.5 9.5 9.5 0 0 0 12 36z" fill={fill} />
      </g>
    </g>
  );
}

/**
 * A side-view airliner facing right, about 120 × 50 at scale 1. `rotate` tilts it (negative = climbing).
 * `className` animates the inner group (the outer one carries the position, so a CSS transform cannot move it).
 */
export function Plane({ x, y, scale = 1, rotate = 0, body = P.white, wing = P.brand600, tail = P.accent500, className }: {
  x: number;
  y: number;
  scale?: number;
  rotate?: number;
  body?: string;
  wing?: string;
  tail?: string;
  className?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
      <g className={className}>
        <path d="M58 19h10l-12-9h-6z" fill={P.brand300} />
        <path d="M18 19 10 4h10l14 15z" fill={tail} />
        <path d="M14 26c0-5 4-7 10-7h72c10 0 18 4 20 7-2 3-10 6-20 6H24c-6 0-10-2-10-6z" fill={body} />
        <path d="M14 25 4 27l4 2 12-1z" fill={P.accent400} />
        <path d="M100 21.5c4 0 8 1.5 10 3.5h-8z" fill={P.brand700} />
        {[36, 43, 50, 57, 64, 71, 78, 85, 92].map((cx) => (
          <circle key={cx} cx={cx} cy={24} r={1.6} fill={P.brand300} />
        ))}
        <path d="M56 28h14L50 46h-8z" fill={wing} />
        <ellipse cx={58} cy={36} rx={7} ry={3.2} fill={P.brand800} />
      </g>
    </g>
  );
}

/** Four-pointed sparkle, `size` wide, centred on x/y. */
export function Sparkle({ x, y, size = 12, fill = P.accent300, className }: {
  x: number;
  y: number;
  size?: number;
  fill?: string;
  className?: string;
}) {
  const s = size / 2;
  return (
    <path
      className={className}
      d={`M${x} ${y - s}C${x + s * 0.18} ${y - s * 0.18} ${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y}C${x + s * 0.18} ${y + s * 0.18} ${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s}C${x - s * 0.18} ${y + s * 0.18} ${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y}C${x - s * 0.18} ${y - s * 0.18} ${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s}z`}
      fill={fill}
    />
  );
}

/** Map pin whose tip is at x/y. */
export function Pin({ x, y, scale = 1, fill = P.accent500, dot = P.white }: { x: number; y: number; scale?: number; fill?: string; dot?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={0} cy={0} rx={7} ry={2.5} fill={P.ink} opacity={0.12} />
      <path d="M0 0C-3-6-12-13-12-22a12 12 0 0 1 24 0c0 9-9 16-12 22z" fill={fill} />
      <circle cx={0} cy={-22} r={4.5} fill={dot} />
    </g>
  );
}

/** A small palm tree standing at x/y (trunk base). */
export function Palm({ x, y, scale = 1, flip = false }: { x: number; y: number; scale?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      <path d="M0 0C2-14 2-30-3-44" stroke={P.accent600} strokeWidth={4} strokeLinecap="round" fill="none" />
      <path d="M-3-44c-10-6-22-4-28 4 9-3 18-3 28-4z" fill={P.leafDark} />
      <path d="M-3-44c4-10 16-14 26-9-10 1-18 4-26 9z" fill={P.leaf} />
      <path d="M-3-44c-6-11-4-20 4-24-3 8-4 15-4 24z" fill={P.leaf} />
      <path d="M-3-44c10-2 20 4 22 13-7-6-14-10-22-13z" fill={P.leafDark} />
      <path d="M-3-44c-10 0-18 7-19 15 5-7 11-12 19-15z" fill={P.leaf} />
    </g>
  );
}
