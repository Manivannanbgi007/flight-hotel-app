import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { useAuth } from '@/app/providers/useAuth';
import { Alert } from '@/components/ui/Alert';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField } from '@/components/ui/Field';
import { checkboxClass } from '@/components/ui/fieldStyles';
import { LoadingState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import type { Role } from '@/lib/auth/types';
import { formatDateTime } from '@/lib/format';
import { DetailList, LoadError, ProblemAlert, RequirePermission } from '../shared/adminUi';
import { ROLE_LABELS, ROLES } from '../shared/labels';
import { useCan } from '../shared/permissions';
import { StatusBadge } from './AdminUsersPage';
import { userApi, type AdminUser } from './userApi';
import { STATUS_REASON_MAX, statusReasonSchema, type StatusReasonForm } from './userText';

/** /admin/users/:userId — one account: details, roles and activation. */
export function AdminUserPage() {
  return (
    <RequirePermission permission="USER_READ_ANY">
      <UserDetails />
    </RequirePermission>
  );
}

function UserDetails() {
  const { userId = '' } = useParams();
  const user = useQuery({ queryKey: queryKeys.admin.user(userId), queryFn: () => userApi.get(userId), retry: false });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm"><Link to="/admin/users" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-semibold text-role-700 shadow-xs ring-1 ring-slate-200 transition-colors hover:bg-role-50">← Users</Link></p>
      {user.isPending && <LoadingState label="Loading the account…" />}
      {user.isError && (
        <LoadError error={user.error} title={ApiError.from(user.error).status === 404 ? 'User not found' : undefined}
          onRetry={ApiError.from(user.error).status === 404 ? undefined : () => void user.refetch()} />
      )}
      {user.data && <Account account={user.data} />}
    </div>
  );
}

function Account({ account }: { account: AdminUser }) {
  const { user: me } = useAuth();
  const canManage = useCan('USER_MANAGE');
  const [confirming, setConfirming] = useState(false);
  const isMe = me?.id === account.id;
  const deactivating = account.status !== 'DEACTIVATED';

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card animate-fade-up">
        <Avatar name={`${account.firstName} ${account.lastName}`} size="lg" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{account.firstName} {account.lastName}</h1>
        <StatusBadge status={account.status} />
        {isMe && <span className="text-sm text-slate-500">(you)</span>}
      </header>
      <Card className="p-5">
        <DetailList items={[
          ['E-mail', account.email],
          ['E-mail verified', account.emailVerified ? 'Yes' : 'No'],
          ['Joined', formatDateTime(account.createdAt)],
          ['Last login', account.lastLoginAt ? formatDateTime(account.lastLoginAt) : 'Never'],
          ['User id', <span className="font-mono text-xs">{account.id}</span>],
        ]} />
      </Card>

      <RolesCard key={account.roles.join()} account={account} canManage={canManage} />

      {canManage && (
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Access</h2>
          <p className="mt-1 text-sm text-slate-600">
            {deactivating
              ? 'Deactivating logs the person out everywhere at once and stops them from logging in.'
              : 'This account is deactivated. Activate it to let the person log in again.'}
          </p>
          <Button className="mt-3" variant={deactivating ? 'danger' : 'primary'} onClick={() => setConfirming(true)}>
            {deactivating ? 'Deactivate account' : 'Activate account'}
          </Button>
          <StatusDialog key={account.status} account={account} open={confirming} onClose={() => setConfirming(false)} />
        </Card>
      )}
    </>
  );
}

function RolesCard({ account, canManage }: { account: AdminUser; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<Role[]>(account.roles);
  const changed = roles.length !== account.roles.length || roles.some((role) => !account.roles.includes(role));
  const save = useMutation({
    mutationFn: () => userApi.changeRoles(account.id, ROLES.filter((role) => roles.includes(role))),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.admin.user(account.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users });
      setRoles(saved.roles);
      toast.success('Roles saved.');
    },
  });

  return (
    <Card className="p-5">
      <fieldset disabled={!canManage}>
        <legend className="font-semibold text-slate-900">Roles</legend>
        <div className="mt-2 flex flex-col gap-2">
          {ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={roles.includes(role)}
                onChange={(event) => setRoles((current) => (event.target.checked ? [...current, role] : current.filter((r) => r !== role)))}
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
      </fieldset>
      {canManage && (
        <div className="mt-3 flex flex-col gap-2">
          {roles.length === 0 && <p className="text-sm text-danger-600">Keep at least one role.</p>}
          <div>
            <Button disabled={!changed || roles.length === 0} loading={save.isPending} onClick={() => save.mutate()}>Save roles</Button>
          </div>
          {save.isError && <ProblemAlert error={save.error} title="The roles were not changed" />}
        </div>
      )}
    </Card>
  );
}

function StatusDialog({ account, open, onClose }: { account: AdminUser; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const deactivating = account.status !== 'DEACTIVATED';
  const { register, handleSubmit, formState: { errors } } = useForm<StatusReasonForm>({
    resolver: zodResolver(statusReasonSchema(deactivating)),
    defaultValues: { reason: '' },
  });
  const change = useMutation({
    mutationFn: (reason: string) => userApi.changeStatus(account.id, deactivating ? 'DEACTIVATED' : 'ACTIVE', reason),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.admin.user(account.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users });
      toast.success(saved.status === 'DEACTIVATED' ? 'Account deactivated.' : 'Account activated.');
      onClose();
    },
  });
  const name = `${account.firstName} ${account.lastName}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={deactivating ? `Deactivate ${name}?` : `Activate ${name}?`}
      description={deactivating ? 'They are logged out everywhere at once. You can activate the account again later.' : 'They can log in again straight away.'}
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit((form) => change.mutate(form.reason))(event)}>
        <TextAreaField label="Reason" optional={!deactivating} rows={3} maxLength={STATUS_REASON_MAX}
          hint="Kept in the audit log." error={errors.reason?.message} {...register('reason')} />
        {change.isError && (ApiError.from(change.error).code === 'CANNOT_CHANGE_OWN_ACCOUNT'
          ? <Alert tone="danger" title="You cannot change your own account">{ApiError.from(change.error).message}</Alert>
          : <ProblemAlert error={change.error} title="Nothing was changed" />)}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={deactivating ? 'danger' : 'primary'} loading={change.isPending}>
            {deactivating ? 'Deactivate' : 'Activate'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
