import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { useInContentFrame } from './layoutContext';

const widths = {
  /** Forms and single-column flows (booking steps, write a review, new ticket). */
  md: 'max-w-3xl',
  /** Detail pages and lists (My Trips, a booking, a ticket). */
  lg: 'max-w-5xl',
  /** Pages with a sidebar (search results, account, dashboard). */
  xl: 'max-w-7xl',
} as const;

/**
 * The frame of a public or customer page below the header: the page width, the side gutters (16 px on phones), the
 * vertical rhythm, and a soft colour glow behind the top of the page (decorative). Pages with an illustrated band
 * use PageHero instead. Inside the customer area (beside its sidebar) it only holds the page's content.
 */
export function PageContainer({ width = 'xl', backdrop = true, className, children }: {
  width?: keyof typeof widths;
  /** The mesh glow behind the top of the page (default on). */
  backdrop?: boolean;
  className?: string;
  children: ReactNode;
}) {
  // Inside the customer area the frame already has the width, gutters and backdrop: forms keep their narrow width.
  if (useInContentFrame()) {
    return <div className={cn('w-full', width === 'md' && 'max-w-3xl', className)}>{children}</div>;
  }
  return (
    <div className="relative isolate">
      {backdrop && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-gradient-mesh opacity-80" />
      )}
      <div className={cn('mx-auto w-full px-4 pb-16 pt-6 sm:px-6 sm:pt-10', widths[width], className)}>{children}</div>
    </div>
  );
}
