import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CreditCard } from 'lucide-react';

import { formatINR } from '@/components/charts';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/StateViews';
import { paymentStatusInfo } from '@/features/payments/paymentStatus';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime } from '@/lib/format';
import { LoadError } from '../shared/adminUi';
import { useCan } from '../shared/permissions';
import { adminPaymentApi } from '../payments/adminPaymentApi';
import { userApi } from '../users/userApi';
import { Initials } from './dashKit';

const RECENT = 5;

/**
 * The newest customer registrations and payments, each read from the API that owns them (the users and payments lists,
 * newest first) and shown only to admins who may read them. They are "latest", not tied to the range.
 */
export function RecentCustomers() {
  const allowed = useCan('USER_READ_ANY');
  const customers = useQuery({
    queryKey: queryKeys.admin.userList({ role: 'CUSTOMER', purpose: 'dashboard-recent' }),
    queryFn: () => userApi.list({ search: '', role: 'CUSTOMER', status: '', page: 0, sort: 'createdAt,desc' }, RECENT),
    enabled: allowed,
  });
  if (!allowed) return null;
  return (
    <PanelShell title="Newest customers" id="recent-registrations">
      {customers.isPending && <PanelLoading label="Loading new registrations…" />}
      {customers.isError && <LoadError error={customers.error} onRetry={() => void customers.refetch()} title="New registrations could not be loaded" />}
      {customers.data && customers.data.content.length === 0 && (
        <EmptyState compact illustration="none" title="No customers yet" description="New accounts show up here." />
      )}
      {customers.data && customers.data.content.length > 0 && (
        <ul aria-label="New registrations" className="stagger flex flex-col divide-y divide-slate-100">
          {customers.data.content.map((user) => {
            const name = `${user.firstName} ${user.lastName}`.trim();
            return (
              <li key={user.id}>
                <Link to={`/admin/users/${user.id}`} className="group flex items-center gap-3 rounded-xl px-1 py-2.5 transition-colors duration-(--duration-fast) hover:bg-role-50/60">
                  <Initials name={name} email={user.email} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900 group-hover:text-role-700">{name || user.email}</span>
                    <span className="block truncate text-xs text-slate-600">{user.email}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-slate-500">{formatDateTime(user.createdAt)}</span>
                    {user.status !== 'ACTIVE' && <Badge tone="warning">{user.status === 'PENDING_VERIFICATION' ? 'Not verified' : 'Deactivated'}</Badge>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

export function RecentPayments() {
  const allowed = useCan('PAYMENT_READ_ANY');
  const filters = { q: '', status: '', provider: '', from: '', to: '', page: 0, sort: 'createdAt,desc' } as const;
  const payments = useQuery({
    queryKey: [...queryKeys.admin.paymentList({ ...filters, recent: true }), RECENT],
    queryFn: () => adminPaymentApi.list(filters, RECENT),
    enabled: allowed,
  });
  if (!allowed) return null;
  return (
    <PanelShell title="Latest payments" id="recent-payments">
      {payments.isPending && <PanelLoading label="Loading recent payments…" />}
      {payments.isError && <LoadError error={payments.error} onRetry={() => void payments.refetch()} title="Recent payments could not be loaded" />}
      {payments.data && payments.data.content.length === 0 && (
        <EmptyState compact illustration="none" title="No payments yet" description="They show up here as customers pay." />
      )}
      {payments.data && payments.data.content.length > 0 && (
        <ul aria-label="Recent payments" className="stagger flex flex-col divide-y divide-slate-100">
          {payments.data.content.map((payment) => {
            const info = paymentStatusInfo[payment.status] ?? { label: payment.status, tone: 'neutral' as const };
            return (
              <li key={payment.id}>
                <Link to={`/admin/payments/${payment.id}`} className="group flex items-center gap-3 rounded-xl px-1 py-2.5 transition-colors duration-(--duration-fast) hover:bg-role-50/60">
                  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success-50 text-success-600 ring-1 ring-inset ring-success-200">
                    <CreditCard className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900 group-hover:text-role-700">{payment.bookingReference ?? `${payment.id.slice(0, 8)}…`}</span>
                    <span className="block truncate text-xs text-slate-600">{payment.contactEmail ? `${payment.contactEmail} · ` : ''}{formatDateTime(payment.createdAt)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-bold tabular-nums text-slate-900">{formatINR(payment.amount)}</span>
                    <Badge tone={info.tone} dot>{info.label}</Badge>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

function PanelShell({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="min-w-0 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3">
      <span role="status" className="sr-only">{label}</span>
      {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}
    </div>
  );
}
