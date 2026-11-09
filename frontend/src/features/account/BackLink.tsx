import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/cn';

/** "← Support tickets": the way back to the list a page belongs to (the arrow is decorative). */
export function BackLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-brand-700 hover:text-brand-800',
        className,
      )}
    >
      <ArrowLeft className="size-4 transition-transform duration-(--duration-fast) group-hover:-translate-x-0.5" aria-hidden="true" />
      <span className="group-hover:underline">{children}</span>
    </Link>
  );
}
