import { useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import {
  BedDouble, CircleCheck, CircleX, Clock, CreditCard, Hotel, ListChecks, Plane, Search, SlidersHorizontal, Undo2, Wallet, X,
} from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { KpiGrid, KpiItem } from '@/components/analytics';
import { ExportMenu } from '@/components/export/ExportMenu';
import { SectionHeader } from '@/features/account/AccountLayout';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { DataTable, Td, Th, Tr } from '@/components/ui/DataTable';
import { DateField } from '@/components/ui/DateField';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES_UP_TO_50, readPageSize } from '@/components/ui/paginationItems';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { EmptyInboxIllustration, StormIllustration } from '@/components/illustrations';
import { SortHeader } from '@/features/admin/shared/adminUi';
import { readDate, readEnum, readSort, sortParam, type SortState } from '@/features/admin/shared/searchState';
import { Art } from '@/features/bookings/BookingUi';
import { DocumentDownloadButton } from '@/features/documents/DocumentDownloadButton';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { paymentApi } from './paymentApi';
import { paymentStatusInfo } from './paymentStatus';
import type { PaymentHistoryFilters, PaymentStatus, PaymentSummary } from './types';

/** Payments per page until the customer picks another size; the API allows at most 50. */
const DEFAULT_PAGE_SIZE = 10;
const STATUSES = Object.keys(paymentStatusInfo) as PaymentStatus[];
const SORTS = ['createdAt', 'amount'] as const;
const BOOKING_TYPES = ['HOTEL', 'FLIGHT'] as const;

