import { useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { History, KeyRound, LogOut, Monitor, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/app/providers/useAuth';
import { ExportMenu } from '@/components/export/ExportMenu';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TableCard } from '@/components/ui/DataTable';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { PasswordField } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES_UP_TO_50 } from '@/components/ui/paginationItems';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { PasswordChecklist } from '@/features/auth/PasswordChecklist';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { cn } from '@/lib/cn';
import type { ExportColumn } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import { primaryPortal, signInPath } from '@/lib/auth/portals';
import { accountApi } from './accountApi';
import { SectionHeader } from './AccountLayout';
import { changePasswordSchema, type ChangePasswordForm } from './schemas';
import type { LoginHistoryEntry } from './types';
import { useLoginHistory } from './useAccount';

export function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <ChangePasswordCard />
      <SessionsCard />
      <LoginHistoryCard />
    </div>
  );
}

function ChangePasswordCard() {
  const { user, login } = useAuth();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm<ChangePasswordForm>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const newPassword = useWatch({ control, name: 'newPassword' });

  const mutation = useMutation({
    mutationFn: (form: ChangePasswordForm) =>
      accountApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
    onSuccess: (response) => {
      // This session continues with a fresh token; every other device was logged out.
      login(response);
      reset();
      toast.success('Your password was changed. Other devices have been logged out.');
    },
    onError: (error) => {
      const apiError = ApiError.from(error);
      if (apiError.code === 'CURRENT_PASSWORD_INCORRECT') {
        setError('currentPassword', { message: 'The current password is not correct' }, { shouldFocus: true });
      } else if (apiError.code === 'PASSWORD_UNCHANGED') {
        setError('newPassword', { message: 'The new password must be different' }, { shouldFocus: true });
      } else {
        applyServerErrors(error, setError, ['currentPassword', 'newPassword'], 'newPassword');
      }
    },
  });
  const error = mutation.error ? ApiError.from(mutation.error) : null;
  const handledOnField = ['CURRENT_PASSWORD_INCORRECT', 'PASSWORD_UNCHANGED', 'WEAK_PASSWORD', 'VALIDATION_FAILED'];

  return (
    <Card className="p-5 sm:p-6">
      <CardTitle icon={<KeyRound className="size-5" />}>
        <SectionHeader title="Change password" description="You stay logged in here; all other devices are logged out." />
      </CardTitle>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <form onSubmit={handleSubmit((form) => mutation.mutate(form))} noValidate className="flex flex-col gap-4">
          {error && !handledOnField.includes(error.code) && <Alert tone="danger">{error.message}</Alert>}
          <input type="text" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
          <PasswordField label="Current password" autoComplete="current-password" error={errors.currentPassword?.message} {...register('currentPassword')} />
          <div className="flex flex-col gap-2">
            <PasswordField label="New password" autoComplete="new-password" error={errors.newPassword?.message} {...register('newPassword')} />
            <PasswordChecklist password={newPassword} email={user?.email} />
          </div>
          <PasswordField label="Repeat new password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
          <div>
            <Button type="submit" loading={mutation.isPending}>
              Change password
            </Button>
          </div>
        </form>
        <aside aria-label="Password tips" className="hidden self-start rounded-2xl bg-gradient-sky p-5 ring-1 ring-brand-100 lg:block">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <ShieldCheck className="size-5 text-brand-600" aria-hidden="true" /> A strong password
          </p>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-slate-700">
            <li>Use a few unrelated words, or a long sentence you can remember.</li>
            <li>Never reuse the password of your e-mail or of another site.</li>
            <li>Change it straight away if you think someone else knows it.</li>
          </ul>
        </aside>
      </div>
    </Card>
  );
}

function SessionsCard() {
  const { user, endSession } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: accountApi.logoutEverywhere,
    onSuccess: () => endSession(signInPath(user ? primaryPortal(user) : 'CUSTOMER', { reason: 'logged-out-everywhere' })),
  });

  return (
    <Card className="p-5 sm:p-6">
      <CardTitle icon={<LogOut className="size-5" />} tone="danger">
        <SectionHeader
          title="Log out everywhere"
          description="Lost a phone or used a shared computer? End every session, including this one."
        />
      </CardTitle>
      {mutation.isError && <Alert tone="danger" className="mb-4">{ApiError.from(mutation.error).message}</Alert>}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger-200 bg-danger-50 p-4">
          <span className="w-full text-sm font-medium text-danger-700 sm:w-auto sm:flex-1">You will need to log in again on every device.</span>
          <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Log out everywhere
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Log out on all devices…
        </Button>
      )}
    </Card>
  );
}

const FAILURE_REASONS: Record<string, string> = {
  BAD_PASSWORD: 'Wrong password',
  ACCOUNT_LOCKED: 'Account was locked',
  EMAIL_NOT_VERIFIED: 'Email not verified yet',
  ACCOUNT_DISABLED: 'Account deactivated',
  PORTAL_NOT_ALLOWED: 'Wrong sign-in page',
};

