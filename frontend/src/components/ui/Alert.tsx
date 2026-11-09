import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

import { cn } from '@/lib/cn';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const styles: Record<Tone, { box: string; icon: string }> = {
  info: { box: 'border-info-200 bg-info-50 text-info-700', icon: 'bg-info-100 text-info-600' },
  success: { box: 'border-success-200 bg-success-50 text-success-700', icon: 'bg-success-100 text-success-600' },
  warning: { box: 'border-warning-200 bg-warning-50 text-warning-700', icon: 'bg-warning-100 text-warning-600' },
  danger: { box: 'border-danger-200 bg-danger-50 text-danger-700', icon: 'bg-danger-100 text-danger-600' },
};

const icons: Record<Tone, ReactNode> = {
  info: <Info className="size-4" aria-hidden="true" />,
  success: <CheckCircle2 className="size-4" aria-hidden="true" />,
  warning: <AlertTriangle className="size-4" aria-hidden="true" />,
  danger: <XCircle className="size-4" aria-hidden="true" />,
};

/** Inline message inside a page or form. Errors and warnings are announced to screen readers immediately. */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm animate-fade-in', styles[tone].box, className)}
    >
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', styles[tone].icon)}>{icons[tone]}</span>
      <div className="flex min-w-0 flex-col gap-1 self-center">
        {title && <p className="font-semibold text-slate-900">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}
