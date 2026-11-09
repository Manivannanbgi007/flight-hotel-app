import { Ban, CheckCircle2, CircleDashed, Hourglass, PieChart, TicketCheck, XCircle, type LucideIcon } from 'lucide-react';

import { ChartCard, DonutChart, formatCount, formatPercent } from '@/components/charts';
import { cn } from '@/lib/cn';
import { DashSection, ShareBar } from './dashKit';
import { share } from './dashHelpers';
import type { AdminDashboard } from './dashboardApi';

interface Status {
  key: keyof AdminDashboard['bookings'];
  label: string;
  hint: string;
  color: string;
  icon: LucideIcon;
  text: string;
}

/** Only statuses the booking model has: upcoming/confirmed, completed, still being processed, cancelled, failed or expired. */
const STATUSES: Status[] = [
  { key: 'upcoming', label: 'Confirmed', hint: 'Paid and confirmed, trip still to come', color: 'var(--color-success-500)', icon: CheckCircle2, text: 'text-success-700' },
  { key: 'completed', label: 'Completed', hint: 'The trip is over', color: 'var(--color-brand-500)', icon: TicketCheck, text: 'text-brand-700' },
  { key: 'pending', label: 'Pending', hint: 'Waiting for payment or confirmation', color: 'var(--color-warning-500)', icon: Hourglass, text: 'text-warning-700' },
  { key: 'cancelled', label: 'Cancelled', hint: 'Paid, then cancelled', color: 'var(--color-danger-500)', icon: Ban, text: 'text-danger-700' },
  { key: 'failed', label: 'Failed or expired', hint: 'Not booked: nothing was charged', color: 'var(--color-danger-700)', icon: XCircle, text: 'text-danger-700' },
];

/**
 * Booking status: where the bookings created in the range stand now, as a ring with the total in the middle and a list
 * with each status's count and share of all of them. The statuses are exclusive, so the shares add up to 100 %.
 */
export function StatusSection({ data }: { data?: AdminDashboard }) {
  const counts = data?.bookings;
  const total = STATUSES.reduce((sum, status) => sum + (counts?.[status.key] ?? 0), 0);
  return (
    <DashSection
      id="booking-status"
      title="Booking status"
      description="Bookings created in the range, by where they are now"
      icon={<PieChart />}
      accent="green"
    >
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ChartCard as="h3" title="Share of bookings" className="border-0 bg-transparent p-0 shadow-none">
          <DonutChart
            title="Bookings by status"
            data={STATUSES.map((status) => ({ label: status.label, value: counts?.[status.key] ?? 0, color: status.color }))}
            valueFormat="count"
            centerLabel="Bookings"
            loading={!data}
            emptyMessage="No bookings in this period"
            height={230}
          />
        </ChartCard>
        <ul aria-label="Booking status figures" className="stagger flex flex-col gap-3">
          {STATUSES.map((status) => {
            const count = counts?.[status.key] ?? 0;
            const percent = share(count, total);
            const Icon = status.icon;
            return (
              <li key={status.key} className="group rounded-2xl border border-slate-200/80 bg-white px-3.5 py-2.5 transition-[transform,box-shadow] duration-(--duration-fast) hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${status.color} 14%, white)`, color: status.color }}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{status.label}</span>
                      <span className="shrink-0 text-sm tabular-nums">
                        <span className={cn('font-bold', status.text)}>{data ? formatCount(count) : '–'}</span>
                        <span className="ml-1.5 text-xs font-medium text-slate-500">{data ? formatPercent(percent) : ''}</span>
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-500">{status.hint}</p>
                  </div>
                </div>
                <ShareBar percent={percent} className="mt-2" color={status.color} />
              </li>
            );
          })}
        </ul>
      </div>
      {!!data && total === 0 && (
        <p className="flex items-center gap-2 text-sm text-slate-600"><CircleDashed className="size-4" aria-hidden="true" />No bookings were created in this range.</p>
      )}
    </DashSection>
  );
}