/** Statuses of a payment whose money was captured: it has a receipt. */
const CAPTURED: readonly PaymentStatus[] = ['SUCCESS', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'];

const REFUND_STATUS = { PENDING: 'In progress', PROCESSED: 'Refunded', FAILED: 'Failed' } as const;
const REFUND_TONE = { PENDING: 'warning', PROCESSED: 'success', FAILED: 'danger' } as const;

/** The method as the table names it ("Card", "Upi", "Demo"); nothing when unknown. */
const exportMethod = (payment: PaymentSummary) => {
  if (payment.method) return `${payment.method.charAt(0).toUpperCase()}${payment.method.slice(1)}${payment.provider === 'DEMO' ? ' (demo payment)' : ''}`;
  return payment.provider === 'DEMO' ? 'Demo' : null;
};

/**
 * The columns of an export of the payment history: what the table and a payment's details show. Never card or UPI
 * details (they are not stored) or the payment provider's own ids. Each amount is in its payment's own currency.
 */
const PAYMENT_COLUMNS: ExportColumn<PaymentSummary>[] = [
  { header: 'Transaction', value: (payment) => payment.id.slice(0, 8) },
  { header: 'Booking reference', value: (payment) => payment.bookingReference },
  { header: 'Description', value: (payment) => payment.description },
  { header: 'Type', value: (payment) => (payment.bookingType === 'HOTEL' ? 'Hotel' : payment.bookingType === 'FLIGHT' ? 'Flight' : null) },
  { header: 'Amount', value: (payment) => payment.amount, type: 'money', currency: (payment) => payment.currency },
  { header: 'Refunded', value: (payment) => payment.refundedAmount, type: 'money', currency: (payment) => payment.currency },
  { header: 'Currency', value: (payment) => payment.currency },
  { header: 'Method', value: exportMethod },
  { header: 'Date', value: (payment) => payment.createdAt, type: 'datetime' },
  { header: 'Confirmed at', value: (payment) => payment.verifiedAt, type: 'datetime' },
  { header: 'Status', value: (payment) => paymentStatusInfo[payment.status]?.label ?? payment.status },
  { header: 'Why it failed', value: (payment) => (payment.status === 'FAILED' ? payment.failureMessage : null) },
  { header: 'Invoice number', value: (payment) => payment.invoiceNumber },
];

/** "Amount, highest first"; the default order is the newest payments first. */
function describeSort(sort: SortState | null): string {
  if (!sort) return 'Date, newest first';
  if (sort.field === 'amount') return sort.direction === 'asc' ? 'Amount, lowest first' : 'Amount, highest first';
  return sort.direction === 'asc' ? 'Date, oldest first' : 'Date, newest first';
}

/**
 * /account/payments — the customer's own payments: figures for the current filters (the payment service's own sums),
 * then a table with search, status, booking type and date filters, sorting and paging (all in the URL and done by the
 * server), a details view per payment, and the receipt and invoice PDFs. Only the signed-in customer's payments can
 * ever be listed.
 */
export function PaymentHistoryPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const sort = readSort(params, SORTS);
  const filters: PaymentHistoryFilters = {
    q: params.get('q')?.trim() ?? '',
    status: readEnum(params, 'status', STATUSES),
    bookingType: readEnum(params, 'type', BOOKING_TYPES),
    from: readDate(params, 'from'),
    to: readDate(params, 'to'),
    sort: sortParam(sort),
  };
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const size = readPageSize(params, PAGE_SIZES_UP_TO_50, DEFAULT_PAGE_SIZE);
  const filtered = Boolean(filters.q || filters.status || filters.bookingType || filters.from || filters.to);
  const [openId, setOpenId] = useState<string | null>(null);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const payments = useQuery({
    queryKey: [...queryKeys.payments.history({ ...filters, page, size })],
    queryFn: () => (filtered || filters.sort ? paymentApi.history(page, size, filters) : paymentApi.history(page, size)),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: queryKeys.payments.summary({ ...filters, sort: undefined }),
    queryFn: () => paymentApi.historySummary(filters),
    placeholderData: keepPreviousData,
  });
  const data = payments.data;
  const onSort = (next: SortState) => update({ sort: sortParam(next) ?? null });
  const shown = data && data.content.length > 0 ? data : null;

  return (
    <div>
      <SectionHeader
        title="Payment history"
        description="Your payments and refunds. Card and UPI details are never stored."
        action={shown && (
          // My own payments only: the same call as the table (the server scopes it to me), same filters and sort.
          <ExportMenu
            title="Payment history"
            subtitle={user ? `${user.firstName} ${user.lastName}` : undefined}
            fileName="payment-history"
            columns={PAYMENT_COLUMNS}
            rows={shown.content}
            total={shown.totalElements}
            pageLabel={`Page ${shown.page + 1} of ${Math.max(shown.totalPages, 1)}`}
            fetchPage={(pageNo, pageSize) => (filtered || filters.sort
              ? paymentApi.history(pageNo, pageSize, filters)
              : paymentApi.history(pageNo, pageSize))}
            rowKey={(payment) => payment.id}
            filters={describeFilters([
              ['Search', filters.q],
              ['Status', filters.status && (paymentStatusInfo[filters.status]?.label ?? filters.status)],
              ['Booking type', filters.bookingType === 'HOTEL' ? 'Hotels' : filters.bookingType === 'FLIGHT' ? 'Flights' : null],
              ['From', filters.from && formatDate(filters.from)],
              ['To', filters.to && formatDate(filters.to)],
              ['Sort', describeSort(sort)],
            ])}
          />
        )}
      />

      {(summary.data || summary.isPending) && <Figures summary={summary.data} loading={summary.isPending} filtered={filtered} />}

      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:p-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
          <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-lg bg-role-50 text-role-600 ring-1 ring-inset ring-role-100">
            <SlidersHorizontal className="size-3.5" />
          </span>
          Find a payment
        </p>
        <PaymentSearch key={filters.q} q={filters.q ?? ''} onSearch={(q) => update({ q: q || null })} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label="Status" value={filters.status ?? ''} onChange={(event) => update({ status: event.target.value || null })}>
            <option value="">All statuses</option>
            {STATUSES.map((status) => <option key={status} value={status}>{paymentStatusInfo[status].label}</option>)}
          </SelectField>
          <SelectField label="Booking type" value={filters.bookingType ?? ''} onChange={(event) => update({ type: event.target.value || null })}>
            <option value="">Flights and hotels</option>
            <option value="FLIGHT">Flights</option>
            <option value="HOTEL">Hotels</option>
          </SelectField>
          <DateField label="From" value={filters.from} max={filters.to || undefined} rangeEnd={filters.to} onChange={(from) => update({ from: from || null })} />
          <DateField label="To" value={filters.to} min={filters.from || undefined} rangeStart={filters.from} onChange={(to) => update({ to: to || null })} />
        </div>
        {filtered && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams())}>
              <X className="size-4" aria-hidden="true" />Clear all filters
            </Button>
          </div>
        )}
      </div>

      {payments.isPending && <PaymentsLoading />}
      {payments.isError && <ErrorState illustration={<Art><StormIllustration /></Art>} description={ApiError.from(payments.error).message} onRetry={() => void payments.refetch()} />}
      {data && data.content.length === 0 && (
        <EmptyState
          illustration={<Art><EmptyInboxIllustration /></Art>}
          title={filtered ? 'No payments match' : 'No payments yet'}
          description={filtered ? 'Try other words or dates, or clear the filters.' : 'When you pay for a booking, it shows up here, with its receipt and invoice.'}
          action={filtered ? <Button variant="secondary" size="sm" onClick={() => setParams(new URLSearchParams())}>Clear all filters</Button> : (
            <>
              <ButtonLink to="/flights" size="sm"><Plane className="size-4" aria-hidden="true" />Search flights</ButtonLink>
              <ButtonLink to="/hotels" size="sm" variant="secondary"><BedDouble className="size-4" aria-hidden="true" />Search hotels</ButtonLink>
            </>
          )}
        />
      )}
      {data && data.content.length > 0 && (
        <>
          <DataTable
            caption="Payments"
            scroll
            head={(
              <>
                <Th>Transaction</Th>
                <Th>Booking</Th>
                <Th>Type</Th>
                <SortHeader label="Amount" field="amount" sort={sort} onSort={onSort} align="right" />
                <Th>Method</Th>
                <SortHeader label="Date" field="createdAt" sort={sort ?? { field: 'createdAt', direction: 'desc' }} onSort={onSort} />
                <Th>Status</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </>
            )}
          >
            {data.content.map((payment) => <PaymentRow key={payment.id} payment={payment} onOpen={() => setOpenId(payment.id)} />)}
          </DataTable>
          <Pagination
            data={data}
            onPageChange={(next) => update({ page: String(next) })}
            onPageSizeChange={(next) => update({ size: next === DEFAULT_PAGE_SIZE ? null : String(next) })}
            pageSizes={PAGE_SIZES_UP_TO_50}
            noun={['payment', 'payments']}
            sizeLabel="Per page"
            className="mt-5"
          />
        </>
      )}

      <PaymentDialog paymentId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function PaymentSearch({ q, onSearch }: { q: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(q);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(text.trim());
  };
  return (
    <form role="search" aria-label="Search my payments" onSubmit={submit} className="relative">
      <label htmlFor="payment-search" className="sr-only">Search my payments</label>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        id="payment-search"
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Booking reference, payment id or transaction id"
        autoComplete="off"
        className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-24 text-sm text-slate-900 placeholder:text-slate-500 transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-slate-300 focus:border-role-400 focus:ring-4 focus:ring-role-500/15 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button type="button" aria-label="Clear search" onClick={() => { setText(''); onSearch(''); }}
          className="absolute right-[4.75rem] top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
      <Button type="submit" size="sm" className="absolute right-1.5 top-1/2 -translate-y-1/2">Search</Button>
    </form>
  );
}

