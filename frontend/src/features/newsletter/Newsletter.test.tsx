import { screen, waitFor } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { newsletterApi } from './newsletterApi';
import { NewsletterConfirmPage } from './NewsletterConfirmPage';
import { NewsletterSignup, SUBSCRIBE_DONE_TEXT } from './NewsletterSignup';
import { NewsletterUnsubscribePage } from './NewsletterUnsubscribePage';

vi.mock('./newsletterApi', () => ({ newsletterApi: { subscribe: vi.fn(), confirm: vi.fn(), unsubscribe: vi.fn() } }));

describe('NewsletterSignup (footer)', () => {
  const open = () => renderRoutes(<NewsletterSignup />, { auth: fakeAuth() });

  it('always answers with the same neutral message', async () => {
    vi.mocked(newsletterApi.subscribe).mockResolvedValue();
    const { user } = open();

    await user.type(screen.getByLabelText('Your e-mail address'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Subscribe' }));

    expect(await screen.findByRole('status')).toHaveTextContent(SUBSCRIBE_DONE_TEXT);
    expect(newsletterApi.subscribe).toHaveBeenCalledWith('asha@example.com');
  });

  it('checks the address before sending', async () => {
    const { user } = open();

    await user.type(screen.getByLabelText('Your e-mail address'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Subscribe' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Your e-mail address')).toHaveAttribute('aria-invalid', 'true');
    expect(newsletterApi.subscribe).not.toHaveBeenCalled();
  });

  it('says so when the server is busy (rate limit)', async () => {
    vi.mocked(newsletterApi.subscribe).mockRejectedValue(new ApiError(429, 'HTTP_429', 'Too many requests. Please wait a moment.'));
    const { user } = open();

    await user.type(screen.getByLabelText('Your e-mail address'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Subscribe' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Please wait a moment.');
  });
});

describe('NewsletterConfirmPage', () => {
  const open = (path: string) => renderRoutes([{ path: '/newsletter/confirm', element: <NewsletterConfirmPage /> }], { path });

  it('confirms on load and shows the (masked) address', async () => {
    vi.mocked(newsletterApi.confirm).mockResolvedValue({ status: 'SUBSCRIBED', email: 'a***@example.com' });
    open('/newsletter/confirm?token=tok-123');

    expect(await screen.findByRole('heading', { name: 'You are subscribed' })).toBeInTheDocument();
    expect(screen.getByText('a***@example.com')).toBeInTheDocument();
    expect(newsletterApi.confirm).toHaveBeenCalledTimes(1);
    expect(newsletterApi.confirm).toHaveBeenCalledWith('tok-123');
  });

  it('explains an invalid or expired link and offers a new one', async () => {
    vi.mocked(newsletterApi.confirm).mockRejectedValue(new ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'The link is invalid or has expired.'));
    open('/newsletter/confirm?token=old');

    expect(await screen.findByRole('heading', { name: 'This link does not work' })).toBeInTheDocument();
    expect(screen.getByText(/valid for 48 hours/)).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Newsletter' })).toBeInTheDocument();
  });

  it('does not call the server without a token', () => {
    open('/newsletter/confirm');

    expect(screen.getByRole('heading', { name: 'This link does not work' })).toBeInTheDocument();
    expect(newsletterApi.confirm).not.toHaveBeenCalled();
  });

  it('offers a retry when the server could not be reached', async () => {
    vi.mocked(newsletterApi.confirm).mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server.'));
    open('/newsletter/confirm?token=tok-123');

    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('NewsletterUnsubscribePage', () => {
  const open = (path: string) => renderRoutes([{ path: '/newsletter/unsubscribe', element: <NewsletterUnsubscribePage /> }], { path });

  it('only unsubscribes after the button is pressed (link scanners cannot do it)', async () => {
    vi.mocked(newsletterApi.unsubscribe).mockResolvedValue({ status: 'UNSUBSCRIBED' });
    const { user } = open('/newsletter/unsubscribe?token=tok-9');

    expect(screen.getByRole('heading', { name: 'Unsubscribe from the newsletter?' })).toBeInTheDocument();
    expect(newsletterApi.unsubscribe).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }));

    expect(await screen.findByRole('heading', { name: 'You are unsubscribed' })).toBeInTheDocument();
    expect(newsletterApi.unsubscribe).toHaveBeenCalledWith('tok-9');
  });

  it('explains a link that does not work', async () => {
    vi.mocked(newsletterApi.unsubscribe).mockRejectedValue(new ApiError(400, 'INVALID_TOKEN', 'Invalid link.'));
    const { user } = open('/newsletter/unsubscribe?token=bad');

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }));

    expect(await screen.findByRole('heading', { name: 'This link does not work' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'notification settings' })).toHaveAttribute('href', '/account/notifications/settings');
  });

  it('keeps the button for another try after a temporary error', async () => {
    vi.mocked(newsletterApi.unsubscribe).mockRejectedValueOnce(new ApiError(503, 'HTTP_503', 'Please try again later.', [], 'corr-4'))
      .mockResolvedValue({ status: 'UNSUBSCRIBED' });
    const { user } = open('/newsletter/unsubscribe?token=tok-9');

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Support reference: corr-4');
    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }));

    await waitFor(() => expect(newsletterApi.unsubscribe).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'You are unsubscribed' })).toBeInTheDocument();
  });

  it('shows the invalid-link page without a token', () => {
    open('/newsletter/unsubscribe');

    expect(screen.getByRole('heading', { name: 'This link does not work' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unsubscribe' })).not.toBeInTheDocument();
  });
});
