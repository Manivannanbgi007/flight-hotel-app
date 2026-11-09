import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Table2, Trash2, X } from 'lucide-react';

import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime, formatFileSize } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  auditExportApi, describeExportFilters, downloadAuditExport, isExportActive, type AuditExportJob, type AuditExportStatus,
} from './auditExportApi';

/** How often the list is re-read while an export is waiting or running (live updates also refresh it at once). */
const ACTIVE_POLL_MS = 5_000;

const STATUS: Record<AuditExportStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  QUEUED: { label: 'Waiting', tone: 'neutral' },
  RUNNING: { label: 'Preparing', tone: 'info' },
  READY: { label: 'Ready', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

const count = (value: number) => value.toLocaleString('en-IN');
const formatName = (job: AuditExportJob) => (job.format === 'XLSX' ? 'Excel' : 'CSV');

/**
 * "Your exports" on the audit logs page: the admin's exports prepared on the server, with their progress, the download
 * of a ready file (a one-time link, saved by the browser) and cancel / remove. Hidden while there are none.
 */
export function AuditExportsCard() {
  const headingId = useId();
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: queryKeys.admin.auditExports,
    queryFn: () => auditExportApi.list(),
    refetchInterval: (query) => (Array.isArray(query.state.data) && query.state.data.some(isExportActive) ? ACTIVE_POLL_MS : false),
  });
  const remove = useMutation({
    mutationFn: (job: AuditExportJob) => auditExportApi.remove(job.id),
    onSuccess: (_, job) => {
      queryClient.setQueryData<AuditExportJob[]>(queryKeys.admin.auditExports, (list) => list?.filter((item) => item.id !== job.id));
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditExports });
    },
  });
  const download = useMutation({ mutationFn: (job: AuditExportJob) => downloadAuditExport(job) });

  const list = Array.isArray(jobs.data) ? jobs.data : [];
  if (list.length === 0) {
    return null;
  }
  const problem = remove.error ?? download.error;

  return (
    <section aria-labelledby={headingId}>
      <Card className="p-4 sm:p-5">
        <CardHeader id={headingId} title="Your exports"
          description="Large exports are prepared on the server. Each file can be downloaded until it expires, a day after it is ready." />
        <ul className="mt-4 flex flex-col gap-2" aria-label="Your audit log exports">
          {list.map((job) => (
            <ExportRow key={job.id} job={job}
              downloading={download.isPending && download.variables?.id === job.id}
              removing={remove.isPending && remove.variables?.id === job.id}
              onDownload={() => download.mutate(job)}
              onRemove={() => remove.mutate(job)} />
          ))}
        </ul>
        {problem && (
          <Alert tone="danger" className="mt-3" title={download.error ? 'The download did not start' : 'That did not work'}>
            {ApiError.from(problem).message}
          </Alert>
        )}
      </Card>
    </section>
  );
}

function ExportRow({ job, downloading, removing, onDownload, onRemove }: {
  job: AuditExportJob;
  downloading: boolean;
  removing: boolean;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const status = STATUS[job.status];
  const active = isExportActive(job);
  const name = `${formatName(job)} export of ${formatDateTime(job.createdAt)}`;
  const Icon = job.format === 'XLSX' ? FileSpreadsheet : Table2;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden="true" className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
          job.format === 'XLSX' ? 'bg-success-50 text-success-700 ring-success-100' : 'bg-info-50 text-info-700 ring-info-100')}>
          <Icon className="size-[1.125rem]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            {formatName(job)} · {describeExportFilters(job.filters)}
            <Badge tone={status.tone} dot>{status.label}</Badge>
          </p>
          <p className="text-xs text-slate-500">Requested {formatDateTime(job.createdAt)}</p>
          {active && <Progress job={job} name={name} />}
          {job.status === 'READY' && (
            <p className="text-xs text-slate-600">
              {[
                job.totalRows !== null ? `${count(job.totalRows)} ${job.totalRows === 1 ? 'row' : 'rows'}` : null,
                job.sizeBytes !== null ? formatFileSize(job.sizeBytes) : null,
                job.parts !== null && job.parts > 1 ? `${job.parts} Excel files in a .zip` : null,
                job.expiresAt ? `available until ${formatDateTime(job.expiresAt)}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          {job.status === 'FAILED' && job.error && <p className="text-xs text-danger-700">{job.error}</p>}
          {job.status === 'EXPIRED' && <p className="text-xs text-slate-500">The file was deleted. Export again to get a new one.</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {job.status === 'READY' && (
          <Button size="sm" variant="secondary" loading={downloading} aria-label={`Download ${job.fileName ?? name}`} onClick={onDownload}>
            {!downloading && <Download className="size-4" aria-hidden="true" />}
            Download
          </Button>
        )}
        <Button size="sm" variant="ghost" loading={removing} aria-label={`${active ? 'Cancel' : 'Remove'} ${name}`} onClick={onRemove}>
          {!removing && (active ? <X className="size-4" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />)}
          {active ? 'Cancel' : 'Remove'}
        </Button>
      </div>
    </li>
  );
}

function Progress({ job, name }: { job: AuditExportJob; name: string }) {
  const counted = job.totalRows !== null;
  const total = Math.max(job.totalRows ?? 0, 1);
  const done = Math.min(job.rowsWritten, total);
  const text = job.status === 'QUEUED'
    ? 'Waiting to start…'
    : counted ? `${count(job.rowsWritten)} of ${count(job.totalRows ?? 0)} rows` : 'Counting rows…';
  // Without a value the bar is indeterminate (waiting, counting).
  return (
    <div className="flex flex-col gap-1">
      <progress aria-label={`Progress of the ${name}`} aria-valuetext={text} max={total} value={counted ? done : undefined}
        className="h-1.5 w-full max-w-md overflow-hidden rounded-full accent-role-600" />
      <p className="text-xs text-slate-600">{text}</p>
    </div>
  );
}