function Figures({ summary, loading, filtered }: { summary?: import('./types').PaymentHistorySummary; loading: boolean; filtered: boolean }) {
  const money = (amount: number) => formatMoney(amount, summary?.currency ?? 'INR');
  const count = (value: number) => value.toLocaleString('en-IN');
  return (
    <section className="mb-5">
      <KpiGrid label="Payment figures" columns={3} className="xl:grid-cols-3 2xl:grid-cols-5">
        <KpiItem>
          <StatCard label="Total paid" icon={<Wallet className="size-5" />} loading={loading} value={summary?.paidAmount ?? 0} format={money}
            footer={filtered ? 'For the current filters' : 'Before refunds'} />
        </KpiItem>
        <KpiItem>
          <StatCard label="Successful payments" icon={<CircleCheck className="size-5" />} loading={loading} value={summary?.successful ?? 0} format={count}
            footer={summary ? `${count(summary.total)} in all` : undefined} />
        </KpiItem>
        <KpiItem>
          <StatCard label="Pending payments" icon={<Clock className="size-5" />} loading={loading} value={summary?.pending ?? 0} format={count}
            footer="Waiting for the payment provider" />
        </KpiItem>
        <KpiItem>
          <StatCard label="Failed payments" icon={<CircleX className="size-5" />} loading={loading} value={summary?.failed ?? 0} format={count}
            footer="Nothing was charged" />
        </KpiItem>
        <KpiItem>
          <StatCard label="Refunded" icon={<Undo2 className="size-5" />} loading={loading} value={summary?.refundedAmount ?? 0} format={money}
            footer="Back on your payment method" />
        </KpiItem>
      </KpiGrid>
    </section>
  );
}

