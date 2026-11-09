import { useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Button } from '@/components/ui/Button';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { DateField } from '@/components/ui/DateField';
import { TextField } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState } from '@/components/ui/StateViews';
import { queryKeys } from '@/lib/api/queryKeys';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  FilterCard, ListLoading, LoadError, PageHeader, RequirePermission, ResultCount, TableShell, tdClass,
} from '../shared/adminUi';
import { humanize, roleLabel } from '../shared/labels';
import { readDate, readPage, useSearchState } from '../shared/searchState';
import { auditApi, type AuditFilters, type AuditLogEntry } from './auditApi';
import { auditExportApi } from './auditExportApi';
import { AuditExportsCard } from './AuditExportsCard';

const TEXT_FILTERS = [
  { name: 'action', label: 'Action', placeholder: 'BOOKING_CANCELLED' },
  { name: 'entityType', label: 'Entity type', placeholder: 'BOOKING' },
  { name: 'entityId', label: 'Entity id', placeholder: '' },
  { name: 'actorId', label: 'Actor id (user id)', placeholder: '' },
] as const;

/**
 * The columns of an export (CSV, Excel, PDF): what the table and its "details" show, one figure per column. The
 * details hold ids and amounts only (never personal data or notes), as on screen.
 */
const EXPORT_COLUMNS: ExportColumn<AuditLogEntry>[] = [
  { header: 'When', value: (entry) => entry.occurredAt, type: 'datetime' },
  { header: 'Action', value: (entry) => humanize(entry.action) },
  { header: 'Action code', value: (entry) => entry.action },
  { header: 'Entity type', value: (entry) => humanize(entry.entityType) },
  { header: 'Entity id', value: (entry) => entry.entityId },
  { header: 'Actor', value: (entry) => (entry.actorRoles.length > 0 ? entry.actorRoles.map(roleLabel).join(', ') : 'System') },
  { header: 'Actor id', value: (entry) => entry.actorId },
  { header: 'Details', value: (entry) => Object.entries(entry.details ?? {}).map(([key, value]) => `${key}: ${detailValue(value)}`).join('; '), width: 50 },
  { header: 'Service', value: (entry) => entry.service },
  { header: 'IP address', value: (entry) => entry.ipAddress },
  { header: 'Correlation id', value: (entry) => entry.correlationId },
];

/** Under "All matching rows" when there are too many for the browser: the server writes the file. */
const SERVER_EXPORT_NOTE = 'Too many for the browser, so the server prepares the file and we tell you when it’s ready. '
  + 'Above 10,00,000 rows the download is a .zip (Excel: one file per 10,00,000 rows).';

/** /admin/audit-logs — who did what and when, across every service. Newest first. */
export function AdminAuditLogsPage() {
  return (
    <RequirePermission permission="AUDIT_VIEW">
      <AuditLogs />
    </RequirePermission>
  );
}

function readFilters(params: URLSearchParams): AuditFilters {
  const text = (name: string) => params.get(name)?.trim() ?? '';
  return {
    action: text('action'),
    entityType: text('entityType'),
    entityId: text('entityId'),
    actorId: text('actorId'),
    from: readDate(params, 'from'),
    to: readDate(params, 'to'),
    page: readPage(params),
  };
}

function AuditLogs() {
  const queryClient = useQueryClient();
  const { params, update } = useSearchState();
  const filters = readFilters(params);
  const size = readPageSize(params, PAGE_SIZES, 25);
  const logs = useQuery({
    queryKey: [...queryKeys.admin.auditLogs(filters), size],
    queryFn: () => auditApi.list(filters, size),
    placeholderData: keepPreviousData,
  });
  const data = logs.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={<ScrollText className="size-5" />} title="Audit logs" description="Every recorded action: accounts, roles, cancellations, refunds, support actions and settings. Details hold ids and amounts only." />
      <FilterForm key={params.toString()} filters={filters} onApply={(next) => update(next)} />
      <AuditExportsCard />
      {logs.isPending && <ListLoading label="Loading audit log entries…" />}
      {logs.isError && <LoadError error={logs.error} onRetry={() => void logs.refetch()} />}
      {data && data.content.length === 0 && <EmptyState title="No entries found" description="The filters match exactly; try fewer of them." />}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><ResultCount count={data.totalElements} noun={['entry', 'entries']} /></div>
            <ExportMenu
              className="ml-auto"
              title="Audit logs"
              subtitle="Admin portal"
              fileName="audit-logs"
              columns={EXPORT_COLUMNS}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => auditApi.list({ ...filters, page }, pageSize)}
              rowKey={(entry) => entry.id}
              serverExport={{
                note: SERVER_EXPORT_NOTE,
                start: async (format, { exportedBy }) => {
                  await auditExportApi.request(filters, format === 'xlsx' ? 'XLSX' : 'CSV', exportedBy);
                  // "Your exports" shows the new job (and follows it from there).
                  void queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditExports });
                },
              }}
              filters={describeFilters([
                ['Action', filters.action],
                ['Entity type', filters.entityType],
                ['Entity id', filters.entityId],
                ['Actor id', filters.actorId],
                ['From', filters.from && formatDate(filters.from)],
                ['To', filters.to && formatDate(filters.to)],
                ['Order', 'Newest first'],
              ])}
              personalData
            />
          </div>
          <TableShell caption="Audit log entries">
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>When</th>
                <th scope="col" className={tableStyles.th}>Action</th>
                <th scope="col" className={tableStyles.th}>Entity</th>
                <th scope="col" className={tableStyles.th}>Actor</th>
                <th scope="col" className={tableStyles.th}>Details</th>
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {data.content.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
            </tbody>
          </TableShell>
          <Pagination data={data} noun={['entry', 'entries']} pageSizes={PAGE_SIZES}
            onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
        </>
      )}
    </div>
  );
}

