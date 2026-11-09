import { screen } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { renderRoutes } from '@/test/renderRoutes';
import { authApi } from './authApi';
import { RegisterPage } from './RegisterPage';

vi.mock('./authApi', () => ({
  authApi: { register: vi.fn(), resendVerification: vi.fn() },
}));

const routes = [{ path: '/register', element: <RegisterPage /> }];

async function fillValidForm(user: ReturnType<typeof renderRoutes>['user']) {
  await user.type(screen.getByLabelText('First name'), 'Asha');
  await user.type(screen.getByLabelText('Last name'), 'Rao');
  await user.type(screen.getByLabelText('Email'), 'asha@example.com');
  await user.type(screen.getByLabelText(/Mobile number/), '+91 98765 43210');
  await user.type(screen.getByLabelText('Password'), 'Travel2026Safe');
  await user.type(screen.getByLabelText('Repeat password'), 'Travel2026Safe');
  await user.click(screen.getByRole('checkbox', { name: /I accept the/ }));
}

describe('RegisterPage', () => {
  it('shows every problem before calling the server', async () => {
    const { user } = renderRoutes(routes, { path: '/register' });

    await user.type(screen.getByLabelText('First name'), '4sha');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText(/Mobile number/), '12ab');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText("First name can only contain letters, spaces, . ' -")).toBeInTheDocument();
    expect(screen.getByText('Enter your last name')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter 7–15 digits, optionally starting with +')).toBeInTheDocument();
    expect(screen.getByText('The password does not meet all the rules below')).toBeInTheDocument();
    expect(screen.getByText('Repeat the password')).toBeInTheDocument();
    expect(screen.getByText('Please accept the terms to continue')).toBeInTheDocument();
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('shows the password rules live', async () => {
    const { user } = renderRoutes(routes, { path: '/register' });
    const rules = screen.getByRole('list', { name: 'Password rules' });
    expect(rules).toHaveTextContent('At least one number (not met yet)');

    await user.type(screen.getByLabelText('Password'), 'abc1');

    expect(rules).toHaveTextContent('At least one number (met)');
    expect(rules).toHaveTextContent('10–64 characters (not met yet)');
  });

  it('notices mismatching passwords', async () => {
    const { user } = renderRoutes(routes, { path: '/register' });
    await fillValidForm(user);
    await user.clear(screen.getByLabelText('Repeat password'));
    await user.type(screen.getByLabelText('Repeat password'), 'Travel2026Other');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('registers and asks the user to check their inbox', async () => {
    vi.mocked(authApi.register).mockResolvedValue({ message: 'ok' });
    vi.mocked(authApi.resendVerification).mockResolvedValue({ message: 'ok' });
    const { user } = renderRoutes(routes, { path: '/register' });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(authApi.register).toHaveBeenCalledWith({
      email: 'asha@example.com',
      password: 'Travel2026Safe',
      firstName: 'Asha',
      lastName: 'Rao',
      phone: '+919876543210',
      acceptTerms: true,
    });

    await user.click(screen.getByRole('button', { name: 'Send the link again' }));
    expect(await screen.findByText('We have sent a new link.')).toBeInTheDocument();
    expect(authApi.resendVerification).toHaveBeenCalledWith('asha@example.com');
  });

  it('puts server-side field errors next to the fields', async () => {
    vi.mocked(authApi.register).mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'email', message: 'must be a well-formed email address' }]),
    );
    const { user } = renderRoutes(routes, { path: '/register' });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('must be a well-formed email address')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a password the server considers weak', async () => {
    vi.mocked(authApi.register).mockRejectedValue(
      new ApiError(422, 'WEAK_PASSWORD', 'weak', [], null, { rules: ['NOT_COMMON'] }),
    );
    const { user } = renderRoutes(routes, { path: '/register' });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Choose a stronger password: not a commonly used password.')).toBeInTheDocument();
  });
});