function PaymentsLoading() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <span role="status" className="sr-only">Loading your payments…</span>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-0">
          <Skeleton className="h-4 w-20" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-16" /><Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

function TypeBadge({ type }: { type?: 'HOTEL' | 'FLIGHT' | null }) {
  if (!type) return <span className="text-slate-400">—</span>;
  const Icon = type === 'HOTEL' ? Hotel : Plane;
  return <Badge tone={type === 'HOTEL' ? 'brand' : 'accent'}><Icon className="size-3" aria-hidden="true" />{type === 'HOTEL' ? 'Hotel' : 'Flight'}</Badge>;
}

const methodLabel = (method: string | null, provider: string) =>
  method ? method.charAt(0).toUpperCase() + method.slice(1) : provider === 'DEMO' ? 'Demo' : '—';

function PaymentRow({ payment, onOpen }: { payment: PaymentSummary; onOpen: () => void }) {
  const info = paymentStatusInfo[payment.status] ?? { label: payment.status, tone: 'neutral' as const };
  return (
    <Tr>
      <Td className="whitespace-nowrap"><span title={payment.id} className="font-mono text-xs font-semibold text-slate-800">{payment.id.slice(0, 8)}</span></Td>
      <Td>
        <Link to={`/my-trips/${payment.bookingId}`} className="font-semibold text-role-700 hover:underline">{payment.bookingReference ?? 'View booking'}</Link>
        {payment.description && <span className="block max-w-56 truncate text-xs text-slate-500">{payment.description}</span>}
      </Td>
      <Td><TypeBadge type={payment.bookingType} /></Td>
      <Td numeric className="whitespace-nowrap">
        <span className="font-bold text-slate-900">{formatMoney(payment.amount, payment.currency, true)}</span>
        {payment.refundedAmount > 0 && <span className="block text-xs text-slate-500">Refunded {formatMoney(payment.refundedAmount, payment.currency, true)}</span>}
      </Td>
      <Td className="whitespace-nowrap">
        {methodLabel(payment.method, payment.provider)}
        {payment.provider === 'DEMO' && <span className="block text-xs text-slate-500">demo payment</span>}
      </Td>
      <Td className="whitespace-nowrap">{formatDateTime(payment.createdAt)}</Td>
      <Td>
        <Badge tone={info.tone} dot>{info.label}</Badge>
        {payment.status === 'FAILED' && payment.failureMessage && <span className="mt-0.5 block max-w-52 text-xs text-danger-700">{payment.failureMessage}</span>}
      </Td>
      <Td className="whitespace-nowrap text-right">
        <Button variant="ghost" size="sm" onClick={onOpen} aria-label={`Details of payment ${payment.id.slice(0, 8)}`}>Details</Button>
      </Td>
    </Tr>
  );
}

