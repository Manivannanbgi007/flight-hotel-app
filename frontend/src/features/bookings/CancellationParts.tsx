import { useId } from 'react';
import { RotateCcw } from 'lucide-react';

import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { formatDateTime, formatMoney } from '@/lib/format';
import { DetailCard } from './BookingUi';
import { cancellationStatusInfo, initiatorLabel, refundReasonLabels, refundStatusInfo } from './cancellation';
import type { BookingDetails, Cancellation, RefundItem } from './types';

type Viewer = 'customer' | 'staff';

/**
 * The latest cancellation (who asked, why, fee, refund, the hotel's or airline's answer) and every refund of the
 * booking with what was paid back so far. Nothing is shown for a booking without either.
 */
export function CancellationCard({ booking, viewer = 'customer' }: { booking: BookingDetails; viewer?: Viewer }) {
  const headingId = useId();
  const { cancellation, refunds } = booking;
  if (!cancellation && refunds.length === 0 && booking.refundedAmount <= 0) {
    return null;
  }
  const heading = cancellation ? 'Cancellation and refund' : 'Refund';
  return (
    <section aria-labelledby={headingId}>
      <DetailCard title={heading} headingId={headingId} icon={<RotateCcw />} className="border-l-4 border-l-role-500">
        {cancellation && <CancellationDetails cancellation={cancellation} type={booking.type} viewer={viewer} />}
        {refunds.length > 0 && <RefundList refunds={refunds} viewer={viewer} />}
        {booking.refundedAmount > 0 && (
          <p className="mt-4 rounded-xl bg-success-50 px-3 py-2.5 text-sm text-success-700 ring-1 ring-inset ring-success-200">
            Refunded so far: <strong className="text-base text-slate-900">{formatMoney(booking.refundedAmount, booking.currency, true)}</strong>
          </p>
        )}
      </DetailCard>
    </section>
  );
}

function CancellationDetails({ cancellation: c, type, viewer }: { cancellation: Cancellation; type: 'HOTEL' | 'FLIGHT'; viewer: Viewer }) {
  const supplier = type === 'FLIGHT' ? 'airline' : 'hotel';
  const info = cancellationStatusInfo(c.status, type);
  const money = (amount: number) => formatMoney(amount, c.currency, true);
  return (
    <>
      {c.status === 'REJECTED' && (
        <Alert tone="warning" className="mt-4" title={`The ${supplier} did not accept the cancellation`}>
          {c.failureMessage && <p>{c.failureMessage}</p>}
          <p className="font-medium">{viewer === 'customer' ? 'Your booking is still valid.' : 'The booking is still valid.'}</p>
        </Alert>
      )}
      {c.status === 'PENDING' && (
        <p className="mt-3 text-sm text-slate-600">
          We have asked the {supplier} to cancel. This page updates by itself when they answer.
        </p>
      )}
      <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">Status</dt><dd className="mt-1"><Badge tone={info.tone}>{info.label}</Badge></dd></div>
        <div>
          <dt className="text-slate-500">Requested by</dt>
          <dd className="mt-0.5 font-semibold text-slate-800">{initiatorLabel(c.initiatedBy, viewer)} · {formatDateTime(c.requestedAt)}</dd>
        </div>
        {c.reason && <div className="sm:col-span-2"><dt className="text-slate-500">Reason</dt><dd className="mt-0.5 font-semibold text-slate-800">{c.reason}</dd></div>}
        {c.status !== 'REJECTED' && (
          <>
            <div>
              <dt className="text-slate-500">Cancellation fee</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-800">{c.feeWaived ? 'Waived' : money(c.cancellationFee)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Refund</dt>
              <dd className="mt-0.5 font-bold tabular-nums text-slate-900">{c.refundAmount > 0 ? money(c.refundAmount) : 'None (non-refundable)'}</dd>
            </div>
          </>
        )}
        {c.completedAt && (
          <div>
            <dt className="text-slate-500">{c.status === 'REJECTED' ? 'Answered on' : 'Cancelled on'}</dt>
            <dd className="mt-0.5 font-semibold text-slate-800">{formatDateTime(c.completedAt)}</dd>
          </div>
        )}
        {c.supplierReference && (
          <div>
            <dt className="text-slate-500">{type === 'FLIGHT' ? 'Airline cancellation reference' : 'Hotel cancellation number'}</dt>
            <dd className="mt-0.5 font-semibold text-slate-800">{c.supplierReference}</dd>
          </div>
        )}
        {viewer === 'staff' && c.failureReason && (
          <div><dt className="text-slate-500">Failure code</dt><dd className="mt-0.5 font-mono text-xs">{c.failureReason}</dd></div>
        )}
      </dl>
    </>
  );
}

function RefundList({ refunds, viewer }: { refunds: RefundItem[]; viewer: Viewer }) {
  return (
    <>
      <h3 className="mt-5 text-sm font-bold text-slate-900">Refunds</h3>
      <ul className="mt-2 flex flex-col gap-2 text-sm" aria-label="Refunds">
        {refunds.map((refund) => {
          const info = refundStatusInfo[refund.status];
          return (
            <li key={refund.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">
                  {formatMoney(refund.amount, refund.currency, true)} · {refundReasonLabels[refund.reason] ?? refund.reason}
                </p>
                <p className="text-xs text-slate-500">
                  Requested {formatDateTime(refund.requestedAt)}
                  {refund.completedAt && ` · ${refund.status === 'FAILED' ? 'failed' : 'completed'} ${formatDateTime(refund.completedAt)}`}
                </p>
                {viewer === 'customer' && refund.status === 'REQUESTED' && (
                  <p className="text-xs text-slate-500">Banks usually take 5 to 7 working days to show it.</p>
                )}
                {viewer === 'customer' && refund.status === 'FAILED' && (
                  <p className="text-xs text-danger-700">Our support team has been told and will send it again.</p>
                )}
              </div>
              <Badge tone={info.tone}>{info.label}</Badge>
            </li>
          );
        })}
      </ul>
    </>
  );
}
