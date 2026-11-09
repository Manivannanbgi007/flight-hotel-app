import { AlarmClock, Bell, CreditCard, LifeBuoy, Luggage, RotateCcw, UserRound, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

const icons: Record<string, LucideIcon> = {
  BOOKING: Luggage,
  PAYMENT: CreditCard,
  REFUND: RotateCcw,
  REMINDER: AlarmClock,
  SUPPORT: LifeBuoy,
  ACCOUNT: UserRound,
};

const tones: Record<string, string> = {
  BOOKING: 'bg-brand-50 text-brand-700 ring-brand-100',
  PAYMENT: 'bg-success-50 text-success-700 ring-success-200',
  REFUND: 'bg-warning-50 text-warning-700 ring-warning-200',
  REMINDER: 'bg-accent-50 text-accent-700 ring-accent-200',
  SUPPORT: 'bg-info-50 text-info-700 ring-info-200',
  ACCOUNT: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/** The tile in front of a notification: an icon and tint per category (decorative; the category is also written). */
export function NotificationCategoryIcon({ category, size = 'md', className }: {
  category: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const Icon = icons[category] ?? Bell;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
        size === 'sm' ? 'size-8' : 'size-10',
        tones[category] ?? 'bg-slate-100 text-slate-700 ring-slate-200',
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-4' : 'size-5'} />
    </span>
  );
}
