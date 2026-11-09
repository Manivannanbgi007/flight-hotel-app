import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import type { Page } from '@/lib/api/types';
import type { AuthResponse } from '@/lib/auth/types';
import { stubFileSaving } from '@/test/downloads';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { accountApi } from './accountApi';
import { SecurityPage } from './SecurityPage';
import type { LoginHistoryEntry } from './types';

vi.mock('./accountApi', () => ({
  accountApi: { changePassword: vi.fn(), logoutEverywhere: vi.fn(), loginHistory: vi.fn() },
}));

const CURRENT = 'Old-password-17';
const NEW = 'Sunrise-trip-42';

const historyPage = (content: LoginHistoryEntry[], overrides: Partial<Page<LoginHistoryEntry>> = {}): Page<LoginHistoryEntry> => ({
  content, page: 0, size: 10, totalElements: content.length, totalPages: 1, ...overrides,
});

const entry = (overrides: Partial<LoginHistoryEntry> = {}): LoginHistoryEntry => ({
  occurredAt: '2026-11-05T10:15:00Z', success: true, failureReason: null, ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36',
  ...overrides,
});

function openSecurity(auth = fakeAuth({ user: customer })) {
  return renderRoutes([{ path: '/account/security', element: <SecurityPage /> }], { path: '/account/security', auth });
}

beforeEach(() => {
  vi.mocked(accountApi.loginHistory).mockResolvedValue(historyPage([entry()]));
});

