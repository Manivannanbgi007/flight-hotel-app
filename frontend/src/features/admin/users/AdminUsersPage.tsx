import { useId, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { UserPlus, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextField } from '@/components/ui/Field';
import { checkboxClass } from '@/components/ui/fieldStyles';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import type { Role } from '@/lib/auth/types';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import {
  FilterCard, ListLoading, LoadError, PageHeader, ProblemAlert, RequirePermission, ResultCount, SearchBox, SortHeader, TableShell, tdClass,
} from '../shared/adminUi';
import { ROLE_LABELS, ROLES, STAFF_ROLES } from '../shared/labels';
import { useCan } from '../shared/permissions';
import { readEnum, readPage, readSort, sortParam, useSearchState } from '../shared/searchState';
import { userApi, type AdminUser, type UserFilters, type UserStatus } from './userApi';
import { asRoles, inviteSchema, USER_STATUS_INFO, USER_STATUSES, type InviteForm } from './userText';

const SORTS = ['createdAt', 'lastLoginAt'] as const;
const SORT_LABELS: Record<(typeof SORTS)[number], string> = { createdAt: 'Joined', lastLoginAt: 'Last login' };

/** The columns of an export (CSV, Excel, PDF): what the table shows, one figure per column. */
const EXPORT_COLUMNS: ExportColumn<AdminUser>[] = [
  { header: 'Name', value: (account) => `${account.firstName} ${account.lastName}` },
  { header: 'E-mail', value: (account) => account.email },
  { header: 'Roles', value: (account) => account.roles.map((role) => ROLE_LABELS[role] ?? role).join(', ') },
  { header: 'Status', value: (account) => USER_STATUS_INFO[account.status]?.label ?? account.status },
  { header: 'Last login', value: (account) => account.lastLoginAt, type: 'datetime' },
  { header: 'Joined', value: (account) => account.createdAt, type: 'datetime' },
];

/** /admin/users — find accounts by e-mail or name, filter by role and status, invite staff. */
export function AdminUsersPage() {
  return (
    <RequirePermission permission="USER_READ_ANY">
      <Users />
    </RequirePermission>
  );
}

function Users() {
  const { params, update } = useSearchState();
  const canManage = useCan('USER_MANAGE');
  const [inviting, setInviting] = useState(false);
  const sort = readSort(params, SORTS);
  const filters: UserFilters = {
    search: params.get('q')?.trim() ?? '',
    role: readEnum(params, 'role', ROLES),
    status: readEnum(params, 'status', USER_STATUSES),
    page: readPage(params),
    sort: sortParam(sort),
  };
  const size = readPageSize(params, PAGE_SIZES, 25);
  const users = useQuery({
    queryKey: [...queryKeys.admin.userList(filters), size],
    queryFn: () => userApi.list(filters, size),
    placeholderData: keepPreviousData,
  });
  const data = users.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={<UsersIcon className="size-5" />}
        title="Users"
        description="Customers and staff accounts. Open an account to change its roles or to deactivate it."
        actions={canManage && <Button onClick={() => setInviting(true)}><UserPlus className="size-4" aria-hidden="true" /> Invite staff</Button>}
      />
      <FilterCard>
        <SearchBox key={filters.search} initial={filters.search} label="Search" placeholder="E-mail or name" onSearch={(q) => update({ q })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Role" value={filters.role} onChange={(event) => update({ role: event.target.value })}>
            <option value="">All roles</option>
            {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </SelectField>
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All statuses</option>
            {USER_STATUSES.map((status) => <option key={status} value={status}>{USER_STATUS_INFO[status].label}</option>)}
          </SelectField>
        </div>
      </FilterCard>

      {users.isPending && <ListLoading label="Loading users…" />}
      {users.isError && <LoadError error={users.error} onRetry={() => void users.refetch()} />}
      {data && data.content.length === 0 && <EmptyState title="No users found" />}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><ResultCount count={data.totalElements} noun={['user', 'users']} /></div>
            <ExportMenu
              className="ml-auto"
              title="Users"
              subtitle="Admin portal"
              fileName="users"
              columns={EXPORT_COLUMNS}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => userApi.list({ ...filters, page }, pageSize)}
              rowKey={(account) => account.id}
              filters={describeFilters([
                ['Search', filters.search],
                ['Role', filters.role && ROLE_LABELS[filters.role]],
                ['Status', filters.status && USER_STATUS_INFO[filters.status].label],
                ['Sort', sort && `${SORT_LABELS[sort.field as (typeof SORTS)[number]]}, ${sort.direction === 'desc' ? 'newest first' : 'oldest first'}`],
              ])}
              personalData
            />
          </div>
          <TableShell caption="Users">
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>Name</th>
                <th scope="col" className={tableStyles.th}>Roles</th>
                <th scope="col" className={tableStyles.th}>Status</th>
                <SortHeader label="Last login" field="lastLoginAt" sort={sort} onSort={(next) => update({ sort: sortParam(next) })} />
                <SortHeader label="Joined" field="createdAt" sort={sort} onSort={(next) => update({ sort: sortParam(next) })} />
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {data.content.map((account) => (
                <tr key={account.id} className={tableStyles.tr}>
                  <td className={tdClass}>
                    <Link to={`/admin/users/${account.id}`} className="font-medium text-role-700 hover:underline">{account.firstName} {account.lastName}</Link>
                    <span className="block break-all text-slate-600">{account.email}</span>
                  </td>
                  <td className={tdClass}>
                    <span className="flex flex-wrap gap-1">{account.roles.map((role) => <Badge key={role} tone="info">{ROLE_LABELS[role] ?? role}</Badge>)}</span>
                  </td>
                  <td className={tdClass}><StatusBadge status={account.status} /></td>
                  <td className={`${tdClass} whitespace-nowrap text-slate-700`}>{account.lastLoginAt ? formatDateTime(account.lastLoginAt) : 'Never'}</td>
                  <td className={`${tdClass} whitespace-nowrap text-slate-700`}>{formatDateTime(account.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Pagination data={data} noun={['user', 'users']} pageSizes={PAGE_SIZES}
            onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
        </>
      )}
      {canManage && <InviteDialog open={inviting} onClose={() => setInviting(false)} />}
    </div>
  );
}

export function StatusBadge({ status }: { status: UserStatus }) {
  const info = USER_STATUS_INFO[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={info.tone}>{info.label}</Badge>;
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { register, handleSubmit, setError, reset, formState: { errors } } = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { firstName: '', lastName: '', email: '', roles: [] },
  });
  const invite = useMutation({
    mutationFn: (form: InviteForm) => userApi.invite({ ...form, roles: asRoles(form.roles) }),
    onSuccess: (account) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users });
      toast.success(`Invitation sent to ${account.email}.`);
      reset();
      onClose();
      void navigate(`/admin/users/${account.id}`);
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      if (problem.code === 'EMAIL_ALREADY_REGISTERED') {
        setError('email', { type: 'server', message: problem.message }, { shouldFocus: true });
      } else {
        applyServerErrors(error, setError, ['email', 'firstName', 'lastName', 'roles']);
      }
    },
  });
  const rolesErrorId = useId();
  const problem = invite.error ? ApiError.from(invite.error) : null;
  const showProblem = problem && problem.code !== 'EMAIL_ALREADY_REGISTERED' && problem.fieldErrors.length === 0;

  return (
    <Dialog open={open} onClose={onClose} title="Invite a staff member" description="They get an e-mail with a link to set their password.">
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit((form) => invite.mutate(form))(event)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="First name" autoComplete="off" error={errors.firstName?.message} {...register('firstName')} />
          <TextField label="Last name" autoComplete="off" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <TextField label="E-mail" type="email" autoComplete="off" error={errors.email?.message} {...register('email')} />
        <fieldset aria-describedby={errors.roles ? rolesErrorId : undefined}>
          <legend className="text-sm font-medium text-slate-800">Roles</legend>
          <div className="mt-2 flex flex-col gap-2">
            {STAFF_ROLES.map((role: Role) => (
              <label key={role} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" value={role} className={checkboxClass} {...register('roles')} />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
          {errors.roles && <p id={rolesErrorId} className="mt-1 text-sm text-danger-600">{errors.roles.message}</p>}
        </fieldset>
        {showProblem && <ProblemAlert error={invite.error} title="The invitation was not sent" />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={invite.isPending}>Send invitation</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
