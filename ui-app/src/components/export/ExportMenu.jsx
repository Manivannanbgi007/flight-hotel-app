import { useEffect, useId, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { ChevronDown, Download, FileSpreadsheet, FileText, ShieldAlert, Table2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/app/providers/useAuth';
import { Button } from '@/components/ui/Button';
import { radioClass } from '@/components/ui/fieldStyles';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { ApiError } from '@/lib/api/apiError';
import { primaryRoleLabel } from '@/lib/auth/roleLabels';
import { cn } from '@/lib/cn';
import { saveFile } from '@/lib/download';
import {
  collectAllRows,
  createExportFile,
  EXPORT_ROW_LIMIT,
  ExportTooLargeError,
  FORMAT_LABELS,
  PDF_ROW_LIMIT,
} from '@/lib/export';

const FORMATS = [
  { format: 'xlsx', label: 'Excel (.xlsx)', hint: 'Formatted columns, sorting and filters', icon: FileSpreadsheet },
  { format: 'csv', label: 'CSV', hint: 'Plain values for any program', icon: Table2 },
  { format: 'pdf', label: 'PDF', hint: 'A printable report', icon: FileText },
];

const count = (value) => value.toLocaleString('en-IN');
const rowsText = (value) => `${count(value)} row${value === 1 ? '' : 's'}`;

/**
 * "Export" for any table: Excel, CSV or PDF of this page or of every matching row, with the screen's filters, search
 * and sort, and only the data the signed-in user may see (the rows come from the same role-checked API calls as the
 * screen). The file names the export time, who exported and the filters. Put it on the right of the list's result row.
 */
export function ExportMenu({
  title,
  subtitle,
  fileName,
  columns,
  rows,
  fetchPage,
  total,
  pageLabel,
  filters = [],
  rowKey,
  personalData = false,
  totals,
  serverExport,
  formats = ['xlsx', 'csv', 'pdf'],
  disabled = false,
  className,
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('page');
  const [running, setRunning] = useState(null);
  const [progress, setProgress] = useState(null);
  const [problem, setProblem] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const abortRef = useRef(null);
  const panelId = useId();
  const scopeName = useId();

  const pageCount = rows.length;
  const allCount = fetchPage ? (total ?? pageCount) : pageCount;
  const canAll = !!fetchPage && allCount > pageCount;
  const tooMany = canAll && allCount > EXPORT_ROW_LIMIT;
  // Above the browser's limit, every matching row can still come from the server (when the screen offers it).
  const onServerAbove = tooMany && !!serverExport;
  const chosen = scope === 'all' && canAll && (!tooMany || onServerAbove) ? 'all' : 'page';
  const onServer = chosen === 'all' && onServerAbove;
  const exportCount = chosen === 'all' ? allCount : pageCount;
  const nothing = pageCount === 0;
  const exportedBy = user ? `${user.firstName} ${user.lastName} (${primaryRoleLabel(user.roles)})` : undefined;

  // Leaving the page cancels a running collection.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('input:not([disabled]), button:not([disabled])')?.focus();
  }, [open]);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  /** Every matching row, written by the server in the background: here only the request. */
  const startOnServer = async (server, format) => {
    setProblem(null);
    setRunning(format);
    try {
      await server.start(format, { exportedBy });
      toast.success('Preparing your export', {
        description: 'We’ll let you know when it’s ready. You can keep working.',
      });
      close();
    } catch (error) {
      setProblem(ApiError.from(error).message);
    } finally {
      setRunning(null);
    }
  };

  const run = async (format) => {
    if (onServer && serverExport && format !== 'pdf') {
      await startOnServer(serverExport, format);
      return;
    }
    setProblem(null);
    setRunning(format);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let data = rows;
      let scopeText = pageLabel
        ? `${pageLabel} (${rowsText(pageCount)})`
        : `The rows on screen (${rowsText(pageCount)})`;
      if (!canAll) scopeText = `All ${rowsText(pageCount)}`;
      if (chosen === 'all' && fetchPage) {
        setProgress({ loaded: 0, total: allCount });
        data = await collectAllRows(fetchPage, {
          signal: controller.signal,
          key: rowKey,
          onProgress: (loaded, of) => setProgress({ loaded, total: of }),
        });
        scopeText = `All ${rowsText(data.length)} matching the filters`;
      }
      const file = await createExportFile(format, {
        title,
        subtitle,
        fileName,
        columns,
        rows: data,
        filters,
        scope: scopeText,
        exportedBy,
        totals: chosen === 'all' || !canAll ? totals : undefined,
      });
      saveFile(file.blob, file.fileName);
      toast.success(`${FORMAT_LABELS[format]} file downloaded`, {
        description: `${file.fileName} · ${rowsText(data.length)}`,
      });
      close();
    } catch (error) {
      if (controller.signal.aborted) {
        toast('Export cancelled');
      } else if (error instanceof ExportTooLargeError || error instanceof RangeError) {
        setProblem(error.message);
      } else {
        // A failed request says why (and the support reference); a failure while writing the file is ours.
        setProblem(
          error instanceof ApiError || isAxiosError(error)
            ? ApiError.from(error).message
            : 'The file could not be made. Please try again.',
        );
      }
    } finally {
      abortRef.current = null;
      setRunning(null);
      setProgress(null);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className={cn('relative inline-flex', className)}>
      <Button
        ref={buttonRef}
        variant="secondary"
        size="sm"
        disabled={disabled || nothing}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        title={nothing ? 'Nothing to export' : undefined}
      >
        <Download className="size-4" aria-hidden="true" />
        {running ? 'Exporting…' : 'Export'}
        <ChevronDown
          className={cn('size-4 text-slate-500 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </Button>
      {open && (
        <FloatingPanel
          anchor={buttonRef}
          onDismiss={() => {
            if (!running) close(false);
          }}
          className="w-80"
        >
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={`Export ${title.toLowerCase()}`}
            onKeyDown={onKeyDown}
            className="flex flex-col gap-3 p-1.5"
          >
            <p className="px-1 text-sm font-semibold text-slate-900">Export {title.toLowerCase()}</p>

            {fetchPage && canAll && (
              <fieldset className="flex flex-col gap-1" disabled={!!running}>
                <legend className="mb-1 px-1 text-xs font-bold uppercase tracking-wider text-slate-500">Rows</legend>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-slate-50',
                    chosen === 'page' && 'bg-role-50/70',
                  )}
                >
                  <input
                    type="radio"
                    name={scopeName}
                    className={cn(radioClass, 'mt-0.5')}
                    checked={chosen === 'page'}
                    onChange={() => setScope('page')}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-slate-900">This page</span>
                    <span className="block text-xs text-slate-500">
                      {pageLabel ? `${pageLabel} · ` : ''}
                      {rowsText(pageCount)}
                    </span>
                  </span>
                </label>
                <label
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl px-2 py-2',
                    tooMany && !onServerAbove ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-slate-50',
                    chosen === 'all' && 'bg-role-50/70',
                  )}
                >
                  <input
                    type="radio"
                    name={scopeName}
                    className={cn(radioClass, 'mt-0.5')}
                    checked={chosen === 'all'}
                    disabled={tooMany && !onServerAbove}
                    onChange={() => setScope('all')}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-slate-900">All matching rows</span>
                    <span className="block text-xs text-slate-500">
                      {tooMany && !onServerAbove
                        ? `${rowsText(allCount)}: more than ${count(EXPORT_ROW_LIMIT)}, narrow the filters`
                        : `${rowsText(allCount)} · same filters, search and sort`}
                    </span>
                    {onServerAbove && <span className="mt-1 block text-xs text-slate-600">{serverExport?.note}</span>}
                  </span>
                </label>
              </fieldset>
            )}

            <div role="group" aria-label="Format" className="flex flex-col gap-1">
              <p aria-hidden="true" className="px-1 text-xs font-bold uppercase tracking-wider text-slate-500">
                Format
              </p>
              {FORMATS.filter((option) => formats.includes(option.format)).map(
                ({ format, label, hint, icon: Icon }) => {
                  const pdfTooBig = format === 'pdf' && exportCount > PDF_ROW_LIMIT;
                  return (
                    <button
                      key={format}
                      type="button"
                      disabled={!!running || pdfTooBig}
                      onClick={() => void run(format)}
                      aria-describedby={pdfTooBig ? `${panelId}-pdf` : undefined}
                      className="group flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-role-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
                          format === 'xlsx'
                            ? 'bg-success-50 text-success-700 ring-success-100'
                            : format === 'csv'
                              ? 'bg-info-50 text-info-700 ring-info-100'
                              : 'bg-danger-50 text-danger-700 ring-danger-100',
                        )}
                      >
                        {running === format ? (
                          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                          <Icon className="size-[1.125rem]" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">{label}</span>
                        <span id={pdfTooBig ? `${panelId}-pdf` : undefined} className="block text-xs text-slate-500">
                          {pdfTooBig ? `At most ${count(PDF_ROW_LIMIT)} rows: choose Excel or CSV` : hint}
                        </span>
                      </span>
                    </button>
                  );
                },
              )}
            </div>

            {progress && (
              <div role="status" className="flex flex-col gap-1.5 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600">
                <span>
                  Collecting rows… {count(progress.loaded)} of {count(progress.total)}
                </span>
                <progress
                  max={Math.max(progress.total, 1)}
                  value={progress.loaded}
                  aria-label="Rows collected"
                  className="h-1.5 w-full overflow-hidden rounded-full accent-role-600"
                />
                <Button size="sm" variant="ghost" className="self-start" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </Button>
              </div>
            )}
            {problem && (
              <p
                role="alert"
                className="rounded-xl bg-danger-50 px-3 py-2 text-xs text-danger-700 ring-1 ring-inset ring-danger-100"
              >
                {problem}
              </p>
            )}
            {personalData && (
              <p className="flex items-start gap-2 border-t border-slate-100 px-1 pt-2.5 text-xs text-slate-500">
                <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning-600" aria-hidden="true" />
                The file holds personal data. Keep it safe and share it only as your data policy allows.
              </p>
            )}
          </div>
        </FloatingPanel>
      )}
    </div>
  );
}
