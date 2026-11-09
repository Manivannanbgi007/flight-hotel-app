import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { NotificationSettingsPage } from './NotificationSettingsPage';
import { notificationApi, type NotificationPreferences } from './notificationApi';

vi.mock('./notificationApi', () => ({ notificationApi: { getPreferences: vi.fn(), updatePreferences: vi.fn() } }));

/** The server's defaults: everything on; e-mails about bookings, payments and refunds locked. */
const defaults = (newsletter: NotificationPreferences['newsletter'] = { subscribed: false, status: 'NONE' }): NotificationPreferences => ({
  items: (['BOOKING', 'PAYMENT', 'REFUND', 'REMINDER', 'SUPPORT'] as const).flatMap((category) => (['EMAIL', 'IN_APP'] as const).map((channel) => ({
    category, channel, enabled: true, locked: channel === 'EMAIL' && ['BOOKING', 'PAYMENT', 'REFUND'].includes(category),
  }))),
  newsletter,
});

const open = () => renderRoutes([{ path: '/account/notifications/settings', element: <NotificationSettingsPage /> }],
  { path: '/account/notifications/settings', auth: fakeAuth({ user: customer }) });

beforeEach(() => {
  vi.mocked(notificationApi.getPreferences).mockResolvedValue(defaults());
});

describe('NotificationSettingsPage', () => {
  it('shows a switch per topic and channel; locked ones are on, disabled and explained', async () => {
    open();

    const table = await screen.findByRole('table', { name: /Notifications by topic/ });
    expect(within(table).getAllByRole('switch')).toHaveLength(10);
    const bookingEmail = within(table).getByRole('switch', { name: 'Bookings: E-mail' });
    expect(bookingEmail).toBeChecked();
    expect(bookingEmail).toBeDisabled();
    expect(bookingEmail).toHaveAccessibleDescription(/E-mails about your bookings, payments and refunds .* are always sent/);
    expect(within(table).getAllByText('Always on')).toHaveLength(3);
    const reminderEmail = within(table).getByRole('switch', { name: 'Trip reminders: E-mail' });
    expect(reminderEmail).toBeChecked();
    expect(reminderEmail).toBeEnabled();
    expect(within(table).getByRole('switch', { name: 'Bookings: In the app' })).toBeEnabled();
  });

  it('saves one switch at once, sending only that item', async () => {
    let answer: (value: NotificationPreferences) => void = () => {};
    vi.mocked(notificationApi.updatePreferences).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const { user } = open();

    const reminders = await screen.findByRole('switch', { name: 'Trip reminders: E-mail' });
    await user.click(reminders);

    expect(notificationApi.updatePreferences).toHaveBeenCalledWith({ items: [{ category: 'REMINDER', channel: 'EMAIL', enabled: false }] });
    expect(reminders).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');

    const saved = defaults();
    saved.items = saved.items.map((item) => (item.category === 'REMINDER' && item.channel === 'EMAIL' ? { ...item, enabled: false } : item));
    answer(saved);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Changes saved.'));
    expect(reminders).not.toBeChecked();
    // The focus stays on the switch (it is never disabled while saving).
    expect(reminders).toHaveFocus();
  });

  it('puts the switch back and says why when the server refuses (422 PREFERENCE_LOCKED)', async () => {
    vi.mocked(notificationApi.updatePreferences).mockRejectedValue(
      new ApiError(422, 'PREFERENCE_LOCKED', 'Support e-mails are always sent.', [], 'corr-7'));
    const { user } = open();

    const supportEmail = await screen.findByRole('switch', { name: 'Support: E-mail' });
    await user.click(supportEmail);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your change was not saved');
    expect(alert).toHaveTextContent('Support e-mails are always sent.');
    expect(alert).toHaveTextContent('Support reference: corr-7');
    expect(supportEmail).toBeChecked();
  });

  it('subscribes the account e-mail to the newsletter', async () => {
    vi.mocked(notificationApi.updatePreferences).mockResolvedValue(defaults({ subscribed: true, status: 'SUBSCRIBED' }));
    const { user } = open();

    const newsletter = await screen.findByRole('switch', { name: 'Newsletter' });
    expect(newsletter).not.toBeChecked();
    expect(newsletter).toHaveAccessibleDescription(/sent to asha@example.com/);
    expect(screen.getByText('You are not subscribed.')).toBeInTheDocument();

    await user.click(newsletter);

    expect(notificationApi.updatePreferences).toHaveBeenCalledWith({ items: [], newsletter: true });
    await waitFor(() => expect(newsletter).toBeChecked());
    expect(screen.getByText('You are subscribed.')).toBeInTheDocument();
  });

  it('explains a subscription that waits for its confirmation link', async () => {
    vi.mocked(notificationApi.getPreferences).mockResolvedValue(defaults({ subscribed: false, status: 'PENDING' }));
    open();

    expect(await screen.findByText(/Waiting for you to confirm the link we e-mailed/)).toBeInTheDocument();
  });

  it('turns the newsletter off and restores the old state when that fails', async () => {
    vi.mocked(notificationApi.getPreferences).mockResolvedValue(defaults({ subscribed: true, status: 'SUBSCRIBED' }));
    vi.mocked(notificationApi.updatePreferences).mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server.'));
    const { user } = open();

    const newsletter = await screen.findByRole('switch', { name: 'Newsletter' });
    await user.click(newsletter);

    expect(notificationApi.updatePreferences).toHaveBeenCalledWith({ items: [], newsletter: false });
    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument();
    expect(newsletter).toBeChecked();
    expect(screen.getByText('You are subscribed.')).toBeInTheDocument();
  });

  it('offers a retry when the settings cannot be loaded', async () => {
    vi.mocked(notificationApi.getPreferences).mockRejectedValue(new ApiError(503, 'HTTP_503', 'Something went wrong on our side.'));
    open();

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
