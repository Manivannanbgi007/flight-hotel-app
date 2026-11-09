import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation } from '@/test/renderRoutes';
import { adminWithout, fullAdmin, pageOf, renderAdmin } from '../testUtils';
import { AdminUserPage } from './AdminUserPage';
import { AdminUsersPage } from './AdminUsersPage';
import { userApi, type AdminUser } from './userApi';

vi.mock('./userApi', () => ({
  userApi: { list: vi.fn(), get: vi.fn(), invite: vi.fn(), changeStatus: vi.fn(), changeRoles: vi.fn() },
}));

const account = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 'u1', email: 'ravi@example.com', firstName: 'Ravi', lastName: 'Kumar', status: 'ACTIVE', roles: ['CUSTOMER'],
  emailVerified: true, lastLoginAt: '2026-11-04T08:00:00Z', createdAt: '2026-01-10T08:00:00Z', ...overrides,
});

const routes = [
  { path: '/admin/users', element: <AdminUsersPage /> },
  { path: '/admin/users/:userId', element: <AdminUserPage /> },
];

describe('AdminUsersPage', () => {
  const lastFilters = () => vi.mocked(userApi.list).mock.lastCall?.[0];

  it('lists accounts with roles, status and last login', async () => {
    vi.mocked(userApi.list).mockResolvedValue(pageOf([account(), account({ id: 'u2', email: 'meera@example.com', firstName: 'Meera', lastName: 'Shah',
      roles: ['SUPPORT_AGENT'], status: 'DEACTIVATED', lastLoginAt: null })]));
    const { user, router } = renderAdmin(routes, '/admin/users');

    const table = await screen.findByRole('table', { name: 'Users' });
    const [, ravi, meera] = within(table).getAllByRole('row');
    expect(ravi).toHaveTextContent('Ravi Kumarravi@example.comCustomerActive');
    expect(meera).toHaveTextContent('Support agent');
    expect(within(meera!).getByText('Deactivated')).toBeInTheDocument();
    expect(within(meera!).getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('2 users')).toBeInTheDocument();

    await user.click(within(ravi!).getByRole('link', { name: 'Ravi Kumar' }));
    expect(currentLocation(router)).toBe('/admin/users/u1');
  });

  it('exports the page on screen, and every matching user with the same filters and sort', async () => {
    const files = stubFileSaving();
    vi.mocked(userApi.list).mockImplementation(async (filters) => pageOf(
      [account({ id: `u${filters.page}`, email: `user${filters.page}@example.com` })],
      { page: filters.page, totalElements: 3, totalPages: 3 },
    ));
    const { user } = renderAdmin(routes, '/admin/users?q=ravi&status=ACTIVE&sort=createdAt,desc');
    await screen.findByRole('table', { name: 'Users' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(1));
    const lines = (await files.blobs[0]!.text()).trim().split('\r\n');
    expect(lines[0]).toBe('"Name","E-mail","Roles","Status","Last login","Joined"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^"Ravi Kumar","user0@example\.com","Customer","Active",\d{4}-\d{2}-\d{2} \d{2}:\d{2},\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    vi.mocked(userApi.list).mockClear();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(2));
    expect(vi.mocked(userApi.list).mock.calls).toEqual([0, 1, 2].map((page) =>
      [{ search: 'ravi', role: '', status: 'ACTIVE', page, sort: 'createdAt,desc' }, 100]));
    expect((await files.blobs[1]!.text()).trim().split('\r\n')).toHaveLength(4);
    expect(files.saved[1]!.fileName).toMatch(/^users-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('searches, filters by role and status and sorts, kept in the URL', async () => {
    vi.mocked(userApi.list).mockResolvedValue(pageOf([account()]));
    const { user, router } = renderAdmin(routes, '/admin/users');
    await screen.findByRole('table', { name: 'Users' });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'meera');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'Hotel manager');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Deactivated');

    await waitFor(() => expect(lastFilters()).toEqual({ search: 'meera', role: 'HOTEL_MANAGER', status: 'DEACTIVATED', page: 0, sort: undefined }));
    expect(currentLocation(router)).toBe('/admin/users?q=meera&role=HOTEL_MANAGER&status=DEACTIVATED');

    await user.click(screen.getByRole('button', { name: /Last login/ }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ sort: 'lastLoginAt,desc' }));
    expect(screen.getByRole('columnheader', { name: /Last login/ })).toHaveAttribute('aria-sort', 'descending');
    await user.click(screen.getByRole('button', { name: /Last login/ }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ sort: 'lastLoginAt,asc' }));
  });

  it('invites a staff member after checking the form', async () => {
    vi.mocked(userApi.list).mockResolvedValue(pageOf([]));
    vi.mocked(userApi.invite).mockResolvedValue(account({ id: 'u9', email: 'new@example.com', roles: ['SUPPORT_AGENT'], status: 'PENDING_VERIFICATION' }));
    vi.mocked(userApi.get).mockResolvedValue(account({ id: 'u9' }));
    const { user, router } = renderAdmin(routes, '/admin/users');

    await user.click(await screen.findByRole('button', { name: 'Invite staff' }));
    const dialog = screen.getByRole('dialog', { name: 'Invite a staff member' });
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(within(dialog).getByText('Enter the first name')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the e-mail address')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose at least one role')).toBeInTheDocument();
    expect(userApi.invite).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('First name'), 'Neha');
    await user.type(within(dialog).getByLabelText('Last name'), 'Iyer');
    await user.type(within(dialog).getByLabelText('E-mail'), 'new@example.com');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Support agent' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(userApi.invite).toHaveBeenCalledWith({ firstName: 'Neha', lastName: 'Iyer', email: 'new@example.com', roles: ['SUPPORT_AGENT'] }));
    expect(await screen.findByText('Invitation sent to new@example.com.')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/admin/users/u9');
  });

  it('puts "already registered" next to the e-mail', async () => {
    vi.mocked(userApi.list).mockResolvedValue(pageOf([]));
    vi.mocked(userApi.invite).mockRejectedValue(new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'This e-mail address is already registered.'));
    const { user } = renderAdmin(routes, '/admin/users');

    await user.click(await screen.findByRole('button', { name: 'Invite staff' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('First name'), 'Neha');
    await user.type(within(dialog).getByLabelText('Last name'), 'Iyer');
    await user.type(within(dialog).getByLabelText('E-mail'), 'asha@example.com');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Admin' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    expect(await within(dialog).findByText('This e-mail address is already registered.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
  });

  it('hides the invitation without USER_MANAGE', async () => {
    vi.mocked(userApi.list).mockResolvedValue(pageOf([account()]));
    renderAdmin(routes, '/admin/users', adminWithout('USER_MANAGE'));

    await screen.findByRole('table', { name: 'Users' });
    expect(screen.queryByRole('button', { name: 'Invite staff' })).not.toBeInTheDocument();
  });

  it('shows why the list could not be loaded', async () => {
    vi.mocked(userApi.list).mockRejectedValue(new ApiError(503, 'HTTP_503', 'Something went wrong on our side. Please try again later.', [], 'corr-7'));
    renderAdmin(routes, '/admin/users');

    expect(await screen.findByText('Support reference: corr-7')).toBeInTheDocument();
  });
});

describe('AdminUserPage', () => {
  it('shows the account and deactivates it with a reason after confirming', async () => {
    vi.mocked(userApi.get).mockResolvedValue(account());
    vi.mocked(userApi.changeStatus).mockResolvedValue(account({ status: 'DEACTIVATED' }));
    const { user } = renderAdmin(routes, '/admin/users/u1');

    expect(await screen.findByRole('heading', { name: 'Ravi Kumar' })).toBeInTheDocument();
    expect(screen.getByText('ravi@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deactivate account' }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Ravi Kumar?' });
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(within(dialog).getByText('Write a short reason')).toBeInTheDocument();
    expect(userApi.changeStatus).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Reason'), 'Left the company');
    vi.mocked(userApi.get).mockResolvedValue(account({ status: 'DEACTIVATED' }));
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(userApi.changeStatus).toHaveBeenCalledWith('u1', 'DEACTIVATED', 'Left the company'));
    expect(await screen.findByText('Account deactivated.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Activate account' })).toBeInTheDocument();
  });

  it('changes the roles', async () => {
    vi.mocked(userApi.get).mockResolvedValue(account());
    vi.mocked(userApi.changeRoles).mockResolvedValue(account({ roles: ['CUSTOMER', 'HOTEL_MANAGER'] }));
    const { user } = renderAdmin(routes, '/admin/users/u1');

    const save = await screen.findByRole('button', { name: 'Save roles' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Hotel manager' }));
    await user.click(save);

    await waitFor(() => expect(userApi.changeRoles).toHaveBeenCalledWith('u1', ['CUSTOMER', 'HOTEL_MANAGER']));
    expect(await screen.findByText('Roles saved.')).toBeInTheDocument();
  });

  it('shows the server\'s message when an admin tries to change their own account', async () => {
    vi.mocked(userApi.get).mockResolvedValue(account({ id: fullAdmin.id, email: fullAdmin.email, roles: ['ADMIN'] }));
    vi.mocked(userApi.changeRoles).mockRejectedValue(
      new ApiError(422, 'CANNOT_CHANGE_OWN_ACCOUNT', 'You cannot remove your own admin role.', [], 'corr-3'));
    const { user } = renderAdmin(routes, `/admin/users/${fullAdmin.id}`);

    expect(await screen.findByText('(you)')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Admin' }));
    await user.click(screen.getByRole('checkbox', { name: 'Support agent' }));
    await user.click(screen.getByRole('button', { name: 'Save roles' }));

    expect(await screen.findByText('You cannot remove your own admin role.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-3')).toBeInTheDocument();
  });

  it('is read-only without USER_MANAGE', async () => {
    vi.mocked(userApi.get).mockResolvedValue(account());
    renderAdmin(routes, '/admin/users/u1', adminWithout('USER_MANAGE'));

    await screen.findByRole('heading', { name: 'Ravi Kumar' });
    expect(screen.getByRole('checkbox', { name: 'Customer' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save roles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate account' })).not.toBeInTheDocument();
  });

  it('says when the user does not exist', async () => {
    vi.mocked(userApi.get).mockRejectedValue(new ApiError(404, 'USER_NOT_FOUND', 'User not found.'));
    renderAdmin(routes, '/admin/users/nope');

    expect(await screen.findByRole('heading', { name: 'User not found' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
