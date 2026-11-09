import { Badge } from '@/components/ui/Badge';
import { Stepper, type StepperStep } from '@/components/ui/Stepper';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { statusInfo, statusLabel } from './status';
import type { BookingPaymentStatus, BookingStatus, PriceLine } from './types';

/** The booking status; with `paymentStatus` a refunded booking that kept a fee reads "Partly refunded". */
export function BookingStatusBadge({ status, type = 'HOTEL', paymentStatus }: {
  status: BookingStatus;
  type?: 'HOTEL' | 'FLIGHT';
  paymentStatus?: BookingPaymentStatus;
}) {
  const info = statusInfo[status];
  return <Badge tone={info.tone} dot>{statusLabel(status, type, paymentStatus)}</Badge>;
}

const HOTEL_STEPS: StepperStep[] = [
  { label: 'Guest details', description: 'Who is staying' },
  { label: 'Review', description: 'Check everything' },
  { label: 'Payment', description: 'Secure checkout' },
  { label: 'Confirmation', description: 'From the hotel' },
];
const FLIGHT_STEPS: StepperStep[] = [
  { label: 'Passenger details', description: 'Who is flying' },
  { label: 'Review', description: 'Check everything' },
  { label: 'Payment', description: 'Secure checkout' },
  { label: 'Confirmation', description: 'From the airline' },
];

/**
 * "Guest details › Review › Payment › Confirmation" (flights: "Passenger details") with the current step marked, on the
 * shared Stepper: a row from `sm` up, "Step 2 of 4: Review" with a bar on phones. `current` counts from 1.
 */
export function BookingSteps({ current, type = 'HOTEL' }: { current: 1 | 2 | 3 | 4; type?: 'HOTEL' | 'FLIGHT' }) {
  return (
    <Stepper
      label="Booking steps"
      steps={type === 'FLIGHT' ? FLIGHT_STEPS : HOTEL_STEPS}
      current={current - 1}
      className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-xs sm:px-5 sm:py-4"
    />
  );
}

/** The price lines of a booking as the server calculated them, ending with the total to pay. */
export function PriceBreakdown({ items, total, currency, heading = 'Price details' }: {
  items: PriceLine[];
  total: number;
  currency: string;
  heading?: string;
}) {
  return (
    <section aria-label={heading}>
      <h2 className="text-base font-bold tracking-tight text-slate-900">{heading}</h2>
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {items.map((item, index) => (
          <div
            key={`${item.type}-${index}`}
            className={cn('flex justify-between gap-3', item.type === 'DISCOUNT' ? 'font-medium text-success-700' : 'text-slate-700')}
          >
            <dt className="min-w-0">{item.label}</dt>
            <dd className="shrink-0 tabular-nums">{formatMoney(item.amount, currency, true)}</dd>
          </div>
        ))}
        <div className="mt-2 flex items-baseline justify-between gap-3 rounded-xl bg-role-50/70 px-3 py-2.5 text-base font-bold text-slate-900 ring-1 ring-inset ring-role-100">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(total, currency, true)}</dd>
        </div>
      </dl>
    </section>
  );
}