function FilterForm({ filters, onApply }: { filters: AuditFilters; onApply: (changes: Record<string, string | null>) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({
    action: filters.action, entityType: filters.entityType, entityId: filters.entityId, actorId: filters.actorId, from: filters.from, to: filters.to,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (name: string, value: string) => setDraft((current) => ({ ...current, [name]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setError('The start date must be on or before the end date.');
      return;
    }
    setError(null);
    onApply(Object.fromEntries(Object.entries(draft).map(([name, value]) => [name, value.trim() || null])));
  };
  const active = Object.values(draft).some(Boolean);

  return (
    <FilterCard>
      <form noValidate onSubmit={submit} aria-label="Filter audit logs" className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEXT_FILTERS.map((field) => (
            <TextField key={field.name} label={field.label} optional value={draft[field.name] ?? ''} placeholder={field.placeholder}
              onChange={(event) => set(field.name, event.target.value)} />
          ))}
          <DateField label="From" optional value={draft.from ?? ''} onChange={(from) => set('from', from)} rangeEnd={draft.to ?? ''} />
          <DateField label="To" optional value={draft.to ?? ''} onChange={(to) => set('to', to)} rangeStart={draft.from ?? ''}
            error={error ?? undefined} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="role">Apply filters</Button>
          {active && (
            <Button variant="ghost" onClick={() => {
              setDraft({ action: '', entityType: '', entityId: '', actorId: '', from: '', to: '' });
              onApply({ action: null, entityType: null, entityId: null, actorId: null, from: null, to: null });
            }}>
              Clear
            </Button>
          )}
        </div>
      </form>
    </FilterCard>
  );
}

function detailValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function EntryRow({ entry }: { entry: AuditLogEntry }) {
  const details = Object.entries(entry.details ?? {});
  return (
    <tr className={`${tableStyles.tr} align-top`}>
      <td className={`${tdClass} whitespace-nowrap text-slate-700`}>{formatDateTime(entry.occurredAt)}</td>
      <td className={tdClass}>
        <span className="block font-medium text-slate-900">{humanize(entry.action)}</span>
        <span className="block font-mono text-xs text-slate-500">{entry.action}</span>
      </td>
      <td className={tdClass}>
        <span className="block text-slate-900">{humanize(entry.entityType)}</span>
        {entry.entityId && <span className="block break-all font-mono text-xs text-slate-500">{entry.entityId}</span>}
      </td>
      <td className={tdClass}>
        <span className="block text-slate-900">{entry.actorRoles.length > 0 ? entry.actorRoles.map(roleLabel).join(', ') : 'System'}</span>
        {entry.actorId && <span className="block break-all font-mono text-xs text-slate-500">{entry.actorId}</span>}
      </td>
      <td className={tdClass}>
        <details>
          <summary className="cursor-pointer text-role-700">{details.length} detail{details.length === 1 ? '' : 's'}</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {details.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-slate-500">{key}</dt>
                <dd className="break-all font-mono text-slate-900">{detailValue(value)}</dd>
              </div>
            ))}
            <dt className="text-slate-500">Service</dt>
            <dd className="font-mono text-slate-900">{entry.service}</dd>
            {entry.ipAddress && <><dt className="text-slate-500">IP address</dt><dd className="font-mono text-slate-900">{entry.ipAddress}</dd></>}
            {entry.correlationId && <><dt className="text-slate-500">Correlation id</dt><dd className="break-all font-mono text-slate-900">{entry.correlationId}</dd></>}
          </dl>
        </details>
      </td>
    </tr>
  );
}