describe('SecurityPage: change password', () => {
  it('checks the form before sending', async () => {
    const { user } = openSecurity();

    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Enter your current password')).toBeInTheDocument();
    expect(screen.getByText('Choose a new password')).toBeInTheDocument();
    expect(screen.getByText('Repeat the new password')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Current password'), CURRENT);
    await user.type(screen.getByLabelText('New password'), CURRENT);
    await user.type(screen.getByLabelText('Repeat new password'), 'something-else-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();
    expect(screen.getByText('The new password must be different')).toBeInTheDocument();
    expect(accountApi.changePassword).not.toHaveBeenCalled();
  });

  it('rejects a weak new password while typing and on submit', async () => {
    const { user } = openSecurity();

    await user.type(screen.getByLabelText('Current password'), CURRENT);
    await user.type(screen.getByLabelText('New password'), 'short1');
    await user.type(screen.getByLabelText('Repeat new password'), 'short1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('The password does not meet all the rules below')).toBeInTheDocument();
    expect(accountApi.changePassword).not.toHaveBeenCalled();
  });

  it('keeps this session with the new token, empties the form and confirms', async () => {
    const response: AuthResponse = { accessToken: 'fresh-token', tokenType: 'Bearer', expiresIn: 900, user: customer };
    vi.mocked(accountApi.changePassword).mockResolvedValue(response);
    const auth = fakeAuth({ user: customer });
    const { user } = openSecurity(auth);

    await user.type(screen.getByLabelText('Current password'), CURRENT);
    await user.type(screen.getByLabelText('New password'), NEW);
    await user.type(screen.getByLabelText('Repeat new password'), NEW);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Your password was changed. Other devices have been logged out.')).toBeInTheDocument();
    expect(accountApi.changePassword).toHaveBeenCalledWith({ currentPassword: CURRENT, newPassword: NEW });
    expect(auth.login).toHaveBeenCalledWith(response);
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it.each([
    ['CURRENT_PASSWORD_INCORRECT', {}, 'Current password', 'The current password is not correct'],
    ['PASSWORD_UNCHANGED', {}, 'New password', 'The new password must be different'],
    ['WEAK_PASSWORD', { rules: ['NOT_COMMON'] }, 'New password', 'Choose a stronger password: not a commonly used password.'],
  ])('shows %s from the server on the field', async (code, details, field, message) => {
    vi.mocked(accountApi.changePassword).mockRejectedValue(new ApiError(422, code, 'Rejected', [], null, details));
    const { user } = openSecurity();

    await user.type(screen.getByLabelText('Current password'), CURRENT);
    await user.type(screen.getByLabelText('New password'), NEW);
    await user.type(screen.getByLabelText('Repeat new password'), NEW);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Rejected')).not.toBeInTheDocument();
  });

  it('shows any other failure above the form', async () => {
    vi.mocked(accountApi.changePassword).mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait 15 minutes.'));
    const { user } = openSecurity();

    await user.type(screen.getByLabelText('Current password'), CURRENT);
    await user.type(screen.getByLabelText('New password'), NEW);
    await user.type(screen.getByLabelText('Repeat new password'), NEW);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Wait 15 minutes.');
  });
});

describe('SecurityPage: log out everywhere', () => {
  it('asks for confirmation, can be cancelled, then ends every session', async () => {
    vi.mocked(accountApi.logoutEverywhere).mockResolvedValue(undefined);
    const auth = fakeAuth({ user: customer });
    const { user } = openSecurity(auth);

    await user.click(screen.getByRole('button', { name: 'Log out on all devices…' }));
    expect(screen.getByText('You will need to log in again on every device.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(accountApi.logoutEverywhere).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Log out on all devices…' }));
    await user.click(screen.getByRole('button', { name: 'Log out everywhere' }));

    await waitFor(() => expect(auth.endSession).toHaveBeenCalledWith('/customer/login?reason=logged-out-everywhere'));
  });

  it('keeps the session and explains when it fails', async () => {
    vi.mocked(accountApi.logoutEverywhere).mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server.'));
    const auth = fakeAuth({ user: customer });
    const { user } = openSecurity(auth);

    await user.click(screen.getByRole('button', { name: 'Log out on all devices…' }));
    await user.click(screen.getByRole('button', { name: 'Log out everywhere' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server.');
    expect(auth.endSession).not.toHaveBeenCalled();
  });
});

describe('SecurityPage: recent activity', () => {
  it('lists logins and failed attempts with a readable device', async () => {
    vi.mocked(accountApi.loginHistory).mockResolvedValue(historyPage([
      entry(),
      entry({ success: false, failureReason: 'BAD_PASSWORD', userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0' }),
      entry({ success: false, failureReason: 'ACCOUNT_LOCKED', ipAddress: null,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }),
      entry({ success: false, failureReason: 'SOMETHING_NEW', userAgent: null }),
      entry({ userAgent: 'curl/8.4.0', ipAddress: '198.51.100.1' }),
    ]));
    openSecurity();

    const table = await screen.findByRole('table', { name: 'Login history, newest first' });
    const rows = within(table).getAllByRole('row').slice(1).map((row) =>
      within(row).getAllByRole('cell').slice(1).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ['Logged in', '203.0.113.7', 'Chrome on Windows'],
      ['Wrong password', '203.0.113.7', 'Firefox on Linux'],
      ['Account was locked', '—', 'Safari on iOS'],
      ['Failed', '203.0.113.7', 'Unknown device'],
      ['Logged in', '198.51.100.1', 'curl/8.4.0'],
    ]);
    expect(accountApi.loginHistory).toHaveBeenCalledWith(0, 10);
  });

  it('exports my login activity on screen as CSV, the way the table shows it', async () => {
    const files = stubFileSaving();
    vi.mocked(accountApi.loginHistory).mockResolvedValue(historyPage([
      entry({ occurredAt: '2026-11-05T10:15:00' }),
      entry({ occurredAt: '2026-11-04T22:03:00', success: false, failureReason: 'BAD_PASSWORD', ipAddress: null, userAgent: null }),
    ]));
    const { user } = openSecurity();
    await screen.findByRole('table', { name: 'Login history, newest first' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export login activity' });
    expect(within(panel).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^login-activity-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await files.blobs[0]!.text()).split('\r\n')).toEqual([
      '"When","Result","IP address","Device"',
      '2026-11-05 10:15,"Logged in","203.0.113.7","Chrome on Windows"',
      '2026-11-04 22:03,"Wrong password",,"Unknown device"',
      '',
    ]);
  });

  it('exports all my older activity too, page by page through the same call', async () => {
    const files = stubFileSaving();
    const all = Array.from({ length: 23 }, (_, index) => entry({ ipAddress: `10.0.0.${index + 1}` }));
    vi.mocked(accountApi.loginHistory).mockImplementation(async (page, size = 10) =>
      historyPage(all.slice(page * size, page * size + size), { page, size, totalElements: all.length, totalPages: Math.ceil(all.length / size) }));
    const { user } = openSecurity();
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(accountApi.loginHistory).toHaveBeenLastCalledWith(0, 100);
    const lines = (await files.blobs[0]!.text()).split('\r\n');
    // Same second, same IP, same result: every attempt stays in the file.
    expect(lines).toHaveLength(25);
    expect(lines[23]).toContain('"10.0.0.23"');
  });

  it('names a refusal on the wrong sign-in page (PORTAL_NOT_ALLOWED)', async () => {
    vi.mocked(accountApi.loginHistory).mockResolvedValue(historyPage([entry({ success: false, failureReason: 'PORTAL_NOT_ALLOWED' })]));
    openSecurity();

    const table = await screen.findByRole('table', { name: 'Login history, newest first' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Wrong sign-in page');
  });

  it('pages through older activity', async () => {
    vi.mocked(accountApi.loginHistory).mockImplementation(async (page) =>
      historyPage([entry({ ipAddress: `10.0.0.${page + 1}` })], { page, totalPages: 2 }));
    const { user } = openSecurity();

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    // Newest first: "Previous" goes to newer activity, "Next" to older.
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('10.0.0.2')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(accountApi.loginHistory).toHaveBeenLastCalledWith(1, 10);
  });

  it('can retry when the activity cannot be loaded', async () => {
    vi.mocked(accountApi.loginHistory)
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.'))
      .mockResolvedValueOnce(historyPage([entry()]));
    const { user } = openSecurity();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Something went wrong on our side.');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();
  });
});
