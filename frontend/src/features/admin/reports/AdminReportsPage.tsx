import { Link } from 'react-router';
import { BarChart3, ChevronRight, FileBarChart } from 'lucide-react';

import { PageHeader, RequirePermission } from '../shared/adminUi';
import { REPORTS } from './reports';

/** /admin/reports — the report picker. */
export function AdminReportsPage() {
  return (
    <RequirePermission permission="REPORT_VIEW">
      <div className="flex flex-col gap-4">
        <PageHeader icon={<BarChart3 className="size-5" />} title="Reports" description="Pick a report, then a date range. Every report can be downloaded." />
        <ul className="grid gap-4 stagger sm:grid-cols-2 xl:grid-cols-3" aria-label="Reports">
          {REPORTS.map((report) => (
            <li key={report.key}>
              <Link to={`/admin/reports/${report.key}`}
                className="group flex h-full items-start gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card hover-lift hover:border-role-200">
                <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-role-100 transition-colors group-hover:bg-role-600 group-hover:text-white">
                  <FileBarChart className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-slate-900 group-hover:text-role-700">{report.title}</span>
                  <span className="mt-1 block text-sm text-slate-600">{report.description}</span>
                </span>
                <ChevronRight className="mt-0.5 size-5 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </RequirePermission>
  );
}