/** The result of a login attempt, as the table shows it. */
const attemptResult = (entry: LoginHistoryEntry) => (entry.success ? 'Logged in' : FAILURE_REASONS[entry.failureReason ?? ''] ?? 'Failed');

/** The columns of an export of my login activity: the table's columns. */
const ACTIVITY_COLUMNS: ExportColumn<LoginHistoryEntry>[] = [
  { header: 'When', value: (entry) => entry.occurredAt, type: 'datetime' },
  { header: 'Result', value: attemptResult },
  { header: 'IP address', value: (entry) => entry.ipAddress },
  { header: 'Device', value: (entry) => describeDevice(entry.userAgent) },
];

/** Login history rows per page until the customer picks another size; the API allows at most 50. */
const HISTORY_PAGE_SIZE = 10;

/** A card's heading row with an icon tile in front. */
function CardTitle({ icon, tone = 'brand', children }: { icon: ReactNode; tone?: 'brand' | 'danger'; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl ring-1',
          tone === 'danger' ? 'bg-danger-50 text-danger-600 ring-danger-200' : 'bg-brand-50 text-brand-600 ring-brand-100',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function LoginHistoryCard() {
  const { user } = useAuth();
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(HISTORY_PAGE_SIZE);
  const history = useLoginHistory(page, size);
  const shown = history.data && history.data.content.length > 0 ? history.data : null;

  return (
    <Card className="p-5 sm:p-6">
      <CardTitle icon={<History className="size-5" />}>
        <SectionHeader
          title="Recent activity"
          description="Logins and failed attempts on your account. Something you don't recognize? Change your password."
          action={shown && (
            // My own activity only: the same call as the table (the server scopes it to me), newest first.
            <ExportMenu
              title="Login activity"
              subtitle={user ? `${user.firstName} ${user.lastName}` : undefined}
              fileName="login-activity"
              columns={ACTIVITY_COLUMNS}
              rows={shown.content}
              total={shown.totalElements}
              pageLabel={`Page ${shown.page + 1} of ${Math.max(shown.totalPages, 1)}`}
              // No row key: entries have no id, and two attempts in the same second must both stay in the file.
              fetchPage={(pageNo, pageSize) => accountApi.loginHistory(pageNo, pageSize)}
            />
          )}
        />
      </CardTitle>
      {history.isPending && <LoadingState label="Loading your recent activity…" rows={3} />}
      {history.isError && (
        <ErrorState description={ApiError.from(history.error).message} onRetry={() => void history.refetch()} />
      )}
      {history.data && (
        <>
          <TableCard caption="Login history, newest first" flat>
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>When</th>
                <th scope="col" className={tableStyles.th}>Result</th>
                <th scope="col" className={tableStyles.th}>IP address</th>
                <th scope="col" className={tableStyles.th}>Device</th>
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {history.data.content.map((entry) => (
                <tr key={`${entry.occurredAt}-${entry.ipAddress}-${entry.success}`} className={tableStyles.tr}>
                  <td className={cn(tableStyles.cell, 'whitespace-nowrap font-medium text-slate-900')}>{formatDateTime(entry.occurredAt)}</td>
                  <td className={cn(tableStyles.td, 'whitespace-nowrap')}>
                    <Badge tone={entry.success ? 'success' : 'danger'} dot>{attemptResult(entry)}</Badge>
                  </td>
                  <td className={cn(tableStyles.td, 'whitespace-nowrap')}>{entry.ipAddress ?? '—'}</td>
                  <td className={cn(tableStyles.td, 'max-w-xs')} title={entry.userAgent ?? undefined}>
                    <span className="flex items-center gap-2">
                      <Monitor className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
                      <span className="truncate">{describeDevice(entry.userAgent)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableCard>
          <Pagination
            data={history.data}
            onPageChange={setPage}
            onPageSizeChange={(next) => { setSize(next); setPage(0); }}
            pageSizes={PAGE_SIZES_UP_TO_50}
            noun={['login attempt', 'login attempts']}
            className="mt-4"
          />
        </>
      )}
    </Card>
  );
}

/** "Mozilla/5.0 (Windows NT 10.0...) ... Chrome/142..." → "Chrome on Windows". */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser =
    /Edg\//.test(userAgent) ? 'Edge'
      : /OPR\//.test(userAgent) ? 'Opera'
        : /Chrome\//.test(userAgent) ? 'Chrome'
          : /Firefox\//.test(userAgent) ? 'Firefox'
            : /Safari\//.test(userAgent) ? 'Safari'
              : null;
  const os =
    /Windows/.test(userAgent) ? 'Windows'
      : /Android/.test(userAgent) ? 'Android'
        : /iPhone|iPad/.test(userAgent) ? 'iOS'
          : /Mac OS X/.test(userAgent) ? 'macOS'
            : /Linux/.test(userAgent) ? 'Linux'
              : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? userAgent.slice(0, 60);
}
