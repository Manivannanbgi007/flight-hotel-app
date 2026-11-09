import { screen } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { currentLocation, renderRoutes } from '@/test/renderRoutes';
import { authApi } from './authApi';
import { ResetPasswordPage } from './ResetPasswordPage';
import { VerifyEmailPage } from './VerifyEmailPage';

vi.mock('./authApi', () => ({
  authApi: { resetPassword: vi.fn(), verifyEmail: vi.fn(), resendVerification: vi.fn() },
}));

const routes = [
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/customer/login', element: <p>login page</p> },
  { path: '/hotel-manager/login', element: <p>partner login page</p> },
];

async function choosePassword(user: ReturnType<typeof renderRoutes>['user'], password = 'Brand2026NewPass') {
  await user.type(screen.getByLabelText('New password'), password);
  await user.type(screen.getByLabelText('Repeat new password'), password);
}

describe('ResetPasswordPage', () => {
  it('sets the new password and sends the user to log in', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue({ message: 'ok' });
    const { user, router } = renderRoutes(routes, { path: '/reset-password?token=tok123' });

    await choosePassword(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(authApi.resetPassword).toHaveBeenCalledWith({ token: 'tok123', newPassword: 'Brand2026NewPass' });
    expect(currentLocation(router)).toBe('/customer/login?reason=password-reset');
  });

  it('uses the invitation wording for new staff accounts', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue({ message: 'ok' });
    const { user, router } = renderRoutes(routes, { path: '/reset-password?token=tok123&invite=1' });

    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
    await choosePassword(user);
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/customer/login?reason=account-ready');
  });

  it("sends invited staff to their own portal's sign-in page when the link names it", async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue({ message: 'ok' });
    const { user, router } = renderRoutes(routes, { path: '/reset-password?token=tok123&invite=1&portal=HOTEL_MANAGER' });

    await choosePassword(user);
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('partner login page')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/hotel-manager/login?reason=account-ready');
  });

  it('rejects a weak password without calling the server', async () => {
    const { user } = renderRoutes(routes, { path: '/reset-password?token=tok123' });

    await choosePassword(user, 'password123');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('The password does not meet all the rules below')).toBeInTheDocument();
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it('explains an expired link and offers a new one', async () => {
    vi.mocked(authApi.resetPassword).mockRejectedValue(new ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'expired'));
    const { user } = renderRoutes(routes, { path: '/reset-password?token=old' });

    await choosePassword(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('heading', { name: 'This link does not work' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('handles a link without token', () => {
    renderRoutes(routes, { path: '/reset-password' });
    expect(screen.getByRole('heading', { name: 'This link does not work' })).toBeInTheDocument();
  });
});

describe('VerifyEmailPage', () => {
  it('confirms the email exactly once', async () => {
    vi.mocked(authApi.verifyEmail).mockResolvedValue({ message: 'ok' });
    renderRoutes(routes, { path: '/verify-email?token=tok123' });

    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(1);
    expect(authApi.verifyEmail).toHaveBeenCalledWith('tok123');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/customer/login?reason=verified');
  });

  it('lets the user request a new link when the old one expired', async () => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue(new ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'expired'));
    vi.mocked(authApi.resendVerification).mockResolvedValue({ message: 'If this account is waiting, we sent a link.' });
    const { user } = renderRoutes(routes, { path: '/verify-email?token=old' });

    await user.type(await screen.findByLabelText('Email'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(await screen.findByText('If this account is waiting, we sent a link.')).toBeInTheDocument();
    expect(authApi.resendVerification).toHaveBeenCalledWith('asha@example.com');
  });
});
