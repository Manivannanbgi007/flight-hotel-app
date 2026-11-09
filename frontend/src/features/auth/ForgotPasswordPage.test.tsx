import { screen } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { currentLocation, renderRoutes } from '@/test/renderRoutes';
import { authApi } from './authApi';
import { ForgotPasswordPage } from './ForgotPasswordPage';

vi.mock('./authApi', () => ({ authApi: { forgotPassword: vi.fn() } }));

const GENERIC = 'If an account exists for this address, we have sent a link to reset the password.';

const open = (path = '/forgot-password') => renderRoutes([
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/customer/login', element: <p>login page</p> },
  { path: '/admin/login', element: <p>admin login page</p> },
], { path });

describe('ForgotPasswordPage', () => {
  it('checks the e-mail address before sending', async () => {
    const { user } = open();

    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'asha@');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(authApi.forgotPassword).not.toHaveBeenCalled();
  });

  it("shows the server's neutral answer, which never says whether the account exists", async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ message: GENERIC });
    const { user, router } = open();

    await user.type(screen.getByLabelText('Email'), '  asha@example.com ');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByText(GENERIC)).toBeInTheDocument();
    expect(screen.getByText('The link is valid for 1 hour and can be used once.')).toBeInTheDocument();
    expect(authApi.forgotPassword).toHaveBeenCalledWith('asha@example.com');

    await user.click(screen.getByRole('link', { name: 'Back to log in' }));
    expect(currentLocation(router)).toBe('/customer/login');
  });

  it('keeps the form and explains a failure', async () => {
    vi.mocked(authApi.forgotPassword).mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment.'));
    const { user } = open();

    await user.type(screen.getByLabelText('Email'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Please wait a moment.');
    expect(screen.getByLabelText('Email')).toHaveValue('asha@example.com');
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/customer/login');
  });

  it('goes back to the staff sign-in page it was opened from', () => {
    open('/forgot-password?portal=admin');

    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/admin/login');
  });
});
