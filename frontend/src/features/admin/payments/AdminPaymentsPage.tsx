import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CircleCheck, CircleX, Clock, CreditCard, Hotel, ListChecks, Plane, Undo2, Wallet } from 'lucide-react';

import { KpiGrid, KpiItem } from '@/components/analytics';
import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { DateField } from '@/components/ui/DateField';
import { SelectField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/StateViews';
import { paymentStatusInfo } from '@/features/payments/paymentStatus';
import type { PaymentStatus } from '@/features/payments/types';
import { queryKeys } from '@/lib/api/queryKeys';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import {
  FilterCard, ListLoading, LoadError, PageHeader, RequirePermission, ResultCount, SearchBox, SortHeader, TableShell, tdClass,
} from '../shared/adminUi';
import { readDate, readEnum, readPage, readSort, sortParam, useSearchState } from '../shared/searchState';
import { adminPaymentApi, type AdminPaymentRow, type PaymentFilters, type PaymentsSummary } from './adminPaymentApi';
import { PAYMENT_METHODS, paymentMethodLabel } from './paymentText';

const STATUSES = Object.keys(paymentStatusInfo) as PaymentStatus[];
const SORTS = ['createdAt', 'amount'] as const;
const SORT_LABELS: Record<(typeof SORTS)[number], [string, string, string]> = {
  createdAt: ['Date', 'newest first', 'oldest first'],
  amount: ['Amount', 'highest first', 'lowest first'],
};
const providerLabel = (provider: string) => (provider === 'DEMO' ? 'Demo' : 'Razorpay');
const bookingTypeLabel = (type?: 'HOTEL' | 'FLIGHT' | null) => (type === 'HOTEL' ? 'Hotel' : type === 'FLIGHT' ? 'Flight' : null);

/** The columns of an export (CSV, Excel, PDF): what the table shows, one figure per column (the full payment id). */
const EXPORT_COLUMNS: ExportColumn<AdminPaymentRow>[] = [
  { header: 'Payment ID', value: (payment) => payment.id },
  { header: 'Booking reference', value: (payment) => payment.bookingReference },
  { header: 'Customer e-mail', value: (payment) => payment.contactEmail },
  { header: 'Booking type', value: (payment) => bookingTypeLabel(payment.bookingType) },
  { header: 'Amount', value: (payment) => payment.amount, type: 'money', currency: (payment) => payment.currency },
  { header: 'Refunded', value: (payment) => payment.refundedAmount, type: 'money', currency: (payment) => payment.currency },
  { header: 'Currency', value: (payment) => payment.currency },
  { header: 'Method', value: (payment) => (payment.method ? paymentMethodLabel(payment.method) : null) },
  { header: 'Provider', value: (payment) => providerLabel(payment.provider) },
  { header: 'Transaction ID', value: (payment) => payment.providerPaymentId ?? payment.providerOrderId },
  { header: 'Status', value: (payment) => paymentStatusInfo[payment.status]?.label ?? payment.status },
  { header: 'Failure', value: (payment) => payment.failureMessage },
  { header: 'Date', value: (payment) => payment.createdAt, type: 'datetime' },
];
const BOOKING_TYPES = ['HOTEL', 'FLIGHT'] as const;
const METHOD_VALUES = PAYMENT_METHODS.map((method) => method.value);

/**
 * /admin/payments — every payment attempt: figures for the current filters, then the list with search (payment id,
 * booking reference, the provider's ids, customer e-mail), status, provider, method, booking type and date filters,
 * sorting and paging. All of it is done by the server; refunds are started from the booking.
 */
export function AdminPaymentsPage() {
  return (
    <RequirePermission permission="PAYMENT_READ_ANY">
      <Payments />
    </RequirePermission>
  );
}

function Payments() {
  const { params, update } = useSearchState();
  const sort = readSort(params, SORTS);
  const filters: PaymentFilters = {
    q: params.get('q')?.trim() ?? '',
    status: readEnum(params, 'status', STATUSES),
    provider: readEnum(params, 'provider', ['RAZORPAY', 'DEMO'] as const),
    method: readEnum(params, 'method', METHOD_VALUES),
    bookingType: readEnum(params, 'bookingType', BOOKING_TYPES),
    from: readDate(params, 'from'),
    to: readDate(params, 'to'),
    page: readPage(params),
    sort: sortParam(sort),
  };
  const size = readPageSize(params, PAGE_SIZES, 25);
  const payments = useQuery({
    queryKey: [...queryKeys.admin.paymentList(filters), size],
    queryFn: () => adminPaymentApi.list(filters, size),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: queryKeys.admin.paymentSummary({ ...filters, page: 0, sort: undefined }),
    queryFn: () => adminPaymentApi.summary(filters),
    placeholderData: keepPreviousData,
  });
  const data = payments.data;
  const onSort = (next: Parameters<typeof sortParam>[0]) => update({ sort: sortParam(next) });
  const filtered = Boolean(filters.q || filters.status || filters.provider || filters.method || filters.bookingType || filters.from || filters.to);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={<CreditCard className="size-5" />}
        title="Payments"
        description="Every payment attempt, with the money it moved. Refunds are started from the booking."
        actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>}
      />

      <Figures summary={summary.data} loading={summary.isPending} error={summary.isError ? summary.error : null}
        onRetry={() => void summary.refetch()} filtered={filtered} />

      <FilterCard>
        <SearchBox key={filters.q} initial={filters.q} label="Search" placeholder="Payment id, booking reference, transaction id or e-mail"
          hint="Exact payment id, booking reference, the provider's payment or order id, or the customer's e-mail." onSearch={(q) => update({ q })} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((status) => <option key={status} value={status}>{paymentStatusInfo[status].label}</option>)}
          </SelectField>
          <SelectField label="Payment method" value={filters.method ?? ''} onChange={(event) => update({ method: event.target.value })}>
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
          </SelectField>
          <SelectField label="Booking type" value={filters.bookingType ?? ''} onChange={(event) => update({ bookingType: event.target.value })}>
            <option value="">Hotels and flights</option>
            <option value="HOTEL">Hotel bookings</option>
            <option value="FLIGHT">Flight bookings</option>
          </SelectField>
          <SelectField label="Provider" value={filters.provider} onChange={(event) => update({ provider: event.target.value })}>
            <option value="">All providers</option>
            <option value="RAZORPAY">Razorpay</option>
            <option value="DEMO">Demo</option>
          </SelectField>
          <DateField label="From" value={filters.from} max={filters.to || undefined} rangeEnd={filters.to} onChange={(from) => update({ from })} />
          <DateField label="To" value={filters.to} min={filters.from || undefined} rangeStart={filters.from} onChange={(to) => update({ to })} />
        </div>
      </FilterCard>

      {payments.isPending && <ListLoading label="Loading payments…" />}
      {payments.isError && <LoadError error={payments.error} onRetry={() => void payments.refetch()} />}
      {data && data.content.length === 0 && (
        <EmptyState
          illustration="search"
          title="No payments found"
          description={filtered ? 'Try other words, or clear some of the filters.' : 'Payments appear here as soon as customers pay.'}
        />
      )}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><ResultCount count={data.totalElements} noun={['payment', 'payments']} /></div>
            <ExportMenu
              className="ml-auto"
              title="Payments"
              subtitle="Admin portal"
              fileName="payments"
              columns={EXPORT_COLUMNS}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => adminPaymentApi.list({ ...filters, page }, pageSize)}
              rowKey={(payment) => payment.id}
              filters={describeFilters([
                ['Search', filters.q],
                ['Status', filters.status && paymentStatusInfo[filters.status].label],
                ['Payment method', filters.method && paymentMethodLabel(filters.method)],
                ['Booking type', filters.bookingType && `${bookingTypeLabel(filters.bookingType)} bookings`],
                ['Provider', filters.provider && providerLabel(filters.provider)],
                ['From', filters.from && formatDate(filters.from)],
                ['To', filters.to && formatDate(filters.to)],
                ['Sort', sort && sortText(sort)],
              ])}
              personalData
            />
          </div>
          <TableShell caption="Payments" scroll>
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>Payment ID</th>
                <th scope="col" className={tableStyles.th}>Booking</th>
                <th scope="col" className={tableStyles.th}>Customer</th>
                <th scope="col" className={tableStyles.th}>Type</th>
                <SortHeader label="Amount" field="amount" sort={sort} onSort={onSort} align="right" />
                <th scope="col" className={tableStyles.th}>Method</th>
                <th scope="col" className={tableStyles.th}>Transaction</th>
                <th scope="col" className={tableStyles.th}>Status</th>
                <SortHeader label="Date" field="createdAt" sort={sort} onSort={onSort} />
                <th scope="col" className={tableStyles.th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {data.content.map((payment) => {
                const info = paymentStatusInfo[payment.status] ?? { label: payment.status, tone: 'neutral' as const };
                const reference = payment.providerPaymentId ?? payment.providerOrderId;
                return (
                  <tr key={payment.id} className={tableStyles.tr}>
                    <td className={tdClass}>
                      <Link to={`/admin/payments/${payment.id}`} title={payment.id} className="font-mono text-xs font-medium text-role-700 hover:underline">
                        {payment.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className={tdClass}>
                      {payment.bookingReference
                        ? <Link to={`/admin/bookings/${payment.bookingId}`} className="font-medium text-role-700 hover:underline">{payment.bookingReference}</Link>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className={`${tdClass} max-w-52 break-all text-slate-700`}>{payment.contactEmail ?? <span className="text-slate-400">—</span>}</td>
                    <td className={tdClass}><BookingType type={payment.bookingType} /></td>
                    <td className={`${tdClass} whitespace-nowrap text-right`}>
                      <span className="font-semibold text-slate-900">{formatMoney(payment.amount, payment.currency, true)}</span>
                      {payment.refundedAmount > 0 && <span className="block text-xs text-slate-500">refunded {formatMoney(payment.refundedAmount, payment.currency, true)}</span>}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-slate-700`}>
                      {paymentMethodLabel(payment.method)}
                      <span className="block text-xs text-slate-500">{payment.provider === 'DEMO' ? 'Demo' : 'Razorpay'}</span>
                    </td>
                    <td className={tdClass}>
                      {reference
                        ? <span title={reference} className="block max-w-36 truncate font-mono text-xs text-slate-700">{reference}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className={tdClass}>
                      <Badge tone={info.tone} dot>{info.label}</Badge>
                      {payment.failureMessage && <span className="mt-0.5 block max-w-48 text-xs text-danger-600">{payment.failureMessage}</span>}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-slate-700`}>{formatDateTime(payment.createdAt)}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right`}>
                      <Link
                        to={`/admin/payments/${payment.id}`}
                        aria-label={`View payment ${payment.id.slice(0, 8)}`}
                        className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-role-700 hover:bg-role-50"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
          <Pagination data={data} noun={['payment', 'payments']} pageSizes={PAGE_SIZES}
            onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
        </>
      )}
    </div>
  );
}

/** "Amount, highest first": the sort in force, for the exported file. */
function sortText(sort: NonNullable<ReturnType<typeof readSort>>): string {
  const [label, descending, ascending] = SORT_LABELS[sort.field as (typeof SORTS)[number]];
  return `${label}, ${sort.direction === 'desc' ? descending : ascending}`;
}

function BookingType({ type }: { type?: 'HOTEL' | 'FLIGHT' | null }) {
  if (!type) return <span className="text-slate-400">—</span>;
  const Icon = type === 'HOTEL' ? Hotel : Plane;
  return (
    <Badge tone={type === 'HOTEL' ? 'brand' : 'accent'}>
      <Icon className="size-3" aria-hidden="true" />
      {type === 'HOTEL' ? 'Hotel' : 'Flight'}
    </Badge>
  );
}

/** The six figures above the list: the same filters as the table, so they always add up to what is listed. */
function Figures({ summary, loading, error, onRetry, filtered }: {
  summary?: PaymentsSummary;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  filtered: boolean;
}) {
  if (error && !summary) {
    return <LoadError error={error} onRetry={onRetry} title="The payment figures could not be loaded" />;
  }
  const money = (amount: number) => formatMoney(amount, summary?.currency ?? 'INR');
  const count = (value: number) => value.toLocaleString('en-IN');
  return (
    <section aria-labelledby="payment-figures" className="flex flex-col gap-3">
      <h2 id="payment-figures" className="sr-only">Payment figures{filtered ? ' for the current filters' : ''}</h2>
      <KpiGrid label="Payment figures" columns={3} className="xl:grid-cols-3 2xl:grid-cols-6">
        <KpiItem>
          <StatCard label="Total payments" icon={<ListChecks className="size-5" />} loading={loading}
            value={summary?.total ?? 0} format={count} footer={filtered ? 'For the current filters' : 'All attempts'} />
        </KpiItem>
        <KpiItem>
          <StatCard label="Successful payments" icon={<CircleCheck className="size-5" />} loading={loading}
            value={summary?.successful ?? 0} format={count} footer="Money captured" />
        </KpiItem>
        <KpiItem>
          <StatCard label="Failed payments" icon={<CircleX className="size-5" />} loading={loading}
            value={summary?.failed ?? 0} format={count} footer="Declined or cancelled" />
        </KpiItem>
        <KpiItem>
          <StatCard label="Pending payments" icon={<Clock className="size-5" />} loading={loading}
            value={summary?.pending ?? 0} format={count} footer="Waiting for the provider" />
        </KpiItem>
        <KpiItem>
          <StatCard label="Collected revenue" icon={<Wallet className="size-5" />} loading={loading}
            value={summary?.collectedAmount ?? 0} format={money} footer="Before refunds" />
        </KpiItem>
        <KpiItem>
          <StatCard label="Refunded amount" icon={<Undo2 className="size-5" />} loading={loading}
            value={summary?.refundedAmount ?? 0} format={money} footer="Given back to customers" />
        </KpiItem>
      </KpiGrid>
    </section>
  );
}
