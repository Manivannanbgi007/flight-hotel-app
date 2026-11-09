import { screen, waitFor } from '@testing-library/react';

import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { NotificationBell } from './NotificationBell';
import { notificationApi, type AppNotification } from './notificationApi';

vi.mock('./notificationApi', () => ({
  notificationApi: { list: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() },
}));

const notification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1', category: 'BOOKING', title: 'Booking confirmed', message: 'Your booking HT-7K3M9Q2X is confirmed.',
  link: '/my-trips/b1', read: false, createdAt: '2099-03-01T10:00:00Z', ...overrides,
});

const open = (loggedIn = true) => renderRoutes([
  { path: '/', element: <NotificationBell /> },
  { path: '/my-trips/:id', element: <p>trip page</p> },
], { auth: fakeAuth({ user: loggedIn ? customer : null }) });

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.mocked(notificationApi.unreadCount).mockResolvedValue(2);
    vi.mocked(notificationApi.list).mockResolvedValue({ content: [notification(), notification({ id: 'n2', title: 'Payment received', read: true, link: null })], page: 0, size: 8, totalElements: 2, totalPages: 1 });
    vi.mocked(notificationApi.markRead).mockResolvedValue();
    vi.mocked(notificationApi.markAllRead).mockResolvedValue(1);
  });

  it('shows nothing to visitors', () => {
    open(false);

    expect(screen.queryByRole('button', { name: /Notifications/ })).not.toBeInTheDocument();
    expect(notificationApi.unreadCount).not.toHaveBeenCalled();
  });

  it('shows the unread count on the bell', async () => {
    open();

    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
  });

  it('opens the latest notifications; a click opens the related page and marks it read', async () => {
    const { user, router } = open();

    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    const item = await screen.findByRole('button', { name: /Booking confirmed/ });
    expect(screen.getByText('Payment received')).toBeInTheDocument();
    await user.click(item);

    await waitFor(() => expect(currentLocation(router)).toBe('/my-trips/b1'));
    expect(notificationApi.markRead).toHaveBeenCalledWith('n1', expect.anything());
  });

  it('marks everything read', async () => {
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(notificationApi.markAllRead).toHaveBeenCalled());
  });

  it('links to the Notification Center', async () => {
    const { user, router } = renderRoutes([
      { path: '/', element: <NotificationBell /> },
      { path: '/account/notifications', element: <p>notification center</p> },
    ], { auth: fakeAuth({ user: customer }) });

    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await user.click(await screen.findByRole('link', { name: 'See all notifications' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/account/notifications'));
    expect(screen.getByText('notification center')).toBeInTheDocument();
  });

  it('says so when there is nothing yet', async () => {
    vi.mocked(notificationApi.unreadCount).mockResolvedValue(0);
    vi.mocked(notificationApi.list).mockResolvedValue({ content: [], page: 0, size: 8, totalElements: 0, totalPages: 0 });
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText('You have no notifications yet.')).toBeInTheDocument();
  });
});