/** A payment in full: its facts, any refunds, and the receipt and invoice PDFs. */
function PaymentDialog({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const details = useQuery({
    queryKey: queryKeys.payments.detail(paymentId ?? ''),
    queryFn: () => paymentApi.get(paymentId!),
    enabled: !!paymentId,
    retry: false,
  });
  const payment = details.data;
  const info = payment ? (paymentStatusInfo[payment.status] ?? { label: payment.status, tone: 'neutral' as const }) : null;
  const reference = payment ? (payment.bookingReference ?? payment.bookingId) : '';
  return (
    <Dialog open={!!paymentId} onClose={onClose} title="Payment details" description={payment ? `${payment.description ?? 'Booking payment'}` : undefined}>
      {details.isPending && <Skeleton className="h-40 w-full" />}
      {details.isError && <ErrorState compact description={ApiError.from(details.error).message} onRetry={() => void details.refetch()} />}
      {payment && info && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-3xl font-bold tracking-tight text-slate-900">{formatMoney(payment.amount, payment.currency, true)}</p>
            <Badge tone={info.tone} dot>{info.label}</Badge>
          </div>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Detail label="Payment id"><span className="font-mono text-xs">{payment.id}</span></Detail>
            <Detail label="Booking"><Link to={`/my-trips/${payment.bookingId}`} onClick={onClose} className="text-role-700 hover:underline">{payment.bookingReference ?? 'View booking'}</Link></Detail>
            <Detail label="Booking type">{payment.bookingType === 'HOTEL' ? 'Hotel' : payment.bookingType === 'FLIGHT' ? 'Flight' : null}</Detail>
            <Detail label="Method">{methodLabel(payment.method, payment.provider)}{payment.provider === 'DEMO' ? ' (demo payment, no real money)' : ''}</Detail>
            <Detail label="Started">{formatDateTime(payment.createdAt)}</Detail>
            <Detail label="Confirmed">{payment.verifiedAt ? formatDateTime(payment.verifiedAt) : null}</Detail>
            <Detail label="Invoice">{payment.invoiceNumber}</Detail>
            <Detail label="Refunded">{payment.refundedAmount > 0 ? formatMoney(payment.refundedAmount, payment.currency, true) : null}</Detail>
            <Detail label="Why it failed" wide>{payment.status === 'FAILED' ? payment.failureMessage : null}</Detail>
          </dl>

          {payment.refunds.length > 0 && (
            <section aria-label="Refunds of this payment">
              <h3 className="mb-2 text-sm font-bold text-slate-900">Refunds</h3>
              <ul className="flex flex-col gap-2">
                {payment.refunds.map((refund) => (
                  <li key={refund.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-200/70">
                    <span>{formatMoney(refund.amount, payment.currency, true)} · {formatDateTime(refund.createdAt)}</span>
                    <Badge tone={REFUND_TONE[refund.status] ?? 'neutral'}>{REFUND_STATUS[refund.status] ?? refund.status}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(CAPTURED.includes(payment.status) || payment.invoiceNumber) && (
            <div className="flex flex-wrap items-start gap-2 border-t border-slate-100 pt-4">
              {CAPTURED.includes(payment.status) && (
                <DocumentDownloadButton
                  bookingId={payment.bookingId}
                  type="PAYMENT_RECEIPT"
                  label="Download receipt"
                  accessibleName={`Download receipt ${reference}`}
                  notReadyText="The receipt is not ready yet. Please try again in a few seconds."
                  prefer={(document) => document.referenceId === payment.id}
                />
              )}
              {payment.invoiceNumber && (
                <DocumentDownloadButton
                  bookingId={payment.bookingId}
                  type="INVOICE"
                  label="Download invoice"
                  accessibleName={`Download invoice ${payment.invoiceNumber}`}
                  notReadyText="The invoice PDF is not ready yet. Please try again in a few seconds."
                  prefer={(document) => document.fileName.startsWith(`${payment.invoiceNumber!.replaceAll('/', '-')}-`)}
                />
              )}
              <ButtonLink to={`/account/support/new?bookingId=${payment.bookingId}`} variant="ghost" size="sm" onClick={onClose}>
                <CreditCard className="size-4" aria-hidden="true" />Problem with this payment?
              </ButtonLink>
            </div>
          )}
          {!CAPTURED.includes(payment.status) && !payment.invoiceNumber && (
            <p className="flex items-center gap-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
              <ListChecks className="size-4 text-slate-500" aria-hidden="true" />
              No receipt or invoice: no money was taken for this payment.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Detail({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words font-semibold text-slate-900">{children}</dd>
    </div>
  );
}
