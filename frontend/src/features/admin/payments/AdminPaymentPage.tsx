import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { CreditCard } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { LoadingState } from '@/components/ui/StateViews';
import { paymentStatusInfo } from '@/features/payments/paymentStatus';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime, formatMoney } from '@/lib/format';
import { DetailList, LoadError, RequirePermission, TableShell, tdClass } from '../shared/adminUi';
import { adminPaymentApi, type PaymentDetails } from './adminPaymentApi';
import { REFUND_STATUS_INFO, refundReasonLabel } from './paymentText';

/** /admin/payments/:paymentId — one payment with its provider ids and its refunds. */
export function AdminPaymentPage() {
  return (
    <RequirePermission permission="PAYMENT_READ_ANY">
      <PaymentLoader />
    </RequirePermission>
  );
}

function PaymentLoader() {
  const { paymentId = '' } = useParams();
  const payment = useQuery({ queryKey: queryKeys.admin.payment(paymentId), queryFn: () => adminPaymentApi.get(paymentId), retry: false });
  const notFound = payment.isError && ApiError.from(payment.error).status === 404;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm"><Link to="/admin/payments" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-semibold text-role-700 shadow-xs ring-1 ring-slate-200 transition-colors hover:bg-role-50">← Payments</Link></p>
      {payment.isPending && <LoadingState label="Loading the payment…" />}
      {payment.isError && (
        <LoadError error={payment.error} title={notFound ? 'Payment not found' : undefined} onRetry={notFound ? undefined : () => void payment.refetch()} />
      )}
      {payment.data && <Payment payment={payment.data} />}
    </div>
  );
}

function Payment({ payment }: { payment: PaymentDetails }) {
  const info = paymentStatusInfo[payment.status] ?? { label: payment.status, tone: 'neutral' as const };
  const money = (amount: number) => formatMoney(amount, payment.currency, true);
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card animate-fade-up">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-role-600 text-white shadow-md">
          <CreditCard className="size-5" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Payment of {money(payment.amount)}</h1>
        <Badge tone={info.tone}>{info.label}</Badge>
      </header>
      <Card className="p-5">
        <DetailList items={[
          ['Booking', payment.bookingReference
            ? <Link to={`/admin/bookings/${payment.bookingId}`} className="text-role-700 hover:underline">{payment.bookingReference}</Link>
            : payment.bookingId],
          ['Description', payment.description],
          ['Provider', payment.provider === 'DEMO' ? 'Demo (no real money)' : 'Razorpay'],
          ['Method', payment.method],
          ['Refunded', payment.refundedAmount > 0 ? money(payment.refundedAmount) : null],
          ['Booking type', payment.bookingType === 'HOTEL' ? 'Hotel' : payment.bookingType === 'FLIGHT' ? 'Flight' : null],
          ['Invoice', payment.invoiceNumber],
          ['Customer e-mail', payment.contactEmail],
          ['Started', formatDateTime(payment.createdAt)],
          ['Verified', payment.verifiedAt ? formatDateTime(payment.verifiedAt) : null],
          ['Payment id', <span className="font-mono text-xs">{payment.id}</span>],
          ['Provider payment id', payment.providerPaymentId ? <span className="font-mono text-xs">{payment.providerPaymentId}</span> : null],
          ['Provider order id', payment.providerOrderId ? <span className="font-mono text-xs">{payment.providerOrderId}</span> : null],
          ['Failure', payment.failureMessage ?? payment.failureCode],
        ]} />
      </Card>
      <section aria-labelledby="payment-refunds" className="flex flex-col gap-2">
        <h2 id="payment-refunds" className="font-semibold text-slate-900">Refunds</h2>
        {payment.refunds.length === 0 ? (
          <p className="text-sm text-slate-600">No refunds for this payment.</p>
        ) : (
          <TableShell caption="Refunds of this payment">
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>Reason</th>
                <th scope="col" className={tableStyles.th}>Status</th>
                <th scope="col" className={`${tableStyles.th} text-right`}>Amount</th>
                <th scope="col" className={tableStyles.th}>Requested</th>
                <th scope="col" className={tableStyles.th}>Provider refund id</th>
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {payment.refunds.map((refund) => {
                const status = REFUND_STATUS_INFO[refund.status] ?? { label: refund.status, tone: 'neutral' as const };
                return (
                  <tr key={refund.id} className={tableStyles.tr}>
                    <td className={tdClass}>{refundReasonLabel(refund.reason)}</td>
                    <td className={tdClass}>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {refund.failureReason && <span className="mt-0.5 block text-xs text-danger-600">{refund.failureReason}</span>}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right font-medium`}>{money(refund.amount)}</td>
                    <td className={`${tdClass} whitespace-nowrap text-slate-700`}>{formatDateTime(refund.createdAt)}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{refund.providerRefundId ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
      </section>
    </>
  );
}
