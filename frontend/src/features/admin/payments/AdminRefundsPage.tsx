import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { RotateCcw } from 'lucide-react';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { DateField } from '@/components/ui/DateField';
import { SelectField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState } from '@/components/ui/StateViews';
import { queryKeys } from '@/lib/api/queryKeys';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import {
  FilterCard, ListLoading, LoadError, PageHeader, RequirePermission, ResultCount, SearchBox, TableShell, tdClass,
} from '../shared/adminUi';
import { readDate, readEnum, readPage, useSearchState } from '../shared/searchState';
import { adminPaymentApi, type AdminRefundRow, type RefundFilters } from './adminPaymentApi';
import { REFUND_STATUS_INFO, REFUND_STATUSES, refundReasonLabel } from './paymentText';

/** The columns of an export (CSV, Excel, PDF): what the table shows, one figure per column. */
const EXPORT_COLUMNS: ExportColumn<AdminRefundRow>[] = [
  { header: 'Booking reference', value: (refund) => refund.bookingReference },
  { header: 'Reason', value: (refund) => refundReasonLabel(refund.reason) },
  { header: 'Status', value: (refund) => REFUND_STATUS_INFO[refund.status]?.label ?? refund.status },
  { header: 'Failure', value: (refund) => refund.failureReason },
  { header: 'Amount', value: (refund) => refund.amount, type: 'money' },
  { header: 'Requested', value: (refund) => refund.createdAt, type: 'datetime' },
  { header: 'Updated', value: (refund) => (refund.updatedAt !== refund.createdAt ? refund.updatedAt : null), type: 'datetime' },
];

/** /admin/refunds — every refund with its status; each links to its booking (where refunds are started). */
export function AdminRefundsPage() {
  return (
    <RequirePermission permission="PAYMENT_READ_ANY">
      <Refunds />
    </RequirePermission>
  );
}

function Refunds() {
  const { params, update } = useSearchState();
  const filters: RefundFilters = {
    q: params.get('q')?.trim() ?? '',
    status: readEnum(params, 'status', REFUND_STATUSES),
    from: readDate(params, 'from'),
    to: readDate(params, 'to'),
    page: readPage(params),
  };
  const size = readPageSize(params, PAGE_SIZES, 25);
  const refunds = useQuery({
    queryKey: [...queryKeys.admin.refundList(filters), size],
    queryFn: () => adminPaymentApi.refunds(filters, size),
    placeholderData: keepPreviousData,
  });
  const data = refunds.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={<RotateCcw className="size-5" />} title="Refunds" description="Refunds are started from the booking (cancellation, retry, goodwill), never from here." actions={<span className="hidden sm:inline-flex"><LiveIndicator /></span>} />
      <FilterCard>
        <SearchBox key={filters.q} initial={filters.q} label="Search" placeholder="Booking reference" onSearch={(q) => update({ q })} />
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All statuses</option>
            {REFUND_STATUSES.map((status) => <option key={status} value={status}>{REFUND_STATUS_INFO[status].label}</option>)}
          </SelectField>
          <DateField label="From" value={filters.from} max={filters.to || undefined} rangeEnd={filters.to} onChange={(from) => update({ from })} />
          <DateField label="To" value={filters.to} min={filters.from || undefined} rangeStart={filters.from} onChange={(to) => update({ to })} />
        </div>
      </FilterCard>

      {refunds.isPending && <ListLoading label="Loading refunds…" />}
      {refunds.isError && <LoadError error={refunds.error} onRetry={() => void refunds.refetch()} />}
      {data && data.content.length === 0 && <EmptyState title="No refunds found" />}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><ResultCount count={data.totalElements} noun={['refund', 'refunds']} /></div>
            <ExportMenu
              className="ml-auto"
              title="Refunds"
              subtitle="Admin portal"
              fileName="refunds"
              columns={EXPORT_COLUMNS}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => adminPaymentApi.refunds({ ...filters, page }, pageSize)}
              rowKey={(refund) => refund.id}
              filters={describeFilters([
                ['Search', filters.q],
                ['Status', filters.status && REFUND_STATUS_INFO[filters.status].label],
                ['From', filters.from && formatDate(filters.from)],
                ['To', filters.to && formatDate(filters.to)],
              ])}
              personalData
            />
          </div>
          <TableShell caption="Refunds">
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>Booking</th>
                <th scope="col" className={tableStyles.th}>Reason</th>
                <th scope="col" className={tableStyles.th}>Status</th>
                <th scope="col" className={`${tableStyles.th} text-right`}>Amount</th>
                <th scope="col" className={tableStyles.th}>Requested</th>
                <th scope="col" className={tableStyles.th}>Payment</th>
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {data.content.map((refund) => {
                const status = REFUND_STATUS_INFO[refund.status] ?? { label: refund.status, tone: 'neutral' as const };
                return (
                  <tr key={refund.id} className={tableStyles.tr}>
                    <td className={tdClass}>
                      <Link to={`/admin/bookings/${refund.bookingId}`} className="font-medium text-role-700 hover:underline">
                        {refund.bookingReference ?? 'Open booking'}
                      </Link>
                    </td>
                    <td className={tdClass}>{refundReasonLabel(refund.reason)}</td>
                    <td className={tdClass}>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {refund.failureReason && <span className="mt-0.5 block text-xs text-danger-600">{refund.failureReason}</span>}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right font-medium text-slate-900`}>{formatMoney(refund.amount, 'INR', true)}</td>
                    <td className={`${tdClass} whitespace-nowrap text-slate-700`}>
                      {formatDateTime(refund.createdAt)}
                      {refund.updatedAt !== refund.createdAt && <span className="block text-xs text-slate-500">updated {formatDateTime(refund.updatedAt)}</span>}
                    </td>
                    <td className={tdClass}>
                      <Link to={`/admin/payments/${refund.paymentId}`} className="text-role-700 hover:underline">Payment</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
          <Pagination data={data} noun={['refund', 'refunds']} pageSizes={PAGE_SIZES}
            onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
        </>
      )}
    </div>
  );
}
